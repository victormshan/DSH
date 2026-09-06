# dsh-web-relay · Claude Code 混合架构与降级策略（CC-HYBRID）

> POC 状态：POC-1 冒烟 ✅（Claude Code 2.1.251，Pro 订阅 firstParty，headless -p 可用）
> POC-2 实现链路 ✅（cc-task-schema 模块由 Claude 实现，主 agent 校验合入 commit 4d24565，全量 179/179）
> POC-3 审方链路 ✅（Claude 评审发现并确认高严重度缺陷：TASK_DEFAULTS.refs 共享引用污染——主 agent+10 单测均漏检）

## 1. 架构

```
harness 主 agent (deepseek-v4-flash) —— 主协调：任务定义/校验/合入/收口/状态机
        │ 写任务契约
        ▼
D:\cc-tasks\<taskId>\task.json   ← WSL 经 /mnt/d 直读（零网络配置）
        │ runner.sh（WSL）: timeout 900 claude -p --permission-mode acceptEdits --allowedTools Read,Write,Bash
        ▼
Claude Code (WSL, Pro 订阅)  → 产出 out/ + done.flag → result.json {status:done|failed}
        │ 主 agent 读回
        ▼
校验（node --check/test/验收）→ 合入 repo → 三方/混合闭环
```

kind 支持：implement（大块实现）/ review（评审，输出 review.md 结论 APPROVED/REJECTED + 逐条意见）。

## 2. 降级策略（混合架构失败 → 主 agent 单一实现架构）

触发条件（任一）：
1. runner result.json status=failed（claude exit≠0 / timeout 900s / done.flag 缺失）
2. claude 不可达 / 认证失效（订阅登出） / Pro 自动化配额 429
3. 产出校验不通过（node --check/test/验收失败）且无法在 1 轮内修复
4. WSL 或 /mnt/d 不可用

降级动作（主 agent 决策，逐级回退）：
- kind=review：回退到原三方审方链（gemini-free → dialog → manual），trace 记 fallbackReason=cc-unavailable:<原因>
- kind=implement：主 agent 自行实现该任务（单一实现架构），trace 记 fallbackReason=cc-unavailable:<原因> + degraded=true
- 恢复检测：每次派发前探活（wsl claude auth status）；恢复后自动回到混合模式（不做 sticky 降级）

规则固化为 lesson 候选：cc 不可用时的 trace 字段（fallbackReason/degraded）与 expr 收口语义一致，不破坏验收证据链。

## 3. 经验与风控
- Pro 订阅自动化配额有限：任务拆分 ≤ 数十分钟/个，连续派发留窗口；大实现优先，日常审方仍可用 gemini（省配额）。
- ToS：仅本机个人研究，禁止商业化代理。
- 审方价值实证：POC-3 Claude 审出 refs 共享引用污染（真实运行时缺陷，跨调用状态泄漏），证明高质审方可补主 agent+单测盲区。
