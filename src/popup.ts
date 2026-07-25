const translateButton = document.querySelector<HTMLButtonElement>(
  "#translate-current-page",
);

if (!translateButton) {
  throw new Error("扩展弹窗缺少翻译按钮");
}

translateButton.addEventListener("click", async () => {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (activeTab?.id === undefined) {
    return;
  }

  await chrome.runtime.sendMessage({
    kind: "translate-current-page",
    tabId: activeTab.id,
  });
  window.close();
});
