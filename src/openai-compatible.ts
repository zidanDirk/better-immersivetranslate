import type { LlmConfiguration } from "./llm-configuration.js";
import { llmResponseTimeoutMilliseconds } from "./llm-request.js";

export type ProviderFetchFailureKind = "cors" | "network";

export type OpenAiRequestResult =
  | {
      kind: "response";
      response: Response;
      timeoutSignal: AbortSignal;
    }
  | { kind: "timeout" }
  | { kind: "fetch-failure"; failureKind: ProviderFetchFailureKind }
  | { kind: "invalid-configuration" };

export function chatCompletionsUrl(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("LLM 配置只支持 HTTP(S) 服务地址");
  }
  return `${url.toString().replace(/\/+$/, "")}/chat/completions`;
}

export async function classifyProviderFetchFailure(
  url: string,
): Promise<ProviderFetchFailureKind> {
  try {
    await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    return "network";
  } catch {
    // A failed CORS check still needs a reachability probe.
  }

  try {
    await fetch(new URL(url).origin, {
      method: "HEAD",
      mode: "no-cors",
      signal: AbortSignal.timeout(2_000),
    });
    return "cors";
  } catch {
    return "network";
  }
}

export async function requestOpenAiChatCompletion(
  configuration: LlmConfiguration,
  body: Record<string, unknown>,
): Promise<OpenAiRequestResult> {
  let headers: Headers;
  let url: string;
  try {
    headers = new Headers(configuration.customHeaders);
    headers.set("Authorization", `Bearer ${configuration.apiKey}`);
    headers.set("Content-Type", "application/json");
    url = chatCompletionsUrl(configuration.endpoint);
  } catch {
    return { kind: "invalid-configuration" };
  }

  try {
    const timeoutSignal = AbortSignal.timeout(
      llmResponseTimeoutMilliseconds,
    );
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: timeoutSignal,
    });
    return { kind: "response", response, timeoutSignal };
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return { kind: "timeout" };
    }
    return {
      kind: "fetch-failure",
      failureKind: await classifyProviderFetchFailure(url),
    };
  }
}
