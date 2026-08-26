# dsh-web-relay v1.2.1 发布说明

> 协议版本：v1.8（+ v1.8.1 澄清，协议版本号保持 v1.8）
> 发布目录：`D:\DSH\dsh-web-relay\`（唯一权威源码目录）

## 变更内容（V1.8.1 澄清实施）

经三方协作双视角评估与外部 AI 评审定案（expr-2026-08-26_13-16-32 / 13-37-24 / 13-49-58），实施 7 条澄清：

1. **代码 · restructure 悬空依赖校验**：`POST /dsh-web-relay/steps/restructure` 在写盘前校验所有步骤 `depends_on` 引用，指向已删除步骤时返回 **400**（拒绝本次重构），防止拓扑悬空。
2. **代码 · 打回清空 reviewedBy**：步骤被打回（单步打回 `action=reject`、自动审核打回 `reviewOneStep`、批量原子打回连带）时 `reviewedBy` 置 `null`；approved 保留审核来源（外部/对话/手动），重新审核通过后再记录。
3. **协议/Skill 文本**：`WEB_RELAY_PROTOCOL`（中英）新增「V1.8.1 澄清」条目（7 条）；`WEB_RELAY_EXTERNAL_AI_SKILL`（中英）新增澄清章节。
4. **说明书**：3.16 新增「3.16.5 V1.8.1 澄清」小节（reviewSpecified 判定 / 安全护栏优先 / 打回副作用 / 重构作用域 / 拓扑继承 / 悬空依赖 400 / reviewedBy 清空）。
5. **README**：版本 1.2.1，版本历史加行。

## 安装 / 部署

- 手动复制 `lib/`、`package.json`、`cordis.patch.yml` 到 `C:\Users\Administrator\.dsh\profiles\web\node_modules\dsh-web-relay\`（Host 半改动需重启 `dsh web` 生效；Client 半 HMR 自动生效）。

## 验证

- `node --check` index.js / client.js 通过
- `verify-v18.js`：ALL PASS（后端 9 / 前端 7 / 文档 6 + 协议文本 v1.8 条目）
- `verify-v18-backend.mjs`：46 项断言全过
- `verify-s1-dangling.mjs` / `verify-s2-reviewedby.mjs`：悬空校验 3 场景 + reviewedBy 清空 6 用例全过
- `verify-v18-frontend.mjs`：22 标记 + VM 执行无 ReferenceError

## 兼容性

- 协议版本保持 v1.8（v1.8.1 为澄清补丁，不 bump 协议号）；向下兼容 v1.5 / v1.6 / v1.7
- `reviewedBy` 打回清空为行为变更：打回步骤不再保留旧审核来源（审计信息仍存于 notes）
