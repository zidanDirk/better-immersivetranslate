export interface SemanticTextBlock {
  id: string;
  text: string;
  version?: number;
}

export interface Translation {
  id: string;
  text: string;
}

export type TranslationBatchFailureKind = "authentication" | "configuration" | "cors" | "network" | "rate-limit" | "response-format" | "timeout";
export interface RetryTranslationBatch { blocks: SemanticTextBlock[]; targetLanguage: string; }
export type TranslationBatchProgress = { status: "waiting" | "processing" | "complete" } | { status: "failed"; failureKind: TranslationBatchFailureKind; retryBatch: RetryTranslationBatch };

export function initializeTranslationProgress(batchCount: number): void {
  document.querySelector("[data-better-immersive-progress]")?.remove();
  const progress = document.createElement("section");
  progress.dataset.betterImmersiveProgress = "";
  progress.dataset.betterImmersiveNoTranslate = "";
  progress.setAttribute("role", "region");
  progress.setAttribute("aria-label", "翻译进度");
  progress.setAttribute("aria-live", "polite");
  progress.dataset.betterImmersiveBatchStatuses = JSON.stringify(
    Array.from({ length: batchCount }, () => "waiting"),
  );
  Object.assign(progress.style, {
    position: "fixed",
    right: "20px",
    bottom: "20px",
    zIndex: "2147483647",
    minWidth: "220px",
    maxWidth: "360px",
    padding: "14px",
    border: "1px solid #c9d8f6",
    borderRadius: "16px",
    color: "#18346e",
    background: "linear-gradient(135deg, #fafdff, #edf3ff)",
    boxShadow: "0 16px 34px rgb(25 62 136 / 22%)",
    font: "14px/1.45 Avenir Next, PingFang SC, Microsoft YaHei, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  });
  const label = document.createElement("p");
  label.textContent = "TRANSLATING";
  Object.assign(label.style, {
    margin: "0 0 5px",
    color: "#5970aa",
    fontSize: "10px",
    fontWeight: "800",
    letterSpacing: "0.12em",
  });
  const summary = document.createElement("p");
  summary.dataset.betterImmersiveProgressSummary = "";
  Object.assign(summary.style, { margin: "0", fontWeight: "700" });
  const meter = document.createElement("div");
  Object.assign(meter.style, {
    height: "5px",
    marginTop: "10px",
    overflow: "hidden",
    borderRadius: "999px",
    background: "#dbe5fa",
  });
  const meterFill = document.createElement("div");
  meterFill.dataset.betterImmersiveProgressMeter = "";
  Object.assign(meterFill.style, {
    width: "0%",
    height: "100%",
    borderRadius: "inherit",
    background: "linear-gradient(90deg, #286ae2, #5b8ff0 68%, #ffd45a)",
    transition: "width 180ms ease",
  });
  meter.append(meterFill);
  progress.append(label, summary, meter);
  const failures = document.createElement("div");
  failures.dataset.betterImmersiveProgressFailures = "";
  failures.style.marginTop = "8px";
  progress.append(failures);
  document.body.append(progress);
  summary.textContent = "正在翻译：已经完成 0%";
}

export function updateTranslationBatchProgress(batchIndex: number, progress: TranslationBatchProgress): void {
  const readStoredBatchStatuses = (container: HTMLElement): Array<
    "waiting" | "processing" | "complete" | "failed"
  > => {
    try {
      const statuses = JSON.parse(
        container.dataset.betterImmersiveBatchStatuses ?? "[]",
      ) as unknown;
      return Array.isArray(statuses) && statuses.every(
        (status) =>
          status === "waiting" ||
          status === "processing" ||
          status === "complete" ||
          status === "failed",
      )
        ? statuses
        : [];
    } catch {
      return [];
    }
  };
  const container = document.querySelector<HTMLElement>(
    "[data-better-immersive-progress]",
  );
  if (!container) return;
  const statuses = readStoredBatchStatuses(container);
  if (batchIndex < 0 || batchIndex >= statuses.length) return;
  statuses[batchIndex] = progress.status;
  container.dataset.betterImmersiveBatchStatuses = JSON.stringify(statuses);
  const failures = container.querySelector<HTMLElement>(
    "[data-better-immersive-progress-failures]",
  );
  failures?.querySelector(
    `[data-better-immersive-failed-batch="${batchIndex}"]`,
  )?.remove();
  if (progress.status === "failed") {
    if (!failures) return;
    const batch = document.createElement("div");
    batch.dataset.betterImmersiveFailedBatch = String(batchIndex);
    batch.style.marginTop = "6px";
    const labels: Record<TranslationBatchFailureKind, string> = {
      authentication: "认证失败：请检查 API Key",
      configuration: "配置失败：请先添加 LLM 配置",
      cors: "CORS 失败：服务未允许浏览器跨域请求",
      network: "网络失败：无法连接到服务地址",
      "rate-limit": "请求受限：请稍后手动重试",
      "response-format": "响应格式错误：服务未返回有效译文",
      timeout: "请求超时：请手动重试",
    };
    batch.textContent = `批次 ${batchIndex + 1}：${labels[progress.failureKind]}`;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = `重试批次 ${batchIndex + 1}`;
    Object.assign(retry.style, {
      marginLeft: "8px",
      border: "1px solid #2563eb",
      borderRadius: "6px",
      padding: "3px 7px",
      color: "#fff",
      background: "#2563eb",
      cursor: "pointer",
    });
    retry.addEventListener("click", () => { retry.disabled = true; void chrome.runtime.sendMessage({ kind: "retry-translation-batch", batchIndex, blocks: progress.retryBatch.blocks, targetLanguage: progress.retryBatch.targetLanguage }); });
    batch.append(" ", retry);
    failures.append(batch);
  }
  const completed = statuses.filter((status) => status === "complete").length;
  const failed = statuses.filter((status) => status === "failed").length;
  const completedPercentage = Math.round((completed / statuses.length) * 100);
  const meter = container.querySelector<HTMLElement>(
    "[data-better-immersive-progress-meter]",
  );
  if (meter) {
    meter.style.width = `${((completed + failed) / statuses.length) * 100}%`;
  }
  const summary = container.querySelector<HTMLElement>(
    "[data-better-immersive-progress-summary]",
  );
  if (!summary) return;
  if (completed === statuses.length && failed === 0) {
    container.remove();
    return;
  }
  summary.textContent = failed > 0
    ? `翻译进度：已经完成 ${completedPercentage}%，失败 ${failed} 批次`
    : `正在翻译：已经完成 ${completedPercentage}%`;
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
  observeChanges = false,
): SemanticTextBlock[] {
  const semanticTextBlockSelector =
    "h1, h2, h3, h4, h5, h6, p, li, td, th";

  const collectCandidates = (): Array<{
    element: HTMLElement;
    text: string;
  }> =>
    Array.from(
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
          .querySelectorAll<HTMLTemplateElement>(
            "[data-better-immersive-stashed-original-for]",
          )
          .forEach((stashedOriginal) => {
            stashedOriginal.replaceWith(
              stashedOriginal.content.cloneNode(true),
            );
          });
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
      });

  const elementsWithBlockIds = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-better-immersive-block-id]",
    ),
  );
  const blockOwnerById = new Map<string, HTMLElement>();
  elementsWithBlockIds.forEach((element) => {
    const id = element.dataset.betterImmersiveBlockId;
    if (id && !blockOwnerById.has(id)) {
      blockOwnerById.set(id, element);
    }
  });
  let nextBlockIndex = elementsWithBlockIds.reduce((nextIndex, element) => {
    const match = /^block-(\d+)$/.exec(
      element.dataset.betterImmersiveBlockId ?? "",
    );
    return Math.max(nextIndex, Number(match?.[1] ?? -1) + 1);
  }, 0);
  const observedTextByElement = new WeakMap<HTMLElement, string>();
  const observedElements = new Set<HTMLElement>();
  const removeRenderedTranslation = (element: HTMLElement): void => {
    element
      .querySelectorAll<HTMLElement>(
        ":scope > [data-better-immersive-translation-for]",
      )
      .forEach((translation) => translation.remove());
  };
  const advanceBlockVersion = (element: HTMLElement): number => {
    const currentVersion = Number(
      element.dataset.betterImmersiveBlockVersion ?? -1,
    );
    const version = Number.isInteger(currentVersion) ? currentVersion + 1 : 0;
    element.dataset.betterImmersiveBlockVersion = String(version);
    return version;
  };
  const collectChangedBlocks = (): SemanticTextBlock[] => {
    const candidates = collectCandidates();
    const candidateElements = new Set(
      candidates.map(({ element }) => element),
    );
    observedElements.forEach((element) => {
      if (candidateElements.has(element)) {
        return;
      }
      removeRenderedTranslation(element);
      if (element.dataset.betterImmersiveBlockId) {
        advanceBlockVersion(element);
      }
      observedTextByElement.delete(element);
      observedElements.delete(element);
    });

    const changedBlocks: SemanticTextBlock[] = [];
    candidates.forEach(({ element, text }) => {
      const previousText = observedTextByElement.get(element);
      if (previousText === text || (previousText === undefined && text === "")) {
        return;
      }
      removeRenderedTranslation(element);
      observedTextByElement.set(element, text);
      observedElements.add(element);

        let id = element.dataset.betterImmersiveBlockId;
        if (id && !/^block-\d+$/.test(id)) {
          id = undefined;
          delete element.dataset.betterImmersiveBlockId;
          delete element.dataset.betterImmersiveBlockVersion;
        }
        const currentOwner = id ? blockOwnerById.get(id) : undefined;
        if (
          id &&
          currentOwner !== undefined &&
          currentOwner !== element &&
          currentOwner.isConnected
        ) {
          id = undefined;
          delete element.dataset.betterImmersiveBlockId;
          delete element.dataset.betterImmersiveBlockVersion;
        }
        if (!id) {
          id = `block-${nextBlockIndex}`;
          nextBlockIndex += 1;
          element.dataset.betterImmersiveBlockId = id;
        }
        blockOwnerById.set(id, element);
        const version = advanceBlockVersion(element);
        element.dataset.betterImmersiveBlockId = id;
        if (text !== "") {
          changedBlocks.push({ id, text, version });
        }
    });
    return changedBlocks;
  };

  const initialBlocks = collectChangedBlocks();
  if (!observeChanges) {
    return initialBlocks;
  }

  const observerState = window as typeof window & {
    betterImmersiveIncrementalObserver?: MutationObserver;
  };
  observerState.betterImmersiveIncrementalObserver?.disconnect();
  let pendingCollection: number | undefined;
  const observer = new MutationObserver(() => {
    window.clearTimeout(pendingCollection);
    pendingCollection = window.setTimeout(() => {
      const changedBlocks = collectChangedBlocks();
      if (changedBlocks.length > 0) {
        void chrome.runtime
          .sendMessage({
            kind: "translate-incremental-blocks",
            blocks: changedBlocks,
          })
          .catch(() => {});
      }
    }, 75);
  });
  observer.observe(document.body, {
    characterData: true,
    childList: true,
    subtree: true,
  });
  observerState.betterImmersiveIncrementalObserver = observer;

  return initialBlocks;
}

export function selectionIntersectsDefaultExcludedContent(
  excludedContentSelector: string,
): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return true;
  }

  const range = selection.getRangeAt(0);
  return Array.from(
    document.querySelectorAll(excludedContentSelector),
  ).some((element) => range.intersectsNode(element));
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

export function insertBilingualTranslations(
  translations: Translation[],
  targetLanguage: string,
  translatedBlocks: SemanticTextBlock[] = [],
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
  const translatedVersionsById = new Map(
    translatedBlocks.map((block) => [block.id, block.version]),
  );

  sourceElementsById.forEach((sourceElement, id) => {
    const translatedText = translationsById.get(id);
    if (translatedText === undefined) {
      return;
    }
    const translatedVersion = translatedVersionsById.get(id);
    if (
      translatedVersion !== undefined &&
      sourceElement.dataset.betterImmersiveBlockVersion !==
        String(translatedVersion)
    ) {
      return;
    }

    sourceElement
      .querySelectorAll<HTMLElement>(
        ":scope > [data-better-immersive-translation-for]",
      )
      .forEach((existingTranslation) => existingTranslation.remove());
    const translation = document.createElement("span");
    translation.style.display = "block";
    translation.lang = targetLanguage;
    translation.dataset.betterImmersiveTranslationFor = id;
    translation.dataset.betterImmersiveNoTranslate = "";
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
