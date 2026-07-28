import {
  loadLlmConfigurations,
  removeLlmConfiguration,
  saveLlmConfiguration,
  type LlmConfiguration,
} from "./llm-configuration.js";
import {
  findLlmModelPreset,
  findLlmModelPresetByModel,
  llmModelPresets,
  llmModelPresetTierLabel,
  type LlmModelPreset,
} from "./llm-model-presets.js";
import {
  testLlmConnection,
  type ConnectionTestResult,
} from "./connection-test.js";
import { clearTranslationCache } from "./translation-cache.js";
import {
  loadTranslationInstructions,
  saveTranslationInstructions,
  type TerminologyRule,
} from "./translation-instructions.js";
import {
  loadGlobalTranslationPreferences,
  saveGlobalTranslationPreferences,
} from "./translation-preferences.js";
import {
  loadTranslationDiagnosticsEnabled,
  loadTranslationDiagnosticsStatus,
  saveTranslationDiagnosticsEnabled,
} from "./translation-diagnostics.js";
import { runUiTask } from "./ui-task.js";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`设置页面缺少元素：${selector}`);
  }
  return element;
}

const app = requireElement<HTMLElement>("#app");

app.innerHTML = `
  <header class="page-header">
    <div class="header-copy">
      <div class="header-brand">
        <img src="icons/translation-48.png" alt="" />
        <p class="eyebrow">自带 Key（BYOK）</p>
      </div>
      <h1>你的翻译工作台</h1>
      <p class="subtitle">管理用于网页翻译的 OpenAI 兼容服务、语言偏好与固定译法。</p>
    </div>
    <button class="primary" id="add-configuration" type="button">新增 LLM 配置</button>
  </header>
  <p id="options-status" aria-live="polite"></p>
  <aside class="security-notice" aria-labelledby="security-title">
    <div class="security-icon" aria-hidden="true">i</div>
    <div>
      <h2 id="security-title">Key 的存储与安全边界</h2>
      <p>API Key 仅保存在此浏览器的本地存储中，不会上传到运营方服务器。</p>
      <p>浏览器扩展环境无法绝对隐藏 API Key，请只在可信设备上使用。</p>
    </div>
  </aside>
  <section class="translation-diagnostics" aria-labelledby="translation-diagnostics-title">
    <div>
      <h2 id="translation-diagnostics-title">翻译诊断日志</h2>
      <p>最终失败批次的日志可能包含网页原文和模型原始响应，不包含 API Key；无痕窗口不会保存。</p>
      <p>保存位置：<code id="translation-diagnostics-directory">系统下载目录/better-immersivetranslate/logs/</code></p>
      <p id="translation-diagnostics-status" class="diagnostics-status" aria-live="polite"></p>
    </div>
    <div class="diagnostics-actions">
      <label class="diagnostics-toggle">
        <input id="translation-diagnostics-enabled" type="checkbox" />
        <span>保存翻译诊断日志</span>
      </label>
      <button class="secondary" id="show-translation-diagnostics" type="button" hidden>在文件夹中显示</button>
    </div>
  </section>
  <section class="cache-management" aria-labelledby="cache-title">
    <div>
      <h2 id="cache-title">翻译缓存</h2>
      <p>译文仅保存在此浏览器中。清空后，重复内容需要重新调用 LLM。</p>
      <p class="cache-status" id="cache-status" aria-live="polite"></p>
    </div>
    <button class="danger" id="clear-translation-cache" type="button">清空翻译缓存</button>
  </section>
  <section class="global-preferences" aria-labelledby="global-preferences-title">
    <form id="global-target-language-form">
      <h2 id="global-preferences-title">全局翻译偏好</h2>
      <p>未设置时使用浏览器语言。</p>
      <label class="selection-preference">
        <input name="globalSelectionTranslation" type="checkbox" />
        <span>
          <strong>在所有网站启用划词翻译</strong>
          <small>开启时会请求全部普通网站访问权限。</small>
        </span>
      </label>
      <label>
        全局目标语言
        <input name="globalTargetLanguage" placeholder="例如 zh-CN、en 或 ja" autocomplete="off" />
      </label>
      <div class="instruction-actions">
        <p id="global-target-language-status" aria-live="polite"></p>
        <button class="primary" type="submit">保存全局目标语言</button>
      </div>
    </form>
  </section>
  <section class="translation-instructions" aria-labelledby="translation-prompt-title">
    <form id="translation-prompt-form">
      <h2 id="translation-prompt-title">翻译提示词</h2>
      <p>控制所有翻译任务的风格、格式和行为。提示词仅保存在此浏览器中。</p>
      <label>
        全局翻译提示词
        <textarea name="translationPrompt" rows="5" required></textarea>
      </label>
      <div class="instruction-actions">
        <p id="translation-prompt-status" aria-live="polite"></p>
        <button class="primary" type="submit">保存翻译提示词</button>
      </div>
    </form>
    <div class="terminology-header">
      <div>
        <h2 id="terminology-title">术语表</h2>
        <p>为原文术语指定固定译法。术语规则仅保存在此浏览器中。</p>
      </div>
      <button class="secondary" id="add-terminology-rule" type="button">新增术语规则</button>
    </div>
    <div id="terminology-list" aria-live="polite"></div>
    <form id="terminology-form" class="terminology-form" hidden>
      <h3 id="terminology-form-title">新增术语规则</h3>
      <div class="terminology-fields">
        <label>原文术语<input name="terminologySource" autocomplete="off" required /></label>
        <label>固定译法<input name="terminologyTarget" autocomplete="off" required /></label>
      </div>
      <div class="form-actions">
        <button class="secondary" id="cancel-terminology-rule" type="button">取消</button>
        <button class="primary" type="submit">保存术语规则</button>
      </div>
    </form>
  </section>
  <section aria-live="polite" id="configuration-list" class="configuration-list"></section>
  <form id="configuration-form" class="configuration-form" novalidate hidden>
    <div class="configuration-form-heading">
      <div>
        <p class="form-eyebrow">请求路径</p>
        <h2 id="form-title">新增 LLM 配置</h2>
        <p>选择常用模型即可生成一套可编辑的 OpenAI 兼容配置。</p>
      </div>
      <div class="route-preview" aria-live="polite">
        <span id="route-provider">尚未选择模型</span>
        <span aria-hidden="true">→</span>
        <code id="route-host">等待服务地址</code>
      </div>
    </div>
    <div class="form-grid">
      <label>
        <span>名称</span>
        <input name="name" autocomplete="off" required aria-describedby="name-error" />
        <small class="field-error" id="name-error"></small>
      </label>
      <div class="model-field">
        <label for="model-input">模型</label>
        <div class="model-combobox">
          <input
            id="model-input"
            name="model"
            autocomplete="off"
            placeholder="请选择或输入模型"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="model-options"
            aria-expanded="false"
            aria-describedby="model-hint model-error"
            required
          />
          <button id="model-toggle" type="button" aria-label="展开选项" aria-controls="model-options" tabindex="-1">⌄</button>
          <div id="model-options" class="model-options" role="listbox" hidden></div>
        </div>
        <small class="field-hint" id="model-hint">从预设选择会自动填写地址和请求参数；直接输入始终作为自定义模型。</small>
        <small class="field-error" id="model-error"></small>
      </div>
      <label>
        <span>API Key</span>
        <input name="apiKey" type="password" autocomplete="new-password" required aria-describedby="api-key-error" />
        <small class="field-error" id="api-key-error"></small>
      </label>
      <label>
        <span>服务地址</span>
        <input name="endpoint" type="url" placeholder="https://api.example.com/v1" required aria-describedby="endpoint-hint endpoint-error" />
        <small class="field-hint" id="endpoint-hint">填写基础地址，插件会请求其 /chat/completions 路径。</small>
        <small class="field-error" id="endpoint-error"></small>
      </label>
      <details class="advanced-settings wide" open>
        <summary>
          <span>
            <strong>高级设置</strong>
            <small>请求参数与自定义请求头</small>
          </span>
          <span class="customized-badge" id="advanced-customized" hidden>已自定义</span>
        </summary>
        <div class="advanced-fields">
          <label>
            <span>请求参数</span>
            <textarea name="requestParameters" rows="5" aria-describedby="request-parameters-error">{}</textarea>
            <small class="field-error" id="request-parameters-error"></small>
          </label>
          <label>
            <span>自定义请求头</span>
            <textarea name="customHeaders" rows="5" aria-describedby="custom-headers-error">{}</textarea>
            <small class="field-error" id="custom-headers-error"></small>
          </label>
        </div>
      </details>
    </div>
    <div class="preset-actions">
      <button class="text-action" id="restore-preset" type="button" hidden>恢复预设默认值</button>
      <p id="form-connection-status" aria-live="polite"></p>
    </div>
    <div class="form-actions">
      <button class="secondary" id="cancel-configuration" type="button">取消</button>
      <button class="secondary" id="test-configuration" type="button">测试连接</button>
      <button class="primary" type="submit">保存配置</button>
    </div>
  </form>
`;

const list = requireElement<HTMLElement>("#configuration-list");
const optionsStatus = requireElement<HTMLElement>("#options-status");
const form = requireElement<HTMLFormElement>("#configuration-form");
const formTitle = requireElement<HTMLElement>("#form-title");
const addButton = requireElement<HTMLButtonElement>("#add-configuration");
const cancelButton = requireElement<HTMLButtonElement>(
  "#cancel-configuration",
);
const clearCacheButton = requireElement<HTMLButtonElement>(
  "#clear-translation-cache",
);
const cacheStatus = requireElement<HTMLElement>("#cache-status");
const translationDiagnosticsEnabled =
  requireElement<HTMLInputElement>("#translation-diagnostics-enabled");
const translationDiagnosticsStatus =
  requireElement<HTMLElement>("#translation-diagnostics-status");
const translationDiagnosticsDirectory =
  requireElement<HTMLElement>("#translation-diagnostics-directory");
const showTranslationDiagnosticsButton =
  requireElement<HTMLButtonElement>("#show-translation-diagnostics");
const globalTargetLanguageForm = requireElement<HTMLFormElement>(
  "#global-target-language-form",
);
const globalTargetLanguageField = requireElement<HTMLInputElement>(
  '[name="globalTargetLanguage"]',
);
const globalTargetLanguageStatus = requireElement<HTMLElement>(
  "#global-target-language-status",
);
const globalSelectionTranslationField = requireElement<HTMLInputElement>(
  '[name="globalSelectionTranslation"]',
);
const translationPromptForm = requireElement<HTMLFormElement>(
  "#translation-prompt-form",
);
const translationPromptField = requireElement<HTMLTextAreaElement>(
  '[name="translationPrompt"]',
);
const translationPromptStatus = requireElement<HTMLElement>(
  "#translation-prompt-status",
);
const terminologyList = requireElement<HTMLElement>("#terminology-list");
const terminologyForm =
  requireElement<HTMLFormElement>("#terminology-form");
const terminologyFormTitle = requireElement<HTMLElement>(
  "#terminology-form-title",
);
const terminologySourceField = requireElement<HTMLInputElement>(
  '[name="terminologySource"]',
);
const terminologyTargetField = requireElement<HTMLInputElement>(
  '[name="terminologyTarget"]',
);
const addTerminologyRuleButton = requireElement<HTMLButtonElement>(
  "#add-terminology-rule",
);
const cancelTerminologyRuleButton = requireElement<HTMLButtonElement>(
  "#cancel-terminology-rule",
);
const configurationNameField = requireElement<HTMLInputElement>(
  '[name="name"]',
);
const modelField = requireElement<HTMLInputElement>("#model-input");
const modelToggle = requireElement<HTMLButtonElement>("#model-toggle");
const modelOptions = requireElement<HTMLElement>("#model-options");
const endpointField = requireElement<HTMLInputElement>('[name="endpoint"]');
const endpointHint = requireElement<HTMLElement>("#endpoint-hint");
const apiKeyField = requireElement<HTMLInputElement>('[name="apiKey"]');
const requestParametersField = requireElement<HTMLTextAreaElement>(
  '[name="requestParameters"]',
);
const customHeadersField = requireElement<HTMLTextAreaElement>(
  '[name="customHeaders"]',
);
const advancedSettings =
  requireElement<HTMLDetailsElement>(".advanced-settings");
const advancedCustomized =
  requireElement<HTMLElement>("#advanced-customized");
const restorePresetButton =
  requireElement<HTMLButtonElement>("#restore-preset");
const testConfigurationButton =
  requireElement<HTMLButtonElement>("#test-configuration");
const formConnectionStatus = requireElement<HTMLElement>(
  "#form-connection-status",
);
const routeProvider = requireElement<HTMLElement>("#route-provider");
const routeHost = requireElement<HTMLElement>("#route-host");
let editingConfigurationId: string | null = null;
let editingTerminologyRuleId: string | null = null;
let savedGlobalSelectionTranslationEnabled = false;
let latestTranslationDiagnosticsDownloadId: number | undefined;

function renderTranslationDiagnosticsStatus(
  status: Awaited<ReturnType<typeof loadTranslationDiagnosticsStatus>>,
): void {
  if (!status) return;
  if (status.directory) {
    translationDiagnosticsDirectory.textContent = status.directory;
  }
  if (status.downloadId !== undefined) {
    latestTranslationDiagnosticsDownloadId = status.downloadId;
    showTranslationDiagnosticsButton.hidden = false;
  }
  translationDiagnosticsStatus.textContent = status.kind === "saved"
    ? `最近一次日志已保存：${new Date(status.at).toLocaleString()}`
    : `最近一次日志未保存：${status.message}`;
}
let selectedPresetId: string | null = null;
let nameWasEdited = false;

const configurationFieldErrors = new Map<
  HTMLInputElement | HTMLTextAreaElement,
  HTMLElement
>([
  [configurationNameField, requireElement("#name-error")],
  [modelField, requireElement("#model-error")],
  [apiKeyField, requireElement("#api-key-error")],
  [endpointField, requireElement("#endpoint-error")],
  [requestParametersField, requireElement("#request-parameters-error")],
  [customHeadersField, requireElement("#custom-headers-error")],
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function parseJsonObject(
  value: string,
): { value: Record<string, unknown> } | { error: string } {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { error: "请输入 JSON 对象，例如 {}。" };
    }
    return { value: parsed as Record<string, unknown> };
  } catch {
    return { error: "JSON 格式不正确，请检查括号、引号和逗号。" };
  }
}

function formatJson(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2);
}

function presetForConfiguration(
  configuration: LlmConfiguration,
): LlmModelPreset | undefined {
  if (configuration.modelPresetId === null) {
    return undefined;
  }
  if (configuration.modelPresetId !== undefined) {
    return findLlmModelPreset(configuration.modelPresetId);
  }
  return findLlmModelPresetByModel(configuration.model);
}

function currentPreset(): LlmModelPreset | undefined {
  return findLlmModelPreset(selectedPresetId);
}

function requestParametersValue(): Record<string, unknown> | undefined {
  const result = parseJsonObject(requestParametersField.value);
  return "value" in result ? result.value : undefined;
}

function isCurrentPresetCustomized(): boolean {
  const preset = currentPreset();
  if (!preset) {
    return false;
  }
  const requestParameters = requestParametersValue();
  return (
    endpointField.value.trim() !== preset.endpoint ||
    !requestParameters ||
    !sameJsonValue(requestParameters, preset.requestParameters)
  );
}

function isConfigurationPresetCustomized(
  configuration: LlmConfiguration,
  preset: LlmModelPreset,
): boolean {
  return (
    configuration.endpoint.trim() !== preset.endpoint ||
    !sameJsonValue(
      configuration.requestParameters,
      preset.requestParameters,
    )
  );
}

function setFieldError(
  field: HTMLInputElement | HTMLTextAreaElement,
  message: string,
): void {
  const error = configurationFieldErrors.get(field);
  if (!error) return;
  error.textContent = message;
  field.setAttribute("aria-invalid", message ? "true" : "false");
}

function clearConfigurationErrors(): void {
  for (const [field] of configurationFieldErrors) {
    setFieldError(field, "");
  }
}

function updateRoutePreview(): void {
  const preset = currentPreset();
  routeProvider.textContent = preset
    ? `${preset.provider} · ${preset.displayName}`
    : modelField.value.trim() || "尚未选择模型";
  try {
    routeHost.textContent = endpointField.value.trim()
      ? new URL(endpointField.value.trim()).host
      : "等待服务地址";
  } catch {
    routeHost.textContent = endpointField.value.trim() || "等待服务地址";
  }
}

function updatePresetState(): void {
  const preset = currentPreset();
  const customized = Boolean(preset && isCurrentPresetCustomized());
  advancedCustomized.hidden = !customized;
  restorePresetButton.hidden = !customized;
  endpointHint.textContent =
    preset?.endpointHint ??
    "填写基础地址，插件会请求其 /chat/completions 路径。";
  updateRoutePreview();
}

function closeModelOptions(): void {
  modelOptions.hidden = true;
  modelField.setAttribute("aria-expanded", "false");
  modelToggle.setAttribute("aria-label", "展开选项");
}

function focusModelOption(
  current: HTMLButtonElement,
  direction: 1 | -1,
): void {
  const options = Array.from(
    modelOptions.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  );
  const index = options.indexOf(current);
  const nextIndex = (index + direction + options.length) % options.length;
  options[nextIndex]?.focus();
}

function shouldConfirmPresetReplacement(): boolean {
  const endpoint = endpointField.value.trim();
  const requestParameters = requestParametersValue();
  if (!endpoint && requestParameters && sameJsonValue(requestParameters, {})) {
    return false;
  }
  const preset = currentPreset();
  if (preset) {
    return isCurrentPresetCustomized();
  }
  return Boolean(endpoint) || Boolean(
    requestParameters && !sameJsonValue(requestParameters, {}),
  );
}

function applyPreset(preset: LlmModelPreset, force = false): boolean {
  if (
    !force &&
    selectedPresetId !== preset.id &&
    shouldConfirmPresetReplacement() &&
    !window.confirm(
      "应用新的模型预设将覆盖当前服务地址和请求参数。是否继续？",
    )
  ) {
    return false;
  }

  selectedPresetId = preset.id;
  modelField.value = preset.model;
  endpointField.value = preset.endpoint;
  requestParametersField.value = formatJson(preset.requestParameters);
  if (!nameWasEdited && !configurationNameField.value.trim()) {
    configurationNameField.value = `${preset.provider} · ${preset.displayName}`;
  }
  clearConfigurationErrors();
  formConnectionStatus.textContent = "";
  updatePresetState();
  closeModelOptions();
  return true;
}

function selectCustomModel(): void {
  selectedPresetId = null;
  formConnectionStatus.textContent = "";
  updatePresetState();
  closeModelOptions();
  modelField.focus();
  modelField.select();
}

function renderModelOptions(query = ""): void {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredPresets = llmModelPresets.filter((preset) =>
    [
      preset.provider,
      preset.displayName,
      preset.model,
      llmModelPresetTierLabel(preset.tier),
    ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
  );

  const fragment = document.createDocumentFragment();
  const providers = [...new Set(filteredPresets.map(({ provider }) => provider))];
  for (const provider of providers) {
    const group = document.createElement("section");
    group.className = "model-option-group";
    const heading = document.createElement("p");
    heading.className = "model-option-group-title";
    heading.textContent = provider;
    group.append(heading);

    for (const preset of filteredPresets.filter(
      (candidate) => candidate.provider === provider,
    )) {
      const option = document.createElement("button");
      option.className = "model-option";
      option.type = "button";
      option.role = "option";
      option.dataset.presetId = preset.id;
      option.setAttribute(
        "aria-selected",
        String(selectedPresetId === preset.id),
      );
      option.innerHTML = `
        <span>
          <strong>${preset.displayName}</strong>
          <code>${preset.model}</code>
        </span>
        <small>${llmModelPresetTierLabel(preset.tier)}</small>
      `;
      option.addEventListener("click", () => {
        applyPreset(preset);
      });
      option.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          focusModelOption(option, event.key === "ArrowDown" ? 1 : -1);
        }
        if (event.key === "Escape") {
          closeModelOptions();
          modelField.focus();
        }
      });
      group.append(option);
    }
    fragment.append(group);
  }

  if (filteredPresets.length === 0) {
    const empty = document.createElement("p");
    empty.className = "model-options-empty";
    empty.textContent = "没有匹配的模型预设";
    fragment.append(empty);
  }

  const customOption = document.createElement("button");
  customOption.className = "model-option custom-model-option";
  customOption.type = "button";
  customOption.role = "option";
  customOption.setAttribute("aria-selected", String(selectedPresetId === null));
  customOption.innerHTML = `
    <span>
      <strong>自定义模型</strong>
      <code>保留当前地址与参数</code>
    </span>
    <small>自由输入</small>
  `;
  customOption.addEventListener("click", selectCustomModel);
  customOption.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusModelOption(customOption, event.key === "ArrowDown" ? 1 : -1);
    }
    if (event.key === "Escape") {
      closeModelOptions();
      modelField.focus();
    }
  });
  fragment.append(customOption);

  modelOptions.replaceChildren(fragment);
}

function openModelOptions(query = ""): void {
  renderModelOptions(query);
  modelOptions.hidden = false;
  modelField.setAttribute("aria-expanded", "true");
  modelToggle.setAttribute("aria-label", "收起选项");
}

function configurationFromForm(): LlmConfiguration | null {
  clearConfigurationErrors();
  const errors: Array<{
    field: HTMLInputElement | HTMLTextAreaElement;
    message: string;
  }> = [];
  const name = configurationNameField.value.trim();
  const model = modelField.value.trim();
  const endpoint = endpointField.value.trim();
  const apiKey = apiKeyField.value;

  if (!name) errors.push({ field: configurationNameField, message: "请输入配置名称。" });
  if (!model) errors.push({ field: modelField, message: "请选择或输入模型。" });
  if (!apiKey.trim()) errors.push({ field: apiKeyField, message: "请输入 API Key。" });

  try {
    const url = new URL(endpoint);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    if (endpoint.includes("YOUR-WORKSPACE-ID")) {
      errors.push({
        field: endpointField,
        message: "请先将 YOUR-WORKSPACE-ID 替换为百炼业务空间 ID。",
      });
    }
  } catch {
    errors.push({
      field: endpointField,
      message: endpoint
        ? "请输入有效的 HTTP(S) 服务地址。"
        : "请输入服务地址。",
    });
  }

  const requestParameters = parseJsonObject(requestParametersField.value);
  if ("error" in requestParameters) {
    errors.push({
      field: requestParametersField,
      message: requestParameters.error,
    });
  }
  const customHeaders = parseJsonObject(customHeadersField.value);
  if ("error" in customHeaders) {
    errors.push({ field: customHeadersField, message: customHeaders.error });
  } else if (
    Object.values(customHeaders.value).some(
      (value) => typeof value !== "string",
    )
  ) {
    errors.push({
      field: customHeadersField,
      message: "自定义请求头的每个值都必须是字符串。",
    });
  }

  for (const { field, message } of errors) {
    setFieldError(field, message);
  }
  if (errors.length > 0) {
    const firstField = errors[0]!.field;
    if (
      firstField === requestParametersField ||
      firstField === customHeadersField
    ) {
      advancedSettings.open = true;
    }
    firstField.focus();
    return null;
  }

  if (!("value" in requestParameters) || !("value" in customHeaders)) {
    return null;
  }
  return {
    id: editingConfigurationId ?? crypto.randomUUID(),
    name,
    endpoint,
    apiKey,
    model,
    modelPresetId: selectedPresetId,
    requestParameters: requestParameters.value,
    customHeaders: customHeaders.value as Record<string, string>,
  };
}

async function renderConfigurations(): Promise<void> {
  const configurations = await loadLlmConfigurations();

  if (configurations.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <h2>还没有 LLM 配置</h2>
        <p>新增一个配置后，可以在翻译前验证服务是否可用。</p>
      </div>
    `;
    return;
  }

  list.replaceChildren(
    ...configurations.map((configuration) => {
      const article = document.createElement("article");
      article.className = "configuration-card";

      const preset = presetForConfiguration(configuration);
      const cardHeader = document.createElement("div");
      cardHeader.className = "configuration-card-header";
      const title = document.createElement("h2");
      title.textContent = configuration.name;
      const badges = document.createElement("div");
      badges.className = "configuration-badges";
      const providerBadge = document.createElement("span");
      providerBadge.textContent = preset?.provider ?? "自定义模型";
      badges.append(providerBadge);
      if (preset && isConfigurationPresetCustomized(configuration, preset)) {
        const customizedBadge = document.createElement("span");
        customizedBadge.className = "customized-badge";
        customizedBadge.textContent = "已自定义";
        badges.append(customizedBadge);
      }
      cardHeader.append(title, badges);

      const modelDetails = document.createElement("div");
      modelDetails.className = "configuration-model";
      const modelName = document.createElement("p");
      modelName.textContent = preset?.displayName ?? "自定义模型";
      const modelId = document.createElement("code");
      modelId.textContent = configuration.model;
      modelDetails.append(modelName, modelId);

      const endpointHost = document.createElement("p");
      endpointHost.className = "configuration-endpoint";
      try {
        endpointHost.textContent = new URL(configuration.endpoint).host;
      } catch {
        endpointHost.textContent = configuration.endpoint;
      }
      const actions = document.createElement("div");
      actions.className = "card-actions";
      const connectionStatus = document.createElement("p");
      connectionStatus.className = "connection-status";
      connectionStatus.setAttribute("aria-live", "polite");
      const testButton = document.createElement("button");
      testButton.className = "primary";
      testButton.type = "button";
      testButton.textContent = "测试连接";
      testButton.setAttribute("aria-label", `测试连接 ${configuration.name}`);
      testButton.addEventListener("click", () => {
        runUiTask(async () => {
          testButton.disabled = true;
          connectionStatus.textContent = "正在测试连接…";
          try {
            const result = await testLlmConnection(configuration);
            connectionStatus.textContent = describeConnectionResult(result);
          } finally {
            testButton.disabled = false;
          }
        }, () => {
          testButton.disabled = false;
          connectionStatus.textContent = "连接测试失败，请重试";
        });
      });
      const editButton = document.createElement("button");
      editButton.className = "secondary";
      editButton.type = "button";
      editButton.textContent = "编辑";
      editButton.setAttribute("aria-label", `编辑 ${configuration.name}`);
      editButton.addEventListener("click", () => openForm(configuration));
      const deleteButton = document.createElement("button");
      deleteButton.className = "danger";
      deleteButton.type = "button";
      deleteButton.textContent = "删除";
      deleteButton.setAttribute("aria-label", `删除 ${configuration.name}`);
      deleteButton.addEventListener("click", () => {
        runUiTask(async () => {
          await removeLlmConfiguration(configuration.id);
          await renderConfigurations();
        }, () => {
          optionsStatus.textContent = "LLM 配置删除失败，请重试";
        });
      });
      actions.append(testButton, editButton, deleteButton);

      article.append(
        cardHeader,
        modelDetails,
        endpointHost,
        connectionStatus,
        actions,
      );
      return article;
    }),
  );
}

async function renderTerminologyRules(): Promise<void> {
  const instructions = await loadTranslationInstructions();
  if (instructions.terminologyRules.length === 0) {
    terminologyList.innerHTML = '<p class="empty-terminology">还没有术语规则</p>';
    return;
  }

  terminologyList.replaceChildren(
    ...instructions.terminologyRules.map((rule) => {
      const row = document.createElement("div");
      row.className = "terminology-rule";
      const terms = document.createElement("p");
      terms.textContent = `${rule.source} → ${rule.target}`;
      const actions = document.createElement("div");
      actions.className = "terminology-actions";
      const editButton = document.createElement("button");
      editButton.className = "secondary";
      editButton.type = "button";
      editButton.textContent = "编辑";
      editButton.setAttribute("aria-label", `编辑术语规则 ${rule.source}`);
      editButton.addEventListener("click", () => openTerminologyForm(rule));
      const deleteButton = document.createElement("button");
      deleteButton.className = "danger";
      deleteButton.type = "button";
      deleteButton.textContent = "删除";
      deleteButton.setAttribute("aria-label", `删除术语规则 ${rule.source}`);
      deleteButton.addEventListener("click", () => {
        runUiTask(async () => {
          await saveTranslationInstructions({
            ...instructions,
            terminologyRules: instructions.terminologyRules.filter(
              ({ id }) => id !== rule.id,
            ),
          });
          await renderTerminologyRules();
        }, () => {
          optionsStatus.textContent = "术语规则删除失败，请重试";
        });
      });
      actions.append(editButton, deleteButton);
      row.append(terms, actions);
      return row;
    }),
  );
}

function openTerminologyForm(rule?: TerminologyRule): void {
  editingTerminologyRuleId = rule?.id ?? null;
  terminologyForm.reset();
  terminologyFormTitle.textContent = rule
    ? "编辑术语规则"
    : "新增术语规则";
  terminologySourceField.value = rule?.source ?? "";
  terminologyTargetField.value = rule?.target ?? "";
  terminologyForm.hidden = false;
  addTerminologyRuleButton.hidden = true;
  terminologySourceField.focus();
}

function closeTerminologyForm(): void {
  editingTerminologyRuleId = null;
  terminologyForm.reset();
  terminologyForm.hidden = true;
  addTerminologyRuleButton.hidden = false;
}

function describeConnectionResult(result: ConnectionTestResult): string {
  switch (result.kind) {
    case "success":
      return "连接成功";
    case "authentication":
      return "认证失败：请检查 API Key";
    case "network":
      return "网络失败：无法连接到服务地址";
    case "cors":
      return "CORS 失败：服务未允许浏览器跨域请求";
    case "incompatible-response":
      return "连接失败：服务响应不兼容 OpenAI 接口";
    case "http":
      return `连接失败（HTTP ${result.status}）`;
    case "invalid-configuration":
      return "配置错误：请检查服务地址和自定义请求头";
  }
}

function setFieldValue(name: string, value: string): void {
  const field = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[name="${name}"]`,
  );
  if (!field) {
    throw new Error(`配置表单缺少字段：${name}`);
  }
  field.value = value;
}

function openForm(configuration?: LlmConfiguration): void {
  editingConfigurationId = configuration?.id ?? null;
  form.reset();
  clearConfigurationErrors();
  formConnectionStatus.textContent = "";
  advancedSettings.open = true;
  nameWasEdited = Boolean(configuration);
  selectedPresetId = null;
  formTitle.textContent = configuration ? "编辑 LLM 配置" : "新增 LLM 配置";

  if (configuration) {
    selectedPresetId = presetForConfiguration(configuration)?.id ?? null;
    setFieldValue("name", configuration.name);
    setFieldValue("endpoint", configuration.endpoint);
    setFieldValue("apiKey", configuration.apiKey);
    setFieldValue("model", configuration.model);
    setFieldValue(
      "requestParameters",
      formatJson(configuration.requestParameters),
    );
    setFieldValue(
      "customHeaders",
      formatJson(configuration.customHeaders),
    );
  }

  updatePresetState();
  closeModelOptions();
  form.hidden = false;
  addButton.hidden = true;
  configurationNameField.focus();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeConfigurationForm(): void {
  editingConfigurationId = null;
  selectedPresetId = null;
  nameWasEdited = false;
  form.reset();
  clearConfigurationErrors();
  formConnectionStatus.textContent = "";
  closeModelOptions();
  form.hidden = true;
  addButton.hidden = false;
}

addButton.addEventListener("click", () => {
  openForm();
});

cancelButton.addEventListener("click", () => {
  closeConfigurationForm();
});

configurationNameField.addEventListener("input", () => {
  nameWasEdited = true;
});

modelField.addEventListener("focus", () => {
  openModelOptions("");
});

modelField.addEventListener("input", () => {
  selectedPresetId = null;
  formConnectionStatus.textContent = "";
  updatePresetState();
  openModelOptions(modelField.value);
});

modelField.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    openModelOptions(modelOptions.hidden ? "" : modelField.value);
    modelOptions
      .querySelector<HTMLButtonElement>('[role="option"]')
      ?.focus();
  }
  if (event.key === "Escape") {
    closeModelOptions();
  }
});

modelToggle.addEventListener("click", () => {
  if (modelOptions.hidden) {
    openModelOptions("");
    modelField.focus();
    return;
  }
  modelField.focus();
  closeModelOptions();
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (
    target instanceof Node &&
    !modelOptions.contains(target) &&
    !modelField.contains(target) &&
    !modelToggle.contains(target)
  ) {
    closeModelOptions();
  }
});

for (const [field] of configurationFieldErrors) {
  field.addEventListener("input", () => {
    setFieldError(field, "");
  });
}

endpointField.addEventListener("input", updatePresetState);
requestParametersField.addEventListener("input", updatePresetState);

restorePresetButton.addEventListener("click", () => {
  const preset = currentPreset();
  if (preset) {
    applyPreset(preset, true);
  }
});

testConfigurationButton.addEventListener("click", () => {
  const configuration = configurationFromForm();
  if (!configuration) return;

  runUiTask(async () => {
    testConfigurationButton.disabled = true;
    formConnectionStatus.textContent = "正在测试连接…";
    try {
      const result = await testLlmConnection(configuration);
      formConnectionStatus.textContent = describeConnectionResult(result);
    } finally {
      testConfigurationButton.disabled = false;
    }
  }, () => {
    testConfigurationButton.disabled = false;
    formConnectionStatus.textContent = "连接测试失败，请重试";
  });
});

clearCacheButton.addEventListener("click", () => {
  runUiTask(async () => {
    clearCacheButton.disabled = true;
    try {
      await clearTranslationCache();
      cacheStatus.textContent = "翻译缓存已清空";
    } finally {
      clearCacheButton.disabled = false;
    }
  }, () => {
    clearCacheButton.disabled = false;
    cacheStatus.textContent = "翻译缓存清空失败，请重试";
  });
});

translationDiagnosticsEnabled.addEventListener("change", () => {
  const requestedEnabled = translationDiagnosticsEnabled.checked;
  runUiTask(async () => {
    translationDiagnosticsEnabled.disabled = true;
    try {
      if (requestedEnabled) {
        const alreadyGranted = await chrome.permissions.contains({
          permissions: ["downloads"],
        });
        const granted = alreadyGranted ||
          await chrome.permissions.request({
            permissions: ["downloads"],
          });
        if (!granted) {
          translationDiagnosticsEnabled.checked = false;
          translationDiagnosticsStatus.textContent =
            "下载权限被拒绝，翻译诊断日志未开启";
          return;
        }
        try {
          await saveTranslationDiagnosticsEnabled(true);
        } catch (error) {
          if (!alreadyGranted) {
            await chrome.permissions.remove({
              permissions: ["downloads"],
            });
          }
          throw error;
        }
        translationDiagnosticsStatus.textContent = "翻译诊断日志已开启";
        return;
      }
      await saveTranslationDiagnosticsEnabled(false);
      const removed = await chrome.permissions.remove({
        permissions: ["downloads"],
      });
      translationDiagnosticsStatus.textContent = removed
        ? "翻译诊断日志已关闭，下载权限已撤销"
        : "翻译诊断日志已关闭";
    } finally {
      translationDiagnosticsEnabled.disabled = false;
    }
  }, () => {
    translationDiagnosticsEnabled.disabled = false;
    translationDiagnosticsEnabled.checked = !requestedEnabled;
    translationDiagnosticsStatus.textContent =
      "翻译诊断日志设置失败，请重试";
  });
});

showTranslationDiagnosticsButton.addEventListener("click", () => {
  runUiTask(async () => {
    if (latestTranslationDiagnosticsDownloadId === undefined) return;
    const permitted = await chrome.permissions.contains({
      permissions: ["downloads"],
    });
    if (
      !permitted &&
      !(await chrome.permissions.request({ permissions: ["downloads"] }))
    ) {
      translationDiagnosticsStatus.textContent =
        "下载权限被拒绝，无法在文件夹中显示日志";
      return;
    }
    await chrome.downloads.show(latestTranslationDiagnosticsDownloadId);
  }, () => {
    translationDiagnosticsStatus.textContent =
      "无法在文件夹中显示最近的翻译诊断日志";
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName !== "local" ||
    !("translationDiagnosticsStatus" in changes)
  ) {
    return;
  }
  void loadTranslationDiagnosticsStatus()
    .then(renderTranslationDiagnosticsStatus)
    .catch(() => {
      translationDiagnosticsStatus.textContent =
        "翻译诊断日志状态更新失败，请重新打开设置页";
    });
});

globalTargetLanguageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runUiTask(async () => {
    await saveGlobalTranslationPreferences({
      targetLanguage: globalTargetLanguageField.value.trim(),
      selectionTranslationEnabled: globalSelectionTranslationField.checked,
    });
    savedGlobalSelectionTranslationEnabled =
      globalSelectionTranslationField.checked;
    globalTargetLanguageStatus.textContent = "全局目标语言已保存";
  }, () => {
    globalTargetLanguageStatus.textContent = "全局目标语言保存失败，请重试";
  });
});

globalSelectionTranslationField.addEventListener("change", () => {
  const previousEnabled = savedGlobalSelectionTranslationEnabled;
  runUiTask(async () => {
    const allWebsiteOrigins = ["http://*/*", "https://*/*"];
    if (globalSelectionTranslationField.checked) {
      const granted = await chrome.permissions.request({
        origins: allWebsiteOrigins,
      });
      if (!granted) {
        globalSelectionTranslationField.checked = previousEnabled;
        globalTargetLanguageStatus.textContent =
          "权限被拒绝，所有网站的划词翻译未开启";
        return;
      }
    }
    const targetLanguage = globalTargetLanguageField.value.trim();
    await saveGlobalTranslationPreferences({
      targetLanguage,
      selectionTranslationEnabled: globalSelectionTranslationField.checked,
    });
    try {
      const response = await chrome.runtime.sendMessage({
        kind: "sync-selection-translation",
      });
      if (
        typeof response === "object" &&
        response !== null &&
        "kind" in response &&
        response.kind === "failed"
      ) {
        throw new Error("同步划词翻译失败");
      }
    } catch (error) {
      await saveGlobalTranslationPreferences({
        targetLanguage,
        selectionTranslationEnabled: previousEnabled,
      });
      throw error;
    }
    savedGlobalSelectionTranslationEnabled =
      globalSelectionTranslationField.checked;
    if (globalSelectionTranslationField.checked) {
      globalTargetLanguageStatus.textContent = "所有网站的划词翻译已开启";
      return;
    }
    const removed = await chrome.permissions.remove({
      origins: allWebsiteOrigins,
    });
    globalTargetLanguageStatus.textContent = removed
      ? "所有网站的划词翻译已关闭，网站权限已撤销"
      : "所有网站的划词翻译已关闭";
  }, () => {
    globalSelectionTranslationField.checked = previousEnabled;
    globalTargetLanguageStatus.textContent = "划词翻译设置失败，请重试";
  });
});

translationPromptForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runUiTask(async () => {
    const instructions = await loadTranslationInstructions();
    await saveTranslationInstructions({
      ...instructions,
      prompt: translationPromptField.value,
    });
    translationPromptStatus.textContent = "翻译提示词已保存";
  }, () => {
    translationPromptStatus.textContent = "翻译提示词保存失败，请重试";
  });
});

addTerminologyRuleButton.addEventListener("click", () => {
  openTerminologyForm();
});

cancelTerminologyRuleButton.addEventListener("click", () => {
  closeTerminologyForm();
});

terminologyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runUiTask(async () => {
    const instructions = await loadTranslationInstructions();
    const rule = {
      id: editingTerminologyRuleId ?? crypto.randomUUID(),
      source: terminologySourceField.value.trim(),
      target: terminologyTargetField.value.trim(),
    };
    await saveTranslationInstructions({
      ...instructions,
      terminologyRules: editingTerminologyRuleId
        ? instructions.terminologyRules.map((existing) =>
            existing.id === editingTerminologyRuleId ? rule : existing,
          )
        : [...instructions.terminologyRules, rule],
    });
    closeTerminologyForm();
    await renderTerminologyRules();
  }, () => {
    optionsStatus.textContent = "术语规则保存失败，请重试";
  });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const configuration = configurationFromForm();
  if (!configuration) return;

  runUiTask(async () => {
    await saveLlmConfiguration(configuration);
    closeConfigurationForm();
    optionsStatus.textContent = "LLM 配置已保存";
    await renderConfigurations();
  }, () => {
    optionsStatus.textContent = "LLM 配置保存失败，请重试";
  });
});

runUiTask(async () => {
  const translationInstructions = await loadTranslationInstructions();
  translationPromptField.value = translationInstructions.prompt;
  const globalTranslationPreferences =
    await loadGlobalTranslationPreferences();
  globalTargetLanguageField.value = globalTranslationPreferences.targetLanguage;
  globalSelectionTranslationField.checked =
    globalTranslationPreferences.selectionTranslationEnabled;
  savedGlobalSelectionTranslationEnabled =
    globalTranslationPreferences.selectionTranslationEnabled;
  const diagnosticsEnabled = await loadTranslationDiagnosticsEnabled();
  const diagnosticsPermission = await chrome.permissions.contains({
    permissions: ["downloads"],
  });
  translationDiagnosticsEnabled.checked =
    diagnosticsEnabled && diagnosticsPermission;
  if (diagnosticsEnabled && !diagnosticsPermission) {
    await saveTranslationDiagnosticsEnabled(false);
    translationDiagnosticsStatus.textContent =
      "下载权限已被撤销，翻译诊断日志已关闭";
  }
  const diagnosticsStatus = await loadTranslationDiagnosticsStatus();
  renderTranslationDiagnosticsStatus(diagnosticsStatus);
  await renderTerminologyRules();
  await renderConfigurations();
}, () => {
  optionsStatus.textContent =
    "设置加载失败，请重新打开页面后重试";
});
