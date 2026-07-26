import {
  loadTranslationInstructions,
  type TranslationInstructions,
} from "./translation-instructions.js";
import { loadGlobalTranslationPreferences } from "./translation-preferences.js";

export interface WebsiteOverride {
  origin: string;
  targetLanguage: string;
  translationPrompt: string;
  automaticTranslation: boolean;
  selectionTranslation: "inherit" | "enabled" | "disabled";
}

export interface EffectiveTranslationPreferences {
  targetLanguage: string;
  instructions: TranslationInstructions;
}

const storageKey = "websiteOverrides";

export interface WebsiteAccess {
  origin: string;
  permissionPattern: string;
}

export function websiteAccess(url: string): WebsiteAccess | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return {
      origin: parsed.origin,
      permissionPattern: `${parsed.protocol}//${parsed.hostname}/*`,
    };
  } catch {
    return null;
  }
}

export async function loadWebsiteOverrides(): Promise<
  Record<string, WebsiteOverride>
> {
  const stored = await chrome.storage.local.get(storageKey);
  return (
    (stored[storageKey] as Record<string, WebsiteOverride> | undefined) ?? {}
  );
}

export async function selectionTranslationRegistration(): Promise<{
  excludeMatches: string[];
  matches: string[];
}> {
  const [overrides, globalPreferences] = await Promise.all([
    loadWebsiteOverrides(),
    loadGlobalTranslationPreferences(),
  ]);
  if (globalPreferences.selectionTranslationEnabled) {
    return {
      matches: ["http://*/*", "https://*/*"],
      excludeMatches: Object.values(overrides)
        .filter(({ selectionTranslation }) => selectionTranslation === "disabled")
        .map(({ origin }) => websiteAccess(origin)?.permissionPattern)
        .filter((pattern): pattern is string => Boolean(pattern)),
    };
  }
  return {
    matches: Object.values(overrides)
      .filter(({ selectionTranslation }) => selectionTranslation === "enabled")
      .map(({ origin }) => websiteAccess(origin)?.permissionPattern)
      .filter((pattern): pattern is string => Boolean(pattern)),
    excludeMatches: [],
  };
}

export async function resolveSelectionTranslationEnabled(
  url?: string,
): Promise<boolean> {
  const globalPreferences = await loadGlobalTranslationPreferences();
  const access = url ? websiteAccess(url) : null;
  if (!access) return false;
  const override = await loadWebsiteOverride(access.origin);
  if (override.selectionTranslation === "enabled") return true;
  if (override.selectionTranslation === "disabled") return false;
  return globalPreferences.selectionTranslationEnabled;
}

export async function loadWebsiteOverride(
  origin: string,
): Promise<WebsiteOverride> {
  const overrides = await loadWebsiteOverrides();
  const override = overrides[origin];
  return override
    ? {
        ...override,
        selectionTranslation: override.selectionTranslation ?? "inherit",
      }
    : {
      origin,
      targetLanguage: "",
      translationPrompt: "",
      automaticTranslation: false,
      selectionTranslation: "inherit",
    };
}

export async function saveWebsiteOverride(
  override: WebsiteOverride,
): Promise<void> {
  const overrides = await loadWebsiteOverrides();
  await chrome.storage.local.set({
    [storageKey]: {
      ...overrides,
      [override.origin]: override,
    },
  });
}

export async function isWebsitePermissionStillNeeded(
  permissionPattern: string,
): Promise<boolean> {
  const overrides = await loadWebsiteOverrides();
  return Object.values(overrides).some((override) => {
    if (
      !override.automaticTranslation &&
      override.selectionTranslation !== "enabled"
    ) {
      return false;
    }
    return (
      websiteAccess(override.origin)?.permissionPattern === permissionPattern
    );
  });
}

export async function resolveTranslationPreferences(
  url?: string,
): Promise<EffectiveTranslationPreferences> {
  const [globalPreferences, globalInstructions] = await Promise.all([
    loadGlobalTranslationPreferences(),
    loadTranslationInstructions(),
  ]);
  const access = url ? websiteAccess(url) : null;
  const websiteOverride = access
    ? await loadWebsiteOverride(access.origin)
    : undefined;
  return {
    targetLanguage:
      websiteOverride?.targetLanguage ||
      globalPreferences.targetLanguage ||
      chrome.i18n.getUILanguage(),
    instructions: {
      ...globalInstructions,
      prompt:
        websiteOverride?.translationPrompt || globalInstructions.prompt,
    },
  };
}
