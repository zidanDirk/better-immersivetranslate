import type { LlmConfiguration } from "./llm-configuration.js";
import { requestOpenAiChatCompletion } from "./openai-compatible.js";
import { isRecord } from "./unknown-value.js";

export type ConnectionTestResult =
  | { kind: "success" }
  | { kind: "authentication" }
  | { kind: "network" }
  | { kind: "cors" }
  | { kind: "incompatible-response" }
  | { kind: "http"; status: number }
  | { kind: "invalid-configuration" };

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

export async function testLlmConnection(
  configuration: LlmConfiguration,
): Promise<ConnectionTestResult> {
  const request = await requestOpenAiChatCompletion(configuration, {
    ...configuration.requestParameters,
    model: configuration.model,
    messages: [{ role: "user", content: "Reply with OK." }],
  });
  if (request.kind === "invalid-configuration") {
    return { kind: "invalid-configuration" };
  }
  if (request.kind === "timeout") {
    return { kind: "network" };
  }
  if (request.kind === "fetch-failure") {
    return { kind: request.failureKind };
  }

  const { response } = request;
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
