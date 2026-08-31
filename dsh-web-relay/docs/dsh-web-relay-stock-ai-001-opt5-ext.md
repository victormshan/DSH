# 股票智能系统 · 001 方案 5 个优化版本（V1.1-V1.5，外部 AI 方案版）

> 基于 dsh-web-relay-stock-ai-001.md 的优化变体设计（仅方案，不写代码）
> 生成：2026-08-31 18:46（expr-2026-08-31_18-46-49，外部 AI 完整产出 + 主 agent 整理落盘）
> 通道：gemini-free（v3.2.6 长回答修复后完整输出）

---

## 0. 演化路线总览

```
V1.1 多源异构融合版   → 解决数据源单点故障、静态/动态快照高并发缓存与数据清洗
V1.2 事件驱动流式 AI  → 盘中实时 Tick/News 事件触发、流式 Agent 异步选股/因子计算
V1.3 分布式拓扑与风控 → 利用 v1.8 混合模式(importance)+v1.6 拓扑并行，实现三级严审风控
V1.4 AutoIteration 闭环 → 利用 v1.9 自动迭代机制，结合盘后回测夏普比率自动演进策略参数
V1.5 极简云原生与容灾 → 无服务器化低成本部署 + 基于降级链协议(v1.9)的完全离线容灾模式
```

---

## 1. V1.1 — 动静结合架构与多源异构数据融合增强版（Multi-Source Data & Hybrid Cache）

**设计核心**：消除对单一行情/财务数据 API 的强依赖，构建**高可用异构数据抽象层（Data Abstraction Layer）**。

**架构要点**：
1. **数据源主备与降级**：主接入 Tushare/AkShare 实时数据，备接入 Eastmoney 网页抓取切面。单源超时 800ms 自动秒级熔断切备源。
2. **动静分离存储**：日线/财务/行业分类等静态数据打入 LevelDB/SQLite 盘存；盘中 Tick/分钟线/分时量价打入 Redis 内存环形缓冲区（Ring Buffer）。
3. **数据预清洗切面**：在进入外部 AI 或策略引擎前，执行强类型校验（去异常极端值、除权除息复权修正、缺失值补全）。

**接口抽象规范（草案）**：
```
DataProvider (interface)
  ├─ fetchDaily(symbol, start, end) → OHLCV[]
  ├─ fetchFundamentals(symbol, period) → Fundamental[]
  ├─ fetchNews(symbol, window) → NewsItem[]
  └─ health() → { source, latencyMs, lastOk }

FallbackRouter：主源超时 800ms → 熔断标记 → 切备源 → 恢复探测（60s 半开）
CacheLayer：静态盘存（SQLite/LevelDB）∪ 动态环缓（Redis，TTL 按品种）
Cleaner：强类型校验 → 去极值（±10σ）→ 复权修正 → 缺失补全（限 3 日）
```

---

## 2. V1.2 — 事件驱动与流式大模型选股引擎（Event-Driven Streaming AI Engine）

**设计核心**：解决传统 LLM 选股"响应慢、无法捕捉盘中突发异动"的痛点，将批量 RPC 改为**事件驱动流式（Event-Stream）选股模式**。

**架构要点**：
1. **盘中异动事件总线（Event Bus）**：捕捉"短线封板"、"大单砸盘"、"突发研报/新闻"三类事件，实时打包推送到选股队列。
2. **流式 Token 因子抽取**：外部 AI 通过 SSE（Server-Sent Events）输出结构化 Reasoning，主 agent 盘中边接收 Token 边解析选股因子（情绪分、技术突破信号）。
3. **异步选股切片**：选股耗时控制在 2 秒内，生成带有置信度评分的"预警候选池"供用户及主 agent 做进一步风控核验。

**事件类型定义（草案）**：
| 事件类型 | 触发条件 | 打包字段 |
|---|---|---|
| 短线封板 | 涨幅 ≥9.5% 且买一量 ≥流通盘 0.5% | symbol/price/volume/ts |
| 大单砸盘 | 单笔成交 ≥10 万手且跌幅 >2% | symbol/price/volume/side/ts |
| 突发研报/新闻 | NewsAPI 命中 ticker 且相关性 >0.8 | symbol/title/sentiment/ts |

**SSE Token 协议**：
```
data: {"type":"reasoning","factor":"sentiment","value":0.72,"symbol":"AAPL"}
data: {"type":"signal","action":"watch","confidence":0.81,"symbol":"AAPL"}
```

---

## 3. V1.3 — 高并发分布式执行与混合风控机制（Distributed High-Throughput & v1.8 Hybrid Risk Control）

**设计核心**：引入 Web Relay Protocol v1.6 拓扑并行与 v1.8 混合模式（`importance` 执行/审核契约），兼顾大范围扫盘效率与高风险操作安全性。

**架构要点**：
1. **三维并行选股拓扑（parallel_group）**：
   - 子任务 A（`importance: low`）：宏观及行业板块动能扫描（免外部审，主 agent 直接处理）。
   - 子任务 B（`importance: medium`）：千只股票技术面筛选与量价指标计算（批量轻审）。
   - 子任务 C（`importance: high`）：黑天鹅排查、黑名单校验与交易信号触发（外部 AI / 用户严格双重审核）。
2. **硬风控拦截门禁**：在 `importance: high` 步骤强制绑定熔断规则（如大盘跌幅 >3% 停止开仓，单股仓位上限 10%）。

**三级风控执行拓扑**：
```
parallel_group A (low, 免审)     parallel_group B (medium, 轻审)     parallel_group C (high, 严审)
  宏观/板块动能扫描                 千股技术面筛选                     黑天鹅/黑名单/交易信号
        │                                │                                │
        └──────────────┬─────────────────┴────────────────┬───────────────┘
                       ▼                                  ▼
             depends_on 门控                       硬风控拦截门禁
                       ▼                                  ▼
                 合并候选池                   熔断规则（大盘-3% 停开仓 / 单股≤10%）
```

---

## 4. V1.4 — 闭环回测与 AutoIteration 自动演化版（Backtest Feedback & AutoIteration v1.9）

**设计核心**：利用 v1.9 自动迭代协议（`iterations: N`），实现策略自选、回测验证、参数微调的自闭环演进。

**架构要点**：
1. **版间门验证机制（Version Gate）**：每一版（Vn）选股策略生成后，自动注入历史 30 天滚动窗口（Rolling Window）进行模拟回测。
2. **自动收敛指标**：以"胜率 > 60% 且最大回撤 < 5%"为 `finalAcceptance` 验收标准。若 Vn 未达标，外部 AI 自动评审上版回测报告，调整提示词权重并重构后续 Step List。
3. **熔断与版本沉淀**：连续 3 次迭代未提升自动触发熔断暂停并唤醒用户；达标后自动 commit/tag 沉淀为稳定策略版本。

**AutoIteration 状态机**：
```
Vn 生成 → Rolling Window 回测 → 达标？→ 是 → commit/tag 沉淀 → Vn+1
                                    ↓ 否
                        外部 AI 评审回测报告 → 调参/重构 Step List → 重提
                                    ↓ 连续 3 次未提升
                              熔断暂停 → 唤醒用户
```

---

## 5. V1.5 — 云原生无服务器化与全角色降级容灾版（Serverless & Air-Gapped Resilience v1.9）

**设计核心**：打造极致低成本、高韧性的全角色降级防线，确保在极端网络或 API 故障下系统依然可用。

**架构要点**：
1. **Serverless 边缘部署**：核心算力迁移至 Serverless / Edge Function，盘中无流量时零成本驻留。
2. **三级降级链完全覆盖（v1.9 协议）**：
   - **外部 AI（Gemini/DeepSeek）** 连通时：执行高阶大语言模型因子提取与深度分析。
   - **降级至对话模型（Dialog-Fallback）**：Gemini 限流/离线时，自动降级至本地小参数对话模型（无工具），执行规则匹配与基础选股。
   - **降级至手动/离线快照（Manual/Air-Gapped）**：完全无网状态下，根据主 agent 预先落盘的离线快照数据输出保守安全候选池。
3. **审计追溯**：所有降级执行均自动打上 `providerLabel: 对话模型（降级）` 与 `channel: dialog-fallback` 标记，轨迹完全可溯源。

**三级降级流转图**：
```
外部 AI (Gemini/DeepSeek) ──限流/离线──▶ 对话模型 (dialog-fallback) ──无网──▶ 手动/离线快照 (manual)
  高阶因子提取 + 深度分析              规则匹配 + 基础选股                保守安全候选池
        │ 审计字段：providerLabel/channel 全程标记，轨迹可溯源
```

---

## 6. 横向对比表

| 版本 | 关键词 | 解决痛点 | 复杂度 | 依赖 |
|---|---|---|---|---|
| V1.1 | 多源异构、动静缓存 | 数据单点故障、缓存压力 | 中 | 无 |
| V1.2 | 事件驱动、流式因子 | 盘中响应慢、错过异动 | 高 | V1.1 数据层 |
| V1.3 | 拓扑并行、混合风控 | 扫盘效率 vs 操作安全 | 高 | v1.6/v1.8 协议 |
| V1.4 | 回测闭环、自动演进 | 策略静态、参数人工调 | 高 | V1.3 风控 |
| V1.5 | Serverless、降级容灾 | 成本高、极端故障不可用 | 中 | 全协议 |

**组合建议**：
- **V1.1 + V1.5**（推荐起步）：数据可靠 + 低成本高韧性，个人投资者友好。
- **V1.2 + V1.3**：实时盘中 + 严风控，适合有一定基础设施的量化用户。
- **V1.4 叠加演进**：在 V1.3 风控就绪后引入自动回测演进，形成完整闭环。

---

## 7. 说明

- 本方案由外部 AI 完整产出（v3.2.6 长回答修复后无截断），主 agent 整理落盘为实体文档。
- 对应 Step 1-5 的验收：V1.1（多源降级流程图+接口规范 ✅）、V1.2（事件类型+SSE 协议 ✅）、V1.3（拓扑图+importance 划分 ✅）、V1.4（状态机+指标+熔断 ✅）、V1.5（架构图+降级流转+审计字段 ✅）。
- 纯方案文档，不含任何业务代码。
