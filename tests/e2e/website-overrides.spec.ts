import { expect, test, type Page } from "@playwright/test";
import { launchExtension } from "./extension";
import {
  startFakeOpenAiServer,
  type ReceivedOpenAiRequest,
} from "./fake-openai-server";
import type { WebsiteOverride } from "../../src/website-overrides";

async function saveConfiguration(page: Page, endpoint: string): Promise<void> {
  await page.getByRole("button", { name: "新增 LLM 配置" }).click();
  await page.getByLabel("名称").fill("网站覆盖设置");
  await page.getByLabel("服务地址").fill(endpoint);
  await page.getByLabel("API Key").fill("website-secret");
  await page.getByLabel("模型").fill("website-model");
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

async function saveWebsiteOverride(
  extensionPage: Page,
  override: WebsiteOverride,
): Promise<void> {
  await extensionPage.evaluate(
    (storedOverride) =>
      chrome.storage.local.set({
        websiteOverrides: {
          [storedOverride.origin]: storedOverride,
        },
      }),
    override,
  );
}

function translationInput(request: ReceivedOpenAiRequest): {
  targetLanguage: string;
} {
  const body = request.body as {
    messages: Array<{ role: string; content: string }>;
  };
  return JSON.parse(body.messages.at(-1)?.content ?? "{}") as {
    targetLanguage: string;
  };
}

function systemMessage(request: ReceivedOpenAiRequest): string {
  const body = request.body as {
    messages: Array<{ role: string; content: string }>;
  };
  return (
    body.messages.find(({ role }) => role === "system")?.content ?? ""
  );
}

test("全局目标语言默认中文并可从下拉框选择后持续生效", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Hello website.</p></main>",
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [{ id: "block-0", text: "网站翻译。" }],
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
    const targetLanguage = optionsPage.getByLabel("全局目标语言");
    await expect(targetLanguage).toHaveJSProperty("tagName", "SELECT");
    await expect(targetLanguage).toHaveValue("zh-CN");
    await expect(targetLanguage.locator("option")).toHaveText([
      "中文（简体）",
      "中文（繁体）",
      "英语",
      "日语",
      "韩语",
      "法语",
      "德语",
      "西班牙语",
      "葡萄牙语",
      "意大利语",
      "俄语",
    ]);

    const defaultLanguagePage = await context.newPage();
    await defaultLanguagePage.goto(fakeServer.pageUrl);
    await translateCurrentPage(context, extensionId, defaultLanguagePage);
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(1);
    expect(translationInput(fakeServer.receivedRequests[0]!)).toMatchObject({
      targetLanguage: "zh-CN",
    });

    await optionsPage.bringToFront();
    await targetLanguage.selectOption("ja");
    await optionsPage
      .getByRole("button", { name: "保存全局目标语言" })
      .click();
    await expect(optionsPage.getByText("全局目标语言已保存")).toBeVisible();
    await optionsPage.reload();
    await expect(optionsPage.getByLabel("全局目标语言")).toHaveValue("ja");

    const globalLanguagePage = await context.newPage();
    await globalLanguagePage.goto(fakeServer.pageUrl);
    await translateCurrentPage(context, extensionId, globalLanguagePage);
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(2);
    expect(translationInput(fakeServer.receivedRequests[1]!)).toMatchObject({
      targetLanguage: "ja",
    });
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("网站覆盖设置替代全局目标语言和翻译提示词", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Review this agreement.</p></main>",
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [
                { id: "block-0", text: "Prüfen Sie diese Vereinbarung." },
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
    await optionsPage.getByLabel("全局目标语言").selectOption("ja");
    await optionsPage
      .getByRole("button", { name: "保存全局目标语言" })
      .click();
    await optionsPage
      .getByLabel("全局翻译提示词")
      .fill("Use the global general-purpose style.");
    await optionsPage
      .getByRole("button", { name: "保存翻译提示词" })
      .click();

    await saveWebsiteOverride(optionsPage, {
      origin: new URL(fakeServer.pageUrl).origin,
      targetLanguage: "de",
      translationPrompt: "Use precise legal terminology.",
      automaticTranslation: false,
      selectionTranslation: "inherit",
    });
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);

    await translateCurrentPage(context, extensionId, page);
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(1);
    expect(translationInput(fakeServer.receivedRequests[0]!)).toMatchObject({
      targetLanguage: "de",
    });
    expect(systemMessage(fakeServer.receivedRequests[0]!)).toContain(
      "Use precise legal terminology.",
    );
    expect(systemMessage(fakeServer.receivedRequests[0]!)).not.toContain(
      "Use the global general-purpose style.",
    );
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("设置页保留历史上保存的自定义全局目标语言", async () => {
  const { context, optionsPage } = await launchExtension();

  try {
    await optionsPage.evaluate(() =>
      chrome.storage.local.set({
        globalTranslationPreferences: {
          targetLanguage: "nl",
          selectionTranslationEnabled: false,
        },
      }),
    );

    await optionsPage.reload();

    const targetLanguage = optionsPage.getByLabel("全局目标语言");
    await expect(targetLanguage).toHaveValue("nl");
    await expect(
      targetLanguage.locator('option[value="nl"]'),
    ).toHaveText("已保存的自定义语言（nl）");
  } finally {
    await context.close();
  }
});

test("已保存的网站自动翻译设置继续作用于后续页面", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Translate automatically.</p></main>",
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [{ id: "block-0", text: "自动翻译。" }],
            }),
          },
        },
      ],
    },
  });
  const { context, optionsPage } = await launchExtension({
    browserLanguage: "zh-CN",
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await page.waitForTimeout(250);
    expect(fakeServer.receivedRequests).toHaveLength(0);

    await saveWebsiteOverride(optionsPage, {
      origin: new URL(fakeServer.pageUrl).origin,
      targetLanguage: "",
      translationPrompt: "",
      automaticTranslation: true,
      selectionTranslation: "inherit",
    });

    await page.reload();
    await expect(page.getByText("自动翻译。")).toBeVisible();
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(1);

    await saveWebsiteOverride(optionsPage, {
      origin: new URL(fakeServer.pageUrl).origin,
      targetLanguage: "",
      translationPrompt: "",
      automaticTranslation: false,
      selectionTranslation: "inherit",
    });

    await page.reload();
    await expect
      .poll(() => fakeServer.receivedRequests, { timeout: 500 })
      .toHaveLength(1);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("网站自动翻译进行中关闭标签页不会产生后台未捕获错误", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Close an automatically translated tab.</p></main>",
    responseDelayMs: 300,
  });
  const { context, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const webErrors: string[] = [];
    context.on("weberror", (webError) => {
      webErrors.push(webError.error().message);
    });
    await saveWebsiteOverride(optionsPage, {
      origin: new URL(fakeServer.pageUrl).origin,
      targetLanguage: "",
      translationPrompt: "",
      automaticTranslation: true,
      selectionTranslation: "inherit",
    });
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await fakeServer.receivedRequest;
    await page.close();
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(webErrors).toEqual([]);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});
