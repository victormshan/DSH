# dsh-web-relay V3.0~V3.2 路线图：当时方案 vs 当前实现 vs 能力持久化差距分析

> 生成：2026-09-04
> 基线：2026-08-28 主会话路线图讨论（原始上下文见 `experiments/v3-roadmap-context-2026-08-28.md`）
> 当前版本：dsh-web-relay 3.4.0（部署目录实测）
> 性质：复盘分析文档，非协议规范

---

## 1. 起始方案（2026-08-28 讨论确定）

外部 AI 提议 V3.0~V3.2 路线图，主 agent 评估后确定落地形态：

| 方向 | 外部 AI 原始提议 | 主 agent 确定方案 | 落地版本 |
|---|---|---|---|
| **P0 / V3.0** | 基于语义沙盒的无感知影子试错 | ① `POST /dsh-web-relay/shadow` 端点（create/merge/destroy）② sandboxPolicy 支持 shadow 模式（write_file/run_cmd 拦截重定向）③ 面板集成（可选）；git worktree 隔离 + diff 原子合并 | v3.0.0（f9822b3）✅ |
| **P1 / V3.1** | **基于 DSPy**/Replay 的 Prompt 自主进化 | **否决 DSPy**（重框架：LLM 训练循环+依赖）→ 轻量方案：打回原因 6 类聚类 + Top-K≤3 案例注入 + 幂等案例库 | v3.1.0（8b17ad8）✅ |
| **P2 / V3.2** | 动态 Agent 团队与角色元编排 | 裁剪为轻量 Swarm：Security-Auditor + Refactoring-Architect 双角色盲审（双 Approve 才通过），不做"动态团队/元编排" | v3.2.0（69ea644）✅ |
| 附加 | Architect Pioneer 突破设计师 | 突破度三阶评估（Incremental/Structural/Paradigm）+ 5 段式探路契约 + 反模式预警 | 说明书 4.20 沉淀 ✅（协议层） |

---

## 2. 当前实现 vs 当时方案（实现层差距）

### 2.1 P0 影子沙盒 —— 完整落地，无差距

- `/shadow` 端点 + git worktree add --detach 隔离 + git diff/git apply 原子合并 + destroy 零污染断言 + 并发 ≤2/超时 5s/Diff ≤5MB 约束
- 说明书 4.20 有真实集成闭环实测（275ms/2.1MB、主工作区零污染）
- **结论：与当时方案一致，无差距**；影子沙盒仍是自动迭代的安全执行底座

### 2.2 P1 轻量聚类反思 —— 代码完整，但有一个实践缺口

已实现（lib/index.js）：
- `categorizeRejection`：6 类关键词聚类（缺产物/未达验收/证据不足/路径/语法/其他）
- `collectRejectedCases`：finalize 收口时扫描 rejected 步骤，幂等追加案例库
- `buildCaseBlock`：主题匹配 + Top-K≤3 注入审核 Prompt
- `test/prompt-evolution.test.js` 全绿

**实践缺口**：
- `experiments/prompt-case-library.md` **至今从未生成**——`collectRejectedCases` 只在 finalize 时收集**仍处于 rejected** 的步骤，而历史任务中所有被打回步骤最终都经 reopen→approved 闭环，收口时没有 rejected 残留 → 案例库恒为空 → `buildCaseBlock` 永远返回空 → **反思学习实际从未生效过**（代码在，闭环没触发）

### 2.3 P2 Swarm 双角色盲审 —— 实现可用，但从未真实启用

- `lib/swarm-prompts.js`（Security-Auditor/Refactoring-Architect 双角色 Prompt + 共识矩阵 + parseRoleReview）
- `reviewOneStep` enableSwarm 开关 + autoReviewHandler 透传 payload.enableSwarm
- `test/swarm-review.test.js` 8 用例（含镜像路径越界拦截）
- **实践缺口**：所有真实审核（含 8/28 之后大量任务）均未带 `enableSwarm:true`，Swarm 只活在测试里；改进方案 P2-6 也指出"双角色成本翻倍无提示、parseRoleReview 解析失败静默丢数据"

### 2.4 Architect Pioneer —— 协议层有，代码层无强制门禁

- 突破度三阶评估 / 5 段式探路契约 / 反模式预警：**作为协议文本**写入 Skill 与说明书 4.20
- **实践缺口**："每 2 个 Incremental 后强制下一版含 Structural/Paradigm"、"Planning 审批前校验突破度"等**无代码层校验**——全靠外部 AI 自觉遵循

---

## 3. 主 agent 能力持久化差距（核心）

### 3.1 问题本质：V3.x 时代的能力没有制度化

- **2026-08-26 ~ 09-01**（v1.9→v3.x 自动迭代活跃期）：主 agent 展示大量能力（版间门、证据型 complete、通道审计、自举修复、代构造 Step List、误打回抗辩…），但**全部只存在于各会话上下文**，换会话即丢
- **证据**：2026-09-02 的 01-07-59 / 02-36-44 / 13-07-59 **三次复现**"叙述式 AutoIteration 声明（iterations/autoDecision 只在 Answer 文本）不落盘"——而这个问题在 8/27 已踩过并修复过（extractAutoIterDecl 补丁），**换会话后能力没有持久化，又犯**
- **教训文档原话**："叙述式 AutoIteration 声明不落盘 → 引擎按普通任务执行；已修 extractAutoIterDecl（v3.3.2），并要求外部 AI 输出独立严格 JSON 声明块。（01-07-59/13-07-59/02-36-44/01-27-21 四次复现）"

### 3.2 9/2-9/3 补课：能力持久化文档体系（已补但晚）

| 文档 | 内容 | 弥补的差距 |
|---|---|---|
| `main-agent-auto-iteration-capabilities.md` | 22 条试验考古 → A/B/C/D 四组能力清单（A1-A5 门控、B1-B10 执行、C1-C6 审计、D1-D4 发布） | 把 8/26-9/3 反复展示的判断/动作模式固化为可检索清单 |
| `main-agent-runbook-v0.1.md` | SOP/纪律：收口步骤、证据型 complete、通道审计 | 执行纪律制度化 |
| `main-agent-lesson-schema-v0.1.md` | 细粒度 lesson（L-2026-0903-001..007） | 教训可复现、可自检 |
| `capabilities/registry.yaml` | 能力登记 | 机器可读 |

### 3.3 差距结论

- **8/28 当时**：P0/P1/P2 决策和"轻量化否决 DSPy"等判断**只存在会话里**（本还原文档即证据——当时没有任何落盘记录这条决策链）
- **9/3 之后**：能力文档补齐，但**与实现层缺口不同步**（案例库未生成、Swarm 未启用、Architect 无门禁——能力清单只"记录"了主 agent 怎么做事，没"修正"引擎本身）

---

## 4. 这些基础如何支撑"版本自动迭代"（闭环关系）

```
P0 影子沙盒    = 自动迭代的安全执行底座（打回零污染、可试错）
P1 轻量反思    = 自动迭代的质量反馈环（打回原因反哺审核 Prompt）—— 但案例库从未生成，环未闭合
P2 Swarm       = 自动迭代的审核升级（importance:high 双角色）—— 但从未真实启用
能力持久化文档  = 自动迭代的主 agent 记忆底座（换会话不丢能力）—— 9/3 才补
```

---

## 5. 未闭合项与建议

| # | 未闭合项 | 现状 | 建议 |
|---|---|---|---|
| 1 | P1 案例库从未生成 | collectRejectedCases 只收 finalize 时仍 rejected 的步骤 | 改为也收集"曾被 rejected 后 approved"的步骤（取 rejected note 追加），让反思闭环真正生效 |
| 2 | P2 Swarm 从未真实启用 | enableSwarm 默认关，无 UI/自动触发 | 对 importance:high 步骤默认启用或加 UI 开关 + 成本提示（改进方案 P2-6） |
| 3 | Architect 突破度无代码门禁 | 仅协议文本 | 在 restructure/plan 校验处解析 breakthrough_type，连续 Incremental 超限时提示 |
| 4 | 能力文档与引擎缺口不同步 | 文档 9/3 才补，引擎未修正 | 把第 1-3 项修复纳入下一个自动迭代版本（v3.5.0 候选） |

---

## 6. 参考文件

- 原始上下文：`experiments/v3-roadmap-context-2026-08-28.md`
- 当时实施：expr-2026-08-28_01-29-26（V3.0）、expr-2026-08-28_02-05-00（V3.1）、expr-2026-08-29_00-00-00（V3.2）
- 外部 AI 评价：traces/expr-2026-08-28_01-57-18.md
- 能力持久化：docs/main-agent-auto-iteration-capabilities.md、main-agent-runbook-v0.1.md、main-agent-lesson-schema-v0.1.md
- 设计文档：experiments/v3.1-evolution-design.md（仅工作区，未入 git）
