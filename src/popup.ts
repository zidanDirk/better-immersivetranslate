import {
  isReadingMode,
  type ReadingMode,
} from "./page-translation.js";
import { websiteAccess } from "./website-overrides.js";
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

async function sendCommandToActiveTab(
  command: ActiveTabCommand,
  closePopupOnSuccess = true,
): Promise<void> {
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
  if (closePopupOnSuccess) {
    window.close();
  }
}

const openLlmConfigurationButton = document.querySelector<HTMLButtonElement>(
  "#open-llm-configuration",
);
const popupStatus = document.querySelector<HTMLElement>("#popup-status");

if (!openLlmConfigurationButton || !popupStatus) {
  throw new Error("扩展弹窗缺少 LLM 配置入口");
}

function responseFailed(response: unknown): boolean {
  return (
    typeof response === "object" &&
    response !== null &&
    "kind" in response &&
    response.kind === "failed"
  );
}

openLlmConfigurationButton.addEventListener("click", () => {
  runUiTask(
    () => chrome.runtime.openOptionsPage(),
    () => {
      popupStatus.textContent = "设置页打开失败，请重试";
    },
  );
});

translateButton.addEventListener("click", () => {
  runUiTask(
    () => sendCommandToActiveTab({ kind: "translate-current-page" }),
    () => {
      popupStatus.textContent = "翻译任务启动失败，请重试";
    },
  );
});

const readingModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-reading-mode]"),
);

function selectReadingMode(selectedMode: ReadingMode): void {
  readingModeButtons.forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.readingMode === selectedMode),
    );
  });
}

readingModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.readingMode;
    if (!isReadingMode(mode)) {
      return;
    }
    runUiTask(
      () =>
        sendCommandToActiveTab(
          {
            kind: "set-reading-mode",
            mode,
          },
          false,
        ).then(() => selectReadingMode(mode)),
      () => {
        popupStatus.textContent = "阅读方式切换失败，请重试";
      },
    );
  });
});
