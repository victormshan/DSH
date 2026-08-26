# dsh-web-relay v1.3.0 发布说明

> 协议版本：v1.9（AutoIteration 自动迭代 + 全角色降级链；向下兼容 v1.5 / v1.6 / v1.7 / v1.8）
> 发布目录：`D:\DSH\dsh-web-relay\`（唯一权威源码目录）

## 核心变更

### 协议 v1.9：自动迭代（AutoIteration）

- 用户首次 prompt 可声明 `{"iterations": N, "finalAcceptance": "<验收标准>", "autoDecision": true}`（缺省 `iterations=1` 单轮，向后兼容；N 限 1-10）
- 每版循环 Vn：外部 AI 评审上版 → 输出 Vn 修正 Step List → 主 agent 源码层实施 + 验证 + commit/tag → 轨迹沉淀
- **版间门**：Vn 全部 approved 才进 Vn+1（`currentIteration` 落盘）；达上限收口 done 唤醒用户最终验收
- **熔断兜底**：任一步骤连续打回 ≥3 次 → 自动 `paused` 唤醒用户，不无限重试

### 协议 v1.9：全角色降级链（external → dialog → pause）

- `/ask`（方案/评审/代决策）补齐降级：Gemini 无 key 或调用失败 → 内部对话模型（callDialogModel，无工具）→ 仍失败报错由用户介入
- 降级标注：`providerLabel='对话模型（降级）'`、`channel=dialog-fallback`、`reviewedBy=dialog`，审计可溯源
- 与既有审核降级链（/steps/auto-review，v1.5 起）统一

### 协议暴露与前端

- `WEB_RELAY_PROTOCOL_VERSION_V19`、`protocolV19` payload（context/protocol 端点）、协议/Skill 中英 v1.9 条目
- 面板协议选择器新增 **v1.9 自动迭代** 选项（localStorage 记忆、directive、5 段模板注入扩至 v1.9）

## 验证

- `verify-v19.js`：ALL PASS（后端 9 / 前端 4 / 文档 3 + V19=v1.9）
- `verify-v18.js` / `verify-v18-backend.mjs`（47 项）/ `verify-v18-frontend.mjs`（VM 冒烟）：v1.8/v1.8.1 基线全部保持
- `verify-v19-fallback.mjs`（降级链 5 用例）/ `verify-v19-autoiter.mjs`（声明解析 5 用例 + 熔断 + 版间门）：PASS

## 安装 / 部署

- 复制 `lib/`、`package.json`、`cordis.patch.yml` 到 `C:\Users\Administrator\.dsh\profiles\web\node_modules\dsh-web-relay\`（Host 半需重启 dsh web；Client 半 HMR 自动生效）

## 兼容性

- 协议 v1.9 向下兼容 v1.5 / v1.6 / v1.7 / v1.8；v1.5 线性默认不变；v1.6 / v1.7 / v1.8 / v1.9 均继承 DAG 并发调度
