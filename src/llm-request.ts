import type { LlmConfiguration } from "./llm-configuration.js";

export function chatCompletionsUrl(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("LLM 配置只支持 HTTP(S) 服务地址");
  }
  return `${url.toString().replace(/\/+$/, "")}/chat/completions`;
}

export function effectiveRequestParameters(
  requestParameters: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(requestParameters).filter(
      ([key]) => key !== "model" && key !== "messages",
    ),
  );
}

export function createLlmRequestHeaders(
  configuration: LlmConfiguration,
): Headers {
  const headers = new Headers(configuration.customHeaders);
  headers.set("Authorization", `Bearer ${configuration.apiKey}`);
  headers.set("Content-Type", "application/json");
  return headers;
}
