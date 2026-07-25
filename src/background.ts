import { loadLlmConfigurations } from "./llm-configuration.js";
import {
  chatCompletionsUrl,
  createLlmRequestHeaders,
  effectiveRequestParameters,
} from "./llm-request.js";
import {
  applyReadingMode,
  collectTranslatableSemanticTextBlocks,
  DEFAULT_EXCLUDED_CONTENT_SELECTOR,
  insertBilingualTranslations,
  isReadingMode,
  READING_MODE_PRESERVED_CONTENT_SELECTOR,
  selectionIntersectsDefaultExcludedContent,
  showSelectedTextTranslation,
  type ReadingMode,
  type SemanticTextBlock,
  type Translation,
} from "./page-translation.js";
import {
  findCachedTranslations,
  storeTranslations,
  type TranslationCacheContext,
} from "./translation-cache.js";

const selectionMenuId = "translate-selected-text";

interface ChatCompletion {
  choices: Array<{ message: { content: string } }>;
}

const translationInstructions = {
  prompt:
    "Translate the supplied semantic text blocks. Return JSON only, preserving every block id.",
  terminologyRules: [],
} as const;

async function translateBlocks(
  blocks: SemanticTextBlock[],
  targetLanguage: string,
): Promise<Translation[]> {
  const [configuration] = await loadLlmConfigurations();
  if (!configuration) {
    return [];
  }

  const cacheContext: TranslationCacheContext = {
    configuration,
    sourceLanguage: "auto",
    targetLanguage,
    instructions: translationInstructions,
  };
  const { cachedTranslations, uncachedBlocks } =
    await findCachedTranslations(blocks, cacheContext);
  if (uncachedBlocks.length === 0) {
    return cachedTranslations;
  }

  const response = await fetch(chatCompletionsUrl(configuration.endpoint), {
    method: "POST",
    headers: createLlmRequestHeaders(configuration),
    body: JSON.stringify({
      ...effectiveRequestParameters(configuration.requestParameters),
      model: configuration.model,
      messages: [
        {
          role: "system",
          content: translationInstructions.prompt,
        },
        {
          role: "user",
          content: JSON.stringify({
            sourceLanguage: cacheContext.sourceLanguage,
            targetLanguage,
            blocks: uncachedBlocks,
          }),
        },
      ],
    }),
  });
  const completion = (await response.json()) as ChatCompletion;
  const content = completion.choices[0]?.message.content ?? "{}";
  const result = JSON.parse(content) as { translations?: Translation[] };
  const translations = result.translations ?? [];
  await storeTranslations(uncachedBlocks, translations, cacheContext);
  return [...cachedTranslations, ...translations];
}

async function translateCurrentPage(tabId: number): Promise<void> {
  const extraction = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectTranslatableSemanticTextBlocks,
    args: [DEFAULT_EXCLUDED_CONTENT_SELECTOR],
  });
  const blocks = (extraction[0]?.result ?? []) as SemanticTextBlock[];
  if (blocks.length === 0) {
    return;
  }

  const translations = await translateBlocks(
    blocks,
    chrome.i18n.getUILanguage(),
  );
  await chrome.scripting.executeScript({
    target: { tabId },
    func: insertBilingualTranslations,
    args: [translations, chrome.i18n.getUILanguage()],
  });
}

async function setReadingMode(
  tabId: number,
  mode: ReadingMode,
): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: applyReadingMode,
    args: [mode, READING_MODE_PRESERVED_CONTENT_SELECTOR],
  });
}

async function translateSelectedText(
  tabId: number,
  selectionText: string,
): Promise<void> {
  const targetLanguage = chrome.i18n.getUILanguage();
  const [translation] = await translateBlocks(
    [{ id: "selected-text", text: selectionText }],
    targetLanguage,
  );
  if (!translation) {
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    func: showSelectedTextTranslation,
    args: [selectionText, translation.text, targetLanguage],
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: selectionMenuId,
    title: "翻译选中文本",
    contexts: ["selection"],
  });
});

async function handleSelectionMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
): Promise<void> {
  if (
    info.menuItemId !== selectionMenuId ||
    typeof info.selectionText !== "string" ||
    info.editable === true ||
    (info.frameId !== undefined && info.frameId !== 0) ||
    tab?.id === undefined
  ) {
    return;
  }

  const selectionCheck = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: selectionIntersectsDefaultExcludedContent,
    args: [DEFAULT_EXCLUDED_CONTENT_SELECTOR],
  });
  if (selectionCheck[0]?.result !== false) {
    return;
  }

  await translateSelectedText(tab.id, info.selectionText);
}

chrome.contextMenus.onClicked.addListener(handleSelectionMenuClick);
Object.assign(globalThis, {
  betterImmersiveBackground: { handleSelectionMenuClick },
});

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    if (
      typeof message === "object" &&
      message !== null &&
      "kind" in message &&
      message.kind === "translate-current-page" &&
      "tabId" in message &&
      typeof message.tabId === "number"
    ) {
      void translateCurrentPage(message.tabId).then(
        () => sendResponse({ kind: "complete" }),
        () => sendResponse({ kind: "failed" }),
      );
      return true;
    }

    if (
      typeof message === "object" &&
      message !== null &&
      "kind" in message &&
      message.kind === "set-reading-mode" &&
      "tabId" in message &&
      typeof message.tabId === "number" &&
      "mode" in message &&
      isReadingMode(message.mode)
    ) {
      void setReadingMode(message.tabId, message.mode).then(
        () => sendResponse({ kind: "complete" }),
        () => sendResponse({ kind: "failed" }),
      );
      return true;
    }

    return false;
  },
);
