import { loadLlmConfigurations } from "./llm-configuration.js";
import { requestOpenAiChatCompletion } from "./openai-compatible.js";
import {
  type SemanticTextBlock,
  type Translation,
  type TranslationBatchFailureKind,
} from "./page-translation.js";
import { isRecord } from "./unknown-value.js";

export type TranslationBatchResult =
  | { kind: "complete"; translations: Translation[] }
  | { kind: "failed"; failureKind: TranslationBatchFailureKind };

function failed(
  failureKind: TranslationBatchFailureKind,
): TranslationBatchResult {
  return { kind: "failed", failureKind };
}

function isTranslation(value: unknown): value is Translation {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.text === "string"
  );
}

function readTranslations(
  completion: unknown,
  blocks: SemanticTextBlock[],
): Translation[] | null {
  if (!isRecord(completion) || !Array.isArray(completion.choices)) {
    return null;
  }
  const firstChoice = completion.choices[0];
  if (
    !isRecord(firstChoice) ||
    !isRecord(firstChoice.message) ||
    typeof firstChoice.message.content !== "string"
  ) {
    return null;
  }

  let result: unknown;
  try {
    result = JSON.parse(firstChoice.message.content) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(result) || !Array.isArray(result.translations)) {
    return null;
  }

  const translations = result.translations;
  const expectedIds = new Set(blocks.map((block) => block.id));
  if (
    translations.length !== blocks.length ||
    !translations.every(isTranslation) ||
    translations.some((translation) => !expectedIds.delete(translation.id)) ||
    expectedIds.size !== 0
  ) {
    return null;
  }
  return translations;
}

export async function translateSemanticTextBatch(
  blocks: SemanticTextBlock[],
  targetLanguage: string,
): Promise<TranslationBatchResult> {
  const [configuration] = await loadLlmConfigurations();
  if (!configuration) {
    return failed("configuration");
  }

  const request = await requestOpenAiChatCompletion(configuration, {
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
  });
  if (request.kind === "invalid-configuration") {
    return failed("configuration");
  }
  if (request.kind === "timeout") {
    return failed("timeout");
  }
  if (request.kind === "fetch-failure") {
    return failed(request.failureKind);
  }

  const { response } = request;
  if (response.status === 401 || response.status === 403) {
    return failed("authentication");
  }
  if (response.status === 429) {
    return failed("rate-limit");
  }
  if (!response.ok) {
    return failed("response-format");
  }

  let completion: unknown;
  try {
    completion = await response.json();
  } catch {
    return failed("response-format");
  }
  const translations = readTranslations(completion, blocks);
  return translations
    ? { kind: "complete", translations }
    : failed("response-format");
}
