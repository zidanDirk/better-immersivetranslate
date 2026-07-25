import type { LlmConfiguration } from "./llm-configuration.js";
import {
  chatCompletionsUrl,
  createLlmRequestHeaders,
  effectiveRequestParameters,
} from "./llm-request.js";
import type {
  SemanticTextBlock,
  Translation,
} from "./page-translation.js";

const storageKeyPrefix = "translationCache:";

export interface TranslationInstructionIdentity {
  prompt: string;
  terminologyRules: readonly unknown[];
}

export interface TranslationCacheContext {
  configuration: LlmConfiguration;
  sourceLanguage: string;
  targetLanguage: string;
  instructions: TranslationInstructionIdentity;
}

interface TranslationCacheLookup {
  cachedTranslations: Translation[];
  uncachedBlocks: SemanticTextBlock[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function effectiveCustomHeaders(
  configuration: LlmConfiguration,
): Record<string, string> {
  const headers = createLlmRequestHeaders(configuration);
  const effectiveHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    effectiveHeaders[key] = value;
  });
  return effectiveHeaders;
}

export async function createTranslationCacheIdentity(
  sourceText: string,
  context: TranslationCacheContext,
): Promise<string> {
  const identity = JSON.stringify(
    canonicalize({
      configuration: {
        id: context.configuration.id,
        requestUrl: chatCompletionsUrl(context.configuration.endpoint),
        model: context.configuration.model,
        requestParameters: effectiveRequestParameters(
          context.configuration.requestParameters,
        ),
        headers: effectiveCustomHeaders(context.configuration),
      },
      sourceLanguage: context.sourceLanguage,
      targetLanguage: context.targetLanguage,
      instructions: context.instructions,
      sourceText,
    }),
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(identity),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function cacheStorageKey(identity: string): string {
  return `${storageKeyPrefix}${identity}`;
}

export async function findCachedTranslations(
  blocks: SemanticTextBlock[],
  context: TranslationCacheContext,
): Promise<TranslationCacheLookup> {
  const identities = await Promise.all(
    blocks.map((block) =>
      createTranslationCacheIdentity(block.text, context),
    ),
  );
  const storageKeys = identities.map(cacheStorageKey);
  const cache = await chrome.storage.local.get(storageKeys);
  const cachedTranslations: Translation[] = [];
  const uncachedBlocks: SemanticTextBlock[] = [];

  blocks.forEach((block, index) => {
    const cachedText = cache[storageKeys[index] ?? ""] as string | undefined;
    if (cachedText === undefined) {
      uncachedBlocks.push(block);
      return;
    }
    cachedTranslations.push({ id: block.id, text: cachedText });
  });

  return { cachedTranslations, uncachedBlocks };
}

export async function storeTranslations(
  blocks: SemanticTextBlock[],
  translations: Translation[],
  context: TranslationCacheContext,
): Promise<void> {
  const translatedTextById = new Map(
    translations.map((translation) => [translation.id, translation.text]),
  );
  const translatedBlocks = blocks.filter((block) =>
    translatedTextById.has(block.id),
  );
  if (translatedBlocks.length === 0) {
    return;
  }

  const identities = await Promise.all(
    translatedBlocks.map((block) =>
      createTranslationCacheIdentity(block.text, context),
    ),
  );
  await chrome.storage.local.set(
    Object.fromEntries(
      translatedBlocks.map((block, index) => [
        cacheStorageKey(identities[index] ?? ""),
        translatedTextById.get(block.id) ?? "",
      ]),
    ),
  );
}

export async function clearTranslationCache(): Promise<void> {
  const stored = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(stored).filter((key) =>
    key.startsWith(storageKeyPrefix),
  );
  if (cacheKeys.length > 0) {
    await chrome.storage.local.remove(cacheKeys);
  }
}
