export interface SemanticTextBlock {
  id: string;
  text: string;
}

export interface Translation {
  id: string;
  text: string;
}

export function selectionIntersectsDefaultExcludedContent(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return true;
  }

  const excludedSelector = [
    "input",
    "textarea",
    "select",
    "[contenteditable]:not([contenteditable='false'])",
    "pre",
    "code",
    "kbd",
    "samp",
    "[role='log']",
    "[translate='no']",
    ".notranslate",
    "[data-better-immersive-translate='no']",
  ].join(",");
  const range = selection.getRangeAt(0);
  return Array.from(document.querySelectorAll(excludedSelector)).some(
    (element) => range.intersectsNode(element),
  );
}

export function showSelectedTextTranslation(
  sourceText: string,
  translatedText: string,
  targetLanguage: string,
): void {
  document
    .querySelector("[data-better-immersive-selection-result]")
    ?.remove();

  const panel = document.createElement("aside");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "选中文本翻译结果");
  panel.setAttribute("aria-live", "polite");
  panel.dataset.betterImmersiveSelectionResult = "";
  Object.assign(panel.style, {
    background: "#ffffff",
    border: "1px solid #d0d7de",
    borderRadius: "8px",
    bottom: "16px",
    boxShadow: "0 8px 24px rgba(140, 149, 159, 0.2)",
    color: "#1f2328",
    font: "14px/1.5 system-ui, sans-serif",
    maxWidth: "min(420px, calc(100vw - 32px))",
    padding: "16px",
    position: "fixed",
    right: "16px",
    whiteSpace: "pre-wrap",
    zIndex: "2147483647",
  });

  const source = document.createElement("p");
  source.textContent = sourceText;
  source.style.margin = "0 0 8px";

  const translation = document.createElement("p");
  translation.lang = targetLanguage;
  translation.textContent = translatedText;
  translation.style.margin = "0";

  panel.append(source, translation);
  document.body.append(panel);
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
