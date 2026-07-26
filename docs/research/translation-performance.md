# 网页翻译吞吐与首屏延迟调研

> 对应 [GitHub Issue #17](https://github.com/zidanDirk/better-immersivetranslate/issues/17)。调研日期：2026-07-26；代码基线：`1e4d9b1`。本文只提出研究结论和实验方案，不包含产品代码修改。

## 结论摘要

当前最明确、也最值得先解决的瓶颈不是 DOM，而是翻译任务的固定批量与严格串行调度：

- 每批固定为 10 个语义文本块；页面有 `N` 块时产生 `ceil(N / 10)` 次请求（[`src/background.ts`](../../src/background.ts#L25-L27)、[`src/background.ts`](../../src/background.ts#L92-L106)）。
- `for ... of` 中逐批 `await runTranslationBatch(...)`，同一页面任意时刻只有一个 LLM 请求；每个标签页的整页、增量和重试任务又共用一条 Promise 队列（[`src/background.ts`](../../src/background.ts#L76-L89)）。因此整页耗时近似为各批完整响应时延之和。
- 只有拿到整批 JSON、验证全部稳定块 ID、写入缓存后，才一次性插入该批译文；当前没有流式首 token 或逐块展示路径（[`src/translation-provider.ts`](../../src/translation-provider.ts#L100-L148)、[`src/openai-compatible.ts`](../../src/openai-compatible.ts#L60-L67)）。
- 受控测试中，30 块、每批服务端固定延迟 250 ms、冷缓存的首个译文可见时间中位数为 **498.3 ms**，全部完成中位数为 **1,100.2 ms**，整页吞吐约 **27.3 块/秒**。这证明串行的三次完整响应会直接累加；该结果是调度基线，不代表真实模型或广域网性能。

优先建议是：先建立分阶段观测，再实现“首屏优先的小首批 + 后续按字符/估算 token 自适应组批 + 每个 LLM 配置有上限的有限并发”。建议初始并发为 2，并以 429、超时率和映射失败率作为回退信号。流式输出可作为后续实验，但不能只把 `stream` 改成 `true`：现有正确性契约要求一批的 ID 集合完整且唯一，必须先设计可增量验证的帧协议。

## 范围与一手资料

本文只使用以下一手来源：

- 本仓库源码、测试和 [Issue #17](https://github.com/zidanDirk/better-immersivetranslate/issues/17)。
- 沉浸式翻译官方高级配置文档。它公开了翻译服务的 `limit`（每秒请求限制）、`maxTextGroupLengthPerRequest` 和 `maxTextLengthPerRequest`，说明成熟产品会同时控制请求速率、组大小和文本量；文档没有公开其默认并发算法或真实性能数字，因此本文不推断这些未公开细节。[沉浸式翻译：Translation Service Configuration](https://immersivetranslate.com/en/docs/advanced/#translation-service-configuration)
- Chrome 与 MDN 官方 Web 文档。[Chrome 扩展 Service Worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)、[MDN User Timing](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/User_timing)、[MDN PerformanceLongTaskTiming](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming)、[MDN ReadableStream](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_streams)。
- OpenAI 官方 API 文档。项目当前调用 OpenAI-compatible Chat Completions，因此它是最直接的提供商证据。[Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization)、[Rate limits](https://developers.openai.com/api/docs/guides/rate-limits)、[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)、[Streaming API events](https://platform.openai.com/docs/api-reference/responses-streaming)。

沉浸式翻译官方文档能证明“请求速率 + 每请求组数 + 每请求文本长度”是公开可调的性能机制，但不能证明其内部一定采用某个并发数，也不能作为两款产品速度差值的量化证据。速度对比仍必须在同一页面、模型、地区、网络和缓存状态下实测。

## 当前实现的延迟路径

### 冷缓存整页翻译

当前路径可表示为：

```text
用户触发
  → 读取标签页和网站设置
  → 扫描并复制候选元素，抽取语义文本块
  → 按每 10 块分批
  → 对每批严格串行：
      进度脚本 → 缓存哈希/读取 → fetch 完整响应
      → JSON 完整性校验 → 缓存写入 → DOM 插入 → 进度脚本
```

相应的首个译文可见时间和整页完成时间近似为：

```text
TTFV ≈ T设置 + T抽取 + T进度 + T首批缓存 + T首批完整响应 + T首批写缓存 + T首批插入

T完成 ≈ T设置 + T抽取
       + Σ(每批进度 + 缓存 + 完整响应 + 解析校验 + 写缓存 + 插入)
```

严格串行意味着当每批完整响应时延近似为 `L`、共有 `B` 批时，网络/模型部分的下界约为 `B × L`；有限并发为 `C` 时才可能降到约 `ceil(B / C) × L`。真实结果还受 token 数、限流、连接复用、DOM 和存储影响。

### 代码层面的具体事实

1. **固定块数而非 payload 大小。** 10 个短标题和 10 个超长段落被视为同样大小。请求 token 数和输出 token 数可能相差很大，导致各批完成时间不均衡。OpenAI 官方延迟指南指出，减少输出 token 通常直接降低生成延迟；只按块数分组无法约束这一主变量。[OpenAI Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization)
2. **整页批次串行。** [`translateBlocks`](../../src/background.ts#L92-L107) 在上一批完成或失败之后才发下一批。30 块至少有三个顺序等待的提供商响应。
3. **任务也按标签页串行。** 整页、增量翻译和失败重试共用 [`state.queue`](../../src/background.ts#L28-L47)。这有利于避免状态竞争，但长整页任务会让新出现、且用户正在看的语义文本块排队。
4. **非流式、整批原子展示。** `fetch()` 返回 `Response` 后调用 `response.json()`，再要求返回数量与全部 ID 完全匹配（[`src/translation-provider.ts`](../../src/translation-provider.ts#L38-L74)）。这保住了映射正确性，却把 TTFV 绑定到了首批最后一个 token。
5. **5 秒整响应超时。** [`AbortSignal.timeout(5_000)`](../../src/openai-compatible.ts#L60-L70) 对慢模型或大批量可能过紧。Chrome 官方还说明扩展 Service Worker 的 `fetch()` 响应超过 30 秒可能导致 worker 终止；简单把超时无限增大不是安全方案。[Chrome Service Worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
6. **缓存是逐语义文本块的本地缓存。** 哈希并行计算，然后一次 `chrome.storage.local.get`；写入也按批合并（[`src/translation-cache.ts`](../../src/translation-cache.ts#L90-L143)）。这是合理的批量存储方式，但当前同一冷批内的重复文本仍会重复提交给模型。
7. **DOM 工作随页面和批次数增长。** 抽取时会扫描所有候选、为每个候选克隆子树并移除排除内容（[`src/page-translation.ts`](../../src/page-translation.ts#L177-L225)）；每批插入又重新查询页面上所有带块 ID 的元素（[`src/page-translation.ts`](../../src/page-translation.ts#L412-L459)）。在超长页面上，这会放大主线程工作，但在真实 LLM 请求通常较慢的前提下，应先测量再决定是否优先优化。
8. **增量扫描有 75 ms 去抖，但每次仍重扫候选。** [`MutationObserver`](../../src/page-translation.ts#L326-L350) 可合并突发变化；动态页面持续变化时仍可能反复克隆和扫描整个候选集合。
9. **失败恢复边界已经适合有限并发。** 每批已有独立索引、稳定 ID、失败状态和手动重试 payload。引入并发时需保持“按批独立成功/失败”，并允许完成顺序与批次顺序不同。

## 可重复性能基线

### 指标定义

每次运行至少记录以下指标，冷缓存和热缓存必须分开：

| 指标 | 定义 | 用途 |
| --- | --- | --- |
| `TTFV` | 用户触发至第一个译文节点插入页面 | 首屏感知延迟 |
| `T50-visible` | 50% 待翻译块已显示译文 | 渐进可用性 |
| `Tcomplete` | 所有批次进入完成或失败终态 | 整页完成时间 |
| 吞吐 | 成功翻译块数 / `Tcomplete` 秒数 | 整页处理能力 |
| 批响应时延 | 发出某批请求至完整响应校验完毕 | 网络/模型贡献 |
| 缓存命中率 | 命中块数 / 总块数 | 本地复用效果 |
| 错误率 | 按 429、超时、网络、格式分别统计 | 并发安全边界 |
| 长任务 | 页面线程中持续超过 50 ms 的任务 | DOM/脚本卡顿风险 |

使用 `performance.mark()` / `performance.measure()` 标记阶段，并通过 `PerformanceObserver` 采集，这是 MDN 所述 User Timing 标准用途。[MDN User Timing](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/User_timing) 页面主线程卡顿可另用 `PerformanceObserver` 观察 `longtask` 条目。[MDN PerformanceLongTaskTiming](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming)

### 已测受控基线

环境与方法：

- 代码：`1e4d9b1`；Node.js `v23.1.0`；Playwright `1.62.0`；headless Chromium `151.0.7922.34`；Playwright 单 worker。
- 页面：30 个 `<p>`，即 30 个语义文本块；冷缓存；固定 10 块/批，共 3 批。
- 提供商：仓库现有 `startFakeOpenAiServer`，每一批在收到请求后固定等待 250 ms，再返回完整、合法的 JSON 映射。
- 计时：在目标页面预先安装 `MutationObserver`；从触发 popup 翻译操作前开始，到第 1 个和第 30 个 `[data-better-immersive-translation-for]` 出现为止。运行 5 次。
- P95：样本升序后的 nearest-rank P95；样本数仅 5，因此这里只用于回归烟雾基线，不用于容量承诺。

| 运行 | TTFV (ms) | Tcomplete (ms) |
| ---: | ---: | ---: |
| 1 | 450.9 | 1,015.0 |
| 2 | 521.3 | 1,168.9 |
| 3 | 462.1 | 1,069.8 |
| 4 | 498.3 | 1,100.2 |
| 5 | 512.0 | 1,114.2 |
| **中位数** | **498.3** | **1,100.2** |
| **P95** | **521.3** | **1,168.9** |

以中位数计算，整页吞吐为 `30 / 1.1002 ≈ 27.3 块/秒`。三批服务端固定等待的理论串行下界为 `3 × 250 = 750 ms`；剩余时间包含 popup/消息调度、配置读取、缓存、请求与 JSON 处理、脚本注入、DOM 插入和计时边界。不能把差值全部归因于某一个阶段，后续必须加入阶段 mark。

复跑协议：

1. `npm ci && npm run build`。
2. 使用 `tests/e2e/fake-openai-server.ts` 构造 30 段页面和三条合法响应，每条设置 `delayMs: 250`。
3. 通过 `tests/e2e/extension.ts` 启动扩展并保存最小 LLM 配置。
4. 在页面内用 `MutationObserver` 记录第 1 个和第 30 个译文节点出现的 `performance.now()`。
5. 每轮使用新 BrowserContext 或更换原文，避免翻译缓存；顺序运行 5 次并输出原始样本、中位数和 nearest-rank P95。

### 真实提供商基线矩阵

受控基线必须再配一组真实 BYOK 测量，才能回答“模型、网络、缓存分别贡献多少”：

- 固定同一 100 块页面，记录总字符数和估算 input/output tokens。
- 固定浏览器版本、扩展 commit、地区、网络、LLM 配置和模型版本；关闭其他扩展。
- 分别测冷缓存与热缓存；每格至少 20 次，报告 median/P95，不只报告平均数。
- 批大小测试 `4 / 8 / 12 / 20`；并发测试 `1 / 2 / 3 / 4`；顺序随机化，避免提供商瞬时负载偏差。
- 每次保存提供商返回的 request ID、usage、限流响应头（若兼容服务提供）、429/超时/格式错误，以及 TTFV/T50/Tcomplete。
- 另做 10、30、100 块三种页面规模，验证收益是否只存在于短页面或长页面。

OpenAI 官方说明限流可能同时按 RPM、TPM 等维度执行，短时突发也可能触发限制；因此提高并发时必须同时观察请求数和 token 量，而不是只看请求/秒。[OpenAI Rate limits](https://developers.openai.com/api/docs/guides/rate-limits)

## 瓶颈排序与可证伪假设

| 优先级 | 假设 | 当前证据 | 如何证伪 |
| --- | --- | --- |
| P0 | 串行完整响应主导长页面 Tcomplete | 固定 10 块且逐批 `await`；受控三批时延累加 | 在同一假服务延迟下比较并发 1/2/3 |
| P0 | 首批过大或位置不优先拖慢 TTFV | 首批固定取 DOM 顺序前 10 块，必须等完整 JSON | 比较首批 3/5/10 块，并分别测试视口优先与 DOM 顺序 |
| P1 | 真实模型输出 token 主导每批时延 | 官方延迟指南指出生成 token 是关键延迟来源 | 记录 usage，并回归批输出 token 与响应时延 |
| P1 | 固定块数造成批时延方差 | 块长度不参与组批 | 比较固定块数与字符/token 预算组批的 P95 |
| P1 | 429 限制可用并发上限 | 官方限流维度 + 沉浸式翻译公开 `limit` 配置 | 并发矩阵中记录 429，逐配置找安全上限 |
| P2 | DOM 全量扫描/插入影响超长页交互 | 抽取克隆子树；每批重新查询所有块 | 在零延迟假服务下测阶段耗时和 long task |
| P2 | 本地缓存操作影响热缓存 TTFV | 每批哈希并读取 storage | 热缓存 10/100/1000 块下单独测缓存阶段 |

## 实现建议

### 1. 先加入观测点，不先猜参数

为每次翻译任务生成本地 correlation ID，记录：

- `trigger → preferences → extraction → batch-created`；
- 每批 `cache-lookup → request-start → headers/first-byte（可取得时）→ body-complete → parsed → cache-store → inserted`；
- 块数、字符数、估算 token、缓存命中数、状态码/失败类型；
- TTFV、T50、Tcomplete 与页面 long task。

默认只保存在本地调试日志或测试输出，不记录 API Key、提示词全文或网页正文。没有这些阶段数据，无法区分网络、模型生成、缓存和 DOM。

### 2. 将固定 10 块改为首屏优先的自适应组批

建议策略：

- 第一批优先选择视口内或最靠近视口的语义文本块，限制为较小预算（例如 3–5 块或较小字符预算），目标是降低 TTFV。
- 后续批次按总字符数或估算 token 预算组批，同时设置块数硬上限，避免一个超长段落让请求失控。
- 对同一冷批中的相同原文先去重，翻译一次后按稳定 ID 扇出，减少 input/output token。
- 保持每个响应必须覆盖其批内全部稳定 ID 的验证，不以性能换映射正确性。

证据边界：沉浸式翻译官方公开同时控制 `maxTextGroupLengthPerRequest` 与 `maxTextLengthPerRequest`，支持“数量和文本量双约束”的方向；它不证明本项目应照搬具体数值。[沉浸式翻译高级配置](https://immersivetranslate.com/en/docs/advanced/#translation-service-configuration)

### 3. 引入每配置有限并发，并对限流自适应

建议第一版：

- 每个 LLM 配置默认最多 2 个在途请求；不同标签页也共享该配置的并发预算，避免每页各自并发导致总量失控。
- 使用小型 worker pool，不使用无界 `Promise.all`。
- 批次可以乱序完成，但状态与插入必须继续按 `batchIndex + stable block id + version` 归属。
- 遇到 429 时停止发新请求、尊重 `Retry-After`（若存在），指数退避并带 jitter；连续 429 将该配置并发降为 1。恢复并发必须缓慢。
- 网络/超时可独立失败并手动重试；不要让一个失败取消已成功批次。

OpenAI 官方建议对限流错误采用指数退避，同时说明失败请求也可能计入限额；无界重试和无界并发都会恶化问题。[OpenAI Rate limits](https://developers.openai.com/api/docs/guides/rate-limits) 沉浸式翻译公开的 `limit` 配置也表明服务级速率约束应是一等配置。[沉浸式翻译高级配置](https://immersivetranslate.com/en/docs/advanced/#translation-service-configuration)

### 4. 保留完整 JSON 路径，单独实验流式协议

流式响应能提前暴露生成内容，OpenAI 将 streaming 列为降低等待感知的有效方法；浏览器 `Response.body` 也可作为 `ReadableStream` 增量读取。[OpenAI Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization)、[MDN ReadableStream](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_streams)

但当前返回值是“一批翻译组成的单个 JSON 字符串”。任意 token 前缀通常不是合法 JSON，也不能证明某个 ID 最终不会重复或缺失。因此：

- 第一阶段不要把 `stream: true` 当作无协议改动的优化。
- 若实验流式，应定义逐块可提交的 SSE/NDJSON 事件，例如每个事件只含一个完整 `{id,text}`，并在批结束事件校验 ID 集合。
- 每个事件插入前继续校验语义文本块 version，避免动态页面把旧译文写回新内容。
- 流式实验分别衡量“首个完整块时间”和最终完整性；发现格式或兼容问题时回退到非流式路径。

### 5. 让请求参数优化保持提供商可移植

- 在 UI/基准中显式比较适合翻译的较小、较快模型；OpenAI 官方把选择更快模型和减少生成 token 列为主要延迟手段。[OpenAI Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization)
- 根据源文本预算设置合理输出上限，防止异常长响应；上限过低会截断 JSON，因此必须以映射完整性失败率验证。
- 保持稳定系统提示词在消息前缀、动态块内容在末尾，有利于支持前缀缓存的提供商。OpenAI 的提示缓存依赖相同前缀，并提供 `cached_tokens` 供观测；短请求或其他兼容提供商未必受益，不能把它当通用保证。[OpenAI Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- 不采用异步 Batch API 做交互网页翻译。其目标是离线批量处理，不满足首屏立即显示的延迟目标。

### 6. 网络优化之后，再按测量处理 DOM

若零延迟假服务基线显示抽取或插入出现明显 long task：

- 把稳定块 ID 到元素的索引保留在内容脚本生命周期内，避免每批重新扫描所有块。
- MutationObserver 记录 dirty 根节点，只增量抽取受影响区域；保留 75 ms 去抖。
- 大批 DOM 插入按 animation frame 分片，避免单次长任务；同时保持批级进度而非 token 级页面抖动。

这部分应排在网络调度之后，除非阶段测量显示其已占 TTFV/Tcomplete 的显著比例。

## 建议的验收门槛

在实现任何优化前固定基线，然后用相同输入、延迟和运行次数比较。建议第一轮门槛：

- 受控 30 块 / 250 ms 场景：TTFV median 不劣于当前 498.3 ms；Tcomplete median 至少改善 25%。
- 真实提供商 100 块场景：Tcomplete median 至少改善 20%，且 P95 不因 429/重试明显恶化。
- 429、超时、网络和响应格式错误仍按批显示并可手动重试；已成功译文不丢失、不重复。
- 动态内容更新时旧 version 的响应不得覆盖新内容。
- 冷缓存与热缓存的翻译结果、请求数和缓存失效语义保持现有测试约束。
- 页面 long task 数量不增加；如引入逐块流式插入，还需单独约束布局抖动和插入频率。

## 推荐实施顺序

1. 加入阶段计时和基准夹具，建立真实提供商的冷/热缓存基线。
2. 实现首屏优先、字符/token 预算组批；单独验证 TTFV。
3. 实现共享的有限并发 worker pool，从并发 2 开始；验证吞吐、429 和失败恢复。
4. 根据数据决定是否优化 DOM 索引和增量扫描。
5. 仅在非流式路径仍无法达到 TTFV 目标时，实验带完整块事件和最终集合校验的流式协议。

这个顺序保留了当前最重要的正确性资产——稳定 ID 映射、版本校验、批级失败和手动重试——同时先验证最有证据的吞吐瓶颈。
