# dsh-web-relay 粗粒度能力注册表

本目录登记 dsh-web-relay 主 agent 的**粗粒度能力/文档/Skill/工具入口**。
细粒度经验/lesson 不在这里登记，请使用 `main-agent-lesson-schema-v0.1.md`。

## 分层关系

```text
main-agent-runbook            → 操作手册/SOP
main-agent-lesson-schema      → 细粒度 lesson 规范
capability-persistence-design → 总体设计
capabilities/registry.yaml    → 粗粒度能力索引
skills/*/SKILL.md             → 可加载工作流
scripts/verify-capabilities   → 统一验证
```

## 文件

- `registry.yaml`：粗粒度能力注册表。
- `../capability-persistence-design.md`：能力持久化及能力验证设计。
- `../main-agent-runbook-v0.1.md`：主 agent 执行手册。
- `../main-agent-lesson-schema-v0.1.md`：主 agent 语境能力沉淀库 Schema。
- `../main-agent-auto-iteration-capabilities.md`：主 agent 自动版本迭代执行能力（协议 v1.8→v1.9 考古沉淀）。
- `../v1.8-v1.9-capability-persistence-ledger.md`：v1.8→v1.9 考古沉淀能力持久化总账（25 能力 + 10 lesson + 1 registry 逐条清单）。
- `../main-agent-capability-persistence-master-ledger.md`：主对话 agent 能力持久化总账（Master Ledger，全资产盘点）。
- `../main-agent-capability-pending-list.md`：能力持久化待补清单（二次考古产物 + 机制/语境能力候选登记处）。
- `../auto-iteration-shadow-support-design.md`：v1.9 自动迭代接入影子沙盒支撑设计（Draft，P5）。
- `../../skills/auto-iteration-modeling/SKILL.md`：自动迭代建模 Skill。
- `../../skills/agent-tool-troubleshooting/SKILL.md`：工具/会话排障 Skill。
- `../../skills/dsh-web-relay-main-agent/SKILL.md`：主 agent handoff 必读 Skill。

## 使用

查看已登记能力：

```text
docs/capabilities/registry.yaml
```

运行能力验证：

```powershell
node D:\DSH\dsh-web-relay\scripts\verify-capabilities.mjs
```

## 维护规则

- 新增能力必须先在 registry.yaml 登记。
- 文档/Skill 变更后必须同步更新 registry 中对应记录的 lastVerified 或内容。
- 能力废弃时在 registry.yaml 标记 deprecated，不直接删除。
- 验证脚本会检查 registry 中的路径与文件是否存在。
