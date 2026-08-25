export interface LlmConfiguration {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
  modelPresetId?: string | null;
  requestParameters: Record<string, unknown>;
  customHeaders: Record<string, string>;
}

const storageKey = "llmConfigurations";
const selectedConfigurationStorageKey = "selectedLlmConfigurationId";

interface StoredLlmConfigurationState {
  configurations: LlmConfiguration[];
  selectedConfigurationId?: string;
}

async function loadStoredLlmConfigurationState(): Promise<StoredLlmConfigurationState> {
  const stored = await chrome.storage.local.get([
    storageKey,
    selectedConfigurationStorageKey,
  ]);
  return {
    configurations:
      (stored[storageKey] as LlmConfiguration[] | undefined) ?? [],
    selectedConfigurationId:
      typeof stored[selectedConfigurationStorageKey] === "string"
        ? stored[selectedConfigurationStorageKey]
        : undefined,
  };
}

function selectedConfigurationFromState(
  state: StoredLlmConfigurationState,
): LlmConfiguration | undefined {
  return (
    state.configurations.find(
      ({ id }) => id === state.selectedConfigurationId,
    ) ?? state.configurations[0]
  );
}

export async function loadLlmConfigurations(): Promise<LlmConfiguration[]> {
  return (await loadStoredLlmConfigurationState()).configurations;
}

export async function loadSelectedLlmConfiguration(): Promise<
  LlmConfiguration | undefined
> {
  return selectedConfigurationFromState(
    await loadStoredLlmConfigurationState(),
  );
}

export async function saveLlmConfiguration(
  configuration: LlmConfiguration,
): Promise<void> {
  const state = await loadStoredLlmConfigurationState();
  const { configurations } = state;
  const exists = configurations.some(
    (existing) => existing.id === configuration.id,
  );
  const nextConfigurations = exists
    ? configurations.map((existing) =>
        existing.id === configuration.id ? configuration : existing,
      )
    : [...configurations, configuration];
  const selectedConfiguration = selectedConfigurationFromState({
    ...state,
    configurations: nextConfigurations,
  });

  await chrome.storage.local.set({
    [storageKey]: nextConfigurations,
    [selectedConfigurationStorageKey]: selectedConfiguration?.id ?? null,
  });
}

export async function selectLlmConfiguration(id: string): Promise<void> {
  const configurations = await loadLlmConfigurations();
  if (!configurations.some((configuration) => configuration.id === id)) {
    throw new RangeError("无法选择不存在的 LLM 配置");
  }
  await chrome.storage.local.set({ [selectedConfigurationStorageKey]: id });
}

export async function removeLlmConfiguration(id: string): Promise<void> {
  const state = await loadStoredLlmConfigurationState();
  const configurations = state.configurations.filter(
    (configuration) => configuration.id !== id,
  );
  const selectedConfiguration = selectedConfigurationFromState({
    configurations,
    selectedConfigurationId:
      state.selectedConfigurationId === id
        ? undefined
        : state.selectedConfigurationId,
  });
  await chrome.storage.local.set({
    [storageKey]: configurations,
    [selectedConfigurationStorageKey]: selectedConfiguration?.id ?? null,
  });
}
