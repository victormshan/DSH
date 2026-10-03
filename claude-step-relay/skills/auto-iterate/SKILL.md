---
name: auto-iterate
description: Autonomously evolve a target repo through N versions with an independent review gate, a 3-strike circuit breaker, and a full git audit trail (commit + tag per approved round), driven by /loop. Use when the user asks to auto-iterate / 自动迭代 / 自动演进 a project through multiple versions with minimal supervision, referencing dsh-web-relay's v1.9 AutoIteration protocol. Do not use for a single one-off change — this is for a supervised-but-unattended multi-round loop with a human final acceptance step at the end.
---

# Auto-Iterate

三方协议的两方版：**主 agent**（本会话，实施）／**审核者**（独立 fork 的评审 agent，不共享实施推理）／**用户**（定目标、定验收标准、终态验收）。

两套状态各管各的，不要混：
- **`state.mjs`**（用户级技能目录里的脚本；状态存在 `~/.claude/auto-iterate/state/<task-id>.json`，可用 `AUTO_ITERATE_STATE_DIR` 改位置——**不放进被迭代的仓库**，否则会弄脏 `git status` 并被每版的 `git add -A` 一起提交）：只管 claude-step-relay 的 Step schema 里没有的字段——`iterations` 上限、`currentIteration`、`rejectStreak` 熔断计数——是版间门/熔断判定的唯一依据，从不做内容判断。
- **claude-step-relay（`step_relay_*` MCP 工具）**：任务的可见记录——Step List（一版一个 Step）+ 完整轨迹。**这是默认必走的步骤，不是可选项**——每一轮都要用它记账，这样任何自动迭代任务都能在 `step_relay_list`/看板里看到，不需要事后补记。

两边用同一个 `exprId` 关联，存在 `state.mjs` 里的 `exprId` 字段。

**前置条件**：本技能是用户级技能（`~/.claude/skills/auto-iterate/`），任何项目里都能用；
它依赖 claude-step-relay MCP server 已接入（`step_relay_*` 工具可用）。
源码与版本管理在 claude-step-relay 仓库的 `skills/auto-iterate/`，更新后执行
`npm run install-skill` 复制到 `~/.claude/skills/`。

## 启动（`/auto-iterate init ...`）

```
node ~/.claude/skills/auto-iterate/state.mjs init \
  --id <task-id> --goal "<一句话目标>" \
  --acceptance "<最终验收标准，越具体越好>" \
  --iterations <1-10> --repo "<目标仓库绝对路径>"
```

启动前检查：`git -C <repo> status --short` 必须干净（无未提交改动）。如果不干净，先如实告知用户，让其决定是先提交/搁置，还是把已有改动当作 v0 基线一并提交——**不要自作主张吞掉用户未提交的工作**。

然后立刻建 claude-step-relay 任务并关联：

1. `step_relay_start`：`title` = 目标一句话，`prompt` = 目标 + "\n验收标准：" + finalAcceptance。记下返回的 `exprId`。
2. `node ~/.claude/skills/auto-iterate/state.mjs link --id <task-id> --exprId <exprId>`。
3. `step_relay_set_steps`：`exprId` 同上，`steps` = 长度等于 `iterations` 的数组，`id` 从 1 到 N，`title` 为 `"V{n}"`，`acceptance` 填这一版对应的具体验收标准（如果 finalAcceptance 本身按版拆过，就分别摘出来；拆不开就每步都填完整 finalAcceptance）。

初始化成功后立即进入下面的「每一轮」流程，本轮 iteration = 1。

## 每一轮（无论是刚 init 还是被 `/auto-iterate <task-id>` 唤醒）

1. `node ~/.claude/skills/auto-iterate/state.mjs show --id <task-id>` 读状态（拿到 `exprId`、`currentIteration`、`goal`、`finalAcceptance`）。若 `status != running`，说明已经 `done` 或 `paused`：把 `stopReason`／最终验收提示原样讲给用户，然后 `ScheduleWakeup(stop: true)`，本轮结束，不再继续。

2. **标记开始**：`step_relay_update_step`（`exprId`，`stepId=currentIteration`，`status="executing"`，`note="实施中"`）——note 是看板上唯一能区分"实施"和"审核"这两个阶段的地方，务必写，且之后每次阶段切换都要更新它。

3. **实施**：根据 `goal`、`finalAcceptance`，以及上一轮的审核意见（如果是重试同一版，从 `history` 或 step-relay 轨迹里取），直接在 `repo` 里改代码。改动范围只对应当前这一版要解决的问题，不要顺手做本轮目标之外的事。

4. **验证**：能跑测试就跑（如 `npm test`）。测试都不过，不必等审核，直接按测试失败信息修，修不动再进入第5步走 `rejected` 路径（把测试失败当审核意见的一种）。

5. **审核**（关键：审核者必须是独立视角，不能是本会话直接自我认定"我觉得没问题"）：
   - 起 Agent **之前**先 `step_relay_update_step`（`status="executing"` 不变，`note="审核中（独立 agent 评审 diff）"`）——这一步耗时通常最长（几十秒到几分钟），是用户最想在看板上实时看到的状态，不要漏。
   - 用 `Agent` 工具起一个**全新**（非 fork）的 `general-purpose` agent，只喂它：本轮 diff（`git -C <repo> diff`）、`finalAcceptance`、"只挑毛病，不要给出修复建议之外的重写，不要打分"。
   - agent 不可用/报错/明显跑偏 → 降级：本会话自己用 `/code-review`（medium 档）审这份 diff，`channel` 记 `self-review-fallback`，同样先把 note 改成 `"审核中（自审降级）"` 再审。
   - 连自审都做不了（比如没有可用 diff）→ `step_relay_update_step`（`stepId=currentIteration`，`status="blocked"`，`note="审核者不可用"`），`node ~/.claude/skills/auto-iterate/state.mjs pause --id <task-id> --reason "reviewer unavailable"`，唤醒用户，`ScheduleWakeup(stop: true)`。

6. **记账**（先写 claude-step-relay 的可见记录，再喂状态机做版间门/熔断判定——状态机决定下一步，不要自己猜）：
   - 审核判定为「无阻断性问题」→
     ```
     git -C <repo> add -A && git -C <repo> commit -m "<本版做了什么>"
     git -C <repo> tag auto-iterate/<task-id>/v<currentIteration>
     ```
     `step_relay_append_trace`（role="外部审核"，text=审核者完整结论原文）；
     `step_relay_update_step`（`stepId=currentIteration`，`status="done"`，`note="commit <sha> · tag <tag>"`）；
     ```
     node ~/.claude/skills/auto-iterate/state.mjs record --id <task-id> --verdict approved --findings 0 \
       --channel review --commit "$(git -C <repo> rev-parse HEAD)" \
       --tag "auto-iterate/<task-id>/v<currentIteration>"
     ```
   - 审核判定为「有问题」→ **不 commit**，先
     `step_relay_append_trace`（role="外部审核"，text=打回意见完整原文）；
     `step_relay_update_step`（`stepId=currentIteration`，`status="executing"` 保持不变，`note="第 N 次打回：<一句话原因>"`，N 从 state.mjs 的 `rejectStreak+1` 算）；再
     ```
     node ~/.claude/skills/auto-iterate/state.mjs record --id <task-id> --verdict rejected --findings <N> --channel review
     ```

7. 看 `record` 返回的 `action` 决定下一步：
   - `start_round` → 本轮已推进到下一版（或原地重试），继续第 2 步标记下一版 `executing`。
   - `finalize` → 状态已是 `done`。`step_relay_finalize`（`exprId`，`summary`=N 版分别做了什么 + tag 列表 + 提醒需要人工端到端验收）。再用一段话向用户汇报同样的内容，并明确提醒**这是自动化的终点，不是发布的终点**——请用户自己跑一遍端到端验证再决定是否发布/合并。`ScheduleWakeup(stop: true)`。
   - `retry_same_round` → 把审核意见当新的实施依据，回到第 3 步，仍是当前这一版，不推进 iteration、不 commit、Step 状态仍是 `executing`。
   - `pause` → 熔断触发。`step_relay_update_step`（`stepId=currentIteration`，`status="blocked"`，`note=stopReason`）。把 `stopReason` 和最近 3 次审核意见完整讲给用户，说明卡在哪、大概率是什么原因（比如目标定义模糊、验收标准和实际代码冲突），`ScheduleWakeup(stop: true)`。

## /loop 触发方式

第一次：用户直接说 `/auto-iterate init ...`（或等价自然语言），本会话跑完第一轮后，用 `ScheduleWakeup` 安排下一次：
- `prompt`: `/auto-iterate <task-id>`
- `delaySeconds`：刚推进了一版且没有耗时操作（比如测试很快）→ 120-300s；本轮涉及慢操作（构建、外部 agent 审核较久）→ 按实际耗时估；`status` 已经是 `done`/`paused` → 不再调用 ScheduleWakeup，直接 `stop:true`。
- `noop`: 只有当这一 tick 完全没有推进（比如在等审核 agent 重试）时才 `true`；只要 commit/tag/pause/done 任一发生，都是 `false`。

## 硬性约束（不可绕过）

- 从不在没有 approved 判定的情况下 commit+tag。
- 从不无限重试同一版——`rejectStreak>=3` 一定 `pause`，一定唤醒用户。
- 从不让"审核者不可用"变成"跳过审核"——只能降级为标注过的自审，或者直接 pause。
- `done` 之后从不擅自 push / 发布 / 合并到其它分支——终态验收权在用户，不在状态机。
- 从不跳过 `step_relay_*` 记账——这是默认行为，不是"如果想要可见性再做"；漏记会导致这个任务在 `step_relay_list`/看板里完全不存在，用户事后也无从查起。
