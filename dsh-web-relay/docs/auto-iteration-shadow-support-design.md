# dsh-web-relay · v1.9 自动迭代接入影子沙盒支撑设计（Draft v0.1）

> 状态：**草稿**（2026-09-04，待用户/外部 AI 评审后定稿；未改任何代码）
> 关联：`docs/main-agent-capability-pending-list.md` §2 P5；`lib/index.js` /shadow L841-915（V3.0，已实现但无业务调用方）
> 目标版本：v3.5.0 候选（并入 V3 gap P4 收尾）或独立 v3.6.0（由用户定排期）
> 背景动机（外部 AI 01-57-18 超预期评价原文支撑）："V3.0 影子沙盒已具备严格代码应用 + 单元测试自检"——把当时主 agent 即席编排（create 影子→应用→验证→原子合并→零污染收尾）制度化为引擎能力。

## 1. 目标 / 非目标

- 目标：用户选择 **v1.9 AutoIteration**（iterations>1 / autoDecision）时，对**高风险/重构步**自动执行"影子隔离验证 → 通过才提审 → 原子应用 → 可回滚"，把"打回返工"前移到提交前，并给多版本迭代一个可回滚基线。
- 非目标：不包办所有步骤（纯文档/分析/low 步不加影子成本）；不替换外部 AI 的语义审核（影子只管工程安全/零污染，呼应外部 AI 评价"shadow+单测自检 ⇒ 单角色审核可覆盖 90%"）；不真跑危险命令（影子内只做确定性校验）。

## 2. 触发规则（step 新字段 shadowGate: off | auto | on，默认 auto）

auto 命中（任一）：
1. importance=high 且产物含源码文件（.js/.mjs/.py/.ts…）
2. 步骤声明重构/大改（title/detail 含 重构/迁移/大范围/restructure，或未来 breakthrough_type ∈ {Structural, Paradigm}）
3. 面板开关"影子支撑 on"（全步强制）

关闭/降级：
- 纯文档/方案/分析步（artifact_required=false 或产物非代码）、low 步 → off
- **非 git 工作区**（如 D:\dsh relay test 实验目录）→ 自动降级为"快照可回滚"（无 worktree 隔离，只保回滚）
- git 仓库（D:\DSH）→ 完整隔离（worktree --detach）

## 3. 引擎钩子（复用 /shadow L841-915，零 LLM 成本）

- **H1 提审前 preflight（审核前置闸）**：risk 步 complete 时
  1. `create`（repoPath=配置的 git 根；base=最近 approved commit）
  2. 本步产物 diff 应用到影子工作树
  3. 影子内跑 `node --check <改动文件>` + 目标测试文件
  4. 全绿 → 允许置 review；失败 → 拒绝 complete，回传错误清单（面板"影子校验失败"徽标+原因）
  5. 成功路径 merge（git diff base + git apply 原子）→ destroy（remove --force）
- **H2 版间回滚基线**：每版 approved 后以当前 commit 为基线（state 顶层记 `iterationBaseCommit`）；Vn 熔断/连续打回/用户要求回滚时：git 工作区 reset 到上一版基线；非 git 用 `.dsh/shadow-snap/<exprId>/` 文件快照整体还原

## 4. 成本与约束

- 每 risk 步 +~275ms（worktree 复用）+ 影子内校验耗时；并发 ≤2（沿用 SHADOW_MAX，磁盘 3.1GB 实测约束）
- git 命令 5s 超时（沿用 SHADOW_GIT_TIMEOUT）；Diff ≤5MB
- 面板可见性：提交前展示"影子校验中/通过/失败原因"，可审计

## 5. 前置条件与配置

- 插件配置 `repoPath`（git 根；可经 /status 或面板设置）；未配置或非 git → 自动降级快照模式并提示
- 与 runbook 陷阱一致：git 命令只在 git 仓库可用；实验目录（非 git）不误报 worktree 错误

## 6. 与审核链的关系

```
risk 步 complete
  → H1 preflight（影子隔离 + node --check + 目标测试）
      ├─ 失败 → 拒绝 complete + 错误清单（回主 agent 修复）
      └─ 通过 → 原子应用 → 置 review
                → 外部 AI/dialog/manual 审语义与验收（原链不变）
每版 approved → 记录 iterationBaseCommit（H2 回滚锚点）
```

## 7. 落地路径（并入 v3.5.0 则作为 S8/S9；或 v3.6.0 单列）

- S8（H1 preflight 接线 + 面板徽标 + 触发判定）
- S9（H2 回滚基线 + 非 git 降级 + 配置 repoPath）
- 测试 `shadow-gate.test.js`：触发判定矩阵（high+源码/重构声明/off/非git）、preflight 成功/失败分支（失败=拒绝 complete+错误清单）、并发上限、镜像 + 真实 worktree 闭环（复用 shadow.test.js 手法）
- 能力持久化同步（随 P4）：能力文档 E1 行标注"已接线"；lesson `L-2026-0904-018`（影子 preflight 纪律）proposed

## 8. 决策点（待用户拍板）

1. 排期：并入 v3.5.0（S8/S9）还是 v3.6.0
2. 触发默认：high+源码自动 on vs 需面板显式开
3. preflight 失败是否阻断 complete（建议阻断）还是仅警告
4. 非 git 工作区降级为快照回滚（建议）还是禁用影子

## 9. 外部 AI 评审（Gemini Free API，2026-09-04；记录 expr-2026-09-04_17-41-14，零降级）

> 征询方式：经插件 /ask（provider=gemini-free，requestProvider=gemini-free / providerLabel=Gemini Free API / fallbackReason=(无)）——本设计文档 v0.1 摘要 + 4 决策点交外部 AI 架构师评审。

### 9.1 总体评审与最大风险（外部 AI 原文要点）
- 可行性：**8.5/10**——/shadow 底座成熟，作为 v1.9 高风险步的 Engine Pre-flight Hook 闭环清晰。
- 三大架构风险：
  1. **影子环境依赖断裂**：git worktree 只 checkout 已跟踪文件，不带 .env/node_modules/未提交配置 → 影子内直接跑 node --check/测试易"假阴性误杀"。
  2. **Worktree 泄漏与并发死锁**：preflight 崩溃/超时/未捕获异常会残留 worktree；SHADOW_MAX=2 时泄漏 2 次即永久死锁。
  3. **5s 超时对测试过紧**：Node 进程启动/框架加载/集成测试易超时误剔除。

### 9.2 决策点外部推荐
- A 排期：**赞同 v3.6.0**（v3.5.0 P1-P4 刚收尾，需生产积累；预留时间处理 node_modules 挂载/GC/E2E）。
- B 触发：shadowGate:auto 默认生效，但**细化判定**（high 且 Structural/Paradigm 或后端核心逻辑/敏感模块，避免"改 UI 样式也建 worktree"的误伤）+ **面板 Disable Shadow 全局硬开关**。
- C preflight 失败：**坚决拒绝 complete（blocker）+ 精细化错误清单**（仅警告将失去影子 80% 价值；配合 v1.9 三连打回熔断保证主基线纯洁）。
- D 非 git：**反对物理磁盘快照**（node_modules/产物大目录 IO/磁盘不可控）→ 建议**禁用 shadow + 修改前保存增量内存/反向 patch 可回滚**（轻量安全）。

### 9.3 测试与先导案例（外部 AI 建议）
- 最小测试集 5 例：TC-SHADOW-01 Green Path（auto 触发全绿→complete+destroy）；02 Red Path（注入语法错/单测失败→拒绝 complete、主区零改动、影子清理）；03 Orphan GC（异常中断→启动/定时器静默清理残留 worktree 释放锁）；04 Context Mount（影子内测试可读到根 node_modules，软链/环境变量）；05 Iteration Rollback Gate（熔断/打回时 iterationBaseCommit git reset 回滚）。
- 先导案例：以"重构 /shadow 端点锁控制与 GC 回收模块"自身作 pilot（源码大改 + 全流程自检）。

### 9.4 外部 AI 替代方案（更轻/更稳：L1/L2 分级）
- **L1 轻量门禁（默认）**：不建 worktree——diff 先载入内存/Staging，当前环境跑 node --check 语法分析（<30-50ms，无泄漏风险）。
- **L2 重型影子（按需）**：仅当显式 breakthrough_type Structural/Paradigm 或需跑耗时单测时才拉起 worktree；创建时**软链根 node_modules**。
- 原子回滚：L1/L2 失败 → `git apply --reverse` 或 `git checkout -- .` 恢复主区。
- 预期：90% high 步在 L1 完成极速校验，仅 ~10% 结构性重构触发 worktree。

### 9.5 采纳修订（本主 agent 建议并入 v0.2 草稿，待用户确认）
1. 采纳 L1/L2 分级作为主方案（替代"一律 worktree"）；L1=内存/Staging 语法预检，L2=显式 Structural/Paradigm 或需单测时才 worktree，且影子软链 node_modules。
2. 非 git 降级由"快照回滚"改为"禁用 shadow + 增量内存/反向 patch 可回滚"。
3. preflight 失败=拒绝 complete（blocker）确认保留；面板加 Disable Shadow 全局开关。
4. 新增 Shadow GC（孤儿 worktree 清理）与依赖挂载两项到 S9 范围；测试集按 §9.3 5 例并入 shadow-gate.test.js 规划。
5. 排期维持 **v3.6.0**。
