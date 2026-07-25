import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { launchExtension } from "./extension";
import {
  startFakeOpenAiServer,
  type ReceivedOpenAiRequest,
} from "./fake-openai-server";

async function saveConfiguration(page: Page, endpoint: string): Promise<void> {
  await page.getByRole("button", { name: "新增 LLM 配置" }).click();
  await page.getByLabel("名称").fill("静态网页翻译");
  await page.getByLabel("服务地址").fill(endpoint);
  await page.getByLabel("API Key").fill("translation-secret");
  await page.getByLabel("模型").fill("translation-model");
  await page.getByLabel("请求参数").fill('{"temperature":0.2}');
  await page.getByLabel("自定义请求头").fill('{"X-Test":"manual"}');
  await page.getByRole("button", { name: "保存配置" }).click();
}

async function translateCurrentPage(
  context: Awaited<ReturnType<typeof launchExtension>>["context"],
  extensionId: string,
  page: Page,
): Promise<void> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.bringToFront();
  await popup.getByRole("button", { name: "翻译当前网页" }).click();
  await expect.poll(() => popup.isClosed()).toBe(true);
}

function requestBody(request: ReceivedOpenAiRequest): {
  messages: Array<{ role: string; content: string }>;
  model: string;
  temperature: number;
} {
  return request.body as {
    messages: Array<{ role: string; content: string }>;
    model: string;
    temperature: number;
  };
}

test("用户主动触发后翻译当前静态网页", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml:
      "<main><p>Hello world.</p><p> </p><p>Good night.</p></main>",
    responseDelayMs: 250,
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [
                { id: "block-1", text: "晚安。" },
                { id: "block-0", text: "你好，世界。" },
              ],
            }),
          },
        },
      ],
    },
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    browserLanguage: "fr-FR",
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);

    await page.waitForTimeout(250);
    expect(fakeServer.receivedRequests).toHaveLength(0);
    await expect(page.getByText("你好，世界。")).toHaveCount(0);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    await popup.getByRole("button", { name: "翻译当前网页" }).click();

    const received = await fakeServer.receivedRequest;
    expect(popup.isClosed()).toBe(false);
    await expect(page.getByText("你好，世界。")).toHaveCount(0);
    await expect(page.getByText("晚安。")).toHaveCount(0);
    await expect(page.getByText("Hello world.")).toBeVisible();
    await expect(page.getByText("你好，世界。")).toBeVisible();
    await expect(page.getByText("Good night.")).toBeVisible();
    await expect(page.getByText("晚安。")).toBeVisible();
    await expect.poll(() => popup.isClosed()).toBe(true);
    const body = requestBody(received);
    const translationInput = JSON.parse(
      body.messages.at(-1)?.content ?? "{}",
    ) as unknown;
    expect({
      path: received.path,
      authorization: received.headers.authorization,
      customHeader: received.headers["x-test"],
      model: body.model,
      temperature: body.temperature,
      translationInput,
    }).toEqual({
      path: "/v1/chat/completions",
      authorization: "Bearer translation-secret",
      customHeader: "manual",
      model: "translation-model",
      temperature: 0.2,
      translationInput: {
        sourceLanguage: "auto",
        targetLanguage: "fr-FR",
        blocks: [
          { id: "block-0", text: "Hello world." },
          { id: "block-1", text: "Good night." },
        ],
      },
    });
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("正式扩展默认只请求当前页面权限", async () => {
  const manifest = JSON.parse(
    await readFile("dist/manifest.json", "utf8"),
  ) as {
    host_permissions?: string[];
    permissions: string[];
  };

  expect(manifest.permissions).toEqual(["activeTab", "scripting", "storage"]);
  expect(manifest.host_permissions).toBeUndefined();
});

test("重复的翻译任务复用本地翻译缓存", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Hello world.</p></main>",
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [{ id: "block-0", text: "你好，世界。" }],
            }),
          },
        },
      ],
    },
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    browserLanguage: "zh-CN",
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const firstPage = await context.newPage();
    await firstPage.goto(fakeServer.pageUrl);
    await translateCurrentPage(context, extensionId, firstPage);
    await expect(firstPage.getByText("你好，世界。")).toBeVisible();
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(1);

    const repeatedPage = await context.newPage();
    await repeatedPage.goto(fakeServer.pageUrl);
    await translateCurrentPage(context, extensionId, repeatedPage);

    await expect(repeatedPage.getByText("你好，世界。")).toBeVisible();
    await expect
      .poll(() => fakeServer.receivedRequests, { timeout: 500 })
      .toHaveLength(1);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("用户可以一键清空本地翻译缓存", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Hello world.</p></main>",
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [{ id: "block-0", text: "你好，世界。" }],
            }),
          },
        },
      ],
    },
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    browserLanguage: "zh-CN",
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const firstPage = await context.newPage();
    await firstPage.goto(fakeServer.pageUrl);
    await translateCurrentPage(context, extensionId, firstPage);
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(1);

    await optionsPage.bringToFront();
    await optionsPage
      .getByRole("button", { name: "清空翻译缓存" })
      .click();
    await expect(optionsPage.getByText("翻译缓存已清空")).toBeVisible();

    const pageAfterClearing = await context.newPage();
    await pageAfterClearing.goto(fakeServer.pageUrl);
    await translateCurrentPage(context, extensionId, pageAfterClearing);

    await expect(pageAfterClearing.getByText("你好，世界。")).toBeVisible();
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(2);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("模型和相关请求参数变化后不复用旧译文", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Hello world.</p></main>",
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [{ id: "block-0", text: "你好，世界。" }],
            }),
          },
        },
      ],
    },
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    browserLanguage: "zh-CN",
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const firstPage = await context.newPage();
    await firstPage.goto(fakeServer.pageUrl);
    await translateCurrentPage(context, extensionId, firstPage);
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(1);

    await optionsPage.bringToFront();
    await optionsPage
      .getByRole("button", { name: "编辑 静态网页翻译" })
      .click();
    await optionsPage.getByLabel("模型").fill("changed-model");
    await optionsPage
      .getByLabel("请求参数")
      .fill('{"temperature":0.7,"top_p":0.8}');
    await optionsPage.getByRole("button", { name: "保存配置" }).click();

    const pageAfterConfigurationChange = await context.newPage();
    await pageAfterConfigurationChange.goto(fakeServer.pageUrl);
    await translateCurrentPage(
      context,
      extensionId,
      pageAfterConfigurationChange,
    );

    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(2);
    expect(requestBody(fakeServer.receivedRequests[1]!)).toMatchObject({
      model: "changed-model",
      temperature: 0.7,
    });
  } finally {
    await context.close();
    await fakeServer.close();
  }
});
