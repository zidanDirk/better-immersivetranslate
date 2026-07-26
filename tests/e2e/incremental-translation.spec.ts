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

function requestedBlocks(
  request: ReceivedOpenAiRequest,
): Array<{ id: string; text: string }> {
  const body = request.body as {
    messages: Array<{ role: string; content: string }>;
  };
  const userMessage = body.messages.find((message) => message.role === "user");
  return JSON.parse(userMessage?.content ?? "{}").blocks as Array<{
    id: string;
    text: string;
  }>;
}

test("初次翻译后新增的语义文本块会自动增量翻译", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `
      <main id="content">
        <p>Initial source.</p>
      </main>
      <button type="button" onclick="
        const paragraph = document.createElement('p');
        paragraph.textContent = 'Dynamically added source.';
        document.querySelector('#content').append(paragraph);
      ">加载更多</button>
    `,
    responseSequence: [
      {
        responseBody: translationCompletion([
          { id: "block-0", text: "初始译文。" },
        ]),
      },
      {
        responseBody: translationCompletion([
          { id: "block-1", text: "动态新增译文。" },
        ]),
      },
    ],
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveMinimalLlmConfiguration(
      optionsPage,
      fakeServer.endpoint,
      "增量翻译测试",
    );
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await triggerCurrentPageTranslation(context, extensionId, page);
    await expect(page.getByText("初始译文。")).toBeVisible();

    await page.getByRole("button", { name: "加载更多" }).click();

    await expect(page.getByText("动态新增译文。")).toBeVisible();
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(2);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("已翻译语义文本块变化后只翻译新内容版本", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `
      <main>
        <p id="article">Original version.</p>
      </main>
      <button type="button" onclick="
        document.querySelector('#article').firstChild.textContent = 'Updated version.';
      ">更新内容</button>
    `,
    responseSequence: [
      {
        responseBody: translationCompletion([
          { id: "block-0", text: "原始版本。" },
        ]),
      },
      {
        responseBody: translationCompletion([
          { id: "block-0", text: "更新版本。" },
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
    await expect(page.getByText("原始版本。")).toBeVisible();

    await page.getByRole("button", { name: "更新内容" }).click();

    await expect(page.getByText("更新版本。")).toBeVisible();
    await expect(page.getByText("原始版本。")).toHaveCount(0);
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(2);
    expect(requestedBlocks(fakeServer.receivedRequests[1]!)).toEqual([
      { id: "block-0", text: "Updated version." },
    ]);
    await page.waitForTimeout(250);
    expect(fakeServer.receivedRequests).toHaveLength(2);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("动态新增内容继续遵循默认排除规则", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `
      <main id="content">
        <p>Initial source.</p>
      </main>
      <button type="button" onclick="
        const content = document.querySelector('#content');
        content.insertAdjacentHTML('beforeend', [
          '<div contenteditable=true><p>Editable secret.</p></div>',
          '<code><p>Code secret.</p></code>',
          '<p translate=no>Explicitly excluded.</p>',
          '<p>Supported dynamic source.</p>'
        ].join(''));
      ">加载动态内容</button>
    `,
    responseSequence: [
      {
        responseBody: translationCompletion([
          { id: "block-0", text: "初始译文。" },
        ]),
      },
      {
        responseBody: translationCompletion([
          { id: "block-1", text: "受支持的动态译文。" },
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
    await expect(page.getByText("初始译文。")).toBeVisible();

    await page.getByRole("button", { name: "加载动态内容" }).click();

    await expect(page.getByText("受支持的动态译文。")).toBeVisible();
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(2);
    expect(requestedBlocks(fakeServer.receivedRequests[1]!)).toEqual([
      { id: "block-1", text: "Supported dynamic source." },
    ]);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("增量批次复用翻译缓存并显示完成进度", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `
      <main id="content">
        <p>Repeated source.</p>
      </main>
      <button type="button" onclick="
        const paragraph = document.createElement('p');
        paragraph.textContent = 'Repeated source.';
        document.querySelector('#content').append(paragraph);
      ">再次显示</button>
    `,
    responseBody: translationCompletion([
      { id: "block-0", text: "缓存译文。" },
    ]),
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveMinimalLlmConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await triggerCurrentPageTranslation(context, extensionId, page);
    await expect(page.getByText("缓存译文。")).toBeVisible();

    await page.getByRole("button", { name: "再次显示" }).click();

    await expect(page.getByText("缓存译文。")).toHaveCount(2);
    await expect(
      page.getByRole("region", { name: "翻译进度" }),
    ).toHaveCount(0);
    await page.waitForTimeout(250);
    expect(fakeServer.receivedRequests).toHaveLength(1);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("增量批次失败时显示状态并可沿用批次恢复", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `
      <main id="content">
        <p>Initial source.</p>
      </main>
      <button type="button" onclick="
        const paragraph = document.createElement('p');
        paragraph.textContent = 'Recoverable dynamic source.';
        document.querySelector('#content').append(paragraph);
      ">加载失败内容</button>
      <button type="button" onclick="
        const paragraph = document.createElement('p');
        paragraph.textContent = 'Later dynamic source.';
        document.querySelector('#content').append(paragraph);
      ">加载后续内容</button>
    `,
    responseSequence: [
      {
        responseBody: translationCompletion([
          { id: "block-0", text: "初始译文。" },
        ]),
      },
      { statusCode: 429 },
      {
        responseBody: translationCompletion([
          { id: "block-1", text: "恢复后的动态译文。" },
        ]),
      },
      {
        responseBody: translationCompletion([
          { id: "block-2", text: "后续动态译文。" },
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
    await expect(page.getByText("初始译文。")).toBeVisible();

    await page.getByRole("button", { name: "加载失败内容" }).click();

    const progress = page.getByRole("region", { name: "翻译进度" });
    await expect(
      progress.getByText("批次 1：请求受限：请稍后手动重试"),
    ).toBeVisible();
    await page.getByRole("button", { name: "加载后续内容" }).click();
    await page.waitForTimeout(250);
    await expect(
      progress.getByText("批次 1：请求受限：请稍后手动重试"),
    ).toBeVisible();
    expect(fakeServer.receivedRequests).toHaveLength(2);

    await progress.getByRole("button", { name: "重试批次 1" }).click();
    await expect(page.getByText("恢复后的动态译文。")).toBeVisible();
    await expect(page.getByText("后续动态译文。")).toBeVisible();
    await expect(progress).toHaveCount(0);
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(4);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("页面高频变化只翻译稳定内容且不会形成观察循环", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `
      <main>
        <p id="live-content">Initial live source.</p>
      </main>
      <button type="button" onclick="
        const source = document.querySelector('#live-content').firstChild;
        let index = 0;
        const updates = window.setInterval(() => {
          source.textContent = 'Live update ' + index + '.';
          index += 1;
          if (index === 6) window.clearInterval(updates);
        }, 100);
      ">快速更新</button>
    `,
    responseSequence: [
      {
        responseBody: translationCompletion([
          { id: "block-0", text: "初始实时译文。" },
        ]),
      },
      {
        delayMs: 500,
        responseBody: translationCompletion([
          { id: "block-0", text: "过时的实时译文。" },
        ]),
      },
      {
        responseBody: translationCompletion([
          { id: "block-0", text: "稳定后的实时译文。" },
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
    await expect(page.getByText("初始实时译文。")).toBeVisible();

    await page.getByRole("button", { name: "快速更新" }).click();

    await expect(page.getByText("稳定后的实时译文。")).toBeVisible();
    await expect(page.getByText("初始实时译文。")).toHaveCount(0);
    await expect(page.getByText("过时的实时译文。")).toHaveCount(0);
    await expect(page.getByText("稳定后的实时译文。")).toHaveCount(1);
    await page.waitForTimeout(500);
    expect(fakeServer.receivedRequests).toHaveLength(3);
    expect(requestedBlocks(fakeServer.receivedRequests[1]!)).toEqual([
      { id: "block-0", text: "Live update 0." },
    ]);
    expect(requestedBlocks(fakeServer.receivedRequests[2]!)).toEqual([
      { id: "block-0", text: "Live update 5." },
    ]);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("页面克隆已翻译内容时为新增语义文本块保持独立映射", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `
      <main id="content">
        <p id="original">Original source.</p>
      </main>
      <button type="button" onclick="
        const original = document.querySelector('#original');
        const cloned = original.cloneNode(true);
        cloned.removeAttribute('id');
        cloned.firstChild.textContent = 'Cloned dynamic source.';
        original.firstChild.textContent = 'Updated original source.';
        document.querySelector('#content').append(cloned);
      ">克隆并更新</button>
    `,
    responseSequence: [
      {
        responseBody: translationCompletion([
          { id: "block-0", text: "初始原文译文。" },
        ]),
      },
      {
        responseBody: translationCompletion([
          { id: "block-0", text: "更新原文译文。" },
          { id: "block-1", text: "克隆内容译文。" },
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
    await expect(page.getByText("初始原文译文。")).toBeVisible();

    await page.getByRole("button", { name: "克隆并更新" }).click();

    await expect(page.getByText("更新原文译文。")).toBeVisible();
    await expect(page.getByText("克隆内容译文。")).toBeVisible();
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(2);
    expect(requestedBlocks(fakeServer.receivedRequests[1]!)).toEqual([
      { id: "block-0", text: "Updated original source." },
      { id: "block-1", text: "Cloned dynamic source." },
    ]);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("语义文本块变为空白时移除旧译文且不创建请求", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `
      <main>
        <p id="source">Source to remove.</p>
      </main>
      <button type="button" onclick="
        document.querySelector('#source').firstChild.textContent = '   ';
      ">清空原文</button>
    `,
    responseBody: translationCompletion([
      { id: "block-0", text: "即将移除的译文。" },
    ]),
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveMinimalLlmConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await triggerCurrentPageTranslation(context, extensionId, page);
    await expect(page.getByText("即将移除的译文。")).toBeVisible();

    await page.getByRole("button", { name: "清空原文" }).click();

    await expect(page.getByText("即将移除的译文。")).toHaveCount(0);
    await page.waitForTimeout(250);
    expect(fakeServer.receivedRequests).toHaveLength(1);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});
