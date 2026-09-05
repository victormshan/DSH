# dsh-web-relay · 主对话 agent 能力持久化总账（Master Ledger）v0.1

> 用途：盘点**截至 2026-09-04 主对话累计的主 agent 能力持久化资产**（承接 9/3 体系 + 本主对话新增），一一列出、可核对。
> 配套：细账见 `v1.8-v1.9-capability-persistence-ledger.md`（v1.8→v1.9 考古 25+10+1）；能力全文见 `main-agent-auto-iteration-capabilities.md`。
> 验证：`node D:\DSH\dsh-web-relay\scripts\verify-capabilities.mjs` → **6 条 registry 全绿**。
> 归属标注：**继承**＝9/3 晚间会话建成经 handoff 移交；**本对话新增**＝本主对话（session 3da39db3 承接 9131169a 后）直接产出；**在库同步**＝同批修订。

---

## §0 总览统计

| 层 | 载体 | 数量 | 归属 |
|---|---|---|---|
| 粗粒度能力注册表 | `docs/capabilities/registry.yaml` | 6 条 | 继承 5 + **本对话新增 1**；P1 修复 1 |
| 能力/知识文档 | `docs/*.md`（见 §2） | 8 份（能力体系 5 + 考古知识 3） | 继承 3 + **本对话新增 3** + 在库 2 |
| Skill | `skills/*/SKILL.md` × 双副本（repo + `~/.dsh/skills`） | 3 ×2 | 继承（随包分发） |
| 引擎装配机制 | `lib/index.js` MAIN_AGENT_ASSEMBLY | 1 处注入（L1564-1588） | 继承（9/3 22:33 注入，v3.4.0 起生效） |
| 细粒度 lesson | `docs/main-agent-lesson-schema-v0.1.md` §5 | 16 条（001-016） | 继承 6 + **本对话新增 10**（007-016） |
| 验证脚本 | `scripts/verify-capabilities.mjs` | 1 | 继承 |
| 发布配套 | `package.json` files（11 条持久化条目）+ `deploy.ps1` skill 部署块 | 2 | 继承 |
| 工作区持久化产物 | `D:\dsh relay test\`（交接档案 + 考古/解码工具） | 8 件 | **本对话新增** |

---

## §1 注册表（registry.yaml，6 条）

| id | category | 归属 | 说明 |
|---|---|---|---|
| auto-iteration-modeling | workflow | 继承 | 自动迭代建模规范（source docs + skill） |
| main-agent-runbook | workflow | 继承（本对话 P1 修复） | 执行手册；skill 已链上 `dsh-web-relay-main-agent/SKILL.md` |
| main-agent-lesson-schema | workflow | 继承 | lesson 规范（§5 已扩至 16 条） |
| capability-persistence-design | workflow | 继承 | 总体设计（§7 树已同步） |
| agent-tool-troubleshooting | platform | 继承 | 工具/会话排障 skill |
| **main-agent-auto-iteration-execution** | workflow | **本对话新增** | v1.8→v1.9 考古能力入口（source=`main-agent-auto-iteration-capabilities.md`，skill=main-agent SKILL） |

---

## §2 文档体系（docs/，8 份能力/知识文档逐条）

| 文档 | 定位 | 状态 | 归属 |
|---|---|---|---|
| `main-agent-runbook-v0.1.md` | 主 agent 执行手册/SOP（适用 3.4.0+） | 已生效 | 继承 |
| `capability-persistence-design.md` | 能力持久化与验证设计（registry/lesson 分工 + §5.1 文档同步机制） | 已生效（部分实施） | 继承（本对话 §7 树同步） |
| `auto-iteration-modeling.md` | 自动迭代建模规范（Step 0 模板） | 已生效（已抽取 skill） | 继承 |
| `main-agent-lesson-schema-v0.1.md` | lesson 条目 Schema + 收口自检 + §5 条目库（16 条） | 已生效 | 继承（**本对话扩 6→16**） |
| `main-agent-auto-iteration-capabilities.md` | **能力清单 25 项**（A5/B10/C6/D4）+ 教训 10 + 样本地图 23 | 已生效 | **本对话新增**（考古） |
| `v1.8-v1.9-capability-persistence-ledger.md` | v1.8→v1.9 考古总账（25+10+1 逐条） | 已生效 | **本对话新增** |
| `v3-roadmap-context-2026-08-28.md` | V3.0~V3.2 路线图原始对话还原（考古知识） | 已入库（commit 0aa41ff） | 在库（考古） |
| `v3-roadmap-implementation-gap-analysis.md` | 当时方案 vs 现状 vs 能力持久化差距（§5 未闭合 P1-P4） | 已入库（commit 0aa41ff） | 在库（考古） |

> 另：`docs/` 下 stock-ai-001..006 等为业务知识文档，不属于能力持久化体系；`dsh-web-relay-说明书.md`（75KB）为产品说明书（含 4.20 范式章节），随包但不入 registry。

---

## §3 Skill（3 个 × 双副本）

| Skill | repo 副本 | `~/.dsh/skills` 副本 | 触发 |
|---|---|---|---|
| auto-iteration-modeling | `skills/auto-iteration-modeling/SKILL.md` | ✅ | 自动版本迭代建模 |
| agent-tool-troubleshooting | `skills/agent-tool-troubleshooting/SKILL.md` | ✅ | 会话无 shell/工具缺失 |
| dsh-web-relay-main-agent | `skills/dsh-web-relay-main-agent/SKILL.md` | ✅ | 收到 dsh-web-relay handoff |

**引擎装配机制（能力自动唤起）**：`lib/index.js` L1564-1588 `MAIN_AGENT_ASSEMBLY` + `attachMainAgentAssembly()`——每次 `wakeMainAgent` 的 handoff 自动附带【主 agent 装配】路径清单（runbook/registry/建模 skill/排障 skill/main-agent skill）。v3.4.0 重启后已生效（9/3 22:41 后的 handoff 均自带装配清单）。

---

## §4 细粒度 lesson 库（16 条）

- **机器载体已落地**：`docs/main-agent-lessons.json`（2026-09-04，16 条全字段 trigger/decision/rationale/evidence/confidence/status/suggested/confirmedBy/confirmedAt）。
- **继承（001-006，9/3 复盘）**：001 high+review:true 不得自批；002 先读 steps.json 顶层声明；003 tag 延续 v3.x；004 PS5.1 BOM 陷阱；005 审计取证交外部 AI restructure；006 声明未落盘先核对顶层。
- **本对话新增（007-016，考古）**：007 落盘声明核对；008 打回先查审核通道缺陷；009 currentIteration 失真判据；010 提审前落实体产物；011 tag/版本续线；012 代构造须留独立审方；013 自评自证披露；014 artifacts 实挂载防熔断；015 发布纪律（代号/tag/semver 对齐）；016 restructure 后审核上下文同步。
- **状态（2026-09-04 13:14 UTC 已确认，user）**：001-005→`in-runbook`；006/008/009/010/012/013/014/015/016→`approved`；007/011→`superseded`（分别并入 002/003，证据已并入）。见 lessons.json 与 lesson-schema §5.1。

---

## §5 验证与部署配套

- `scripts/verify-capabilities.mjs`：解析 registry（6 条）、校验 source/skill 存在、verification 规则（file-exists / content-contains），2026-09-04 全绿。
- `package.json` `files`：lib/index.js、lib/client.js、cordis.patch.yml + 3 个 SKILL + auto-iteration-modeling.md + capability-persistence-design.md + capabilities/README.md + registry.yaml + verify-capabilities.mjs（**11 条持久化条目随包分发**）。
- `deploy.ps1`：skill 部署块（agent-tool / main-agent / auto-iteration），已随 9/3 同步。
- 三副本：`D:\DSH\dsh-web-relay`（源）→ `.dsh\profiles\web\node_modules\dsh-web-relay`（运行）→ `C:\Users\Administrator\web-relay\dsh-web-relay`（工作副本）。

---

## §6 工作区持久化产物（D:\dsh relay test）

- `交接档案-2026-09-03.md`：会话交接档案（现状事实卡 + 遗留清单 + 路径速查），本对话首件持久化产物。
- `_analysis/` 工具 7 件：`decode-multiframe.js`（多帧 zstd 会话解码）、`day-summary.js`（按天摘要）、`append-trace-entry.js` / `mark-steps-review.js`（收口工具）、`autoiter-inventory.js` + `autoiter-inventory.txt`（考古盘点）、`entry-15-27-39-mainagent.md`（收口条目模板）。
- 会话日志解码产物：`.decoded` + `.day-summary.txt`（session-9131169a / 4abdb7f5 等）。
- 运行期收口示例：expr-2026-09-03_15-27-39（主 agent 收口：轨迹追加 + 3 步置 review，证据留痕）。

---

## §7 本主对话能力持久化增量时间线

| 时间 | 动作 | 产出 |
|---|---|---|
| 9/3 22:41 起 | 承接 9131169a handoff（装配注入已生效）；验权：preset=standard、pwsh 恢复 | — |
| 9/3 深夜 | 会话日志解码链打通（多帧 zstd） | `_analysis/decode-multiframe.js`、day-summary |
| 9/3 深夜 | 交接档案 | `交接档案-2026-09-03.md` |
| 9/3 深夜 | expr-15-27-39 收口（能力持久化自检案例） | trace + steps review |
| 9/4 | V1.8→V1.9 考古（71→23 条，三批 subagent） | 考古报告 + 样本地图 |
| 9/4 | 能力清单 + lesson + registry 落盘 | `main-agent-auto-iteration-capabilities.md`（25 项）、lesson 007-016、registry +1 |
| 9/4 | registry P1 修复 + 同步 | main-agent-runbook skill 链上、README/design 更新 |
| 9/4 | 两份总账 | `v1.8-v1.9-capability-persistence-ledger.md`、本文件 |

---

## §8 状态与未决

- ✅ 已闭环：registry 6 条全绿（lesson-schema 条目新增 lessons.json 校验）；能力 25 项文档化；lesson 16 条全字段入库 `docs/main-agent-lessons.json` **且已确认**（5 in-runbook / 9 approved / 2 superseded，confirmedBy=user @ 2026-09-04 13:14 UTC）；装配注入运行生效；文档同步机制（§5.1）执行中。
- ⏳ 未决 1：lesson Top-K 注入（schema §4 v0.3 愿景：handoff 按 trigger 注入 3-5 条）未实施——`lessons.json` 已可被消费（消费方应跳过 superseded），属引擎侧小迭代。
- ⏳ 未决 2：V3 路线图 gap-analysis §5 P1-P4 未落地（案例库闭环/Swarm 启用/突破度门禁/引擎修正——v3.5.0 候选，计划已备 S1-S7 待确认）。
- ⏳ 未决 3：registry 部分条目 `lastVerified` 仍为 2026-09-02（脚本不回写，需手工/增强）。

---

## §9 增量核对（2026-09-05，承接 9/4 快照）

> 口径说明：§0-§8 为 9/4 快照；9/5 主对话（v3.5.0→v4.3.0 迭代 + 能力持久化维护）之后的最新状态以本节约为权威。

| 资产 | 9/4 快照 | 9/5 现状 | 增量 |
|---|---|---|---|
| registry.yaml | 6 条 | **14 条** | v3.5-v3.9 机制 6 条（shadow/prompt-case/swarm/breakthrough/channels/replay-notify，v3.6-3.9 阶段登记）+ v4 新增 2 条（v4-host-restart-resume / v4-autonomous-autoiteration-validation）→ verify-capabilities.mjs 14/14 绿 |
| 能力文档 A-D + E | A-D 25 项、E 无 | A-D 25 项 + **E1-E13** | E 区补 13 行：v3.5-v3.9 机制（GC/rollback/Schema 保全/watchdog 等）+ E12 重启续跑（v4.0）+ E13 自主迭代实证（v4.1-4.3） |
| lessons | 16 条（001-016） | **32 条（001-032）** | 017-027（v3.5-v3.7 复盘）+ 028（DRYRUN 模拟先行）+ 029（.cmd 纯 ASCII）+ 030（.test.js 命名）+ 031（声明机读 JSON 块）+ 032（重启编排单步幂等） |
| 文档新增 | — | docs/OPS-RESTART-RESUME.md、docs/AUTO-ITERATION-ANALYSIS.md | 运维 SOP + 自主迭代效果分析（含 §七 重启账目复盘修正） |
| 版本发布 | v3.4.0 | **v4.3.0**（8f9cc13→8e3b09a + 648f66d docs 补账） | v3.5.0→v4.3.0 共 10+ 版本，全 commit+tag+push |
| 测试基线 | — | 154/154（23 文件） | 全量回归持续绿 |

**未决更新**：§8 未决 2（V3 gap P1-P4）已于 v3.5-v3.8 全部落地（案例库闭环/Swarm/突破度门禁/Schema 保全）→ 改为已闭环；新增未决：① lesson Top-K 注入（原未决 1）仍开放；② 跨宿主「自动唤醒续跑」真实实测（expr 带 sessionId + watchdog 重启 + wakeMainAgent）；③ AutoIteration 声明解析兜底（lesson 031 建议）；④ 宿主重启编排子命令化（lesson 032 建议）；⑤ registry lastVerified 自动回写。

### §10 未决闭环更新（2026-09-05 晚，expr-2026-09-05_14-50-07，v4.4.0）

| 原未决 | 落地 | 证据 |
|---|---|---|
| ① lesson Top-K 注入 | ✅ v4.4.0 lib/lessons-inject.js（bigram 打分 Top-5 注入 wake 装配；lessons-inject.test 6 例） | S3 external approved |
| ② 跨宿主自动唤醒续跑实测 | ✅ v4.4.0 restart-now + bootResumeScan 实测：检测/计数/留痕/唤醒尝试/降级全链（探针 sessionId 降级验证；真实会话演示可选） | S5 external approved；watchdog 日志 14:57-14:58 |
| ③ AutoIteration 声明解析兜底 | ✅ v4.4.0 lib/autoiter-decl.js（JSON 序无关 + 引号容忍叙述/中文；auto-iter-decl.test 6 例） | S2 external approved |
| ④ 宿主重启编排子命令化 | ✅ v4.4.0 watchdog restart-now 原子子命令（prepare→树杀→首检拉起；DRYRUN 演练 + 真实执行） | S4/S5 external approved |
| ⑤ registry lastVerified 自动回写 | ✅ v4.4.0 verify-capabilities.mjs --update（14 条 → 当日） | S1 external approved |

registry 14 条全绿（--update 已回写 lastVerified=2026-09-05）；lessons 32 条；全量测试 167/167；tag v4.4.0（9c34487）。能力持久化未决项已清零。
