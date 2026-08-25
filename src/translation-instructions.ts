export const DEFAULT_TRANSLATION_PROMPT =
  "Translate each semantic text block accurately and preserve its meaning, tone, and formatting.";

export interface TerminologyRule {
  id: string;
  source: string;
  target: string;
}

export interface TranslationInstructions {
  prompt: string;
  terminologyRules: TerminologyRule[];
}

const storageKey = "translationInstructions";

export async function loadTranslationInstructions(): Promise<TranslationInstructions> {
  const stored = await chrome.storage.local.get(storageKey);
  return (
    (stored[storageKey] as TranslationInstructions | undefined) ?? {
      prompt: DEFAULT_TRANSLATION_PROMPT,
      terminologyRules: [],
    }
  );
}

export async function saveTranslationInstructions(
  instructions: TranslationInstructions,
): Promise<void> {
  await chrome.storage.local.set({ [storageKey]: instructions });
}

export function createTranslationSystemMessage(
  instructions: TranslationInstructions,
  options: { includePhonetics?: boolean } = {},
): string {
  const terminologyInstruction =
    instructions.terminologyRules.length === 0
      ? []
      : [
          "Use these terminology rules exactly when their source text appears:",
          JSON.stringify(
            instructions.terminologyRules.map(({ source, target }) => ({
              source,
              target,
            })),
          ),
        ];

  const responseInstruction = options.includePhonetics
    ? [
        "Each supplied block is a single source word. The sourcePhonetic field is exclusively for the pronunciation of blocks[].text in its original language, written as IPA and wrapped in slashes.",
        "Never put the pronunciation or transliteration of the translated text in sourcePhonetic (including pinyin or romaji). Omit sourcePhonetic when the source-word IPA is uncertain.",
        "Return JSON only with one translation for every supplied stable block id, using the shape " +
          '{"translations":[{"id":"block-id","text":"translated text","sourcePhonetic":"/IPA/"}]}.',
      ]
    : [
        "Return JSON only with one translation for every supplied stable block id, using the shape " +
          '{"translations":[{"id":"block-id","text":"translated text"}]}.',
      ];

  return [
    instructions.prompt,
    ...terminologyInstruction,
    "Preserve semantic formatting in every translated text.",
    ...responseInstruction,
    "Do not add explanations or any text outside the JSON object.",
  ].join("\n\n");
}
