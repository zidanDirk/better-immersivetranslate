export interface GlobalTranslationPreferences {
  targetLanguage: string;
}

const storageKey = "globalTranslationPreferences";

export async function loadGlobalTranslationPreferences(): Promise<GlobalTranslationPreferences> {
  const stored = await chrome.storage.local.get(storageKey);
  const preferences = stored[storageKey] as
    | GlobalTranslationPreferences
    | undefined;
  return {
    targetLanguage: preferences?.targetLanguage ?? "",
  };
}

export async function saveGlobalTranslationPreferences(
  preferences: GlobalTranslationPreferences,
): Promise<void> {
  await chrome.storage.local.set({ [storageKey]: preferences });
}
