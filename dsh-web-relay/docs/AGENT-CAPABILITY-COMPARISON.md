# dsh-web-relay + 主 agent 体系 vs Claude Code 能力对比分析

> 版本：v4.9.2（2026-09-07，混合架构 + 三方协议方式：Claude 自述 [lx-cc-selfdescribe] + 主 agent 盘点 + 外部 AI 评审）
> 目的：客观对比「dsh-web-relay 三方协议 + 主 agent（deepseek harness 会话）」与「Claude Code（WSL headless）」的能力——差距、超越、实现方式多样性。

## 0. 对比对象定义

| 侧 | 定义 |
|---|---|
| **A：dsh-web-relay + 主 agent 体系** | harness 主 agent 会话（deepseek-v4-flash，全工具）+ dsh-web-relay 插件（三方协议 v2.0 / Step List 状态机 / 审核链 / 续跑 / 心跳 / 面板）+ 能力持久化体系（lessons/registry/skills/runbook）|
| **B：Claude Code** | WSL headless `claude -p`（Pro firstParty，2.1.251），runner.sh 契约驱动（acceptEdits + Read/Write/Bash，timeout 900s），kind=implement/review/understand |

## 1. A 侧能力盘点（主 agent + 体系）

### 1.1 多角色协作制度化（B 侧没有）
- 三方协议 v2.0：用户 / 主 agent / 外部 AI 角色分工，外部 AI 每次调用注入完整协议（v2.0 全量）
- 审核链 v2.0：external(Gemini) → web-gemini → claude-code → dialog → manual 五级降级 + reviewedBy 审计溯源
- Swarm 双角色盲审（Security-Auditor + Refactoring-Architect）+ 共识合成

### 1.2 任务状态机（B 侧没有）
- Step List：pending/executing/review/approved/rejected + depends_on 依赖门控 + parallel_group 并发 + 批量审核原子打回
- restructure 在线重构 + AutoIteration 版间门 + 连续打回熔断（≥3 paused）

### 1.3 记忆与能力持久化（B 侧跨任务无记忆）
- lessons 37（错误复盘，跨会话检索）、registry 17（能力索引 + verification 自动校验）
- skills 3（harness 热读，裸会话可 skill 加载）、runbook §2.7 纪律、CC-HYBRID §6
- 裸会话能力：新对话读 registry/runbook/skill 即恢复协作 SOP（cap_4 实证）

### 1.4 宿主运维与自主性（B 侧无宿主概念）
- watchdog 自愈托管（Windows 计划任务 / Linux systemd）+ kill-host/restart-sync
- 无介入续跑：sessionId 注入 + 心跳双保险（重启/时间双驱动，零用户输入实证 2 次）
- 续跑状态机：restartCount/bootId 打戳/熔断

### 1.5 harness 工具集（B 侧仅 Read/Write/Bash）
- 子代理并发（subagent 并行任务）、workflow 编排（多 agent 扇形）、goal 多回合自主、后台 job、web_search
- 面板 UI：Step List/审核徽标（含 claude-code 橙色）/通道选择器/回放/健康灯
- 混合架构接入：cc-channel 把 B 侧作为协议内审核通道（reviewChannel=claude-code）

## 2. B 侧自述（Claude Code 第一手，lx-cc-selfdescribe 2026-09-07）

**A 任务执行**：中小型编码/评审/脚本/文档分析；900s 总超时 + Bash 单次 ≤600s；无跨进程续接，超长需拆任务。[实测]

**B 工具与权限**：仅 Read/Write/Bash（白名单）；无 Glob/Grep/Web；acceptEdits≠免批命令（命令放行靠 allowedTools）；无 GUI/常驻（定时靠外部 cc-watchdog 轮询）。[实测] 自述「实际可见工具多于白名单（Agent/ToolSearch/MCP claude-step-relay）」——宿主环境注入的外部能力，非模型固有机制（它如实区分）。[实测-异常]

**C 记忆**：每次全新进程，无跨任务记忆；唯一「记忆」= 磁盘产物（下任务被要求读才间接续接）。[实测]

**D 协作**：能读 task.json 契约/CC-HYBRID/runbook 并判断定位；可承担 kind=review 审方（实证 refs 污染缺陷）；无法主动联系主 agent——只能写文件单向交互，无原生多 agent 通信。[实测]

**E 自主性**：单任务 ≤15min；失败 result.json failed 触发主 agent 降级（自身感知不到）；配额 429 由外层处理；安全靠 acceptEdits+allowedTools + 自我识别拒绝越界（demo1 先例）。[实测]

**F 体系差异**：无跨会话心跳/面板/steps.json 状态机/三方轨迹（每次新进程从零开始）；相对优势 = 单会话内直接读写代码 + Bash 即时验证，链路短、延迟低。[实测]

**G 独特价值**：①文件系统直操作 + Bash 即时自证闭环 ②审方实证价值（refs 污染缺陷漏检）③契约驱动可插拔，失败整体退回不侵入主体。
**短板**：①无跨任务记忆/续跑，感知不到被降级 ②无原生状态机/面板/审计（需宿主外挂）③900s 硬超时 + 三工具白名单，不适合长期驻留/多轮交互。

## 3. 对比矩阵（差距 / 超越 / 实现方式多样性）

| 维度 | A：体系化（协议+状态机+持久化）| B：Claude Code（单体契约 agent）| 关系 |
|---|---|---|---|
| 任务覆盖面 | 全 harness 工具 + 协议化协作 + 面板 | 编码/审查/脚本/分析（白名单内）| A 覆盖更广；B 白名单内执行 |
| 单点质量（推理/代码）| deepseek-v4-flash | Claude 模型（更强推理/代码）| **B 超越**（单点）|
| 协作 | 多角色三方协议 + 审核链 + Swarm | 无原生多 agent；单向文件交互 | **A 超越**（制度化）|
| 记忆/能力持久化 | lessons 37/registry 17/skills/runbook，跨会话 | 无跨任务记忆（磁盘产物间接）| **A 超越** |
| 自主长任务 | goal/心跳/续跑/watchdog 自愈，零输入实证 | 单任务 ≤15min，无续接 | **A 超越** |
| 状态机/审计 | Step List + steps.json + 三方轨迹 + 面板 | 无原生（需宿主外挂）| **A 超越** |
| 执行链路 | 协议往返（长）| 文件直操作 + Bash 即时验证（短）| **B 超越**（低延迟闭环）|
| 实现方式多样性 | 多角色协议化 + 状态机 + 面板 + 运维 + 持久化 五层架构 | 单一契约 agent 插拔 | **A 超越**（架构维度）|
| 失败/降级 | 审核链五级降级 + 熔断 + 续跑 | result.json failed → 外层降级（不自知）| **A 超越**（可观测）|
| 安全拦截与审计追溯 | 显式护栏（/parse 预览、危险命令拦截、v1.8 硬约束）+ 三方轨迹落盘可回溯 | 终端 Hook/交互确认，拦截隐式、轨迹难跨系统回溯 | **A 超越** |
| 成本结构与配额弹性 | 多源挂载（网页版/免费 API/降级通道），弹性 | 纯订阅/Token 强依赖 + Rate Limit | **A 超越**（弹性）|
| 能力演进与解耦度 | 协议与模型层解耦，v2.0 五级链可插拔新通道 | 深度绑定 Anthropic 生态演进 | **A 超越**（解耦）|
| 复杂度上限 | 跨会话多回合状态收敛、上下文恢复、长链自愈 | 单回合内深层代码改写与逻辑审查深度 | 互补（不同量纲）|
| 成本 | 订阅/API 混合 | Pro 订阅（自动化配额有限）| 依场景 |

## 4. 结论

**A 对 B 的差距（B 超越点）**：
1. **单点智能质量**：Claude 模型的代码/推理/审查深度（实证：refs 污染缺陷主 agent+单测漏检，Claude 审出）。
2. **执行闭环延迟**：文件直操作 + Bash 即时自证，无协议往返（适合「实现+验证」紧闭环）。注：A 侧 v1.8 low 免审 + v2.0 受控并发已大幅削减协议开销，非所有任务均高延迟往返（外部 AI 评审修正）。

**A 对 B 的超越（B 短板反衬）**：
1. **协作制度化**：三方协议 + 五级审核链 + Swarm 盲审——把「单人强」变成「多角色可审计」。
2. **记忆持久化**：lessons/registry/skills 让能力跨会话存活（B 每次从零）。
3. **自主性与可靠性**：goal/心跳/续跑/watchdog——零用户输入续跑实证 2 次；B 单任务硬超时且感知不到降级。
4. **实现方式多样性**：协议化 + 状态机 + 面板 + 运维 + 持久化五层，B 是单一可插拔单元。

**关键洞察——两者是互补而非替代**（混合架构价值实证）：
- A 提供**制度与骨架**（协议/状态机/记忆/运维），B 提供**单点强度**（强模型直执行）。
- **B（claude-code）已作为专有节点接入 A 的 v2.0 全角色降级链**（external → web-gemini → claude-code → dialog → manual）——B 既是 A 编排下的执行单元（kind=implement），也是 A 降级链中的高阶审核能力提供者（kind=review/understand，reviewChannel=claude-code）。
- 最佳实践 = A 编排 + B 执行/审方（本仓库实证链路）：Claude 实现 cc-channel/platform-ops/install.sh（代码质量高）+ Claude 审方抓 refs 缺陷 + Claude understand 自述/理解测试——**A 的制度让 B 的强度可插拔、可审计、可降级**；反之 B 的失败由 A 的五级链兜底（cc-unavailable → dialog/manual）。
- 复杂度上限互补：B = 单回合深层改写/审查深度；A = 跨会话多回合状态收敛 + 上下文恢复 + 长链自愈（外部 AI 评审修正）。
- 结论：**A（体系）在协作/记忆/自主/架构多样性/安全审计/成本弹性/演进解耦上全面超越 B；B（单体）在单点模型质量与低延迟执行闭环上超越 A——混合架构 = 用 A 的制度驾驭 B 的强度，用 B 的强度补 A 的单点，双向最优。**（外部 AI 评审 expr-2026-09-07_15-08-01 认可此定稿方向）

> 注：Claude 自述提及本会话可见 MCP `claude-step-relay` 等宿主注入工具——那是宿主环境对外挂 agent 的能力赋予，与 dsh-web-relay 协议体系无关（其已正确区分「外部能力 vs 模型固有机制」）。
