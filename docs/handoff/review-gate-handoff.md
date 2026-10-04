# 交接：review-gate 上线后 DeepSeek harness（dsh）需要同步的改动

日期：2026-10-05　·　来源：Claude Code 侧（WebUI-AutoTest + DSH 仓库）
读者：dsh 主 agent / dsh-web-relay 维护者

## 0. 一句话

auto-iterate 的审核门从「技能目录里的 Node 脚本」换成了独立的 Rust 服务 **review-gate**（`reviewgate` 系统用户，
`127.0.0.1:7878`）。网页版 Gemini 通道（dsh-web-gemini-ext）同时修了三处会导致长提示失败的问题，升到 0.4.3。
dsh 侧要做的：**① 宿主的 bridge 停滞阈值按提示长度缩放；② 不再调用 Node 门；③ 需要审核门时走 review-gate 的 HTTP API。**

## 1. dsh-web-gemini-ext 0.4.3（分支 `gemini-ext-fixes`，tag `auto-iterate/gemini-ext-fixes/v1..v3`）

| 版本 | 问题 | 修复 |
|---|---|---|
| V1 | 首次请求 `INPUT_BUSY` | 识别并清除扩展**自己**残留在输入框里的提示（见第 2 节） |
| V2 | 长提示发送后 0.7 秒就判 `SEND_FAIL` | 发送确认等待时间按长度缩放（`sendSettleMsFor`），最多重试 3 个候选按钮 |
| V3 | 60/70/120 秒三个固定超时互相打架，长回答被中途放弃 | 一条按提示长度缩放的超时链，content / background / bridge 三处共用同一个 `@timeouts` 代码块（测试保证三处一致）；超时后不再重发 |

超时链（毫秒，`len` = 提示字符数）：

```js
sendSettleMsFor(len)              = min(10000, 2000 + ceil(len / 4))
replyMaxMsFor(len)                = min(240000, 60000 + 15 * len)
backgroundTimeoutMsFor(len)       = contentBudgetMsFor(len) + 15000
bridgeProcessingTimeoutMsFor(len) = max(120000, backgroundTimeoutMsFor(len) + 30000)
```

| 提示长度 | 等回答上限 | background 超时 | bridge processing 超时 |
|---:|---:|---:|---:|
| 500 | 67.5 s | 107.8 s | 137.8 s |
| 2 000 | 90 s | 132.5 s | 162.5 s |
| 6 000 | 150 s | 199.3 s | 229.3 s |
| 10 000 | 210 s | 266.8 s | 296.8 s |
| 20 000 | 240 s | 315.5 s | 345.5 s |

已部署到 `/mnt/d/dsh/dsh-web-gemini-ext`（旧文件备份为 `*.bak-v043pre-<时间>`），需要在 Chrome 里重新加载扩展才生效。
经验值：一次提示不要超过约 6 000 字符；review-gate 会自动按 6 000 字符分段审核，任一段打回即整版打回。

## 2. INPUT_BUSY 的根因

不是用户在输入，也不是别的任务在占用：上一次请求超时后，扩展自己写进输入框的提示**没有发出去也没有清掉**，
下一次请求看到输入框非空，就报 `INPUT_BUSY`。旧的 `clearInput` 还会按回车，可能把残留提示当新消息发出去。

0.4.3 的做法：扩展把自己写入的提示指纹存在 `sessionStorage`，输入框非空时先比对——是自己的残留（至少匹配
`min(20, 长度)` 个字符）就清掉再继续；不是自己的才报 `INPUT_BUSY`；清不掉报新的 `INPUT_STUCK`。`clearInput` 不再按回车。

**dsh 侧建议**：把 `INPUT_BUSY` 当作可重试错误（间隔 ≥5 秒，最多 3–4 次），`INPUT_STUCK` 当作需要人工（刷新 Gemini 标签页）。

## 3. dsh-web-relay：宿主停滞阈值要按长度缩放（需要改代码）

`lib/bridge-poll.js` 的 `BRIDGE_STALL_MS_DEFAULT = 90000`，`lib/index.js` 用它判断 processing 是否「停滞」（4.12.2 第 602 行
`BRIDGE_STALL_MS`）。0.4.3 下，6 000 字符的提示合法地可以处理 150–230 秒，宿主会在 90 秒时把它误判为停滞、提前失败，
降级链随后又重发——这正是之前出现「Gemini 标签页卡死 / NO_RESPONSE」的放大器。

建议改法（任选其一）：
1. `stallMs = max(BRIDGE_STALL_MS, bridgeProcessingTimeoutMsFor(prompt.length))`——把第 1 节的 `@timeouts` 代码块原样复制进
   `bridge-poll.js`（三处一致性测试可以扩展到四处）；
2. 或者至少：`stallMs = max(90000, 60000 + 15 * prompt.length + 60000)`。

同时 `timeoutMs`（整体 deadline）不应小于 `bridgeProcessingTimeoutMsFor(len)`。补测试：6 000 字符的任务 processing 120 秒时
`classifyBridgeTask` 不应返回 `stalled`。

## 4. review-gate 的 HTTP API（dsh 需要审核门时直接调用）

服务：`http://127.0.0.1:7878`；除 `/health`、`/pubkey` 外都要 `Authorization: Bearer <token>`，token 在
`/etc/review-gate/client.token`（dsh 运行用户需要读权限，安装脚本给实施方用户配好了；dsh 用户不同就再加一个 ACL 或副本）。

| 方法与路径 | 请求体 | 返回 |
|---|---|---|
| `GET /health` | | `{ok, service, version}` |
| `GET /pubkey` | | `{algorithm:"ed25519", key}` |
| `GET /tasks`、`GET /tasks/{id}` | | 任务列表 / 任务 |
| `POST /tasks` | `{id, goal, acceptance, iterations, repo, min_reviewer?, review_provider?}` | 任务 |
| `POST /tasks/{id}/link` | `{expr_id}` | 任务 |
| `POST /tasks/{id}/reviews` | `{tree, base, evidence?, provider?}` | job `{id, status:"running"}` |
| `GET /jobs/{job}` | | `{status: running\|done\|failed, record?, error?, unavailable}` |
| `POST /tasks/{id}/reviews/submit` | `{tree, base, channel: claude-subagent\|self-review, text}` | 审核记录 |
| `POST /tasks/{id}/record` | `{review, commit?, tag?}` | `{action, task, attestation?}` |
| `POST /check` | `{repo, tree, base}` | `{allowed, task?, review?, reason}` |

- `tree`/`base`：在仓库里 `git add -A && git write-tree`、`git rev-parse HEAD`。审核门只读地取 `base..tree` 的 diff，并要求 `base` 仍是 HEAD。
- `action`：`start_round` | `retry_same_round` | `finalize` | `pause`。`unavailable: true` 表示没有任何外部 AI 可用——**停下等人，不要降级**。
- 通道强度：manual 5 > external-api 4 > web-gemini 3 > claude-subagent 2 > self-review 1；默认门槛 web-gemini。`manual` 只能由用户本人在
  reviewgate 身份下用 `review-gate admin manual` 写入，HTTP 拒绝。
- 通过的版本带 ed25519 签名证明，作为 git note `refs/notes/review-gate` 挂在提交上；推送时带上 `refs/notes/review-gate`。
- 外部审核者配置在 `/etc/review-gate/env`（`GEMINI_API_KEY`、`DEEPSEEK_API_KEY`、`REVIEW_GATE_BASE_URL/API_KEY/MODEL`、
  `DSH_RELAY_BRIDGE`）。实施方是 Claude 时，DeepSeek 也算「另一家厂商」。
- 单次提问（不进状态机）：`echo "<prompt>" | review-gate ask [--provider web-gemini] [--json]`，退出码 0 答复 / 3 无可用外部 AI / 1 失败。

## 5. Node 审核门停用

`claude-step-relay` 里的 `skills/auto-iterate/{state,review,common}.mjs` 和 `tools/external-ai.mjs` 已删除；`npm run install-skill`
只装 `SKILL.md`，并从已安装的技能目录里删掉这些旧脚本。dsh 如果有脚本直接调用 `~/.claude/skills/auto-iterate/*.mjs` 或
`tools/external-ai.mjs`，请改为 `review-gate` 命令或第 4 节的 HTTP API（`external-ai.mjs` → `review-gate ask`）。
旧状态目录 `~/.claude/auto-iterate/state/` 保留作历史记录，不再写入。

## 6. claude-step-relay 轨迹的新规则

- `step_relay_append_trace` 拒绝以「外部审核」「review-gate」开头的角色——这些条目只能由 review-gate 写到它自己的
  `/var/lib/reviewgate/relay/traces/<exprId>.gate.md`（`REVIEW_GATE_TRACE_DIR` 可改）。
- `step_relay_read_trace` 和看板按时间合并两边；主轨迹文件里出现的保留角色条目会被标为「未经审核门签发，不可信」。
- dsh 如果曾经用「外部审核」角色往 step-relay 里写东西，需要停止（改用自己的角色名，或让 review-gate 写）。

## 7. dsh 侧待办清单

- [ ] dsh-web-relay：宿主 `stallMs` / `timeoutMs` 按提示长度缩放（第 3 节），加测试。
- [ ] dsh-web-relay：`INPUT_BUSY` 可重试、`INPUT_STUCK` 需人工（第 2 节）。
- [ ] 去掉对 Node 门脚本和 `external-ai.mjs` 的调用（第 5 节）。
- [ ] 需要审核门的流程改走 review-gate HTTP API（第 4 节），确认 dsh 运行用户能读 token。
- [ ] 不再用保留角色写 step-relay 轨迹（第 6 节）。
- [ ] 合并 DSH 仓库的 `gemini-ext-fixes` 后在 Chrome 里重新加载扩展。

## 8. 让 Claude 帮 dsh 核对这份文档

同目录的 `review-gate-understand.task.json` 是一个 v2 格式的 `understand` 任务（已用 `task-schema-cli.mjs validate-task` 校验）。
需要时投递到 cc 通道（先写临时名再改名，避免 watchdog 读到半个文件）：

```bash
git -C /mnt/d/dsh show origin/main:docs/handoff/review-gate-understand.task.json > /mnt/d/cc-tasks/queue/.understand-review-gate-handoff.task.json.tmp
mv /mnt/d/cc-tasks/queue/.understand-review-gate-handoff.task.json.tmp /mnt/d/cc-tasks/queue/understand-review-gate-handoff.task.json
```

结果在 `/mnt/d/cc-tasks/tasks/understand-review-gate-handoff/out/{understanding.md, review.md}`。
