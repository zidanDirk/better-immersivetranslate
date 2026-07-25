export interface SemanticTextBlock {
  id: string;
  text: string;
}

export interface Translation {
  id: string;
  text: string;
}

export type TranslationBatchFailureKind =
  | "authentication"
  | "configuration"
  | "cors"
  | "network"
  | "rate-limit"
  | "response-format"
  | "timeout";

export interface RetryTranslationBatch {
  blocks: SemanticTextBlock[];
  targetLanguage: string;
}

export type TranslationBatchProgress =
  | { status: "waiting" }
  | { status: "processing" }
  | { status: "complete" }
  | {
      status: "failed";
      failureKind: TranslationBatchFailureKind;
      retryBatch: RetryTranslationBatch;
    };

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

export function initializeTranslationProgress(batchCount: number): void {
  document.querySelector("[data-better-immersive-progress]")?.remove();

  const progress = document.createElement("section");
  progress.dataset.betterImmersiveProgress = "";
  progress.setAttribute("role", "region");
  progress.setAttribute("aria-label", "翻译进度");
  progress.setAttribute("aria-live", "polite");

  const title = document.createElement("h2");
  title.textContent = "翻译进度";
  const batches = document.createElement("ol");
  for (let index = 0; index < batchCount; index += 1) {
    const batch = document.createElement("li");
    batch.dataset.betterImmersiveBatch = String(index);
    batch.dataset.betterImmersiveBatchStatus = "waiting";
    batch.textContent = `批次 ${index + 1}：等待中`;
    batches.append(batch);
  }

  progress.append(title, batches);
  document.body.prepend(progress);
}

export function updateTranslationBatchProgress(
  batchIndex: number,
  progress: TranslationBatchProgress,
): void {
  const batch = document.querySelector<HTMLElement>(
    `[data-better-immersive-batch="${batchIndex}"]`,
  );
  if (!batch) {
    return;
  }

  const statusLabels = {
    waiting: "等待中",
    processing: "处理中",
    complete: "已完成",
  } as const;
  const failureLabels: Record<TranslationBatchFailureKind, string> = {
    authentication: "认证失败：请检查 API Key",
    configuration: "配置失败：请先添加 LLM 配置",
    cors: "CORS 失败：服务未允许浏览器跨域请求",
    network: "网络失败：无法连接到服务地址",
    "rate-limit": "请求受限：请稍后手动重试",
    "response-format": "响应格式错误：服务未返回有效译文",
    timeout: "请求超时：请手动重试",
  };
  const statusLabel =
    progress.status === "failed"
      ? failureLabels[progress.failureKind]
      : statusLabels[progress.status];
  batch.dataset.betterImmersiveBatchStatus = progress.status;
  batch.textContent = `批次 ${batchIndex + 1}：${statusLabel}`;

  if (progress.status === "failed") {
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.textContent = `重试批次 ${batchIndex + 1}`;
    retryButton.addEventListener("click", () => {
      retryButton.disabled = true;
      void chrome.runtime.sendMessage({
        kind: "retry-translation-batch",
        batchIndex,
        blocks: progress.retryBatch.blocks,
        targetLanguage: progress.retryBatch.targetLanguage,
      });
    });
    batch.append(" ", retryButton);
  }
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
