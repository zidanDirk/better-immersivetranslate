import type { LlmConfiguration } from "./llm-configuration.js";
import {
  chatCompletionsUrl,
  createLlmRequestHeaders,
  effectiveRequestParameters,
  llmResponseTimeoutMilliseconds,
} from "./llm-request.js";

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

function usesJsonObjectResponseFormat(
  requestParameters: Record<string, unknown>,
): boolean {
  const responseFormat = requestParameters.response_format;
  return (
    isRecord(responseFormat) && responseFormat.type === "json_object"
  );
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
    url = chatCompletionsUrl(configuration.endpoint);
    headers = createLlmRequestHeaders(configuration);
  } catch {
    return { kind: "invalid-configuration" };
  }

  let response: Response;
  try {
    const requestParameters = effectiveRequestParameters(
      configuration.requestParameters,
    );
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...requestParameters,
        model: configuration.model,
        messages: [
          {
            role: "user",
            content: usesJsonObjectResponseFormat(requestParameters)
              ? 'Return JSON only: {"status":"ok"}.'
              : "Reply with OK.",
          },
        ],
      }),
      signal: AbortSignal.timeout(llmResponseTimeoutMilliseconds),
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
