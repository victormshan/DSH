# dsh-web-relay 说明书

> 适用版本：dsh-web-relay 1.2.1  
> 协议版本：v1.8（向下兼容 v1.5 / v1.6 / v1.7；v1.5 线性为默认，v1.6 / v1.7 / v1.8 均继承 DAG 并发调度）  
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

## 3. 协议规范（v1.3 起，含 v1.5 / v1.6 / v1.7 / v1.8）

> 本章是 **dsh-web-relay 三方协作协议 v1.3（延伸至 v1.5 审核降级链、v1.6 并发调度、v1.7 多方案比较与步骤权重、v1.8 混合模式分工）的正式规范文本**，属于协议层约定，独立于当前 1.2.1 具体实现。

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

- 主 agent 每次只执行一个 Step（v1.6 并发调度下，无依赖步骤可多步并行，见 3.13）。
- 每步完成后必须将结果写入三方轨迹。
- 未收到外部 AI `approved` 前，不得执行下一步。
- 主 agent 可提出落地方案变更，外部 AI 核实后更新或通过。

### 3.7 状态机

| 状态 | 含义 | 可转换到 |
|---|---|---|
| `pending` | 待开始 | `executing` |
| `blocked` | 前置依赖未满足（v1.6 依赖门控） | `executing`（依赖全部 approved 后可 start） |
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

- 当前协议版本：`v1.8`（向下兼容 v1.5 / v1.6 / v1.7；**v1.5 线性为默认**，v1.6 / v1.7 / v1.8 均继承 DAG 并发调度，面板顶栏 Protocol Selector 切换，`localStorage` 记忆，见 5.11）
- v1.5 新增（协议级）：审核三级降级链（外部 AI → 对话模型 → 手动）、Step 字段 `artifact_required`、审核来源 `reviewedBy`、一键收口语义；与 v1.3 / v1.4 完全向下兼容。
- v1.6 新增（协议级）：Step List 并发调度——steps 元素新增 `depends_on`（前置依赖）与 `parallel_group`（并发组标记）、依赖门控 + 多步并行状态机、唤醒并发清单（⚡ 可并行启动 / 🔒 等待中）；与 v1.5 完全向下兼容。
- v1.7 新增（协议级）：steps 元素新增 `alternatives`（候选方案数组）与 `importance`（high / medium / low 步骤权重）、planning 双向探讨、5 段式打包模板、artifacts 前置校验（详见 3.15）；与 v1.5 / v1.6 完全向下兼容。
- v1.8 新增（协议级）：**混合模式与执行/审核分工**——`importance` 从审核权重提示升级为分工契约（`low` 主 agent 直做免外部审 / `medium` 批量轻审 / `high` 三方严格审 / 缺省 `null` 普通步骤）；`review:false` 硬开关与 `importance` 解耦（显式 `review:false` 无条件绕过审核，`review:true` 强制走审核）；`reviewedBy` 新增 `mainagent` 自动豁免来源；三处边缘微调（Step List 重构状态隔离、批量审核原子打回、5 段式打包模板缺省对齐，详见 3.16）；与 v1.5 / v1.6 / v1.7 完全向下兼容。
- **v1.5 兼容**：v1.5 模式下忽略 `depends_on` / `parallel_group`，按线性顺序执行；外部 AI 即使误带这两个字段也自动降级为顺序执行。
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

### 3.13 Step List 并发调度（v1.6）

v1.6 在 v1.5 线性执行之上引入**并发调度**：steps 元素新增两个可选字段，后端按依赖关系做门控与就绪计算，多个步骤可同时处于 `executing` / `review`。

- **`depends_on`（前置依赖，可选）**：数组，元素为步骤 id；空数组 / 缺省 = 无依赖。v1.5 模式下忽略。
- **`parallel_group`（并发组标记，可选）**：同组且依赖满足 → 可并行；`null` / 缺省 = 串行。v1.5 模式下忽略。

示例：

```json
{
  "id": 4,
  "title": "前端审核面板开发",
  "detail": "依赖后端状态锁接口",
  "review": true,
  "depends_on": [1],
  "parallel_group": "A"
}
```

- **依赖门控**：`start` 某步时，若其 `depends_on` 中的前置步骤尚未全部 `approved` → 状态置为 `blocked`，并记录 `waitingFor`（未满足的前置步骤列表）；前置全部 `approved` 后再 `start` 才进入 `executing`。
- **就绪计算（`readySteps`）**：所有前置已 `approved` 且未完成的步骤即为就绪；v1.6 下**多个 step 可同时处于 `executing` / `review`**（v1.5 下每次只允许一个执行中步骤）。
- **多步并行状态机**：每步独立走 `pending → executing → review → approved / rejected`；整体 `done` 仍需全部步骤 `approved`。
- **唤醒并发清单**：v1.6 下某步 `approved` 后，唤醒主 agent 时输出并发清单：

```text
⚡ 可并行启动：Step 1（组A）、Step 4（组A）→ 建议用 subagent 并发执行
🔒 等待中：Step 2（依赖 1,4）、Step 3（依赖 2）
```

  ⚡ 项为依赖已满足、可立即并行启动的步骤；🔒 项为仍被前置依赖阻塞的步骤及其依赖说明。
- **审核独立**：并发组内**每步各自独立审核**，三级降级链（外部 AI → 对话模型 → 手动）与 `reviewedBy: external | dialog | manual` 记录保持不变，互不影响。
- **执行主体**：插件负责调度建议（并发清单）、状态机、依赖门控与唤醒升级；**实际并行由主 agent 用 dsh 原生 subagent 执行**（如同 v0.9.0 那次三路并发开发），插件给出建议与状态约束，主 agent 决定是否派发 subagent 并行执行。
- **外部 AI 文本规范**：计划文本中标注并发拓扑，例如：

```text
[Step 1] (⚡ 可并发 · 组A) 后端状态锁实现
[Step 2] (🔒 串行 · 依赖 Step 1,4) 前端审核面板开发
```

约束：

- v1.5 模式下 `depends_on` / `parallel_group` 被忽略，所有步骤按线性顺序执行（外部 AI 即使误带也自动降级为顺序）。
- 与 v1.5（及 v1.3 / v1.4）完全向下兼容。

### 3.15 多方案比较与步骤权重（v1.7）

v1.7 在 v1.6 并发调度之上引入**多方案比较**与**步骤权重**，并把 planning 从单向探路升级为**双向探讨**；同时给出 5 段式打包模板与 artifacts 前置校验，消除外部 AI 信息真空与打回重试。

**3.15.1 `alternatives` 多方案比较（P1）**

- **字段**：steps 元素新增可选数组 `alternatives`，元素结构 `{ label, risk, reason }`：
  - `label`：候选方案名称 / 一句话描述
  - `risk`：该方案的主要风险
  - `reason`：选择依据（第一手文件依赖 / 运行时约束）
- **提候选**：主 agent 在 planning / 打包阶段，依据**第一手文件依赖与运行时约束**提出 **2~3 套候选方案**，随打包上下文或双向探讨一并交给外部 AI。
- **择优**：外部 AI 评估候选方案择优，并可**在线重构 Step List**（增删改步骤、替换对应方案的步骤实现）。
- **意义**：把「方案分歧」显式建模为可比较数据，避免外部 AI 在信息真空下拍板。

**3.15.2 `importance` 步骤权重（P2）**

- **字段**：steps 元素新增可选 `importance: high | medium | low`（缺省视为 `medium`）。
- **批量合并自动审核**：`low` / `medium` 步骤可**批量合并自动审核**——一次审核多个步骤（提交时附带多步 notes / artifacts / 轨迹摘要），显著减少审核 turn 数（见 5.12）。
- **折叠显示**：`low` 步骤默认折叠显示（面板仅显示标题行，展开可见 detail / acceptance / notes）。
- **联动**：`high` 步骤保持逐步独立审核；权重与批量审核、降本模型（见 6.8）联动。

**3.15.3 planning 双向探讨（P3）**

- v1.4 的 planning 为**单向探路**（外部 AI 通过 `context_requests` 请求主 agent 只读探路）；v1.7 升级为**双向探讨**：
  - 主 agent 在 planning 阶段**主动发问 / 探路对话**：提出候选方案（含 3.15.1 的 `alternatives`）、澄清约束、指出运行时限制。
  - **复用打包通道**（📦 打包上下文）承载双向消息，不新增专用协议动作。
- 约束不变：planning 阶段仍仅允许只读探路，严禁修改代码。

**3.15.4 5 段式打包模板（P4）**

- v1.7 起 `packContext` 注入 **5 段标准上下文**，由主 agent 依据第一手探查结果**预填**，消除外部 AI 信息真空：

| 段 | 键 | 内容 |
|---|---|---|
| 1 | `data_schema` | 涉及的数据结构与文件格式（读到的实际 schema） |
| 2 | `pricing_map` | 成本 / 价格映射（涉及定价或配额时） |
| 3 | `mount_points` | 文件 / 目录挂载点与写入边界 |
| 4 | `runtime_limits` | 运行时约束（超时、并发、资源限制） |
| 5 | `history_trace` | 最近轨迹 / 决策历史摘要 |

- 未涉及的段明确标注「无 / 未涉及」，外部 AI 无需盲猜。

**3.15.5 artifacts 前置校验（P5）**

- v1.7 起，步骤进入 `review` **之前**强制校验：`artifacts` 非空且实体存在（文件 / 产物在磁盘上可读）。
- 校验不通过 → 后端返回 `artifactsWarning` 提示（打回前提醒主 agent 补齐产出物），避免「审核打回 → 补产物 → 重新 review」的来回 turn。
- `artifact_required: false`（v1.5）的纯分析 / 规划步骤仍不强制要求实体产物。

约束：

- v1.5 / v1.6 模式下忽略 `alternatives` / `importance` 与双向探讨语义，行为不变；v1.7 下 `importance` 作为审核权重提示（批量合并自动审核），v1.8 起升级为执行与审核分工契约（见 3.16）。
- 与 v1.5（及 v1.3 / v1.4）完全向下兼容。

### 3.16 混合模式与执行/审核分工（v1.8）

v1.8 在 v1.7 多方案比较与步骤权重之上引入**混合模式**：`importance` 从「审核权重提示」升级为「执行与审核分工契约」，配合 `review` 硬开关与 `reviewedBy: 'mainagent'` 自动豁免来源，形成 low 免审、medium 批量轻审、high 三方严格审的分层协作，并落地三处边缘微调。

**3.16.1 `importance` 分工契约**

| 取值 | 分工 | 审核路径 |
|---|---|---|
| `low` | 主 agent 直做，免外部审 | 主 agent `complete` 时系统自动置 `approved`，`reviewedBy: 'mainagent'`，留审计、不破坏 `pending → executing → approved` 状态机 |
| `medium` | 批量轻审 | `batchStepIds` 一次提交多个步骤合并审核（沿用 3.15.2 / 5.12 批量通道） |
| `high` | 三方严格审 | 单独提交，走外部 AI → 对话模型 → 手动三级降级链（见 3.12），逐步独立审核 |
| `null`（缺省） | 普通步骤 | 按既有默认策略处理 |

**3.16.2 `review:false` 硬开关（与 `importance` 解耦）**

- `importance` 管**分工与默认审核策略**；`review`（Boolean）管**底层审核流水线硬开关**，两者解耦。
- 未显式指定 `review` 时，按 `importance` 自动映射：`low` → 自动 approved。
- 显式 `review: false` → **无条件绕过审核**：`complete` 即 `approved`（`reviewedBy: 'mainagent'`），即使 `importance: high` 也生效。
- 显式 `review: true` → **强制走审核**：即使 `importance: low` 也进入审核流水线。

**3.16.3 `reviewedBy` 新增 `mainagent` 来源**

- `reviewedBy` 取值扩展为 `external | dialog | manual | mainagent`；`mainagent` 表示主 agent 自动豁免（low 免审 / `review: false` 直过）。
- 一键收口汇总审核来源时，`mainagent` **单列**，与 external / dialog / manual 区分展示。

**3.16.4 三处边缘微调**

- **① Step List 重构状态隔离**：外部 AI 经 `alternatives` 择优后重构 Step List，**仅对未完成（`pending` / `rejected`）步骤生效**；已 `approved` 历史步骤与产物严禁清除/篡改。新增端点 `POST /dsh-web-relay/steps/restructure`，**合并式重构**，返回 `changes { updated, added, removed, untouchedApproved }`。
- **② 批量审核原子打回**：`batchStepIds` 批量审核按**原子操作**——任一步骤 `rejected` → 该 batch 内所有步骤统一退回 `rejected`；主 agent 分别补证据后重提。
- **③ 5 段式打包模板缺省对齐**：`data_schema` / `pricing_map` / `mount_points` / `runtime_limits` / `history_trace` 固定键名；某项不适用时**显式填 "N/A" 或 "none"**，严禁省略字段。

约束：

- v1.5 / v1.6 / v1.7 模式下不启用混合分工语义（`importance` 仍按 v1.7 权重提示处理；`reviewedBy: 'mainagent'`、`restructure`、原子打回不生效），行为不变。
- 与 v1.5（及 v1.3 / v1.4 / v1.6 / v1.7）完全向下兼容。

**3.16.5 V1.8.1 澄清（协议级，版本号保持 v1.8）**

经三方协作双视角评估与外部 AI 评审定案（expr-2026-08-26_13-16-32 / 13-37-24 / 13-49-58），补充以下边界澄清：

1. `reviewSpecified` 判定：以 `typeof step.review === 'boolean'` 为准；`review: null` 或字段缺失一律视为未显式指定（`reviewSpecified = false`），按 `importance` 映射；外部 AI 严禁用 `review: null` 表达显式意图，必须输出 `boolean` 或直接省略该键。
2. 安全护栏优先：`review: false` 仅表示跳过三方/人类审核流（直接置 approved）；主 agent 本地安全护栏（危险命令拦截、越界文件读写策略）为运行时最高级硬约束，优先级高于任何协议参数，不得因 `review: false` 解除。
3. 打回副作用：批量打回仅倒转步骤状态并清空 `reviewedBy`，不触发代码回滚；重提时针对拒收意见补证据/微调即可；被打回步骤的下游依赖自动闭锁。
4. 重构作用域：`restructure` 仅允许修改/删除 `pending` 与 `rejected` 步骤，`approved` 步骤与产物严禁篡改；被删除/替换步骤记录于 `changes.removed` 并写入 trace 留痕；物理中间产物清理属主 agent 执行纪律。
5. 拓扑继承：重构后的 `pending` 步骤允许在 `depends_on` 中引用历史 `approved` 步骤，门控按新拓扑计算，已有 `approved` 状态不受影响。
6. 悬空依赖校验：`restructure` 服务端校验所有 `depends_on` 引用，指向已删除步骤时返回 **400**（拒绝本次重构）。
7. `reviewedBy` 清空：步骤被打回（单步打回、自动审核打回、批量连带打回）时清空 `reviewedBy`（置 `null`），重新审核通过后再记录审核来源。

---

## 4. 实际实现（1.2.1）

> 以下内容来自当前安装源码。

### 4.1 安装位置

```text
C:\Users\Administrator\.dsh\profiles\web\node_modules\dsh-web-relay
```

### 4.2 关键文件

| 文件 | 作用 |
|---|---|
| `package.json` | 插件元数据，version 1.2.1 |
| `lib/index.js` | 后端：协议常量、路由、Step List 状态机（含 v1.6 依赖门控与并发调度、v1.8 混合模式与 restructure）、trace 读写 |
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
POST /dsh-web-relay/steps/restructure  （v1.8 合并式重构）
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

### 4.8 v1.0.0 升级内容

v1.0.0 在 v0.9.0 之上新增（协议升级至 v1.6 并发调度，详见 3.13）：

- **M1 协议版本选择**：面板顶栏 Protocol Selector 可选 `v1.5 线性` / `v1.6 DAG 并发`，`localStorage`（`dsh-web-relay:protocol-version`）记忆，发起协作前选择
- **M2 Step List 并发调度**：steps 元素新增 `depends_on` / `parallel_group`；v1.6 下依赖门控 + 多步并行状态机；v1.5 下字段忽略、按线性执行（向后兼容）
- **M3 依赖门控与就绪计算**：`start` 前置依赖未全部 `approved` → `blocked` + `waitingFor`；后端计算 `readySteps`，多个 step 可同时 `executing` / `review`
- **M4 唤醒并发清单**：v1.6 下 `approved` 后输出 ⚡ 可并行启动 / 🔒 等待中 清单，建议主 agent 用 subagent 并发执行
- **M5 审核独立**：并发组内每步各自走三级降级链（external → dialog → manual）并记录 `reviewedBy`，互不影响
- **M6 packContext 按版本注入 directive**：v1.5 要求外部 AI 输出线性 steps；v1.6 要求外部 AI 分析模块独立性、用 `parallel_group` + `depends_on` 标注拓扑
- **执行主体**：插件负责调度建议 + 状态机 + 依赖门控；实际并行由主 agent 用 dsh 原生 subagent 执行

### 4.9 v1.1.0 升级内容

v1.1.0 在 v1.0.0 之上新增（协议升级至 v1.7，详见 3.15）：

- **P1 alternatives 多方案比较**：steps 元素新增 `alternatives`（`{label, risk, reason}` 候选数组）；主 agent 在 planning / 打包时提 2~3 套候选（依据第一手文件依赖 / 运行时约束），外部 AI 评估择优并可**在线重构 Step List**
- **P2 importance 步骤权重**：steps 元素新增 `importance: high|medium|low`；low / medium 步骤可**批量合并自动审核**（一次审多个），low 步骤默认折叠显示
- **P3 planning 双向探讨**：主 agent 主动探路对话（由外部 AI 单向 `context_request` 升级为双向），复用打包通道
- **P4 5 段式打包模板**：packContext 注入 `data_schema` / `pricing_map` / `mount_points` / `runtime_limits` / `history_trace` 五段标准上下文，消除外部 AI 信息真空
- **P5 artifacts 前置校验**：置 `review` 前强制校验 artifacts 非空 + 实体存在，后端响应 `artifactsWarning` 提示，避免打回往返
- **P6 工具调用批量化**：合并工具调用减少 turn 数（多步骤 turn 成本 = 单 turn × n）
- **P7 增量 Trace 上报**：重提 / 回写轨迹用 Diff 增量或凭证摘要
- **P8 依赖链合并准则**：轻量无独立依赖步骤可合并；有硬依赖的强保留独立
- **P9 并行 subagent 组内独立上下文**：并发组内每个 subagent 独立上下文，互不污染

> 降本主线：P2 / P4 / P5 / P6 / P7 / P8 均以**减少 API 交互总 Turn 数**为目标（详见 6.8 降本模型）。

### 4.10 v1.2.0 升级内容

v1.2.0 在 v1.1.0 之上新增（协议升级至 v1.8 混合模式，详见 3.16）：

- **H1 混合模式分工契约**：`importance` 升级为执行与审核分工——`low` 主 agent 直做免外部审（`complete` 自动 `approved`）、`medium` 批量轻审（`batchStepIds` 一次提交多个）、`high` 三方严格审（单独提交，走三级降级链）；缺省 `null` 普通步骤
- **H2 `review:false` 硬开关**：`review`（Boolean）与 `importance` 解耦——显式 `review: false` 无条件绕过审核（即使 `importance: high`），显式 `review: true` 强制走审核（即使 `importance: low`）；未显式指定时按 `importance` 自动映射（`low` → 自动 approved）
- **H3 后端自动豁免**：`reviewedBy` 新增 `mainagent` 来源；主 agent `complete` 时 `low` / `review: false` 步骤自动置 `approved`，留审计、不破坏 `pending → executing → approved` 状态机；收口汇总对 `mainagent` 单列
- **H4 批量审核原子打回**：`batchStepIds` 按原子操作——任一 rejected → 整批统一退回 `rejected`，主 agent 分别补证据后重提
- **H5 restructure 端点**：新增 `POST /dsh-web-relay/steps/restructure`——外部 AI 经 `alternatives` 择优后的合并式重构，仅对未完成（`pending` / `rejected`）步骤生效，返回 `changes { updated, added, removed, untouchedApproved }`；已 `approved` 历史步骤与产物严禁清除/篡改
- **H6 5 段式打包模板缺省对齐**：`data_schema` / `pricing_map` / `mount_points` / `runtime_limits` / `history_trace` 固定键名，不适用时显式填 "N/A" 或 "none"，严禁省略字段
- **H7 前端**：协议选择器支持 v1.8 混合模式、importance 徽标与 low 免审状态展示、`mainagent` 审核来源徽标、restructure 重构 UI（仅动 `pending` / `rejected` 步骤）
- **H8 文档**：本说明书与 README 同步更新至 v1.8 / 1.2.0，新增 `releases/v1.2.0/RELEASE_NOTES.md`

> 降本主线：H1 的 `low` 免审正式化——每个 low 步骤省 1 次审核 turn；混合模式为未来主形态（纯三方 35% / 混合 40% / 纯独立 25%，详见 6.8）。

### 4.11 v1.2.1 升级内容（V1.8.1 澄清）

v1.2.1 在 v1.2.0 之上新增（经三方协作双视角评估与外部 AI 评审定案，协议版本保持 v1.8，语义澄清见 3.16.5）：

- **V1 悬空依赖校验**：`POST /dsh-web-relay/steps/restructure` 在写盘前校验所有步骤 `depends_on` 引用，指向已删除步骤时返回 **400**（拒绝本次重构），防止拓扑悬空
- **V2 打回清空 reviewedBy**：步骤被打回（单步 `action=reject`、自动审核打回、批量原子打回连带）时 `reviewedBy` 置 `null`；`approved` 保留审核来源，重新审核通过后再记录
- **V3 协议/Skill 澄清**：`WEB_RELAY_PROTOCOL` 与 `WEB_RELAY_EXTERNAL_AI_SKILL`（中英）新增 v1.8.1 澄清条目（reviewSpecified 判定 / 安全护栏优先 / 打回副作用 / 重构作用域 / 拓扑继承 / 悬空校验 / reviewedBy 清空）
- **V4 状态同步**：`/status` 的 `version` 字段同步为 `1.2.1`（此前硬编码 `1.2.0`）
- **V5 文档**：README 与说明书版本号统一至 1.2.1；新增 `releases/v1.2.1/RELEASE_NOTES.md`

> 实测（expr-2026-08-26_14-16-21 Step 2）：悬空依赖返回 HTTP 400 + `dangling` 明细 ✓；`reject` 后 `reviewedBy=null` ✓；`review:false` + `importance:low` 自动 `approved` + `reviewedBy=mainagent` ✓。

---

## 5. 使用方法

> 本章基于 dsh-web-relay 1.2.1 实际功能编写。

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
- 协议版本选择器：顶栏 Protocol Selector 选择 `v1.5 线性` / `v1.6 DAG 并发`（当前协议 v1.8 兼容三者），`localStorage` 记忆，发起协作前选择（详见 5.11）
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
- importance 徽标：每个 Step 显示 `high` / `medium` / `low` 权重徽标，`low` 步骤默认折叠显示（详见 3.15.2）
- mainagent 徽标（v1.8）：`low` 免审 / `review:false` 步骤经主 agent 直过后显示 `mainagent` 审核来源徽标（详见 3.16.3）
- 批量自动审核：`low` / `medium` 的多个 `review` 步骤可一键批量审核（详见 5.12）
- 候选方案展示：planning / 打包阶段展示主 agent 提交的 `alternatives` 候选（2~3 套，含 label / risk / reason），外部 AI 择优后可在线重构 Step List（详见 3.15.1）
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

> v1.6 下：无依赖步骤可并发执行（后端给出 ⚡ 并发清单，主 agent 用 dsh 原生 subagent 并行执行），并发组内每步独立审核（详见 3.13）。

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

### 5.11 协议版本选择

- 面板**顶栏 Protocol Selector** 可在 **v1.5 线性 / v1.6 DAG 并发** 之间选择（当前协议 v1.8 兼容三者并自动叠加 v1.7 / v1.8 能力），**发起协作前**选定
- 选择通过 `localStorage` 持久化（键名 `dsh-web-relay:protocol-version`），刷新后保持
- **v1.5 线性**：纯串行 Step 1 → N，适用于单线开发、小修小补；忽略 `depends_on` / `parallel_group`
- **v1.6 DAG 并发**：依赖门控 + 多步并行，适用于大型重构、多模块/多文件解耦；依赖满足的步骤可并行执行，组内每步独立审核（详见 3.13）
- 📦 打包上下文按版本注入 directive：v1.5 要求外部 AI 输出线性 steps；v1.6 要求外部 AI 分析模块独立性、用 `parallel_group` + `depends_on` 标注拓扑；v1.8 要求外部 AI 生成 Step List 时标注 `importance`（high / medium / low）或显式 `review:false`（详见 5.15）

| 版本 | 调度 | 适用场景 |
|---|---|---|
| v1.5 线性 | 纯串行 Step 1 → N | 单线开发、小修小补 |
| v1.6 DAG 并发 | 依赖门控 + 多步并行 | 大型重构、多模块/多文件解耦 |
| v1.7 增强 | 在 v1.5 / v1.6 之上叠加 alternatives / importance / 双向探讨 | 方案分歧大、步骤多需合并审核 |
| v1.8 混合模式 | 在 v1.6 / v1.7 之上叠加 importance 驱动分工（low 免审 / medium 批量轻审 / high 三方严格审）+ `review:false` 硬开关 | 日常开发默认（降本主线，混合 40% 为主形态） |

### 5.12 批量自动审核（v1.7）

- **适用**：`importance: low` / `medium` 的多个 `review` 步骤（`high` 步骤保持逐步独立审核）
- **操作**：面板对可批量审核的步骤提供「批量自动审核」按钮，一键提交多个步骤
- **服务端**：一次调用按三级降级链（外部 AI → 对话模型 → 手动）审核多个步骤，提交时附带各步 notes / artifacts / 轨迹摘要；逐步写回 `approved` / `rejected` 与 `reviewedBy`
- **收益**：把「n 个步骤 × 每步 1 次审核 turn」合并为 1 次批量 turn，直接降低 API 交互总 Turn 数（详见 6.8）
- **前提**：批量中的每步均处于 `review`；任一自动通道不可用时降级到面板手动审核框

### 5.13 打包上下文模板（v1.7，5 段式）

- v1.7 起，📦 打包上下文按 **5 段标准模板**注入，由主 agent 依据第一手探查结果**预填**：

| 段 | 键 | 内容 |
|---|---|---|
| 1 | `data_schema` | 涉及的数据结构与文件格式 |
| 2 | `pricing_map` | 成本 / 价格映射（涉及定价 / 配额时） |
| 3 | `mount_points` | 文件 / 目录挂载点与写入边界 |
| 4 | `runtime_limits` | 运行时约束（超时、并发、资源） |
| 5 | `history_trace` | 最近轨迹 / 决策历史摘要 |

- 未涉及的段明确标注「无 / 未涉及」，外部 AI 无需盲猜
- 与 v1.5 / v1.6 的 directive（线性 steps / 并发拓扑标注）叠加输出（详见 3.15.4）

### 5.14 模式选择指南（三方协作 vs 主 agent 独立 vs 混合）

> 依据 step-value 开发实测（36 turns / $1.82）与 v1.8 降本模型整理，帮助用户按任务类型选择工作模式；混合模式已正式落定为 v1.8 协议语义（见 3.16 / 5.15）。

#### 1. 三种模式

| 模式 | 描述 | 典型场景 |
|---|---|---|
| **三方协作**（外部 AI + 主 agent + 子 agent） | 外部 AI 架构决策/审核，主 agent 编排，子 agent 并行执行 | 中大型功能开发、系统重构、新插件编写、多端协同 |
| **主 agent 独立** | 单主 agent 自治闭环，无跨体握手 | 局部微调、Quick Fix、脚本编写、单点调试 |
| **混合**（v1.8 importance 驱动分工） | 主 agent 直做 low（免审自动 approved）/ medium（批量轻审）步骤；high 步骤（架构/关键实现）走外部 AI 三方严格审 | 大部分日常开发（默认推荐） |

#### 2. 对比维度

| 维度 | 三方协作（v1.8） | 主 agent 独立 | 混合 |
|---|---|---|---|
| 质量上限 | 极高（外部 AI 架构 + artifacts 硬校验防空包） | 中等（单模型能力上限） | 高（关键步骤有外部 AI 把关） |
| 吞吐 | 极高（三路并发 + 依赖门控） | 一般（串行） | 中高 |
| **Turn / Token 成本** | 较高（握手/打包/审核/打回） | **极低**（Turn 最小化） | **低**（low 免审砍掉跨体开销，只对 high 步骤额外开销） |
| 失败/回滚风险 | 低（门控隔离，未过审不合并） | 中（改错需手动回退） | 低 |

#### 3. 成本拐点模型（关键认知）

实测两种模式的**每 turn 成本相同（≈ $0.05/turn）**——三方协作的"贵"**纯粹来自 turn 数多**（握手 + 打包 + 审核 + 打回 ≈ 额外 8-12 turn ≈ $0.4-0.6）。

**决策拐点**：仅当任务复杂度导致主 agent 独立执行的**弯路风险**（重做/改错）预期成本 > 额外 turn 成本时，三方协作才划算。

```
简单改动（改 CSS/加日志）   ：独立 3-5 turn  vs 三方 12-15 turn → 独立 / 混合
中大型任务（新插件/重构）   ：独立 30+ turn 且易走弯路 vs 三方 36 turn 有质量保证 → 三方 / 混合
```

#### 4. 推荐选择规则

1. **默认选混合**（v1.8 协议语义正式落定，见 3.16 / 5.15）：low 步骤主 agent 直做免审（`complete` 自动 `approved`，`reviewedBy: 'mainagent'`）、medium 批量轻审、high 步骤交外部 AI 三方严格审
2. **小型改动 / 快速试错**：主 agent 独立（成本最低）
3. **架构级 / 高质量要求**：三方协作（质量与吞吐优先）
4. **成本敏感**：保持会话连续（cacheRead 复用 $0.00007/1K 超低价）、多用 `importance: low` / `review: false` 免审、开启批量审核、依赖 artifacts 前置校验防打回

#### 5. 使用分布参考

```
纯三方 35% │ 混合 40% │ 纯独立 25%
```

混合模式为未来主形态（40%）：v1.8 起已正式落定为协议语义——`importance: low` 免审自动 approved（`reviewedBy: 'mainagent'`），不再只是「审核权重提示」；既保留三方协作的质量上限（high 架构把关），又砍掉低价值步骤的跨体开销（每个 low 步骤省 1 次审核 turn）。

### 5.15 混合模式操作指南（v1.8）

> v1.8 混合模式已正式落定为协议语义：`importance` 驱动执行与审核分工，`review` 硬开关与 `importance` 解耦（协议规范见 3.16）。

#### 1. 声明分工（外部 AI 生成 Step List 时）

外部 AI 在 `steps` 元素中按分工标注 `importance`（或显式 `review`）：

| 声明 | 分工效果 |
|---|---|
| `"importance": "high"` | 三方严格审：单独提交，走外部 AI → 对话模型 → 手动三级降级链 |
| `"importance": "medium"`（或省略） | 批量轻审：`batchStepIds` 一次提交多个步骤合并审核 |
| `"importance": "low"` | 主 agent 直做免外部审：`complete` 自动 `approved` |
| `"review": false` | 无条件绕过审核（即使 `importance: high`），`complete` 即 `approved` |
| `"review": true` | 强制走审核（即使 `importance: low`） |
| 缺省（`importance` 为 `null`） | 普通步骤，按默认策略处理 |

> 未显式指定 `review` 时按 `importance` 自动映射：`low` → 自动 approved。

#### 2. low 免审流程

1. 步骤声明 `importance: low`（或显式 `review: false`）
2. 主 agent 执行该步骤，`complete` 时系统**自动置 `approved`**（`reviewedBy: 'mainagent'`，留审计）
3. 无需进入三级降级链，不消耗外部 AI / 对话模型审核 turn
4. 一键收口汇总审核来源时，`mainagent` 单列显示

#### 3. 批量轻审与原子打回处理

1. `medium` 步骤置 `review` 后，在面板勾选多个步骤，点「批量自动审核」一次提交（`batchStepIds`）
2. 批量按**原子操作**审核：任一步骤 `rejected` → 该 batch 内所有步骤统一退回 `rejected`
3. 主 agent 对打回步骤**分别补证据**后重提（每个步骤独立补充 notes / artifacts，再重新进入审核）

#### 4. restructure 重构用法

1. 外部 AI 经 `alternatives` 择优后，可经 `POST /dsh-web-relay/steps/restructure` 发起**合并式重构**
2. 重构**仅对未完成（`pending` / `rejected`）步骤生效**；已 `approved` 历史步骤与产物严禁清除/篡改
3. 后端返回 `changes { updated, added, removed, untouchedApproved }`，可核对本次改动面
4. 重构完成后继续执行与审核流程

#### 5. 5 段模板 N/A 约定

📦 打包上下文 5 段固定键名：`data_schema` / `pricing_map` / `mount_points` / `runtime_limits` / `history_trace`。某项不适用时**显式填 "N/A" 或 "none"**，严禁省略字段（详见 3.16.4 ③ / 5.13）。

---

## 6. 开发者扩展

> 本章属于开发者扩展指南，基于当前 1.2.1 实际实现；协议规范以第 3 章为准（v1.3 起，含 v1.5 / v1.6 / v1.7 / v1.8）。

### 6.1 扩展总览

dsh-web-relay 的扩展点主要位于：

- 后端 `lib/index.js`：路由、Channel/LLM 适配、Step List 状态机、Trace 存储
- 前端 `lib/client.js`：面板 UI、事件钩子、与后端 API 交互
- 数据目录 `web-relay/`：任务记录、步骤状态、三方轨迹

扩展时应保持：

- 协议规范与实现分离
- 状态机语义与 v1.3 一致（v1.6 扩展依赖门控与多步并行，v1.7 扩展 importance 批量审核与 artifacts 前置校验，v1.8 扩展混合模式分工与 review 硬开关）
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

当前 1.2.1 已提供自动审核接口：

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
- v1.6 下多个步骤可同时处于 `review`：指定 `stepId` 定位目标步骤，并发组内每步独立审核（详见 3.13「审核独立」）
- v1.7 下 `low` / `medium` 步骤可批量合并审核，一次调用审核多个步骤（详见 5.12）
- **主 agent 自动豁免（v1.8）**：`importance: low` 或显式 `review: false` 的步骤，主 agent `complete` 时后端自动置 `approved`（`reviewedBy: 'mainagent'`，留审计、不破坏 `pending → executing → approved` 状态机），无需进入三级降级链；显式 `review: false` 即使 `importance: high` 也直过（详见 3.16）

使用前提：

- 外部 AI 通道需配置 `GEMINI_API_KEY`；未配置或失败时自动降级到对话模型 / 手动审核框
- 当前 Step 必须处于 `review` 状态

### 6.8 降本模型（v1.8）

**每-turn 固定成本模型（实测）**：

- 每个 API 交互 turn 的成本 ≈ **$0.05 恒定**（cacheRead ~700K token 占大头但单价低）
- 结论：**精简单次文本收益有限；降本第一优先级 = 减少 API 交互总 Turn 数**

降本策略（按优先级）：

1. **工具调用批量化（P6）**：多步骤 turn 成本 = 单 turn × n；把多次独立工具调用合并进同一 turn，直接降低 n
2. **artifacts 前置校验（P5）**：置 `review` 前校验 artifacts 非空 + 实体存在（后端 `artifactsWarning` 提示），避免「打回 → 补产物 → 重新 review」的来回 turn
3. **轻量步骤合并审核（P2）**：`low` / `medium` 步骤批量合并自动审核（一次审多个，见 5.12）；`high` 保持逐步独立
4. **依赖链合并准则（P8）**：轻量、无独立依赖的步骤可合并为一步；有硬依赖（下游强依赖其产出）的步骤**强保留独立**，避免合并后返工
5. **增量 Trace 上报（P7）**：重提 / 回写轨迹用 Diff 增量或凭证摘要，避免整段轨迹重复上报
6. **subagent 上下文隔离（P9）**：并行组内每个 subagent 独立上下文，互不污染，避免跨组上下文膨胀推高 cacheRead
7. **low 免审（v1.8 混合模式）**：`importance: low` / 显式 `review: false` 步骤由主 agent 直做免外部审（`complete` 自动 `approved`，`reviewedBy: 'mainagent'`）——**每个 low 步骤省 1 次审核 turn**；混合模式已正式落定为未来主形态（纯三方 35% / 混合 40% / 纯独立 25%，详见 3.16 / 5.15）

> 目标：把审核 / 执行 turn 从「每步 1 次」压到「low 免审 0 次 + 可合并步骤批量 1 次 + 必须独立的高权重步骤各自 1 次」，总 Turn 数下降即成本同比下降。

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

dsh-web-relay 1.2.1 已实现：

- v1.8 协议（v1.3 Step List 基础 + v1.4 Planning + v1.5 审核降级链 + v1.6 Step List 并发调度 + v1.7 多方案比较与步骤权重 + v1.8 混合模式分工）
- v1.5 线性为默认、v1.6 / v1.7 / v1.8 均继承并发调度，多版本向后兼容
- Step List 状态持久化
- 逐步执行与外部 AI 审核（三级降级：外部 AI → 对话模型 → 手动）
- 依赖门控 + 多步并行（`depends_on` / `parallel_group`、`readySteps`、`blocked` / `waitingFor`）
- 唤醒并发清单（⚡ 可并行启动 / 🔒 等待中），主 agent 用 dsh 原生 subagent 并行执行
- 多方案比较（`alternatives`）与步骤权重（`importance`）批量合并审核（v1.7）
- 混合模式分工（v1.8）：`importance` 驱动执行与审核分工——low 免审（`complete` 自动 approved，`reviewedBy: 'mainagent'`）/ medium 批量轻审 / high 三方严格审；`review:false` 硬开关与 `importance` 解耦（显式 `review:false` 无条件绕过审核）
- Step List 重构状态隔离（v1.8）：`POST /dsh-web-relay/steps/restructure` 合并式重构，仅动未完成（`pending` / `rejected`）步骤，返回 `changes { updated, added, removed, untouchedApproved }`，已 approved 历史步骤与产物严禁清除/篡改
- 批量审核原子打回（v1.8）：`batchStepIds` 任一 rejected → 整批统一退回，主 agent 分别补证据后重提
- 5 段式打包模板缺省对齐（v1.8）：`data_schema` / `pricing_map` / `mount_points` / `runtime_limits` / `history_trace` 固定键名，不适用时显式填 "N/A" 或 "none"
- planning 双向探讨（P3）、5 段式打包模板（P4）、artifacts 前置校验（P5）
- 降本模型：每-turn 固定成本 ≈ $0.05，减少 API 交互总 Turn 数为第一优先级（工具批量化 / 批量审核 / 前置校验 / 增量 Trace / 依赖链合并 / subagent 上下文隔离）
- rejected 重试
- 三方轨迹可追溯
- 自动审核接口 `/dsh-web-relay/steps/auto-review`、一键收口接口 `/dsh-web-relay/steps/finalize`
- 审核面板化 + 一键收口、流程进度看板、智能上下文打包、语言中/英切换、顶栏协议版本选择

当前可通过面板「自动审核」触发三级降级审核；未配置 `GEMINI_API_KEY` 时自动降级到对话模型或面板内手动审核框；v1.8 下 `importance: low` / `review: false` 步骤由主 agent 直做免审，不进入降级链。
