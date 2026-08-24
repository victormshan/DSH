# dsh-web-relay 说明书

> 适用版本：dsh-web-relay 0.7.0  
> 协议版本：v1.3  
> 文档性质：基于当前实际源码与试验记录整理

---

## 1. 总览

dsh-web-relay 是 dsh web profile 中的实验性插件，用于在 dsh 主 agent 与外部网页 AI 之间建立可追溯的协作通道。

核心能力：

- 手动粘贴外部 AI 回答，或通过 Gemini Free API 提问
- 解析 `json:agent-action` 指令块
- 将复杂任务拆分为 Step List（v1.3）
- 主 agent 逐步执行，外部 AI 逐步审核
- 所有过程写入 `web-relay/experiments/` 和 `web-relay/traces/`

---

## 2. 三方角色

| 角色 | 说明 |
|---|---|
| 用户 | 人类操作者，最终拍板方 |
| 主 agent | 本机执行方，负责读写文件、运行命令、修改代码、收口 |
| 外部 AI | 网页模型/外部 API，负责方案、规划、逐步审核 |

---

## 3. 协议规范（v1.3）

> 本章是 **dsh-web-relay 三方协作协议 v1.3 的正式规范文本**，属于协议层约定，独立于当前 0.6.0 具体实现。

### 3.1 协议范围

本协议定义以下主体之间的协作规则：

- 用户
- 主 agent
- 外部 AI

并约定：

- 任务如何分流
- 指令如何表达
- 复杂任务如何拆分为 Step List
- 主 agent 如何逐步执行
- 外部 AI 如何逐步审核
- 过程如何写入轨迹与产出物
- 安全边界如何约束

### 3.2 三方角色

| 角色 | 职责 |
|---|---|
| 用户 | 发起任务、提供上下文、确认执行、最终拍板 |
| 主 agent | 读取上下文、执行文件/命令/代码改动、回写轨迹、收口 |
| 外部 AI | 提供方案、规划 Step List、审核主 agent 每一步结果 |

### 3.3 Triage 分流（规则 8）

- 小改动 / 可直接回答的问题：外部 AI 直接给结论，无需指令 Payload。
- 复杂任务（多步实现、设计分歧、接口未验证等）：外部 AI 必须同时输出：
  1. `json:agent-action` 指令块
  2. 机器可读 `steps` 数组（Step List）

若外部 AI 未遵守，relay 粘贴端可提示一键补全格式；补全不改变内容实质。

### 3.4 json:agent-action Payload

`json:agent-action` 是外部 AI 与主 agent 之间的结构化指令载体，支持以下动作：

- `write_file`
- `run_cmd`
- `plan`
- `wake_agent`

示例：

```json
[
  {
    "action": "wake_agent",
    "reason": "复杂任务，请主 agent 接管",
    "targetWorkspace": "<workspace 路径>",
    "context": "<任务上下文>",
    "steps": [
      { "id": 1, "title": "步骤一", "review": true, "acceptance": "验收标准" }
    ]
  }
]
```

### 3.5 Step List 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 步骤序号 |
| `title` | 是 | 步骤标题 |
| `detail` | 否 | 步骤说明 |
| `review` | 否 | 是否需外部 AI 审核，默认 `true` |
| `acceptance` | 否 | 验收标准 |
| `artifacts` | 否 | 预期产出物 |

### 3.6 逐步执行与审核循环

```text
主 agent 执行 Step N
  → status = review
  → 外部 AI 审核
  → approved：主 agent 继续 Step N+1
  → rejected：主 agent 按意见修改后重新 review
```

约束：

- 主 agent 每次只执行一个 Step。
- 每步完成后必须将结果写入三方轨迹。
- 未收到外部 AI `approved` 前，不得执行下一步。
- 主 agent 可提出落地方案变更，外部 AI 核实后更新或通过。

### 3.7 状态机

| 状态 | 含义 | 可转换到 |
|---|---|---|
| `pending` | 待开始 | `executing` |
| `executing` | 执行中 | `review` |
| `review` | 待审核 | `approved`、`rejected` |
| `approved` | 已通过 | `reopen` 后可回 `pending` |
| `rejected` | 已打回 | `reopen` 后回 `pending` |
| `done` | 整体完成 | 最终态 |

整体 `done` 的条件：

- 所有步骤均为 `approved`。

### 3.8 轨迹与产出物约定

- 试验记录：`web-relay/experiments/dsh-web-relay-<ts>.md`
- Step List 状态：`web-relay/experiments/expr-<ts>.steps.json`
- 三方轨迹：`web-relay/traces/expr-<ts>.md`

轨迹必须包含三类条目：

- `[用户]`
- `[外部AI]`
- `[主 agent]`

### 3.9 安全护栏

- 所有指令经用户确认后执行。
- 越界写文件、无 timeout 命令会被拒绝。
- `write_file` 目标必须解析在 workspace 内。
- 一键补全只补格式，不代行执行意图。
- 轨迹不写入 `side/`，与 side-window 解耦。

### 3.10 协议版本

- 当前协议版本：`v1.4`
- 本协议是独立规范；实际插件实现可能逐步演进，但协议语义保持可追溯。

### 3.11 Planning & Architect 模式（v1.4）

v1.4 在 v1.3 Step List 执行之前引入可选的 planning 阶段。

- `phase: "planning"`：外部 AI 作为架构师，先探讨任务场景、边界与影响面。
- `context_requests`：外部 AI 可请求主 agent 做只读探路，例如读取文件或搜索代码。
- `phase: "executing"`：方案确认后，进入标准 Step List 执行。
- `phase: "finished"`：全部完成。

约束：

- `context_requests` 仅允许只读操作，严禁修改代码。
- planning 阶段不应直接输出可执行步骤。
- 与 v1.3 Step List 完全向下兼容。

---

## 4. 实际实现（0.7.0）

> 以下内容来自当前安装源码。

### 4.1 安装位置

```text
C:\Users\Administrator\.dsh\profiles\web\node_modules\dsh-web-relay
```

### 4.2 关键文件

| 文件 | 作用 |
|---|---|
| `package.json` | 插件元数据，version 0.7.0 |
| `lib/index.js` | 后端：协议常量、路由、Step List 状态机、trace 读写 |
| `lib/client.js` | 前端：面板、Step List UI、审核操作 |
| `cordis.patch.yml` | 插件装配声明 |

### 4.3 后端路由

```text
GET  /dsh-web-relay/status
POST /dsh-web-relay/ask
GET  /dsh-web-relay/context
POST /dsh-web-relay/parse
POST /dsh-web-relay/execute
GET  /dsh-web-relay/steps
POST /dsh-web-relay/steps/update
POST /dsh-web-relay/steps/auto-review
POST /dsh-web-relay/trace
GET  /dsh-web-relay/traces
GET  /dsh-web-relay/record
GET  /dsh-web-relay/protocol
```

### 4.4 核心函数

```text
extractBlocks
extractSteps
normalizeStep
stepStateTarget
readStepState
writeStepState
appendTrace
traceEntry
traceEntriesFrom
```

### 4.5 数据文件

```text
web-relay/experiments/dsh-web-relay-<ts>.md
  试验记录：frontmatter + Prompt/Answer/指令解析/执行结果/分步实施清单

web-relay/experiments/expr-<ts>.steps.json
  Step List 状态：exprId / currentStep / status / steps[] / updatedAt

web-relay/traces/expr-<ts>.md
  三方轨迹：[用户] / [外部AI] / [主 agent] 条目
```

---

## 5. 使用方法

> 本章基于 dsh-web-relay 0.7.0 实际功能编写。

### 5.0 环境配置

使用 Gemini 自动功能前需要配置：

```powershell
$env:GEMINI_API_KEY = "你的_Gemini_API_Key"
$env:GEMINI_MODEL = "gemini-3.6-flash"
dsh web
```

或通过系统环境变量永久配置后重启 `dsh web`。

### 5.1 面板功能区域

- 协议版本提示区
- 模式选择区：手动粘贴 / Gemini API
- Prompt 输入区
- 上下文打包区
- 回答粘贴区
- Step List 状态与操作区
- 三方轨迹查看区

### 5.2 手动粘贴模式

1. 打开 dsh-web-relay 面板
2. 选择「手动粘贴」
3. 输入 prompt
4. 点击「📦 打包上下文」复制给外部 AI
5. 将外部 AI 回答粘贴回面板
6. 面板解析 `json:agent-action` 与 Step List
7. 勾选并执行
8. 进入逐步审核流程

### 5.3 Gemini API 模式

1. 配置 `GEMINI_API_KEY`
2. 选择「Gemini Free API」
3. 输入 prompt
4. 点击「提问」
5. 自动获取外部 AI 回答
6. 继续执行与审核流程

### 5.4 Step List 逐步审核流程

1. 外部 AI 返回 plan + steps
2. 主 agent 执行 Step N
3. 状态置为 `review`
4. 外部 AI 审核：
   - `approved`：继续下一步
   - `rejected`：主 agent 修改后重新提交
5. 全部 approved 后整体状态 `done`

### 5.5 一键自动审核

1. 当前 Step 处于 `review`
2. 点击「自动审核」
3. 服务端调用 Gemini
4. 自动写回 `approved` / `rejected`
5. 自动唤醒主 agent：
   - approved 且有下一步 → 继续执行下一步
   - approved 且全部完成 → 最终收口
   - rejected → 修改后重新提交

前提：

- 已配置 `GEMINI_API_KEY`
- 当前 Step 必须处于 `review`

### 5.6 三方 Trace 轨迹查看

- 面板「轨迹」页可查看 `web-relay/traces/*.md`
- 每条轨迹包含 `[用户]`、`[外部AI]`、`[主 agent]`
- 可展开查看对应试验记录

### 5.7 最终收口机制

1. 所有 Step 均为 `approved`
2. `steps.json` 整体状态置为 `done`
3. 试验记录状态置为 `done`
4. 主 agent 将最终结论追加到三方轨迹
5. 未写入 `side/`

### 5.8 数据文件

- 试验记录：`web-relay/experiments/*.md`
- 步骤状态：`web-relay/experiments/*.steps.json`
- 三方轨迹：`web-relay/traces/*.md`

---

## 6. 开发者扩展

> 本章属于开发者扩展指南，基于当前 0.7.0 实际实现；协议规范仍以第 3 章 v1.3 为准。

### 6.1 扩展总览

dsh-web-relay 的扩展点主要位于：

- 后端 `lib/index.js`：路由、Channel/LLM 适配、Step List 状态机、Trace 存储
- 前端 `lib/client.js`：面板 UI、事件钩子、与后端 API 交互
- 数据目录 `web-relay/`：试验记录、步骤状态、三方轨迹

扩展时应保持：

- 协议规范与实现分离
- 状态机语义与 v1.3 一致
- 三方轨迹可追溯

### 6.2 新增后端 API 路由

步骤：

1. 在 `lib/index.js` 中新增 handler。
2. 使用 `webServer.register` 注册路由。
3. 所有 handler 放在 `apply(ctx)` 内，并通过 `ctx.effect` 注册。

示例：

```js
const myHandler = async (req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
  json(res, 200, { ok: true, hello: 'dsh-web-relay' })
}

ctx.effect(
  () => webServer.register({
    kind: 'exact',
    path: '/dsh-web-relay/example',
    handler: myHandler
  }),
  'dsh-web-relay/example'
)
```

### 6.3 自定义 Channel / LLM 适配器

当前实现：

- `gemini-free`：通过 `callGemini` 调用 Google Gemini
- `manual`：手动粘贴外部 AI 回答

扩展方式：

- 在 `askHandler` 中增加新的 provider 分支
- 新增对应调用函数，例如 `callDeepSeek`、`callOpenAI`
- 保持返回结构统一：`{ ok: true, text }` 或 `{ ok: false, error }`

示例：

```js
if (provider === 'my-provider') {
  const r = await callMyProvider(prompt)
  if (!r.ok) return json(res, 502, r)
  answer = r.text
}
```

### 6.4 UI 交互与事件钩子扩充

前端 `lib/client.js` 使用：

- `window.__ModuleLoader__.load`
- React hooks
- `CustomEvent` 跨组件通信
- `fetch` 调用后端 API

扩展方式：

- 新增面板状态：`useState`
- 新增副作用：`useEffect`
- 跨组件事件：`window.dispatchEvent(new CustomEvent(...))`
- 新增后端交互函数：`fetch('/dsh-web-relay/...')`

### 6.5 三方 Trace 存储扩展

当前存储：

```text
web-relay/traces/expr-<ts>.md
```

核心函数：

- `appendTrace`
- `traceEntry`
- `traceEntriesFrom`

扩展方式：

- 在 `appendTrace` 中增加额外写入目标，例如数据库或 JSON 文件
- 保持 `[用户]`、`[外部AI]`、`[主 agent]` 三类条目结构
- 新增 Trace 查询接口时，复用 `listTraces` / `loadTrace`

### 6.6 修改 Step List 状态机

核心位置：

- `stepUpdateHandler`
- `readStepState`
- `writeStepState`

新增状态/动作时同步更新：

- 协议常量 `WEB_RELAY_PROTOCOL`
- Skill 常量 `WEB_RELAY_EXTERNAL_AI_SKILL`
- 前端状态标签与按钮

### 6.7 自动审核

当前 v0.7.0 已提供自动审核接口：

```text
POST /dsh-web-relay/steps/auto-review
body { workspacePath, exprId, stepId?, sessionId? }
```

服务端逻辑：

- 找到当前 `review` 的 Step
- 读取试验记录与三方轨迹
- 组装审核上下文
- 调用 `callGemini`
- 自动解析 `approved` / `rejected`
- 自动写回 `steps.json` 和 `trace`
- 若 `approved` 且存在下一步，自动唤醒主 agent 继续执行

使用前提：

- 已配置 `GEMINI_API_KEY`
- 当前 Step 必须处于 `review` 状态

---

## 7. 与 side-window 的关系

- dsh-web-relay 使用独立目录：`web-relay/`
- 三方轨迹写入 `web-relay/traces/`
- 不写入 `side/`
- 与 side-window 解耦

---

## 8. 验证记录参考

- `expr-2026-08-22_13-51-32`：完整验证 v1.3 Step List 执行与审核回路
  - 含 rejected 重试
  - 含审核阻断
  - 最终全部 approved，整体 done
- `expr-2026-08-22_14-37-53`：本次说明书编写任务
  - Step 1～4 已 approved
  - Step 5 生成本文档

---

## 9. 结论

dsh-web-relay 0.7.0 已实现：

- v1.3 协议
- Step List 状态持久化
- 逐步执行与外部 AI 审核
- rejected 重试
- 三方轨迹可追溯
- 自动审核接口 `/dsh-web-relay/steps/auto-review`

当前可通过面板按钮触发自动审核；若未配置 `GEMINI_API_KEY`，仍可手动复制审核结果。
