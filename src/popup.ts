import {
  isReadingMode,
  type ReadingMode,
} from "./page-translation.js";
import {
  isWebsitePermissionStillNeeded,
  loadWebsiteOverride,
  saveWebsiteOverride,
  type WebsiteOverride,
  type WebsiteAccess,
  websiteAccess,
} from "./website-overrides.js";
import { runUiTask } from "./ui-task.js";

const translateButton = document.querySelector<HTMLButtonElement>(
  "#translate-current-page",
);

if (!translateButton) {
  throw new Error("扩展弹窗缺少翻译按钮");
}

type ActiveTabCommand =
  | { kind: "translate-current-page" }
  | { kind: "set-reading-mode"; mode: ReadingMode };

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  return tab;
}

async function sendCommandToActiveTab(command: ActiveTabCommand): Promise<void> {
  const tab = await activeTab();
  if (tab?.id === undefined) {
    return;
  }

  const response = await chrome.runtime.sendMessage({
    ...command,
    tabId: tab.id,
  });
  if (responseFailed(response)) {
    if (!tab.url || !websiteAccess(tab.url)) {
      window.close();
      return;
    }
    throw new Error("扩展命令执行失败");
  }
  window.close();
}

const openWebsiteOverrideButton = document.querySelector<HTMLButtonElement>(
  "#open-website-override",
);
const websiteOverrideForm = document.querySelector<HTMLFormElement>(
  "#website-override-form",
);
const websiteOriginLabel =
  document.querySelector<HTMLElement>("#website-origin");
const websiteTargetLanguage =
  document.querySelector<HTMLInputElement>('[name="websiteTargetLanguage"]');
const websiteTranslationPrompt =
  document.querySelector<HTMLTextAreaElement>(
    '[name="websiteTranslationPrompt"]',
  );
const websiteOverrideStatus = document.querySelector<HTMLElement>(
  "#website-override-status",
);
const automaticTranslation =
  document.querySelector<HTMLInputElement>('[name="automaticTranslation"]');
const selectionTranslation =
  document.querySelector<HTMLSelectElement>('[name="selectionTranslation"]');
const websitePermissionRequest = document.querySelector<HTMLElement>(
  "#website-permission-request",
);
const openLlmConfigurationButton = document.querySelector<HTMLButtonElement>(
  "#open-llm-configuration",
);
const popupStatus = document.querySelector<HTMLElement>("#popup-status");

if (
  !openWebsiteOverrideButton ||
  !websiteOverrideForm ||
  !websiteOriginLabel ||
  !websiteTargetLanguage ||
  !websiteTranslationPrompt ||
  !websiteOverrideStatus ||
  !automaticTranslation ||
  !selectionTranslation ||
  !websitePermissionRequest ||
  !openLlmConfigurationButton ||
  !popupStatus
) {
  throw new Error("扩展弹窗缺少网站覆盖设置");
}

let editingWebsiteAccess: WebsiteAccess | null = null;
let editingTabId: number | undefined;
let savedAutomaticTranslation = false;
let savedSelectionTranslation: WebsiteOverride["selectionTranslation"] =
  "inherit";

function responseFailed(response: unknown): boolean {
  return (
    typeof response === "object" &&
    response !== null &&
    "kind" in response &&
    response.kind === "failed"
  );
}

function editedWebsiteOverride(automatic: boolean): WebsiteOverride | null {
  if (!editingWebsiteAccess) return null;
  const selectionPreference: WebsiteOverride["selectionTranslation"] =
    selectionTranslation?.value === "enabled" ||
    selectionTranslation?.value === "disabled"
      ? selectionTranslation.value
      : "inherit";
  return {
    origin: editingWebsiteAccess.origin,
    targetLanguage: websiteTargetLanguage?.value.trim() ?? "",
    translationPrompt: websiteTranslationPrompt?.value.trim() ?? "",
    automaticTranslation: automatic,
    selectionTranslation: selectionPreference,
  };
}

openWebsiteOverrideButton.addEventListener("click", () => {
  runUiTask(async () => {
    const tab = await activeTab();
    const access = tab?.url ? websiteAccess(tab.url) : null;
    if (!access) {
      websiteOverrideStatus.textContent = "当前页面不支持网站覆盖设置";
      websiteOverrideForm.hidden = false;
      return;
    }
    const override = await loadWebsiteOverride(access.origin);
    editingWebsiteAccess = access;
    editingTabId = tab?.id;
    savedAutomaticTranslation = override.automaticTranslation;
    savedSelectionTranslation = override.selectionTranslation;
    websiteOriginLabel.textContent = access.origin;
    websiteTargetLanguage.value = override.targetLanguage;
    websiteTranslationPrompt.value = override.translationPrompt;
    automaticTranslation.checked = override.automaticTranslation;
    selectionTranslation.value = override.selectionTranslation;
    websitePermissionRequest.textContent =
      `开启前将请求：${access.permissionPattern}`;
    websiteOverrideForm.hidden = false;
    openWebsiteOverrideButton.hidden = true;
  }, () => {
    popupStatus.textContent = "网站设置加载失败，请重新打开扩展后重试";
  });
});

selectionTranslation.addEventListener("change", () => {
  const previousSelection = savedSelectionTranslation;
  runUiTask(async () => {
    if (!editingWebsiteAccess) return;
    const enabled = selectionTranslation.value === "enabled";
    if (enabled) {
      const granted = await chrome.permissions.request({
        origins: [editingWebsiteAccess.permissionPattern],
      });
      if (!granted) {
        selectionTranslation.value = previousSelection;
        websiteOverrideStatus.textContent =
          "权限被拒绝，此网站的划词翻译未开启";
        return;
      }
    }
    const override = editedWebsiteOverride(automaticTranslation.checked);
    if (!override) return;
    await saveWebsiteOverride(override);
    try {
      const response = await chrome.runtime.sendMessage({
        kind: "refresh-selection-translation",
        tabId: editingTabId,
        enabled,
      });
      if (responseFailed(response)) {
        throw new Error("刷新划词翻译失败");
      }
    } catch (error) {
      await saveWebsiteOverride({
        ...override,
        selectionTranslation: previousSelection,
      });
      throw error;
    }
    savedSelectionTranslation = override.selectionTranslation;
    websiteOverrideStatus.textContent =
      selectionTranslation.value === "enabled"
        ? "此网站的划词翻译已开启"
        : selectionTranslation.value === "disabled"
          ? "此网站的划词翻译已关闭"
          : "此网站的划词翻译使用全局设置";
  }, () => {
    selectionTranslation.value = previousSelection;
    websiteOverrideStatus.textContent = "划词翻译设置失败，请重试";
  });
});

websiteOverrideForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runUiTask(async () => {
    const override = editedWebsiteOverride(automaticTranslation.checked);
    if (!override) return;
    await saveWebsiteOverride(override);
    savedAutomaticTranslation = override.automaticTranslation;
    savedSelectionTranslation = override.selectionTranslation;
    websiteOverrideStatus.textContent = "网站覆盖设置已保存";
  }, () => {
    websiteOverrideStatus.textContent = "网站覆盖设置保存失败，请重试";
  });
});

openLlmConfigurationButton.addEventListener("click", () => {
  runUiTask(
    () => chrome.runtime.openOptionsPage(),
    () => {
      websiteOverrideStatus.textContent = "设置页打开失败，请重试";
    },
  );
});

automaticTranslation.addEventListener("change", () => {
  const previousAutomatic = savedAutomaticTranslation;
  runUiTask(async () => {
    if (!editingWebsiteAccess) return;
    if (automaticTranslation.checked) {
      const granted = await chrome.permissions.request({
        origins: [editingWebsiteAccess.permissionPattern],
      });
      if (!granted) {
        automaticTranslation.checked = previousAutomatic;
        websiteOverrideStatus.textContent =
          "权限被拒绝，网站自动翻译未开启；仍可手动翻译";
        return;
      }
      const override = editedWebsiteOverride(true);
      if (override) await saveWebsiteOverride(override);
      savedAutomaticTranslation = true;
      websiteOverrideStatus.textContent = "网站自动翻译已开启";
      return;
    }

    const override = editedWebsiteOverride(false);
    if (override) await saveWebsiteOverride(override);
    const stillNeeded = await isWebsitePermissionStillNeeded(
      editingWebsiteAccess.permissionPattern,
    );
    savedAutomaticTranslation = false;
    if (stillNeeded) {
      websiteOverrideStatus.textContent =
        "网站自动翻译已关闭；网站权限仍供其他覆盖设置使用";
      return;
    }
    const removed = await chrome.permissions.remove({
      origins: [editingWebsiteAccess.permissionPattern],
    });
    websiteOverrideStatus.textContent = removed
      ? "网站自动翻译已关闭，网站权限已撤销"
      : "网站自动翻译已关闭，但网站权限撤销失败";
  }, () => {
    automaticTranslation.checked = previousAutomatic;
    websiteOverrideStatus.textContent = "网站自动翻译设置失败，请重试";
  });
});

translateButton.addEventListener("click", () => {
  runUiTask(
    () => sendCommandToActiveTab({ kind: "translate-current-page" }),
    () => {
      popupStatus.textContent = "翻译任务启动失败，请重试";
    },
  );
});

document
  .querySelectorAll<HTMLButtonElement>("[data-reading-mode]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.readingMode;
      if (!isReadingMode(mode)) {
        return;
      }
      runUiTask(
        () =>
          sendCommandToActiveTab({
            kind: "set-reading-mode",
            mode,
          }),
        () => {
          popupStatus.textContent = "阅读方式切换失败，请重试";
        },
      );
    });
  });
