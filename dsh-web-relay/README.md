# dsh-web-relay

实验性 free-web 中继插件：在 dsh 主 agent 与外部网页 AI（Gemini Free API 或手动粘贴）之间建立可追溯的三方协作通道。

> **权威来源**：本目录（`victormshan/DSH` 仓库内的 `dsh-web-relay/`）是唯一维护的源码位置。
> 修改、提交、发版都在此进行；`deploy.ps1` 负责部署到 dsh profile 的安装目录。

- **当前版本**：见 [`package.json`](./package.json) 的 `version` 字段（本行不手写版本号，避免漂移——改进方案 P1-3 单一数据源；当前协议 v1.9：AutoIteration 自动迭代多版本演进 + 全角色降级链 external→dialog→pause；v1.8 混合模式 + v1.8.1 澄清全部保留）
- **说明文档**：[docs/dsh-web-relay-说明书.md](docs/dsh-web-relay-说明书.md)
- **版本快照**：[releases/v1.2.0/](releases/v1.2.0/)（全量文件快照，不依赖增量 Edit）｜[releases/v1.1.0/](releases/v1.1.0/)（上一里程碑）｜[v1.0.0/](releases/v1.0.0/)｜[v0.9.0/](releases/v0.9.0/)｜[v0.8.0/](releases/v0.8.0/)｜[v0.7.0/](releases/v0.7.0/)（版本快照为历史里程碑，不随当前版本滚动）
- **部署**：运行 `deploy.ps1`（含版本断言检查）或手动复制 `lib/`、`package.json`、`cordis.patch.yml` 到 `C:\Users\Administrator\.dsh\profiles\web\node_modules\dsh-web-relay\`

---

## 目录结构

```
dsh-web-relay/
├── lib/                    # 插件源码（版本以 package.json 为准）
│   ├── index.js            # Host half（约 3200 行：协议 v1.5/v1.6/v1.7/v1.8/v1.9 多版本、Step List、并发调度、依赖门控、审核降级链、auto-review、Planning、alternatives/importance、restructure、原子打回、mainagent 自动豁免、AutoIteration、全角色降级链、Swarm 双角色盲审）
│   └── client.js           # Browser bundle（平铺布局 + Step List UI + 协议版本选择器(v1.5-v1.9) + planning 开关 + 自动/批量审核按钮 + importance/mainagent 徽标 + restructure 重构 UI + 语言设置）
├── package.json            # 插件元数据（version 为唯一版本数据源）
├── cordis.patch.yml        # profile 挂载补丁
├── docs/                   # 说明书
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

## 宿主 Watchdog 与优雅停机（v3.9.0）

宿主（dsh web）启动时加载插件 lib、运行期不重载 → 宿主侧改动需重启。v3.9 提供「优雅停机 + 独立 watchdog 轻量拉起」闭环：

1. **优雅停机准备端点** `POST /dsh-web-relay/admin/prepare-restart`（插件侧）：
   - 触发后停收新任务（`/ask` 与新步骤 `start` 返回 HTTP 409）并返回 `ready:true`；in-flight 完成/审核不受影响。
   - `POST {cancel:true}` 复位；`GET` 查询状态。宿主重启后进程级状态自动复位。
   - `/health-check` 同步暴露 `preparing/preparedAt`（watchdog 与面板状态灯数据源）。
2. **宿主 Watchdog 独立进程** `bin/watchdog.mjs`（不进插件 lib，独立部署）：
   - 每 `CHECK_MS`(5s) 探测 `GET /health-check`（HTTP200 且 `body.ok===true` 为存活）；连续 miss ≥ `MISS_N`(3) → 先请求 prepare-restart → `taskkill /PID <pid> /T /F` 树杀 → 重新拉起宿主。
   - 防风暴：`WINDOW_MS`(10min) 内重启 ≥ `MAX_RESTARTS`(3) 次则暂停 `PAUSE_MS`(10min)（先判门再记录，暂停期不累计）。
   - **模拟模式**：`DSH_WEB_DRYRUN=1` 只打日志不 kill/spawn（验收/演练用）。
   - 环境变量：`DSH_WEB_PORT`(3080)、`DSH_WEB_CMD`（整条命令，优先）、`DSH_WEB_BIN`/`DSH_WEB_ARGS`、`DSH_NODE_EXE`、`DSH_WEB_LOG`、`DSH_WEB_CHECK_MS`/`DSH_WEB_MISS_N`/`DSH_WEB_MAX_RESTARTS`/`DSH_WEB_WINDOW_MS`/`DSH_WEB_PAUSE_MS`。
   - 默认宿主命令自动探测：`<node realpath> <nvm 全局 node_modules>/@deepseek-ai/dsh/lib/bin.js web`。
3. **部署（Windows 计划任务，开机自启 + 崩溃自愈）**：
   ```powershell
   $action = New-ScheduledTaskAction -Execute '<node.exe 完整路径>' -Argument 'D:\DSH\dsh-web-relay\bin\watchdog.mjs' -WorkingDirectory 'D:\DSH\dsh-web-relay'
   $trigger = New-ScheduledTaskTrigger -AtLogOn
   Register-ScheduledTask -TaskName 'DSH-WEB-Watchdog' -Action $action -Trigger $trigger -Force
   ```
   注意：watchdog 会拉起宿主进程（默认 `dsh web` 命令），请确认与手动启动方式不冲突（二选一，勿双开）。
4. **面板**：健康状态灯旁显示琥珀「优雅停机准备中（重启通道已就绪）」（`/health-check.preparing`，30s 轮询）。

## 版本历史

> 注：下表为历史里程碑记录；**当前版本以 `package.json` 为准**（单一数据源，见改进方案 P1-3）。

| 版本 | 协议 | 内容 |
|---|---|---|
| 3.9.2 | v1.9 | watchdog 运维加固（expr-2026-09-05_12-50-06 外部 AI 协商收尾）：启动首检立即拉起（不等 miss 轮询，开机空窗 15s→2s，真实模式端到端验证）；单例锁（.watchdog.lock PID 互斥防双开，stale 自动接管）；启动器并入 tailscale serve --bg 持久配置（幂等+重试）；watchdog.test 11 例，全量 146/146 |
| 3.9.1 | v1.9 | watchdog env 补注入（spawn 宿主前从注册表 User→Machine 回读 GEMINI_API_KEY/GEMINI_MODEL 并入子进程 env——修深层进程链丢 key 致 /status gemini=false；parseRegValue CRLF 修复）；watchdog.test +2（parseRegValue/childEnv），全量 144/144 |
| 3.9.0 | v1.9 | 优雅停机 + watchdog 自愈（expr-2026-09-05_01-53-03，S1-S5 external approved）：/admin/prepare-restart 端点（409 停新任务/start、cancel 复位、health-check 暴露 preparing）+ bin/watchdog.mjs 独立进程（miss≥3→prepare→树杀→拉起、stormGate 防风暴、DRYRUN 模拟）+ 面板琥珀提示灯；watchdog.test 7 + admin.test 2，全量 142/142 |
| 3.8.0 | v1.9 | GC 定时化 + 回滚状态复位/持久化修复 + 面板回滚展示（expr-2026-09-05_01-22-37）：gcScheduleMs + apply 进程级定时 GC（DSH_RELAY_GC_MS/DSH_RELAY_REPO_PATH）；rollback-state.js 复位策略；修 v3.7.1 持久化洞（基线/回滚 5 字段纳入读写白名单）；rollback E2E 三情形全绿；全量 133/133 |
| 3.2.6 | v1.9 | 长回答截断根治：dialog/claude 超时 60s/120s→300s、web-gemini 150s→300s、error/aborted chunk 拦截、extractChunkText 跳过 reason/error/code/message 键 |
| 3.2.5 | v1.9 | 产物摘要截断显式标注"（摘要已截断，全文见产物文件）" |
| 3.2.2 | v1.9 | reviewChannel 参数（auto / web-gemini 强制网页审核） |
| 3.2.0 | v1.9 | Swarm 双角色盲审（Security-Auditor / Refactoring-Architect，AND 门共识） |
| 3.1.0 | v1.9 | 拒收原因聚类 + 案例库注入（Top-K≤3）+ Prompt 自主进化 |
| 3.0.1 | v1.9 | 审核降级链加入 web-gemini 网页通道 |
| 1.3.0 | v1.9 | AutoIteration 自动迭代（{"iterations":N} 多版本自动演进、版间门 Vn+1、连续打回≥3 熔断 paused）+ 全角色降级链（ask/审核 external→dialog→pause，channel=dialog-fallback） |
| 1.2.1 | v1.8（+v1.8.1 澄清） | restructure 悬空依赖校验 400 + 打回清空 reviewedBy + review:null 语义 + 安全护栏优先（三方双视角评估定案） |
| 1.2.0 | v1.8 | 混合模式 importance 驱动分工（low 免审 / medium 批量轻审 / high 三方严格审）+ review:false 硬开关 + restructure 状态隔离 + 批量原子打回 + 5 段模板缺省对齐 |
| 1.1.0 | v1.7 | 多方案比较 alternatives + 步骤权重 importance 批量审核 + planning 双向 + 5段式打包模板 + artifacts 前置校验 |
| 1.0.0 | v1.6 | Step List 并发调度（depends_on / parallel_group）+ 顶栏协议版本选择 + 依赖门控 + 主 agent subagent 并行 |
| 0.9.0 | v1.5 | 审核三级降级链 + 进度看板 + 审核面板化/一键收口 + 智能打包 + 探路缓存 + 语言中/英 |
| 0.8.0 | v1.4 | 平铺布局：与 DSH 页面左右平铺 + 可拖动分割条 + 折叠 rail + DSH tokens（布局方案落地） |
| 0.7.0 | v1.4 | Step List + 外部 AI 审核 + 自动审核 + Planning & Architect |
| 0.6.0 | v1.3 | Step List 执行与外部 AI 审核回路 |
| 0.5.0 | v1.2 | 记录域与 side-window 解耦，experiments/traces 独立落盘 |
