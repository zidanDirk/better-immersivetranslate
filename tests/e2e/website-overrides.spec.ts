import { expect, test, type Page } from "@playwright/test";
import { launchExtension } from "./extension";
import {
  startFakeOpenAiServer,
  type ReceivedOpenAiRequest,
} from "./fake-openai-server";

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

async function openWebsiteOverride(
  context: Awaited<ReturnType<typeof launchExtension>>["context"],
  extensionId: string,
  activePage: Page,
  preparePopup?: (popup: Page) => Promise<void>,
): Promise<Page> {
  const popup = await context.newPage();
  await preparePopup?.(popup);
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await activePage.bringToFront();
  await popup.getByRole("button", { name: "网站覆盖设置" }).click();
  return popup;
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

test("未配置网站覆盖时先使用全局目标语言，否则使用浏览器语言", async () => {
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
    const browserDefaultPage = await context.newPage();
    await browserDefaultPage.goto(fakeServer.pageUrl);
    await translateCurrentPage(context, extensionId, browserDefaultPage);
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(1);
    expect(translationInput(fakeServer.receivedRequests[0]!)).toMatchObject({
      targetLanguage: "fr-FR",
    });

    await optionsPage.bringToFront();
    await optionsPage.getByLabel("全局目标语言").fill("ja");
    await optionsPage
      .getByRole("button", { name: "保存全局目标语言" })
      .click();
    await expect(optionsPage.getByText("全局目标语言已保存")).toBeVisible();

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
    await optionsPage.getByLabel("全局目标语言").fill("ja");
    await optionsPage
      .getByRole("button", { name: "保存全局目标语言" })
      .click();
    await optionsPage
      .getByLabel("全局翻译提示词")
      .fill("Use the global general-purpose style.");
    await optionsPage
      .getByRole("button", { name: "保存翻译提示词" })
      .click();

    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    const settingsPopup = await openWebsiteOverride(
      context,
      extensionId,
      page,
    );
    await expect(
      settingsPopup.getByText(new URL(fakeServer.pageUrl).origin),
    ).toBeVisible();
    await settingsPopup.getByLabel("网站目标语言").fill("de");
    await settingsPopup
      .getByLabel("网站翻译提示词")
      .fill("Use precise legal terminology.");
    await settingsPopup
      .getByRole("button", { name: "保存网站覆盖设置" })
      .click();
    await expect(
      settingsPopup.getByText("网站覆盖设置已保存"),
    ).toBeVisible();

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

test("用户授权精确 host permission 后网站后续页面自动翻译", async () => {
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
  const permissionPattern = "http://127.0.0.1/*";
  const { context, extensionId, optionsPage, worker } =
    await launchExtension({
      browserLanguage: "zh-CN",
      hostPermissions: [permissionPattern],
    });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    await page.goto(fakeServer.pageUrl);
    await page.waitForTimeout(250);
    expect(fakeServer.receivedRequests).toHaveLength(0);

    const settingsPopup = await openWebsiteOverride(
      context,
      extensionId,
      page,
      async (popup) => {
        await popup.addInitScript(() => {
          const requestPermission =
            chrome.permissions.request.bind(chrome.permissions);
          Object.defineProperty(chrome.permissions, "request", {
            value: async (
              permissions: chrome.permissions.Permissions,
            ) => {
              (
                globalThis as typeof globalThis & {
                  requestedOrigins?: string[];
                }
              ).requestedOrigins = permissions.origins;
              return requestPermission(permissions);
            },
          });
        });
      },
    );
    await expect(
      settingsPopup.getByText(`开启前将请求：${permissionPattern}`),
    ).toBeVisible();
    await settingsPopup.getByLabel("网站自动翻译").click();
    await expect(
      settingsPopup.getByText("网站自动翻译已开启"),
    ).toBeVisible();
    expect(
      await settingsPopup.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              requestedOrigins?: string[];
            }
          ).requestedOrigins,
      ),
    ).toEqual([permissionPattern]);
    await expect
      .poll(() =>
        worker.evaluate(
          (origin) => chrome.permissions.contains({ origins: [origin] }),
          permissionPattern,
        ),
      )
      .toBe(true);
    await settingsPopup.close();

    await page.reload();
    await expect(page.getByText("自动翻译。")).toBeVisible();
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(1);

    const disablePopup = await openWebsiteOverride(
      context,
      extensionId,
      page,
      async (popup) => {
        await popup.addInitScript(() => {
          Object.defineProperty(chrome.permissions, "remove", {
            value: async (
              permissions: chrome.permissions.Permissions,
            ) => {
              (
                globalThis as typeof globalThis & {
                  removedOrigins?: string[];
                }
              ).removedOrigins = permissions.origins;
              return true;
            },
          });
        });
      },
    );
    await disablePopup.getByLabel("网站自动翻译").uncheck();
    await expect(
      disablePopup.getByText(
        "网站自动翻译已关闭，网站权限已撤销",
      ),
    ).toBeVisible();
    expect(
      await disablePopup.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              removedOrigins?: string[];
            }
          ).removedOrigins,
      ),
    ).toEqual([permissionPattern]);
    await disablePopup.close();

    await page.reload();
    await expect
      .poll(() => fakeServer.receivedRequests, { timeout: 500 })
      .toHaveLength(1);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("拒绝网站权限后不启用自动翻译且手动翻译仍可使用", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Manual translation remains.</p></main>",
    responseBody: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [{ id: "block-0", text: "仍可手动翻译。" }],
            }),
          },
        },
      ],
    },
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    browserLanguage: "zh-CN",
    hostPermissions: ["http://127.0.0.1/*"],
    tabUrlAccess: true,
  });

  try {
    await saveConfiguration(optionsPage, fakeServer.endpoint);
    const page = await context.newPage();
    const pageUrl = new URL(fakeServer.pageUrl);
    pageUrl.hostname = "localhost";
    await page.goto(pageUrl.href);
    const settingsPopup = await openWebsiteOverride(
      context,
      extensionId,
      page,
      async (popup) => {
        await popup.addInitScript(() => {
          Object.defineProperty(chrome.permissions, "request", {
            value: async () => false,
          });
        });
      },
    );
    await settingsPopup.getByLabel("网站自动翻译").click();
    await expect(
      settingsPopup.getByText(
        "权限被拒绝，网站自动翻译未开启；仍可手动翻译",
      ),
    ).toBeVisible();
    await expect(
      settingsPopup.getByLabel("网站自动翻译"),
    ).not.toBeChecked();
    await expect
      .poll(() =>
        settingsPopup.evaluate(() =>
          chrome.permissions.contains({
            origins: ["http://localhost/*"],
          }),
        ),
      )
      .toBe(false);
    await settingsPopup.close();

    await page.reload();
    await page.waitForTimeout(250);
    expect(fakeServer.receivedRequests).toHaveLength(0);

    const manualPage = await context.newPage();
    await manualPage.goto(fakeServer.pageUrl);
    await translateCurrentPage(context, extensionId, manualPage);
    await expect(manualPage.getByText("仍可手动翻译。")).toBeVisible();
    await expect.poll(() => fakeServer.receivedRequests).toHaveLength(1);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("同一 host 的其他网站覆盖仍需自动翻译时保留共享权限", async () => {
  const firstServer = await startFakeOpenAiServer();
  const secondServer = await startFakeOpenAiServer();
  const { context, extensionId } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  async function enableAutomaticTranslation(page: Page): Promise<void> {
    const popup = await openWebsiteOverride(context, extensionId, page);
    await popup.getByLabel("网站自动翻译").click();
    await expect(
      popup.getByText("网站自动翻译已开启"),
    ).toBeVisible();
    await popup.close();
  }

  try {
    const firstPage = await context.newPage();
    await firstPage.goto(firstServer.pageUrl);
    await enableAutomaticTranslation(firstPage);
    const secondPage = await context.newPage();
    await secondPage.goto(secondServer.pageUrl);
    await enableAutomaticTranslation(secondPage);

    const disablePopup = await openWebsiteOverride(
      context,
      extensionId,
      firstPage,
      async (popup) => {
        await popup.addInitScript(() => {
          Object.defineProperty(chrome.permissions, "remove", {
            value: async () => {
              (
                globalThis as typeof globalThis & {
                  permissionRemovalCalled?: boolean;
                }
              ).permissionRemovalCalled = true;
              return true;
            },
          });
        });
      },
    );
    await disablePopup.getByLabel("网站自动翻译").uncheck();
    await expect(
      disablePopup.getByText(
        "网站自动翻译已关闭；网站权限仍供其他覆盖设置使用",
      ),
    ).toBeVisible();
    expect(
      await disablePopup.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              permissionRemovalCalled?: boolean;
            }
          ).permissionRemovalCalled,
      ),
    ).toBeUndefined();
  } finally {
    await context.close();
    await firstServer.close();
    await secondServer.close();
  }
});
