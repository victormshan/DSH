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
   **首选 `node D:\DSH\dsh-web-relay\bin\watchdog.mjs restart-sync [waitSecs]`**（v4.9.2 原子重启）：
   一次【同步】调用 = kill-host + 内部 wait-healthy 轮询 → 返回 `RESTART_OK bootId=…` 或 `RESTART_TIMEOUT`。
   **严禁**用 run_in_background + 自编 sleep+probe 编排重启（句柄跨回合失效 + UI 悬挂，036 事故根因）；
   同步调用 timeout 设 ≥ waitSecs+30s。
   或 `watchdog.mjs kill-host`（仅树杀不等，watchdog 自愈后自行核对 /health-check）。
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
**harness 环境事实（037）**：**同步**执行杀宿主命令（taskkill/kill-host/restart-sync 同步跑）会被 harness 中断
（工具调用与 3080 有连接，kill 宿主即断调用；实证：3 次同步 kill 全被中断、3 次后台 job kill 全成功）——
harness 内杀宿主**只能用后台 job**（独立进程，kill 不影响 job）。**结构模式（037 修正）**：kill 用后台 job 启动后，
**同一消息内不要 wait job 句柄**（跨回合必失效），而是接着发**同步 probe**（`Start-Sleep 60` + `/status`——probe
不杀进程不会被中断）查盘上结果（uptime 归零/新 bootId = kill 已执行、watchdog 自愈拉起）；完全绕开 job 句柄。
宿主与任务状态永不死：watchdog 自愈 + 重启/心跳双保险保证自动恢复；agent 回合中断仅损失"本次会话"，盘上状态随时可续。
**回合自检铁律（036 根治）**：输出最终文字前自问「还有未完成工作吗？」——有就必须**同一回合内继续工具调用**（一个回合
可连续做大量工作，工具调用间无需用户交互），禁止用"接下来做 X / 等待中 / 稍后验证"预告式结尾（预告=幻想自动续接，
回合结束即停，续接仅靠用户输入 / goal 轮（本环境 disarm 后不可靠）/ 宿主注入（仅重启或心跳有待办时）——三者都可能缺席）。
结束回合仅两个理由：①任务完成汇报；②真正需要用户决策（明确提问）。
长操作：同步串行完成（sleep 分段时间片）或后台 job 但同消息内 wait；确需跨回合 → goal 保持 active + 如实告知"未自动继续请发任意消息"，不承诺。
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
