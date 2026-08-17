import { expect, test } from "@playwright/test";
import { launchExtension } from "./extension";
import { startFakeOpenAiServer } from "./fake-openai-server";

test("弹窗以可读的宽度展示主操作和阅读方式", async () => {
  const { context, extensionId } = await launchExtension();

  try {
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 600 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await expect(popup.locator("body")).toHaveCSS("width", "360px");
    await expect(
      popup.getByRole("heading", { name: "网页沉浸式翻译" }),
    ).toBeVisible();
    const translateButton = popup.getByRole("button", {
      name: "翻译当前网页",
    });
    const translateButtonBox = await translateButton.boundingBox();
    expect(translateButtonBox?.width).toBeGreaterThanOrEqual(320);

    const readingButtons = popup.getByRole("button", {
      name: /双语对照|仅译文|仅原文/,
    });
    await expect(readingButtons).toHaveCount(3);

    const boxes = await readingButtons.evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return { height: box.height, width: box.width, y: box.y };
      }),
    );

    expect(boxes.every((box) => box.width >= 88)).toBe(true);
    expect(new Set(boxes.map((box) => box.y)).size).toBe(1);
    expect(boxes.every((box) => box.height >= 36)).toBe(true);
  } finally {
    await context.close();
  }
});

test("阅读方式默认选中双语对照且仅有一个选中项", async () => {
  const { context, extensionId } = await launchExtension();

  try {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    const readingButtons = popup.getByRole("button", {
      name: /双语对照|仅译文|仅原文/,
    });
    await expect(readingButtons).toHaveCount(3);
    const defaultReadingMode = popup.getByRole("button", {
      name: "双语对照",
    });
    await expect(defaultReadingMode).toHaveAttribute("aria-pressed", "true");
    await expect(defaultReadingMode).toHaveCSS(
      "background-color",
      "rgb(31, 95, 213)",
    );
    await expect(
      popup.locator('[data-reading-mode][aria-pressed="true"]'),
    ).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test("切换阅读方式后弹窗保持打开并更新唯一选中项", async () => {
  const fakeServer = await startFakeOpenAiServer({
    pageHtml: `
      <p data-better-immersive-block-id="block-0">
        Hello
        <span data-better-immersive-translation-for="block-0">你好</span>
      </p>
    `,
  });
  const { context, extensionId } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    const activePage = await context.newPage();
    await activePage.goto(fakeServer.pageUrl);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await activePage.bringToFront();

    await popup.getByRole("button", { name: "仅译文" }).click();

    await expect(
      activePage.locator('[data-better-immersive-block-id="block-0"]'),
    ).toHaveAttribute(
      "data-better-immersive-reading-mode",
      "translation-only",
    );
    expect(popup.isClosed()).toBe(false);
    const selectedReadingMode = popup.getByRole("button", { name: "仅译文" });
    await expect(selectedReadingMode).toHaveAttribute("aria-pressed", "true");
    await popup.getByRole("heading", { name: "网页沉浸式翻译" }).hover();
    await expect(selectedReadingMode).toHaveCSS(
      "background-color",
      "rgb(31, 95, 213)",
    );
    await expect(
      popup.locator('[data-reading-mode][aria-pressed="true"]'),
    ).toHaveCount(1);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("弹窗只保留 LLM 配置一级入口并可打开配置页", async () => {
  const { context, extensionId, optionsPage } = await launchExtension();

  try {
    await optionsPage.close();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await expect(
      popup.getByRole("button", { name: "网站覆盖设置" }),
    ).toHaveCount(0);
    const llmConfigurationEntry = popup.getByRole("button", {
      name: "LLM 配置",
    });
    await expect(llmConfigurationEntry).toBeVisible();

    const openedPagePromise = context.waitForEvent("page");
    await llmConfigurationEntry.click();
    const openedPage = await openedPagePromise;

    await expect(openedPage).toHaveURL(
      `chrome-extension://${extensionId}/options.html`,
    );
    await expect(
      openedPage.getByRole("heading", { name: "你的翻译工作台" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("弹窗命令失败时保持打开并显示可重试状态", async () => {
  const fakeServer = await startFakeOpenAiServer();
  const { context, extensionId } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    const activePage = await context.newPage();
    await activePage.goto(fakeServer.pageUrl);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const popupErrors: string[] = [];
    popup.on("pageerror", (error) => popupErrors.push(error.message));
    await popup.evaluate(() => {
      Object.defineProperty(chrome.runtime, "sendMessage", {
        value: async () => {
          throw new Error("Extension context invalidated.");
        },
      });
    });
    await activePage.bringToFront();

    await popup.getByRole("button", { name: "翻译当前网页" }).click();

    await expect(
      popup.getByText("翻译任务启动失败，请重试"),
    ).toBeVisible();
    expect(popup.isClosed()).toBe(false);
    expect(popupErrors).toEqual([]);
  } finally {
    await context.close();
    await fakeServer.close();
  }
});

test("打开设置的 Chrome API 同步抛错时显示状态而不产生未捕获异常", async () => {
  const { context, extensionId } = await launchExtension();

  try {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const popupErrors: string[] = [];
    popup.on("pageerror", (error) => popupErrors.push(error.message));
    await popup.evaluate(() => {
      Object.defineProperty(chrome.runtime, "openOptionsPage", {
        value: () => {
          throw new Error("Extension context invalidated.");
        },
      });
    });

    await popup.getByRole("button", { name: "LLM 配置" }).click();

    await expect(popup.getByText("设置页打开失败，请重试")).toBeVisible();
    expect(popupErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
