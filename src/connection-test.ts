import type { LlmConfiguration } from "./llm-configuration.js";

export type ConnectionTestResult =
  | { kind: "success" }
  | { kind: "authentication" }
  | { kind: "network" }
  | { kind: "cors" }
  | { kind: "incompatible-response" }
  | { kind: "http"; status: number }
  | { kind: "invalid-configuration" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpenAiChatCompletion(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    return false;
  }

  const firstChoice = value.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    return false;
  }

  return typeof firstChoice.message.content === "string";
}

function buildChatCompletionsUrl(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("LLM 配置只支持 HTTP(S) 服务地址");
  }
  return `${url.toString().replace(/\/+$/, "")}/chat/completions`;
}

async function canReachChatCompletions(url: string): Promise<boolean> {
  try {
    await fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
      signal: AbortSignal.timeout(2_000),
    });
    return true;
  } catch {
    return false;
  }
}

export async function testLlmConnection(
  configuration: LlmConfiguration,
): Promise<ConnectionTestResult> {
  let url: string;
  let headers: Headers;

  try {
    url = buildChatCompletionsUrl(configuration.endpoint);
    headers = new Headers(configuration.customHeaders);
    headers.set("Authorization", `Bearer ${configuration.apiKey}`);
    headers.set("Content-Type", "application/json");
  } catch {
    return { kind: "invalid-configuration" };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...configuration.requestParameters,
        model: configuration.model,
        messages: [{ role: "user", content: "Reply with OK." }],
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return (await canReachChatCompletions(url))
      ? { kind: "cors" }
      : { kind: "network" };
  }

  if (response.status === 401 || response.status === 403) {
    return { kind: "authentication" };
  }
  if (!response.ok) {
    return { kind: "http", status: response.status };
  }

  try {
    const payload: unknown = await response.json();
    return isOpenAiChatCompletion(payload)
      ? { kind: "success" }
      : { kind: "incompatible-response" };
  } catch {
    return { kind: "incompatible-response" };
  }
}
