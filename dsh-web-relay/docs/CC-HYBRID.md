# dsh-web-relay · Claude Code 混合架构与降级策略（CC-HYBRID）

> POC 状态：POC-1 冒烟 ✅（Claude Code 2.1.251，Pro 订阅 firstParty，headless -p 可用）
> POC-2 实现链路 ✅（cc-task-schema 模块由 Claude 实现，主 agent 校验合入 commit 4d24565，全量 179/179）
> POC-3 审方链路 ✅（Claude 评审发现并确认高严重度缺陷：TASK_DEFAULTS.refs 共享引用污染——主 agent+10 单测均漏检；修复 commit 0884b90）
> POC-④ 大模块实现 ✅（verify-lessons.mjs 校验器 6.7KB+9 单测，Claude 实现主 agent 合入；含 WSL 路径/BOM 跨环境修复）
> 守护化 ✅（cc-watchdog.sh 常驻轮询 D:\cc-tasks\queue → tasks/；runner 失败检测写 result.json failed → 降级信号）
> 安全演练 ✅（demo1 矛盾 prompt 被 Claude 拒绝执行——判定疑似注入不写沙盒外文件 → 失败检测+降级链在"安全拒绝"场景同样生效）

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

kind 支持（语义澄清，cc-understand-hybrid 复盘 2026-09-06 修订）：
- implement（大块实现）
- review（评审，输出 review.md 结论 APPROVED/REJECTED + 逐条意见）
- understand（理解自述/架构探路型——如"通知 Claude 关于混合架构并请其自述理解"，输出 understanding.md；消除借用 review 的语义债）

**权限界限（裁决修订）**：`--permission-mode acceptEdits` **仅**=自动接受文件编辑/改动；**不等于**免批命令行工具。命令执行放宽依赖 `--allowedTools "Read,Write,Bash"`（headless 会话 Bash 放行）。两者权责分离——禁止将 acceptEdits 解读为"免批命令"（防不安全假设）。runner 唤起语已收敛为最小引导（仅指向 task.json），避免与契约内 prompt 职责重叠。

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

## 4. 混合架构特性演进验收协议（Understand-Hybrid Protocol v1.0，外部 AI 定稿 2026-09-06 expr-16-27-44）

### §1 触发时机
- 强制：混合架构重大特性落地（拓扑/runner 调度变更）；核心契约或 API 语义修订（kind 语义、acceptEdits 行为、任务状态机）。
- 可选/跳过：样式修饰、措辞微调、无语义 Bug 修复（走常规 Step 审核）。

### §2 流程五步法（责任与配额）
1. 派发（主 agent）：D:\cc-tasks 发 kind=understand 任务，明确机制边界与重点核查项。
2. Claude 自述：按文档自述理解；未经查证的推理**必须标 [推测]**，禁硬猜。限额单次交互，超时 120s 视为失败→降级文档硬核对（Pro 配额保护）。
3. 偏差分析（主 agent）：逐节核对表 + git/代码交叉验证 + 危害判定。
4. 外部 AI 裁决：审偏差报告，仲裁=改文档/忽略/吸收为机制缺口。
5. 落地闭环（主 agent）：按裁决修订 + 新语义误区沉淀。

### §3 偏差判定与出口
- 高危（颠覆性误解/越界/死锁）→ **阻断发布**，修文档/提示词重测至通过。
- 中危（非主干误读）→ 外部 AI 裁决本轮修或记为已知限制。
- 低危（措辞/合理推测）→ 记录并忽略。
- Gap 去向：语义债→本轮改文档；机制缺口→登记下轮 v4.x 候选；流程瑕疵→优化 cc-tasks 契约模板。

### §4 与三方链/Lessons 衔接
- 理解测试 = 重大特性交付前**阶段门禁**：通过 + 外部 AI 裁决收口后，相关 Step List 才允许最终 Complete/Approved。
- 高频误读/隐晦语义（kind 借用、acceptEdits 误读）强制入库（CC-HYBRID 误区节或 lessons），防重复踩坑。

### §5 归档与登记
- 本协议即 CC-HYBRID §4（Active v1.0）；registry cc-hybrid-claude-code 条目 verification 含本协议关键词。
- 验证入口：node scripts/verify-capabilities.mjs（cc-hybrid-claude-code 条目含「混合架构特性演进验收协议」content 校验）。
