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
    <div>
      <p class="eyebrow">自带 Key（BYOK）</p>
      <h1>LLM 配置</h1>
      <p class="subtitle">管理用于网页翻译的 OpenAI 兼容服务。</p>
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
let editingConfigurationId: string | null = null;

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

await renderConfigurations();
