# dsh-web-relay · 主 agent 自动版本迭代执行能力清单（协议 v1.8→v1.9 考古沉淀）v0.1

> 归属层：project + workflow（执行侧能力；建模侧见 `auto-iteration-modeling.md`）
> 状态：已生效（2026-09-03 考古沉淀，证据来自 22 条试验/轨迹记录）
> 来源：web-relay/experiments + web-relay/traces（2026-08-26 ~ 2026-09-03，协议 v1.8→v1.9 AutoIteration 时代）
> 配套：`main-agent-runbook-v0.1.md`（SOP/纪律）、`main-agent-lesson-schema-v0.1.md`（细粒度 lesson）、`capabilities/registry.yaml`

## 0. 考古范围与方法

- 盘点：71 条命中关键词的试验记录 → 收敛 22 条真正的主 agent 自动迭代执行记录（其余为 dialog 问答/重发重复/未唤醒记录）。
- 分三批精读（考古报告已全部并入证据）：早期 v1.8→v1.9 验证（08-26~08-28，9 条）、stock-ai 多版迭代（08-31~09-01，8 条）、审计/大版本收口（09-02~09-03，5 条）。样本地图见文末附表。
- 证据载体：`expr-<stamp>.steps.json`（顶层 protocolVersion/iterations/autoDecision/currentIteration；每步 status/notes/reviewedBy）、轨迹 `## [主 agent]` 条目、试验记录 frontmatter（通道审计三字段）。
- 全程只读考古；本清单 = 主 agent 在自动多版本迭代中反复展示的判断/动作模式，按"何时用→怎么判断/做→证据"组织。

## 1. 能力清单（按迭代生命周期分组）

### A. 迭代前：判定与门控

| # | 能力 | 判断/动作 | 证据（expr + trace/notes 引用） |
|---|---|---|---|
| A1 | 任务/交付类型判定 | 先判任务性质再决定动作：执行型（拆步实施+回写+审核）vs 纯方案文本型（只落文档，不打 tag）vs 说明/问答型（直接收口不拆步）。避免为一句问答空跑迭代。 | 13-08-27（信息查询类直接收口）、18-46-49（"只是方案不做代码"、iterations=1 无 tag）、21-01-00（说明性收口）、13-36-43 |
| A2 | AutoIteration 声明核对 | 以 steps.json 顶层 iterations/autoDecision/currentIteration 落盘值为准；发现叙述式声明（"自动迭代N个版本"/iterations:3 只出现在 Answer 文本）未落盘时，上报并修复而非假装已进入自动模式。 | 01-07-59、13-07-59、02-36-44 复现（顶层仍 1/false）；01-33-59 正例（严格 JSON 块成功落盘）；01-27-21 修复（extractAutoIterDecl 补丁，单测 8/8） |
| A3 | 只读探路先行并结构化回传 | 执行前用 context_requests 只读收集路径/版本/模块/已知问题，按 5 段模板（data_schema/pricing_map/mount_points/runtime_limits/history_trace）打包回传外部 AI，使其无需文件访问即可出蓝图。 | 01-07-59（源 3.3.0 vs 安装 3.3.1 双路径盘点）、14-34-33（Step1 五段模板回传）、01-27-21 |
| A4 | 现状建模 Step 0 | 迭代前产出功能树/当前调用流/版本演进/影响面标注（必要时补状态机/API 契约/数据模型/测试矩阵），改动前先标"改动模块 vs 受影响模块 vs 受影响测试"。 | auto-iteration-modeling.md §2-5；01-27-21 的行号级现状取证为其执行形态 |
| A5 | 探路/审计步自动豁免（review:false/low） | 探路、审计、纯分析步设 importance:low + review:false，complete 即 approved（reviewedBy=mainagent），把外部/三方审核预算留给实施与验证步；high 步仍严格走审核。 | 13-16-32（3 步全豁免）、15-26-14（S1/S2）、15-42-26、22-15-02（v2.5-1/v2.6-1）、01-29-26（v3.0-1） |

### B. 迭代中：执行与节奏

| # | 能力 | 判断/动作 | 证据 |
|---|---|---|---|
| B1 | 版间门执行 | Vn 全部 approved 才进入 Vn+1；达 iterations 上限收口 done；每版收尾建立 commit+tag 可回溯基线并 push 远端。 | 13-36-43（V1..V5，版间门×4，tag v1.9-v1..v5）、14-34-33（tag v5）、15-00-11（tag dsh-stock-ai-v1..v3）、01-27-21（V1→V2，v3.3.2→v3.4.0） |
| B2 | 逐步状态机 + 证据型 complete | 每步 start→complete→(review)→approved；complete/notes 自带可复核证据（字符数/章节数/commit hash/tag/测试数/校验命令），拒绝空口"完成"。 | 13-36-43（"5629 字符完整"）、14-34-33、15-00-11、18-46-49、01-27-21（notes 含 "trace-cards.test.js 4/4；v3.4.0 commit 95a3918"） |
| B3 | 实测数字当证据 | 以运行验证/实测输出（沙箱变体数、回测年化/夏普/回撤、综合分、HTTP 状态）作为交付证据，而非只写方案。 | 14-34-33（年化 24.42%/夏普 1.99/回撤 6.92% 过门槛）、15-00-11（AAPL/SPY 综合分 77.9）、13-36-43 |
| B4 | 缺口跨版本滚动补齐 | 需求映射显式标"⚠️ 部分 + 列入 Vn"，后续版本闭合，收口自检"缺口：无"。 | 13-36-43（需求5：V2 登记→V3 闭合→V4 再留衔接项）、18-46-49 |
| B5 | 通道失能时代行外部 AI 职能 | 外部 AI ask 通道反复中止/长答中断时，代构造 Vn 方案要点与后续 Step List，维持版本循环不断档；代行内容明示"主 agent 代构造"，并尽量留独立审方（dialog）兜底。 | 15-00-11（V1/V2/V3 三次代构造）、13-36-43（收口记录②） |
| B6 | 误打回 reopen 抗辩 | 打回先判断是否"审核通道缺陷"（摘要静默截断、dialog 无干净 JSON、批次连坐）而非内容问题：举证驳回→reopen→促成根因修复（截断修复 v3.3-1 等）；实体产物真缺失则补产物重提。 | 13-36-43（2 例：截断误判、dialog 无 JSON）、15-00-11（Step2 补 stock-v1-review.md）、18-46-49（补 opt5-ext.md 章节后单步审核通过） |
| B7 | 越权自我纠正 | 发现自己违反纪律（如擅自 restructure high 规划）时：显式写【流程纠正】进轨迹、还原外部 AI 基线为权威（已交付产物保留、修正版另存），不以错误状态继续。 | 01-27-21（越权 restructure 后自我撤回并还原 6 步基线） |
| B8 | 重叠/重复任务仲裁与停手 | 识别他任务已承接同一需求时主动 stop（记 stopReason/stoppedAt、状态留 open+finalized=false 诚实保留半途），去重防双写。 | 13-40-00（停止重叠任务：13-36-43 已正确承接 5 版迭代） |
| B9 | 自举式缺陷修复（改自己的迭代器） | 在自动迭代中发现所依赖引擎/状态机缺陷（声明不落盘、artifacts 不挂载、写 state 缺迭代字段、版本漂移）时，作为真实增量纳入当轮修复并加镜像测试，不绕开。 | 14-48-26（落地 AutoIteration 引擎 6 处实现）、15-17-07（writeStepState 迭代字段持久化，commit 38ccfa1）、15-42-26（artifacts 挂载+声明持久化 v1.4.0/20766f6）、20-20-48（statusHandler 版本漂移修复） |
| B10 | 真实数据验收 + 如实标注验证边界 | 用真实量级数据/真实调用验收（真实会话 turns、真实 git worktree、POST /trace 幂等实测），并明示边界：模拟 429≠真实 429、host 改动待重启生效、"外部 AI 目标经实测不现实"时如实对齐口径，不伪造达标。 | 15-17-07（4478 turns 冷/热缓存实测、否决 <5s 目标）、15-26-14（熔断 pause/resume 闭环实测）、01-29-26（worktree 集成闭环）、14-48-26/17-49-28（边界明示） |

### C. 审计与治理（判断模式）

| # | 能力 | 判断/动作 | 证据 |
|---|---|---|---|
| C1 | 行号级"已实现 vs 重造"审计 | 对外部 AI 规划逐项核对源码行号 + 历史实测：已实现项（熔断 rejectStreak≥3→paused 等）判"验证+补测"而非重造；只实现真增量。 | 01-27-21（熔断 index.js L2765-2770、webhook L2529-2533、restructure 悬空 400 L3214-3228、AutoIteration 状态机落盘 L1450-1452/finalize 自推 L2881-2902；真增量=面板多版本卡片化 client.js L1918-1919 仅徽章）；02-36-44/13-07-59 为未审计负例 |
| C2 | 版本/tag 体系延续判定 | 拒绝回退旧命名（v1.9.x/v2.x 为旧协议时代），坚持按 package v3.x 语义化续线（bump 用 node 重写避免 BOM）。 | 01-27-21 提出并获外部 AI 采纳（v3.3.2→v3.4.0）；02-36-44（外部 AI 规划 v2.0.0 tag 与仓库 v3.x 冲突）为负例 |
| C3 | 审计证据不自裁、交外部 AI 裁决 | 差异表（已实现/真增量/规划缺陷）+ 行号证据打包为"/ask 评审包"，三问：①评审已交付 V1 ②输出 V2 restructure 列表 ③裁决声明格式；不擅自替换外部 AI Step List。 | 01-27-21 → 01-49-57（独立评审 expr，channel gemini-free 零降级，外部 AI APPROVED + 输出严格 JSON 声明与 V2 3 步） |
| C4 | 通道审计判定 | 以记录 frontmatter requestProvider/providerLabel/fallbackReason 为审计真相；channel ≠ 用户所选 provider → 判定走降级链而非路径串扰。 | 13-07-59 主会话排障（channel=web-gemini vs 所选 Gemini Free API → v1.9 无 key 降级判定）、13-36-43（摘要截断误判 reopen） |
| C5 | 重复/异常数据检测 | 发现 steps.json 重复步骤（id 撞车）、currentIteration 与步级 Vn 标签脱节、pv/声明自描述不一致时，报告处置建议；结论以源码行号与 git 事实为准。 | 01-07-59（1-6 步骤重复两遍→建议去重）、14-34-33/15-00-11（ci=2 但 V5/V3 已完成）、01-49-57（顶层 pv=v1.5 与其余 v1.9 不一致） |
| C6 | 降级链终点"代审附证"治理 | 外部 AI 不可用（429/dialog 空回）时走降级链 external→dialog→manual：manual 批准语附验证证据供用户裁决；dialog 盲审缓解 = 审核 prompt 注入 artifacts 摘要（buildArtifactsSummary 截断 2000）；不空转、不伪造 external 审核。 | 15-17-07/17-49-28（manual 终点代审附证）、20-20-48（v2.2-1 摘要注入为真增量）、22-15-02/01-29-26（dialog 兜底） |

### D. 发布与收口（SOP）

| # | 能力 | 判断/动作 | 证据 |
|---|---|---|---|
| D1 | 三副本发布工艺 | 源/安装/工作副本三处同步；每处 node --check；node --test 全量（基线 102）含镜像单测先行；package.json 三处版本统一（node 重写去 BOM）；commit+tag+push，ls-remote 核对远端；rebase 冲突显式记录。 | 01-27-21（commit 8c48026/v3.3.2、95a3918/v3.4.0，ls-remote 双 tag 确认，rebase .gitignore merge）、13-36-43/14-34-33/15-00-11（逐版 commit+tag） |
| D2 | 每步回写 + 证据型 notes + 审核来源自证 | 每步结果写 trace 并置 review；notes 含证据；自评时 reviewedBy=mainagent 显式披露（不伪装 external），并在交付物中留"打回重审/一键收口"选项。 | 01-27-21（3 步 approved reviewedBy=mainagent + 交接档案 §3.4 披露与重审选项）、13-36-43/15-00-11（收口盘点 external/dialog/mainagent 各审哪些步） |
| D3 | 收口规范 | 收口含：审核来源盘点、产物清单与实测记录、done/finalized、唤醒用户最终验收；finalAcceptance 未达成项写"待用户停点"而非谎报 done。 | 13-36-43、14-34-33、15-00-11、01-27-21（finalAcceptance 待办三项：重启实测/声明解析/审计三字段） |
| D4 | 收口自检 + lesson 沉淀 | 按 lesson-schema §3 过自检：新判断/可复现性/审核越权/证据齐全/规划权归属；产出 proposed lesson 条目写 trace 尾部。 | lesson-schema §5 初始条目 L-2026-0903-001..006 即本轮复盘产物 |

### E. 机制层交付能力（feature-capability，2026-09-04 补登记）

> 补登记背景：v1.8→v1.9 考古原只提炼"行为/判断模式"（A-D），漏了 v1.9 自动迭代实施期间**引擎交付的机制级能力**（v3.0~v3.2 发布物）。2026-09-04 复盘（根因 R1-R6：本体无机制层/漏斗无功能向关键词/漏主会话轨迹源/提炼偏 process/收口缺 tag 覆盖度自检）后补入本层。本层记录"引擎里已实现的机制交付物 + 接线状态"；行为层见 A-D。

| # | 交付物能力 | 代码/测试位置 | 状态（实现/接线） | 证据（expr / tag / 评价） |
|---|---|---|---|---|
| E1 | 影子试错沙盒（Shadow Trial Sandbox） | lib/index.js L841-915（/shadow create/merge/destroy/list；git worktree add --detach L874 + git diff/apply 原子合并 L888-890 + remove --force L892/905；SHADOW_MAX=2/5s）+ lib/shadow-gate.js（v3.6.0：L1 内存/Staging 语法预检 + L2 worktree 隔离 + Shadow GC + 回滚基线/非 git 降级） | ✅ 实现（v3.0.0 f9822b3）｜**已接线（v3.6.0 S8/S9）**：complete 钩子 L1/L2 门禁（失败拒绝 complete 回传错误清单）+ 面板 Disable Shadow 开关；**GC 自动化 + 回滚 UI/端点（P2 v3.7.1）**：finalize 自动 GC、iterationBaseCommit 基线记录、POST /steps/rollback + 面板回滚按钮；**GC 定时化 + 回滚状态复位（v3.8.0）**：gcScheduleMs 纯函数 + apply 进程级定时 GC（DSH_RELAY_GC_MS/DSH_RELAY_REPO_PATH）、rollback-state.js 复位策略（approved/executing/review→pending；rejected/pending 保留）、修持久化洞（基线/回滚 5 字段纳入读写白名单）、面板基线/降级/历史状态行；运行实证 expr-2026-09-04_17-45-25 + expr-2026-09-05_01-22-37（E2E 三情形全绿：正常基线/缺基线/非 git 降级） | expr-08-28_01-29-26；外部 AI 01-57-18"超预期"评价；shadow.test.js + shadow-gate.test.js（8 例）+ rollback-state.test.js（7 例），全量 133/133（v3.8.0） |
| E2 | Prompt 自主进化案例库（Prompt-case-library，轻量反思） | lib/index.js：categorizeRejection（L524-530 6 类）/ readCaseLibrary（L533-545）/ buildCaseBlock Top-K≤3（L548-567）/ collectRejectedCases（L570-596，finalize L3150 调用） | ✅ 实现（v3.1.0 8b17ad8）｜**已接线（P1 v3.5.0）**：collect 改为收集"曾被 rejected"（notes 历史，含后 approved），案例库不再恒空、反思闭环生效 | expr-08-28_02-05-00（70/70）；P1 修复见 prompt-evolution.test.js P1 用例 |
| E3 | Swarm 双角色盲审（Security-Auditor + Refactoring-Architect） | lib/swarm-prompts.js（SWARM_ROLES/swarmConsensus/parseRoleReview/swarmEnablePolicy）；lib/index.js L2661-2707（enableSwarm 块）+ 调用点（经 swarmEnablePolicy） | ✅ 实现（v3.2.0 69ea644）｜**已启用（P2 v3.5.0）**：importance:high 默认开 + 面板开关 + 成本提示 + parse 失败 warn | expr-08-29_00-00-00；swarm-review.test.js 11 例（含 P2 策略 3 例） |
| E4 | Architect 突破度三阶评估（Incremental/Structural/Paradigm） | lib/breakthrough-gate.js（breakthroughTypeOf/versionTypeOf/auditBreakthrough）；index.js restructure/plan 两处接线 | ✅ 实现（v3.0.0 时代为协议文本）｜**已加代码门禁（P3 v3.5.0，warn 非阻断）**：连续 ≥2 Incremental 无突破项 → warn + streak 落盘；**Schema 保全（P1 v3.7.0）**：normalizeStep/restructure 透传 breakthrough_type/architect_vision/architect（不再丢失） | breakthrough-gate.test.js 5 例；restructure-schema.test.js 3 例（v3.7.0） |
| E5 | web-gemini 通道栈（Web-Gemini Channel Stack） | dsh-web-gemini-ext（MV3 background/content/bridge-server/bridge-watchdog）+ index.js webGeminiAsk/BRIDGE_BASE；6a244e5 正式化、012de4c 内容防截断、4609006 提速、75ee431 轮询 1s+退避、d8ae9a8 重试、多Tab 均衡、baac351 token 鉴权/回环加固 | ✅ 实现｜接线=通道层常驻（watchdog 自启）；需面板/审核链配置 reviewChannel 使用 | commit 6a244e5/012de4c/75ee431/baac351（v3.3.0）等 |
| E6 | Claude API 通道 | index.js provider=claude（经 harness llm anthropic 路由，CLAUDE_DEFAULT_MODEL/DSH_RELAY_CLAUDE_MODEL）；fa5410a | ✅ 实现｜随 reviewChannel=auto 参与降级链 | commit fa5410a |
| E7 | Trace Replay 离线沙盒 | /replay（027a5e3，v2.2.0）+ 面板独立 Replay 入口（0e0c461，v2.2.1）；纯本地离线还原，不发起外部 AI | ✅ 实现｜面板可触达 | expr-08-27_22-15-02；test/replay.test.js |
| E8 | Webhook 通知中心 | notifyWebhook fire-and-forget（熔断/降级/审核打回三触发点，DSH_RELAY_WEBHOOK_URL）；面板通知中心（Webhook URL 配置+桌面 Notification） | ✅ 实现｜面板可配置 | commit 027a5e3（v2.2.0）；expr-08-27_22-15-02 |
| E9 | reviewChannel 通道选择器 | client.js Step List 头部 select（auto/web-gemini，localStorage 持久化）+ 后端 payload.reviewChannel（4f019cc/f4576f4/b21bdc3，v3.2.2-3.2.4） | ✅ 实现｜面板可配置 | commit v3.2.2-3.2.4 |
| E10 | 通道/审核上下文治理（摘要截断标注 + 超时/aborted 拦截） | buildArtifactsSummary 截断标注（bf19c60 v3.2.5）；dialog/claude 超时 300s + error/aborted chunk 拦截（3875eeb v3.2.6） | ✅ 实现｜防盲审/防截断 | commit bf19c60/3875eeb |
| E11 | 优雅停机 + 宿主 Watchdog 自愈（低摩擦交付支柱） | lib/index.js：/admin/prepare-restart（进程级 prepareRestartState：ask/start 409、cancel 复位、health-check 暴露 preparing）；bin/watchdog.mjs 独立进程（/health-check 探测 miss≥3→prepare→taskkill 树杀→spawn；stormGate 防风暴先判门再记录；DRYRUN 模拟）；client.js 面板琥珀提示灯 | ✅ 实现（v3.9.0 258da98/8b16cfa）｜实机 E2E：prepare→409 拒收→cancel 复位 PASS；DRYRUN 失联模拟暴露并修复计数膨胀 bug | expr-2026-09-05_01-53-03（S1-S5 external approved）；watchdog.test 7 + admin.test 2 |

> 层间关系：A-D 是主 agent"怎么做"的行为能力；E 是"交付了什么"的引擎机制；二者通过"接线状态"衔接——E1/E2/E3 的接线缺口即 V3 gap P0-P3（P1-P3），补接线属 v3.5.0 候选。

## 2. 教训向共性问题（识别并管控，多为引擎/治理缺陷）

1. 叙述式 AutoIteration 声明（iterations/autoDecision 只在 Answer 文本）不落盘 → 引擎按普通任务执行；已修 extractAutoIterDecl（v3.3.2），并要求外部 AI 输出独立严格 JSON 声明块。（01-07-59/13-07-59/02-36-44/01-27-21 四次复现）
2. currentIteration 与"步内 Vn 标签"脱节：一步一版模式下 ci 停在 2 而 V5 已完成，系统仍发模板化"进入 Vn"消息。（14-34-33、15-00-11）
3. batch 原子打回连坐未违规步骤 → 放大单步失败成本；治理可改单步审核。（18-46-49）
4. 先 complete 后补 artifacts（text-complete 与 artifact-complete 脱节）→ 无效打回；应先补实体产物再提审。（18-46-49、15-00-11）
5. 轻审通道（dialog）常"依据 notes 信任放行"而未核产物，与误打回并存 → 审核证据设计需含产物锚点。（13-36-43、18-46-49）
6. 协议/状态自描述字段不可全信：顶层 pv=v1.5 与 v1.9 并存、handoff 页脚固定打"v1.6"、exp md status=done 与 steps open 不一致 → 以源码/git/落盘为准。（01-49-57、21-01-00）
7. autoReview=true 但审方=执行方（mainagent 自评 3 步）是治理风险点：自评需显式披露 + 留重审/外部逐审选项。（01-27-21）
8. tag/功能代号/semver 脱节：v1.5.0 被 force 覆盖、功能代号 v2.5/v2.6 配 tag v2.2.0、版本 1.5.2→2.0.0 单跳跨大版本。（15-42-26、22-15-02、20-20-48）
9. restructure 后审核上下文不同步：步骤 id 复用/标题变更后，dialog 审核者仍按旧"任务记录摘要"审核并指出矛盾。（20-20-48 v2.3-1）
10. 外部规划产物路径漂移（规划 web-relay/ 多文件 vs 实现集中 lib/index.js 单文件）；record frontmatter 状态未与 steps 同步（17-49-28 record pending vs steps done）。（22-15-02、01-29-26、17-49-28）

## 3. Lesson 条目（2026-09-04 已确认：007/011 分别并入 002/003，其余 approved/in-runbook；机器载体 `docs/main-agent-lessons.json`；细粒度格式见 main-agent-lesson-schema-v0.1.md）

| id | title | category | layer | confidence | evidence |
|---|---|---|---|---|---|
| L-2026-0903-007 | 自动迭代先核对 steps.json 顶层落盘声明（叙述式 iterations/autoDecision 常未落盘，勿信 Answer 文本） | repository-knowledge | L3 | high | 01-07-59/13-07-59/02-36-44/01-27-21 |
| L-2026-0903-008 | 被打回先查审核通道缺陷（摘要截断/dialog 无 JSON/批次连坐）再 reopen，非内容问题不改产物 | judgment-heuristic | L3 | high | 13-36-43/18-46-49 |
| L-2026-0903-009 | 一步一版时 currentIteration 计数失真，以步内 Vn 标签+done 状态判断真实进度 | repository-knowledge | L3 | medium | 14-34-33/15-00-11 |
| L-2026-0903-010 | 提审前先落实体产物（artifact_required），text-complete 与 artifact-complete 脱节会招致无效打回 | engineering-action | L2 | high | 18-46-49/15-00-11 |
| L-2026-0903-011 | 版本/tag 命名以仓库 package v3.x 现状续线，拒绝回退 v1.9.x/v2.x 规划命名 | repository-knowledge | L3 | high | 01-27-21/02-36-44 |
| L-2026-0903-012 | 外部 AI 通道失能时代行其职要明示"代构造"并留独立审方兜底，防自审自产 | collaboration-rhythm | L3 | medium | 15-00-11/13-36-43 |
| L-2026-0903-013 | 自评自证（reviewedBy=mainagent）必须显式披露并留打回重审选项 | collaboration-rhythm | L3 | high | 01-27-21 |
| L-2026-0903-014 | artifacts 必须在提审前实挂载（notes 文本不算产物），否则招致连坐打回甚至熔断 | engineering-action | L2 | high | 15-26-14（三连打回→paused 实战）、18-46-49 |
| L-2026-0903-015 | 发布纪律：功能代号/tag/semver 对齐；预发布 vX.Y.Z-iter.N → 正式 tag；避免 tag force 覆盖与跨大版本单跳 | repository-knowledge | L3 | medium | 15-42-26、20-20-48、22-15-02 |
| L-2026-0903-016 | restructure 后保持审核上下文（步骤标题/摘要）与执行列表同步，防审核者按旧标题盲审 | judgment-heuristic | L3 | medium | 20-20-48 |

## 4. 修复建议（本次未执行，落 registry 后跟踪）

- R1 引擎：AutoIteration 顶层字段与步级 Vn 标签一致性校验（教训 2）。
- R2 引擎：restructure/声明缺失时主 agent 侧提供"去重/还原"工具化入口（现靠脚本 + 人工纪律）。
- R3 治理：autoReview=true 时审方≠执行方（排除 mainagent 自审）或在面板强制提示。

## 5. 配套与同步

- Registry：`docs/capabilities/registry.yaml` 已登记 `main-agent-auto-iteration-execution`（本清单为 source）。
- README：`docs/capabilities/README.md` 已加入本文件索引。
- 本清单证据索引（三批考古报告）留存于会话工作区 `_analysis/` 考古产物；更新本文档时同步 registry lastVerified 与 lesson-schema 状态。

## 附：证据样本地图（考古范围 23 条）

| 阶段 | stamp | 角色 / 里程碑 |
|---|---|---|
| 早期 v1.8 | 2026-08-26_13-16-32 | pv1.8 纯分析：V1.8.1 边界 5 候选 + review:false 自动豁免全流程（3 步 0 审核） |
| 早期 v1.9 | 2026-08-26_14-48-26 | AutoIteration 引擎首落地：降级链+解析/熔断/版间门 6 处实现，8 组回归 PASS（commit 11481a2） |
| 早期 v1.9 | 2026-08-26_15-17-07 | step-value 0.2→0.3：4478 turns 真实 E2E、三方案实测推翻 <5s 目标、manual 代审治理 |
| 早期 v1.9 | 2026-08-26_17-49-28 | callDialogModel 根因修复（1.3.1）+ mock 429 合规评审；声明 3 轮只跑 1 遍（record/steps 状态不一致负例） |
| 早期 v1.9 | 2026-08-27_15-26-14 | **熔断实战**：Step3 三连打回→paused→resume→approved（v1.9 熔断器闭环实测；根因=产物只写 notes 未挂 artifacts） |
| 早期 v1.9 | 2026-08-27_15-42-26 | 三轮真自动迭代 12 步全 approved：artifacts 挂载+声明持久化自举修复（v1.4.0/1.5.0），tag force 覆盖教训 |
| 早期 v1.9 | 2026-08-27_20-20-48 | v2.0.0：**4/6 重造审计止损**+代规划 restructure+dialog 盲审缓解（artifacts 摘要注入 2000 字符） |
| 早期 v1.9 | 2026-08-27_22-15-02 | v2.2.0：Trace Replay+Webhook，探路设计文档先行；功能代号 vs tag 脱节 |
| 早期 v1.9 | 2026-08-28_01-29-26 | v3.0.0：影子试错沙盒（git worktree 真实集成闭环，61/61） |
| stock-ai | 2026-08-31_12-54-05 | 问答对照：dialog 通道问可行性未唤醒执行（无 steps.json） |
| stock-ai | 2026-08-31_13-08-27 | manual 通道被唤醒，信息类判定直接收口（无 steps.json） |
| stock-ai | 2026-08-31_13-36-43 | **5 版 20 步全 approved**：版间门×4、tag v1.9-v1..v5、2 次审核通道误打回 reopen（截断/v3.3-1、dialog 无 JSON） |
| stock-ai | 2026-08-31_13-40-00 | 重叠任务仲裁：主动 stop 让路（stopReason/stoppedAt 留痕） |
| stock-ai | 2026-08-31_14-34-33 | 一步一版范式跃迁：三模块+回测数字自证（年化 24.42%/夏普 1.99）；ci=2 vs done 失真 |
| stock-ai | 2026-08-31_15-00-11 | 外部 AI 失能时代构造 V1/V2/V3 保循环 + 源码落地（tag dsh-stock-ai-v1..v3） |
| stock-ai | 2026-08-31_18-46-49 | 纯方案 opt5-ext：batch 连坐→改单步审核收敛；先 complete 后补 artifact 教训 |
| stock-ai | 2026-09-01_21-01-00 | 说明性收口：4 步验证悬挂 pending 未执行（状态双写不一致负例） |
| 审计期 | 2026-09-02_01-07-59 | 探路汇总 + 重复步骤检测（1-6 两遍→建议去重）；叙述式声明未落盘（首例） |
| 审计期 | 2026-09-02_01-33-59 | 严格 JSON 声明落盘正例（iterations=2/autoDecision=true 顶层生效） |
| 审计期 | 2026-09-02_02-36-44 | v2.0-spec 起草：外部 AI v2.0.0 tag 与仓库 v3.x 冲突（重造负例）；autoDecision=false 下仍自动执行 |
| 审计期 | 2026-09-02_13-07-59 | V1.7/1.8/1.9"3 次迭代"压成 3 步从未执行（声明未落盘+宿主未重启）；主会话降级链审计 |
| 旗舰 | 2026-09-03_01-27-21 | **行号审计+声明补丁+评审包+双发布**：v3.3.2（8c48026）+v3.4.0（95a3918），102/102，ls-remote 远端核对 |
| 旗舰 | 2026-09-03_01-49-57 | 独立外部评审 expr（V1 APPROVED + 严格 JSON 声明 + V2 3 步列表）；顶层 pv=v1.5 自描述不一致 |
