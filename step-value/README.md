# step-value

DeepSeek Harness API 费用 / Token 用量看板插件（cordis 静态插件）。解析 `~/.dsh/sessions/` 下多帧 zstd 拼接的会话 JSONL，按 **Workspace → Session → Turn** 统计 token 用量与花费（USD + CNY）。

## 路由

| 路由 | 说明 |
|---|---|
| `GET /step-value/summary` | 所有工作区汇总（turns / tokens / costUSD / costCNY / **perModel** / **avgCostPerTurn**） |
| `GET /step-value/tree` | Workspace → Session → Turn 树 |
| `GET /step-value/step-details?workspace=&session=&turn=&step=` | 单个 Turn 明细（含原始 usage / source） |

## 解析机制

- 会话日志 `session.jsonl.zstd`：zstd 魔数 `28 b5 2f fd` 切帧，逐帧 `zstdDecompressSync` 解压后 JSONL 逐行解析；单帧/单行损坏自动跳过，不中断整体。
- 每个 `type === 'assistant/message'` 事件 = 一个 API Turn，提取 `data.message.source.{model,provider}`、`data.usage.{inputTokens,outputTokens,cacheReadTokens,reasoningTokens}`、`data.turn`（缺失回退 `data.step`）、事件 `time`。
- 工作区目录名解码：`--D-dsh~0020relay~0020test--` → `D:\dsh relay test`（`--` 包裹、`~XXXX` UTF-16 转义、`/ \ :` 折叠为 `-`）。

## 缓存（v0.2.0 V1 / v0.3.0 V2）

- **内存缓存**（TTL 60s）+ **磁盘持久化缓存**（`~/.dsh/step-value-cache/`，可用 `DSH_STEPVALUE_CACHE_DIR` 覆盖）：缓存文件按 `<encodeURIComponent(logPath)>.json` 命名，内容 `{ sig, parsedAt, result }`。
- **sig = `<mtimeMs>:<size>`**：文件未变动时直接读磁盘缓存，跳过 zstd 解压 + JSONL 解析——跨 dsh web 重启不失效，冷启动不再全量重解析。
- v0.3.0 缓存层重构：`readParsedFromCache` / `writeParsedToCache` 拆分；`parseBatch`（Worker 线程池）保留为可选项（实测更慢，见性能记录）。

## 模型计价（v0.2.0 V1 扩充）

`MODEL_PRICES`（USD/1K tokens）：deepseek-v4-flash / deepseek-chat / deepseek-reasoner / **claude-3-5-sonnet / claude-3-7-sonnet / gemini-2.0-flash / gemini-1.5-pro / gpt-4o / gpt-4o-mini**；未知模型回退 `_default`。汇率 `USD_TO_CNY = 7.2`（可编辑常量）。

## 性能实测（真实会话 4 工作区 ~4500 turns）

| 方案 | 首次解析 | 缓存命中 |
|---|---|---|
| 串行 + 磁盘缓存（**当前采用**） | ~7.7s（<10s ✓） | ~10ms（<500ms ✓） |
| Promise 并行 | ~7.7s（无改善，zstd 为同步 CPU 密集） | — |
| Worker 线程池 | ~12.5s（更慢：模块重复 import + 大结果序列化） | — |

## 版本历史

| 版本 | 内容 |
|---|---|
| 0.3.0 | V3 终态：端到端验收 + 文档 + 正式发布（替代 v0.2.0-v* 预发布） |
| 0.2.0 | V1+V2：持久化磁盘缓存、MODEL_PRICES 扩充、summary perModel/avgCostPerTurn、缓存层重构、性能实测 |
| 0.1.0 | 初始版：zstd 解析 + Workspace→Session→Turn 费用树 |

## 部署

复制 `lib/`、`package.json`、`cordis.patch.yml` 到 `C:\Users\Administrator\.dsh\profiles\web\node_modules\step-value\`，重启 dsh web 生效（Host 半）。
