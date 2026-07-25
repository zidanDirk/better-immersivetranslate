import {
  collectBasicSemanticTextBlocks,
  initializeTranslationProgress,
  insertBilingualTranslations,
  updateTranslationBatchProgress,
  type RetryTranslationBatch,
  type SemanticTextBlock,
} from "./page-translation.js";
import { translateSemanticTextBatch } from "./translation-provider.js";
import { isRecord } from "./unknown-value.js";

const translationBatchSize = 10;

function isSemanticTextBlock(value: unknown): value is SemanticTextBlock {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.text === "string"
  );
}

async function runTranslationBatch(
  tabId: number,
  batchIndex: number,
  retryBatch: RetryTranslationBatch,
): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: updateTranslationBatchProgress,
    args: [batchIndex, { status: "processing" }],
  });

  const result = await translateSemanticTextBatch(
    retryBatch.blocks,
    retryBatch.targetLanguage,
  );
  if (result.kind === "failed") {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: updateTranslationBatchProgress,
      args: [
        batchIndex,
        {
          status: "failed",
          failureKind: result.failureKind,
          retryBatch,
        },
      ],
    });
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    func: insertBilingualTranslations,
    args: [result.translations, retryBatch.targetLanguage],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: updateTranslationBatchProgress,
    args: [batchIndex, { status: "complete" }],
  });
}

async function translateCurrentPage(tabId: number): Promise<void> {
  const extraction = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectBasicSemanticTextBlocks,
  });
  const blocks = (extraction[0]?.result ?? []) as SemanticTextBlock[];
  if (blocks.length === 0) {
    return;
  }

  const batches: SemanticTextBlock[][] = [];
  for (let index = 0; index < blocks.length; index += translationBatchSize) {
    batches.push(blocks.slice(index, index + translationBatchSize));
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    func: initializeTranslationProgress,
    args: [batches.length],
  });

  const targetLanguage = chrome.i18n.getUILanguage();
  for (const [batchIndex, batch] of batches.entries()) {
    await runTranslationBatch(tabId, batchIndex, {
      blocks: batch,
      targetLanguage,
    });
  }
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (
      isRecord(message) &&
      message.kind === "translate-current-page" &&
      typeof message.tabId === "number"
    ) {
      void translateCurrentPage(message.tabId).then(
        () => sendResponse({ kind: "complete" }),
        () => sendResponse({ kind: "failed" }),
      );
      return true;
    }

    if (
      isRecord(message) &&
      message.kind === "retry-translation-batch" &&
      typeof message.batchIndex === "number" &&
      Array.isArray(message.blocks) &&
      message.blocks.every(isSemanticTextBlock) &&
      typeof message.targetLanguage === "string" &&
      sender.tab?.id !== undefined
    ) {
      void runTranslationBatch(sender.tab.id, message.batchIndex, {
        blocks: message.blocks,
        targetLanguage: message.targetLanguage,
      }).then(
        () => sendResponse({ kind: "complete" }),
        () => sendResponse({ kind: "failed" }),
      );
      return true;
    }

    return false;
  },
);
