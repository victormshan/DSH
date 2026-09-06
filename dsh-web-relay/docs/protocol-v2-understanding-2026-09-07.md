# v2.0 协议演进理解测试 —— 自述理解 + 核查结论

审查员：Claude Code（独立理解审查，只读，未修改任何源码）
材料：CC-HYBRID.md §6、README.md 版本表、lib/cc-channel.js、lib/alternatives-compare.js、lib/index.js（grep + 逐段读取）

---

## A. 降级链顺序与通道语义

**自述理解**：审核降级链固定为 external(Gemini API) → web-gemini → claude-code（本地 D:\cc-tasks）→ dialog → manual 五级。reviewChannel=claude-code 时强制跳过前两级直达 cc；cc 成功时 reviewer='cc'，落盘时映射为 reviewedBy=claude-code、reviewerLabel「Claude-Code (降级)」（仅 approved 时写入，v1.8.1 语义保留）。DSH_CC_REVIEW_ENABLED=0 关闭 cc 通道并直接续降 dialog；DSH_CC_REVIEW_TIMEOUT_MS 控制轮询上限（默认 150000ms）。

**核查结论**：一致。lib/index.js:3013-3104 `obtainReviewVerdict` 中 `wantCc = reviewChannel==='claude-code'` 时①②两级均带 `!wantCc` 守卫跳过；③ `runCcReviewTask` 前置 `CC_REVIEW_ENABLED` 判断（lib/index.js:2903, 497-498）；④ dialog 分支无 wantCc 限制，cc 关闭/失败均自然续降。`applyReviewOutcome`（3108-3147）中 `reviewerBy = reviewer==='cc' ? 'claude-code' : reviewer`，且 `step.reviewedBy = result==='approved' ? reviewerBy : null`，与文档「cc 成功标注 reviewedBy=claude-code」一致，且与 v1.8.1「打回清空 reviewedBy」旧语义未破坏。无偏差。

---

## B. cc-channel 契约与安全

**自述理解**：sanitizeTaskId 用正则 `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` 白名单校验并显式拒绝含 `..` 的 id，防路径穿越。派发流程为写 `queue/<id>.task.json` → cc-watchdog（WSL 侧，非本仓库代码）轮询拾取 → runner 产出 `tasks/<id>/out/review.md` + `done.flag` → 写 `result.json{status}` → `pollTaskResult` 轮询两种候选目录布局直至 done/failed/timeout。VERDICT 解析优先级：正则行 → JSON 兜底(result/verdict 字段) → 中文关键词兜底 → unknown。

**核查结论**：一致。cc-channel.js:28-41 `TASK_ID_RE` + 显式 `id.includes('..')` 双重校验；`buildReviewTask`/`pollTaskResult`/`readReviewOut` 均先 `assertValidTaskId` 后才拼路径（cc-channel.js:44-49, 238, 291），非法 id 直接抛错而非静默放行。`candidatePaths`（209-214）确实支持 `tasks/<id>/` 与 `<id>/` 两种布局。`parseCcVerdict`（159-206）优先级与文档描述完全一致（a 正则 → b JSON → c 中文关键词 → d unknown）。所有 IO 经可注入 `fsImpl`（生产用 `nodeFsImpl`，349行），与文档「全部 IO 走可注入 fsImpl，21 单测内存 fake」一致，`node --test test/cc-channel.test.js` 实测 21/21 通过（已核实，非[推测]）。无偏差。

---

## C. alternatives 裁决

**自述理解**：端点 `POST /steps/alternatives-review`，载荷 `{exprId, stepId}`（可选 sessionId/workspacePath）；`step.alternatives` 为空数组时 400 拒绝。裁决 prompt 用 6 段模板（角色任务/Step验收/候选方案逐项/执行证据/记录+轨迹/决策输出JSON）。裁决结果写入 `step.decision` + `notes(action=decision)` + 三方轨迹；此通道明确为 gemini→web-gemini→dialog，**不经过 claude-code**。

**核查结论**：一致。lib/index.js:3496-3576 `alternativesReviewHandler` 校验 `alts.length===0` 时 400（3512）；`buildAlternativesReviewPrompt`（alternatives-compare.js:49-93）确为 6 段（①②③④⑤⑥ 标记齐全，含决策 JSON 格式要求）；3525 行注释与实现均明确「Gemini API → web-gemini → dialog（…不走 claude-code 审核通道）」，代码中确实没有调用 `runCcReviewTask`。决策写入 `step.decision`（3560）、`notes` 带 `action:'decision'`（3562-3566）、`appendTrace`（3568-3571）三处均落实。`node --test test/alternatives-compare.test.js` 实测 9/9 通过（已核实）。无偏差。

---

## D. 并发批

**自述理解**：`batchStepIds` 处理为「预检串行（not_found/非review/锁冲突提前剔除）→ mapLimit 并发（默认 2，DSH_RELAY_BATCH_CONCURRENCY 可调）跑 obtainReviewVerdict 取结论但不落盘 → 串行 applyReviewOutcome 落盘」；只要批内有一个 rejected，则已 approved 的也一并打回（原子语义，v1.8 既有规则在 v2.0 并发化后保留）。`callGemini` 对 429/5xx 状态码重试最多 2 次，退避 1.5s/3s。

**核查结论**：一致。lib/index.js:3344-3428：① 预检循环（3349-3365）纯内存判断+`lockReview`，无 IO；② `mapLimit(eligible, BATCH_REVIEW_CONCURRENCY, ...)`（3367-3370）内部调用 `obtainReviewVerdict`（不含 `applyReviewOutcome`/写盘调用），确认「取结论不落盘」；③ `anyRejected` 分支（3382-3408）统一置 rejected 并清空 reviewedBy，与单步 v1.8.1 语义一致；④ 无 rejected 时才串行 `applyReviewOutcome`（3411-3426）。`mapLimit` 实现（576-588）worker 数 = `min(limit, items.length)`，语义正确。`callGemini`（535-560）`RETRY_STATUS` 含 429/500/502/503/504，`for (attempt<3)` 即最多 2 次额外重试，退避 `attempt===1?1500:3000`，与文档「1.5s/3s×2」完全吻合。无偏差。

---

## E. 拆层不变性

**自述理解**：`reviewOneStep` = `obtainReviewVerdict`（纯判定，供并发批复用）+ `applyReviewOutcome`（落盘），拆层后单步路径行为应与拆层前 `reviewOneStep` 一致，manual 分支返回结构须兼容旧调用方期望的 `out.reviewedBy`/`out.updated` 字段。

**核查结论**：一致。lib/index.js:3151-3168 `reviewOneStep` 内部确为「先 obtain 后（非 manual 时）apply」的两段式；manual 分支显式返回 `{ ..., reviewedBy:'manual', updated:null, ... }`（3154-3164），非 manual 分支 `{ ..., reviewedBy: applied.reviewer, ...applied }`（3167）。调用方 `autoReviewHandler` 单步路径（3443, 3476-3487）确实读取 `out.reviewedBy`、`out.updated`、`out.reviewerLabel` 字段，字段名与拆层前保持一致，未见调用方需要跟随改名。无偏差。

---

## 附：文档自证的测试数字与实测的偏差（超出 A-E 五项核查项，一并汇报）

`node --test`（全量）实测 214/218 通过、4 失败（`test/timeout-fix.test.js` 中断言版本号仍为 4.8.0 的用例，及 3 个 git-worktree 相关用例：shadow GC/getGitHead/L1 语法预检，均与本地 git 环境状态相关，与 v2.0 cc-channel/alternatives/batch 三个改动点无关）。CC-HYBRID.md §6 与 README 4.9.0 行均宣称「全量 218/218」，与本次实测不符。

- **严重度：低**。原因：4 个失败用例均落在 v2.0 涉及的三个模块（cc-channel/alternatives-compare/index.js 降级链与批量并发段）之外——单独运行 `test/cc-channel.test.js`（21/21）与 `test/alternatives-compare.test.js`（9/9）均全绿，v2.0 核心逻辑本身未见测试红线；根因是版本号断言用例未随 4.8.0→4.9.0 跟进更新，以及 git-worktree 相关用例对运行环境（是否为真实 git 仓库/工作树状态）敏感，非协议语义缺陷。
- **建议**：更新或参数化 `timeout-fix.test.js` 的版本号断言（或改为读取 package.json 而非硬编码 4.8.0）；「全量 N/N」类断言建议在 CI 环境下复核后再写入 CC-HYBRID.md/README，避免文档自证数字与实测漂移。

---

## 总评

v2.0 协议实现**自洽**：A-E 五个核查重点（降级链顺序与通道语义、cc-channel 安全契约、alternatives 裁决管道、batchStepIds 受控并发、reviewOneStep 拆层不变性）在 lib/cc-channel.js、lib/alternatives-compare.js、lib/index.js 的实际代码中均与 CC-HYBRID.md §6 / README 4.9.0 行的自述描述一致，未发现颠覆性误解或越界行为，无需阻断发布。唯一发现的偏差是文档「全量 218/218」测试数字与本地实测 214/218 不符，但失败用例与 v2.0 改动范围（cc-channel/alternatives/批量并发）无关，判定为**低危**（文档措辞/维护滞后，非机制缺口），建议记录并在下一次版本号迭代时顺带修正，无需阻断本轮协议演进验收。
