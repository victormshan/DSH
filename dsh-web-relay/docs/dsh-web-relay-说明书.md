# dsh-web-relay 说明书

> 适用版本：dsh-web-relay 0.9.0  
> 协议版本：v1.5  
> 文档性质：基于当前实际源码与任务记录整理

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

> 本章是 **dsh-web-relay 三方协作协议 v1.3 的正式规范文本**，属于协议层约定，独立于当前 0.9.0 具体实现。

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

- 任务记录：`web-relay/experiments/dsh-web-relay-<ts>.md`
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

- 当前协议版本：`v1.5`
- v1.5 新增（协议级）：审核三级降级链（外部 AI → 对话模型 → 手动）、Step 字段 `artifact_required`、审核来源 `reviewedBy`、一键收口语义；与 v1.3 / v1.4 完全向下兼容。
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

### 3.12 审核降级链与容错（v1.5）

v1.5 在 v1.3 Step List 与 v1.4 Planning 之上引入审核降级链与容错字段。

- 审核三级降级：每步进入 `review` 后，按 **外部 AI（Gemini）→ 对话模型（无工具，跟随主会话路由，如 deepseek-v4-flash）→ 用户手动** 的顺序自动降级审核。
- `reviewedBy` 字段：每步记录审核来源，取值 `external | dialog | manual`。
- `artifact_required` 字段：Step 可声明 `artifact_required: false`（纯分析/规划步骤不要求实体产物）；校验器优先读 notes 与轨迹，避免误打回。
- 一键收口语义：全部 `approved` 后可发起收口，生成审核来源汇总并追加轨迹后置整体 `done`。

约束：

- 降级链仅作用于审核环节，不改变执行与轨迹语义。
- 与 v1.3 Step List、v1.4 Planning 完全向下兼容。

---

## 4. 实际实现（0.9.0）

> 以下内容来自当前安装源码。

### 4.1 安装位置

```text
C:\Users\Administrator\.dsh\profiles\web\node_modules\dsh-web-relay
```

### 4.2 关键文件

| 文件 | 作用 |
|---|---|
| `package.json` | 插件元数据，version 0.9.0 |
| `lib/index.js` | 后端：协议常量、路由、Step List 状态机、trace 读写 |
| `lib/client.js` | 前端：面板、Step List UI、审核操作、语言设置/i18n |
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
POST /dsh-web-relay/steps/finalize  （一键收口）
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
  任务记录：frontmatter + Prompt/Answer/指令解析/执行结果/分步实施清单

web-relay/experiments/expr-<ts>.steps.json
  Step List 状态：exprId / currentStep / status / steps[] / updatedAt

web-relay/traces/expr-<ts>.md
  三方轨迹：[用户] / [外部AI] / [主 agent] 条目
```

### 4.6 界面布局（v0.8.0）

v0.8.0 将面板从「浮动浮层」改为与 DSH 主页面**左右平铺**的停靠栏：

- **停靠位置**：面板 `position: fixed; top: 60px; right: 0; bottom: 0`，宽度 `var(--dwr-panel-width)`（默认 360px）
- **平铺机制**：打开面板时给 `<html>` 挂 `data-dwr-docked`，CSS 通过 `body { padding-right: 面板宽 + 分割条宽 }` 让 DSH 主页面让出空间，形成左右平铺
- **可拖动分割条**：面板左缘 5px 分割条，拖拽调整宽度（最小 320px，最大 50% 视口），宽度存 `localStorage`（`dsh-web-relay:panel-width`）刷新自动恢复；分割条中央 3px×24px 半透明指示条，hover 变品牌色
- **折叠/展开**：标题栏「—」最小化 → 右侧 28px rail；点 rail 展开
- **样式统一**：全部使用 DSH design tokens（`--dsw-alias-*`）亮/暗主题自动跟随；状态性按钮为幽灵按钮（透明 + 细边框 + hover 浅色），主操作（提问/进入执行阶段/打包上下文）为品牌色实心
- **纯文字 Tab**：「协作对话 / 轨迹」为文字 tab，选中项品牌色 + 下划线
- **CSS 注入**：`apply` 时注入 `<style data-dwr-dock-css>`（body 留白、分割条、rail、幽灵按钮 hover），防重复

### 4.7 v0.9.0 升级内容

v0.9.0 在 v0.8.0 平铺布局之上新增（协议同步升级至 v1.5，详见 3.12）：

- **M1 防死锁与状态锁**：Step 处于 `executing`/`review` 时前端按钮 Loading 禁用；后端 8 秒状态锁，同一步骤拒绝重复审核/唤醒，返回 `skipped`
- **M2 审核引擎三级降级**：每步 review 后按 外部 AI（Gemini）→ 对话模型（无工具，跟随主会话路由如 deepseek-v4-flash）→ 用户手动 自动降级；每步记录 `reviewedBy: external | dialog | manual`；steps 支持 `artifact_required: false`（纯分析/规划步骤不要求实体产物）；校验器优先读 notes 与轨迹，避免误打回
- **M3 流程进度看板**：面板顶部进度条 `Step x/y · 阶段 · 等待方徽标`（等待外部 AI / 主 agent / 你）
- **M4 审核面板化 + 一键收口**：手动审核在面板内完成（意见输入 + 通过/打回，不再去主会话粘贴）；全部 approved 后「一键收口」自动生成审核来源汇总 + 追加轨迹 + 置 `done`
- **M5 智能上下文打包**：📦 打包自动注入当前 Step 状态、已完成步骤摘要、最近轨迹、上次审核意见
- **M6 性能与交互**：分割条拖拽 <180px 自动折叠为 rail；Planning 只读探路 `context_requests` 对高频文件插件直读缓存（TTL 60s），缩短探讨等待
- **语言设置**：新增语言设置项（中文/英文），`localStorage`（`dsh-web-relay:locale`）持久化，面板 ⚙/语言按钮切换；插件内统一称「任务」（数据目录仍为 `web-relay/experiments/`，历史命名）

---

## 5. 使用方法

> 本章基于 dsh-web-relay 0.9.0 实际功能编写。

### 5.0 环境配置

使用 Gemini 自动功能前需要配置：

```powershell
$env:GEMINI_API_KEY = "你的_Gemini_API_Key"
$env:GEMINI_MODEL = "gemini-3.6-flash"
dsh web
```

或通过系统环境变量永久配置后重启 `dsh web`。

### 5.1 面板功能区域

- 标题栏：任务名 + 最小化（—）/ 关闭（✕）
- 流程进度条：面板顶部显示 `Step x/y · 阶段 · 等待方徽标`（等待外部 AI / 主 agent / 你）
- 标签页：协作对话 / 轨迹（纯文字 tab，选中品牌色 + 下划线）
- 分割条：面板左缘可拖动（320px ~ 50% 视口），宽度持久化
- 模式选择区：手动粘贴 / Gemini API
- Prompt 输入区
- 上下文打包区
- 回答粘贴区
- Step List 载入区：载入 / 刷新 / 清空
- Step List 状态与操作区
- 手动审核框：`review` 状态下在面板内输入意见 + 通过/打回（不再去主会话粘贴）
- 一键收口：全部 `approved` 后点击，自动生成审核来源汇总 + 追加轨迹 + 置 `done`
- 三方轨迹查看区
- 语言设置：右上角语言按钮切换 中文/英文，`localStorage` 持久化

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

### 5.5 自动审核（三级降级）

1. 当前 Step 处于 `review`
2. 点击「自动审核」
3. 服务端按三级降级自动审核：
   - **外部 AI（Gemini）**：首选通道，调用 Gemini 审核
   - **对话模型（无工具）**：外部 AI 不可用时降级，跟随主会话路由（如 deepseek-v4-flash），以无工具方式审核
   - **用户手动**：自动通道均不可用时降级到面板内手动审核框（输入意见 + 通过/打回）
4. 降级原因在界面提示；每步记录审核来源 `reviewedBy: external | dialog | manual`
5. 自动写回 `approved` / `rejected`
6. 自动唤醒主 agent：
   - approved 且有下一步 → 继续执行下一步
   - approved 且全部完成 → 最终收口
   - rejected → 修改后重新提交

前提：

- 当前 Step 必须处于 `review`
- 外部 AI 通道需配置 `GEMINI_API_KEY`；未配置或调用失败时自动降级到下一级

### 5.6 三方 Trace 轨迹查看

- 面板「轨迹」页可查看 `web-relay/traces/*.md`
- 每条轨迹包含 `[用户]`、`[外部AI]`、`[主 agent]`
- 可展开查看对应任务记录

### 5.7 最终收口机制

1. 所有 Step 均为 `approved`
2. 点击面板「一键收口」按钮：自动生成审核来源汇总（各步 `reviewedBy`）并追加到三方轨迹
3. `steps.json` 整体状态置为 `done`
4. 任务记录状态置为 `done`
5. 主 agent 将最终结论追加到三方轨迹
6. 未写入 `side/`

### 5.8 数据文件

- 任务记录：`web-relay/experiments/*.md`
- 步骤状态：`web-relay/experiments/*.steps.json`
- 三方轨迹：`web-relay/traces/*.md`

### 5.9 Step List 载入 / 刷新 / 清空

- **载入**：输入 expr id，加载**任意任务**（当前任务或历史任务）的 Step List
- **刷新**：加载**最新任务**的 Step List 与当前状态——无论当前显示的是哪个任务，清空后点刷新也会回到最新任务
- **清空**：清空 Step List 显示内容与输入框；清空后**不会自动恢复**，需点「刷新」回到最新任务

### 5.10 语言设置

- 面板右上角语言按钮（⚙ / 语言）可在**中文 / 英文**之间切换
- 语言选择通过 `localStorage` 持久化（键名 `dsh-web-relay:locale`），刷新后保持
- 插件面板文案随语言切换；术语统一称「任务」

> 术语约定：插件内统一称「任务」（不再使用「试验」）；数据目录仍为 `web-relay/experiments/`（历史命名）。

---

## 6. 开发者扩展

> 本章属于开发者扩展指南，基于当前 0.9.0 实际实现；协议规范仍以第 3 章 v1.3 为准。

### 6.1 扩展总览

dsh-web-relay 的扩展点主要位于：

- 后端 `lib/index.js`：路由、Channel/LLM 适配、Step List 状态机、Trace 存储
- 前端 `lib/client.js`：面板 UI、事件钩子、与后端 API 交互
- 数据目录 `web-relay/`：任务记录、步骤状态、三方轨迹

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

当前 v0.9.0 已提供自动审核接口：

```text
POST /dsh-web-relay/steps/auto-review
body { workspacePath, exprId, stepId?, sessionId? }
```

服务端逻辑：

- 找到当前 `review` 的 Step
- 读取任务记录与三方轨迹
- 组装审核上下文
- 按三级降级链调用审核通道（外部 AI → 对话模型(无工具) → 手动），并记录 `reviewedBy`
- 自动解析 `approved` / `rejected`
- 自动写回 `steps.json` 和 `trace`
- 若 `approved` 且存在下一步，自动唤醒主 agent 继续执行
- 全部 `approved` 后，可经 `POST /dsh-web-relay/steps/finalize` 一键收口（生成审核来源汇总 + 追加轨迹 + `done`）

使用前提：

- 外部 AI 通道需配置 `GEMINI_API_KEY`；未配置或失败时自动降级到对话模型 / 手动审核框
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

dsh-web-relay 0.9.0 已实现：

- v1.5 协议（v1.3 Step List 基础 + v1.4 Planning + v1.5 审核降级链）
- Step List 状态持久化
- 逐步执行与外部 AI 审核（三级降级：外部 AI → 对话模型 → 手动）
- rejected 重试
- 三方轨迹可追溯
- 自动审核接口 `/dsh-web-relay/steps/auto-review`、一键收口接口 `/dsh-web-relay/steps/finalize`
- 审核面板化 + 一键收口、流程进度看板、智能上下文打包、语言中/英切换

当前可通过面板「自动审核」触发三级降级审核；未配置 `GEMINI_API_KEY` 时自动降级到对话模型或面板内手动审核框。
