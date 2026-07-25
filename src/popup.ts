import {
  isReadingMode,
  type ReadingMode,
} from "./page-translation.js";

const translateButton = document.querySelector<HTMLButtonElement>(
  "#translate-current-page",
);

if (!translateButton) {
  throw new Error("扩展弹窗缺少翻译按钮");
}

type ActiveTabCommand =
  | { kind: "translate-current-page" }
  | { kind: "set-reading-mode"; mode: ReadingMode };

async function sendCommandToActiveTab(command: ActiveTabCommand): Promise<void> {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (activeTab?.id === undefined) {
    return;
  }

  await chrome.runtime.sendMessage({
    ...command,
    tabId: activeTab.id,
  });
  window.close();
}

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
