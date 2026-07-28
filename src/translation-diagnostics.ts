import type { LlmConfiguration } from "./llm-configuration.js";
import type {
  SemanticTextBlock,
  TranslationBatchFailureKind,
} from "./page-translation.js";

const translationDiagnosticsEnabledKey = "translationDiagnosticsEnabled";
const translationDiagnosticsStatusKey = "translationDiagnosticsStatus";
const responseBodyLimit = 1024 * 1024;
const responseBodyEdgeLimit = responseBodyLimit / 2;
const sensitiveFieldName =
  /authorization|api[-_]?key|token|secret|password|credential|cookie/i;

export type TranslationDiagnosticSource =
  | "automatic-page"
  | "incremental"
  | "manual-page"
  | "manual-retry";

export interface TranslationDiagnosticTaskContext {
  id: string;
  incognito: boolean;
  page?: {
    title: string;
    url: string;
  };
  relatedTaskId?: string;
  source: TranslationDiagnosticSource;
}

export interface TranslationAttemptDiagnostic {
  configuration?: {
    customHeaderNames: string[];
    endpoint: string;
    model: string;
    name: string;
    requestParameters: unknown;
  };
  durationMs: number;
  failureKind: TranslationBatchFailureKind;
  request?: {
    body: unknown;
  };
  response?: {
    body: CapturedResponseBody;
    headers: Record<string, string>;
    status: number;
    statusText: string;
  };
  startedAt: string;
}

export type TranslationDiagnosticsStatus =
  | {
      at: string;
      directory: string;
      downloadId: number;
      kind: "saved";
    }
  | {
      at: string;
      directory?: string;
      downloadId?: number;
      message: string;
      kind: "failed";
    };

interface CapturedResponseBody {
  byteLength: number;
  captureError?: string;
  head?: string;
  sha256?: string;
  tail?: string;
  text?: string;
  truncated: boolean;
}

interface SaveFailedTranslationBatchInput {
  attempts: TranslationAttemptDiagnostic[];
  batchIndex: number;
  blocks: SemanticTextBlock[];
  failureKind: TranslationBatchFailureKind;
  targetLanguage: string;
  task: TranslationDiagnosticTaskContext;
}

export async function loadTranslationDiagnosticsEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(
    translationDiagnosticsEnabledKey,
  );
  return stored[translationDiagnosticsEnabledKey] === true;
}

export async function saveTranslationDiagnosticsEnabled(
  enabled: boolean,
): Promise<void> {
  await chrome.storage.local.set({
    [translationDiagnosticsEnabledKey]: enabled,
  });
}

export async function loadTranslationDiagnosticsStatus(): Promise<
  TranslationDiagnosticsStatus | undefined
> {
  const stored = await chrome.storage.local.get(
    translationDiagnosticsStatusKey,
  );
  return stored[translationDiagnosticsStatusKey] as
    | TranslationDiagnosticsStatus
    | undefined;
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "[INVALID URL]";
  }
}

function redactSensitiveValues(value: unknown, key?: string): unknown {
  if (key && sensitiveFieldName.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValues(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactSensitiveValues(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

function sanitizedConfiguration(configuration: LlmConfiguration): NonNullable<
  TranslationAttemptDiagnostic["configuration"]
> {
  return {
    customHeaderNames: Object.keys(configuration.customHeaders),
    endpoint: sanitizeUrl(configuration.endpoint),
    model: configuration.model,
    name: configuration.name,
    requestParameters: redactSensitiveValues(
      configuration.requestParameters,
    ),
  };
}

function sanitizedResponseHeaders(headers: Headers): Record<string, string> {
  const sanitized: Record<string, string> = {};
  headers.forEach((value, name) => {
    sanitized[name] = sensitiveFieldName.test(name)
      ? "[REDACTED]"
      : value;
  });
  return sanitized;
}

function appendTail(
  current: Uint8Array,
  incoming: Uint8Array,
): Uint8Array {
  if (incoming.byteLength >= responseBodyEdgeLimit) {
    return incoming.slice(incoming.byteLength - responseBodyEdgeLimit);
  }
  const retainedCurrent = current.slice(
    Math.max(
      0,
      current.byteLength + incoming.byteLength - responseBodyEdgeLimit,
    ),
  );
  const next = new Uint8Array(
    retainedCurrent.byteLength + incoming.byteLength,
  );
  next.set(retainedCurrent);
  next.set(incoming, retainedCurrent.byteLength);
  return next;
}

function joinedBytes(chunks: Uint8Array[], byteLength: number): Uint8Array {
  const joined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

async function sha256(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function captureResponseBody(
  response: Response,
): Promise<CapturedResponseBody> {
  const reader = response.body?.getReader();
  if (!reader) {
    const empty = new Uint8Array();
    return {
      byteLength: 0,
      sha256: await sha256(empty),
      text: "",
      truncated: false,
    };
  }
  const completeChunks: Uint8Array[] = [];
  const head = new Uint8Array(responseBodyEdgeLimit);
  let headLength = 0;
  let tail = new Uint8Array();
  let byteLength = 0;
  let retainCompleteBody = true;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (headLength < responseBodyEdgeLimit) {
      const retained = value.slice(
        0,
        Math.min(value.byteLength, responseBodyEdgeLimit - headLength),
      );
      head.set(retained, headLength);
      headLength += retained.byteLength;
    }
    tail = appendTail(tail, value);
    if (retainCompleteBody) {
      completeChunks.push(value);
      if (byteLength > responseBodyLimit) {
        completeChunks.length = 0;
        retainCompleteBody = false;
      }
    }
  }
  const decoder = new TextDecoder();
  if (byteLength <= responseBodyLimit) {
    const complete = joinedBytes(completeChunks, byteLength);
    return {
      byteLength,
      sha256: await sha256(complete),
      text: decoder.decode(complete),
      truncated: false,
    };
  }
  return {
    byteLength,
    head: decoder.decode(head.slice(0, headLength)),
    tail: decoder.decode(tail),
    truncated: true,
  };
}

export async function createTranslationAttemptDiagnostic(input: {
  configuration?: LlmConfiguration;
  durationMs: number;
  failureKind: TranslationBatchFailureKind;
  requestBody?: Record<string, unknown>;
  response?: Response;
  startedAt: string;
}): Promise<TranslationAttemptDiagnostic> {
  const response = input.response;
  let responseBody: CapturedResponseBody | undefined;
  if (response) {
    try {
      responseBody = await captureResponseBody(response);
    } catch (error) {
      responseBody = {
        byteLength: 0,
        captureError:
          error instanceof Error
            ? `响应正文捕获失败：${error.name}`
            : "响应正文捕获失败",
        truncated: false,
      };
    }
  }
  return {
    ...(input.configuration
      ? { configuration: sanitizedConfiguration(input.configuration) }
      : {}),
    durationMs: input.durationMs,
    failureKind: input.failureKind,
    ...(input.requestBody
      ? {
          request: {
            body: redactSensitiveValues(input.requestBody),
          },
        }
      : {}),
    ...(response
      ? {
          response: {
            body: responseBody!,
            headers: sanitizedResponseHeaders(response.headers),
            status: response.status,
            statusText: response.statusText,
          },
        }
      : {}),
    startedAt: input.startedAt,
  };
}

function diagnosticFilename(
  task: TranslationDiagnosticTaskContext,
  batchIndex: number,
  createdAt: string,
): string {
  let hostname = "unknown-site";
  if (task.page) {
    try {
      hostname = new URL(task.page.url).hostname.replace(
        /[^a-zA-Z0-9.-]/g,
        "-",
      );
    } catch {
      // Keep the non-sensitive fallback.
    }
  }
  const timestamp = createdAt.replaceAll(":", "-");
  return `${timestamp}-${hostname}-task-${task.id.slice(0, 8)}-batch-${String(batchIndex + 1).padStart(3, "0")}.json`;
}

function directoryFromFilename(filename: string): string {
  const separatorIndex = Math.max(
    filename.lastIndexOf("/"),
    filename.lastIndexOf("\\"),
  );
  return separatorIndex >= 0 ? filename.slice(0, separatorIndex + 1) : filename;
}

async function waitForCompletedDownload(
  downloadId: number,
): Promise<chrome.downloads.DownloadItem> {
  for (let pollIndex = 0; pollIndex < 100; pollIndex += 1) {
    const [download] = await chrome.downloads.search({ id: downloadId });
    if (download?.state === "complete") return download;
    if (download?.state === "interrupted") {
      throw new Error(
        download.error
          ? `下载中断：${download.error}`
          : "诊断日志下载中断",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("诊断日志下载超时");
}

async function storeDiagnosticsStatus(
  status: TranslationDiagnosticsStatus,
): Promise<void> {
  await chrome.storage.local.set({
    [translationDiagnosticsStatusKey]: status,
  });
}

export async function saveFailedTranslationBatchDiagnostic(
  input: SaveFailedTranslationBatchInput,
): Promise<{ kind: "saved" } | { kind: "skipped" } | { kind: "failed" }> {
  if (
    input.task.incognito ||
    !(await loadTranslationDiagnosticsEnabled())
  ) {
    return { kind: "skipped" };
  }
  const createdAt = new Date().toISOString();
  try {
    const permitted = await chrome.permissions.contains({
      permissions: ["downloads"],
    });
    if (!permitted) {
      throw new Error("下载权限已被撤销");
    }
    const log = {
      schemaVersion: 1,
      kind: "translation-batch-failure",
      createdAt,
      extensionVersion: chrome.runtime.getManifest().version,
      failureKind: input.failureKind,
      task: {
        id: input.task.id,
        relatedTaskId: input.task.relatedTaskId,
        source: input.task.source,
        page: input.task.page
          ? {
              title: input.task.page.title,
              url: sanitizeUrl(input.task.page.url),
            }
          : undefined,
        batchIndex: input.batchIndex,
        targetLanguage: input.targetLanguage,
        blocks: input.blocks,
      },
      attempts: input.attempts,
    };
    const filename = diagnosticFilename(
      input.task,
      input.batchIndex,
      createdAt,
    );
    const downloadId = await chrome.downloads.download({
      conflictAction: "uniquify",
      filename: `better-immersivetranslate/logs/${filename}`,
      saveAs: false,
      url: `data:application/json;charset=utf-8,${encodeURIComponent(
        `${JSON.stringify(log, null, 2)}\n`,
      )}`,
    });
    const completed = await waitForCompletedDownload(downloadId);
    await storeDiagnosticsStatus({
      at: createdAt,
      directory: directoryFromFilename(completed.filename),
      downloadId,
      kind: "saved",
    });
    return { kind: "saved" };
  } catch (error) {
    const previousStatus = await loadTranslationDiagnosticsStatus();
    await storeDiagnosticsStatus({
      at: createdAt,
      ...(previousStatus?.directory
        ? { directory: previousStatus.directory }
        : {}),
      ...(previousStatus?.downloadId !== undefined
        ? { downloadId: previousStatus.downloadId }
        : {}),
      message: error instanceof Error ? error.message : "未知写入错误",
      kind: "failed",
    });
    return { kind: "failed" };
  }
}
