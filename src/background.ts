import { loadLlmConfigurations } from "./llm-configuration.js";
import {
  collectBasicSemanticTextBlocks,
  insertBilingualTranslations,
  type SemanticTextBlock,
  type Translation,
} from "./page-translation.js";

interface ChatCompletion {
  choices: Array<{ message: { content: string } }>;
}

function chatCompletionsUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/chat/completions`;
}

async function translateBlocks(
  blocks: SemanticTextBlock[],
  targetLanguage: string,
): Promise<Translation[]> {
  const [configuration] = await loadLlmConfigurations();
  if (!configuration) {
    return [];
  }

  const headers = new Headers(configuration.customHeaders);
  headers.set("Authorization", `Bearer ${configuration.apiKey}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(chatCompletionsUrl(configuration.endpoint), {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...configuration.requestParameters,
      model: configuration.model,
      messages: [
        {
          role: "system",
          content:
            "Translate the supplied semantic text blocks. Return JSON only, preserving every block id.",
        },
        {
          role: "user",
          content: JSON.stringify({
            sourceLanguage: "auto",
            targetLanguage,
            blocks,
          }),
        },
      ],
    }),
  });
  const completion = (await response.json()) as ChatCompletion;
  const content = completion.choices[0]?.message.content ?? "{}";
  const result = JSON.parse(content) as { translations?: Translation[] };
  return result.translations ?? [];
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

    return false;
  },
);
