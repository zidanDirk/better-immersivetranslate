import {
  isReadingMode,
  type ReadingMode,
} from "./page-translation.js";
import {
  isWebsitePermissionStillNeeded,
  loadWebsiteOverride,
  saveWebsiteOverride,
  type WebsiteAccess,
  websiteAccess,
} from "./website-overrides.js";

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

  await chrome.runtime.sendMessage({
    ...command,
    tabId: tab.id,
  });
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
const websitePermissionRequest = document.querySelector<HTMLElement>(
  "#website-permission-request",
);

if (
  !openWebsiteOverrideButton ||
  !websiteOverrideForm ||
  !websiteOriginLabel ||
  !websiteTargetLanguage ||
  !websiteTranslationPrompt ||
  !websiteOverrideStatus ||
  !automaticTranslation ||
  !websitePermissionRequest
) {
  throw new Error("扩展弹窗缺少网站覆盖设置");
}

let editingWebsiteAccess: WebsiteAccess | null = null;

function editedWebsiteOverride(automatic: boolean) {
  if (!editingWebsiteAccess) return null;
  return {
    origin: editingWebsiteAccess.origin,
    targetLanguage: websiteTargetLanguage?.value.trim() ?? "",
    translationPrompt: websiteTranslationPrompt?.value.trim() ?? "",
    automaticTranslation: automatic,
  };
}

openWebsiteOverrideButton.addEventListener("click", async () => {
  const tab = await activeTab();
  const access = tab?.url ? websiteAccess(tab.url) : null;
  if (!access) {
    websiteOverrideStatus.textContent = "当前页面不支持网站覆盖设置";
    websiteOverrideForm.hidden = false;
    return;
  }
  const override = await loadWebsiteOverride(access.origin);
  editingWebsiteAccess = access;
  websiteOriginLabel.textContent = access.origin;
  websiteTargetLanguage.value = override.targetLanguage;
  websiteTranslationPrompt.value = override.translationPrompt;
  automaticTranslation.checked = override.automaticTranslation;
  websitePermissionRequest.textContent =
    `开启前将请求：${access.permissionPattern}`;
  websiteOverrideForm.hidden = false;
  openWebsiteOverrideButton.hidden = true;
});

websiteOverrideForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const override = editedWebsiteOverride(automaticTranslation.checked);
  if (!override) return;
  await saveWebsiteOverride(override);
  websiteOverrideStatus.textContent = "网站覆盖设置已保存";
});

automaticTranslation.addEventListener("change", async () => {
  if (!editingWebsiteAccess) return;
  if (automaticTranslation.checked) {
    const granted = await chrome.permissions.request({
      origins: [editingWebsiteAccess.permissionPattern],
    });
    if (!granted) {
      automaticTranslation.checked = false;
      const override = editedWebsiteOverride(false);
      if (override) await saveWebsiteOverride(override);
      websiteOverrideStatus.textContent =
        "权限被拒绝，网站自动翻译未开启；仍可手动翻译";
      return;
    }
    const override = editedWebsiteOverride(true);
    if (override) await saveWebsiteOverride(override);
    websiteOverrideStatus.textContent = "网站自动翻译已开启";
    return;
  }

  const override = editedWebsiteOverride(false);
  if (override) await saveWebsiteOverride(override);
  const stillNeeded = await isWebsitePermissionStillNeeded(
    editingWebsiteAccess.permissionPattern,
  );
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
});

translateButton.addEventListener("click", async () => {
  await sendCommandToActiveTab({ kind: "translate-current-page" });
});

document
  .querySelectorAll<HTMLButtonElement>("[data-reading-mode]")
  .forEach((button) => {
    button.addEventListener("click", async () => {
      const mode = button.dataset.readingMode;
      if (!isReadingMode(mode)) {
        return;
      }

      await sendCommandToActiveTab({
        kind: "set-reading-mode",
        mode,
      });
    });
  });
