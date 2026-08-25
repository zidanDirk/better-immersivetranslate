import { expect, test, type Page } from "@playwright/test";
import { launchExtension } from "./extension";
import { startFakeOpenAiServer } from "./fake-openai-server";

async function saveConfiguration(
  page: Page,
  configuration: {
    name: string;
    endpoint?: string;
    apiKey?: string;
    model?: string;
    requestParameters?: string;
    customHeaders?: string;
  },
): Promise<void> {
  await page.getByRole("button", { name: "新增 LLM 配置" }).click();
  await page.getByLabel("名称").fill(configuration.name);
  await page
    .getByLabel("服务地址")
    .fill(configuration.endpoint ?? "http://127.0.0.1:4010/v1");
  await page.getByLabel("API Key").fill(configuration.apiKey ?? "local-secret");
  await page.getByLabel("模型").fill(configuration.model ?? "fake-model");
  if (configuration.requestParameters) {
    await page
      .getByLabel("请求参数")
      .fill(configuration.requestParameters);
  }
  if (configuration.customHeaders) {
    await page.getByLabel("自定义请求头").fill(configuration.customHeaders);
  }
  await page.getByRole("button", { name: "保存配置" }).click();
}

async function selectModelPreset(page: Page, name: RegExp): Promise<void> {
  await page.getByLabel("模型").click();
  await page.getByRole("option", { name }).click();
}

test("选择模型预设会自动填写名称、服务地址和请求参数", async () => {
  const { context, optionsPage } = await launchExtension();

  try {
    await optionsPage.getByRole("button", { name: "新增 LLM 配置" }).click();

    await expect(optionsPage.getByLabel("模型")).toHaveValue("");
    await expect(optionsPage.getByLabel("服务地址")).toHaveValue("");
    await expect(optionsPage.getByLabel("请求参数")).toHaveValue("{}");

    await optionsPage.getByLabel("模型").fill("terra");
    await expect(
      optionsPage.getByRole("option", { name: /GPT-5\.6 Luna/ }),
    ).toHaveCount(0);
    await optionsPage
      .getByRole("option", { name: /GPT-5\.6 Terra/ })
      .click();

    await expect(optionsPage.getByLabel("名称")).toHaveValue(
      "OpenAI · GPT-5.6 Terra",
    );
    await expect(optionsPage.getByLabel("模型")).toHaveValue(
      "gpt-5.6-terra",
    );
    await expect(optionsPage.getByLabel("服务地址")).toHaveValue(
      "https://api.openai.com/v1",
    );
    await expect(optionsPage.getByLabel("请求参数")).toHaveValue(
      '{\n  "response_format": {\n    "type": "json_object"\n  }\n}',
    );
    await expect(optionsPage.getByText("api.openai.com")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("DeepSeek V4 模型预设默认关闭 thinking", async () => {
  const { context, optionsPage } = await launchExtension();

  try {
    await optionsPage.getByRole("button", { name: "新增 LLM 配置" }).click();
    const expectedRequestParameters =
      '{\n  "response_format": {\n    "type": "json_object"\n  },\n  "thinking": {\n    "type": "disabled"\n  }\n}';

    for (const presetName of [/DeepSeek V4 Pro/, /DeepSeek V4 Flash/]) {
      await selectModelPreset(optionsPage, presetName);
      await expect(optionsPage.getByLabel("请求参数")).toHaveValue(
        expectedRequestParameters,
      );
    }
  } finally {
    await context.close();
  }
});

test("手动输入与预设相同的模型 ID 仍按自定义模型处理", async () => {
  const { context, optionsPage } = await launchExtension();

  try {
    await optionsPage.getByRole("button", { name: "新增 LLM 配置" }).click();
    await optionsPage.getByLabel("模型").fill("gpt-5.6-terra");

    await expect(optionsPage.getByLabel("服务地址")).toHaveValue("");
    await expect(optionsPage.getByLabel("请求参数")).toHaveValue("{}");
    await expect(optionsPage.getByLabel("名称")).toHaveValue("");
  } finally {
    await context.close();
  }
});

test("切换预设前确认是否覆盖用户自定义值", async () => {
  const { context, optionsPage } = await launchExtension();

  try {
    await optionsPage.getByRole("button", { name: "新增 LLM 配置" }).click();
    await selectModelPreset(optionsPage, /GPT-5\.6 Terra/);
    await optionsPage
      .getByLabel("服务地址")
      .fill("https://proxy.example.com/v1");

    optionsPage.once("dialog", (dialog) => dialog.dismiss());
    await selectModelPreset(optionsPage, /DeepSeek V4 Flash/);

    await expect(optionsPage.getByLabel("模型")).toHaveValue(
      "gpt-5.6-terra",
    );
    await expect(optionsPage.getByLabel("服务地址")).toHaveValue(
      "https://proxy.example.com/v1",
    );

    optionsPage.once("dialog", (dialog) => dialog.accept());
    await selectModelPreset(optionsPage, /DeepSeek V4 Flash/);

    await expect(optionsPage.getByLabel("模型")).toHaveValue(
      "deepseek-v4-flash",
    );
    await expect(optionsPage.getByLabel("服务地址")).toHaveValue(
      "https://api.deepseek.com",
    );
  } finally {
    await context.close();
  }
});

test("编辑预设配置时保留自定义值并可恢复默认值", async () => {
  const { context, optionsPage } = await launchExtension();

  try {
    await optionsPage.getByRole("button", { name: "新增 LLM 配置" }).click();
    await selectModelPreset(optionsPage, /GPT-5\.6 Luna/);
    await optionsPage.getByLabel("API Key").fill("local-secret");
    await optionsPage
      .getByLabel("服务地址")
      .fill("https://proxy.example.com/v1");
    await optionsPage
      .getByLabel("请求参数")
      .fill('{"response_format":{"type":"json_object"},"top_p":0.8}');
    const configurationForm = optionsPage.locator("#configuration-form");
    await expect(configurationForm.getByText("已自定义")).toBeVisible();
    await optionsPage.getByRole("button", { name: "保存配置" }).click();

    const configurationList = optionsPage.locator("#configuration-list");
    await expect(
      configurationList.getByText("proxy.example.com"),
    ).toBeVisible();
    await expect(configurationList.getByText("已自定义")).toBeVisible();
    await optionsPage
      .getByRole("button", { name: "编辑 OpenAI · GPT-5.6 Luna" })
      .click();

    await expect(optionsPage.getByLabel("服务地址")).toHaveValue(
      "https://proxy.example.com/v1",
    );
    await optionsPage
      .getByRole("button", { name: "恢复预设默认值" })
      .click();

    await expect(optionsPage.getByLabel("服务地址")).toHaveValue(
      "https://api.openai.com/v1",
    );
    await expect(configurationForm.getByText("已自定义")).toBeHidden();
  } finally {
    await context.close();
  }
});

test("表单可在保存前测试连接并显示字段级错误", async () => {
  const fakeServer = await startFakeOpenAiServer();
  const { context, optionsPage } = await launchExtension();

  try {
    await optionsPage.getByRole("button", { name: "新增 LLM 配置" }).click();
    await optionsPage.getByRole("button", { name: "测试连接" }).click();
    await expect(optionsPage.getByText("请输入配置名称。")).toBeVisible();
    await expect(optionsPage.getByText("请选择或输入模型。")).toBeVisible();
    await expect(optionsPage.getByText("请输入 API Key。")).toBeVisible();
    await expect(optionsPage.getByText("请输入服务地址。")).toBeVisible();

    await optionsPage.getByLabel("名称").fill("保存前测试");
    await optionsPage.getByLabel("模型").fill("fake-model");
    await optionsPage.getByLabel("API Key").fill("local-secret");
    await optionsPage.getByLabel("服务地址").fill(fakeServer.endpoint);
    await optionsPage.getByRole("button", { name: "测试连接" }).click();

    await expect(optionsPage.getByText("连接成功")).toBeVisible();
    await expect(optionsPage.getByText("还没有 LLM 配置")).toBeVisible();
    const received = await fakeServer.receivedRequest;
    expect(received.body).toMatchObject({ model: "fake-model" });
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("测试连接等待较慢响应正文", async () => {
  const fakeServer = await startFakeOpenAiServer({
    bodyDelayMs: 5_500,
    responseBody: {
      choices: [{ message: { content: '{"status":"ok"}' } }],
    },
  });
  const { context, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await optionsPage.getByRole("button", { name: "新增 LLM 配置" }).click();
    await optionsPage.getByLabel("名称").fill("较慢兼容服务");
    await optionsPage.getByLabel("模型").fill("slow-compatible-model");
    await optionsPage.getByLabel("API Key").fill("local-secret");
    await optionsPage.getByLabel("服务地址").fill(fakeServer.endpoint);
    await optionsPage.getByRole("button", { name: "测试连接" }).click();

    await expect(optionsPage.getByText("连接成功")).toBeVisible({
      timeout: 8_000,
    });
    expect(fakeServer.receivedRequests).toHaveLength(1);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("Qwen 预设要求用户替换 Workspace ID", async () => {
  const { context, optionsPage } = await launchExtension();

  try {
    await optionsPage.getByRole("button", { name: "新增 LLM 配置" }).click();
    await selectModelPreset(optionsPage, /Qwen 3\.7 Plus/);
    await optionsPage.getByLabel("API Key").fill("local-secret");
    await optionsPage.getByRole("button", { name: "保存配置" }).click();

    await expect(
      optionsPage.getByText(
        "请先将 YOUR-WORKSPACE-ID 替换为百炼业务空间 ID。",
      ),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("用户新增的 LLM 配置在设置页面重新打开后仍然存在", async () => {
  const { context, optionsPage } = await launchExtension();

  await saveConfiguration(optionsPage, {
    name: "本地测试",
    requestParameters: '{"temperature":0.2}',
    customHeaders: '{"X-Test":"yes"}',
  });

  await optionsPage.reload();
  await expect(optionsPage.getByText("本地测试")).toBeVisible();
  await expect(optionsPage.getByText("fake-model")).toBeVisible();
  await expect(
    optionsPage.getByRole("radio", { name: "使用 本地测试" }),
  ).toBeChecked();
  await expect(
    optionsPage
      .locator(".configuration-card")
      .filter({ hasText: "本地测试" })
      .getByText("当前使用"),
  ).toBeVisible();

  await context.close();
});

test("多个 LLM 配置可以选择当前使用项并外显选中状态", async () => {
  const { context, optionsPage } = await launchExtension();

  try {
    await saveConfiguration(optionsPage, {
      name: "日常翻译",
      model: "daily-model",
    });
    await saveConfiguration(optionsPage, {
      name: "长文翻译",
      model: "long-form-model",
    });

    const dailyConfiguration = optionsPage
      .locator(".configuration-card")
      .filter({ hasText: "日常翻译" });
    const longFormConfiguration = optionsPage
      .locator(".configuration-card")
      .filter({ hasText: "长文翻译" });

    await longFormConfiguration
      .getByRole("radio", { name: "使用 长文翻译" })
      .check();

    await expect(
      longFormConfiguration.getByRole("radio", { name: "使用 长文翻译" }),
    ).toBeChecked();
    await expect(longFormConfiguration.getByText("当前使用")).toBeVisible();
    await expect(dailyConfiguration.getByText("当前使用")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("当前使用的 LLM 配置在设置页面重新打开后仍然保留", async () => {
  const { context, optionsPage } = await launchExtension();

  try {
    await saveConfiguration(optionsPage, { name: "日常翻译" });
    await saveConfiguration(optionsPage, { name: "长文翻译" });
    await optionsPage
      .getByRole("radio", { name: "使用 长文翻译" })
      .check();

    await optionsPage.reload();

    await expect(
      optionsPage.getByRole("radio", { name: "使用 长文翻译" }),
    ).toBeChecked();
    await expect(
      optionsPage
        .locator(".configuration-card")
        .filter({ hasText: "长文翻译" })
        .getByText("当前使用"),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("用户可以编辑已有的 LLM 配置", async () => {
  const { context, optionsPage } = await launchExtension();

  await saveConfiguration(optionsPage, {
    name: "修改前",
    apiKey: "old-secret",
    model: "old-model",
  });

  await optionsPage.getByRole("button", { name: "编辑 修改前" }).click();
  await optionsPage.getByLabel("名称").fill("修改后");
  await optionsPage.getByLabel("API Key").fill("new-secret");
  await optionsPage.getByLabel("模型").fill("new-model");
  await optionsPage.getByLabel("请求参数").fill('{"temperature":0.4}');
  await optionsPage.getByRole("button", { name: "保存配置" }).click();

  await optionsPage.reload();
  await expect(optionsPage.getByText("修改后")).toBeVisible();
  await expect(optionsPage.getByText("new-model")).toBeVisible();
  await expect(optionsPage.getByText("修改前")).toHaveCount(0);

  await context.close();
});

test("用户可以删除已有的 LLM 配置", async () => {
  const { context, optionsPage } = await launchExtension();

  await saveConfiguration(optionsPage, { name: "待删除" });

  await optionsPage.getByRole("button", { name: "删除 待删除" }).click();
  await optionsPage.reload();

  await expect(optionsPage.getByText("待删除")).toHaveCount(0);
  await expect(optionsPage.getByText("还没有 LLM 配置")).toBeVisible();

  await context.close();
});

test("删除当前使用的 LLM 配置后自动使用剩余配置", async () => {
  const { context, optionsPage } = await launchExtension();

  try {
    await saveConfiguration(optionsPage, { name: "保留配置" });
    await saveConfiguration(optionsPage, { name: "待删除配置" });
    await optionsPage
      .getByRole("radio", { name: "使用 待删除配置" })
      .check();

    await optionsPage
      .getByRole("button", { name: "删除 待删除配置" })
      .click();

    await expect(
      optionsPage.getByRole("radio", { name: "使用 保留配置" }),
    ).toBeChecked();
    await expect(
      optionsPage
        .locator(".configuration-card")
        .filter({ hasText: "保留配置" })
        .getByText("当前使用"),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("设置页面明确说明 API Key 的本地存储与安全边界", async () => {
  const { context, optionsPage } = await launchExtension();

  await expect(
    optionsPage.getByText("API Key 仅保存在此浏览器的本地存储中"),
  ).toBeVisible();
  await expect(
    optionsPage.getByText("浏览器扩展环境无法绝对隐藏 API Key"),
  ).toBeVisible();

  await context.close();
});

test("用户可以通过本地 fake OpenAI-compatible server 验证 LLM 配置", async () => {
  const fakeServer = await startFakeOpenAiServer();
  const { context, optionsPage } = await launchExtension();

  try {
    await saveConfiguration(optionsPage, {
      name: "本地连接",
      endpoint: fakeServer.endpoint,
      requestParameters: '{"temperature":0.2}',
      customHeaders: '{"X-Test":"yes"}',
    });

    await optionsPage
      .getByRole("button", { name: "测试连接 本地连接" })
      .click();

    await expect(optionsPage.getByText("连接成功")).toBeVisible();
    const received = await fakeServer.receivedRequest;
    expect({
      path: received.path,
      authorization: received.headers.authorization,
      customHeader: received.headers["x-test"],
      body: received.body,
    }).toEqual({
      path: "/v1/chat/completions",
      authorization: "Bearer local-secret",
      customHeader: "yes",
      body: {
        model: "fake-model",
        messages: [{ role: "user", content: "Reply with OK." }],
        temperature: 0.2,
      },
    });
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("JSON mode 配置的连接测试发送 JSON 探测消息", async () => {
  const fakeServer = await startFakeOpenAiServer();
  const { context, optionsPage } = await launchExtension();

  try {
    await saveConfiguration(optionsPage, {
      name: "JSON mode 连接",
      endpoint: fakeServer.endpoint,
      requestParameters: '{"response_format":{"type":"json_object"}}',
    });

    await optionsPage
      .getByRole("button", { name: "测试连接 JSON mode 连接" })
      .click();

    await expect(optionsPage.getByText("连接成功")).toBeVisible();
    const received = await fakeServer.receivedRequest;
    expect(received.body).toMatchObject({
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: 'Return JSON only: {"status":"ok"}.',
        },
      ],
    });
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("连接测试明确显示认证失败", async () => {
  const fakeServer = await startFakeOpenAiServer({ statusCode: 401 });
  const { context, optionsPage } = await launchExtension();

  try {
    await saveConfiguration(optionsPage, {
      name: "认证失败配置",
      endpoint: fakeServer.endpoint,
      apiKey: "wrong-secret",
    });

    await optionsPage
      .getByRole("button", { name: "测试连接 认证失败配置" })
      .click();

    await expect(
      optionsPage.getByText("认证失败：请检查 API Key"),
    ).toBeVisible();
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("连接测试明确显示网络失败", async () => {
  const unavailableServer = await startFakeOpenAiServer();
  const unavailableEndpoint = unavailableServer.endpoint;
  await unavailableServer.close();
  const { context, optionsPage } = await launchExtension();

  try {
    await saveConfiguration(optionsPage, {
      name: "网络失败配置",
      endpoint: unavailableEndpoint,
    });

    await optionsPage
      .getByRole("button", { name: "测试连接 网络失败配置" })
      .click();

    await expect(
      optionsPage.getByText("网络失败：无法连接到服务地址"),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("连接测试明确显示 CORS 失败", async () => {
  const fakeServer = await startFakeOpenAiServer({ cors: false });
  const { context, optionsPage } = await launchExtension();

  try {
    await saveConfiguration(optionsPage, {
      name: "CORS 失败配置",
      endpoint: fakeServer.endpoint,
    });

    await optionsPage
      .getByRole("button", { name: "测试连接 CORS 失败配置" })
      .click();

    await expect(
      optionsPage.getByText("CORS 失败：服务未允许浏览器跨域请求"),
    ).toBeVisible();
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("连接测试不会把不兼容响应误报为成功", async () => {
  const fakeServer = await startFakeOpenAiServer({
    responseBody: { status: "not-an-openai-response" },
  });
  const { context, optionsPage } = await launchExtension();

  try {
    await saveConfiguration(optionsPage, {
      name: "响应不兼容配置",
      endpoint: fakeServer.endpoint,
    });

    await optionsPage
      .getByRole("button", { name: "测试连接 响应不兼容配置" })
      .click();

    await expect(
      optionsPage.getByText("连接失败：服务响应不兼容 OpenAI 接口"),
    ).toBeVisible();
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("POST 请求不可达时显示网络失败而不是 CORS 失败", async () => {
  const fakeServer = await startFakeOpenAiServer({ disconnectPost: true });
  const { context, optionsPage } = await launchExtension();

  try {
    await saveConfiguration(optionsPage, {
      name: "POST 网络失败配置",
      endpoint: fakeServer.endpoint,
    });

    await optionsPage
      .getByRole("button", { name: "测试连接 POST 网络失败配置" })
      .click();

    await expect(
      optionsPage.getByText("网络失败：无法连接到服务地址"),
    ).toBeVisible();
    await expect(
      optionsPage.getByText("CORS 失败：服务未允许浏览器跨域请求"),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("设置存储失败时显示错误且不产生未捕获异常", async () => {
  const { context, optionsPage } = await launchExtension();

  try {
    const pageErrors: string[] = [];
    optionsPage.on("pageerror", (error) => pageErrors.push(error.message));
    await optionsPage.evaluate(() => {
      Object.defineProperty(chrome.storage.local, "set", {
        value: async () => {
          throw new Error("Storage is temporarily unavailable.");
        },
      });
    });
    await optionsPage.getByLabel("全局目标语言").selectOption("ja");

    await optionsPage
      .getByRole("button", { name: "保存全局目标语言" })
      .click();

    await expect(
      optionsPage.getByText("全局目标语言保存失败，请重试"),
    ).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("划词翻译同步失败时回滚界面和已保存设置", async () => {
  const { context, optionsPage } = await launchExtension({
    hostPermissions: ["http://*/*", "https://*/*"],
  });

  try {
    const pageErrors: string[] = [];
    optionsPage.on("pageerror", (error) => pageErrors.push(error.message));
    await optionsPage.evaluate(() => {
      Object.defineProperty(chrome.runtime, "sendMessage", {
        value: async () => {
          throw new Error("Extension context invalidated.");
        },
      });
    });
    const selectionTranslation = optionsPage.getByLabel(
      "在所有网站启用划词翻译",
    );

    await selectionTranslation.click();

    await expect(selectionTranslation).not.toBeChecked();
    await expect(
      optionsPage.getByText("划词翻译设置失败，请重试"),
    ).toBeVisible();
    await optionsPage.reload();
    await expect(selectionTranslation).not.toBeChecked();
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
