import type { BrowserContext, Page } from "@playwright/test";

export async function saveMinimalLlmConfiguration(
  page: Page,
  endpoint: string,
  name = "测试 LLM 配置",
): Promise<void> {
  await page.getByRole("button", { name: "新增 LLM 配置" }).click();
  await page.getByLabel("名称").fill(name);
  await page.getByLabel("服务地址").fill(endpoint);
  await page.getByLabel("API Key").fill("translation-secret");
  await page.getByLabel("模型").fill("translation-model");
  await page.getByRole("button", { name: "保存配置" }).click();
}

export function translationCompletion(
  translations: Array<{ id: string; text: string }>,
): unknown {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({ translations }),
        },
      },
    ],
  };
}

export async function triggerCurrentPageTranslation(
  context: BrowserContext,
  extensionId: string,
  page: Page,
): Promise<void> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.bringToFront();
  await popup.getByRole("button", { name: "翻译当前网页" }).click();
}
