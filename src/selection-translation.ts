(() => {
  type SelectionFailure =
    | "authentication"
    | "configuration"
    | "cors"
    | "network"
    | "rate-limit"
    | "response-format"
    | "timeout"
    | "extension";
  type SelectionResponse =
    | {
        kind: "complete";
        sourceText: string;
        translatedText: string;
        targetLanguage: string;
        phonetic?: string;
      }
    | { kind: "failed"; failureKind: SelectionFailure };
  type Controller = { destroy: () => void };
  type SelectionWindow = Window &
    typeof globalThis & {
      betterImmersiveSelectionTranslation?: Controller;
    };

  const selectionWindow = window as SelectionWindow;
  try {
    selectionWindow.betterImmersiveSelectionTranslation?.destroy();
  } catch {
    document
      .querySelector("[data-better-immersive-selection-ui]")
      ?.remove();
    delete selectionWindow.betterImmersiveSelectionTranslation;
  }

  const excludedSelector = [
    "input",
    "textarea",
    "select",
    "option",
    '[contenteditable]:not([contenteditable="false"])',
    '[role="textbox"]',
    "pre",
    "code",
    "kbd",
    "samp",
    ".command-line",
    ".terminal",
    "[data-command-line]",
    '[role="log"]',
    ".log",
    "[data-log]",
    '[translate="no" i]',
    ".notranslate",
    "[data-no-translate]",
    "[data-better-immersive-no-translate]",
  ].join(",");
  const host = document.createElement("div");
  host.dataset.betterImmersiveSelectionUi = "";
  Object.assign(host.style, {
    all: "initial",
    position: "fixed",
    inset: "0",
    width: "0",
    height: "0",
    zIndex: "2147483647",
  });
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    button { font: inherit; }
    .entry, .card {
      position: fixed;
      color: #142852;
      font-family: "Avenir Next", Avenir, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
      z-index: 2147483647;
    }
    .entry {
      display: grid;
      width: 28px;
      height: 28px;
      place-items: center;
      padding: 0;
      border: 1px solid rgb(255 255 255 / 88%);
      border-radius: 50%;
      background: linear-gradient(145deg, #ffffff, #e9f0ff);
      box-shadow: 0 6px 18px rgb(24 60 136 / 28%);
      cursor: pointer;
    }
    .entry:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgb(24 60 136 / 34%); }
    .entry:focus-visible, .action:focus-visible {
      outline: 3px solid rgb(39 102 224 / 36%);
      outline-offset: 2px;
    }
    .entry img { display: block; width: 20px; height: 20px; }
    .card {
      width: min(360px, calc(100vw - 24px));
      max-height: 60vh;
      overflow: auto;
      border: 1px solid #ccd9f2;
      border-radius: 16px;
      background: #fbfdff;
      box-shadow: 0 18px 48px rgb(19 50 116 / 24%);
      font-size: 14px;
      line-height: 1.55;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 11px 14px;
      color: #fff;
      background: linear-gradient(120deg, #205ecf, #183f94);
    }
    .card-title { margin: 0; font-size: 12px; font-weight: 800; letter-spacing: .08em; }
    .close {
      min-width: 28px;
      min-height: 28px;
      padding: 0;
      border: 0;
      color: #fff;
      background: transparent;
      cursor: pointer;
      font-size: 20px;
    }
    .content { padding: 14px; }
    .source {
      display: -webkit-box;
      overflow: hidden;
      margin: 0 0 12px;
      color: #5c6f99;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      white-space: pre-wrap;
    }
    .source.expanded { display: block; overflow: visible; }
    .expand {
      margin: -7px 0 10px;
      padding: 0;
      border: 0;
      color: #315eaf;
      background: transparent;
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
    }
    .translation { margin: 0; color: #152650; font-size: 15px; font-weight: 600; white-space: pre-wrap; }
    .pronunciation {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: -6px 0 12px;
    }
    .phonetic {
      color: #315eaf;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: .02em;
    }
    .speak {
      display: grid;
      width: 28px;
      height: 28px;
      place-items: center;
      padding: 0;
      border: 1px solid #cddaf2;
      border-radius: 8px;
      color: #234889;
      background: #eef4ff;
      cursor: pointer;
    }
    .speak:hover { color: #173b7c; background: #e2ecff; }
    .speak:focus-visible {
      outline: 3px solid rgb(39 102 224 / 36%);
      outline-offset: 2px;
    }
    .speak svg { width: 17px; height: 17px; fill: currentColor; }
    .status { margin: 0; color: #315eaf; }
    .actions { display: flex; gap: 8px; margin-top: 14px; }
    .action {
      min-height: 34px;
      padding: 6px 10px;
      border: 1px solid #cddaf2;
      border-radius: 9px;
      color: #234889;
      background: #eef4ff;
      cursor: pointer;
      font-weight: 700;
    }
    @media (prefers-reduced-motion: reduce) {
      .entry { transition: none; }
    }
  `;
  root.append(style);
  document.documentElement.append(host);

  let range: Range | null = null;
  let sourceText = "";
  let timer: number | undefined;
  let generation = 0;
  let keyboardSelection = false;
  let pointerSelecting = false;
  let animationFrame: number | undefined;
  let contextWatchTimer: number | undefined;
  let destroyed = false;

  const extensionAssetUrl = (path: string): string | null => {
    try {
      return chrome.runtime.getURL(path);
    } catch {
      try {
        selectionWindow.betterImmersiveSelectionTranslation?.destroy();
      } catch {
        host.remove();
      }
      return null;
    }
  };
  const isExtensionContextInvalidated = (error: unknown): boolean =>
    error instanceof Error &&
    error.message.includes("Extension context invalidated");
  const destroyCurrentController = (): void => {
    try {
      selectionWindow.betterImmersiveSelectionTranslation?.destroy();
    } catch {
      try {
        host.remove();
      } catch {
        // The old isolated world is already unusable.
      }
    }
  };
  const runSynchronousTask = (task: () => void): void => {
    try {
      task();
    } catch {
      destroyCurrentController();
    }
  };
  const runAsyncTask = (
    task: () => Promise<unknown>,
    onFailure: (error: unknown) => void,
  ): void => {
    const handleFailure = (error: unknown): void => {
      try {
        if (isExtensionContextInvalidated(error)) {
          destroyCurrentController();
          return;
        }
        onFailure(error);
      } catch {
        destroyCurrentController();
      }
    };
    try {
      void task().catch(handleFailure);
    } catch (error) {
      handleFailure(error);
    }
  };
  const stopContextWatch = (): void => {
    window.clearInterval(contextWatchTimer);
    contextWatchTimer = undefined;
  };
  const startContextWatch = (): void => {
    if (contextWatchTimer !== undefined) return;
    contextWatchTimer = window.setInterval(() => {
      try {
        chrome.runtime.getURL("");
      } catch {
        stopContextWatch();
        destroyCurrentController();
      }
    }, 100);
  };
  const clearSurface = (): void => {
    stopContextWatch();
    root.querySelector(".entry, .card")?.remove();
  };
  const selectionRect = (): DOMRect | null => {
    if (!range) return null;
    const rects = range.getClientRects();
    return rects.length > 0 ? rects[rects.length - 1] ?? null : range.getBoundingClientRect();
  };
  const position = (element: HTMLElement, width: number, height: number): void => {
    const rect = selectionRect();
    if (!rect) return;
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      clearSurface();
      return;
    }
    const gap = 6;
    const left = Math.min(
      Math.max(gap, rect.right + gap),
      window.innerWidth - width - gap,
    );
    const below = rect.bottom + gap;
    const top =
      below + height <= window.innerHeight
        ? below
        : Math.max(gap, rect.top - height - gap);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  };
  const createCard = (body: HTMLElement): HTMLElement => {
    clearSurface();
    const card = document.createElement("section");
    card.className = "card";
    card.setAttribute("role", "region");
    card.setAttribute("aria-label", "划词翻译结果");
    card.setAttribute("aria-live", "polite");
    const header = document.createElement("div");
    header.className = "card-header";
    const title = document.createElement("p");
    title.className = "card-title";
    title.textContent = "划词翻译";
    const close = document.createElement("button");
    close.className = "close";
    close.type = "button";
    close.setAttribute("aria-label", "关闭划词翻译");
    close.textContent = "×";
    close.addEventListener("click", clearSurface);
    header.append(title, close);
    const content = document.createElement("div");
    content.className = "content";
    content.append(body);
    card.append(header, content);
    root.append(card);
    startContextWatch();
    animationFrame = requestAnimationFrame(() => {
      animationFrame = undefined;
      runSynchronousTask(() =>
        position(
          card,
          card.offsetWidth,
          Math.min(card.offsetHeight, window.innerHeight * 0.6),
        ),
      );
    });
    return card;
  };
  const pronunciationLanguage = (): string => {
    const commonAncestor = range?.commonAncestorContainer;
    const element =
      commonAncestor instanceof Element
        ? commonAncestor
        : commonAncestor?.parentElement;
    return element?.closest("[lang]")?.getAttribute("lang")?.trim() ?? "";
  };
  const appendPronunciation = (
    body: HTMLElement,
    word: string,
    phonetic: string | undefined,
  ): void => {
    if (!phonetic) return;
    const pronunciation = document.createElement("div");
    pronunciation.className = "pronunciation";
    const phoneticText = document.createElement("span");
    phoneticText.className = "phonetic";
    phoneticText.textContent = phonetic;
    const speak = document.createElement("button");
    speak.className = "speak";
    speak.type = "button";
    speak.setAttribute("aria-label", `朗读单词 ${word}`);
    speak.title = "朗读单词";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("viewBox", "0 0 24 24");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      "M3 9v6h4l5 4V5L7 9H3zm11.5 3a3.5 3.5 0 0 0-1.5-2.87v5.74A3.5 3.5 0 0 0 14.5 12zm-1.5-8.5v2.06a7 7 0 0 1 0 12.88v2.06a9 9 0 0 0 0-17z",
    );
    icon.append(path);
    speak.append(icon);
    speak.addEventListener("click", () => {
      try {
        const utterance = new SpeechSynthesisUtterance(word);
        const language = pronunciationLanguage();
        if (language) utterance.lang = language;
        utterance.addEventListener("error", () => {
          speak.setAttribute("aria-label", `朗读失败，重试单词 ${word}`);
          speak.title = "朗读失败，请重试";
        });
        window.speechSynthesis.speak(utterance);
      } catch {
        speak.setAttribute("aria-label", `朗读失败，重试单词 ${word}`);
        speak.title = "朗读失败，请重试";
      }
    });
    pronunciation.append(phoneticText, speak);
    body.append(pronunciation);
  };
  const translate = async (): Promise<void> => {
    const currentGeneration = ++generation;
    const body = document.createElement("div");
    const source = document.createElement("p");
    source.className = "source";
    source.textContent = sourceText;
    const status = document.createElement("p");
    status.className = "status";
    status.textContent = "正在翻译…";
    body.append(source);
    if (sourceText.length > 180) {
      const expand = document.createElement("button");
      expand.className = "expand";
      expand.type = "button";
      expand.textContent = "展开原文";
      expand.addEventListener("click", () => {
        const expanded = source.classList.toggle("expanded");
        expand.textContent = expanded ? "收起原文" : "展开原文";
      });
      body.append(expand);
    }
    body.append(status);
    createCard(body);
    if (sourceText.length > 5_000) {
      status.textContent = "划词翻译最多支持 5,000 字符";
      return;
    }
    const response = (await chrome.runtime.sendMessage({
      kind: "translate-selection",
      selectionText: sourceText,
    })) as SelectionResponse;
    if (currentGeneration !== generation) return;
    if (response.kind === "failed") {
      const failureLabels: Record<SelectionFailure, string> = {
        authentication: "认证失败：请检查 API Key",
        configuration: "请先配置 LLM",
        cors: "CORS 失败：服务未允许浏览器跨域请求",
        network: "网络失败：无法连接到翻译服务",
        "rate-limit": "请求受限：请稍后重试",
        "response-format": "响应格式错误：未返回有效译文",
        timeout: "请求超时：请重试",
        extension: "扩展暂时不可用，请重试",
      };
      status.textContent = failureLabels[response.failureKind];
      const actions = document.createElement("div");
      actions.className = "actions";
      if (
        response.failureKind === "network" ||
        response.failureKind === "rate-limit" ||
        response.failureKind === "response-format" ||
        response.failureKind === "timeout" ||
        response.failureKind === "extension"
      ) {
        const retry = document.createElement("button");
        retry.className = "action";
        retry.type = "button";
        retry.textContent = "重试";
        retry.addEventListener("click", startTranslation);
        actions.append(retry);
      }
      if (
        response.failureKind === "configuration" ||
        response.failureKind === "authentication" ||
        response.failureKind === "cors"
      ) {
        const settings = document.createElement("button");
        settings.className = "action";
        settings.type = "button";
        settings.textContent = "打开设置";
        settings.addEventListener("click", () => {
          runAsyncTask(
            () => chrome.runtime.sendMessage({ kind: "open-options" }),
            () => {
              settings.textContent = "打开失败，请重试";
            },
          );
        });
        actions.append(settings);
      }
      body.append(actions);
      return;
    }
    status.remove();
    appendPronunciation(body, response.sourceText, response.phonetic);
    const translation = document.createElement("p");
    translation.className = "translation";
    translation.lang = response.targetLanguage;
    translation.textContent = response.translatedText;
    body.append(translation);
    const actions = document.createElement("div");
    actions.className = "actions";
    const copy = document.createElement("button");
    copy.className = "action";
    copy.type = "button";
    copy.textContent = "复制译文";
    copy.addEventListener("click", () => {
      runAsyncTask(
        async () => {
          await navigator.clipboard.writeText(response.translatedText);
          copy.textContent = "已复制";
        },
        () => {
          copy.textContent = "复制失败，请重试";
        },
      );
    });
    actions.append(copy);
    body.append(actions);
  };
  function startTranslation(): void {
    runAsyncTask(translate, () => {
      const failure = document.createElement("p");
      failure.className = "status";
      failure.textContent = "翻译失败，请重试";
      const retry = document.createElement("button");
      retry.className = "action";
      retry.type = "button";
      retry.textContent = "重试";
      retry.addEventListener("click", startTranslation);
      const body = document.createElement("div");
      body.append(failure, retry);
      createCard(body);
    });
  }
  const showEntry = (): void => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      clearSurface();
      return;
    }
    const selectedRange = selection.getRangeAt(0);
    const text = selection.toString().trim();
    if (
      text.length === 0 ||
      Array.from(document.querySelectorAll(excludedSelector)).some((element) =>
        selectedRange.intersectsNode(element),
      )
    ) {
      clearSurface();
      return;
    }
    generation += 1;
    range = selectedRange.cloneRange();
    sourceText = text;
    clearSurface();
    const entry = document.createElement("button");
    entry.className = "entry";
    entry.type = "button";
    entry.setAttribute("aria-label", "翻译所选文字");
    const image = document.createElement("img");
    image.alt = "";
    const imageUrl = extensionAssetUrl("icons/translation-32.png");
    if (!imageUrl) return;
    image.src = imageUrl;
    entry.append(image);
    entry.addEventListener("mousedown", (event) => event.preventDefault());
    entry.addEventListener("click", startTranslation);
    root.append(entry);
    startContextWatch();
    position(entry, 28, 28);
    if (keyboardSelection) entry.focus();
    keyboardSelection = false;
  };
  const schedule = (): void => {
    if (pointerSelecting) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => runSynchronousTask(showEntry), 100);
  };
  const reposition = (): void => {
    const surface = root.querySelector<HTMLElement>(".entry, .card");
    if (surface) {
      position(surface, surface.offsetWidth || 28, surface.offsetHeight || 28);
    }
  };
  const onMessage = (
    message: unknown,
  ): void => {
    if (
      typeof message === "object" &&
      message !== null &&
      "kind" in message &&
      message.kind === "disable-selection-translation"
    ) {
      selectionWindow.betterImmersiveSelectionTranslation?.destroy();
    }
    if (
      typeof message === "object" &&
      message !== null &&
      "kind" in message &&
      message.kind === "show-selection-translation-result" &&
      "sourceText" in message &&
      "translatedText" in message &&
      "targetLanguage" in message &&
      typeof message.sourceText === "string" &&
      typeof message.translatedText === "string" &&
      typeof message.targetLanguage === "string"
    ) {
      window.clearTimeout(timer);
      const currentSelection = window.getSelection();
      if (
        currentSelection &&
        !currentSelection.isCollapsed &&
        currentSelection.rangeCount > 0
      ) {
        range = currentSelection.getRangeAt(0).cloneRange();
      }
      sourceText = message.sourceText;
      const body = document.createElement("div");
      const source = document.createElement("p");
      source.className = "source";
      source.textContent = message.sourceText;
      const translation = document.createElement("p");
      translation.className = "translation";
      translation.lang = message.targetLanguage;
      translation.textContent = message.translatedText;
      body.append(source);
      appendPronunciation(
        body,
        message.sourceText,
        "phonetic" in message && typeof message.phonetic === "string"
          ? message.phonetic
          : undefined,
      );
      body.append(translation);
      createCard(body);
    }
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.key === "Shift" ||
      event.key.startsWith("Arrow") ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      keyboardSelection = true;
    }
    if (event.key === "Escape") {
      clearSurface();
    }
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.composedPath().includes(host)) return;
    pointerSelecting = true;
    clearSurface();
  };
  const onPointerUp = (): void => {
    if (!pointerSelecting) return;
    pointerSelecting = false;
    schedule();
  };
  document.addEventListener("selectionchange", schedule);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);
  chrome.runtime.onMessage.addListener(onMessage);
  const controller: Controller = {
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      window.clearTimeout(timer);
      stopContextWatch();
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = undefined;
      }
      document.removeEventListener("selectionchange", schedule);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      try {
        chrome.runtime.onMessage.removeListener(onMessage);
      } catch {
        // The extension may have been reloaded; the old isolated world is
        // already detached from the new runtime.
      }
      try {
        host.remove();
        if (selectionWindow.betterImmersiveSelectionTranslation === controller) {
          delete selectionWindow.betterImmersiveSelectionTranslation;
        }
      } catch {
        // Cleanup is best-effort after an extension reload.
      }
    },
  };
  selectionWindow.betterImmersiveSelectionTranslation = controller;
  schedule();
})();
