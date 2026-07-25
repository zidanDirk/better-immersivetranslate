export interface LlmConfiguration {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
  requestParameters: Record<string, unknown>;
  customHeaders: Record<string, string>;
}

const storageKey = "llmConfigurations";

export async function loadLlmConfigurations(): Promise<LlmConfiguration[]> {
  const stored = await chrome.storage.local.get(storageKey);
  return (stored[storageKey] as LlmConfiguration[] | undefined) ?? [];
}

export async function saveLlmConfiguration(
  configuration: LlmConfiguration,
): Promise<void> {
  const configurations = await loadLlmConfigurations();
  const exists = configurations.some(
    (existing) => existing.id === configuration.id,
  );

  await chrome.storage.local.set({
    [storageKey]: exists
      ? configurations.map((existing) =>
          existing.id === configuration.id ? configuration : existing,
        )
      : [...configurations, configuration],
  });
}

export async function removeLlmConfiguration(id: string): Promise<void> {
  const configurations = await loadLlmConfigurations();
  await chrome.storage.local.set({
    [storageKey]: configurations.filter(
      (configuration) => configuration.id !== id,
    ),
  });
}
