# dsh-web-relay 自动迭代版本建模规范

> 适用范围：dsh-web-relay 插件源码级自动迭代。
> 归属层：项目文档 + 工作模式。
> 状态：已生效（已抽取 Skill）。

## 1. 目的

在每次版本迭代前，通过结构化建模降低盲目修改带来的风险，确保：

- 新版本功能在旧版本基础上正确叠加；
- 修改代码前知道影响哪些功能；
- 需要重构的模块先被识别，不影响旧功能；
- 外部 AI 与主 agent 使用同一套模型图沟通。

## 2. 版本迭代前必做的最小建模集合

每次迭代开始前，至少产出以下 4 类图/视图：

1. 功能树状图（功能地图）
2. 当前代码调用流程图（现状图）
3. 版本演进图（版本叠加图）
4. 影响面标注（改动点 + 受影响模块）

复杂版本或涉及状态/接口变更时，额外补充：

5. Step/任务状态机图
6. API/协议契约图
7. 数据模型图
8. 测试矩阵

## 3. 每张图的内容与格式

### 3.1 功能树状图

按功能分层列出当前能力，示例：

```text
dsh-web-relay
├── 协议层
│   ├── Triage
│   ├── Step List
│   ├── Planning & Architect
│   ├── 审核降级链
│   ├── AutoIteration
│   └── restructure
├── Provider 层
│   ├── Gemini Free API
│   ├── Web-Gemini
│   ├── Claude
│   ├── Dialog
│   └── Manual
├── 状态管理层
│   ├── Step 状态机
│   ├── 快照/恢复
│   └── 熔断
├── UI 层
│   ├── 面板
│   ├── Step List 视图
│   └── Trace 视图
└── 基础设施
    ├── bridge
    ├── 会话日志
    └── 存储
```

### 3.2 当前代码调用流程图（现状图）

按一次真实请求路径绘制，示例：

```text
用户选择 provider
  → 面板 submitAsk()
  → POST /ask
  → askHandler()
      ├─ gemini-free → callGemini()
      ├─ web-gemini → webGeminiAsk()
      ├─ claude → llm.stream()
      ├─ dialog → callDialogModel()
      └─ manual → 直接保存
  → saveRecord()
  → appendTrace()
  → parseActions()
  → shouldWake?
      ├─ 是 → wakeMainAgent()
      └─ 否 → 返回 answer
```

### 3.3 版本演进图（版本叠加图）

示例：

```text
v1.9（现状）
  ├─ Triage
  ├─ Step List 执行
  ├─ 审核降级
  ├─ AutoIteration
  └─ Web-Gemini

v2.0（目标）
  ├─ 继承 v1.9 全部
  ├─ + workflow_templates
  ├─ + state_snapshot
  └─ + /templates、/snapshot API

v2.1（目标）
  ├─ 继承 v2.0 全部
  ├─ + agent_roles
  ├─ + heterogeneous_reviewers
  └─ + 多模型审核投票
```

### 3.4 影响面标注

每次改动前必须标注：

```text
本次改动模块：
- lib/index.js
- lib/client.js

会影响的模块：
- askHandler
- webGeminiAsk
- wakeMainAgent
- Step List 状态机

可能受影响的测试：
- test/...
```

### 3.5 状态机图

涉及状态逻辑时必须绘制：

```text
pending → executing → review → approved
                 ↓           ↓
             failed       rejected
                 ↓           ↓
             retry       pending/reopen
                 ↓
             timeout → paused
```

### 3.6 API/协议契约图

列出新增/修改/删除的接口：

```text
POST /ask
POST /steps/update
POST /steps/restructure
POST /steps/auto-review
POST /templates/register     ← 新版本可能要加
POST /snapshot/create        ← 新版本可能要加
```

## 4. Provider 层面向对象重构方向

当前 `askHandler` 中 provider 使用大 if/else 分支，容易互相影响。建议演进为策略/接口模式：

```text
interface AiProvider {
  ask(prompt, options): Promise<Result>
  review(prompt, options): Promise<Result>
  fallbackChain(): Provider[]
}

class GeminiFreeProvider implements AiProvider
class WebGeminiProvider implements AiProvider
class ClaudeProvider implements AiProvider
class DialogProvider implements AiProvider
class ManualProvider implements AiProvider
```

收益：

- 新增 Provider = 新增类，不修改 askHandler
- 修改某个 Provider 不影响其他 Provider
- 降级链可配置化

## 5. 自动迭代 Step 0 模板

每个迭代版本开始前，先写 Step 0：

```text
Step 0：现状建模
├─ 0.1 功能树状图
├─ 0.2 当前代码调用流程图
├─ 0.3 模块依赖/影响图
├─ 0.4 状态机图（如涉及）
├─ 0.5 API/接口清单
├─ 0.6 本次改动点标注
├─ 0.7 需要重构/隔离的模块
└─ 0.8 运行能力验证：node scripts/verify-capabilities.mjs
```

通过后再进入：

```text
Step 1：设计本版新增功能
Step 2：实现
Step 3：测试
Step 4：提交/打 tag
```

## 6. 文档维护与归档

- 本规范属于项目知识 + 工作模式知识。
- 通用工作模式部分已抽取为 Skill：
  - 插件内源：`skills/auto-iteration-modeling/SKILL.md`
  - DSH 全局部署：`~/.dsh/skills/auto-iteration-modeling/SKILL.md`
- 项目专属调用链、模块路径、重构计划保留在本项目 docs。
- 文档与 Skill 必须保持同步更新；任何一方修改后，另一方应同步更新。

## 7. 文档更新机制

为避免“文档已抽取 Skill 但内容仍停留在旧状态”，本规范遵循以下同步规则：

1. 修改项目规范时，同步检查对应 Skill 是否受影响。
2. 修改 Skill 时，同步检查项目文档是否需要更新。
3. 每次版本迭代、能力抽取、流程调整后，更新本文档的状态与章节。
4. 文档顶部状态字段应及时从“起草”改为“已生效/已评审/已抽取”。
5. 能力持久化与验证流程见：
   `docs/capability-persistence-design.md`。
