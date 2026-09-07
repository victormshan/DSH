# dsh-web-relay 三方协作回合走查（THREE-PARTY-WALKTHROUGH）

> 版本：v4.9.2（2026-09-07，以真实案例 expr-2026-09-06_16-32-52 编写——v4.9 从排位到发布全流程）
> 用途：新会话 / 外部 AI / 新协作者快速理解「一次完整三方协作」如何落地（端点、文件、状态机、机制）。

## 0. 一句话

**用户定调 → 外部 AI 规划（json:agent-action + 机器可读 steps）→ 宿主建 expr 状态机 → 主 agent 带证据执行（start→complete）→ 五级通道审核（approved/rejected）→ 依赖门控循环 → finalize 收口 → 版本发布 + 能力沉淀。**

## 1. 三方主体与载体

| 主体 | 职责 | 载体 |
|---|---|---|
| [用户] | 定调、验收、拍板 | 面板发起 /ask 或直接对话 |
| [外部 AI] | 规划（排位/Step List）、审核（approved/rejected + 意见）、仲裁 | /ask（gemini-free/web/claude/manual）|
| [主 agent] | 执行（读改文件/跑命令/派 Claude）、提审、收口、发布 | harness 会话 + 全工具 |

三方落盘三件套（workspace 下）：
- 试验记录：`web-relay/experiments/dsh-web-relay-<stamp>.md`（frontmatter：id/channel/providerLabel/fallbackReason/created）
- 三方轨迹：`web-relay/traces/expr-<stamp>.md`（`## [用户|主 agent|外部AI|system] <ISO时间>` 正序追加）
- 状态机：`web-relay/experiments/expr-<stamp>.steps.json`

## 2. 七回合走查（真实片段：expr-2026-09-06_16-32-52）

### 回合 1 — 用户定调
请求：`POST /dsh-web-relay/ask { provider:'gemini-free', workspacePath, protocolVersion:'v1.9', prompt:'<目标+约束>' }`
宿主动作：写记录 md（含 prompt）→ trace 追加 `[用户]` 条目。
真实 prompt 约束示例（v4.9）：`① lib 改动攒批一次重启（watchdog 自愈）② 混合架构用于实现与审方 ③ 重大语义修订按验收协议跑 understand 测试 ④ 全量 188 基线保持 ⑤ ≤2200 字：排位理由 + Step List（id v9_N ≤5 步，含 detail/acceptance/importance/review/depends_on）`

### 回合 2 — 外部 AI 规划
应答：排位理由 + `json:agent-action`：
```json
[
  { "action": "plan", "steps": [
      { "id": "v9_1", "title": "…", "importance": "high", "review": true,
        "acceptance": "…", "depends_on": [] },
      { "id": "v9_2", "…", "depends_on": ["v9_1"] }
  ]},
  { "action": "wake_agent", "reason": "已排位…请主 agent 推进" }
]
```
宿主动作：解析 plan → 写 steps.json（步全 `pending`、`autoReview:true`、`iterations/currentIteration`）→ needsAgent → `wakeMainAgent`（sessionId 注入，queue 模式）。
外部 AI 约束（协议）：不得重复输出同份 Step List；机器可读 steps 只在 json:agent-action 内。

### 回合 3 — 主 agent 执行（每步闭环）
1. `POST /steps/update {action:'start', stepId}` → `pending → executing`，`activeSteps + [id]`
2. 执行（可含混合架构：写 `D:\cc-tasks\queue\<id>.task.json` → Claude Code 实现 → 校验合入）
3. `POST /steps/update {action:'complete', stepId, comment:'<证据>', artifacts:[…]}` →
   - `executing → review`；notes 追加 `{role:'mainagent', action:'complete', text:证据}`
   - 源码类 artifacts 触发 L1/L2 影子门禁（语法预检 / worktree 校验），非 git 降级 `shadow-degraded`
   - review:false / importance=low → autoPass（complete 即 approved，reviewedBy=mainagent）
   - trace 追加 `[主 agent]`

### 回合 4 — 自动审核（审核链 v2.0）
`POST /steps/auto-review {exprId, stepId}`（或 `batchStepIds` 批量）：
- importance=high → **Swarm 双角色盲审**（Security-Auditor + Refactoring-Architect，双 Approve 才过）
- 其他 → 五级链：`external(Gemini API) → web-gemini → claude-code → dialog → manual`
- 结果：approved → reviewedBy 记录 + `wakeAfterApproved`；rejected → 意见入 notes + reviewedBy 清空 + `wakeAfterRejected`
- 批量：受控并发（默认 2）+ **原子打回**（任一 rejected → 全批退回）
- 熔断：连续打回 ≥3 → `status=paused`（resume 后继续，可换单角色/仲裁）

### 回合 5-6 — 依赖门控循环
- approved 后 `wakeAfterApproved` 按拓扑：`depends_on` 全 approved 的 pending 步 → 「就绪可执行」（可并行 → subagent）
- 逐步推进至全部 approved；被打回步按拒收意见 reopen→start→complete 重提

### 回合 7 — 收口与发布
1. `POST /steps/finalize` → 校验全 approved → `status:done + finalized:true` + `finalSummary`（审核来源汇总）
2. 主 agent 追加 trace `[主 agent]` 收口结论
3. 发布：package bump + 全量测试 + 三副本同步 + git commit/tag/push
4. 能力沉淀：lessons（事故复盘）/ registry（能力索引）/ docs / dist 能力包导出

## 3. 关键机制速查

| 机制 | 作用 | 端点/文件 |
|---|---|---|
| json:agent-action + 机器可读 steps | 外部 AI 规划 → 可执行状态机 | /ask、steps.json |
| 依赖门控 | depends_on 全 approved 才执行 | readySteps（宿主）|
| importance 分工 | low 免审 / medium 批审 / high 严格审 | steps 字段 |
| 原子打回 | 批量任一拒 → 全批退回 | /steps/auto-review batch |
| 五级审核链 | external→web→claude-code→dialog→manual | reviewOneStep/obtainReviewVerdict |
| Swarm 盲审 | 双角色共识，high 增强 | enableSwarm |
| 熔断 | 连续打回 ≥3 → paused | stepUpdateHandler |
| 审计 | reviewedBy/providerLabel/fallbackReason/channel | record frontmatter + steps notes |
| 轨迹 | 全程回放 | /replay、traces/*.md |
| 混合架构 | Claude kind=implement/review/understand | D:\cc-tasks |
| 无介入续跑 | 重启/心跳双保险自动唤醒 | bootResumeScan / heartbeat |

## 4. 常见真实坑（本流程实测）

1. **start 受依赖门控**：依赖未 approved 时 start 返回 400——complete 不查依赖，代码完成可先 complete 置 review（如 hb/lx 流程），审核通过后再走拓扑。
2. **review:false/low**：complete 即 approved（reviewedBy=mainagent），auto-review 会 400（不在 review 状态）——无需再审。
3. **Swarm 空意见拒**：对无代码验证收口步，Refactoring-Architect 可能空 findings 打回（结构性）——换 enableSwarm=false 单角色 external 审，或走外部 AI 仲裁（/ask）。
4. **审核上下文截断**（lesson 035）：三方轨迹时间正序、最新在末尾——审核/cc 派发上下文已 tailClip 尾部优先；手工贴证据勿头截。
5. **complete 证据要带 comment**：审核方看 notes 与轨迹判断执行证据，缺证据易被打回。

## 5. 快速自检（走查后核对）

- [ ] 记录 md frontmatter 有 id/channel/providerLabel/fallbackReason
- [ ] steps.json 每步有 notes（start/complete/审核条目）
- [ ] trace 有 [用户]→[外部AI]→[主 agent] 完整链
- [ ] 全部 approved 后 finalize 生成 finalSummary
- [ ] 打回/熔断路径留痕（rejected 意见 / paused stopReason）
