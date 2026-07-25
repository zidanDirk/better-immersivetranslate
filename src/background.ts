import {
  applyReadingMode,
  collectTranslatableSemanticTextBlocks,
  DEFAULT_EXCLUDED_CONTENT_SELECTOR,
  initializeTranslationProgress,
  insertBilingualTranslations,
  isReadingMode,
  READING_MODE_PRESERVED_CONTENT_SELECTOR,
  selectionIntersectsDefaultExcludedContent,
  showSelectedTextTranslation,
  updateTranslationBatchProgress,
  type ReadingMode,
  type RetryTranslationBatch,
  type SemanticTextBlock,
} from "./page-translation.js";
import { translateSemanticTextBatch } from "./translation-provider.js";
import { isRecord } from "./unknown-value.js";
import {
  loadWebsiteOverride,
  resolveTranslationPreferences,
  websiteAccess,
} from "./website-overrides.js";
import type { TranslationInstructions } from "./translation-instructions.js";

const selectionMenuId = "translate-selected-text";
const translationBatchSize = 10;

function isSemanticTextBlock(value: unknown): value is SemanticTextBlock {
  return isRecord(value) && typeof value.id === "string" && typeof value.text === "string";
}

async function runTranslationBatch(
  tabId: number,
  batchIndex: number,
  retryBatch: RetryTranslationBatch,
  instructions: TranslationInstructions,
): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, func: updateTranslationBatchProgress, args: [batchIndex, { status: "processing" }] });
  const result = await translateSemanticTextBatch(
    retryBatch.blocks,
    retryBatch.targetLanguage,
    instructions,
  );
  if (result.kind === "failed") {
    await chrome.scripting.executeScript({ target: { tabId }, func: updateTranslationBatchProgress, args: [batchIndex, { status: "failed", failureKind: result.failureKind, retryBatch }] });
    return;
  }
  await chrome.scripting.executeScript({ target: { tabId }, func: insertBilingualTranslations, args: [result.translations, retryBatch.targetLanguage] });
  await chrome.scripting.executeScript({ target: { tabId }, func: updateTranslationBatchProgress, args: [batchIndex, { status: "complete" }] });
}

async function translateCurrentPage(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const preferences = await resolveTranslationPreferences(tab.url);
  const extraction = await chrome.scripting.executeScript({ target: { tabId }, func: collectTranslatableSemanticTextBlocks, args: [DEFAULT_EXCLUDED_CONTENT_SELECTOR] });
  const blocks = (extraction[0]?.result ?? []) as SemanticTextBlock[];
  if (blocks.length === 0) return;
  const batches = Array.from({ length: Math.ceil(blocks.length / translationBatchSize) }, (_, index) => blocks.slice(index * translationBatchSize, (index + 1) * translationBatchSize));
  await chrome.scripting.executeScript({ target: { tabId }, func: initializeTranslationProgress, args: [batches.length] });
  for (const [batchIndex, batch] of batches.entries()) {
    await runTranslationBatch(
      tabId,
      batchIndex,
      { blocks: batch, targetLanguage: preferences.targetLanguage },
      preferences.instructions,
    );
  }
}

async function setReadingMode(tabId: number, mode: ReadingMode): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, func: applyReadingMode, args: [mode, READING_MODE_PRESERVED_CONTENT_SELECTOR] });
}

async function translateSelectedText(tabId: number, selectionText: string): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const preferences = await resolveTranslationPreferences(tab.url);
  const result = await translateSemanticTextBatch(
    [{ id: "selected-text", text: selectionText }],
    preferences.targetLanguage,
    preferences.instructions,
  );
  if (result.kind !== "complete" || !result.translations[0]) return;
  await chrome.scripting.executeScript({ target: { tabId }, func: showSelectedTextTranslation, args: [selectionText, result.translations[0].text, preferences.targetLanguage] });
}

chrome.runtime.onInstalled.addListener(() => chrome.contextMenus.create({ id: selectionMenuId, title: "翻译选中文本", contexts: ["selection"] }));
async function handleSelectionMenuClick(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> {
  if (info.menuItemId !== selectionMenuId || typeof info.selectionText !== "string" || info.editable || (info.frameId !== undefined && info.frameId !== 0) || tab?.id === undefined) return;
  const checked = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: selectionIntersectsDefaultExcludedContent, args: [DEFAULT_EXCLUDED_CONTENT_SELECTOR] });
  if (checked[0]?.result !== false) return;
  await translateSelectedText(tab.id, info.selectionText);
}
chrome.contextMenus.onClicked.addListener(handleSelectionMenuClick);
Object.assign(globalThis, { betterImmersiveBackground: { handleSelectionMenuClick } });

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
  await translateCurrentPage(tabId);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;
  void automaticallyTranslateCompletedPage(tabId, tab.url);
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isRecord(message) && message.kind === "translate-current-page" && typeof message.tabId === "number") {
    void translateCurrentPage(message.tabId).then(() => sendResponse({ kind: "complete" }), () => sendResponse({ kind: "failed" }));
    return true;
  }
  if (isRecord(message) && message.kind === "retry-translation-batch" && typeof message.batchIndex === "number" && Array.isArray(message.blocks) && message.blocks.every(isSemanticTextBlock) && typeof message.targetLanguage === "string" && sender.tab?.id !== undefined) {
    void resolveTranslationPreferences(sender.tab.url)
      .then((preferences) =>
        runTranslationBatch(
          sender.tab!.id!,
          message.batchIndex as number,
          {
            blocks: message.blocks as SemanticTextBlock[],
            targetLanguage: message.targetLanguage as string,
          },
          preferences.instructions,
        ),
      )
      .then(() => sendResponse({ kind: "complete" }), () => sendResponse({ kind: "failed" }));
    return true;
  }
  if (isRecord(message) && message.kind === "set-reading-mode" && typeof message.tabId === "number" && isReadingMode(message.mode)) {
    void setReadingMode(message.tabId, message.mode).then(() => sendResponse({ kind: "complete" }), () => sendResponse({ kind: "failed" }));
    return true;
  }
  return false;
});
