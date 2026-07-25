import { expect, test, type Page } from "@playwright/test";
import { launchExtension } from "./extension";
import {
  startFakeOpenAiServer,
  type ReceivedOpenAiRequest,
} from "./fake-openai-server";

async function saveConfiguration(page: Page, endpoint: string): Promise<void> {
  await page.getByRole("button", { name: "新增 LLM 配置" }).click();
  await page.getByLabel("名称").fill("翻译指令测试");
  await page.getByLabel("服务地址").fill(endpoint);
  await page.getByLabel("API Key").fill("translation-secret");
  await page.getByLabel("模型").fill("translation-model");
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

function requestMessages(
  request: ReceivedOpenAiRequest,
): Array<{ role: string; content: string }> {
  return (
    request.body as {
      messages: Array<{ role: string; content: string }>;
    }
  ).messages;
}

test("用户编辑全局翻译提示词后实际请求使用本地保存的内容", async () => {
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
    const prompt = optionsPage.getByLabel("全局翻译提示词");
    await expect(prompt).toHaveValue(
      "Translate each semantic text block accurately and preserve its meaning, tone, and formatting.",
    );
    await prompt.fill("Use a concise, professional tone.");
    await optionsPage
      .getByRole("button", { name: "保存翻译提示词" })
      .click();
    await expect(optionsPage.getByText("翻译提示词已保存")).toBeVisible();

    await optionsPage.reload();
    await expect(optionsPage.getByLabel("全局翻译提示词")).toHaveValue(
      "Use a concise, professional tone.",
    );
    await saveConfiguration(optionsPage, fakeServer.endpoint);

    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await translateCurrentPage(context, extensionId, page);

    await expect(page.getByText("你好，世界。")).toBeVisible();
    const systemMessage = requestMessages(
      fakeServer.receivedRequests[0]!,
    ).find(({ role }) => role === "system")?.content;
    expect(systemMessage).toContain("Use a concise, professional tone.");
    expect(systemMessage).toContain(
      "Return JSON only with one translation for every supplied stable block id",
    );
    expect(systemMessage).toContain("Do not add explanations");
    expect(systemMessage).toContain("Preserve semantic formatting");
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("用户管理本地术语规则后实际请求要求固定译法", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>The LLM uses a translation cache.</p></main>",
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [
                { id: "block-0", text: "大语言模型使用翻译缓存。" },
              ],
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
    await optionsPage.getByRole("button", { name: "新增术语规则" }).click();
    await optionsPage.getByLabel("原文术语").fill("LLM");
    await optionsPage.getByLabel("固定译法").fill("语言模型");
    await optionsPage
      .getByRole("button", { name: "保存术语规则" })
      .click();
    await expect(optionsPage.getByText("LLM → 语言模型")).toBeVisible();

    await optionsPage
      .getByRole("button", { name: "编辑术语规则 LLM" })
      .click();
    await optionsPage.getByLabel("固定译法").fill("大语言模型");
    await optionsPage
      .getByRole("button", { name: "保存术语规则" })
      .click();
    await expect(optionsPage.getByText("LLM → 大语言模型")).toBeVisible();

    await optionsPage.getByRole("button", { name: "新增术语规则" }).click();
    await optionsPage.getByLabel("原文术语").fill("translation cache");
    await optionsPage.getByLabel("固定译法").fill("翻译缓存");
    await optionsPage
      .getByRole("button", { name: "保存术语规则" })
      .click();
    await optionsPage
      .getByRole("button", { name: "删除术语规则 LLM" })
      .click();

    await optionsPage.reload();
    await expect(
      optionsPage.getByText("translation cache → 翻译缓存"),
    ).toBeVisible();
    await expect(optionsPage.getByText("LLM → 大语言模型")).toHaveCount(0);
    await saveConfiguration(optionsPage, fakeServer.endpoint);

    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await translateCurrentPage(context, extensionId, page);

    await expect(page.getByText("大语言模型使用翻译缓存。")).toBeVisible();
    const systemMessage = requestMessages(
      fakeServer.receivedRequests[0]!,
    ).find(({ role }) => role === "system")?.content;
    expect(systemMessage).toContain("Use these terminology rules exactly");
    expect(systemMessage).toContain(
      '{"source":"translation cache","target":"翻译缓存"}',
    );
    expect(systemMessage).not.toContain(
      '{"source":"LLM","target":"大语言模型"}',
    );
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("修改翻译提示词或术语表后不会复用旧缓存", async () => {
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

  async function translateTestPage(): Promise<void> {
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await translateCurrentPage(context, extensionId, page);
    await expect(page.getByText("你好，世界。")).toBeVisible();
  }

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    await translateTestPage();
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(1);

    await optionsPage.getByLabel("全局翻译提示词").fill("Use a formal tone.");
    await optionsPage
      .getByRole("button", { name: "保存翻译提示词" })
      .click();
    await translateTestPage();
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(2);
    expect(
      requestMessages(fakeServer.receivedRequests[1]!).find(
        ({ role }) => role === "system",
      )?.content,
    ).toContain("Use a formal tone.");

    await optionsPage.getByRole("button", { name: "新增术语规则" }).click();
    await optionsPage.getByLabel("原文术语").fill("world");
    await optionsPage.getByLabel("固定译法").fill("世界");
    await optionsPage
      .getByRole("button", { name: "保存术语规则" })
      .click();
    await translateTestPage();
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(3);
    expect(
      requestMessages(fakeServer.receivedRequests[2]!).find(
        ({ role }) => role === "system",
      )?.content,
    ).toContain('{"source":"world","target":"世界"}');
  } finally {
    await context.close();
    await fakeServer.close();
  }
});
