import { expect, test, type Page } from "@playwright/test";
import { launchExtension } from "./extension";
import {
  startFakeOpenAiServer,
  type ReceivedOpenAiRequest,
} from "./fake-openai-server";

async function saveConfiguration(page: Page, endpoint: string): Promise<void> {
  await page.getByRole("button", { name: "新增 LLM 配置" }).click();
  await page.getByLabel("名称").fill("批次恢复测试");
  await page.getByLabel("服务地址").fill(endpoint);
  await page.getByLabel("API Key").fill("translation-secret");
  await page.getByLabel("模型").fill("translation-model");
  await page.getByRole("button", { name: "保存配置" }).click();
}

function completion(
  translations: Array<{ id: string; text: string }>,
): unknown {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({ translations }),
        },
      },
    ],
  };
}

function requestBody(request: ReceivedOpenAiRequest): {
  messages: Array<{ role: string; content: string }>;
} {
  return request.body as {
    messages: Array<{ role: string; content: string }>;
  };
}

async function triggerTranslation(
  context: Awaited<ReturnType<typeof launchExtension>>["context"],
  extensionId: string,
  page: Page,
): Promise<void> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.bringToFront();
  await popup.getByRole("button", { name: "翻译当前网页" }).click();
}

test("翻译界面按批次显示等待、处理和完成状态", async () => {
  const paragraphs = Array.from(
    { length: 11 },
    (_, index) => `<p>Source ${index + 1}</p>`,
  ).join("");
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `<main>${paragraphs}</main>`,
    responseSequence: [
      {
        delayMs: 500,
        responseBody: completion(
          Array.from({ length: 10 }, (_, index) => ({
            id: `block-${index}`,
            text: `Translation ${index + 1}`,
          })),
        ),
      },
      {
        delayMs: 500,
        responseBody: completion([
          { id: "block-10", text: "Translation 11" },
        ]),
      },
    ],
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);

    await triggerTranslation(context, extensionId, page);

    const progress = page.getByRole("region", { name: "翻译进度" });
    await expect(progress.getByText("批次 1：处理中")).toBeVisible();
    await expect(progress.getByText("批次 2：等待中")).toBeVisible();
    await expect(progress.getByText("批次 1：已完成")).toBeVisible();
    await expect(progress.getByText("批次 2：处理中")).toBeVisible();
    await expect(progress.getByText("批次 2：已完成")).toBeVisible();
    await expect(page.getByText("Translation 1", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Translation 11", { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("批次认证失败时显示原因且原文和页面交互仍可用", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `
      <main>
        <p>Original remains readable.</p>
        <button id="interactive-button" type="button">继续使用页面</button>
        <output id="interaction-result"></output>
        <script>
          document.querySelector("#interactive-button").addEventListener("click", () => {
            document.querySelector("#interaction-result").textContent = "页面仍可交互";
          });
        </script>
      </main>
    `,
    statusCode: 401,
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);

    await triggerTranslation(context, extensionId, page);

    const progress = page.getByRole("region", { name: "翻译进度" });
    await expect(
      progress.getByText("批次 1：认证失败：请检查 API Key"),
    ).toBeVisible();
    await expect(page.getByText("Original remains readable.")).toBeVisible();
    await page.getByRole("button", { name: "继续使用页面" }).click();
    await expect(page.getByText("页面仍可交互")).toBeVisible();
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("批次限流失败时显示明确原因", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Rate limited source.</p></main>",
    statusCode: 429,
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);

    await triggerTranslation(context, extensionId, page);

    await expect(
      page
        .getByRole("region", { name: "翻译进度" })
        .getByText("批次 1：请求受限：请稍后手动重试"),
    ).toBeVisible();
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("批次超时时显示明确原因", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Slow source.</p></main>",
    responseDelayMs: 6_000,
    responseBody: completion([{ id: "block-0", text: "Late translation." }]),
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);

    await triggerTranslation(context, extensionId, page);

    await expect(
      page
        .getByRole("region", { name: "翻译进度" })
        .getByText("批次 1：请求超时：请手动重试"),
    ).toBeVisible({ timeout: 7_000 });
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("批次 CORS 失败时显示明确原因", async () => {
  const providerServer = await startFakeOpenAiServer({
    cors: false,
    responseBody: completion([{ id: "block-0", text: "CORS translation." }]),
  });
  const pageServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>CORS source.</p></main>",
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: [`${new URL(pageServer.pageUrl).origin}/*`],
  });

  try {
    await saveConfiguration(optionsPage, providerServer.endpoint);
    const page = await context.newPage();
    await page.goto(pageServer.pageUrl);

    await triggerTranslation(context, extensionId, page);

    await expect(
      page
        .getByRole("region", { name: "翻译进度" })
        .getByText("批次 1：CORS 失败：服务未允许浏览器跨域请求"),
    ).toBeVisible();
    expect(providerServer.receivedRequests).toHaveLength(0);
  } finally {
    await context.close();
    await providerServer.close();
    await pageServer.close();
  }
});

test("批次网络失败时显示明确原因", async () => {
  const unavailableProvider = await startFakeOpenAiServer();
  const unavailableEndpoint = unavailableProvider.endpoint;
  await unavailableProvider.close();
  const pageServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Network source.</p></main>",
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: [`${new URL(pageServer.pageUrl).origin}/*`],
  });

  try {
    await saveConfiguration(optionsPage, unavailableEndpoint);
    const page = await context.newPage();
    await page.goto(pageServer.pageUrl);

    await triggerTranslation(context, extensionId, page);

    await expect(
      page
        .getByRole("region", { name: "翻译进度" })
        .getByText("批次 1：网络失败：无法连接到服务地址"),
    ).toBeVisible();
  } finally {
    await context.close();
    await pageServer.close();
  }
});

test("目标 LLM 服务的翻译 POST 断流时显示网络失败而不是 CORS", async () => {
  const providerServer = await startFakeOpenAiServer({
    disconnectPost: true,
  });
  const pageServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Disconnected POST source.</p></main>",
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: [`${new URL(pageServer.pageUrl).origin}/*`],
  });

  try {
    await saveConfiguration(optionsPage, providerServer.endpoint);
    const page = await context.newPage();
    await page.goto(pageServer.pageUrl);

    await triggerTranslation(context, extensionId, page);

    const progress = page.getByRole("region", { name: "翻译进度" });
    await expect(
      progress.getByText("批次 1：网络失败：无法连接到服务地址"),
    ).toBeVisible();
    await expect(
      progress.getByText("批次 1：CORS 失败：服务未允许浏览器跨域请求"),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await providerServer.close();
    await pageServer.close();
  }
});

test("批次响应格式无效时显示明确原因", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Invalid response source.</p></main>",
    responseBody: { status: "not-an-openai-response" },
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);

    await triggerTranslation(context, extensionId, page);

    await expect(
      page
        .getByRole("region", { name: "翻译进度" })
        .getByText("批次 1：响应格式错误：服务未返回有效译文"),
    ).toBeVisible();
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("没有 LLM 配置时批次显示失败而不是完成", async () => {
  const pageServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Unconfigured source.</p></main>",
  });
  const { context, extensionId } = await launchExtension({
    hostPermissions: [`${new URL(pageServer.pageUrl).origin}/*`],
  });

  try {
    const page = await context.newPage();
    await page.goto(pageServer.pageUrl);

    await triggerTranslation(context, extensionId, page);

    const progress = page.getByRole("region", { name: "翻译进度" });
    await expect(
      progress.getByText("批次 1：配置失败：请先添加 LLM 配置"),
    ).toBeVisible();
    await expect(progress.getByText("批次 1：已完成")).toHaveCount(0);
    await expect(
      progress.getByRole("button", { name: "重试批次 1" }),
    ).toBeVisible();
  } finally {
    await context.close();
    await pageServer.close();
  }
});

test("用户只手动重试失败批次且扩展默认不自动重试", async () => {
  const paragraphs = Array.from(
    { length: 11 },
    (_, index) => `<p>Retry source ${index + 1}</p>`,
  ).join("");
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `<main>${paragraphs}</main>`,
    responseSequence: [
      {
        responseBody: completion(
          Array.from({ length: 10 }, (_, index) => ({
            id: `block-${index}`,
            text: `Completed translation ${index + 1}`,
          })),
        ),
      },
      { statusCode: 429 },
      {
        delayMs: 250,
        responseBody: completion([
          { id: "block-10", text: "Recovered translation 11" },
        ]),
      },
    ],
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);

    await triggerTranslation(context, extensionId, page);

    const progress = page.getByRole("region", { name: "翻译进度" });
    await expect(progress.getByText("批次 1：已完成")).toBeVisible();
    await expect(
      progress.getByText("批次 2：请求受限：请稍后手动重试"),
    ).toBeVisible();
    await expect(
      progress.getByRole("button", { name: "重试批次 1" }),
    ).toHaveCount(0);
    const retryButton = progress.getByRole("button", { name: "重试批次 2" });
    await expect(retryButton).toBeVisible();
    await expect(
      page.getByText("Retry source 11", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Recovered translation 11", { exact: true }),
    ).toHaveCount(0);

    await page.waitForTimeout(500);
    expect(fakeServer.receivedRequests).toHaveLength(2);

    await retryButton.click();

    await expect(progress.getByText("批次 2：处理中")).toBeVisible();
    await expect(progress.getByText("批次 2：已完成")).toBeVisible();
    await expect(
      page.getByText("Recovered translation 11", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Completed translation 1", { exact: true }),
    ).toHaveCount(1);
    expect(fakeServer.receivedRequests).toHaveLength(3);
    const retriedInput = JSON.parse(
      requestBody(fakeServer.receivedRequests[2]).messages.at(-1)?.content ??
        "{}",
    ) as { blocks?: unknown };
    expect(retriedInput.blocks).toEqual([
      { id: "block-10", text: "Retry source 11" },
    ]);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});
