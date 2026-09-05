# dsh-web-relay · 能力持久化待补清单（Capability Pending List）

> 生成：2026-09-04（v1.9 自动迭代实施全过程二次考古，方法论修正后）
> 考古方法（修正版，见 lesson L-2026-0904-017）：**三源交叉**——① expr 三件套（记录/steps/trace）② 主会话轨迹解码（session-a0a01dfa，95,535 事件，2026-08-24~09-04）③ git tag/commit 发布史；行为层（判断模式）与**机制层（引擎交付物）并行提炼**；收口做 tag 覆盖度自检。
> 判定标准：换新会话主 agent **仅凭插件代码 + 协议 + 本库能否 3 步内复现**——不能 → 语境能力，登记；能 → 已固化。机制层按"交付物 vs 接线缺口"登记。

## 0. 已登记基线（去重参照，2026-09-04 复验）

| 库 | 现状 | 说明 |
|---|---|---|
| registry.yaml | **10 条** | workflow 6 + project/机制 4（v3-shadow-sandbox / v3-prompt-case-library / v3-swarm-review / architect-breakthrough-gate） |
| 能力清单（main-agent-auto-iteration-capabilities.md） | A-D 行为 **25 项** + E 机制 **4 项** | 考古 v1.8→v1.9 + 机制补登记 |
| lessons.json | **17 条**（001-016 已确认：5 in-runbook/9 approved/2 superseded；017 复盘 proposed） | 机器载体已启用 |
| runbook / lesson-schema / design | 已生效 | SOP 层 |

## 1. 判定与落点规则

- **语境能力**（行为/判断，换会话不可复现）→ 候选 lesson（proposed）或能力清单 A-D 新行
- **机制交付物**（引擎已实现/已接线）→ registry project 类条目（source=能力文档 E 节或专属文档）
- **接线缺口**（引擎有端点无调用方 / 功能未启用 / 门禁缺失）→ 记入 §2 引擎待办（Stage C v3.5.0 候选），并在能力文档 E 节标注状态
- 每条登记后跑 `verify-capabilities.mjs`；lesson 由用户确认后转 approved

## 2. 机制层/引擎待接线（Stage C 候选，源自 v3-roadmap-implementation-gap-analysis §5）

| # | 缺口 | 引擎现状 | 建议 | 状态 |
|---|---|---|---|---|
| P1 | prompt-case-library 恒空 | collectRejectedCases 只收仍 rejected（finalize 前置全 approved） | 收集"曾被 rejected 后 approved"（notes 历史） | ⏳ 待用户确认 4 设计点后实施 |
| P2 | Swarm 从未启用 | enableSwarm 默认关、无 UI/自动触发 | high 默认开+可关+成本提示+parse warn | ⏳ 同上 |
| P3 | Architect 突破度无门禁 | 仅协议文本 | breakthrough_type 解析 + 连续 Incremental warn | ⏳ 同上 |
| P4 | 能力文档与引擎缺口不同步 | 文档已补（本清单即产物） | 修复与登记同步（v3.5.0） | 🔄 进行中 |
| P5 | 影子沙盒支撑未接入自动迭代 | /shadow 裸端点（L841-915，无业务调用方）；git 仓库前提：D:\DSH ✓ / 实验目录 ✗ | v1.9 自动迭代 high/重构步 shadow preflight + 版间回滚基线——设计文档已建（草稿）：`docs/auto-iteration-shadow-support-design.md` | ⏳ 4 决策点待拍板（排期/触发默认/是否阻断/非 git 降级） |

## 3. 语境能力候选

> 来源（2026-09-04 二次考古，并行三批）：
> A) 任务骨架清单——确定任务/讨论 vs 确定/实现清单/遗留清单（subagent c216cdb7）
> B) expr 对照——主会话触发点 ↔ experiments/traces 结果（subagent cabbfad8）
> C) 轨迹×代码语境能力候选（subagent ba165328，已去重 A-D/E/lesson 基线）

### 3.0 三源交叉·git 发布史交付物核对表（08-24→09-04，主会话实施期；主 agent 直接经手，D:\DSH git log 实证）

| 交付物（机制/通道） | commit/tag | 能力文档 E 节 | registry | 语境能力缺口判断 |
|---|---|---|---|---|
| 影子试错沙盒 | f9822b3 / v3.0.0 | E1 ✅ | v3-shadow-sandbox ✅ | 已登记（接线缺口 P5） |
| Prompt 自主进化案例库 | 8b17ad8 / v3.1.0 | E2 ✅ | v3-prompt-case-library ✅ | 已登记（接线缺口 P1） |
| Swarm 双角色盲审 | 69ea644 / v3.2.0 | E3 ✅ | v3-swarm-review ✅ | 已登记（接线缺口 P2） |
| Architect 突破度 | 协议层 | E4 ✅ | architect-breakthrough-gate ✅ | 已登记（门禁缺口 P3） |
| **web-gemini 通道栈**（MV3 扩展+content 防截断+多Tab 均衡+bridge+watchdog+token 鉴权） | 6a244e5、012de4c、4609006、75ee431、d8ae9a8、v0.2.x/v0.3/v0.4、baac351(v3.3.0 加固) | ❌ | ❌ | ⚠️ 机制未登记；语境含 MV3/防截断/看门狗/安全加固模式 |
| **Claude API 通道**（provider=claude，harness llm anthropic 路由） | fa5410a | ❌ | ❌ | ⚠️ 机制未登记 |
| **Trace Replay 离线沙盒 + 面板入口** | 027a5e3、0e0c461 / v2.2.0-2.2.1 | ❌ | ❌ | ⚠️ 机制未登记 |
| **Webhook 通知中心**（熔断/降级/打回三触发） | 027a5e3 / v2.2.0 | ❌ | ❌ | ⚠️ 机制未登记 |
| **reviewChannel 通道选择器**（auto/web-gemini） | 4f019cc、f4576f4、b21bdc3 / v3.2.2-3.2.4 | ❌ | ❌ | ⚠️ 机制未登记 |
| **审核摘要截断显式标注** | bf19c60 / v3.2.5 | ❌ | ❌ | ⚠️ 语境 lesson 候选（盲审缓解） |
| **dialog/claude 超时与 aborted 拦截** | 3875eeb / v3.2.6 | ❌ | ❌ | ⚠️ 语境 lesson 候选 |
| **artifacts 挂载 + 迭代字段持久化（自举修复）** | 20766f6 / v1.4.0 | 见 B9 行为行 | ❌ | lesson 已含（010/014）；机制已实现 |
| **摘要截断误判修复（v3.3-1/bf19c60 系）** | 见上 | B6/B10 证据 | ❌ | lesson 008 已含 |
| step-value 0.2→0.4 / dsh-web-gemini-ext / claude-step-relay v0.1 | 平行仓库交付 | ❌ | ❌ | ⚠️ 平行产品；是否纳入主 agent 能力待用户界定（建议仅登记"并行多仓交付编排"语境 lesson） |

### 3.1 语境能力候选（2026-09-04 主 agent 第一方取证草稿）

> 取证说明：三批考古子代理因大文件读取超时被中断，无独立第三报告；下表由主 agent 以第一方证据（主会话 a0a01dfa digest [U 时间] 原文 + git 发布史 + 前序考古）直接起草，**待用户/外部 AI 复核后逐条登记**（autoDecision=false）。

| # | 候选能力（语境判断/动作模式） | 何时触发 | 证据（[U 时间]/commit/expr） | 相近已入库 | 建议落点 |
|---|---|---|---|---|---|
| C-a | **多子 agent 文件解耦并行派发与统一验收**（按 index.js/client.js/docs 三路解耦并行，每路 node --check+冒烟，主 agent 最后统一收口；仅文件可解耦时才并行） | 大版本多模块实施 | 8/25 v0.9.0 三路、v1.0.0 多路子代理报告（[U 08-25 05:42-05:54]）；8/28 讨论"代码场景串行为主"（[U 08-28 01:35]） | B2/B5、lesson 012 | lesson proposed（engineering-action） |
| C-b | **版本断言**：任何改动前先读 package.json/git HEAD 核对基准版本，不符即停 | 重构/改版任务开始 | 用户采纳外部 AI 建议#4（[U 08-24 23:15]）；v1.8 后端子代理"先断言 1.1.0 后动手"（d925feb1 报告） | lesson 003/015（tag 续线） | lesson proposed（repository-knowledge）+ runbook §4 补一句 |
| C-c | **git 原子交付规约**：里程碑强制 tag/commit；回退用 checkout/reset，禁止跨会话重放历史 Edit；必要时全量快照 | 版本回退/里程碑 | 用户采纳外部 AI 4 建议（[U 08-24 23:15/23:40]） | runbook §4 部分、lesson 015 | lesson proposed（engineering-action） |
| C-d | **实测数据驱动协议演进**：以真实用量复盘（626 turns）反推协议缺口（→alternatives/importance v1.7；固定成本≈$0.05/ turn → 优先减 Turn） | 大任务收口后复盘 | [U 08-25 21:28-22:14]（v1.7 P1-P9 采纳） | A4/B3/D3 | lesson proposed（judgment-heuristic） |
| C-e | **跨工作区上下文桥接**：workspacePath ≠ 默认 cwd 时，读/写/收口一律以注入路径为准 | 收到跨工作区 handoff | [U 08-25 10:09-10:12]（expr-…_02-09-32 桥接） | 交接档案惯例 | lesson proposed（repository-knowledge）/ runbook 补 |
| C-f | **web-gemini 渠道问题分层排查**：唤醒缺失/steplist 截断/面板无反应 → 扩展↔bridge↔解析三层定位（而非只归因单侧） | web-gemini 通道故障 | [U 08-27 22:31-23:26]（多次渠道问题与实测） | C4 通道审计（偏 provider 判定） | lesson proposed（judgment-heuristic） |
| C-g | **版本号多源一致性核对**：package/README/说明书/statusHandler 四处同源；防硬编码漂移 | 发布/文档同步 | 92b57d6（修 statusHandler 硬编码 1.3.0）；subagent 提示"1.0.1 未入历史表"（[U 08-25 22:20]） | runbook §4/§6（BOM/版本） | lesson proposed（tooling-trap） |
| C-h | **外部 AI 通道失能时"代决策+独立审方兜底"自愈推进**（429 时按候选方向代规划保流水线 0 停滞，熔断 pause 前不无限重试） | Gemini 持续 429/dialog 兜底失效 | [U 08-27 01:47]（step-value 0.3→0.4 复盘）；[U 08-26 23:33]（V2 外部评审 429 场景） | lesson 012/013、runbook §2.5 | 已在 lesson 012；无需新增（标注"已覆盖"） |
| C-i | **AutoIteration 实测后立即沉淀说明书复盘章节**（4.13/4.15-4.20 链式复盘惯例） | 每轮自动迭代收口 | 多 commit（说明书章节号递增链） | D3/D4 收口规范 | runbook §3/能力 D4 引用即可，不新增条目 |
| C-j | **跨会话/跨任务状态还原纪律**（被唤起先看 expr 三件套+本会话轨迹，不凭记忆） | 每次 handoff | [U 08-27 23:26] 等多次收口 | runbook §2.1、lesson 002 | 已覆盖；不新增 |

> 拟登记口径（供用户确认）：C-a~C-g 共 7 条 → lesson proposed；机制登记见 §3.0 各行 ⚠️ 项（web-gemini 通道栈/Claude 通道/Replay/Webhook/reviewChannel 等 → 建议 1 条聚合机制 registry 或能力文档 E 节扩行，逐条或聚合由用户定）。

## 4. 流程

1. 三批报告合并 → §3 候选表成稿
2. 去重核对（§0 基线）→ 给每条"建议落点（registry/能力行/lesson proposed/runbook）"
3. 交用户/外部 AI 确认 → 逐条补登记（含 lessons.json status/confirmedBy）→ verify 复验
4. §2 引擎待办（P1-P5）纳入 Stage C / v3.5.0 Step List（S1-S7 + S8/S9 影子支撑）

---

## 5. 更新核对（2026-09-05）

> 9/5 主对话（v3.5.0→v4.3.0 + 能力持久化维护）后复核，§0-§4 为 9/4 快照；以下为最新核对：

| 库 | 9/4 快照 | 9/5 现状 | 核对结论 |
|---|---|---|---|
| registry.yaml | 10 条 | **14 条** | 12（含 9/4-9/5 机制登记）+ v4 新增 2（host-restart-resume / autonomous-validation）→ verify 14/14 绿 |
| 能力清单 | A-D 25 + E 4 | A-D 25 + **E1-E13** | E 区补 v3.5-v4.3 机制行（GC/rollback/Schema/watchdog/续跑/自主实证） |
| lessons.json | 17 条 | **32 条**（001-032） | 017-027（v3.5-v3.7 复盘，user 已确认）+ 028-032（9/5 新教训，approved） |
| §2 P1-P4 | 待 v3.5.0 | **已闭环** | P1 案例库（v3.5.0）、P2 Swarm 默认开（v3.5.0）、P3 突破度门禁（v3.5.0）、P4 文档同步（持续）——见能力文档 E1-E4 接线状态 |
| §3 C-a~C-j 语境候选 | 待用户确认 | **已覆盖** | C-a/C-b/C-c/C-d/C-f/C-g → 与 lessons 017-032 / runbook 家族重合（多子代理并行=实验 V1-V3 实证、版本断言=lesson 003/015 族、git 原子交付=lesson 015、实测数据=analysis、渠道分层=OPS/通道文档、版本多源=lesson 029/runbook §4）；C-e 跨工作区桥接 → resume-scan 候选基准（DSH_RELAY_WORKSPACE）机制化；C-h/C-i/C-j 已标注覆盖 |

**剩余未决（9/5）**：① lesson Top-K 注入（schema §4 愿景）② 跨宿主「自动唤醒续跑」真实实测 ③ AutoIteration 声明解析兜底（lesson 031）④ 宿主重启编排子命令化（lesson 032）⑤ registry lastVerified 自动回写。
