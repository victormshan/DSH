# dsh-web-relay 插件主 agent 能力持久化及能力验证设计

> 主题：dsh-web-relay 插件主 agent 能力持久化及能力验证
> 状态：设计稿（部分实施）
> 归属：工作模式 + 项目知识
> 适用范围：dsh-web-relay 开发、自动迭代、排障过程

## 1. 背景与问题

主 agent 在单次对话中形成的方法、经验、规则，如果不落盘，下次新会话会“失忆”。光靠口头说“记住了”不可靠，因此需要持久化机制。

本设计解决两个问题：

1. 能力持久化：把主 agent 可用经验/方法/规则固化到可复用文件。
2. 能力验证：确保持久化后的能力真实可用、不过期、不冲突。

## 2. 什么是主 agent 能力

在 dsh-web-relay 语境下，主 agent 能力定义为：

> 主 agent 在完成 dsh-web-relay 开发/排障时，可以被反复使用的一组知识、流程、工具或校验规则。

示例能力：

- 自动迭代版本建模
- 工具/会话能力排障
- Gemini Free API 与 Web-Gemini 调用链判定
- 从主会话轨迹排查 provider 路径
- 修改模块前的影响面分析

## 3. 能力分层

能力按归属和有效期分层：

| 层 | 内容 | 存放位置 | 随插件版本化 |
|---|---|---|---|
| project | dsh-web-relay 调用链、模块路径、降级逻辑 | `D:\DSH\dsh-web-relay\docs\` | ✅ |
| workflow | 自动迭代建模、排障流程 | `D:\DSH\dsh-web-relay\skills\` + 部署到 `~/.dsh/skills/` | ✅ |
| platform | DSH preset、Windows shell、工具配置 | `~/.dsh/skills/` 或独立平台手册 | ❌ |
| tool | 可执行校验脚本/测试 | `D:\DSH\dsh-web-relay\scripts\` 或 `test\` | ✅ |

## 3.1 统一模型：粗粒度 Registry 与细粒度 Lesson 分离

为避免与 `main-agent-lesson-schema-v0.1.md` 重复，这里明确两者关系：

- **Capability Registry（registry.yaml）**
  - 粗粒度能力/文档/Skill 索引
  - 记录：id、source、skill、触发场景、验证规则、状态
  - 作用：提供入口、可发现性、可验证性
  - 不替代 lesson 的细粒度经验条目

- **Lesson Schema（main-agent-lesson-schema）**
  - 细粒度经验/教训库
  - 记录：trigger、decision、rationale、evidence、confidence、status
  - 作用：沉淀“判断/动作模式”，支持 future lessons.json 注入
  - 不承担文档/Skill 索引职责

对应关系：

```text
一条 lesson 不一定需要出现在 registry；
一个 registry 能力可以引用一份 runbook/skill/docs，
而该文档内部可以包含多条 lesson 或由 lesson 库补充。
```

状态语义分开：

- registry.status：`active` / `deprecated`
- lesson.status：`proposed` / `approved` / `in-runbook`（沿用 lesson schema）



## 4. 粗粒度能力注册表（Capability Registry）

注册表只登记“文档 / Skill / 工具 / 机制”等粗粒度能力入口，不登记细粒度 lesson。维护位置：

```text
D:\DSH\dsh-web-relay\docs\capabilities\registry.yaml
```

每条粗粒度能力记录结构：

```yaml
- id: auto-iteration-modeling
  name: 自动迭代版本建模
  category: workflow          # project | workflow | platform | tool
  scope: auto-iteration-only  # 使用范围
  source: docs/auto-iteration-modeling.md
  skill: skills/auto-iteration-modeling/SKILL.md
  trigger: 用户要求自动迭代 N 个版本
  conflicts:
    - manual-development
  verification:
    - file-exists: docs/auto-iteration-modeling.md
    - file-exists: skills/auto-iteration-modeling/SKILL.md
    - content-contains: "Step 0"
  lastVerified: 2026-09-02
  version: 1
```

作用：

- 集中查看已有能力
- 明确适用范围和冲突
- 定义验证方式
- 支持版本化追踪

## 5. 能力生命周期

建议按以下流程管理：

```text
1. 捕获
   在一次排障/开发中总结出经验

2. 分类
   判断属于 project / workflow / platform / tool

3. 持久化
   写入对应 docs / skill / registry

4. 注册
   在 registry.yaml 中登记

5. 定义验证
   写清楚怎样算“这个能力可用”

6. 验证
   运行检查脚本/测试，确认能力真实可用

7. 归档
   如果代码变更导致能力失效，更新或废弃
```

## 5.1 文档同步与更新机制

所有能力相关文档、Skill、注册表之间必须保持同步。原则：

- 修改项目文档后，同步检查对应 Skill 是否受影响。
- 修改 Skill 后，同步检查项目文档是否需要更新。
- 文档抽取为 Skill 后，原文档必须更新“状态”，不能保留“后续再抽取”的过时描述。
- 每次能力新增、变更、废弃、抽取，都应同步更新：
  - 能力注册表 `registry.yaml`
  - 对应项目文档
  - 对应 Skill（如有）
  - 本文档（如设计本身变化）
- 文档状态字段应明确标记：`起草 / 已生效 / 已抽取 / 已废弃`。
- 后续验证脚本应增加“文档与 Skill 内容同步”的检查项。


## 6. 能力验证分层

### 6.1 静态验证（必须）

- 文件存在
- 文档/技能路径正确
- YAML/JSON 可解析
- 注册表引用无断链
- 没有重复能力 id

### 6.2 行为验证（尽量）

- Skill 内容包含必要章节
- 自动迭代建模 Skill 包含“Step 0”
- 能力适用范围与实际触发条件一致

### 6.3 环境验证（平台/工具类）

- 当前 agent preset 是否正确
- Windows 下是否使用 pwsh
- dsh 进程是否读到所需环境变量

## 7. 目录结构规划

```text
D:\DSH\dsh-web-relay\
├── docs\
│   ├── auto-iteration-modeling.md
│   ├── capability-persistence-design.md
│   ├── main-agent-runbook-v0.1.md
│   ├── main-agent-auto-iteration-capabilities.md
│   ├── main-agent-lesson-schema-v0.1.md
│   └── capabilities\
│       ├── registry.yaml
│       └── README.md
├── skills\
│   ├── auto-iteration-modeling\
│   │   └── SKILL.md
│   ├── agent-tool-troubleshooting\
│   │   └── SKILL.md
│   └── dsh-web-relay-main-agent\
│       └── SKILL.md
└── scripts\
    └── verify-capabilities.mjs
```

## 8. 验证脚本设计

`scripts/verify-capabilities.mjs` 自动检查：

- 所有能力文件是否存在
- 注册表是否合法
- Skill 是否已部署到 `~/.dsh/skills`
- 文档路径是否匹配
- 每个能力是否有关联验证方式

运行方式：

```powershell
node D:\DSH\dsh-web-relay\scripts\verify-capabilities.mjs
```

## 9. 落地步骤

- [x] 创建 `docs/capabilities/registry.yaml`
- [x] 创建 `docs/capabilities/README.md`
- [x] 创建 `scripts/verify-capabilities.mjs`
- [x] 将 auto-iteration-modeling 能力登记
- [x] 创建 agent-tool-troubleshooting 能力并登记
- [x] 将“能力验证”纳入自动迭代 Step 0 与发版 SOP
- [x] 明确 Registry 为粗粒度索引、Lesson 为细粒度经验库

## 10. 后续扩展

- 能力版本历史
- 能力废弃标记
- 能力自动发现
- 能力冲突检测
- 能力变更审计
