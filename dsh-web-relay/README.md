# dsh-web-relay

实验性 free-web 中继插件：在 dsh 主 agent 与外部网页 AI（Gemini Free API 或手动粘贴）之间建立可追溯的三方协作通道。

> **权威来源**：本目录（`victormshan/DSH` 仓库内的 `dsh-web-relay/`）是唯一维护的源码位置。
> 修改、提交、发版都在此进行；`deploy.ps1` 负责部署到 dsh profile 的安装目录。

- **当前版本**：1.0.0（协议 v1.5/v1.6：v1.5 线性为默认，v1.6 并发调度——depends_on / parallel_group、顶栏协议版本选择 v1.5/v1.6、依赖门控 + 主 agent subagent 并行）
- **说明文档**：[docs/dsh-web-relay-说明书.md](docs/dsh-web-relay-说明书.md)
- **版本快照**：[releases/v1.0.0/](releases/v1.0.0/)（全量文件快照，不依赖增量 Edit）｜[v0.9.0/](releases/v0.9.0/)（上一里程碑）｜[v0.8.0/](releases/v0.8.0/)｜[v0.7.0/](releases/v0.7.0/)
- **部署**：运行 `deploy.ps1`（含版本断言检查）或手动复制 `lib/`、`package.json`、`cordis.patch.yml` 到 `C:\Users\Administrator\.dsh\profiles\web\node_modules\dsh-web-relay\`

---

## 目录结构

```
dsh-web-relay/
├── lib/                    # 插件源码（v1.0.0 权威版本）
│   ├── index.js            # Host half（1896 行：协议 v1.5/v1.6 双版本、Step List、并发调度、依赖门控、审核降级链、auto-review、Planning）
│   └── client.js           # Browser bundle（1628 行：平铺布局 + Step List UI + 协议版本选择器 + planning 开关 + 自动审核按钮 + 语言设置）
├── package.json            # 插件元数据（version 1.0.0）
├── cordis.patch.yml        # profile 挂载补丁
├── docs/                   # 说明书（适用版本 1.0.0）
├── releases/               # 里程碑全量快照
├── deploy.ps1              # 部署脚本（版本断言 + 复制到安装目录）
├── .gitattributes          # LF 换行强制
├── .editorconfig           # 编辑规范
└── .gitignore              # 忽略运行数据
```

## 开发与维护规范（防止版本丢失事故）

> 背景：v0.7.0 曾因安装目录被回滚而"丢失"，最终只能从会话日志逐条重放增量 Edit 才恢复。
> 以下 4 条规范用于彻底避免此类事故，**Agent 与人都必须遵守**。

### 1. 里程碑版本必须 Git 归档（最核心）

任何里程碑版本（如 v0.7.0）完成时，**必须**：

```bash
git add -A
git commit -m "v0.7.0: Step List + auto-review + Planning (v1.4)"
git tag v0.7.0
```

需要回退时直接 `git checkout v0.7.0` / `git reset --hard v0.7.0`，由 Git 保证原子性恢复，
**绝不手动拼接/重放旧 Patch**。

### 2. 禁止"重放历史 Edit"，采用全量快照

版本发布或里程碑节点，**必须**同步生成完整文件快照到 `releases/<version>/`
（`lib/` + `package.json` + `cordis.patch.yml` 全量复制），而不是依赖跨会话解析日志重建。

### 3. 统一全局换行符（LF）

仓库根已有 `.gitattributes`（`* text=auto eol=lf`）与 `.editorconfig`。
所有 `.js` / `.json` / `.yml` 文件**必须使用 LF**，禁止混入 CRLF，
防止跨环境执行 `str_replace` 时因 `\r\n` 差异导致匹配撕裂。

### 4. 修改前做基准版本断言（Version Assertion）

给主 Agent 下达重构/改版指令时，Prompt 必须包含：

> 在执行任何修改前，请先读取 `package.json` 中的版本号或 `git describe --tags`，
> 验证基准版本无误后再操作；如版本不匹配，先提示停止，不要强行 Patch。

`deploy.ps1` 已在部署侧实现同样检查：源版本与安装目录版本不一致时拒绝部署。

## 版本历史

| 版本 | 协议 | 内容 |
|---|---|---|
| 1.0.0 | v1.6 | Step List 并发调度（depends_on / parallel_group）+ 顶栏协议版本选择 + 依赖门控 + 主 agent subagent 并行 |
| 0.9.0 | v1.5 | 审核三级降级链 + 进度看板 + 审核面板化/一键收口 + 智能打包 + 探路缓存 + 语言中/英 |
| 0.8.0 | v1.4 | 平铺布局：与 DSH 页面左右平铺 + 可拖动分割条 + 折叠 rail + DSH tokens（布局方案落地） |
| 0.7.0 | v1.4 | Step List + 外部 AI 审核 + 自动审核 + Planning & Architect |
| 0.6.0 | v1.3 | Step List 执行与外部 AI 审核回路 |
| 0.5.0 | v1.2 | 记录域与 side-window 解耦，experiments/traces 独立落盘 |
