import { loadLlmConfigurations } from "./llm-configuration.js";
import { requestOpenAiChatCompletion } from "./openai-compatible.js";
import {
  type SemanticTextBlock,
  type Translation,
  type TranslationBatchFailureKind,
} from "./page-translation.js";
import { isRecord } from "./unknown-value.js";
import {
  findCachedTranslations,
  storeTranslations,
  type TranslationCacheContext,
} from "./translation-cache.js";
import {
  createTranslationSystemMessage,
  loadTranslationInstructions,
  type TranslationInstructions,
} from "./translation-instructions.js";

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
  suppliedInstructions?: TranslationInstructions,
): Promise<TranslationBatchResult> {
  const [configuration] = await loadLlmConfigurations();
  if (!configuration) {
    return failed("configuration");
  }
  const instructions =
    suppliedInstructions ?? (await loadTranslationInstructions());
  const cacheContext: TranslationCacheContext = {
    configuration,
    sourceLanguage: "auto",
    targetLanguage,
    instructions,
  };
  const { cachedTranslations, uncachedBlocks } =
    await findCachedTranslations(blocks, cacheContext);
  if (uncachedBlocks.length === 0) {
    return { kind: "complete", translations: cachedTranslations };
  }

  const request = await requestOpenAiChatCompletion(configuration, {
    ...configuration.requestParameters,
    model: configuration.model,
    messages: [
      {
        role: "system",
        content: createTranslationSystemMessage(instructions),
      },
      {
        role: "user",
        content: JSON.stringify({
          sourceLanguage: "auto",
          targetLanguage,
          blocks: uncachedBlocks.map(({ id, text }) => ({ id, text })),
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
  const translations = readTranslations(completion, uncachedBlocks);
  if (!translations) return failed("response-format");
  await storeTranslations(uncachedBlocks, translations, cacheContext);
  return { kind: "complete", translations: [...cachedTranslations, ...translations] };
}
