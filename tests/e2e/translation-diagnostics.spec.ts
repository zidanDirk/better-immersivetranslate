import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { launchExtension } from "./extension";
import { startFakeOpenAiServer } from "./fake-openai-server";
import {
  saveMinimalLlmConfiguration,
  translationCompletion,
  triggerCurrentPageTranslation,
} from "./translation-test-support";

test("用户明确开启和关闭翻译诊断日志", async () => {
  const { context, optionsPage } = await launchExtension();

  try {
    const diagnostics = optionsPage.getByRole("region", {
      name: "翻译诊断日志",
    });
    const toggle = diagnostics.getByRole("checkbox", {
      name: "保存翻译诊断日志",
    });

    await expect(toggle).not.toBeChecked();
    await expect(diagnostics).toContainText(
      "系统下载目录/better-immersivetranslate/logs/",
    );
    await optionsPage.evaluate(() => {
      let downloadsGranted = false;
      Object.defineProperties(chrome.permissions, {
        request: {
          value: async () => {
            downloadsGranted = true;
            return true;
          },
        },
        contains: {
          value: async () => downloadsGranted,
        },
        remove: {
          value: async () => {
            downloadsGranted = false;
            return true;
          },
        },
      });
    });

    await toggle.click();

    await expect(toggle).toBeChecked();
    await expect(diagnostics).toContainText("翻译诊断日志已开启");
    await expect
      .poll(() =>
        optionsPage.evaluate(() =>
          chrome.permissions.contains({ permissions: ["downloads"] }),
        ),
      )
      .toBe(true);

    await toggle.uncheck();

    await expect(toggle).not.toBeChecked();
    await expect(diagnostics).toContainText("翻译诊断日志已关闭");
    await expect
      .poll(() =>
        optionsPage.evaluate(() =>
          chrome.permissions.contains({ permissions: ["downloads"] }),
        ),
      )
      .toBe(false);
  } finally {
    await context.close();
  }
});

test("用户拒绝下载权限时翻译诊断日志保持关闭", async () => {
  const { context, optionsPage } = await launchExtension();

  try {
    await optionsPage.evaluate(() => {
      Object.defineProperty(chrome.permissions, "request", {
        value: async () => false,
      });
    });
    const toggle = optionsPage.getByRole("checkbox", {
      name: "保存翻译诊断日志",
    });

    await toggle.click();

    await expect(toggle).not.toBeChecked();
    await expect(
      optionsPage.getByRole("region", { name: "翻译诊断日志" }),
    ).toContainText("下载权限被拒绝，翻译诊断日志未开启");
    expect(
      await optionsPage.evaluate(async () => {
        const stored = await chrome.storage.local.get(
          "translationDiagnosticsEnabled",
        );
        return stored.translationDiagnosticsEnabled;
      }),
    ).not.toBe(true);
  } finally {
    await context.close();
  }
});

test("LLM 连接测试失败不生成翻译诊断日志", async () => {
  const fakeServer = await startFakeOpenAiServer({ statusCode: 401 });
  const { context, optionsPage } = await launchExtension({
    requiredPermissions: ["downloads"],
  });

  try {
    await saveMinimalLlmConfiguration(optionsPage, fakeServer.endpoint);
    await optionsPage.evaluate(() =>
      chrome.storage.local.set({ translationDiagnosticsEnabled: true }),
    );

    await optionsPage
      .getByRole("button", { name: "测试连接 测试 LLM 配置" })
      .click();

    await expect(optionsPage.getByText("认证失败：请检查 API Key")).toBeVisible();
    expect(
      await optionsPage.evaluate(async () => {
        const stored = await chrome.storage.local.get(
          "translationDiagnosticsStatus",
        );
        return stored.translationDiagnosticsStatus;
      }),
    ).toBeUndefined();
    expect(
      await optionsPage.evaluate(() => chrome.downloads.search({})),
    ).toHaveLength(0);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("划词翻译失败不生成翻译诊断日志", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Selected private text.</p></main>",
    statusCode: 401,
  });
  const { context, optionsPage, worker } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
    requiredPermissions: ["downloads"],
  });

  try {
    await saveMinimalLlmConfiguration(optionsPage, fakeServer.endpoint);
    await optionsPage.evaluate(() =>
      chrome.storage.local.set({ translationDiagnosticsEnabled: true }),
    );
    const article = await context.newPage();
    await article.goto(fakeServer.pageUrl);
    await article.getByText("Selected private text.").selectText();

    await worker.evaluate(async (pageUrl) => {
      const [pageTab] = await chrome.tabs.query({ url: pageUrl });
      if (pageTab?.id === undefined) {
        throw new Error("没有找到划词翻译测试页面");
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
          editable: false,
          frameId: 0,
          menuItemId: "translate-selected-text",
          pageUrl,
          selectionText: "Selected private text.",
        },
        pageTab,
      );
    }, fakeServer.pageUrl);

    expect(fakeServer.receivedRequests).toHaveLength(1);
    expect(
      await optionsPage.evaluate(async () => {
        const stored = await chrome.storage.local.get(
          "translationDiagnosticsStatus",
        );
        return stored.translationDiagnosticsStatus;
      }),
    ).toBeUndefined();
    expect(
      await optionsPage.evaluate(() => chrome.downloads.search({})),
    ).toHaveLength(0);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("最终失败批次保存去敏后的翻译诊断日志", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml:
      "<title>Private article</title><main><p>Source text for diagnostics.</p></main>",
    responseBody: {
      error: {
        message: "Authentication failed for supplied credential",
      },
    },
    statusCode: 401,
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
    requiredPermissions: ["downloads"],
  });

  try {
    await saveMinimalLlmConfiguration(optionsPage, fakeServer.endpoint);
    await optionsPage.getByRole("button", { name: "编辑 测试 LLM 配置" }).click();
    await optionsPage
      .getByLabel("请求参数")
      .fill('{"temperature":0.2,"accessToken":"request-secret"}');
    await optionsPage
      .getByLabel("自定义请求头")
      .fill('{"X-Test":"header-secret"}');
    await optionsPage.getByRole("button", { name: "保存配置" }).click();
    await optionsPage.evaluate(() =>
      chrome.storage.local.set({ translationDiagnosticsEnabled: true }),
    );

    const article = await context.newPage();
    await article.goto(fakeServer.pageUrl);
    await article.evaluate(() =>
      history.replaceState(
        null,
        "",
        `${location.pathname}?token=page-secret#private-fragment`,
      ),
    );
    await triggerCurrentPageTranslation(context, extensionId, article);

    await expect(
      article
        .getByRole("region", { name: "翻译进度" })
        .getByText("批次 1：认证失败：请检查 API Key"),
    ).toBeVisible();

    await expect
      .poll(() =>
        optionsPage.evaluate(async () => {
          const stored = await chrome.storage.local.get(
            "translationDiagnosticsStatus",
          );
          const status = stored.translationDiagnosticsStatus as
            | { downloadId?: number }
            | undefined;
          if (status?.downloadId !== undefined) {
            const [log] = await chrome.downloads.search({
              id: status.downloadId,
            });
            if (log) {
              return { filename: log.filename, state: log.state };
            }
          }
          return {
            state: "missing",
            status,
          };
        }),
      )
      .toEqual({
        filename: expect.any(String),
        state: "complete",
      });

    const logPath = await optionsPage.evaluate(async () => {
      const stored = await chrome.storage.local.get(
        "translationDiagnosticsStatus",
      );
      const status = stored.translationDiagnosticsStatus as {
        downloadId: number;
      };
      const [download] = await chrome.downloads.search({
        id: status.downloadId,
      });
      if (!download) throw new Error("翻译诊断日志下载记录不存在");
      return download.filename;
    });
    const log = JSON.parse(await readFile(logPath, "utf8")) as {
      schemaVersion: number;
      failureKind: string;
      task: {
        page: { title: string; url: string };
        blocks: Array<{ id: string; text: string }>;
      };
      attempts: Array<{
        configuration: Record<string, unknown>;
        request: { body: Record<string, unknown> };
        response: {
          status: number;
          body: {
            text: string;
            truncated: boolean;
          };
        };
      }>;
    };

    expect(log.schemaVersion).toBe(1);
    expect(log.failureKind).toBe("authentication");
    expect(log.task.page).toEqual({
      title: "Private article",
      url: new URL(fakeServer.pageUrl).href,
    });
    expect(log.task.blocks).toEqual([
      {
        id: "block-0",
        text: "Source text for diagnostics.",
        version: 0,
      },
    ]);
    expect(log.attempts).toHaveLength(1);
    expect(log.attempts[0]?.configuration).toEqual({
      name: "测试 LLM 配置",
      endpoint: fakeServer.endpoint,
      model: "translation-model",
      requestParameters: {
        temperature: 0.2,
        accessToken: "[REDACTED]",
      },
      customHeaderNames: ["X-Test"],
    });
    expect(log.attempts[0]?.request.body).toMatchObject({
      model: "translation-model",
      temperature: 0.2,
      accessToken: "[REDACTED]",
    });
    expect(JSON.stringify(log)).not.toContain("translation-secret");
    expect(JSON.stringify(log)).not.toContain("header-secret");
    expect(JSON.stringify(log)).not.toContain("page-secret");
    expect(log.attempts[0]?.response.status).toBe(401);
    expect(log.attempts[0]?.response.body).toMatchObject({
      truncated: false,
      text: JSON.stringify({
        error: {
          message: "Authentication failed for supplied credential",
        },
      }),
    });

    const expectedDirectory = logPath.slice(
      0,
      Math.max(logPath.lastIndexOf("/"), logPath.lastIndexOf("\\")) + 1,
    );
    const diagnostics = optionsPage.getByRole("region", {
      name: "翻译诊断日志",
    });
    await expect(diagnostics).toContainText(expectedDirectory);
    await optionsPage.evaluate(() => {
      Object.defineProperty(chrome.downloads, "show", {
        value: async (downloadId: number) => {
          (
            globalThis as typeof globalThis & {
              shownDiagnosticsDownloadId?: number;
            }
          ).shownDiagnosticsDownloadId = downloadId;
        },
      });
    });
    await diagnostics
      .getByRole("button", { name: "在文件夹中显示" })
      .click();
    await expect
      .poll(() =>
        optionsPage.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                shownDiagnosticsDownloadId?: number;
              }
            ).shownDiagnosticsDownloadId,
        ),
      )
      .toBe(1);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("日志写入失败不改变翻译失败并同时在网页和设置页提示", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Source remains readable.</p></main>",
    statusCode: 401,
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    await saveMinimalLlmConfiguration(optionsPage, fakeServer.endpoint);
    await optionsPage.evaluate(() =>
      chrome.storage.local.set({ translationDiagnosticsEnabled: true }),
    );
    const article = await context.newPage();
    await article.goto(fakeServer.pageUrl);

    await triggerCurrentPageTranslation(context, extensionId, article);

    const progress = article.getByRole("region", { name: "翻译进度" });
    await expect(progress).toContainText("认证失败：请检查 API Key");
    await expect(progress).toContainText("诊断日志未保存");
    await expect(
      article.getByText("Source remains readable.", { exact: true }),
    ).toBeVisible();

    await optionsPage.reload();
    await expect(
      optionsPage.getByRole("region", { name: "翻译诊断日志" }),
    ).toContainText("最近一次日志未保存：下载权限已被撤销");
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("超大失败响应只在翻译诊断日志中保留首尾各 512 KiB", async () => {
  const payload = `BEGIN-${"x".repeat(1024 * 1024)}-END`;
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Large response source.</p></main>",
    responseBody: { payload },
    statusCode: 401,
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
    requiredPermissions: ["downloads"],
  });

  try {
    await saveMinimalLlmConfiguration(optionsPage, fakeServer.endpoint);
    await optionsPage.evaluate(() =>
      chrome.storage.local.set({ translationDiagnosticsEnabled: true }),
    );
    const article = await context.newPage();
    await article.goto(fakeServer.pageUrl);

    await triggerCurrentPageTranslation(context, extensionId, article);
    await expect(
      article.getByRole("region", { name: "翻译进度" }),
    ).toContainText("认证失败：请检查 API Key");

    await expect
      .poll(() =>
        optionsPage.evaluate(async () => {
          const stored = await chrome.storage.local.get(
            "translationDiagnosticsStatus",
          );
          return (
            stored.translationDiagnosticsStatus as
              | { kind?: string }
              | undefined
          )?.kind;
        }),
      )
      .toBe("saved");
    const logPath = await optionsPage.evaluate(async () => {
      const stored = await chrome.storage.local.get(
        "translationDiagnosticsStatus",
      );
      const status = stored.translationDiagnosticsStatus as {
        downloadId: number;
      };
      const [download] = await chrome.downloads.search({
        id: status.downloadId,
      });
      if (!download) throw new Error("翻译诊断日志下载记录不存在");
      return download.filename;
    });
    const log = JSON.parse(await readFile(logPath, "utf8")) as {
      attempts: Array<{
        response: {
          body: {
            byteLength: number;
            head?: string;
            tail?: string;
            text?: string;
            truncated: boolean;
          };
        };
      }>;
    };
    const responseBody = log.attempts[0]?.response.body;

    expect(responseBody).toMatchObject({
      truncated: true,
    });
    expect(responseBody?.byteLength).toBeGreaterThan(1024 * 1024);
    expect(responseBody?.head).toHaveLength(512 * 1024);
    expect(responseBody?.head).toMatch(/^{"payload":"BEGIN-/);
    expect(responseBody?.tail).toHaveLength(512 * 1024);
    expect(responseBody?.tail).toMatch(/-END"}$/);
    expect(responseBody?.text).toBeUndefined();
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("自动重试后恢复的翻译批次不生成翻译诊断日志", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Recoverable source.</p></main>",
    responseSequence: [
      { responseBody: { error: "rate limited" }, statusCode: 429 },
      {
        responseBody: translationCompletion([
          { id: "block-0", text: "Recovered translation." },
        ]),
      },
    ],
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
    requiredPermissions: ["downloads"],
  });

  try {
    await saveMinimalLlmConfiguration(optionsPage, fakeServer.endpoint);
    await optionsPage.evaluate(() =>
      chrome.storage.local.set({ translationDiagnosticsEnabled: true }),
    );
    const article = await context.newPage();
    await article.goto(fakeServer.pageUrl);

    await triggerCurrentPageTranslation(context, extensionId, article);

    await expect(
      article.getByText("Recovered translation.", { exact: true }),
    ).toBeVisible();
    await article.waitForTimeout(250);
    expect(fakeServer.receivedRequests).toHaveLength(2);
    expect(
      await optionsPage.evaluate(async () => {
        const stored = await chrome.storage.local.get(
          "translationDiagnosticsStatus",
        );
        return stored.translationDiagnosticsStatus;
      }),
    ).toBeUndefined();
    expect(
      await optionsPage.evaluate(() => chrome.downloads.search({})),
    ).toHaveLength(0);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("最终失败日志保留同一批次的全部自动请求尝试", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Persistently rate-limited source.</p></main>",
    responseBody: { error: "rate limited" },
    statusCode: 429,
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
    requiredPermissions: ["downloads"],
  });

  try {
    await saveMinimalLlmConfiguration(optionsPage, fakeServer.endpoint);
    await optionsPage.evaluate(() =>
      chrome.storage.local.set({ translationDiagnosticsEnabled: true }),
    );
    const article = await context.newPage();
    await article.goto(fakeServer.pageUrl);

    await triggerCurrentPageTranslation(context, extensionId, article);

    await expect(
      article.getByRole("region", { name: "翻译进度" }),
    ).toContainText("请求受限：请稍后手动重试");
    expect(fakeServer.receivedRequests).toHaveLength(4);
    const logPath = await optionsPage.evaluate(async () => {
      const stored = await chrome.storage.local.get(
        "translationDiagnosticsStatus",
      );
      const status = stored.translationDiagnosticsStatus as {
        downloadId: number;
      };
      const [download] = await chrome.downloads.search({
        id: status.downloadId,
      });
      if (!download) throw new Error("翻译诊断日志下载记录不存在");
      return download.filename;
    });
    const log = JSON.parse(await readFile(logPath, "utf8")) as {
      attempts: Array<{ durationMs: number; failureKind: string }>;
      failureKind: string;
    };

    expect(log.failureKind).toBe("rate-limit");
    expect(log.attempts).toHaveLength(4);
    expect(
      log.attempts.every(
        ({ durationMs, failureKind }) =>
          durationMs >= 0 && failureKind === "rate-limit",
      ),
    ).toBe(true);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("手动重试再次失败的日志关联原翻译任务", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: "<main><p>Retry source.</p></main>",
    statusCode: 401,
  });
  const { context, extensionId, optionsPage } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
    requiredPermissions: ["downloads"],
  });

  try {
    await saveMinimalLlmConfiguration(optionsPage, fakeServer.endpoint);
    await optionsPage.evaluate(() =>
      chrome.storage.local.set({ translationDiagnosticsEnabled: true }),
    );
    const article = await context.newPage();
    await article.goto(fakeServer.pageUrl);
    await triggerCurrentPageTranslation(context, extensionId, article);

    const retry = article.getByRole("button", { name: "重试批次 1" });
    await expect(retry).toBeVisible();
    const firstStatus = await optionsPage.evaluate(async () => {
      const stored = await chrome.storage.local.get(
        "translationDiagnosticsStatus",
      );
      return stored.translationDiagnosticsStatus as { downloadId: number };
    });
    const [firstDownload] = await optionsPage.evaluate(
      (downloadId) => chrome.downloads.search({ id: downloadId }),
      firstStatus.downloadId,
    );
    if (!firstDownload) throw new Error("首次失败日志不存在");
    const firstLog = JSON.parse(
      await readFile(firstDownload.filename, "utf8"),
    ) as {
      task: { id: string };
    };

    await retry.click();

    await expect
      .poll(() =>
        optionsPage.evaluate(async () => {
          const stored = await chrome.storage.local.get(
            "translationDiagnosticsStatus",
          );
          return (
            stored.translationDiagnosticsStatus as
              | { downloadId?: number }
              | undefined
          )?.downloadId;
        }),
      )
      .not.toBe(firstStatus.downloadId);
    const retryStatus = await optionsPage.evaluate(async () => {
      const stored = await chrome.storage.local.get(
        "translationDiagnosticsStatus",
      );
      return stored.translationDiagnosticsStatus as { downloadId: number };
    });
    const [retryDownload] = await optionsPage.evaluate(
      (downloadId) => chrome.downloads.search({ id: downloadId }),
      retryStatus.downloadId,
    );
    if (!retryDownload) throw new Error("手动重试失败日志不存在");
    const retryLog = JSON.parse(
      await readFile(retryDownload.filename, "utf8"),
    ) as {
      task: {
        batchIndex: number;
        relatedTaskId?: string;
        source: string;
      };
    };

    expect(retryLog.task).toMatchObject({
      batchIndex: 0,
      relatedTaskId: firstLog.task.id,
      source: "manual-retry",
    });
  } finally {
    await context.close();
    await fakeServer.close();
  }
});
