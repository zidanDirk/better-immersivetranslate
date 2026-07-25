import { chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";

export async function launchExtension(): Promise<{
  context: BrowserContext;
  optionsPage: Page;
}> {
  const extensionPath = path.resolve("dist");
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 5_000 });
  }
  const extensionId = new URL(worker.url()).host;

  const optionsPage = await context.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);

  return { context, optionsPage };
}
