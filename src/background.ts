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
  type ReadingMode,
  type SemanticTextBlock,
  type Translation,
} from "./page-translation.js";
import {
  findCachedTranslations,
  storeTranslations,
  type TranslationCacheContext,
} from "./translation-cache.js";

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
