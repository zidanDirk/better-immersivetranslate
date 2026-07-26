import { expect, test } from "@playwright/test";
import { launchExtension } from "./extension";
import {
  startFakeOpenAiServer,
  type ReceivedOpenAiRequest,
} from "./fake-openai-server";
import {
  saveMinimalLlmConfiguration,
  translationCompletion,
  triggerCurrentPageTranslation,
} from "./translation-test-support";

function requestBody(request: ReceivedOpenAiRequest): {
  messages: Array<{ role: string; content: string }>;
} {
  return request.body as {
    messages: Array<{ role: string; content: string }>;
  };
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
        responseBody: translationCompletion(
          Array.from({ length: 10 }, (_, index) => ({
            id: `block-${index}`,
            text: `Translation ${index + 1}`,
          })),
        ),
      },
      {
        delayMs: 500,
        responseBody: translationCompletion([
          { id: "block-10", text: "Translation 11" },
        ]),
      },
    ],
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveMinimalLlmConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    const firstSource = page.getByText("Source 1", { exact: true });
    const sourcePositionBeforeTranslation = await firstSource.boundingBox();

    await triggerCurrentPageTranslation(context, extensionId, page);

    const progress = page.getByRole("region", { name: "翻译进度" });
    await expect(progress).toBeVisible();
    await expect(progress).toContainText("正在翻译：已完成 0/2 批次");
    await expect(progress).toHaveCSS("position", "fixed");
    const sourcePositionDuringTranslation = await firstSource.boundingBox();
    expect(sourcePositionBeforeTranslation).not.toBeNull();
    expect(sourcePositionDuringTranslation).not.toBeNull();
    expect(sourcePositionDuringTranslation).toMatchObject({
      x: sourcePositionBeforeTranslation!.x,
      y: sourcePositionBeforeTranslation!.y,
    });
    await expect(progress).toContainText("正在翻译：已完成 1/2 批次");
    await expect(progress).toHaveCount(0);
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
    await saveMinimalLlmConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);

    await triggerCurrentPageTranslation(context, extensionId, page);

    const progress = page.getByRole("region", { name: "翻译进度" });
    await expect(
      progress.getByText("批次 1：认证失败：请检查 API Key"),
    ).toBeVisible();
    expect(fakeServer.receivedRequests).toHaveLength(1);
    await expect(page.getByText("Original remains readable.")).toBeVisible();
    await page.getByRole("button", { name: "继续使用页面" }).click();
    await expect(page.getByText("页面仍可交互")).toBeVisible();
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("批次限流失败后自动重试并恢复译文", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Rate limited source.</p></main>",
    responseSequence: [
      { statusCode: 429 },
      {
        responseBody: translationCompletion([
          { id: "block-0", text: "Recovered after rate limit." },
        ]),
      },
    ],
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveMinimalLlmConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);

    await triggerCurrentPageTranslation(context, extensionId, page);

    await expect(
      page.getByText("Recovered after rate limit.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "翻译进度" }),
    ).toHaveCount(0);
    expect(fakeServer.receivedRequests).toHaveLength(2);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("批次超时后自动重试并恢复译文", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Slow source.</p></main>",
    responseSequence: [
      {
        delayMs: 6_000,
        responseBody: translationCompletion([
          { id: "block-0", text: "Late translation." },
        ]),
      },
      {
        responseBody: translationCompletion([
          { id: "block-0", text: "Recovered after timeout." },
        ]),
      },
    ],
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveMinimalLlmConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);

    await triggerCurrentPageTranslation(context, extensionId, page);

    await expect(
      page.getByText("Recovered after timeout.", { exact: true }),
    ).toBeVisible({ timeout: 8_000 });
    await expect(
      page.getByRole("region", { name: "翻译进度" }),
    ).toHaveCount(0);
    expect(fakeServer.receivedRequests).toHaveLength(2);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("批次 CORS 失败时显示明确原因", async () => {
  const providerServer = await startFakeOpenAiServer({
    cors: false,
    responseBody: translationCompletion([{ id: "block-0", text: "CORS translation." }]),
  });
  const pageServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>CORS source.</p></main>",
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: [`${new URL(pageServer.pageUrl).origin}/*`],
  });

  try {
    await saveMinimalLlmConfiguration(optionsPage, providerServer.endpoint);
    const page = await context.newPage();
    await page.goto(pageServer.pageUrl);

    await triggerCurrentPageTranslation(context, extensionId, page);

    await expect(
      page
        .getByRole("region", { name: "翻译进度" })
        .getByText("批次 1：CORS 失败：服务未允许浏览器跨域请求"),
    ).toBeVisible();
    expect(providerServer.receivedRequests).toHaveLength(0);
    expect(providerServer.receivedPreflightRequests).toHaveLength(1);
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
  const failedTranslationRequests: string[] = [];
  context.on("requestfailed", (request) => {
    if (
      request.method() === "POST" &&
      request.url().startsWith(unavailableEndpoint)
    ) {
      failedTranslationRequests.push(request.url());
    }
  });

  try {
    await saveMinimalLlmConfiguration(optionsPage, unavailableEndpoint);
    const page = await context.newPage();
    await page.goto(pageServer.pageUrl);

    await triggerCurrentPageTranslation(context, extensionId, page);

    await expect(
      page
        .getByRole("region", { name: "翻译进度" })
        .getByText("批次 1：网络失败：无法连接到服务地址"),
    ).toBeVisible();
    expect(failedTranslationRequests).toHaveLength(4);
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
    await saveMinimalLlmConfiguration(optionsPage, providerServer.endpoint);
    const page = await context.newPage();
    await page.goto(pageServer.pageUrl);

    await triggerCurrentPageTranslation(context, extensionId, page);

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

test("批次响应格式无效后自动重试并恢复译文", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Invalid response source.</p></main>",
    responseSequence: [
      { responseBody: { status: "not-an-openai-response" } },
      {
        responseBody: translationCompletion([
          { id: "block-0", text: "Recovered after invalid response." },
        ]),
      },
    ],
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveMinimalLlmConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);

    await triggerCurrentPageTranslation(context, extensionId, page);

    await expect(
      page.getByText("Recovered after invalid response.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "翻译进度" }),
    ).toHaveCount(0);
    expect(fakeServer.receivedRequests).toHaveLength(2);
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

    await triggerCurrentPageTranslation(context, extensionId, page);

    const progress = page.getByRole("region", { name: "翻译进度" });
    await expect(
      progress.getByText("批次 1：配置失败：请先添加 LLM 配置"),
    ).toBeVisible({ timeout: 500 });
    await expect(progress.getByText("批次 1：已完成")).toHaveCount(0);
    await expect(
      progress.getByRole("button", { name: "重试批次 1" }),
    ).toBeVisible();
  } finally {
    await context.close();
    await pageServer.close();
  }
});

test("限流失败自动重试三次后保留失败提示和单次手动重试", async () => {
  const paragraphs = Array.from(
    { length: 11 },
    (_, index) => `<p>Retry source ${index + 1}</p>`,
  ).join("");
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `<main>${paragraphs}</main>`,
    responseSequence: [
      {
        responseBody: translationCompletion(
          Array.from({ length: 10 }, (_, index) => ({
            id: `block-${index}`,
            text: `Completed translation ${index + 1}`,
          })),
        ),
      },
      ...Array.from({ length: 5 }, () => ({ statusCode: 429 })),
      {
        delayMs: 250,
        responseBody: translationCompletion([
          { id: "block-10", text: "Recovered translation 11" },
        ]),
      },
    ],
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveMinimalLlmConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);

    const automaticRetryStartedAt = Date.now();
    await triggerCurrentPageTranslation(context, extensionId, page);

    const progress = page.getByRole("region", { name: "翻译进度" });
    await expect(progress).toContainText(
      "翻译进度：已完成 1/2 批次，失败 1 批次",
    );
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

    await expect
      .poll(() => fakeServer.receivedRequests.length)
      .toBe(5);
    const automaticRetryElapsedMs = Date.now() - automaticRetryStartedAt;
    expect(automaticRetryElapsedMs).toBeGreaterThanOrEqual(650);
    expect(automaticRetryElapsedMs).toBeLessThan(5_000);

    await retryButton.click();

    await expect
      .poll(() => fakeServer.receivedRequests.length)
      .toBe(6);
    await expect(
      progress.getByText("批次 2：请求受限：请稍后手动重试"),
    ).toBeVisible();

    await progress.getByRole("button", { name: "重试批次 2" }).click();

    await expect(progress).toHaveCount(0);
    await expect(
      page.getByText("Recovered translation 11", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Completed translation 1", { exact: true }),
    ).toHaveCount(1);
    expect(fakeServer.receivedRequests).toHaveLength(7);
    const retriedInput = JSON.parse(
      requestBody(fakeServer.receivedRequests[6]).messages.at(-1)?.content ??
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
