# dsh-web-relay · 主 agent 执行手册（Main-Agent Runbook）v0.1

> 适用版本：dsh-web-relay 3.4.0+
> 文档性质：**主 agent 侧的运行手册**。外部 AI 有 `WEB_RELAY_PROTOCOL` + `WEB_RELAY_EXTERNAL_AI_SKILL`（协议全文），
> 本手册补主 agent 侧缺失的一环：被唤起后该读什么、执行纪律、SOP、陷阱清单。
> 配套文档：`main-agent-lesson-schema-v0.1.md`（语境能力沉淀库 schema + 收口自检）。

---

## 0. 使用时机

出现以下任一信号，主 agent 应认为自己处于 dsh-web-relay 三方协作语境，先读本手册再行动：

- 收到 handoff：`【主 agent 请协助】dsh-web-relay 收到需要主 agent 接管的内容`
- 用户消息中出现 `workspacePath` / `试验记录` / `三方轨迹` / `Step List` 等字样
- 用户直接要求"按 dsh-web-relay 流程 / 走协议 / 自动迭代 / 版间门 / restructure / 提交审核"

收到后顺序：① 读本手册 ② 读试验记录 md ③ 读 `*.steps.json`（尤其顶层 `iterations/autoDecision/currentIteration`）④ 再表态。

## 1. 三方角色与产物约定

| 角色 | 职责 | 何时出现 |
|---|---|---|
| 用户（human） | 发起任务、最终拍板、面板操作（审核/一键收口）、宿主重启实测 | 熔断 paused、finalAcceptance、需面板操作时 |
| 主 agent（本会话） | 执行（读/写/验证/发布）、回写三方轨迹、按规则提审 | handoff 注入后全程 |
| 外部 AI | 方案/规划/评审/审核；`/ask` 或 `/steps/auto-review` 的调用方侧 | 每轮规划、每步 review |

产物约定：
- 记录：`web-relay/experiments/dsh-web-relay-<stamp>.md`（frontmatter 含 channel / requestProvider / providerLabel / fallbackReason）
- 状态：`web-relay/experiments/expr-<stamp>.steps.json`
- 轨迹：`web-relay/traces/expr-<stamp>.md`（追加幂等；主 agent 收口=追加 `## [主 agent] <ISO时间戳>` 条目）

## 2. 全局执行纪律（违反过的都在这里）

1. **先读后表态**：被唤起先读记录+steps.json（含顶层迭代字段），不凭印象判断。
2. **审核归属不可越权**：
   - `importance=high` 且 `review=true`（含 reviewSpecified=true）→ 主 agent **不得**自行置 approved；执行+回写证据后置 `review`/走 auto-review（服务器 external→dialog→manual），由外部 AI / dialog / 用户在面板批准。
   - `importance=low` / `review:false` → 可免审（complete 自动 approved，reviewedBy=mainagent 留审计）。
   - 手动直接改 steps.json 置 approved 只允许 low/review:false 情形；high 情形必须走审核来源（external/dialog/manual）。
3. **restructure 规划权在外部 AI / 面板 / 用户**：主 agent 发现"外部 AI 规划与现状冲突/重造"时，做审计取证（源码行号 + 历史 trace），把差异交回外部 AI 评审（`/ask`）请求 restructure；**不擅自替换外部 AI 的 Step List**。外部 AI 输出新列表（json:agent-action）后才按新列表执行。
4. **AutoIteration**：
   - 声明解析：严格 JSON 块 `{"iterations":N,"finalAcceptance":"...","autoDecision":true}` 优先；叙述式/中文（"自动迭代3个版本"）兜底（v3.3.2 起支持）。宿主旧版只认严格 JSON——要求外部 AI 输出独立 JSON 声明块。
   - 版间门：Vn 全 approved 才进 Vn+1；达 iterations 上限收口 done 并唤醒用户最终实测。
   - 熔断：连续打回 ≥3 → paused，停并报告用户，不无限重试。
5. **该停就停**（把控制权交回协议指定方，而不是自作主张继续或把决策抛给用户）：
   - 需要外部 AI 评审/审核时 → 走 `/ask` 或提交 auto-review；
   - 熔断 paused、finalAcceptance（重启实测）→ 报告用户等实测；
   - 面板操作点（一键收口/手动审核）→ 提示用户在面板做。
6. **通道与降级**：gemini-free 失败会降级 web-gemini→dialog；记录 frontmatter 的 requestProvider/providerLabel/fallbackReason 是审计真相，先读它再解释"为什么走网页/降级"。

## 3. 执行 SOP

1. 读 handoff 中的记录/轨迹路径；读记录 md 全文与 steps.json（含顶层字段）。
2. 核对通道审计：`channel / requestProvider / providerLabel / fallbackReason`——确认这次是 API 直连还是降级。
3. 取当前步骤（currentStep/activeSteps + 依赖门控：depends_on 全 approved 才可执行）。
4. 实施：源码改动遵循"源=D:\DSH\dsh-web-relay、运行=安装目录、工作副本"三副本同步；每处改动 `node --check`。
5. 验证：镜像单测先行（新增逻辑先在 test/ 写镜像断言跑绿，再打补丁）；改动后全量 `node --test test/*.test.js`（当前基线 ≥102）。
6. 回写证据：追加 trace 条目（改动点、测试结果、commit/tag、行号证据）。
7. 提审：按 §2.2 规则——high+review:true → 置 review 走外部审核；low/review:false → 直接 approved（reviewedBy=mainagent）。

## 4. 发布 SOP（版本延续 v3.x）

1. `package.json` 三份 bump（源 3.3.x→次版本递增；**用 node 重写避免 BOM**：PS5.1 `Set-Content -Encoding UTF8` 会写 BOM，BOM 破坏 `JSON.parse`）。
2. 版本锚点测试同步：`test/timeout-fix.test.js` 末例断言 package.json 版本号，随发布更新。
3. `node --check` 所有改动文件；全量 `node --test test/*.test.js` 全绿（传文件列表，勿用目录参数）。
   3.5 若本次改动涉及 docs/skills/capabilities，运行能力验证：`node scripts/verify-capabilities.mjs`，全绿后再继续。
4. 三副本同步：`D:\DSH\dsh-web-relay`（源）/ `C:\Users\Administrator\.dsh\profiles\web\node_modules\dsh-web-relay`（运行）/ `C:\Users\Administrator\web-relay\dsh-web-relay`（工作副本）。
5. git（在 D:\DSH）：
   - 只 add 本任务范围路径（勿误纳 dsh-web-gemini-ext 等未提交改动；可先 stash）。
   - commit → tag `v3.x.y` → `git push origin main --tags`。
   - 远端落后先 `git pull --rebase origin main`（未提交改动需先 stash，push 后 `ls-remote --tags origin` 核对 tag 在列）。
6. 运行宿主需重启才加载新代码；重启是 finalAcceptance 的用户动作，主 agent 不自行杀宿主（会断自己会话）。

## 5. 审计 SOP（"已实现 vs 重造"判定）

- 用 grep/read 取源码行号证据（如熔断 `rejectStreak>=3`、restructure 悬空 400、AutoIteration 版间门段落）。
- 对照历史 trace/experiments 的实测记录（如 8/27 AutoIteration 熔断实测 expr）。
- **产出差异表交外部 AI 评审**，由其裁决 restructure 与否；把裁决结果写入 trace。

## 6. 已知陷阱清单（本仓库实测）

| 陷阱 | 现象 | 对策 |
|---|---|---|
| PS5.1 `Set-Content -Encoding UTF8` | package.json 出现 BOM，node JSON.parse 崩 | 用 node `fs.writeFileSync(...,'utf8')` 重写（会去 BOM） |
| `deploy.ps1` | ANSI 编码，PS5.1 解析 UTF-8 中文报语法错 | 改用三副本手工同步 |
| `node --test test/`（目录参数） | 报 `Cannot find module ...\test` | 传文件列表：`node --test test/*.test.js`（展开后逐个传入） |
| PowerShell 控制台 UTF-8 | 中文显示乱码（`â` 前缀） | 不影响落盘；验证文件本体用 read 工具 / node 读取 |
| tag 体系 | v1.9.x 为旧协议时代命名，已弃 | 发布一律延续 v3.x |
| 面板实际状态 | 直接改 steps.json 与面板状态以文件为准 | 编辑后刷新面板核对；high 步骤禁自批见 §2.2 |
| 宿主运行版本 | 安装目录代码改动需重启宿主才生效 | 重启是用户动作（finalAcceptance） |

## 7. 配套

- 协议全文（外部 AI 侧）：`lib/index.js` 顶部 `WEB_RELAY_PROTOCOL` / `WEB_RELAY_EXTERNAL_AI_SKILL`。
- 能力沉淀：`docs/main-agent-lesson-schema-v0.1.md`。
- 历史决策档案：`docs/dsh-web-relay-改进方案-2026-09-01.md`、`docs/dsh-web-relay-说明书.md`。
