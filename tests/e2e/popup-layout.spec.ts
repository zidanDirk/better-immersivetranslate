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

test("展开网站覆盖设置后仍可操作", async () => {
  const fakeServer = await startFakeOpenAiServer();
  const { context, extensionId } = await launchExtension({
    hostPermissions: ["http://127.0.0.1/*"],
  });

  try {
    const activePage = await context.newPage();
    await activePage.goto(fakeServer.pageUrl);

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 600 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await activePage.bringToFront();
    await popup.getByRole("button", { name: "网站覆盖设置" }).click();

    await expect(popup.getByRole("heading", { name: "网站覆盖设置" })).toBeVisible();
    const form = popup.locator("#website-override-form");
    await expect(form).toHaveCSS("overflow-y", "auto");
    await popup.getByLabel("网站目标语言").fill("ja");
    await expect(
      popup.getByRole("button", { name: "保存网站覆盖设置" }),
    ).toBeVisible();
    await popup.getByRole("button", { name: "保存网站覆盖设置" }).click();
    await expect(popup.getByText("网站覆盖设置已保存")).toBeVisible();
  } finally {
    await context.close();
    await fakeServer.close();
  }
});
