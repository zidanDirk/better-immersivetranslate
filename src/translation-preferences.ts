export interface GlobalTranslationPreferences {
  targetLanguage: string;
  selectionTranslationEnabled: boolean;
}

export interface TargetLanguageOption {
  label: string;
  value: string;
}

export const DEFAULT_TARGET_LANGUAGE = "zh-CN";

export const TARGET_LANGUAGE_OPTIONS: readonly TargetLanguageOption[] = [
  { label: "中文（简体）", value: "zh-CN" },
  { label: "中文（繁体）", value: "zh-TW" },
  { label: "英语", value: "en" },
  { label: "日语", value: "ja" },
  { label: "韩语", value: "ko" },
  { label: "法语", value: "fr" },
  { label: "德语", value: "de" },
  { label: "西班牙语", value: "es" },
  { label: "葡萄牙语", value: "pt" },
  { label: "意大利语", value: "it" },
  { label: "俄语", value: "ru" },
];

const storageKey = "globalTranslationPreferences";

export async function loadGlobalTranslationPreferences(): Promise<GlobalTranslationPreferences> {
  const stored = await chrome.storage.local.get(storageKey);
  const preferences = stored[storageKey] as
    | GlobalTranslationPreferences
    | undefined;
  const storedTargetLanguage = preferences?.targetLanguage;
  return {
    targetLanguage:
      typeof storedTargetLanguage === "string" && storedTargetLanguage.trim()
        ? storedTargetLanguage.trim()
        : DEFAULT_TARGET_LANGUAGE,
    selectionTranslationEnabled:
      preferences?.selectionTranslationEnabled ?? false,
  };
}

export async function saveGlobalTranslationPreferences(
  preferences: GlobalTranslationPreferences,
): Promise<void> {
  await chrome.storage.local.set({ [storageKey]: preferences });
}
