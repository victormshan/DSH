# dsh-web-relay v1.2.0 发布说明

> 协议版本：v1.8（混合模式）
> 发布目录：`D:\DSH\dsh-web-relay\`（唯一权威源码目录）

## 核心变更

### 协议 v1.8：混合模式（importance 驱动执行与审核分工）

- `importance` 从「审核权重提示」升级为「执行与审核分工契约」：
  - `low` —— 主 agent 直做免外部审：`complete` 时系统自动置 `approved`，`reviewedBy: 'mainagent'`，留审计、不破坏 `pending → executing → approved` 状态机
  - `medium` —— 批量轻审：`batchStepIds` 一次提交多个步骤合并审核
  - `high` —— 三方严格审：单独提交，走外部 AI → 对话模型 → 手动三级降级链
  - 缺省 `null` —— 普通步骤
- `review:false` 硬开关（与 `importance` 解耦）：显式 `review:false` 无条件绕过审核（即使 `importance: high`）；显式 `review:true` 强制走审核（即使 `importance: low`）；未显式指定时按 `importance` 自动映射（`low` → 自动 approved）
- `reviewedBy` 新增 `mainagent` 自动豁免来源，收口汇总时单列

### 三处边缘微调

1. **Step List 重构状态隔离**：新增 `POST /dsh-web-relay/steps/restructure` 合并式重构端点，仅对未完成（`pending` / `rejected`）步骤生效，返回 `changes { updated, added, removed, untouchedApproved }`；已 `approved` 历史步骤与产物严禁清除/篡改
2. **批量审核原子打回**：`batchStepIds` 批量审核按原子操作，任一 `rejected` → 该 batch 内所有步骤统一退回，主 agent 分别补证据后重提
3. **5 段式打包模板缺省对齐**：`data_schema` / `pricing_map` / `mount_points` / `runtime_limits` / `history_trace` 固定键名，不适用时显式填 "N/A" 或 "none"，严禁省略字段

### 前端

- 协议选择器支持 v1.8 混合模式
- `importance` 徽标与 low 免审状态展示、`mainagent` 审核来源徽标
- restructure 重构 UI（仅动 `pending` / `rejected` 步骤）

### 文档

- `docs/dsh-web-relay-说明书.md` 更新至 v1.8 / 1.2.0（新增 3.16 混合模式与分工、4.10 v1.2.0 升级内容、5.15 混合模式操作指南）
- `README.md` 版本历史与目录结构更新至 1.2.0 / v1.8

## 安装 / 部署

- **方式一（推荐）**：在 `D:\DSH\dsh-web-relay\` 运行 `deploy.ps1`（含版本断言检查，源版本与安装目录版本不一致时拒绝部署）
- **方式二（手动）**：将 `lib/`、`package.json`、`cordis.patch.yml` 复制到 `C:\Users\Administrator\.dsh\profiles\web\node_modules\dsh-web-relay\`

## 兼容性

- 协议 v1.8 向下兼容 v1.5 / v1.6 / v1.7：既有 v1.5（线性默认）/ v1.6 / v1.7 任务不受影响，向后兼容
- v1.5 线性为默认不变；v1.6 / v1.7 / v1.8 均继承 DAG 并发调度
- v1.5 / v1.6 / v1.7 模式下不启用混合分工语义（`importance` 仍按 v1.7 权重提示处理），行为不变

## 已知说明

- **Host 半（lib/index.js）**：改动需**重启 `dsh web`** 后生效（host 侧运行时装配）
- **Client 半（lib/client.js）**：改动经 HMR **自动生效**（开发态下），无需手动刷新
- `releases/v1.2.0/` 的 `lib/`、`package.json`、`cordis.patch.yml` 全量快照由主 agent 集成验证后复制（本目录当前仅含本发布说明）

## 降本主线

- `low` 免审正式化：每个 low 步骤省 1 次审核 turn
- 混合模式为未来主形态：纯三方 35% / 混合 40% / 纯独立 25%
