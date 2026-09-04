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
