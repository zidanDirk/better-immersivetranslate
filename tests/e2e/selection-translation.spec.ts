import { expect, test, type Page, type Worker } from "@playwright/test";
import { launchExtension } from "./extension";
import {
  startFakeOpenAiServer,
  type ReceivedOpenAiRequest,
} from "./fake-openai-server";

async function saveConfiguration(page: Page, endpoint: string): Promise<void> {
  await page.getByRole("button", { name: "新增 LLM 配置" }).click();
  await page.getByLabel("名称").fill("选中文本翻译");
  await page.getByLabel("服务地址").fill(endpoint);
  await page.getByLabel("API Key").fill("selection-secret");
  await page.getByLabel("模型").fill("selection-model");
  await page.getByRole("button", { name: "保存配置" }).click();
}

function requestBody(request: ReceivedOpenAiRequest): {
  messages: Array<{ role: string; content: string }>;
  model: string;
} {
  return request.body as {
    messages: Array<{ role: string; content: string }>;
    model: string;
  };
}

async function clickSelectionMenu(
  worker: Worker,
  pageUrl: string,
  options: {
    editable: boolean;
    frameId?: number;
    selectionText: string;
  },
): Promise<void> {
  await worker.evaluate(
    async ({ editable, frameId, pageUrl, selectionText }) => {
      const [pageTab] = await chrome.tabs.query({ url: pageUrl });
      if (pageTab?.id === undefined) {
        throw new Error("没有找到测试页面标签页");
      }
      const background = (
        globalThis as typeof globalThis & {
          betterImmersiveBackground: {
            handleSelectionMenuClick: (
              info: chrome.contextMenus.OnClickData,
              tab?: chrome.tabs.Tab,
            ) => Promise<void>;
          };
        }
      ).betterImmersiveBackground;
      await background.handleSelectionMenuClick(
        {
          editable,
          frameId,
          menuItemId: "translate-selected-text",
          pageUrl,
          selectionText,
        },
        pageTab,
      );
    },
    { ...options, pageUrl },
  );
}

test("用户从右键菜单翻译选中的文本而不翻译整页或修改编辑内容", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `
      <main>
        <p>The whole page must stay unchanged.</p>
        <p>Selected prose content</p>
        <textarea>Selected editable content</textarea>
      </main>
    `,
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [
                {
                  id: "selected-text",
                  text: "选中的正文内容",
                },
              ],
            }),
          },
        },
      ],
    },
  });
  const { context, optionsPage, worker } = await launchExtension({
    browserLanguage: "zh-CN",
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await page.getByText("Selected prose content").selectText();
    await page.bringToFront();

    const duplicateMenuError = await worker.evaluate(
      () =>
        new Promise<string>((resolve) => {
          chrome.contextMenus.create(
            {
              id: "translate-selected-text",
              title: "重复菜单不应创建",
              contexts: ["page"],
            },
            () => resolve(chrome.runtime.lastError?.message ?? ""),
          );
        }),
    );
    expect(duplicateMenuError).toContain("duplicate id");

    await clickSelectionMenu(worker, fakeServer.pageUrl, {
      editable: false,
      frameId: 0,
      selectionText: "Selected prose content",
    });

    const received = await fakeServer.receivedRequest;
    const body = requestBody(received);
    const translationInput = JSON.parse(
      body.messages.at(-1)?.content ?? "{}",
    ) as unknown;

    await expect(
      page.getByRole("region", { name: "选中文本翻译结果" }),
    ).toContainText("Selected prose content");
    await expect(
      page.getByRole("region", { name: "选中文本翻译结果" }),
    ).toContainText("选中的正文内容");
    await expect(page.getByRole("textbox")).toHaveValue(
      "Selected editable content",
    );
    await expect(
      page.locator("[data-better-immersive-translation-for]"),
    ).toHaveCount(0);
    await expect(
      page.getByText("The whole page must stay unchanged."),
    ).toHaveCount(1);
    expect({
      authorization: received.headers.authorization,
      model: body.model,
      translationInput,
    }).toEqual({
      authorization: "Bearer selection-secret",
      model: "selection-model",
      translationInput: {
        sourceLanguage: "auto",
        targetLanguage: "zh-CN",
        blocks: [
          {
            id: "selected-text",
            text: "Selected prose content",
          },
        ],
      },
    });
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("可编辑内容的选区不会启动翻译任务", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<textarea>Private draft content</textarea>",
  });
  const { context, optionsPage, worker } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);

    await clickSelectionMenu(worker, fakeServer.pageUrl, {
      editable: true,
      frameId: 0,
      selectionText: "Private draft content",
    });

    await page.waitForTimeout(300);
    expect(fakeServer.receivedRequests).toHaveLength(0);
    await expect(page.getByRole("textbox")).toHaveValue(
      "Private draft content",
    );
    await expect(
      page.getByRole("region", { name: "选中文本翻译结果" }),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("普通 iframe 中的选区不会启动翻译任务", async () => {
  const fakeServer = await startFakeOpenAiServer();
  const { context, optionsPage, worker } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);

    await clickSelectionMenu(worker, fakeServer.pageUrl, {
      editable: false,
      frameId: 7,
      selectionText: "Text from an ordinary iframe",
    });

    await page.waitForTimeout(300);
    expect(fakeServer.receivedRequests).toHaveLength(0);
    await expect(
      page.getByRole("region", { name: "选中文本翻译结果" }),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("默认排除元素中的选区不会启动翻译任务", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><pre><code>npm publish private-package</code></pre></main>",
  });
  const { context, optionsPage, worker } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await page.getByText("npm publish private-package").selectText();
    await page.bringToFront();

    await clickSelectionMenu(worker, fakeServer.pageUrl, {
      editable: false,
      frameId: 0,
      selectionText: "npm publish private-package",
    });

    await page.waitForTimeout(300);
    expect(fakeServer.receivedRequests).toHaveLength(0);
    await expect(
      page.getByRole("region", { name: "选中文本翻译结果" }),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});
