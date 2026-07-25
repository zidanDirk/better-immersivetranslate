export interface SemanticTextBlock {
  id: string;
  text: string;
}

export interface Translation {
  id: string;
  text: string;
}

export function collectBasicSemanticTextBlocks(): SemanticTextBlock[] {
  return Array.from(document.querySelectorAll("p"))
    .filter((element) => (element.textContent?.trim() ?? "").length > 0)
    .map((element, index) => {
      const id = `block-${index}`;
      element.dataset.betterImmersiveBlockId = id;
      return {
        id,
        text: element.textContent?.trim() ?? "",
      };
    });
}

export function insertBilingualTranslations(
  translations: Translation[],
  targetLanguage: string,
): void {
  const sourceElementsById = new Map(
    Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-better-immersive-block-id]",
      ),
    ).map(
      (element) =>
        [element.dataset.betterImmersiveBlockId ?? "", element] as const,
    ),
  );
  const translationsById = new Map(
    translations.map((translation) => [translation.id, translation.text]),
  );

  sourceElementsById.forEach((sourceElement, id) => {
    const translatedText = translationsById.get(id);
    if (translatedText === undefined) {
      return;
    }

    const translation = document.createElement("p");
    translation.lang = targetLanguage;
    translation.dataset.betterImmersiveTranslationFor = id;
    translation.textContent = translatedText;
    sourceElement.insertAdjacentElement("afterend", translation);
  });
}
