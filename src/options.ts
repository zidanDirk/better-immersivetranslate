import {
  loadLlmConfigurations,
  removeLlmConfiguration,
  saveLlmConfiguration,
  type LlmConfiguration,
} from "./llm-configuration.js";
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
  <aside class="security-notice" aria-labelledby="security-title">
    <div class="security-icon" aria-hidden="true">i</div>
    <div>
      <h2 id="security-title">Key 的存储与安全边界</h2>
      <p>API Key 仅保存在此浏览器的本地存储中，不会上传到运营方服务器。</p>
      <p>浏览器扩展环境无法绝对隐藏 API Key，请只在可信设备上使用。</p>
    </div>
  </aside>
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
      <p>未设置时使用浏览器语言；网站覆盖设置可以为单个网站指定其他目标语言。</p>
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
  <form id="configuration-form" class="configuration-form" hidden>
    <h2 id="form-title">新增 LLM 配置</h2>
    <div class="form-grid">
      <label>名称<input name="name" autocomplete="off" required /></label>
      <label>服务地址<input name="endpoint" type="url" placeholder="https://api.example.com/v1" required /></label>
      <label>API Key<input name="apiKey" type="password" autocomplete="new-password" required /></label>
      <label>模型<input name="model" autocomplete="off" required /></label>
      <label class="wide">请求参数<textarea name="requestParameters" rows="4">{}</textarea></label>
      <label class="wide">自定义请求头<textarea name="customHeaders" rows="4">{}</textarea></label>
    </div>
    <div class="form-actions">
      <button class="secondary" id="cancel-configuration" type="button">取消</button>
      <button class="primary" type="submit">保存配置</button>
    </div>
  </form>
`;

const list = requireElement<HTMLElement>("#configuration-list");
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
const globalTargetLanguageForm = requireElement<HTMLFormElement>(
  "#global-target-language-form",
);
const globalTargetLanguageField = requireElement<HTMLInputElement>(
  '[name="globalTargetLanguage"]',
);
const globalTargetLanguageStatus = requireElement<HTMLElement>(
  "#global-target-language-status",
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
let editingConfigurationId: string | null = null;
let editingTerminologyRuleId: string | null = null;

function parseObject<T extends Record<string, unknown>>(
  value: FormDataEntryValue | null,
): T {
  return JSON.parse(String(value ?? "{}")) as T;
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

      const title = document.createElement("h2");
      title.textContent = configuration.name;
      const model = document.createElement("p");
      model.textContent = configuration.model;
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
      testButton.addEventListener("click", async () => {
        testButton.disabled = true;
        connectionStatus.textContent = "正在测试连接…";
        try {
          const result = await testLlmConnection(configuration);
          connectionStatus.textContent = describeConnectionResult(result);
        } finally {
          testButton.disabled = false;
        }
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
      deleteButton.addEventListener("click", async () => {
        await removeLlmConfiguration(configuration.id);
        await renderConfigurations();
      });
      actions.append(testButton, editButton, deleteButton);

      article.append(title, model, connectionStatus, actions);
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
      deleteButton.addEventListener("click", async () => {
        await saveTranslationInstructions({
          ...instructions,
          terminologyRules: instructions.terminologyRules.filter(
            ({ id }) => id !== rule.id,
          ),
        });
        await renderTerminologyRules();
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
  formTitle.textContent = configuration ? "编辑 LLM 配置" : "新增 LLM 配置";

  if (configuration) {
    setFieldValue("name", configuration.name);
    setFieldValue("endpoint", configuration.endpoint);
    setFieldValue("apiKey", configuration.apiKey);
    setFieldValue("model", configuration.model);
    setFieldValue(
      "requestParameters",
      JSON.stringify(configuration.requestParameters),
    );
    setFieldValue("customHeaders", JSON.stringify(configuration.customHeaders));
  }

  form.hidden = false;
  addButton.hidden = true;
  form.querySelector<HTMLInputElement>('[name="name"]')?.focus();
}

addButton.addEventListener("click", () => {
  openForm();
});

cancelButton.addEventListener("click", () => {
  editingConfigurationId = null;
  form.reset();
  form.hidden = true;
  addButton.hidden = false;
});

clearCacheButton.addEventListener("click", async () => {
  clearCacheButton.disabled = true;
  try {
    await clearTranslationCache();
    cacheStatus.textContent = "翻译缓存已清空";
  } finally {
    clearCacheButton.disabled = false;
  }
});

globalTargetLanguageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveGlobalTranslationPreferences({
    targetLanguage: globalTargetLanguageField.value.trim(),
  });
  globalTargetLanguageStatus.textContent = "全局目标语言已保存";
});

translationPromptForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const instructions = await loadTranslationInstructions();
  await saveTranslationInstructions({
    ...instructions,
    prompt: translationPromptField.value,
  });
  translationPromptStatus.textContent = "翻译提示词已保存";
});

addTerminologyRuleButton.addEventListener("click", () => {
  openTerminologyForm();
});

cancelTerminologyRuleButton.addEventListener("click", () => {
  closeTerminologyForm();
});

terminologyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
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
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const configuration: LlmConfiguration = {
    id: editingConfigurationId ?? crypto.randomUUID(),
    name: String(data.get("name")),
    endpoint: String(data.get("endpoint")),
    apiKey: String(data.get("apiKey")),
    model: String(data.get("model")),
    requestParameters: parseObject(data.get("requestParameters")),
    customHeaders: parseObject<Record<string, string>>(data.get("customHeaders")),
  };

  await saveLlmConfiguration(configuration);
  editingConfigurationId = null;
  form.reset();
  form.hidden = true;
  addButton.hidden = false;
  await renderConfigurations();
});

const translationInstructions = await loadTranslationInstructions();
translationPromptField.value = translationInstructions.prompt;
const globalTranslationPreferences =
  await loadGlobalTranslationPreferences();
globalTargetLanguageField.value = globalTranslationPreferences.targetLanguage;
await renderTerminologyRules();
await renderConfigurations();
