---
name: auto-iterate
description: Autonomously evolve a target repo through N versions under the dsh-web-relay three-party protocol — Claude implements, an external AI from another vendor (Gemini API / OpenAI-compatible e.g. DeepSeek / web-gemini via the dsh-web-relay bridge) reviews each version through a script-generated prompt, and the state machine itself verifies the review record (reviewer strength gate, reviewed tree == committed tree), with a 3-strike circuit breaker and commit+tag per approved version, driven by /loop. Use when the user asks to auto-iterate / 自动迭代 / 自动演进 a project through multiple versions with minimal supervision. Do not use for a single one-off change.
---

# Auto-Iterate

对齐 dsh-web-relay 的三方协议：**主 agent**（本会话，Claude，实施）／**外部审核者**（另一家厂商的模型：Gemini API、OpenAI 兼容/DeepSeek，或经 dsh-web-relay bridge 的网页版 Gemini；审核提示由脚本模板生成，结论由状态机直接读取校验）／**用户**（定目标与验收标准、外部审核不可用时人工把关、终态验收）。

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
  --iterations <1-10> --repo "<目标仓库绝对路径>" \
  [--min-reviewer web-gemini]   # 审核门槛：external-api(4) > web-gemini(3) > claude-subagent(2) > self-review(1)；manual(5)=用户亲审
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

5. **审核**（三方协议的外部审核者——由脚本发起，实施方不写审核提示、不转述结论）：
   - 先 `step_relay_update_step`（`status="executing"` 不变，`note="审核中（外部 AI）"`）。外部 AI 走 web-gemini 时单次约 20–90 秒，是用户最想在看板上看到的状态。
   - 跑测试时把关键结果写进一个证据文件（可选），然后：
     ```
     node ~/.claude/skills/auto-iterate/review.mjs run --id <task-id> [--evidence <证据文件>]
     ```
     脚本会 `git add -A` 暂存本版全部改动、记下暂存区 tree、按固定模板生成审核提示（目标、本版验收、此前打回意见、完整 diff），交给**外部模型**（按顺序尝试 Gemini API → OpenAI 兼容/DeepSeek → web-gemini 网页通道），解析首行 VERDICT，写出审核记录并自动追加到 step-relay 轨迹。输出一行 JSON：`{verdict, channel, provider, strength, record}`。
   - **审核期间不要再改工作区**——记录绑定的是暂存区 tree，之后提交的内容必须与之一字不差，否则状态机拒收。
   - 退出码 3（没有任何外部 AI 可用）或反复失败 → 按门槛处理：
     - 门槛是默认的 `web-gemini` 或更高：**不要降级自审**。`step_relay_update_step`（`status="blocked"`，`note="外部审核不可用，等人"`），`state.mjs pause --id <task-id> --reason "external reviewer unavailable"`，告诉用户需要启动 bridge/扩展或配置 API key，`ScheduleWakeup(stop: true)`。
     - 用户在 init 时显式设了 `--min-reviewer claude-subagent`：用 `Agent` 起一个**全新**的 `general-purpose` agent，只给它 `git -C <repo> diff --cached` 与验收标准，要求首行 `VERDICT: …`；把它的原文写入文件后提交：`review.mjs submit --id <task-id> --channel claude-subagent --file <文件>`。
   - 人工审核（用户亲自给出结论）：把用户原话写入文件，`review.mjs submit --channel manual --file <文件>`。**只有用户明确给出结论时才能用 manual**，不得代填。

6. **记账**（审核记录已由 review.mjs 写入轨迹；这里只做提交与状态机判定——状态机读记录决定下一步，不要自己猜）：
   - verdict 为 approved →
     ```
     git -C <repo> commit -m "<本版做了什么>"          # 直接提交暂存区，不要再 add 别的东西
     git -C <repo> tag auto-iterate/<task-id>/v<currentIteration>
     node ~/.claude/skills/auto-iterate/state.mjs record --id <task-id> --review <record 路径> \
       --commit "$(git -C <repo> rev-parse HEAD)" --tag "auto-iterate/<task-id>/v<currentIteration>"
     ```
     状态机会核对：记录属于本版且未用过、通道强度够、提交 tree 与被审 tree 一致、父提交是审核时的 HEAD、tag 指向该提交——任一不符直接报错，**不要绕过，按报错修正**（例如审核后改过文件，就重新审核）。
     通过后 `step_relay_update_step`（`status="done"`，`note="commit <sha> · tag <tag> · 审核 <channel>"`）。
   - verdict 为 rejected → **不 commit**：
     ```
     node ~/.claude/skills/auto-iterate/state.mjs record --id <task-id> --review <record 路径>
     ```
     `step_relay_update_step`（`status="executing"`，`note="第 N 次打回（<channel>）：<一句话原因>"`）。可以 `git -C <repo> reset -q` 取消暂存后继续修改。

7. 看 `record` 返回的 `action` 决定下一步：
   - `start_round` → 本轮已推进到下一版（或原地重试），继续第 2 步标记下一版 `executing`。
   - `finalize` → 状态已是 `done`。`step_relay_finalize`（`exprId`，`summary`=N 版分别做了什么 + tag 列表 + 提醒需要人工端到端验收）。再用一段话向用户汇报同样的内容，并明确提醒**这是自动化的终点，不是发布的终点**——请用户自己跑一遍端到端验证再决定是否发布/合并。`ScheduleWakeup(stop: true)`。
   - `retry_same_round` → 把审核意见当新的实施依据，回到第 3 步，仍是当前这一版，不推进 iteration、不 commit、Step 状态仍是 `executing`。
   - `pause` → 熔断触发，或审核通道强度不足（`stopReason` 会写明）。`step_relay_update_step`（`stepId=currentIteration`，`status="blocked"`，`note=stopReason`）。把 `stopReason` 和最近 3 次审核意见完整讲给用户，说明卡在哪、大概率是什么原因（比如目标定义模糊、验收标准和实际代码冲突），`ScheduleWakeup(stop: true)`。

## /loop 触发方式

第一次：用户直接说 `/auto-iterate init ...`（或等价自然语言），本会话跑完第一轮后，用 `ScheduleWakeup` 安排下一次：
- `prompt`: `/auto-iterate <task-id>`
- `delaySeconds`：刚推进了一版且没有耗时操作（比如测试很快）→ 120-300s；本轮涉及慢操作（构建、外部 agent 审核较久）→ 按实际耗时估；`status` 已经是 `done`/`paused` → 不再调用 ScheduleWakeup，直接 `stop:true`。
- `noop`: 只有当这一 tick 完全没有推进（比如在等审核 agent 重试）时才 `true`；只要 commit/tag/pause/done 任一发生，都是 `false`。

## 硬性约束（不可绕过）

- 从不口头上报 verdict：`state.mjs record` 只认 `review.mjs` 写出的审核记录。
- 从不自己撰写或改写外部审核的提示与结论；审核提示由 `review.mjs` 模板生成。
- 从不在审核后改动将要提交的内容；被审 tree 与提交 tree 必须一致。
- 默认门槛（web-gemini）下，外部 AI 不可用就**停下等人**，不得降级成 Claude 自审——同模型审核只有用户在 init 时显式放宽门槛才允许。
- `manual` 通道只记录用户亲口给出的结论。
- 从不无限重试同一版——`rejectStreak>=3` 一定 `pause`，一定唤醒用户。
- `done` 之后从不擅自 push / 发布 / 合并到其它分支——终态验收权在用户，不在状态机。
- 从不跳过 `step_relay_*` 记账——这是默认行为，不是"如果想要可见性再做"。
