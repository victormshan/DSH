# dsh-web-relay 改进方案

> 基线版本：dsh-web-relay 3.2.6（README 标注 1.3.0，见 P1-2，本身就是本方案要修的问题之一）
> 生成日期：2026-09-01
> 文档性质：基于源码走查、git log、测试执行结果整理的问题清单 + 改进方案，不是协议规范，不替代 [dsh-web-relay-说明书.md](./dsh-web-relay-说明书.md)

---

## 0. 结论摘要

代码/测试底子扎实（90/90 测试通过，路由与协议常量自洽），但存在：

1. 一条**可被局域网第三方利用、诱导主 agent 执行任意命令/写文件**的真实安全问题（`dsh-web-gemini-ext/bridge-server.mjs`）——**P0，需立即处理**。
2. 版本号治理和部署脚本（`deploy.ps1`）在流程层面**没有真正堵住** README 曾经描述过的"安装目录丢失/回滚"事故根因，且同类"版本号漂移"问题已经复发过一次。
3. 若干代码技术债（超时值分散、str_replace 补丁痕迹、swarm 双审核成本无提示）。
4. 协议设计复杂度已经出现"需要专门发一个澄清版本解释上一版本自己引入的字段"的信号（v1.8.1 解释 `importance`），以及 DAG 循环依赖无检测会导致静默死锁。
5. 新链路 `dsh-web-gemini-ext` 与主插件关系完全没有文档化，处于"孤儿模块"状态。

---

## P0（安全，立即处理）

### 1. `bridge-server.mjs` 可能被局域网任意第三方远程操纵主 agent 执行命令

**证据**
- `bridge-server.mjs:92`：`server.listen(8899, ...)` 未绑定 host。Node.js 默认监听所有网卡，尽管启动日志打印"listening on http://127.0.0.1:8899"，实际可能在局域网内可达。
- `/create-task`、`/submit-answer`、`/next-task` 三个端点**零认证**。
- CORS 全开（`access-control-allow-origin: '*'`，代码注释里承认是有意为之）。
- `/submit-answer` 提交的 `answer` 会被当作"外部 AI 回答"送入主插件的 `parse/execute` 流程，该流程支持 `write_file` / `run_cmd` 动作。

**风险链**：局域网内任意设备 → 伪造 Gemini 回答提交到 `/submit-answer` → 诱导主 agent 写文件/跑命令。这是目前发现的唯一一条可能达到命令执行/任意文件写入级别影响的问题。

**改法**
1. `server.listen(8899, '127.0.0.1', ...)` 显式绑死回环地址（一行修复，优先做）。
2. 三个端点加共享密钥校验：本地生成 token 写入本地配置文件，扩展和 server 读同一份，请求头校验 token，无 token 一律拒绝。
3. CORS 收窄到扩展实际的 `chrome-extension://<id>` origin，不用 `*`。
4. 在 `execute` 端点上加"来源标记"，区分请求来自 gemini-free API / 手动粘贴 / bridge-server 转发；`run_cmd`/`write_file` 这类高风险动作对 bridge-server 来源默认要求用户二次确认，不静默执行。

---

## P1（工程流程可靠性）

### 2. `deploy.ps1` 版本断言逻辑方向可能反了

**证据**：`deploy.ps1:19-23` 要求「源仓库版本 == 安装目录版本」才继续部署，版本不一致就 `exit 1` 中止。但正常部署场景恰恰是"源仓库改了代码+升了版本号，要覆盖还停在旧版本的安装目录"——这种最常见场景下源≠装，脚本会主动拒绝部署。

目前源/装两边版本号一致（都是 3.2.6）不清楚是否真的靠这个脚本达成——`.dsh/profiles/web/node_modules/` 下存在一批命名不规整的历史备份目录（`.bak-v05`、`.bak-v07`…`.bak-v101`、`.bak-v121`、`.bak-v130`、`.bak-v19`），命名格式与 `deploy.ps1` 生成的备份命名规则（`$InstallDir.bak-$instVersion-yyyyMMdd-HHmmss`）对不上，说明历史上大概率存在手动复制/手动改版本号的操作路径，没有严格走 `deploy.ps1`。这与 README 里"v0.7.0 曾因安装目录被回滚而丢失"的事故背景（本该被 deploy.ps1 + Git 归档规范彻底堵住）存在张力。

**改法**
- 断言改为：源版本 > 安装目录版本 → 允许覆盖；相等 → 跳过并提示无需部署；源版本 < 安装目录版本 → 报错阻止（防误回退）。
- 统一备份命名规则，清理历史野生备份目录（先确认无需保留的实验数据再删）。
- 明确"只允许通过 `deploy.ps1` 部署"作为硬规则，避免流程被绕过。

### 3. 版本号单一数据源问题——已经复发过一次

**证据**：v2.0.0 提交说明记录过修复的是"`statusHandler` 硬编码 1.3.0 漂移"，说明代码层面已经踩过一次"版本号写死不同步"的坑；现在同样的问题在 **README（文档层）** 又犯了一次——README 停留在"1.3.0"，实际 `package.json` 已是 3.2.6，落后 9 个版本，目录结构说明（"约 2600 行"）也已过期（实际 3206 行）。

这说明上次的教训只是"头痛医头"改了当次触发点，没有制度化。

**改法**：不在 README 里手写版本号，改为从 `package.json` 单一数据源生成/替换（commit 前脚本自动 `sed` 替换 README 版本行），或者 README 直接写"当前版本见 package.json"，不重复维护。

---

## P2（代码质量/技术债）

### 4. 超时值分散成字面量，未集中管理

**证据**：`lib/index.js:714`、`764`、`1698` 各自写死 `300000`，v3.2.6 那次"长回答截断根治"（commit `3875eeb`）改的正是这几处超时，改完后依然是散落字面量而非常量（对照已有的 `RUN_CMD_TIMEOUT_DEFAULT`/`RUN_CMD_TIMEOUT_MAX` 具名常量做法不一致）。`test/timeout-fix.test.js` 的存在说明这不是第一次因超时问题打补丁。

**改法**：抽取 `GEMINI_TIMEOUT_MS` / `DIALOG_TIMEOUT_MS` 常量到常量区，三处引用统一替换，下次调超时只改一处。

### 5. str_replace 补丁遗留的格式腐化，无自动化校验

**证据**：`lib/index.js:1832-1834` 附近有 `/* stray closing removed */` 注释和反常换行/逗号格式，是多轮增量编辑未做通读清理的痕迹。README 自己承认过 CRLF/LF 混用会导致 `str_replace` 匹配撕裂的风险，但目前无 lint/format 校验脚本。

**改法**：加一个轻量自动化钩子（`eslint` 或 `node --check` + `prettier`）在提交前跑一遍，清理此类遗留痕迹；往后每次 str_replace 完顺手跑一次。

### 6. `swarm-prompts.js` 双角色审核成本翻倍且解析失败静默丢数据

**证据**：`swarmConsensus` 是 AND 门（两角色都 approved 才算过），且每角色走完整三级降级链，最坏情况 = 2 角色 × 3 级 = 最多 6 次外部调用，但代码/文档均无成本提示。`parseRoleReview`（swarm-prompts.js:48-62）JSON 解析失败时正则兜底只取 `verdict`，`findings`/`suggestion` 静默丢失且无日志——外部模型习惯用代码围栏包 JSON 时会触发，审核细节丢失但不可察觉。

**改法**：开启 `enableSwarm` 前在 UI/文档标注"预计调用次数上限"；`parseRoleReview` 解析失败时至少打一条 warn 日志。

---

## P3（架构/协议设计，长期可维护性）

### 7. `importance` 字段语义重叠，已需要专门的"澄清版本"

**证据**：v1.7 引入 `importance` 时是"审核权重提示"，v1.8 升级为"分工契约"（low 免审/medium 批量轻审/high 严格三方审/null 走默认），同时又并行引入独立的 `review:false` 硬开关，结果 v1.8.1 要用 7 条细则专门解释两者如何解耦——需要一次单独补丁版本解释上一版本自己引入的字段语义，是设计复杂度失控的信号。

**改法**：下一个协议版本不再往 `importance` 叠语义，拆成两个独立字段（如 `reviewWeight` 审核权重 / `assignmentMode` 分工契约），职责单一，不再需要澄清文档。

### 8. 状态机叠加，无集中状态转换图

**证据**：基础状态（pending/executing/review/approved/rejected/done）+ v1.6 并发调度的 `blocked` + AutoIteration 熔断的 `paused` + 试验级 `stopped`，转换规则散落在 `lib/index.js` 2351、2362-2370、2372-2380 等多处独立 if 判断中。说明书"3.7 状态机"表格只列了 6 个基础状态，已与实现脱节。

**改法**：补一张覆盖全部状态（含 blocked/paused/stopped）的状态转换表进说明书；代码层抽一个集中的 `nextState(current, event)` 纯函数收拢散落的 if 判断，便于针对该函数写穷举测试。

### 9. DAG 循环依赖完全无检测，会静默死锁

**证据**：全仓搜索 cycle/circular/环 只在协议文档字符串出现；`restructure` 端点只校验"依赖指向已删除步骤"，没有校验"A depends_on B、B depends_on A"这类环。一旦外部 AI 生成带环的 Step List，相关步骤会永久卡在 `pending`/`blocked`，无主动报错，只能等用户发现"怎么一直卡着"。

**改法**：`restructure`/`steps/update` 接受新 Step List 时跑一次拓扑排序检测环，检测到环直接 400 拒绝并报出环上具体步骤 id。`test/dag-viewer.test.js` 补一条环检测用例。

---

## P4（测试/文档基础设施）

### 10. `package.json` 缺 `scripts.test`

**证据**：测试实际很扎实（`node --test test/*.js` 90/90 全过，真实覆盖具体函数如 `extractChunkText`），但 `npm test` 会直接失败（无 `scripts.test` 字段），README 也未写明测试命令。

**改法**：加 `"scripts": {"test": "node --test test/*.js"}`；README"开发与维护规范"补一句"提交前必须 `npm test` 全过"。

### 11. `dsh-web-gemini-ext` 与主插件关系未文档化

**证据**：这条新链路（`bridge-server.mjs` + `bridge-watchdog.mjs`）与已有的 `gemini-free` provider（`callGemini`）是替代关系还是并行通道，代码里看不出耦合点（`lib/index.js` 未见调用 bridge-server 的代码），任何文档都未交代。

**改法**：先明确架构关系（建议：作为 `gemini-free` provider 的一种新实现路径，用于免 API Key 场景），随后在主插件 README 和说明书补一节，说明触发条件和数据流向，不再让它以"孤儿模块"状态存在。

---

## 建议执行顺序

1. **今天**：P0 第 1 条（`bridge-server.mjs` 绑定回环地址 + 加认证）——一行代码改监听地址，成本最低、风险消除最直接。
2. **下一个里程碑版本（建议 v3.3.0）**：P1 两条一次性做完（版本号治理 + `deploy.ps1` 断言方向修正），避免重演"改了触发点、没堵根因"。
3. **随后按需**：P2 代码技术债、P3 协议设计重构（拆分 `importance`、状态转换表、DAG 环检测）、P4 测试/文档基础设施补齐。

---

## 附：问题索引（按优先级）

| 优先级 | 问题 | 关键证据位置 |
|---|---|---|
| P0-1 | bridge-server 无认证+可能监听 0.0.0.0，可诱导远程命令执行 | `dsh-web-gemini-ext/bridge-server.mjs:92` |
| P1-2 | deploy.ps1 版本断言方向反了 | `dsh-web-relay/deploy.ps1:19-23` |
| P1-3 | README 版本号漂移，教训未制度化 | `README.md` vs `package.json`；对照 commit `92b57d6`（v2.0.0） |
| P2-4 | 超时值分散未集中管理 | `lib/index.js:714,764,1698` |
| P2-5 | str_replace 补丁痕迹，无格式校验 | `lib/index.js:1832-1834` |
| P2-6 | swarm 双审核成本翻倍+解析失败静默丢数据 | `lib/swarm-prompts.js:48-62` |
| P3-7 | importance 字段语义重叠，需澄清版本 | README v1.8.1 澄清段落 |
| P3-8 | 状态机叠加无集中转换图 | `lib/index.js:2351,2362-2370,2372-2380` |
| P3-9 | DAG 循环依赖无检测，静默死锁 | `restructure` 端点校验逻辑；`test/dag-viewer.test.js` |
| P4-10 | package.json 缺 scripts.test | `package.json` |
| P4-11 | dsh-web-gemini-ext 与主插件关系未文档化 | 全仓搜索无调用/说明 |
