import {
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function launchExtension(options?: {
  browserLanguage?: string;
  hostPermissions?: string[];
  requiredPermissions?: string[];
  tabUrlAccess?: boolean;
}): Promise<{
  context: BrowserContext;
  extensionId: string;
  optionsPage: Page;
  worker: Worker;
}> {
  let extensionPath = path.resolve("dist");
  let temporaryExtensionPath: string | undefined;
  if (
    options?.hostPermissions ||
    options?.requiredPermissions ||
    options?.tabUrlAccess
  ) {
    temporaryExtensionPath = await mkdtemp(
      path.join(tmpdir(), "better-immersivetranslate-e2e-"),
    );
    await cp(extensionPath, temporaryExtensionPath, { recursive: true });
    const manifestPath = path.join(temporaryExtensionPath, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    if (options.hostPermissions) {
      manifest.host_permissions = options.hostPermissions;
    }
    if (options.requiredPermissions) {
      manifest.permissions = [
        ...new Set([
          ...((manifest.permissions as string[]) ?? []),
          ...options.requiredPermissions,
        ]),
      ];
      manifest.optional_permissions = (
        (manifest.optional_permissions as string[]) ?? []
      ).filter(
        (permission) => !options.requiredPermissions?.includes(permission),
      );
    }
    if (options.tabUrlAccess) {
      manifest.permissions = [
        ...((manifest.permissions as string[]) ?? []),
        "tabs",
      ];
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    extensionPath = temporaryExtensionPath;
  }

  const extensionArguments = [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ];
  if (options?.browserLanguage) {
    extensionArguments.push(`--lang=${options.browserLanguage}`);
  }
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: extensionArguments,
    locale: options?.browserLanguage,
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 5_000 });
  }
  const extensionId = new URL(worker.url()).host;

  if (temporaryExtensionPath) {
    context.on("close", () => {
      void rm(temporaryExtensionPath, { force: true, recursive: true });
    });
  }

  const optionsPage = await context.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);

  return { context, extensionId, optionsPage, worker };
}
