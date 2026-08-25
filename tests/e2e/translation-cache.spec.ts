import { expect, test } from "@playwright/test";
import {
  createTranslationCacheIdentity,
  findCachedTranslations,
  storeTranslations,
  type TranslationCacheContext,
} from "../../src/translation-cache";
import type { LlmConfiguration } from "../../src/llm-configuration";

const configuration: LlmConfiguration = {
  id: "configuration-1",
  name: "Primary",
  endpoint: "https://example.test/v1",
  apiKey: "secret",
  model: "translation-model",
  requestParameters: { temperature: 0.2, response_format: { type: "json" } },
  customHeaders: { "X-Tenant": "one" },
};

const context: TranslationCacheContext = {
  configuration,
  sourceLanguage: "auto",
  targetLanguage: "zh-CN",
  instructions: {
    prompt: "Translate the supplied semantic text blocks.",
    terminologyRules: [],
  },
};

test("缓存身份随翻译条件变化并忽略对象键顺序", async () => {
  const original = await createTranslationCacheIdentity(
    "Hello world.",
    context,
  );
  const sameConditions = await createTranslationCacheIdentity("Hello world.", {
    ...context,
    configuration: {
      ...configuration,
      endpoint: "https://example.test/v1/",
      requestParameters: {
        messages: "overridden before the request",
        model: "also-overridden",
        response_format: { type: "json" },
        temperature: 0.2,
      },
      customHeaders: {
        authorization: "overridden before the request",
        "content-type": "also-overridden",
        "x-tenant": "one",
      },
    },
  });
  expect(sameConditions).toBe(original);

  const changedConditions: TranslationCacheContext[] = [
    {
      ...context,
      configuration: { ...configuration, apiKey: "changed-secret" },
    },
    {
      ...context,
      configuration: { ...configuration, model: "changed-model" },
    },
    {
      ...context,
      configuration: {
        ...configuration,
        requestParameters: { ...configuration.requestParameters, top_p: 0.8 },
      },
    },
    { ...context, sourceLanguage: "en" },
    { ...context, targetLanguage: "ja" },
    {
      ...context,
      instructions: { ...context.instructions, prompt: "Use a formal style." },
    },
    {
      ...context,
      instructions: {
        ...context.instructions,
        terminologyRules: [{ source: "cache", target: "缓存" }],
      },
    },
  ];

  const changedIdentities = await Promise.all(
    changedConditions.map((changedContext) =>
      createTranslationCacheIdentity("Hello world.", changedContext),
    ),
  );
  expect(new Set(changedIdentities)).not.toContain(original);
});

test("并发翻译任务不会互相覆盖本地缓存记录", async () => {
  const stored: Record<string, unknown> = {};
  const originalChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      storage: {
        local: {
          async get(keys: string | string[] | null) {
            const snapshot = { ...stored };
            await Promise.resolve();
            if (keys === null) {
              return snapshot;
            }
            const selectedKeys = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(
              selectedKeys
                .filter((key) => key in snapshot)
                .map((key) => [key, snapshot[key]]),
            );
          },
          async set(entries: Record<string, unknown>) {
            Object.assign(stored, entries);
          },
          async remove(keys: string | string[]) {
            for (const key of Array.isArray(keys) ? keys : [keys]) {
              delete stored[key];
            }
          },
        },
      },
    },
  });

  try {
    const firstBlock = { id: "block-0", text: "Hello world." };
    const secondBlock = { id: "block-1", text: "Good night." };
    await Promise.all([
      storeTranslations(
        [firstBlock],
        [{ id: firstBlock.id, text: "你好，世界。" }],
        context,
      ),
      storeTranslations(
        [secondBlock],
        [{ id: secondBlock.id, text: "晚安。" }],
        context,
      ),
    ]);

    await expect(
      findCachedTranslations([firstBlock, secondBlock], context),
    ).resolves.toEqual({
      cachedTranslations: [
        { id: "block-0", text: "你好，世界。" },
        { id: "block-1", text: "晚安。" },
      ],
      uncachedBlocks: [],
    });

    const wordBlock = { id: "word", text: "serendipity" };
    const phoneticContext = { ...context, includePhonetics: true };
    await storeTranslations(
      [wordBlock],
      [
        {
          id: wordBlock.id,
          text: "意外发现美好事物的能力",
          phonetic: "/ˌserənˈdɪpəti/",
        },
      ],
      phoneticContext,
    );
    await expect(
      findCachedTranslations([wordBlock], phoneticContext),
    ).resolves.toEqual({
      cachedTranslations: [
        {
          id: "word",
          text: "意外发现美好事物的能力",
          phonetic: "/ˌserənˈdɪpəti/",
        },
      ],
      uncachedBlocks: [],
    });

    const wordWithoutTrustedPhonetic = { id: "word-2", text: "coding" };
    await storeTranslations(
      [wordWithoutTrustedPhonetic],
      [{ id: wordWithoutTrustedPhonetic.id, text: "编程", phonetic: "" }],
      phoneticContext,
    );
    await expect(
      findCachedTranslations([wordWithoutTrustedPhonetic], phoneticContext),
    ).resolves.toEqual({
      cachedTranslations: [
        { id: "word-2", text: "编程", phonetic: "" },
      ],
      uncachedBlocks: [],
    });
  } finally {
    if (originalChrome) {
      Object.defineProperty(globalThis, "chrome", originalChrome);
    } else {
      Reflect.deleteProperty(globalThis, "chrome");
    }
  }
});
