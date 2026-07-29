export type LlmModelPresetTier = "balanced" | "economy";

export interface LlmModelPreset {
  id: string;
  provider: string;
  displayName: string;
  model: string;
  tier: LlmModelPresetTier;
  endpoint: string;
  requestParameters: Record<string, unknown>;
  endpointHint?: string;
}

const jsonObjectRequestParameters = {
  response_format: { type: "json_object" },
} as const;

function jsonObjectParameters(
  additionalParameters: Record<string, unknown> = {},
): Record<string, unknown> {
  return structuredClone({
    ...jsonObjectRequestParameters,
    ...additionalParameters,
  });
}

export const llmModelPresets: readonly LlmModelPreset[] = [
  {
    id: "openai-gpt-5-6-terra",
    provider: "OpenAI",
    displayName: "GPT-5.6 Terra",
    model: "gpt-5.6-terra",
    tier: "balanced",
    endpoint: "https://api.openai.com/v1",
    requestParameters: jsonObjectParameters(),
  },
  {
    id: "openai-gpt-5-6-luna",
    provider: "OpenAI",
    displayName: "GPT-5.6 Luna",
    model: "gpt-5.6-luna",
    tier: "economy",
    endpoint: "https://api.openai.com/v1",
    requestParameters: jsonObjectParameters(),
  },
  {
    id: "anthropic-claude-sonnet-5",
    provider: "Claude",
    displayName: "Claude Sonnet 5",
    model: "claude-sonnet-5",
    tier: "balanced",
    endpoint: "https://api.anthropic.com/v1",
    requestParameters: {},
  },
  {
    id: "anthropic-claude-haiku-4-5",
    provider: "Claude",
    displayName: "Claude Haiku 4.5",
    model: "claude-haiku-4-5-20251001",
    tier: "economy",
    endpoint: "https://api.anthropic.com/v1",
    requestParameters: {},
  },
  {
    id: "google-gemini-3-6-flash",
    provider: "Gemini",
    displayName: "Gemini 3.6 Flash",
    model: "gemini-3.6-flash",
    tier: "balanced",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    requestParameters: jsonObjectParameters(),
  },
  {
    id: "google-gemini-3-5-flash-lite",
    provider: "Gemini",
    displayName: "Gemini 3.5 Flash-Lite",
    model: "gemini-3.5-flash-lite",
    tier: "economy",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    requestParameters: jsonObjectParameters(),
  },
  {
    id: "deepseek-v4-pro",
    provider: "DeepSeek",
    displayName: "DeepSeek V4 Pro",
    model: "deepseek-v4-pro",
    tier: "balanced",
    endpoint: "https://api.deepseek.com",
    requestParameters: jsonObjectParameters({
      thinking: { type: "disabled" },
    }),
  },
  {
    id: "deepseek-v4-flash",
    provider: "DeepSeek",
    displayName: "DeepSeek V4 Flash",
    model: "deepseek-v4-flash",
    tier: "economy",
    endpoint: "https://api.deepseek.com",
    requestParameters: jsonObjectParameters({
      thinking: { type: "disabled" },
    }),
  },
  {
    id: "qwen-3-7-plus",
    provider: "Qwen",
    displayName: "Qwen 3.7 Plus",
    model: "qwen3.7-plus",
    tier: "balanced",
    endpoint:
      "https://YOUR-WORKSPACE-ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    requestParameters: jsonObjectParameters(),
    endpointHint:
      "请将 YOUR-WORKSPACE-ID 替换为百炼业务空间 ID；非北京地域还需替换地域地址。",
  },
  {
    id: "qwen-3-6-flash",
    provider: "Qwen",
    displayName: "Qwen 3.6 Flash",
    model: "qwen3.6-flash",
    tier: "economy",
    endpoint:
      "https://YOUR-WORKSPACE-ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    requestParameters: jsonObjectParameters(),
    endpointHint:
      "请将 YOUR-WORKSPACE-ID 替换为百炼业务空间 ID；非北京地域还需替换地域地址。",
  },
  {
    id: "kimi-k2-6",
    provider: "Kimi",
    displayName: "Kimi K2.6",
    model: "kimi-k2.6",
    tier: "balanced",
    endpoint: "https://api.moonshot.cn/v1",
    requestParameters: jsonObjectParameters(),
  },
  {
    id: "moonshot-v1-8k",
    provider: "Kimi",
    displayName: "Moonshot V1 8K",
    model: "moonshot-v1-8k",
    tier: "economy",
    endpoint: "https://api.moonshot.cn/v1",
    requestParameters: jsonObjectParameters(),
  },
  {
    id: "zhipu-glm-5-2",
    provider: "GLM",
    displayName: "GLM-5.2",
    model: "glm-5.2",
    tier: "balanced",
    endpoint: "https://open.bigmodel.cn/api/paas/v4",
    requestParameters: jsonObjectParameters(),
  },
  {
    id: "zhipu-glm-4-7-flash",
    provider: "GLM",
    displayName: "GLM-4.7 Flash",
    model: "glm-4.7-flash",
    tier: "economy",
    endpoint: "https://open.bigmodel.cn/api/paas/v4",
    requestParameters: jsonObjectParameters(),
  },
];

export function findLlmModelPreset(
  id: string | null | undefined,
): LlmModelPreset | undefined {
  return llmModelPresets.find((preset) => preset.id === id);
}

export function findLlmModelPresetByModel(
  model: string,
): LlmModelPreset | undefined {
  return llmModelPresets.find((preset) => preset.model === model);
}

export function llmModelPresetTierLabel(
  tier: LlmModelPresetTier,
): string {
  return tier === "balanced" ? "均衡推荐" : "经济快速";
}
