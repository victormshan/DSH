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

## 测试

```bash
npm test
```

用 Node 内置 `node:test`，两个测试文件、共 26 个用例：

- `test/store.test.js`（18 例）：直接调用 `lib/store.mjs`，覆盖正常流程、输入校验（空标题/空
  steps/非法 status）、不存在任务的各类报错、路径穿越拦截、exprId 并发唯一性、超长文本/emoji/
  markdown 特殊字符、50 步大规模 Step List。
- `test/mcp-protocol.test.js`（8 例）：真实拉起 `index.mjs` 子进程，走完整 MCP stdio 协议——
  工具注册、zod 入参校验的错误形态、覆盖式 `set_steps` 语义、10 路并发 `update_step`。

全程跑在临时目录（`STEP_RELAY_DIR` 指向 `os.tmpdir()` 下的隔离目录），不会污染真实
`step-relay/` 数据；协议层测试会各自拉起一个子进程，整体耗时数十秒属正常。
