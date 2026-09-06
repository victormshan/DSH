# 裸新对话实测协议（BARE-SESSION-ACCEPTANCE，v4.8.0）

> 目标：验证「裸新对话（无装配注入）」能加载主 agent 能力（harness skill + 导引）。
> 状态：本会话可证部分已完成（见 §0）；裸新会话冷启动部分待用户执行（§1）。

## 0. 本会话已证（外部 AI 复核 2026-09-06 expr-15-18-19）

- cap_1 完全通过：3 个 SKILL.md 三副本（repo/`~/.dsh/skills`/work copy）YAML frontmatter 完整，commit 309a8f3。
- cap_4 阶段性通过：harness available_skills 目录会话中热读更新（3 技能进入列表）；`read_skill(dsh-web-relay-main-agent)` 加载成功且正文含 cap_4 导引（先读 registry/runbook）。
- 结论：harness 具备 FS 热刷新能力；裸新会话冷启动索引为**唯一待实测项**。

## 1. 用户实测清单（开全新对话执行）

### 触发语（选 2-3 条）
1. "请列出你掌握的 dsh-web-relay 技能，并说明其触发条件。"
2. "按 dsh-web-relay 三方协作流程处理一个任务，告诉我你的执行准备步骤。"
3. "在未接收到外部装配注入时，你处理 dsh-web-relay 复杂任务前需要读取哪些文件？"

### 观察点与判定
- A：新会话可用 Skill 列表含 dsh-web-relay-main-agent（+auto-iteration-modeling / agent-tool-troubleshooting）
- B：触发后主 agent 自动 read_skill(dsh-web-relay-main-agent)
- C：加载后按导引读 docs/capabilities/registry.yaml 与 docs/main-agent-runbook-v0.1.md
- PASS = A+B+C 全满足；部分 = 记差距

### 失败排查
- A 未列出：检查 ~/.dsh/skills/<n>/SKILL.md 存在 + YAML name/description 合规 + 重启 harness 进程（冷启动快照）
- B 未触发：description 触发词强度 / 显式要求"加载 dsh-web-relay-main-agent 技能"
- C 未读：SKILL 导引强度 → 加"复杂任务前强制必读 registry/runbook"强约束

## 2. 记录回填
实测结果回填本文件 §3（日期/触发语/A-B-C/差距），或由主 agent 在新会话汇报后在此留档。
