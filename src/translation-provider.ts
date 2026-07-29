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
import {
  createTranslationAttemptDiagnostic,
  type TranslationAttemptDiagnostic,
} from "./translation-diagnostics.js";

export type TranslationBatchResult =
  | { kind: "complete"; translations: Translation[] }
  | {
      kind: "failed";
      failureKind: TranslationBatchFailureKind;
      diagnostic?: TranslationAttemptDiagnostic;
    };

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
  captureDiagnostics = false,
): Promise<TranslationBatchResult> {
  const startedAt = new Date().toISOString();
  const startedAtMilliseconds = performance.now();
  const [configuration] = await loadLlmConfigurations();
  if (!configuration) {
    return {
      kind: "failed",
      failureKind: "configuration",
      ...(captureDiagnostics
        ? {
            diagnostic: await createTranslationAttemptDiagnostic({
              durationMs: performance.now() - startedAtMilliseconds,
              failureKind: "configuration",
              startedAt,
            }),
          }
        : {}),
    };
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

  const requestBody = {
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
  };
  const request = await requestOpenAiChatCompletion(
    configuration,
    requestBody,
  );
  const failed = async (
    failureKind: TranslationBatchFailureKind,
    response?: Response,
  ): Promise<TranslationBatchResult> => ({
    kind: "failed",
    failureKind,
    ...(captureDiagnostics
      ? {
          diagnostic: await createTranslationAttemptDiagnostic({
            configuration,
            durationMs: performance.now() - startedAtMilliseconds,
            failureKind,
            requestBody,
            response,
            startedAt,
          }),
        }
      : {}),
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
  const diagnosticResponse = captureDiagnostics
    ? response.clone()
    : undefined;
  if (response.status === 401 || response.status === 403) {
    return failed("authentication", diagnosticResponse);
  }
  if (response.status === 429) {
    return failed("rate-limit", diagnosticResponse);
  }
  if (!response.ok) {
    return failed("response-format", diagnosticResponse);
  }

  let completion: unknown;
  try {
    completion = await response.json();
  } catch {
    return failed(
      request.timeoutSignal.aborted ? "timeout" : "response-format",
      diagnosticResponse,
    );
  }
  const translations = readTranslations(completion, uncachedBlocks);
  if (!translations) return failed("response-format", diagnosticResponse);
  await storeTranslations(uncachedBlocks, translations, cacheContext);
  return { kind: "complete", translations: [...cachedTranslations, ...translations] };
}
