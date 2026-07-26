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

  await context.close();
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
    await optionsPage.getByLabel("全局目标语言").fill("ja");

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

    await selectionTranslation.check();

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
