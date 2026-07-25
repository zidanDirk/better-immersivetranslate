import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
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

test("标题、段落、列表项和表格单元格保持原有结构进行翻译", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `
      <style>
        h2 > a { color: rgb(12, 34, 56); }
        li > p { margin-left: 17px; }
      </style>
      <main>
        <h2><a href="#release">Release notes</a></h2>
        <p>Stable translation.</p>
        <ul>
          <li>
            <p>Safer pages</p>
            <ul><li>Nested detail</li></ul>
          </li>
        </ul>
        <table><tbody><tr><td><strong>Ready</strong></td></tr></tbody></table>
      </main>
    `,
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [
                { id: "block-0", text: "发布说明" },
                { id: "block-1", text: "稳定翻译。" },
                { id: "block-2", text: "更安全的网页" },
                { id: "block-3", text: "嵌套详情" },
                { id: "block-4", text: "就绪" },
              ],
            }),
          },
        },
      ],
    },
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    browserLanguage: "en-US",
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    await popup.getByRole("button", { name: "翻译当前网页" }).click();

    const received = await fakeServer.receivedRequest;
    await expect(page.locator("h2", { hasText: "发布说明" })).toBeVisible();
    await expect(
      page.locator("p", { hasText: "稳定翻译。" }),
    ).toBeVisible();
    await expect(
      page.locator("li", { hasText: "更安全的网页" }),
    ).toBeVisible();
    await expect(
      page.locator("li li", { hasText: "嵌套详情" }),
    ).toBeVisible();
    await expect(page.locator("td", { hasText: "就绪" })).toBeVisible();
    await expect(page.locator("h2 > a")).toHaveCSS(
      "color",
      "rgb(12, 34, 56)",
    );
    await expect(page.locator("li > p")).toHaveCSS("margin-left", "17px");
    await expect(page.locator("td > strong")).toHaveText("Ready");
    expect(
      JSON.parse(requestBody(received).messages.at(-1)?.content ?? "{}"),
    ).toEqual({
      sourceLanguage: "auto",
      targetLanguage: "en-US",
      blocks: [
        { id: "block-0", text: "Release notes" },
        { id: "block-1", text: "Stable translation." },
        { id: "block-2", text: "Safer pages" },
        { id: "block-3", text: "Nested detail" },
        { id: "block-4", text: "Ready" },
      ],
    });

    const readingModePopup = await context.newPage();
    await readingModePopup.goto(
      `chrome-extension://${extensionId}/popup.html`,
    );
    await page.bringToFront();
    await readingModePopup.getByRole("button", { name: "仅译文" }).click();
    await expect(
      page.locator('[data-better-immersive-translation-for="block-2"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-better-immersive-translation-for="block-3"]'),
    ).toBeVisible();
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("翻译任务跳过默认排除内容和普通 iframe", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `
      <main>
        <p>Public article.</p>
        <input aria-label="Search" value="Search secret">
        <input type="password" value="password secret">
        <textarea>Draft secret</textarea>
        <div contenteditable="true"><p>Editable secret.</p></div>
        <pre><p>Code secret.</p></pre>
        <div class="command-line"><p>Command secret.</p></div>
        <div role="log"><p>Log secret.</p></div>
        <section translate="no"><p>Excluded secret.</p></section>
        <p>
          Visible text.
          <code>Inline code secret.</code>
          <span contenteditable="true">Inline editor secret.</span>
          <span translate="no">Inline excluded secret.</span>
        </p>
        <iframe srcdoc="<p>Framed secret.</p>"></iframe>
      </main>
    `,
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [
                { id: "block-0", text: "公开文章。" },
                { id: "block-1", text: "可见文本。" },
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
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    await popup.getByRole("button", { name: "翻译当前网页" }).click();

    const received = await fakeServer.receivedRequest;
    expect(
      JSON.parse(requestBody(received).messages.at(-1)?.content ?? "{}"),
    ).toEqual({
      sourceLanguage: "auto",
      targetLanguage: "zh-CN",
      blocks: [
        { id: "block-0", text: "Public article." },
        { id: "block-1", text: "Visible text." },
      ],
    });
    await expect(page.getByText("公开文章。")).toBeVisible();
    await expect(page.getByText("可见文本。")).toBeVisible();
    await expect(
      page.locator("[data-better-immersive-translation-for]"),
    ).toHaveCount(2);
    await expect(
      page
        .frameLocator("iframe")
        .locator("[data-better-immersive-translation-for]"),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("用户切换三种阅读方式时不会重复请求 LLM", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `
      <main>
        <p>
          Keep the source.
          <a href="#details">Details link</a>
          <code>Code stays.</code>
        </p>
      </main>
    `,
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [{ id: "block-0", text: "保留原文。" }],
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

  async function chooseReadingMode(
    page: Page,
    accessibleName: string,
  ): Promise<void> {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    await popup.getByRole("button", { name: accessibleName }).click();
    await expect.poll(() => popup.isClosed()).toBe(true);
  }

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await chooseReadingMode(page, "翻译当前网页");
    await fakeServer.receivedRequest;

    await expect(page.getByText("Keep the source.")).toBeVisible();
    await expect(page.getByText("保留原文。")).toBeVisible();

    await chooseReadingMode(page, "仅译文");
    await expect(page.getByText("Keep the source.")).toBeHidden();
    await expect(page.getByText("保留原文。")).toBeVisible();
    await expect(page.getByRole("link", { name: "Details link" })).toBeVisible();
    await expect(page.getByText("Code stays.")).toBeVisible();
    await page.getByRole("link", { name: "Details link" }).click();
    await expect(page).toHaveURL(/#details$/);

    await chooseReadingMode(page, "仅原文");
    await expect(page.getByText("Keep the source.")).toBeVisible();
    await expect(page.getByText("保留原文。")).toBeHidden();

    await chooseReadingMode(page, "双语对照");
    await expect(page.getByText("Keep the source.")).toBeVisible();
    await expect(page.getByText("保留原文。")).toBeVisible();
    expect(fakeServer.receivedRequests).toHaveLength(1);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("Chrome 内置页和本地文件页不会创建翻译任务", async () => {
  const fakeServer = await startFakeOpenAiServer();
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });
  const localPageDirectory = await mkdtemp(
    path.join(tmpdir(), "better-immersive-local-page-"),
  );
  const localPagePath = path.join(localPageDirectory, "index.html");
  await writeFile(localPagePath, "<p>Local private text.</p>");

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();

    for (const unsupportedUrl of [
      "chrome://version/",
      pathToFileURL(localPagePath).href,
    ]) {
      await page.goto(unsupportedUrl);
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await page.bringToFront();
      await popup.getByRole("button", { name: "翻译当前网页" }).click();
      await expect.poll(() => popup.isClosed()).toBe(true);
    }

    expect(fakeServer.receivedRequests).toHaveLength(0);
  } finally {
    await context.close();
    await fakeServer.close();
    await rm(localPageDirectory, { force: true, recursive: true });
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
