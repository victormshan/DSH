---
name: auto-iterate
description: Autonomously evolve a target repo through N versions under the dsh-web-relay three-party protocol — Claude implements, an external AI from another vendor reviews each version, and the independent review-gate service (its own system user, private store, signed attestations) decides whether a version may be committed, with a reviewer-strength gate, 3-strike circuit breaker and commit+tag per approved version, driven by /loop. Use when the user asks to auto-iterate / 自动迭代 / 自动演进 a project through multiple versions with minimal supervision. Do not use for a single one-off change.
---

# Auto-Iterate

对齐 dsh-web-relay 的三方协议：**主 agent**（本会话，Claude，实施）／**外部审核者**（另一家厂商的模型：Gemini API、OpenAI 兼容/DeepSeek，或经 dsh-web-gemini-ext bridge 的网页版 Gemini）／**用户**（定目标与验收标准、外部审核不可用时人工把关、终态验收）。

审核门是独立服务 **review-gate**（Rust，`reviewgate` 系统用户运行，`127.0.0.1:7878`）：
它自己调用外部 AI、自己保存审核记录、自己核对提交、给通过的版本签名。实施方（本会话）只能通过
`review-gate` 命令行或 MCP 工具发请求，**读不到也改不了**它的状态。

两套状态各管各的：
- **review-gate**：版本门、强度门、熔断、审核记录、签名证明——唯一的判定依据。
- **claude-step-relay（`step_relay_*` MCP 工具）**：任务的可见记录——Step List（一版一个 Step）+ 轨迹。
  外部审核条目由 review-gate 自己写（角色「外部审核 · review-gate」，本会话不能用这个角色），
  `step_relay_read_trace` 和看板会自动合并。**每一轮都要记账，这是默认步骤。**

两边用同一个 `exprId` 关联（`review-gate task link`）。

**前置条件**：review-gate 服务在运行（`curl -s http://127.0.0.1:7878/health`）；`review-gate` 在 PATH 上，
客户端 token 可读（`/etc/review-gate/client.token` 或 `~/.config/review-gate/token`）。没有就停下告诉用户按
WebUI-AutoTest 仓库 `crates/review-gate/README.md` 安装，**不要自己搭一个替代的审核门**。
也可以用 MCP 工具（`gate_*`，`review-gate mcp`），语义与下面的命令一一对应。

## 启动

```
review-gate task init --id <task-id> --goal "<一句话目标>" \
  --acceptance "<最终验收标准，越具体越好>" \
  --iterations <1-10> --repo "<目标仓库路径>" \
  [--min-reviewer web-gemini]   # external-api(4) > web-gemini(3) > claude-subagent(2) > self-review(1)；manual(5)=用户亲审
```

启动前检查：`git -C <repo> status --short` 必须干净。不干净就如实告知用户，让其决定先提交/搁置，还是把已有改动当作 v0 基线一并提交——**不要自作主张吞掉用户未提交的工作**。

然后建 claude-step-relay 任务并关联：

1. `step_relay_start`：`title` = 目标一句话，`prompt` = 目标 + "\n验收标准：" + 验收标准。记下 `exprId`。
2. `review-gate task link --id <task-id> --expr-id <exprId>`。
3. `step_relay_set_steps`：N 个 Step，`id` 1..N，`title` 为 `"V{n}"`，`acceptance` 填这一版的验收标准（拆不开就都填完整标准）。

初始化成功后立即进入「每一轮」，本轮版本 = 1。

## 每一轮（刚 init 或被 `/auto-iterate <task-id>` 唤醒）

1. `review-gate task show --id <task-id>` 读状态（`expr_id`、`current_iteration`、`goal`、`final_acceptance`、`history`）。若 `status` 不是 `running`：把 `stop_reason`／最终验收提示原样讲给用户，`ScheduleWakeup(stop: true)`，结束。

2. **标记开始**：`step_relay_update_step`（`stepId=current_iteration`，`status="executing"`，`note="实施中"`）。

3. **实施**：按目标、验收标准和上一轮打回意见（审核全文在 step-relay 轨迹的「外部审核 · review-gate」条目里）改代码。只做这一版的事。

4. **验证**：能跑测试就跑；测试不过先自己修。把关键结果写进证据文件（给审核者看，标注为实施方自述）。

5. **审核**（由审核门发起；实施方不写审核提示、不转述结论）：
   - `step_relay_update_step`（`note="审核中（外部 AI）"`）。
   - ```
     review-gate review run --id <task-id> [--evidence <证据文件>]
     ```
     命令会 `git add -A` 暂存全部改动，把 tree/base 交给审核门；审核门只读地取 diff、按模板分段交给外部 AI、写审核记录和轨迹，命令等到出结论为止，输出 job JSON（`record.id`、`record.verdict`、`record.channel`）。web-gemini 一段约 20–90 秒，大改动会分多段。
   - **审核期间和审核之后都不要再改工作区**——记录绑定暂存区 tree，提交内容必须一字不差。
   - 退出码 3（没有外部 AI 可用）或反复失败 →
     - 门槛是默认 `web-gemini` 或更高：**不要降级自审**。`step_relay_update_step`（`status="blocked"`，`note="外部审核不可用，等人"`），告诉用户需要启动 bridge/扩展或配置 API key（在 `/etc/review-gate/env`），`ScheduleWakeup(stop: true)`。
     - 用户 init 时显式设了 `--min-reviewer claude-subagent`：用 `Agent` 起一个**全新**的 `general-purpose` agent，只给它 `git -C <repo> diff --cached` 和验收标准，要求首行 `VERDICT: …`；原文写入文件后 `review-gate review submit --id <task-id> --channel claude-subagent --file <文件>`。
   - 人工审核只能由用户本人以 reviewgate 身份执行 `review-gate admin manual …`（见 review-gate README）；本会话**不能也不得**代填。

6. **记账**：
   - verdict 为 `approved` →
     ```
     git -C <repo> commit -m "<本版做了什么>"      # 直接提交暂存区，不加 -a，不再 add
     git -C <repo> tag auto-iterate/<task-id>/v<current_iteration>
     review-gate record --id <task-id> --review <record.id> --commit HEAD --tag auto-iterate/<task-id>/v<current_iteration>
     ```
     审核门核对：记录属于本版且未用过、通道强度够、提交 tree == 被审 tree、恰好一个父提交且等于审核时的 HEAD、tag 指向该提交。任一不符直接报错——**不要绕过，按报错修正**（审核后改过文件就重新审核）。通过后它签发证明，`record` 把证明作为 git note（`refs/notes/review-gate`）挂到提交上。
     `step_relay_update_step`（`status="done"`，`note="commit <sha> · tag <tag> · 审核 <channel>"`）。
   - verdict 为 `rejected` → **不 commit**：`review-gate record --id <task-id> --review <record.id>`；`step_relay_update_step`（`note="第 N 次打回（<channel>）：<一句话原因>"`）。可以 `git -C <repo> reset -q` 取消暂存后继续改。

7. 按 `record` 返回的 `action`：
   - `start_round` → 推进到下一版，回第 2 步。
   - `retry_same_round` → 以审核意见为依据回第 3 步，版本不变。
   - `finalize` → `step_relay_finalize`（summary = 各版做了什么 + tag 列表 + 提醒人工端到端验收）；向用户汇报同样内容，提醒**这是自动化的终点，不是发布的终点**。推送时要连同证明一起推：`git push origin <branch> refs/notes/review-gate`（只在用户同意后）。`ScheduleWakeup(stop: true)`。
   - `pause` → 熔断或审核通道强度不足（`stop_reason` 写明）。`step_relay_update_step`（`status="blocked"`，`note=stop_reason`），把原因和最近几次审核意见讲给用户，`ScheduleWakeup(stop: true)`。

## /loop 触发方式

第一轮跑完后用 `ScheduleWakeup` 安排下一次：`prompt` = `/auto-iterate <task-id>`；推进很快时 120–300s，慢操作按实际耗时估；`done`/`paused` 时 `stop:true`。`noop` 只有这一 tick 完全没推进时才为 `true`。

## 硬性约束（不可绕过）

- 从不口头上报 verdict，从不自己撰写或改写审核提示与结论——只认审核门的记录。
- 从不在审核后改动将要提交的内容。
- 默认门槛下外部 AI 不可用就**停下等人**，不得降级成 Claude 自审。
- `manual` 只记录用户亲口给出的结论，且只能由用户自己执行。
- 从不使用保留角色（「外部审核」「review-gate」）写 step-relay 轨迹，从不直接改轨迹文件。
- 连续 3 次打回必然 `pause`，必然唤醒用户。
- `done` 之后从不擅自 push / 发布 / 合并——终态验收权在用户。
- 从不跳过 `step_relay_*` 记账。
