# Chrome 网页沉浸式翻译插件规格

## Problem Statement

用户希望在 Chrome 浏览网页时直接获得自然的双语翻译，但不希望为翻译插件充值、加入会员或把网页内容交给第三方平台。现有方案通常绑定平台额度，不能充分满足用户使用自己的 LLM API Key 的需求。

## Solution

提供一个 Chrome MV3 网页翻译扩展。用户配置自己的 OpenAI 兼容 LLM 配置后，在网页上主动触发翻译；扩展按语义文本块分组请求 LLM，将译文以内嵌双语对照形式展示，并支持网站级自动翻译、动态内容增量翻译、本地缓存、提示词和术语表。

## User Stories

1. As a Chrome user, I want to configure an LLM API endpoint, so that I can use my own translation provider.
2. As a Chrome user, I want to enter my own API Key, so that I do not need to purchase credits or join a membership.
3. As a Chrome user, I want to choose a model, so that I can balance quality, speed and cost.
4. As a Chrome user, I want to configure request parameters and optional headers, so that different OpenAI-compatible providers work correctly.
5. As a Chrome user, I want to test my LLM configuration, so that I know it works before translating a page.
6. As a Chrome user, I want my API Key stored only locally, so that the extension does not upload it to an operator-owned server.
7. As a Chrome user, I want to click the extension button to translate the current page, so that translation does not consume API quota unexpectedly.
8. As a Chrome user, I want to enable automatic translation for a website, so that pages on that website are translated according to my preference.
9. As a Chrome user, I want the source language detected automatically, so that I do not need to configure every page.
10. As a Chrome user, I want the target language to default to my browser language, so that the first-use experience is sensible.
11. As a Chrome user, I want global and website-specific language settings, so that different sites can have different translation preferences.
12. As a Chrome user, I want to use 划词翻译 from an icon beside my selection or from the context menu, so that I can translate a small passage without translating the whole page.
13. As a reader, I want to see the original text together with its translation, so that I can compare both versions.
14. As a reader, I want to switch to translation-only or original-only display, so that I can choose the reading experience I prefer.
15. As a reader, I want headings, paragraphs, lists and tables to remain structurally recognizable, so that translation does not destroy the page layout.
16. As a reader, I want newly added page content translated incrementally, so that dynamic sites remain useful after the initial translation.
17. As a reader, I want translation failures to leave the original text usable, so that a provider error does not block the page.
18. As a reader, I want to retry a failed translation batch, so that transient failures can be recovered without restarting the page.
19. As a BYOK user, I want repeated text reused from local translation cache, so that I reduce duplicate API consumption.
20. As a BYOK user, I want cache invalidated when the model or translation instructions change, so that stale translations are not silently reused.
21. As a BYOK user, I want to clear the translation cache, so that I control locally retained page-derived data.
22. As a user, I want to customize the translation prompt, so that I can control style and formatting.
23. As a user, I want website-specific prompt overrides, so that specialized sites can use specialized instructions.
24. As a user, I want a local terminology table, so that important terms receive consistent translations.
25. As a privacy-conscious user, I want permission requested only for the active page by default, so that the extension has minimal access.
26. As a user, I want host permission requested only when enabling website automatic translation, so that I understand and control expanded access.
27. As a privacy-conscious user, I want excluded fields, editors, passwords, code, logs, browser pages, local files and iframes left untouched, so that sensitive or non-prose content is not sent for translation.
28. As a user, I want translation progress shown by batch, so that I understand what is happening without unstable per-token page updates.

## Implementation Decisions

- Build a Chrome Manifest V3 extension with a settings surface, popup/action surface, background coordination, and page content translation surface.
- Keep the popup settings navigation focused on one top-level `LLM 配置` entry that opens the settings page directly. Do not expose the website override form in the popup; previously stored website overrides remain intact and continue to affect translation behavior.
- Use the project's canonical terms: translation task, semantic text block, bilingual comparison, website override, LLM configuration, BYOK, incremental translation and translation cache.
- Support OpenAI-compatible HTTP APIs with endpoint, API Key, model, request parameters and optional custom headers.
- Call providers directly from the browser. Store configuration and API Key in Chrome local storage; do not add an operator-owned proxy or account service. This follows ADR 0001.
- Treat the API Key as locally accessible rather than absolutely secret. Explain this boundary in settings.
- Trigger current-page translation from an explicit user action by default. Website automatic translation is opt-in.
- Detect source language automatically and default target language to browser UI language, with global and website overrides.
- Extract semantic text blocks and translate them in grouped batches with stable block identifiers. Map returned translations back to their originating blocks.
- Insert translations without blocking normal page interaction. Preserve original text and provide batch-level progress, retry and failure state.
- Observe supported dynamic page changes and perform incremental translation for new or changed blocks.
- Cache translations locally using the LLM configuration, model, relevant instructions, source language, target language and source content as cache identity. Invalidate when model, prompt or relevant request configuration changes; provide manual clearing.
- Support global and website-specific translation prompts and a local terminology table. Include instructions to return translations only while preserving semantic formatting.
- Exclude inputs, editors, password fields, code blocks, command lines, logs, explicitly excluded elements, Chrome internal pages, local files and ordinary iframes in the first release.
- Provide opt-in 划词翻译 through a selection-adjacent icon and anchored result surface. Website overrides take precedence over the global preference, and selected text leaves the page only after the user clicks the translation entry. See `docs/spec-selection-translation.md`.
- Request active-page access by default and website host access only for website automatic translation.
- Use one highest-level browser end-to-end seam: load the extension, configure a fake OpenAI-compatible provider, open a controlled test page, trigger translation, and assert externally visible bilingual output, cache reuse, failure retry and dynamic-content behavior. Add focused tests only for pure extraction/response-mapping boundaries needed to support that seam.

## Testing Decisions

- Prefer tests of externally observable extension behavior over implementation details, mocks of internal functions, or exact DOM traversal algorithms.
- The primary test seam is Chrome extension end-to-end behavior against a controlled web page and local fake OpenAI-compatible server.
- Cover initial user-triggered translation, bilingual/display modes, language defaults and overrides, grouped response mapping, provider failure and retry, cache reuse/invalidation, dynamic content, excluded content and permission-driven website automatic translation.
- Add focused unit tests for semantic text-block extraction, exclusion rules, cache identity and provider response validation where these are deterministic support boundaries.
- The repository currently has no prior test suite or implementation seam; the first test harness should establish the browser-level seam as the reference pattern.

## Out of Scope

- PDF translation, video subtitles, mobile applications and non-Chrome browsers.
- User accounts, membership, recharge, platform-managed quotas or operator-owned LLM proxy services.
- Absolute API Key secrecy in a browser extension.
- Translation of ordinary cross-origin iframes in the first release.
- Per-token streaming rendering.
- Translation of editable fields, password fields, code, logs or Chrome internal/local-file pages.

## Further Notes

- Provider availability depends on the configured service allowing browser-origin requests. The settings experience should make connection and CORS failures understandable.
- The extension must continue to render and operate when translation is unavailable.
- The existing domain glossary and BYOK ADR are part of this specification's source of truth.
