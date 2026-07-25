export interface SemanticTextBlock {
  id: string;
  text: string;
}

export interface Translation {
  id: string;
  text: string;
}

export type ReadingMode = "bilingual" | "translation-only" | "original-only";

export const DEFAULT_EXCLUDED_CONTENT_SELECTOR = [
  "input",
  "textarea",
  "select",
  "option",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  "pre",
  "code",
  "kbd",
  "samp",
  ".command-line",
  ".terminal",
  "[data-command-line]",
  '[role="log"]',
  ".log",
  "[data-log]",
  '[translate="no" i]',
  ".notranslate",
  "[data-no-translate]",
  "[data-better-immersive-no-translate]",
].join(",");

export const READING_MODE_PRESERVED_CONTENT_SELECTOR = [
  DEFAULT_EXCLUDED_CONTENT_SELECTOR,
  "a[href]",
  "button",
  '[role="button"]',
  "[tabindex]",
  "[data-better-immersive-block-id]",
].join(",");

export function isReadingMode(value: unknown): value is ReadingMode {
  return (
    value === "bilingual" ||
    value === "translation-only" ||
    value === "original-only"
  );
}

export function collectTranslatableSemanticTextBlocks(
  excludedContentSelector: string,
): SemanticTextBlock[] {
  const semanticTextBlockSelector =
    "h1, h2, h3, h4, h5, h6, p, li, td, th";

  return Array.from(
    document.querySelectorAll<HTMLElement>(semanticTextBlockSelector),
  )
    .filter((element) => element.closest(excludedContentSelector) === null)
    .filter((element) => {
      const semanticAncestor = element.parentElement?.closest(
        semanticTextBlockSelector,
      );
      return (
        semanticAncestor === null ||
        semanticAncestor === undefined ||
        (element.matches("li") && semanticAncestor.matches("li"))
      );
    })
    .map((element) => {
      const safeContent = element.cloneNode(true) as HTMLElement;
      safeContent
        .querySelectorAll(excludedContentSelector)
        .forEach((excludedElement) => excludedElement.remove());
      if (element.matches("li")) {
        safeContent
          .querySelectorAll("li")
          .forEach((nestedListItem) => nestedListItem.remove());
      }
      return {
        element,
        text: (safeContent.textContent ?? "").replace(/\s+/g, " ").trim(),
      };
    })
    .filter(({ text }) => text.length > 0)
    .map(({ element, text }, index) => {
      const id = `block-${index}`;
      element.dataset.betterImmersiveBlockId = id;
      return { id, text };
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

    const translation = document.createElement("span");
    translation.style.display = "block";
    translation.lang = targetLanguage;
    translation.dataset.betterImmersiveTranslationFor = id;
    translation.textContent = translatedText;
    sourceElement.append(translation);
  });
}

export function applyReadingMode(
  mode: ReadingMode,
  preservedContentSelector: string,
): void {
  document
    .querySelectorAll<HTMLElement>("[data-better-immersive-block-id]")
    .forEach((sourceElement) => {
      const id = sourceElement.dataset.betterImmersiveBlockId ?? "";
      const translation = sourceElement.querySelector<HTMLElement>(
        `:scope > [data-better-immersive-translation-for="${CSS.escape(id)}"]`,
      );
      if (!translation) {
        return;
      }

      const stashedOriginals = Array.from(
        sourceElement.querySelectorAll<HTMLTemplateElement>(
          `:scope > [data-better-immersive-stashed-original-for="${CSS.escape(id)}"]`,
        ),
      );
      if (mode === "translation-only") {
        if (
          sourceElement.dataset.betterImmersiveReadingMode !==
          "translation-only"
        ) {
          Array.from(sourceElement.childNodes)
            .filter((node) => node !== translation)
            .filter(
              (node) =>
                !(node instanceof Element) ||
                (!node.matches(preservedContentSelector) &&
                  node.querySelector(preservedContentSelector) ===
                    null),
            )
            .forEach((node) => {
              const stash = document.createElement("template");
              stash.dataset.betterImmersiveStashedOriginalFor = id;
              sourceElement.insertBefore(stash, node);
              stash.content.append(node);
            });
        }
        sourceElement.dataset.betterImmersiveReadingMode = mode;
        translation.style.display = "block";
        return;
      }

      stashedOriginals.forEach((stashedOriginal) => {
        sourceElement.insertBefore(stashedOriginal.content, stashedOriginal);
        stashedOriginal.remove();
      });
      sourceElement.dataset.betterImmersiveReadingMode = mode;
      translation.style.display = mode === "original-only" ? "none" : "block";
    });
}
