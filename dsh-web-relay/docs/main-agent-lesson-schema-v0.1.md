# dsh-web-relay · 主 agent 语境能力沉淀库（Lesson Schema）v0.1

> 配套：`main-agent-runbook-v0.1.md`。
> 目的：把只存在于历史会话语境中的主 agent 能力（判断、动作模式、仓库心智、陷阱）
> 变成**可入库、可注入、可复核**的条目，随插件分发——安装插件即恢复主 agent 协作能力，
> 不再每次像新员工。

---

## 1. 为什么需要沉淀（一次推理）

三方协作产品 = 代码（骨架）+ 协议（外部 AI 侧规则）+ 主 agent 执行能力。
前两者已随包分发；第三者当前 **100% 活在对话语境**里——每次新会话的主 agent
系统提示不含 dsh-web-relay 协议，唤起文本（handoff）只有路径 + Step List + 一行协议版本提示，
于是执行纪律（high+review:true 不得自批、restructure 交外部 AI、版间门节律）只能靠临时补全，
导致行为漂移（自行 restructure / 自批 approved / 把决策抛给用户等已复盘案例）。

**判据（给人类判断哪些能力是"语境中暂时的"）**：
把该判断/动作抽走，换一个新会话主 agent **仅凭插件代码 + 协议 + 本库**能否在 3 步内复现？
- 不能 → 语境能力，必须入库；
- 能 → 已固化/已入库，无需重复。

## 2. 条目 Schema（JSON 形态）

```json
{
  "id": "L-2026-0903-001",
  "title": "high+review:true 步骤不得由主 agent 自批 approved",
  "category": "collaboration-rhythm",
  "layer": "L3",
  "trigger": "importance=high 且 review=true 的步骤实施完成，准备置状态时",
  "decision": "置 review / 提交 auto-review（external→dialog→manual），由外部 AI、dialog 或用户在面板批准；仅 low/review:false 可自批（reviewedBy=mainagent）",
  "rationale": "审核来源是 v1.9 审计链的一环；自批会伪造 reviewedBy 并破坏版间门与降级链语义",
  "evidence": "expr-2026-09-03_01-27-21；外部 AI 评审 expr-2026-09-03_01-49-57；runbook §2.2",
  "confidence": "high",
  "status": "proposed",
  "recordedAt": "2026-09-03T00:00:00.000Z"
}
```

字段说明：

| 字段 | 含义 |
|---|---|
| id | 年-月-日-序号 |
| title | 一句话能力 |
| category | `repository-knowledge`（仓库心智）/ `judgment-heuristic`（判断启发）/ `engineering-action`（工程动作模式）/ `collaboration-rhythm`（协作节律）/ `tooling-trap`（工具陷阱） |
| layer | L1 协议知识 / L2 操作 SOP / L3 判断启发 / L4 通用模型能力（不沉淀） |
| trigger | 触发场景（何时这条会被用到） |
| decision | 该场景下应做的判断/动作 |
| rationale | 一次推理（为什么） |
| evidence | 出处：exprId / trace / commit / 源码行号 |
| confidence | high=已多次验证；medium=验证一次；low=推断待证 |
| status | proposed（主 agent 收口自检产出）→ approved（用户/外部 AI 确认）→ in-runbook（已并入 runbook 正文） |

载体：**`docs/main-agent-lessons.json`（机器可读，已落地 2026-09-04，16 条全字段）**，唤起时按 trigger 关键词 Top-K 注入（v0.3 装配后启用）；
`docs/main-agent-lessons.md`（人类可读目录）暂未单建——目录职责由 §5 表承担。

## 3. 收口自检清单（每次任务收口前，主 agent 过一遍）

1. **新能力？** 本次是否用到 runbook/协议之外的新判断或新动作模式？
   → 是：按 §2 写一条 proposed 条目；否：跳过。
2. **可复现吗？** 该判断换新会话主 agent 仅凭插件+仓库+本库能否 3 步内复现？
   → 不能：必须沉淀（标 proposed）；能：检查是否已入库，缺则补。
3. **审核越权？** 是否有 high+review:true 步骤被我直接 approved？
   → 有：纠正为走外部审核，并把该条经验入库（collaboration-rhythm）。
4. **证据齐全？** trace 是否含执行证据 + 通道审计（requestProvider/providerLabel/fallbackReason）？
   → 缺：补齐后再收口。
5. **规划权归属？** 规划-现状差异是否已交外部 AI 评审，而非自裁 restructure？
   → 未交：补交；并把"审计取证→交外部 AI"经验入库（judgment-heuristic）。

收口时在 trace 末尾追加：

```
【主 agent 沉淀建议】
- [proposed] <id> <title>（category / layer / confidence）
（无新条目则写：本次无新沉淀建议。）
```

## 4. 装配路线（未来实施，先记录愿景）

1. **v0.2**：runbook 编成 DSH skill（仿 `static-plugin-development`），插件安装后主 agent 首次即可加载——
   "装插件 = 恢复协作能力"的最小实现。
2. **v0.3**：lessons.json 支持 Top-K 注入：handoff 唤起时按任务 trigger 关键词注入 3-5 条高置信条目。
3. **v0.4**：收口自检产出"沉淀建议"自动展示到面板（像 auto-review 一样交用户批准），approved 后并入 lessons。

## 5. Lesson 条目库（机器载体：`docs/main-agent-lessons.json`）

> 2026-09-04：24 条已按 §2 全字段结构化入库 `docs/main-agent-lessons.json`（16 条 + 017-024 八条均已被用户确认 approved；无待确认项）。
> 本表为人类可读目录；**状态以 json 为准**。
> 状态约定：`in-runbook`（要点已并入 runbook 正文）/ `approved`（用户或外部 AI 确认）/ `superseded`（已并入他条，机器消费跳过）/ `proposed`（主 agent 产出待确认）；均记 `confirmedBy`/`confirmedAt`。

| id | title（一句话） | 建议状态（suggested） |
|---|---|---|
| L-2026-0903-001 | high+review:true 不得自批 approved | in-runbook（已在 runbook §2.2） |
| L-2026-0903-002 | 先读 steps.json 顶层声明再表态 | in-runbook（已在 runbook §3 SOP.1） |
| L-2026-0903-003 | tag 版本延续 v3.x | in-runbook（已在 runbook §4） |
| L-2026-0903-004 | PS5.1 BOM 陷阱 → node 重写 | in-runbook（已在 runbook §6 陷阱表） |
| L-2026-0903-005 | 审计取证→交外部 AI restructure | in-runbook（已在 runbook §5） |
| L-2026-0903-006 | 外部声称声明未落盘→先核对顶层 | approved（crossRef 002） |
| L-2026-0903-007 | 自动迭代先核对落盘声明 | merge-into:002（与 002 重复） |
| L-2026-0903-008 | 被打回先查审核通道缺陷再 reopen | approved |
| L-2026-0903-009 | currentIteration 失真，以 Vn 标签判进度 | approved |
| L-2026-0903-010 | 提审前先落实体产物 | approved（crossRef 014） |
| L-2026-0903-011 | 版本/tag 续线拒绝回退命名 | merge-into:003（与 003 重复） |
| L-2026-0903-012 | 代构造须明示并留独立审方 | approved |
| L-2026-0903-013 | 自评自证须披露并留重审选项 | approved |
| L-2026-0903-014 | artifacts 实挂载防熔断（notes 不算产物） | approved（crossRef 010） |
| L-2026-0903-015 | 发布纪律：代号/tag/semver 对齐 | approved |
| L-2026-0903-016 | restructure 后审核上下文同步 | approved |
| L-2026-0904-017 | 能力考古须三源交叉 + tag 覆盖度自检（防机制层漏登记，本次 R1-R6 复盘） | approved（2026-09-04 用户确认） |
| L-2026-0904-018 | 文件解耦多子代理并行 + 主 agent 统一验收（代码同文件回串行） | approved（2026-09-04 用户确认） |
| L-2026-0904-019 | 版本断言：改前先核对 package.json/git HEAD，不符即停 | approved（2026-09-04 用户确认） |
| L-2026-0904-020 | git 原子交付：里程碑 tag/commit，回退走 checkout/reset 禁重放 Edit | approved（2026-09-04 用户确认） |
| L-2026-0904-021 | 实测数据驱动协议演进（626 turns 复盘 → alternatives/importance） | approved（2026-09-04 用户确认） |
| L-2026-0904-022 | 跨工作区桥接：workspacePath 注入优先于默认 cwd | approved（2026-09-04 用户确认） |
| L-2026-0904-023 | web-gemini 渠道问题分层排查（扩展↔bridge↔解析） | approved（2026-09-04 用户确认） |
| L-2026-0904-024 | 版本号多源一致性（package/README/说明书/statusHandler） | approved（2026-09-04 用户确认） |

> **已确认（2026-09-04 13:14 UTC，用户）**：001-005→in-runbook；007→并入 002（superseded，证据并入 002）；011→并入 003（superseded，证据并入 003）；006/008/009/010/012/013/014/015/016→approved。见 §5.1。

### 5.1 确认记录

- **2026-09-04 13:14 UTC（confirmedBy=user，主对话）**：001-005 → `in-runbook`；006/008/009/010/012/013/014/015/016 → `approved`；007 → 并入 002、011 → 并入 003（均 `superseded`，supersededBy 已写，evidence 已并入目标条目）。lessons.json 已同步 `status`/`confirmedBy`/`confirmedAt`。
- **2026-09-04 15:20 UTC（confirmedBy=user，主对话）**：L-2026-0904-017..024 八条 → `approved`。lessons.json 已同步 `status`/`confirmedBy`/`confirmedAt`；库内无剩余 proposed。
- **2026-09-04（proposed，待确认）**：L-2026-0904-018..024（Stage B 语境能力 C-a~C-g，用户"按推荐执行"登记为 proposed，待逐条确认转 approved）。
