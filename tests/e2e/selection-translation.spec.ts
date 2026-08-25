import { expect, test, type Page, type Worker } from "@playwright/test";
import { launchExtension } from "./extension";
import {
  startFakeOpenAiServer,
  type ReceivedOpenAiRequest,
} from "./fake-openai-server";
import type { WebsiteOverride } from "../../src/website-overrides";
import { validatedSourcePhonetic } from "../../src/source-phonetic";
import { isSingleWordSelection } from "../../src/word-selection";

async function saveConfiguration(page: Page, endpoint: string): Promise<void> {
  await page.getByRole("button", { name: "新增 LLM 配置" }).click();
  await page.getByLabel("名称").fill("选中文本翻译");
  await page.getByLabel("服务地址").fill(endpoint);
  await page.getByLabel("API Key").fill("selection-secret");
  await page.getByLabel("模型").fill("selection-model");
  await page.getByRole("button", { name: "保存配置" }).click();
}

async function saveWebsiteSelectionPreference(
  extensionPage: Page,
  origin: string,
  selectionTranslation: WebsiteOverride["selectionTranslation"],
): Promise<void> {
  await extensionPage.evaluate(
    async ({ origin, selectionTranslation }) => {
      await chrome.storage.local.set({
        websiteOverrides: {
          [origin]: {
            origin,
            targetLanguage: "",
            translationPrompt: "",
            automaticTranslation: false,
            selectionTranslation,
          },
        },
      });
      await chrome.runtime.sendMessage({
        kind: "sync-selection-translation",
      });
    },
    { origin, selectionTranslation },
  );
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

test("只把一个自然语言单词识别为单词划词翻译", () => {
  expect([
    "serendipity",
    "l’été",
    "state-of-the-art",
    "你好",
  ].every(isSingleWordSelection)).toBe(true);
  expect([
    "two words",
    "这是一个句子",
    "word.",
    "123",
  ].some(isSingleWordSelection)).toBe(false);
});

test("拒绝明显属于译文的音标", () => {
  expect(
    validatedSourcePhonetic(
      "serendipity",
      "意外发现美好事物的能力",
      "/ˌserənˈdɪpəti/",
    ),
  ).toBe("/ˌserənˈdɪpəti/");
  expect(
    validatedSourcePhonetic("coding", "编程", "/biān chéng/"),
  ).toBeUndefined();
  expect(
    validatedSourcePhonetic("coding", "编程", "/bia\u0304n che\u0301ng/"),
  ).toBeUndefined();
  expect(validatedSourcePhonetic("coding", "编程", "/编程/")).toBeUndefined();
  expect(validatedSourcePhonetic("coding", "编程", "coding")).toBeUndefined();
});

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
        <div style="height: 420px"></div>
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
                  phonetic: "/model-extra-field-must-be-ignored/",
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
      page.getByRole("region", { name: "划词翻译结果" }),
    ).toContainText("Selected prose content");
    await expect(
      page.getByRole("region", { name: "划词翻译结果" }),
    ).toContainText("选中的正文内容");
    await expect(
      page.getByRole("button", { name: /朗读单词/ }),
    ).toHaveCount(0);
    const [selectionBox, panelBox] = await Promise.all([
      page
        .getByRole("main")
        .getByText("Selected prose content", { exact: true })
        .boundingBox(),
      page
        .getByRole("region", { name: "划词翻译结果" })
        .boundingBox(),
    ]);
    expect(selectionBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(
      Math.abs(
        panelBox!.y - (selectionBox!.y + selectionBox!.height),
      ),
    ).toBeLessThan(40);
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

test("划词翻译单个单词时显示音标并可点击图标朗读原词", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: '<main lang="en"><p>serendipity</p></main>',
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [
                {
                  id: "selected-text",
                  text: "意外发现美好事物的能力",
                  sourcePhonetic: "/ˌserənˈdɪpəti/",
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
    hostPermissions: ["http://*/*", "https://*/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    await optionsPage
      .getByLabel("在所有网站启用划词翻译")
      .check();
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await worker.evaluate(async (pageUrl) => {
      const [pageTab] = await chrome.tabs.query({ url: pageUrl });
      if (pageTab?.id === undefined) {
        throw new Error("没有找到单词朗读测试页面");
      }
      await chrome.scripting.executeScript({
        target: { tabId: pageTab.id },
        func: () => {
          Object.defineProperty(window.speechSynthesis, "speak", {
            configurable: true,
            value: (utterance: SpeechSynthesisUtterance) => {
              document.documentElement.dataset.spokenWord = utterance.text;
              document.documentElement.dataset.spokenLanguage = utterance.lang;
            },
          });
        },
      });
    }, fakeServer.pageUrl);

    await page.getByText("serendipity", { exact: true }).selectText();
    await page.getByRole("button", { name: "翻译所选文字" }).click();

    const result = page.getByRole("region", { name: "划词翻译结果" });
    await expect(result.getByText("/ˌserənˈdɪpəti/", { exact: true })).toBeVisible();
    await expect(result).toContainText("意外发现美好事物的能力");
    const speak = result.getByRole("button", {
      name: "朗读单词 serendipity",
    });
    await expect(speak).toBeVisible();

    const received = await fakeServer.receivedRequest;
    const body = requestBody(received);
    const systemMessage = body.messages.find(
      ({ role }) => role === "system",
    )?.content;
    const translationInput = JSON.parse(
      body.messages.at(-1)?.content ?? "{}",
    ) as unknown;
    expect(systemMessage).toContain(
      "sourcePhonetic field is exclusively for the pronunciation of blocks[].text in its original language",
    );
    expect(systemMessage).toContain(
      "Never put the pronunciation or transliteration of the translated text",
    );
    expect(systemMessage).toContain("including pinyin or romaji");
    expect(translationInput).toEqual({
      sourceLanguage: "auto",
      targetLanguage: "zh-CN",
      includePhonetics: true,
      blocks: [{ id: "selected-text", text: "serendipity" }],
    });

    await speak.click();
    await expect.poll(() =>
      page.locator("html").getAttribute("data-spoken-word"),
    ).toBe("serendipity");
    await expect(page.locator("html")).toHaveAttribute(
      "data-spoken-language",
      "en",
    );
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("单词划词翻译不显示译文语言的音标", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: '<main lang="en"><p>coding</p></main>',
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [
                {
                  id: "selected-text",
                  text: "编程",
                  sourcePhonetic: "/biān chéng/",
                },
              ],
            }),
          },
        },
      ],
    },
  });
  const { context, optionsPage } = await launchExtension({
    browserLanguage: "zh-CN",
    hostPermissions: ["http://*/*", "https://*/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    await optionsPage
      .getByLabel("在所有网站启用划词翻译")
      .check();
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);

    await page.getByText("coding", { exact: true }).selectText();
    await page.getByRole("button", { name: "翻译所选文字" }).click();

    const result = page.getByRole("region", { name: "划词翻译结果" });
    await expect(result).toContainText("编程");
    await expect(
      result.getByText("/biān chéng/", { exact: true }),
    ).toHaveCount(0);
    await expect(
      result.getByRole("button", { name: "朗读单词 coding" }),
    ).toHaveCount(0);

    await page.keyboard.press("Escape");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.getByText("coding", { exact: true }).selectText();
    await page.getByRole("button", { name: "翻译所选文字" }).click();
    await expect(
      page
        .getByRole("region", { name: "划词翻译结果" })
        .getByText("/biān chéng/", { exact: true }),
    ).toHaveCount(0);
    expect(fakeServer.receivedRequests).toHaveLength(1);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("右键划词翻译进行中关闭标签页不会产生后台未捕获错误", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Close the tab while translating.</p></main>",
    responseDelayMs: 300,
  });
  const { context, optionsPage, worker } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const webErrors: string[] = [];
    context.on("weberror", (webError) => {
      webErrors.push(webError.error().message);
    });
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await page.getByText("Close the tab while translating.").selectText();
    await worker.evaluate(async (pageUrl) => {
      const [pageTab] = await chrome.tabs.query({ url: pageUrl });
      if (pageTab?.id === undefined) {
        throw new Error("没有找到翻译测试页面");
      }
      const background = (
        globalThis as typeof globalThis & {
          betterImmersiveBackground: {
            dispatchSelectionMenuClick: (
              info: chrome.contextMenus.OnClickData,
              tab?: chrome.tabs.Tab,
            ) => void;
          };
        }
      ).betterImmersiveBackground;
      background.dispatchSelectionMenuClick(
        {
          editable: false,
          frameId: 0,
          menuItemId: "translate-selected-text",
          pageUrl,
          selectionText: "Close the tab while translating.",
        },
        pageTab,
      );
    }, fakeServer.pageUrl);
    await fakeServer.receivedRequest;

    await page.close();
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(webErrors).toEqual([]);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("用户为当前网站开启划词翻译后从选区旁图标查看译文", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `
      <main>
        <p>Keep the page around me unchanged.</p>
        <p>Translate this selected passage.</p>
      </main>
    `,
    responseDelayMs: 150,
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [
                {
                  id: "selected-text",
                  text: "翻译这段选中的文字。",
                },
              ],
            }),
          },
        },
      ],
    },
  });
  const permissionPattern = "http://127.0.0.1/*";
  const { context, optionsPage } = await launchExtension({
    browserLanguage: "zh-CN",
    hostPermissions: [permissionPattern],
    tabUrlAccess: true,
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    await saveWebsiteSelectionPreference(
      optionsPage,
      new URL(fakeServer.pageUrl).origin,
      "enabled",
    );
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);

    await page.getByText("Translate this selected passage.").selectText();
    const entry = page.getByRole("button", { name: "翻译所选文字" });
    await expect(entry).toBeVisible();
    expect(fakeServer.receivedRequests).toHaveLength(0);

    await entry.click();
    const result = page.getByRole("region", { name: "划词翻译结果" });
    await expect(result).toContainText("正在翻译");
    await expect(result).toContainText("翻译这段选中的文字。");
    await expect(
      page.getByText("Keep the page around me unchanged."),
    ).toBeVisible();
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(1);

    await page.reload();
    await page.getByText("Translate this selected passage.").selectText();
    await expect(
      page.getByRole("button", { name: "翻译所选文字" }),
    ).toBeVisible();
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("用户可以从设置页为所有普通网站开启划词翻译", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Global selection translation.</p></main>",
  });
  const { context, optionsPage } = await launchExtension({
    hostPermissions: ["http://*/*", "https://*/*"],
  });

  try {
    await optionsPage
      .getByLabel("在所有网站启用划词翻译")
      .check();
    await expect(
      optionsPage.getByText("所有网站的划词翻译已开启"),
    ).toBeVisible();

    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await page.getByText("Global selection translation.").selectText();
    await expect(
      page.getByRole("button", { name: "翻译所选文字" }),
    ).toBeVisible();
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("扩展冷启动后当前页面首次划词即可显示翻译入口", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Translate on the first selection.</p></main>",
  });
  const { context, optionsPage, worker } = await launchExtension({
    hostPermissions: ["http://*/*", "https://*/*"],
  });

  try {
    await optionsPage
      .getByLabel("在所有网站启用划词翻译")
      .check();
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await page.getByText("Translate on the first selection.").selectText();
    await expect(
      page.getByRole("button", { name: "翻译所选文字" }),
    ).toBeVisible();

    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await worker.evaluate(async () => {
      await chrome.scripting.unregisterContentScripts({
        ids: ["selection-translation"],
      });
      const [pageTab] = await chrome.tabs.query({
        url: "http://127.0.0.1/*",
      });
      if (pageTab?.id !== undefined) {
        await chrome.tabs
          .sendMessage(pageTab.id, {
            kind: "disable-selection-translation",
          })
          .catch(() => {});
      }
    });

    const cdp = await context.newCDPSession(page);
    const { targetInfos } = await cdp.send("Target.getTargets");
    const workerTarget = targetInfos.find(
      ({ url, type }) => type === "service_worker" && url === worker.url(),
    );
    if (!workerTarget) {
      throw new Error("没有找到扩展后台 service worker");
    }
    await cdp.send("Target.closeTarget", {
      targetId: workerTarget.targetId,
    });
    await page.reload();

    await page.getByText("Translate on the first selection.").selectText();
    await expect(
      page.getByRole("button", { name: "翻译所选文字" }),
    ).toBeVisible();
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("扩展重新加载后旧页面划词不会抛出上下文失效错误", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Select after extension reload.</p></main>",
  });
  const { context, optionsPage, worker } = await launchExtension({
    hostPermissions: ["http://*/*", "https://*/*"],
  });

  try {
    await optionsPage
      .getByLabel("在所有网站启用划词翻译")
      .check();
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await page.getByText("Select after extension reload.").selectText();
    await expect(
      page.getByRole("button", { name: "翻译所选文字" }),
    ).toBeVisible();

    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await worker.evaluate(() => chrome.runtime.reload());
    await page.getByText("Select after extension reload.").selectText();
    await page.waitForTimeout(250);

    expect(pageErrors).not.toContain("Extension context invalidated.");
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("翻译进行中重载扩展不会产生未捕获错误", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Translate across repeated extension reloads.</p></main>",
    responseDelayMs: 250,
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [
                {
                  id: "selected-text",
                  text: "扩展重载后继续翻译。",
                },
              ],
            }),
          },
        },
      ],
    },
  });
  const { context, optionsPage, worker } = await launchExtension({
    hostPermissions: ["http://*/*", "https://*/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    await optionsPage
      .getByLabel("在所有网站启用划词翻译")
      .check();
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page
      .getByText("Translate across repeated extension reloads.")
      .selectText();
    const entry = page.getByRole("button", { name: "翻译所选文字" });
    await expect(entry).toBeVisible();
    await entry.click();
    await fakeServer.receivedRequest;

    await worker.evaluate(() => chrome.runtime.reload());
    await page.waitForTimeout(400);

    expect(pageErrors).toEqual([]);
    await expect(
      page.locator("[data-better-immersive-selection-ui]"),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("Runtime 能力检查通过后消息通道失效也不会产生未捕获错误", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Translate from a stale extension context.</p></main>",
  });
  const { context, optionsPage, worker } = await launchExtension({
    hostPermissions: ["http://*/*", "https://*/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    await optionsPage
      .getByLabel("在所有网站启用划词翻译")
      .check();
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page
      .getByText("Translate from a stale extension context.")
      .selectText();
    await expect(
      page.getByRole("button", { name: "翻译所选文字" }),
    ).toBeVisible();
    await worker.evaluate(async (pageUrl) => {
      const [pageTab] = await chrome.tabs.query({ url: pageUrl });
      if (pageTab?.id === undefined) {
        throw new Error("没有找到翻译测试页面");
      }
      await chrome.scripting.executeScript({
        target: { tabId: pageTab.id },
        func: () => {
          const invalidated = (): never => {
            throw new Error("Extension context invalidated.");
          };
          Object.defineProperty(chrome.runtime, "sendMessage", {
            value: invalidated,
          });
        },
      });
    }, fakeServer.pageUrl);

    await page.getByRole("button", { name: "翻译所选文字" }).click();
    await page.waitForTimeout(100);

    expect(pageErrors).not.toContain("Extension context invalidated.");
    await expect(
      page.locator("[data-better-immersive-selection-ui]"),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("复制译文被浏览器拒绝时保留译文并显示可重试状态", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Keep translation after clipboard failure.</p></main>",
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [
                {
                  id: "selected-text",
                  text: "剪贴板失败后保留译文。",
                },
              ],
            }),
          },
        },
      ],
    },
  });
  const { context, optionsPage, worker } = await launchExtension({
    hostPermissions: ["http://*/*", "https://*/*"],
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    await optionsPage
      .getByLabel("在所有网站启用划词翻译")
      .check();
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await worker.evaluate(async (pageUrl) => {
      const [pageTab] = await chrome.tabs.query({ url: pageUrl });
      if (pageTab?.id === undefined) {
        throw new Error("没有找到翻译测试页面");
      }
      await chrome.scripting.executeScript({
        target: { tabId: pageTab.id },
        func: () => {
          Object.defineProperty(navigator.clipboard, "writeText", {
            value: async () => {
              throw new DOMException("Clipboard permission denied", "NotAllowedError");
            },
          });
        },
      });
    }, fakeServer.pageUrl);

    await page
      .getByText("Keep translation after clipboard failure.")
      .selectText();
    await page.getByRole("button", { name: "翻译所选文字" }).click();
    await expect(page.getByText("剪贴板失败后保留译文。")).toBeVisible();
    await page.getByRole("button", { name: "复制译文" }).click();

    await expect(
      page.getByRole("button", { name: "复制失败，请重试" }),
    ).toBeVisible();
    await expect(page.getByText("剪贴板失败后保留译文。")).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("网站覆盖设置优先于全局划词翻译并可恢复继承", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Website preference wins.</p></main>",
  });
  const { context, optionsPage } = await launchExtension({
    hostPermissions: ["http://*/*", "https://*/*"],
    tabUrlAccess: true,
  });

  try {
    await optionsPage
      .getByLabel("在所有网站启用划词翻译")
      .check();
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);

    const setWebsitePreference = async (
      preference: "disabled" | "inherit",
    ): Promise<void> => {
      await saveWebsiteSelectionPreference(
        optionsPage,
        new URL(fakeServer.pageUrl).origin,
        preference,
      );
    };

    await setWebsitePreference("disabled");
    await page.getByText("Website preference wins.").selectText();
    await expect(
      page.getByRole("button", { name: "翻译所选文字" }),
    ).toHaveCount(0);

    await setWebsitePreference("inherit");
    await page.getByText("Website preference wins.").selectText();
    await expect(
      page.getByRole("button", { name: "翻译所选文字" }),
    ).toBeVisible();
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("未配置 LLM 时划词浮层提供设置入口", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Needs configuration.</p></main>",
  });
  const { context, optionsPage } = await launchExtension({
    hostPermissions: ["http://*/*", "https://*/*"],
  });

  try {
    await optionsPage
      .getByLabel("在所有网站启用划词翻译")
      .check();
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await page.getByText("Needs configuration.").selectText();
    await page.getByRole("button", { name: "翻译所选文字" }).click();
    const result = page.getByRole("region", { name: "划词翻译结果" });
    await expect(result).toContainText("请先配置 LLM");
    await expect(
      result.getByRole("button", { name: "打开设置" }),
    ).toBeVisible();
    expect(fakeServer.receivedRequests).toHaveLength(0);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("超过五千字符的划词翻译在页面内提示且不发送请求", async () => {
  const longText = "a".repeat(5_001);
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `<main><p>${longText}</p></main>`,
  });
  const { context, optionsPage } = await launchExtension({
    hostPermissions: ["http://*/*", "https://*/*"],
  });

  try {
    await optionsPage
      .getByLabel("在所有网站启用划词翻译")
      .check();
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await page.locator("p").selectText();
    await page.getByRole("button", { name: "翻译所选文字" }).click();
    await expect(
      page.getByRole("region", { name: "划词翻译结果" }),
    ).toContainText("划词翻译最多支持 5,000 字符");
    expect(fakeServer.receivedRequests).toHaveLength(0);
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
      page.getByRole("region", { name: "划词翻译结果" }),
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
      page.getByRole("region", { name: "划词翻译结果" }),
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
      page.getByRole("region", { name: "划词翻译结果" }),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});
