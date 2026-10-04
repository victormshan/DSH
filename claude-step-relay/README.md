# claude-step-relay

给 Claude Code 用的轻量级 Step List + 三方轨迹记录 MCP server。

## 这是什么，不是什么

思路借鉴自 [`dsh-web-relay`](../dsh-web-relay)（dsh 主 agent 与外部网页 AI 的三方协作插件），
但**不是移植**——只保留其中真正跟"用什么 harness"无关的那部分价值：

- 把复杂任务拆成结构化 **Step List**（id/title/detail/acceptance）
- 每步状态可追踪（pending/executing/done/blocked）
- 所有过程落盘成人类可读的**三方轨迹**（`[用户]` / `[Claude]`），跨会话可审计

**去掉的部分**（dsh-web-relay 里有，这里没有，是有意为之）：

- 外部 AI 审核降级链（external → dialog → manual）
- DAG 并发调度（`depends_on` / `parallel_group`）
- 多方案比较（`alternatives`）、步骤重要性分工契约
- 协议版本号体系（v1.3~v1.9）

原因：dsh 的主 agent 需要借外部网页 AI（Gemini 等）补能力，所以要审核降级链和调度这些重机制；
Claude Code 里 Claude 本身就是可信的执行方，不需要外部 AI 当审核关卡——真正有价值的只是
"拆步骤 + 留痕"，所以这里没有任何阻塞式审核门槛，状态更新由 Claude 自己驱动。

## 安装

```bash
cd claude-step-relay
npm install
```

## 接入 Claude Code

```bash
claude mcp add claude-step-relay -- node /绝对路径/claude-step-relay/index.mjs
```

或手动写入 MCP 配置（`~/.claude.json` 或项目级 `.mcp.json`）：

```json
{
  "mcpServers": {
    "claude-step-relay": {
      "command": "node",
      "args": ["/绝对路径/claude-step-relay/index.mjs"],
      "env": {
        "STEP_RELAY_DIR": "/绝对路径/你的项目/step-relay"
      }
    }
  }
}
```

`STEP_RELAY_DIR` 不设置时默认在 server 进程的 cwd 下创建 `step-relay/` 目录
（`step-relay/experiments/*.json` + `step-relay/traces/*.md`），建议显式指定到具体项目目录，
避免不同项目的记录混在一起。

## 工具列表

| 工具 | 作用 |
|---|---|
| `step_relay_start` | 开始一个新任务，记录标题/初始 prompt，返回 `exprId` |
| `step_relay_set_steps` | 定义/替换 Step List（覆盖式） |
| `step_relay_update_step` | 更新某步状态（pending/executing/done/blocked）+ 可选说明 |
| `step_relay_append_trace` | 手动追加一条轨迹（用户反馈、关键决策等） |
| `step_relay_get_state` | 读取任务当前完整状态 |
| `step_relay_list` | 列出所有任务及进度概览 |
| `step_relay_read_trace` | 读取某任务完整轨迹 Markdown 原文 |
| `step_relay_finalize` | 收口任务，标记整体完成 + 写最终结论 |

## 任务看板（可选）

只读本地 Web 界面，展示 `step_relay_list` 里的所有任务、每个任务的 Step List 与实时状态、
以及完整三方轨迹，无需再一条条调用 MCP 工具查看：

```bash
npm run ui
# 或指定端口：PORT=6000 npm run ui
```

数据目录与 MCP server 实际写入的保持一致，按以下顺序解析（启动时会打印所用目录及来源）：

1. 环境变量 `STEP_RELAY_DIR`；
2. Claude Code 的 MCP 配置中 `claude-step-relay` 的 `env.STEP_RELAY_DIR`——先查当前目录的
   `.mcp.json`（项目级），再查 `~/.claude.json`（用户级）；
3. 都没有时用 `process.cwd() + '/step-relay'`，与 MCP server 的默认值相同。

所以按 README 配好 MCP 后，直接 `npm run ui` 就能看到 MCP 写入的全部任务，不需要再写死路径。

打开 `http://localhost:5177`（默认端口 5177）。左侧任务列表，右侧是该任务的
workflow progress rail 风格 Step List（状态点：灰=pending / 蓝色脉冲=executing /
绿=done / 红=blocked），底部可展开查看轨迹 Markdown 原文。页面每 5 秒自动轮询刷新，
也可手动点右上角「刷新」。

该界面只读，直接复用 `lib/store.mjs` 读取同一份 `STEP_RELAY_DIR` 数据，不修改任何状态；
数据来源与 MCP 工具完全一致。

## auto-iterate 技能（版本自动迭代）

`skills/auto-iterate/` 是基于本 MCP server 的 Claude Code 技能：把一个仓库按「每版独立审核 → 通过才
commit+tag → 连续 3 次打回熔断」的方式自动迭代 N 个版本，每版是 Step List 里的一步，进度可在看板实时查看。
思路来自 dsh-web-relay 的 v1.9 AutoIteration（三方协议的两方版：主 agent 实施、独立 agent 审核、用户终验）。

```bash
npm run install-skill     # 复制到 ~/.claude/skills/auto-iterate（用户级，任何项目都能用）
```

与三方协议对齐：每版由**另一家厂商的外部 AI** 审核，审核门是独立的 Rust 服务 **review-gate**
（WebUI-AutoTest 仓库 `crates/review-gate`，以 `reviewgate` 系统用户运行）。它自己调用外部 AI（Gemini API →
OpenAI 兼容/DeepSeek → dsh-web-gemini-ext 的 web-gemini 网页通道）、自己保存审核记录、核对提交 tree 与被审 tree、
给通过的版本签名（ed25519，git note `refs/notes/review-gate`，CI 用钉死的公钥验证），实施方读不到也改不了。
外部 AI 不可用时默认停下等人，只有显式 `--min-reviewer claude-subagent` 才允许同模型子 agent 审核。
旧的 Node 审核门（`state.mjs`/`review.mjs`/`tools/external-ai.mjs`）已停用并删除。

审核门写的「外部审核 · review-gate」条目放在它自己的文件 `<REVIEW_GATE_TRACE_DIR>/<exprId>.gate.md`
（默认 `/var/lib/reviewgate/relay/traces`，只有 reviewgate 用户可写）；`step_relay_read_trace` 和看板按时间合并显示。
`step_relay_append_trace` 拒绝「外部审核」「review-gate」开头的角色；主轨迹文件里出现的这类条目会被标为不可信。

然后在 Claude Code 里说，例如：「用 auto-iterate 把 /path/to/repo 自动迭代 2 版，目标……，验收标准 V1:…；V2:…」。
状态机数据在 review-gate 的私有目录（`/var/lib/reviewgate/state`），不会写进被迭代的仓库。

## 测试

```bash
npm test
```

用 Node 内置 `node:test`，四个测试文件：

- `test/store.test.js`（18 例）：直接调用 `lib/store.mjs`，覆盖正常流程、输入校验（空标题/空
  steps/非法 status）、不存在任务的各类报错、路径穿越拦截、exprId 并发唯一性、超长文本/emoji/
  markdown 特殊字符、50 步大规模 Step List。
- `test/mcp-protocol.test.js`（8 例）：真实拉起 `index.mjs` 子进程，走完整 MCP stdio 协议——
  工具注册、zod 入参校验的错误形态、覆盖式 `set_steps` 语义、10 路并发 `update_step`。
- `test/gate-trace.test.js`（4 例）：保留角色拒写、正文伪造条目头转义、审核门轨迹按时间合并、主文件中的保留角色标为不可信。
- `test/ui-data-dir.test.js`（4 例）：看板数据目录解析——环境变量 > 项目级 `.mcp.json` >
  `~/.claude.json` > 默认值，配置损坏时安全回退。

全程跑在临时目录（`STEP_RELAY_DIR` 指向 `os.tmpdir()` 下的隔离目录），不会污染真实
`step-relay/` 数据；协议层测试会各自拉起一个子进程，整体耗时数十秒属正常。
