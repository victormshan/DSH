# Skill: dsh-web-relay-main-agent

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
- 重启 dsh 是用户动作
