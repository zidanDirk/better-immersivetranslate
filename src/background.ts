import {
  applyReadingMode,
  collectTranslatableSemanticTextBlocks,
  DEFAULT_EXCLUDED_CONTENT_SELECTOR,
  initializeTranslationProgress,
  insertBilingualTranslations,
  isReadingMode,
  READING_MODE_PRESERVED_CONTENT_SELECTOR,
  selectionIntersectsDefaultExcludedContent,
  updateTranslationBatchProgress,
  type ReadingMode,
  type RetryTranslationBatch,
  type SemanticTextBlock,
  type TranslationBatchFailureKind,
} from "./page-translation.js";
import {
  translateSemanticTextBatch,
  type TranslationBatchResult,
} from "./translation-provider.js";
import { isRecord } from "./unknown-value.js";
import {
  loadWebsiteOverride,
  resolveSelectionTranslationEnabled,
  resolveTranslationPreferences,
  selectionTranslationRegistration,
  websiteAccess,
} from "./website-overrides.js";
import type { TranslationInstructions } from "./translation-instructions.js";

const selectionMenuId = "translate-selected-text";
const translationBatchSize = 10;
const maximumConcurrentTranslationBatches = 2;
const selectionTranslationContentScriptId = "selection-translation";
let activeProviderRequestCount = 0;
const priorityProviderWaiters: Array<() => void> = [];
const normalProviderWaiters: Array<() => void> = [];

async function prioritizedTranslationRequest(
  blocks: SemanticTextBlock[],
  targetLanguage: string,
  instructions: TranslationInstructions,
  priority: "normal" | "selection",
): Promise<TranslationBatchResult> {
  if (activeProviderRequestCount >= maximumConcurrentTranslationBatches) {
    await new Promise<void>((resolve) => {
      (priority === "selection"
        ? priorityProviderWaiters
        : normalProviderWaiters
      ).push(resolve);
    });
  } else {
    activeProviderRequestCount += 1;
  }
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    const next =
      priorityProviderWaiters.shift() ?? normalProviderWaiters.shift();
    if (next) {
      next();
      return;
    }
    activeProviderRequestCount -= 1;
  };
  try {
    return await translateSemanticTextBatch(
      blocks,
      targetLanguage,
      instructions,
    );
  } finally {
    release();
  }
}

async function syncSelectionTranslationContentScript(): Promise<void> {
  const { matches, excludeMatches } =
    await selectionTranslationRegistration();
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [selectionTranslationContentScriptId],
  });
  if (registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({
      ids: [selectionTranslationContentScriptId],
    });
  }
  if (matches.length === 0) return;
  await chrome.scripting.registerContentScripts([
    {
      id: selectionTranslationContentScriptId,
      js: ["selection-translation.js"],
      matches,
      excludeMatches,
      persistAcrossSessions: true,
      runAt: "document_idle",
    },
  ]);
}

interface TabTranslationState {
  failedBatchCount: number;
  pendingIncrementalBlocks: Map<string, SemanticTextBlock>;
  queue: Promise<void>;
  scheduledIncrementalTranslation?: Promise<void>;
}

const translationStateByTab = new Map<number, TabTranslationState>();

function translationState(tabId: number): TabTranslationState {
  const existing = translationStateByTab.get(tabId);
  if (existing) {
    return existing;
  }
  const created: TabTranslationState = {
    failedBatchCount: 0,
    pendingIncrementalBlocks: new Map(),
    queue: Promise.resolve(),
  };
  translationStateByTab.set(tabId, created);
  return created;
}

function isSemanticTextBlock(value: unknown): value is SemanticTextBlock {
  return isRecord(value) && typeof value.id === "string" && typeof value.text === "string" && (value.version === undefined || (typeof value.version === "number" && Number.isInteger(value.version) && value.version >= 0));
}

function safelySendResponse(
  sendResponse: (response?: unknown) => void,
  response: unknown,
): void {
  try {
    sendResponse(response);
  } catch {
    // The sender may have navigated or closed before the task settled.
  }
}

async function runTranslationBatch(
  tabId: number,
  batchIndex: number,
  retryBatch: RetryTranslationBatch,
  instructions: TranslationInstructions,
  maximumAutomaticRetryCount = 3,
): Promise<boolean> {
  await chrome.scripting.executeScript({ target: { tabId }, func: updateTranslationBatchProgress, args: [batchIndex, { status: "processing" }] });
  let result = await prioritizedTranslationRequest(
    retryBatch.blocks,
    retryBatch.targetLanguage,
    instructions,
    "normal",
  );
  for (
    let retryIndex = 0;
    retryIndex < maximumAutomaticRetryCount &&
    result.kind === "failed" &&
    (result.failureKind === "network" ||
      result.failureKind === "rate-limit" ||
      result.failureKind === "response-format" ||
      result.failureKind === "timeout");
    retryIndex += 1
  ) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(100 * 2 ** retryIndex, 400)),
    );
    result = await prioritizedTranslationRequest(
      retryBatch.blocks,
      retryBatch.targetLanguage,
      instructions,
      "normal",
    );
  }
  if (result.kind === "failed") {
    await chrome.scripting.executeScript({ target: { tabId }, func: updateTranslationBatchProgress, args: [batchIndex, { status: "failed", failureKind: result.failureKind, retryBatch }] });
    return false;
  }
  await chrome.scripting.executeScript({ target: { tabId }, func: insertBilingualTranslations, args: [result.translations, retryBatch.targetLanguage, retryBatch.blocks] });
  await chrome.scripting.executeScript({ target: { tabId }, func: updateTranslationBatchProgress, args: [batchIndex, { status: "complete" }] });
  return true;
}

function enqueueTranslation(
  tabId: number,
  translation: () => Promise<void>,
): Promise<void> {
  const state = translationState(tabId);
  const current = state.queue.catch(() => {}).then(translation);
  state.queue = current;
  const removeCompletedQueue = (): void => {
    if (state.queue === current) {
      state.queue = Promise.resolve();
    }
  };
  void current.then(removeCompletedQueue, removeCompletedQueue);
  return current;
}

async function translateBlocks(
  tabId: number,
  blocks: SemanticTextBlock[],
  targetLanguage: string,
  instructions: TranslationInstructions,
): Promise<number> {
  if (blocks.length === 0) return 0;
  const batches = Array.from({ length: Math.ceil(blocks.length / translationBatchSize) }, (_, index) => blocks.slice(index * translationBatchSize, (index + 1) * translationBatchSize));
  await chrome.scripting.executeScript({ target: { tabId }, func: initializeTranslationProgress, args: [batches.length] });
  let failureCount = 0;
  let nextBatchIndex = 0;
  const workerCount = Math.min(maximumConcurrentTranslationBatches, batches.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextBatchIndex < batches.length) {
        const batchIndex = nextBatchIndex;
        nextBatchIndex += 1;
        const batch = batches[batchIndex];
        if (!batch) continue;
        if (!(await runTranslationBatch(tabId, batchIndex, { blocks: batch, targetLanguage }, instructions))) {
          failureCount += 1;
        }
      }
    }),
  );
  return failureCount;
}

function mergePendingIncrementalBlocks(
  tabId: number,
  blocks: SemanticTextBlock[],
): void {
  const pending = translationState(tabId).pendingIncrementalBlocks;
  for (const block of blocks) {
    const current = pending.get(block.id);
    if ((current?.version ?? -1) <= (block.version ?? 0)) {
      pending.set(block.id, block);
    }
  }
}

function scheduleIncrementalTranslation(tabId: number): Promise<void> {
  const state = translationState(tabId);
  if (state.failedBatchCount > 0) {
    return Promise.resolve();
  }
  const scheduled = state.scheduledIncrementalTranslation;
  if (scheduled) {
    return scheduled;
  }

  const current = enqueueTranslation(tabId, async () => {
    const pending = state.pendingIncrementalBlocks;
    if (pending.size === 0) {
      return;
    }
    state.pendingIncrementalBlocks = new Map();
    const tab = await chrome.tabs.get(tabId);
    const preferences = await resolveTranslationPreferences(tab.url);
    state.failedBatchCount = await translateBlocks(tabId, [
      ...pending.values(),
    ], preferences.targetLanguage, preferences.instructions);
  });
  state.scheduledIncrementalTranslation = current;
  const scheduleLatestPendingBlocks = (): void => {
    if (state.scheduledIncrementalTranslation === current) {
      state.scheduledIncrementalTranslation = undefined;
    }
  if (
    state.failedBatchCount === 0 &&
    state.pendingIncrementalBlocks.size > 0
  ) {
      void scheduleIncrementalTranslation(tabId).catch(() => {});
    }
  };
  void current.then(scheduleLatestPendingBlocks, scheduleLatestPendingBlocks);
  return current;
}

async function translateCurrentPage(tabId: number): Promise<void> {
  const state = translationState(tabId);
  state.pendingIncrementalBlocks.clear();
  state.failedBatchCount = 0;
  const tab = await chrome.tabs.get(tabId);
  const preferences = await resolveTranslationPreferences(tab.url);
  const extraction = await chrome.scripting.executeScript({ target: { tabId }, func: collectTranslatableSemanticTextBlocks, args: [DEFAULT_EXCLUDED_CONTENT_SELECTOR, true] });
  const blocks = (extraction[0]?.result ?? []) as SemanticTextBlock[];
  state.failedBatchCount = await translateBlocks(
    tabId,
    blocks,
    preferences.targetLanguage,
    preferences.instructions,
  );
}

async function setReadingMode(tabId: number, mode: ReadingMode): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, func: applyReadingMode, args: [mode, READING_MODE_PRESERVED_CONTENT_SELECTOR] });
}

async function translateSelectedText(tabId: number, selectionText: string): Promise<void> {
  const result = await selectionTranslationResult(tabId, selectionText);
  if (result.kind !== "complete") return;
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["selection-translation.js"],
  });
  await chrome.tabs.sendMessage(tabId, {
    ...result,
    kind: "show-selection-translation-result",
  });
}

async function selectionTranslationResult(
  tabId: number,
  selectionText: string,
): Promise<
  | {
      kind: "complete";
      sourceText: string;
      translatedText: string;
      targetLanguage: string;
    }
  | {
      kind: "failed";
      failureKind: TranslationBatchFailureKind | "extension";
    }
> {
  const tab = await chrome.tabs.get(tabId);
  const preferences = await resolveTranslationPreferences(tab.url);
  const result = await prioritizedTranslationRequest(
    [{ id: "selected-text", text: selectionText }],
    preferences.targetLanguage,
    preferences.instructions,
    "selection",
  );
  if (result.kind === "failed") return result;
  const translation = result.translations[0];
  return translation
    ? {
        kind: "complete",
        sourceText: selectionText,
        translatedText: translation.text,
        targetLanguage: preferences.targetLanguage,
      }
    : { kind: "failed", failureKind: "response-format" };
}

async function setSelectionTranslationForTab(
  tabId: number,
  enabled: boolean,
): Promise<void> {
  if (enabled) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["selection-translation.js"],
    });
    return;
  }
  await chrome.tabs
    .sendMessage(tabId, { kind: "disable-selection-translation" })
    .catch(() => {});
}

async function refreshSelectionTranslationForTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  await setSelectionTranslationForTab(
    tabId,
    await resolveSelectionTranslationEnabled(tab.url),
  );
}

async function syncAndRefreshSelectionTranslationTabs(): Promise<void> {
  await syncSelectionTranslationContentScript();
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab): tab is chrome.tabs.Tab & { id: number } =>
        typeof tab.id === "number",
      )
      .map(async (tab) => {
        const enabled = await resolveSelectionTranslationEnabled(tab.url);
        await setSelectionTranslationForTab(tab.id, enabled).catch(() => {});
      }),
  );
}

void syncAndRefreshSelectionTranslationTabs().catch(() => {});

function registerSelectionContextMenu(): void {
  chrome.contextMenus.remove(selectionMenuId, () => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create(
      {
        id: selectionMenuId,
        title: "翻译选中文本",
        contexts: ["selection"],
      },
      () => {
        void chrome.runtime.lastError;
      },
    );
  });
}

chrome.runtime.onInstalled.addListener(registerSelectionContextMenu);
async function handleSelectionMenuClick(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> {
  if (info.menuItemId !== selectionMenuId || typeof info.selectionText !== "string" || info.editable || (info.frameId !== undefined && info.frameId !== 0) || tab?.id === undefined) return;
  const checked = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: selectionIntersectsDefaultExcludedContent, args: [DEFAULT_EXCLUDED_CONTENT_SELECTOR] });
  if (checked[0]?.result !== false) return;
  await translateSelectedText(tab.id, info.selectionText);
}
function dispatchSelectionMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
): void {
  void handleSelectionMenuClick(info, tab).catch(() => {});
}
chrome.contextMenus.onClicked.addListener(dispatchSelectionMenuClick);
chrome.tabs.onRemoved.addListener((tabId) => {
  translationStateByTab.delete(tabId);
});
Object.assign(globalThis, {
  betterImmersiveBackground: {
    dispatchSelectionMenuClick,
    handleSelectionMenuClick,
  },
});

async function automaticallyTranslateCompletedPage(
  tabId: number,
  url: string,
): Promise<void> {
  const access = websiteAccess(url);
  if (!access) return;
  const override = await loadWebsiteOverride(access.origin);
  if (!override.automaticTranslation) return;
  const permitted = await chrome.permissions.contains({
    origins: [access.permissionPattern],
  });
  if (!permitted) return;
  await enqueueTranslation(tabId, () => translateCurrentPage(tabId));
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;
  void refreshSelectionTranslationForTab(tabId).catch(() => {});
  void automaticallyTranslateCompletedPage(tabId, tab.url).catch(() => {});
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (
    isRecord(message) &&
    message.kind === "sync-selection-translation"
  ) {
    void syncAndRefreshSelectionTranslationTabs().then(
      () => safelySendResponse(sendResponse, { kind: "complete" }),
      () => safelySendResponse(sendResponse, { kind: "failed" }),
    );
    return true;
  }
  if (isRecord(message) && message.kind === "open-options") {
    void chrome.runtime.openOptionsPage().then(
      () => safelySendResponse(sendResponse, { kind: "complete" }),
      () => safelySendResponse(sendResponse, { kind: "failed" }),
    );
    return true;
  }
  if (
    isRecord(message) &&
    message.kind === "refresh-selection-translation" &&
    typeof message.tabId === "number"
  ) {
    const tabId = message.tabId;
    void syncSelectionTranslationContentScript()
      .then(() => refreshSelectionTranslationForTab(tabId))
      .then(
        () => safelySendResponse(sendResponse, { kind: "complete" }),
        () => safelySendResponse(sendResponse, { kind: "failed" }),
      );
    return true;
  }
  if (
    isRecord(message) &&
    message.kind === "translate-selection" &&
    typeof message.selectionText === "string" &&
    sender.tab?.id !== undefined
  ) {
    void selectionTranslationResult(
      sender.tab.id,
      message.selectionText,
    ).then(
      (response) => safelySendResponse(sendResponse, response),
      () =>
        safelySendResponse(sendResponse, {
          kind: "failed",
          failureKind: "extension",
        }),
    );
    return true;
  }
  if (isRecord(message) && message.kind === "translate-current-page" && typeof message.tabId === "number") {
    const tabId = message.tabId;
    void enqueueTranslation(tabId, () => translateCurrentPage(tabId)).then(
      () => safelySendResponse(sendResponse, { kind: "complete" }),
      () => safelySendResponse(sendResponse, { kind: "failed" }),
    );
    return true;
  }
  if (isRecord(message) && message.kind === "translate-incremental-blocks" && Array.isArray(message.blocks) && message.blocks.every(isSemanticTextBlock) && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    const blocks = message.blocks;
    mergePendingIncrementalBlocks(tabId, blocks);
    void scheduleIncrementalTranslation(tabId).then(
      () => safelySendResponse(sendResponse, { kind: "complete" }),
      () => safelySendResponse(sendResponse, { kind: "failed" }),
    );
    return true;
  }
  if (isRecord(message) && message.kind === "retry-translation-batch" && typeof message.batchIndex === "number" && Array.isArray(message.blocks) && message.blocks.every(isSemanticTextBlock) && typeof message.targetLanguage === "string" && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    const batchIndex = message.batchIndex;
    const blocks = message.blocks;
    const targetLanguage = message.targetLanguage;
    void enqueueTranslation(tabId, async () => {
      const recovered = await runTranslationBatch(tabId, batchIndex, {
        blocks,
        targetLanguage,
      }, (await resolveTranslationPreferences(sender.tab?.url)).instructions, 0);
      if (recovered) {
        const state = translationState(tabId);
        state.failedBatchCount = Math.max(0, state.failedBatchCount - 1);
        void scheduleIncrementalTranslation(tabId).catch(() => {});
      }
    }).then(
      () => safelySendResponse(sendResponse, { kind: "complete" }),
      () => safelySendResponse(sendResponse, { kind: "failed" }),
    );
    return true;
  }
  if (isRecord(message) && message.kind === "set-reading-mode" && typeof message.tabId === "number" && isReadingMode(message.mode)) {
    void setReadingMode(message.tabId, message.mode).then(
      () => safelySendResponse(sendResponse, { kind: "complete" }),
      () => safelySendResponse(sendResponse, { kind: "failed" }),
    );
    return true;
  }
  return false;
});
