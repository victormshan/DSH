---
name: dsh-web-relay-main-agent
description: dsh-web-relay 主 agent 核心能力与调优规范——handoff/三方协作/Step List/自动迭代/版间门/收口。收到 dsh-web-relay 相关任务或需要执行插件协作流程时加载；未经验装配的裸对话应先读 registry 与 runbook。
---

# Skill: dsh-web-relay-main-agent

> 导引（cap_4）：未收到装配注入时，复杂任务前先读 `docs/capabilities/registry.yaml` 与 `docs/main-agent-runbook-v0.1.md`（若可访问）。

> 用途：主 agent 收到 dsh-web-relay handoff 时，必须加载本 Skill。
> 归属：项目工作流 Skill。
> 完整手册：`D:\DSH\dsh-web-relay\docs\main-agent-runbook-v0.1.md`

## 1. 触发条件

- 收到消息包含：`【主 agent 请协助】dsh-web-relay`
- 或出现：`workspacePath`、`试验记录`、`三方轨迹`、`Step List`
- 或用户要求：按 dsh-web-relay 流程 / 自动迭代 / 版间门 / restructure

## 2. 执行前必读

1. 先读完整手册：
   `D:\DSH\dsh-web-relay\docs\main-agent-runbook-v0.1.md`
2. 再读试验记录 md
3. 再读 `*.steps.json`
4. 然后才表态/执行

## 3. 核心纪律摘要

- 先读后表态
- high + review:true 不得自批 approved
- low / review:false 可自动 approved（reviewedBy=mainagent）
- restructure 规划权在外部 AI / 面板 / 用户
- AutoIteration 版间门：全 approved 才进下一版
- 连续打回 ≥3 次 → paused，不无限重试
- 通道审计以 frontmatter 的 requestProvider / providerLabel / fallbackReason 为准

## 4. 发布纪律摘要

- 版本延续 v3.x
- 三副本同步
- 全量测试通过后再发布
- 重启宿主 = 主 agent 自主操作（kill-host / restart-now，见 §5），非仅用户动作

## 5. 宿主重启与续跑自检（v4.9.1 固化）

主 agent **具备自主重启宿主能力**，三选一：

1. 常驻 watchdog 在跑（计划任务 DSH-WEB-Watchdog 或手动实例，单例锁被其持有）→
   `node D:\DSH\dsh-web-relay\bin\watchdog.mjs kill-host`
   树杀 3080 宿主（不持锁），watchdog 探测 miss≥3 后自愈拉起新宿主（补注入注册表 GEMINI_API_KEY/GEMINI_MODEL）。
   DRYRUN 演练：`$env:DSH_WEB_DRYRUN='1'` 后同命令（只打日志不执行）。
2. 无常驻 watchdog（首次部署/守护丢失）→
   `node D:\DSH\dsh-web-relay\bin\watchdog.mjs restart-now`
   （自持单例锁：prepare → 树杀 → 进入监控首检拉起，成为新 watchdog）。
3. 用户手动重启（面板/任务管理器）——仅作为兜底。

纪律（lesson 032/033/036）：重启编排必须走**独立延迟进程**（`Start-Process powershell -WindowStyle Hidden` + sleep 10-12s，
避免树杀命令本身被 harness 中断）；严禁先杀 watchdog；树杀宿主会断当前 agent 回合 → 编排放回合最后动作；
**不得承诺"回合自动续接"**——插件状态机续跑（bootResumeScan resumed/restartCount）宿主重启后必然自动发生，
但 agent 回合续接依赖 goal 轮或用户输入，二者都可能缺席（036 事故：实证成功后 6h 空等）→ 验证/收口放重启前完成，
或明示用户"重启后发任意消息触发续接"；重启后新回合先核对 /health-check resumed 再继续。
**后台 job 铁律（036 补强）**：任何 `run_in_background` 的 job 启动后必须**同一回合**内 `job_output wait` 取结果——
句柄跨回合失效（新回合报 unknown job）且 UI 卡片悬挂为 running；等不到就查盘上外部状态（日志/health-check/steps.json）
拿权威结果，不得让回合在"job 在跑"状态下结束。
操作后验证：/status version 更新 + /health-check bootId 变化 + watchdog 日志新行。

续跑语义（重启后自动，v4.9.1 实证「无介入续跑」成立）：
- 宿主启动跑 bootResumeScan：跨 bootId 且忙态（executing/review/activeSteps 非空）expr → restartCount+1；
  paused/stopped 排除（熔断不自动续跑，防 96-96-96 死循环）；restartCount≥2 熔断 paused。
- 唤醒注入（无介入关键）：wakeSid = expr.sessionId ‖ 宿主 env DSH_SESSION_ID。**主 agent 创建/更新 expr 时
  把当前 harness 会话 ID（$env:DSH_SESSION_ID）落盘到 steps.json sessionId 字段** → 重启后 bootResumeScan
  自动 wakeMainAgent 注入「宿主自愈重启·自动续跑」消息到主会话（2026-09-07 实证：kill-host 重启后零用户输入
  收到唤醒消息并自动接管；resumeQueuedAt 打标=注入已排队）。
- 续跑动作：executing → 先 git 检查残改再续；review → 重触发 /steps/auto-review；全 approved → finalize 收口；
  rejectStreak/iterationBaseCommit 跨重启保持勿重置。
- 健康自检：GET /health-check → bootId + resumed{at,checked,resumed,paused}；GET /status → version/geminiConfigured。
- 审核上下文注意（lesson 035）：三方轨迹时间正序、最新证据在末尾——审核/cc 派发/alternatives 上下文已 tailClip
  尾部优先截断；手工给审方贴证据时勿头截长文本。
