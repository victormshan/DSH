// dsh-web-relay — Host half. v0.3
// Providers:
//   'gemini-free' — official Google Gemini free-tier REST API (needs GEMINI_API_KEY env).
//   'manual' — no model call; persist a pasted answer.
// v0.3 adds structured-instruction execution:
//   POST /dsh-web-relay/parse    — server-side parse of ```json:agent-action blocks, never executes.
//   POST /dsh-web-relay/execute  — server-side RE-parse (never trusts client actions), executes the
//                                  selected indices, and writes ONE complete experiment record
//                                  (frontmatter + original text + parsed actions + per-item results).
// v0.5 record domain: every experiment is written to
//   <workspace>/web-relay/experiments/dsh-web-relay-<ts>.md   (record)
//   <workspace>/web-relay/traces/expr-<ts>.md                 (three-party trace)
// fully decoupled from side-window: the main agent reads the record via the
// injected workspacePath and appends its closure via POST /dsh-web-relay/trace.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

// v2.4-1: 插件版本（从 package.json 实时读取，避免硬编码漂移——原 statusHandler 曾长期报 1.3.0）
export const PLUGIN_VERSION = (() => {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    return (JSON.parse(raw).version) || '0.0.0'
  } catch (err) { return '0.0.0' }
})()

export const name = 'dsh-web-relay'
// apiProxy must be a HARD inject (like dsh-side-window): ctx.get('apiProxy')
// returns undefined because the gateway registers later in composition order.
// shell stays optional via ctx.get (fallback: run_cmd reports unavailable).
// v1.9 V2（dialog 修复）: agentDefaultModel 注入——callDialogModel 经 currentSelection()
// 取 provider/model 对（dsh-llm 契约：provider/model 双字段路由），避免硬编码 provider 无 model。
export const inject = ['webServer', 'fs', 'sandboxPolicy', 'apiProxy', 'agentDefaultModel']

/**
 * Canonical three-party protocol for the web-relay context (v0.5). Single
 * source of truth: returned by GET /dsh-web-relay/protocol and injected into
 * the packaged context (📦) for external models. The web-relay context is
 * fully decoupled from side-window: records + three-party traces live under
 * <workspace>/web-relay/.
 */
export const WEB_RELAY_PROTOCOL_VERSION = 'v1.5'
// v1.6: DAG concurrent scheduling (backward compatible with v1.5 linear mode).
export const WEB_RELAY_PROTOCOL_VERSION_V16 = 'v1.6'
// v1.7: multi-plan comparison (alternatives) / step importance (batch review) /
// planning two-way exploration (main-agent probing + 5-section packaging).
export const WEB_RELAY_PROTOCOL_VERSION_V17 = 'v1.7'
// v1.8: hybrid mode (importance-driven execution/review split) / review:false hard switch /
// restructure state isolation / atomic batch rejection / 5-section template default alignment.
export const WEB_RELAY_PROTOCOL_VERSION_V18 = 'v1.8'
// v1.9: AutoIteration (multi-version automatic evolution) / full-role fallback chain
// (external → dialog → pause) covering ask + review.
export const WEB_RELAY_PROTOCOL_VERSION_V19 = 'v1.9'
export const WEB_RELAY_PROTOCOL = [
  '三方主体（web-relay 语境）：用户 (the human) / 主 agent (the tool-using agent in the main harness session，负责执行与收口) / 外部AI (external web AI — Gemini/DeepSeek 网页版或 free API，负责提供方案与回答)。全程一致使用这三个称谓。',
  '协作规则：任务记录保存在 web-relay/experiments/，三方对话流水（轨迹）保存在 web-relay/traces/。用户在 web-relay 面板发起任务，外部AI 回答，主 agent 按需执行并收口；主 agent 的收口结论通过 POST /dsh-web-relay/trace 追加到对应轨迹，不再写入 side/。',
  '规则 8（Triage 分流）：小改动 → 直接给结论。复杂任务（多步实现/设计分歧/接口未验证）→ 回复生成时必须同时包含：① json:agent-action 代码块（含 wake_agent/plan 动作，reason 说明）② 机器可读的 steps 数组（Step List）。外部 AI 若未遵守，粘贴端将提示一键补全（见面板护栏）——但补全不改变内容本质，仅补格式。',
  'Step List 执行协议（v1.3）：每个复杂任务必须提供结构化 steps。每步默认需要外部 AI 审核（review: true）；主 agent 按步骤执行，每步完成后回写轨迹并等待审核；审核通过后主 agent 继续下一步，被打回则主 agent 修改后重新提交。主 agent 在执行中可提出落地方案变更，审核方核实后更新步骤或通过。',
  'Planning & Architect 协议（v1.4）：复杂任务可先进入 planning 阶段。外部 AI 作为架构师，先深挖任务场景、边界与影响面；如需本地代码/配置上下文，可通过 context_requests 请求主 agent 做只读探路；方案确认后再进入 executing 阶段输出 steps。context_requests 仅允许只读文件读取与搜索，严禁修改代码。',
  '审核降级链协议（v1.5）：每步完成进入 review 后，按 外部AI → 对话模型（无工具）→ 用户手动 的顺序自动审核。无 GEMINI_API_KEY 或调用失败时，自动降级为对话模型（无工具，只读 acceptance 输出 approved/rejected + 意见），仍失败则展开手动审核框。每步记录审核来源（reviewedBy: external | dialog | manual）；任务全部审核完成后统一汇总各步审核来源。',
  '审核容错协议（v1.5）：steps 元素可声明 artifact_required: false（纯分析/规划类步骤不要求实体产物）；审核校验器优先读取该步 notes 与轨迹追加日志判断执行证据，避免因缺少实体文件误打回。',
  '外部 AI Skill（v1.5 新增）：所有外部 AI 生成的内容必须遵循 web_relay_external_ai_protocol（版本 v1.5）——本协议的细化执行规范。三方称谓、规则 8 Triage 分流、json:agent-action Payload 格式、steps 结构、逐步审核循环、产出物与轨迹约定的完整说明见该 Skill 正文（常量 WEB_RELAY_EXTERNAL_AI_SKILL）。版本号：v1.5。',
  '并发调度协议（v1.6）：复杂任务可声明 v1.6 模式（protocolVersion: v1.6），Step List 元素支持 depends_on（依赖步骤 id 数组）与 parallel_group（并行组名）。主 agent 按拓扑依赖门控执行：仅当某步的全部依赖步骤均已 approved 时该步才可开始；无依赖或依赖已满足的多个步骤可并行执行，建议用 subagent 并发；审核仍逐步独立进行（每步完成后单独提交审核）。v1.5 线性模式保持默认不变。',
  '多方案比较协议（v1.7）：复杂任务可要求外部 AI 给出多套候选方案（alternatives）。主 agent 负责提出可行候选并说明取舍，外部 AI 依据验收标准择优，并可在线重构 Step List（增删/合并/重排步骤）后交回主 agent 继续执行。',
  '步骤权重协议（v1.7）：步骤可声明 importance: high | medium | low（缺省 null = 普通）。low/medium 步骤可批量合并审核（batchStepIds 一次提交多个 stepId），high 步骤必须单独严格审核；权重仅作审核编排提示，不改变 review 状态机。',
  'Planning 双向探讨协议（v1.7）：planning 阶段允许主 agent 主动发起探路对话（不只被动响应 context_requests），双向对齐需求与约束。探路结论以 5 段式打包模板回传外部 AI：data_schema（数据结构/字段）/ pricing_map（计价/资源映射）/ mount_points（挂载点/接入位置）/ runtime_limits（运行时限制/超时/配额）/ history_trace（历史轨迹摘要）。',
  '混合模式协议（v1.8）：importance 升级为执行/审核分工契约——low = 主 agent 直接执行免外部审（complete 时系统自动置 approved，reviewedBy 记为 mainagent 留审计）；medium = 批量轻审（batchStepIds 一次提交多个步骤）；high = 三方严格审（单独提交，走 外部AI → 对话模型(无工具) → 手动 三级降级链）；缺省 null = 普通（维持 v1.7 语义）。',
  'review:false 硬开关（v1.8，与 importance 解耦）：未显式指定 review 时按 importance 映射（low → 自动 approved）；显式 review:false → 无条件绕过审核（complete 即 approved，reviewedBy 记为 mainagent，即使 importance=high）；显式 review:true → 强制走审核（即使 importance=low）。',
  'Step List 重构协议（v1.8）：外部 AI 可通过 POST /dsh-web-relay/steps/restructure 在线重构 Step List，仅对 pending/rejected 步骤生效；approved 历史步骤与产物严禁清除/篡改。',
  '批量审核原子打回（v1.8）：batchStepIds 批量审核按原子操作执行——任一步骤被 rejected，则 batch 内所有步骤统一退回 rejected（含刚 approved 的步骤），待补证据后重新提交。',
  '5 段模板缺省对齐（v1.8）：planning 双向探讨的 5 段打包模板固定键名（data_schema / pricing_map / mount_points / runtime_limits / history_trace），不适用字段填 N/A 或 none，严禁省略任何一段。',
  'V1.8.1 澄清（协议级，版本号保持 v1.8）：① reviewSpecified 以 typeof step.review === "boolean" 为准——review:null 或字段缺失一律视为未显式指定（reviewSpecified=false），按 importance 映射；外部 AI 严禁用 review:null 表达显式意图，必须输出 boolean 或直接省略该键。② review:false 仅表示跳过三方/人类审核流（直接置 approved）；主 agent 本地安全护栏（危险命令拦截、越界文件读写策略）为运行时最高级硬约束，优先级高于任何协议参数，不得因 review:false 解除。③ 批量打回仅倒转步骤状态并清空 reviewedBy，不触发代码回滚；重提时针对拒收意见补证据/微调即可；被打回步骤的下游依赖自动闭锁。④ restructure 仅允许修改/删除 pending 与 rejected 步骤，approved 步骤与产物严禁篡改；被删除/替换步骤记录于 changes.removed 并写入 trace 留痕；物理中间产物清理属主 agent 执行纪律。⑤ 重构后的 pending 步骤允许在 depends_on 中引用历史 approved 步骤，门控按新拓扑计算，已有 approved 状态不受影响。⑥ restructure 提交时服务端校验所有 depends_on 引用的合法性，严禁产生指向已删除步骤的悬空依赖（否则返回 400）。⑦ 步骤被打回（含单步打回、自动审核打回、批量连带打回）时清空 reviewedBy（置 null），重新审核通过后再记录审核来源。',
  '自动迭代协议（v1.9，AutoIteration）：用户首次 prompt 可声明 {"iterations": N, "finalAcceptance": "<验收标准>", "autoDecision": true}（缺省 iterations=1 即单轮，向后兼容；N 限 1-10）。每版循环 Vn：外部 AI 评审 V(n-1) 产出与审核反馈 → 输出 Vn 修正 Step List（importance 分工）→ 主 agent 实施（源码层迭代）→ 验证 + commit + tag → 轨迹沉淀。版间门：仅当 Vn 全部 approved 才进入 Vn+1；达到 iterations 上限后收口 done 并唤醒用户最终验收（重启 + 端到端实测）。兜底：任一步骤连续打回 ≥3 次 → 自动暂停（status=paused）并唤醒用户介入，不无限重试。',
  '全角色降级链（v1.9）：所有外部 AI 调用统一降级策略——external(Gemini) → dialog(内部对话模型，无工具) → 失败报错由用户介入（pause）。覆盖 /ask（方案生成/评审/代决策，v1.9 补齐）与 /steps/auto-review（审核，v1.5 起已有）。降级成功时 providerLabel 标注「对话模型（降级）」、record channel 记 dialog-fallback、reviewedBy 记 dialog，审计可溯源。dialog 仅兜底不默认（无工具、质量弱于 Gemini）。',
  'v1.8：混合模式（importance 驱动执行/审核分工）、review:false 硬开关、restructure 状态隔离、批量原子打回、5 段模板缺省对齐。',
  'v1.9：自动迭代（AutoIteration 多版本自动演进、版间门、连续打回熔断）、全角色降级链（external → dialog → pause）。'
].join('\n')

// v1.3: external-AI skill, the detailed execution spec referenced by the
// protocol. External AIs read this directly from the packaged context.
export const WEB_RELAY_EXTERNAL_AI_SKILL = [
  '# web_relay_external_ai_protocol · v1.5',
  '',
  '本 Skill 定义外部 AI（Gemini/DeepSeek 网页版等）在 dsh 协作体系中的职责与产出格式。生成任何方案、回答、代码前阅读并遵循本规范。',
  '',
  '## 三方称谓',
  '- [用户]：人类操作者，最终拍板方。',
  '- [主 agent]：执行方（读写文件、跑命令、调 harness 服务）。',
  '- [侧边 Agent]：方案与审查角色（无工具）；外部 AI 输出将经 relay 面板进入此体系。',
  '',
  '## 协作规则（规则 8 Triage，必须遵守）',
  '- 小改动 / 直接回答：直接给结论，无需 Payload。',
  '- 复杂任务（多步实现 / 设计分歧 / 接口未验证）：输出必须同时包含',
  '  ① json:agent-action 代码块（含 wake_agent/plan 动作，reason 说明）',
  '  ② 机器可读 steps 数组（Step List）。',
  '  若未遵守，relay 粘贴端会提示一键补全——那只是补格式，不改变内容本质。',
  '',
  '## json:agent-action 格式（含 steps）',
  '```json',
  '[',
  '  { "action": "write_file", "path": "<workspace 相对路径>", "content": "..." },',
  '  { "action": "run_cmd", "command": "...", "cwd": ".", "timeout_ms": 30000 },',
  '  {',
  '    "action": "wake_agent",',
  '    "reason": "复杂任务，请主 agent 接管",',
  '    "targetWorkspace": "<路径>",',
  '    "context": "<引子，指向试验记录>",',
  '    "steps": [',
  '      { "id": 1, "title": "定位源码", "detail": "找到 client.js 与 index.js", "review": true, "acceptance": "确认路径和路由注册位置" },',
  '      { "id": 2, "title": "后端接口", "detail": "读取 Key 并调用余额 API", "review": true, "acceptance": "返回余额且不泄露完整 Key" }',
  '    ]',
  '  }',
  ']',
  '```',
  '',
  '也可以使用独立 plan 项承载 steps：',
  '```json',
  '[',
  '  { "action": "plan", "steps": [ ... ] },',
  '  { "action": "wake_agent", "reason": "按 Step List 逐步执行" }',
  ']',
  '```',
  '',
  '## Step List 字段',
  '- id：步骤序号（数字或字符串）。',
  '- title：步骤标题。',
  '- detail：步骤说明。',
  '- review：布尔值，默认 true；表示该步完成后是否需要审核。',
  '- acceptance：验收标准，供主 agent 自检和审核方校验。',
  '- artifacts（可选）：预期产物。',
  '- artifact_required（可选，v1.5）：布尔值，默认 true；false 表示纯分析/规划类步骤不要求实体产物。',
  '- reviewedBy（可选，v1.5，由插件维护）：审核来源 external | dialog | manual。',
    '',
    '## Planning & Architect 模式（v1.4）',
    '- 外部 AI 可先进入 planning 阶段，不直接输出可执行步骤。',
    '- planning 阶段应深入分析任务场景、边界条件、影响模块与潜在隐患。',
    '- 如需本地代码/配置上下文，使用 context_requests 请求主 agent 只读探路。',
    '- context_requests 仅允许 file_read / search 等只读操作，严禁修改代码。',
    '- 方案确认后再进入 executing 阶段，输出标准 steps 数组。',
  '',
  '## 逐步执行与审核循环（v1.3 核心）',
  '- 主 agent 每次只执行一个 step。',
  '- 每步完成后，主 agent 必须把结果写入三方轨迹，并标记该 step 为“待审核”。',
  '- 审核方必须针对该 step 审核：通过（approved）或打回（rejected）。',
  '- 审核通过后，主 agent 才能执行下一步。',
  '- 被打回时，主 agent 根据审核意见修改当前 step 后重新提交。',
  '- 主 agent 可在执行中提出落地方案变更，审核方应核实变更并更新后续步骤。',
  '',
  '## 审核降级链（v1.5）',
  '- 每步进入 review 后按 外部AI → 对话模型（无工具）→ 用户手动 自动降级。',
  '- 外部AI（Gemini）无 key 或调用失败 → 自动降级为对话模型（无工具）审核。',
  '- 对话模型审核仅输出 approved/rejected + 意见，不调用任何工具。',
  '- 对话模型亦不可用 → 面板展开手动审核框，用户输入意见并选择通过/打回。',
  '- 每步记录 reviewedBy；任务完成后汇总审核来源。',
  '',
  '## 产出物约定',
  '- 方案经 relay 落盘：web-relay/experiments/dsh-web-relay-<ts>.md',
  '- frontmatter：id / intent（general|project）/ channel（manual|gemini-free）/ status（pending|done）/ created',
  '- 执行轨迹：web-relay/traces/expr-<ts>.md，三方（用户/主 agent/外部 AI）可追加，幂等。',
  '- Step List 状态：web-relay/experiments/expr-<ts>.steps.json（由插件维护）。',
  '',
  '## 安全护栏',
  '- 所有指令经 [用户] 确认后执行：面板勾选 → /parse 预览 → /execute。',
  '- 越界写文件、无 timeout 命令将被服务端拒绝（invalid）。',
  '- 一键补全只补格式，不代行执行意图。',
  '',
  '## v1.6 并发调度（Step List 拓扑依赖）',
  '- v1.6 模式下，Step List 在 v1.5 字段基础上补充拓扑依赖字段，主 agent 按依赖门控执行，可并行步骤建议用 subagent 并发。',
  '- depends_on（可选）：数组，声明本步依赖的步骤 id（数字或字符串，与 steps 中 id 对应）；全部依赖步 approved 后本步才可开始。',
  '- parallel_group（可选）：字符串，声明并行组名；同一组内步骤互相无依赖、可并行执行，不同组/无组步骤按依赖关系推进。',
  '- 外部 AI 在 v1.6 模式下必须显式标注拓扑依赖（depends_on / parallel_group），否则主 agent 无法进行依赖门控。',
  '',
  '示例（Step 1、4 同组可并行；Step 2 依赖 1、4；Step 3 依赖 2）：',
  '```json',
  '[',
  '  { "id": 1, "title": "接口探路", "detail": "...", "review": true, "acceptance": "...", "parallel_group": "A" },',
  '  { "id": 2, "title": "实现核心逻辑", "detail": "...", "review": true, "acceptance": "...", "depends_on": [1, 4] },',
  '  { "id": 3, "title": "联调验证", "detail": "...", "review": true, "acceptance": "...", "depends_on": [2] },',
  '  { "id": 4, "title": "编写文档", "detail": "...", "review": true, "acceptance": "...", "parallel_group": "A" }',
  ']',
  '```',
  '',
  '## v1.7 多方案比较（alternatives）',
  '- 复杂任务可要求外部 AI 给出多套候选方案；主 agent 负责提出可行候选（含取舍说明），外部 AI 依据验收标准择优。',
  '- alternatives 字段（可选）：数组，每个元素为一个候选方案对象，示例：',
  '```json',
  '"alternatives": [',
  '  { "name": "方案A-直改", "summary": "在现有文件上直接修改，改动最小", "pros": "快、风险低", "cons": "复用度一般" },',
  '  { "name": "方案B-抽取模块", "summary": "抽出独立模块再接入", "pros": "可复用、结构清晰", "cons": "改动面大" }',
  ']',
  '```',
  '- 外部 AI 择优后可通过在线重构 Step List 调整执行计划（增删/合并/重排步骤），重构后交回主 agent 继续执行。',
  '',
  '## v1.7 步骤权重（importance）',
  '- steps 元素可声明 importance: high | medium | low；缺省 null = 普通步骤。',
  '- low / medium 步骤可批量合并审核（前端一次提交多个 stepId 到 /steps/auto-review 的 batchStepIds），high 步骤必须单独严格审核。',
  '- importance 仅作审核编排提示，不改变 review 状态机（每步仍需 approved 才能推进）。',
  '',
  '## v1.7 planning 双向探讨',
  '- planning 阶段允许主 agent 主动发起探路对话（不只被动响应 context_requests），双向对齐需求与约束。',
  '- 主 agent 的探路结论按 5 段式模板打包回传：',
  '  - data_schema：数据结构 / 字段定义',
  '  - pricing_map：计价 / 资源映射',
  '  - mount_points：挂载点 / 接入位置',
  '  - runtime_limits：运行时限制 / 超时 / 配额',
  '  - history_trace：历史轨迹摘要',
  '- 外部 AI 应依据该打包信息收敛方案，减少来回猜测。',
  '',
  '## v1.8 混合模式（importance 驱动分工）',
  '- importance 升级为执行/审核分工契约：low = 主 agent 直接执行免外部审（complete 时系统自动置 approved，reviewedBy 记为 mainagent，留审计）；medium = 批量轻审（batchStepIds 一次提交多个步骤）；high = 三方严格审（单独提交，走 外部AI → 对话模型(无工具) → 手动 三级降级链）；缺省 null = 普通（维持 v1.7 语义）。',
  '- review:false 硬开关（与 importance 解耦）：未显式指定 review 时按 importance 映射（low → 自动 approved）；显式 review:false → 无条件绕过审核（complete 即 approved，reviewedBy 记为 mainagent，即使 importance=high）；显式 review:true → 强制走审核（即使 importance=low）。插件通过 reviewSpecified 记录 raw 是否显式声明 review，以区分缺省与显式 true。',
  '- 微调1（restructure 状态隔离）：外部 AI 重构 Step List（POST /dsh-web-relay/steps/restructure）仅对 pending/rejected 步骤生效；approved 历史步骤与产物严禁清除/篡改。',
  '- 微调2（批量审核原子打回）：batchStepIds 批量审核按原子操作——任一 rejected → batch 内所有步骤统一退回 rejected（含刚 approved 的步骤），待补证据后重新提交。',
  '- 微调3（5 段模板缺省对齐）：planning 双向探讨的 5 段打包模板固定键名（data_schema / pricing_map / mount_points / runtime_limits / history_trace），不适用字段填 N/A 或 none，严禁省略任何一段。',
  '',
  '## v1.8.1 澄清（版本号保持 v1.8）',
  '- reviewSpecified 判定：以 typeof step.review === "boolean" 为准；review:null 或字段缺失一律视为未显式指定（reviewSpecified=false），按 importance 映射；严禁用 review:null 表达显式意图。',
  '- 安全护栏优先：review:false 仅跳过三方/人类审核流；主 agent 本地安全护栏（危险命令拦截、越界文件策略）为运行时最高级硬约束，优先级高于任何协议参数。',
  '- 打回副作用：批量打回仅倒转步骤状态并清空 reviewedBy，不触发代码回滚；下游依赖自动闭锁。',
  '- 重构作用域：restructure 仅修改/删除 pending 与 rejected；approved 与产物严禁篡改；删除经 changes.removed + trace 留痕。',
  '- 悬空依赖校验：restructure 服务端校验所有 depends_on 引用，指向已删除步骤时返回 400。',
  '- reviewedBy 清空：步骤被打回（单步/自动/批量连带）时置 null，重新审核通过后再记录。',
  '',
  '## v1.9 自动迭代与全角色降级',
  '- AutoIteration：用户 prompt 可声明 {"iterations": N(1-10), "finalAcceptance": "...", "autoDecision": true}；每版 Vn 由外部 AI 评审上版产出输出修正 Step List，主 agent 源码层实施 + 验证 + commit/tag；版间门（Vn 全 approved 才进 Vn+1）；达上限收口并唤醒用户最终验收。',
  '- 熔断兜底：任一步骤连续打回 ≥3 次 → 任务自动 paused 并唤醒用户，不无限重试。',
  '- 全角色降级链：external(Gemini) → dialog(内部对话模型，无工具) → pause；覆盖 /ask 与 /steps/auto-review；降级标注 providerLabel「对话模型（降级）」/ channel=dialog-fallback / reviewedBy=dialog。',
  '',
  '## 版本历史',
  '- v1.1：规则 8 Triage 分流硬编码。',
  '- v1.2：本 Skill 固化，作为规则 8 的细化执行规范。',
  '- v1.3：Step List 升级为结构化 steps，加入逐步执行 + 外部 AI 审核回路。',
  '- v1.4：加入 Planning & Architect 模式，支持 phase 与 context_requests 只读探路。',
  '- v1.5：审核降级链（外部AI → 对话模型(无工具) → 手动）、artifact_required 容错、reviewedBy 审核来源。',
  '- v1.6：Step List 并发调度（depends_on / parallel_group），主 agent 依赖门控 + 多步并行，审核逐步独立。',
  '- v1.7：多方案比较（alternatives）、步骤权重（importance）与批量合并审核、planning 双向探讨（5 段式打包模板）。',
  '- v1.8：混合模式（importance 驱动执行/审核分工）、review:false 硬开关、restructure 状态隔离、批量原子打回、5 段模板缺省对齐。',
  '- v1.9：自动迭代（AutoIteration 多版本自动演进、版间门、连续打回熔断）、全角色降级链（external → dialog → pause）。'
].join('\n')

// ---------------------------------------------------------------------------
// English protocol text (used when the panel locale is 'en'). Mirror of the
// Chinese protocol above, kept in sync by hand.
// ---------------------------------------------------------------------------
export const WEB_RELAY_PROTOCOL_EN = [
  'Three-party roles (web-relay context): [User] (the human) / [Main agent] (the tool-using agent in the main harness session, responsible for execution and finalization) / [External AI] (external web AI — Gemini/DeepSeek web version or free API, providing plans and answers). Use these three labels consistently.',
  'Collaboration rules: task records are saved under web-relay/experiments/, the three-party trace stream under web-relay/traces/. The user starts a task in the web-relay panel, the external AI answers, the main agent executes and finalizes as needed; the main agent appends its closure via POST /dsh-web-relay/trace to the matching trace, never into side/.',
  'Rule 8 (Triage): small changes → answer directly. Complex tasks (multi-step implementation / design divergence / unverified interfaces) → your reply MUST include ① a json:agent-action block (with wake_agent/plan actions and a reason) ② a machine-readable steps array (Step List). If you do not comply, the paste side will offer one-click completion (panel guardrail) — that only fixes the format, never the content.',
  'Step List execution protocol (v1.3): every complex task must provide structured steps. Each step requires review by default (review: true); the main agent executes steps, writes the trace after each step and waits for review; after approval it continues to the next step, on rejection it revises and resubmits. The main agent may propose implementation changes during execution; the reviewer verifies and updates or approves them.',
  'Planning & Architect protocol (v1.4): complex tasks may enter a planning phase first. The external AI acts as architect, digging into task scope, boundaries and impact; for local code/config context it may request the main agent to do read-only probing via context_requests; after the plan is confirmed it enters the executing phase and outputs steps. context_requests allows only read-only file reads and searches; modifying code is strictly forbidden.',
  'Review degradation chain (v1.5): after each step enters review, auto-review runs in order External AI → dialog model (no tools) → manual user. Without GEMINI_API_KEY or on call failure, it degrades to the dialog model (no tools; reads acceptance and outputs approved/rejected + opinion); if that also fails, a manual review box opens. Each step records its reviewer (reviewedBy: external | dialog | manual); once all steps are reviewed, a reviewer summary is produced.',
  'Review tolerance (v1.5): steps may declare artifact_required: false (pure analysis/planning steps do not require an artifact file); the reviewer reads the step notes and trace appends first to judge execution evidence, avoiding false rejections for missing files.',
  'External AI Skill (v1.5): all external AI output must follow web_relay_external_ai_protocol (version v1.5) — the detailed execution spec: three-party labels, Rule 8 Triage, json:agent-action payload format, steps structure, step-by-step review loop, artifacts and trace conventions. Version: v1.5.',
  'Concurrent scheduling protocol (v1.6): complex tasks may opt into v1.6 mode (protocolVersion: v1.6); Step List elements support depends_on (array of dependency step ids) and parallel_group (parallel group name). The main agent gates execution by topological dependencies: a step may start only when all its dependency steps are approved; multiple steps with no unmet dependencies may run in parallel (suggested via subagents); review stays per-step (each step is reviewed independently after completion). v1.5 linear mode remains the default.',
  'Multi-plan comparison protocol (v1.7): complex tasks may ask the External AI for multiple candidate plans (alternatives). The Main agent proposes feasible candidates with trade-offs; the External AI picks the best against the acceptance criteria and may restructure the Step List online (add/merge/reorder steps) before handing it back to the Main agent.',
  'Step importance protocol (v1.7): steps may declare importance: high | medium | low (default null = normal). low/medium steps may be batch-reviewed together (batchStepIds submits several stepIds at once); high steps must be reviewed individually and strictly. Importance is only a review-orchestration hint; it does not change the review state machine.',
  'Planning two-way exploration protocol (v1.7): during planning, the Main agent may proactively start exploration conversations (not only passively answering context_requests) to align requirements and constraints. Exploration conclusions are packaged back to the External AI in a 5-section template: data_schema (data structures/fields) / pricing_map (pricing/resource mapping) / mount_points (mount points/integration locations) / runtime_limits (runtime limits/timeouts/quotas) / history_trace (historical trace summary).',
  'Hybrid mode protocol (v1.8): importance becomes the execution/review division contract — low = the main agent executes directly without external review (on complete the system auto-sets approved, reviewedBy: mainagent, kept for audit); medium = batch light review (batchStepIds submits several steps at once); high = three-party strict review (submitted individually, running the External AI → dialog model (no tools) → manual degradation chain); default null = normal (v1.7 semantics preserved).',
  'review:false hard switch (v1.8, decoupled from importance): when review is not explicitly set, it maps by importance (low → auto approved); explicit review:false → unconditionally bypasses review (complete is immediately approved, reviewedBy: mainagent, even with importance=high); explicit review:true → forces review (even with importance=low).',
  'Step List restructure protocol (v1.8): the External AI may restructure the Step List online via POST /dsh-web-relay/steps/restructure; it applies only to pending/rejected steps; approved historical steps and artifacts must never be cleared or tampered with.',
  'Atomic batch rejection (v1.8): batchStepIds batch review is atomic — if any step is rejected, every step in the batch is uniformly returned to rejected (including just-approved ones), pending supplementary evidence.',
  '5-section template default alignment (v1.8): the planning two-way exploration template uses fixed keys (data_schema / pricing_map / mount_points / runtime_limits / history_trace); write N/A or none for inapplicable fields; omitting a section is forbidden.',
  'V1.8.1 clarifications (protocol-level, version stays v1.8): ① reviewSpecified is determined by typeof step.review === "boolean" — review:null or a missing field is always treated as not-explicitly-specified (reviewSpecified=false) and mapped by importance; External AI must never use review:null to express explicit intent, output a boolean or omit the key. ② review:false only skips the three-party/human review flow (directly approved); the Main agent local security guardrails (dangerous command blocking, out-of-bounds file policies) are the highest-priority runtime hard constraints, above any protocol parameter, and must not be disabled by review:false. ③ Atomic batch rejection only flips step status and clears reviewedBy; it never rolls back code; on resubmission just add evidence or fine-tune per the rejection notes; downstream dependencies of rejected steps auto-lock. ④ restructure only modifies/deletes pending and rejected steps; approved steps and artifacts are never tampered with; deleted/replaced steps are recorded in changes.removed and written to the trace; physical intermediate cleanup is the Main agent execution discipline. ⑤ restructured pending steps may reference historical approved steps in depends_on; gating follows the new topology and existing approved status is unaffected. ⑥ the restructure endpoint validates all depends_on references server-side and rejects dangling dependencies (HTTP 400). ⑦ when a step is rejected (single-step, auto-review, or batch-atomic), reviewedBy is cleared (null) and re-recorded only after a later approval.',
  'v1.8: hybrid mode (importance-driven execution/review division), review:false hard switch, restructure state isolation, atomic batch rejection, 5-section template default alignment.',
  'AutoIteration protocol (v1.9): the user may declare {"iterations": N, "finalAcceptance": "<acceptance>", "autoDecision": true} in the initial prompt (default iterations=1 = single round, backward compatible; N limited to 1-10). Each round Vn: the External AI reviews V(n-1) output and review feedback, produces the Vn revised Step List (importance division), the Main agent implements (source-level iteration), verifies + commits + tags, and settles the trace. Round gate: Vn+1 starts only when all Vn steps are approved; at the iterations limit the task is finalized (done) and the user is woken for final acceptance (restart + end-to-end verification). Circuit breaker: any step rejected 3 consecutive times → auto-pause (status=paused) and wake the user; never retry indefinitely.',
  'Full-role fallback chain (v1.9): every External AI call follows the same degradation policy — external(Gemini) → dialog (internal dialog model, no tools) → report the error and let the user intervene (pause). Covers /ask (plan/review/decision generation, added in v1.9) and /steps/auto-review (review, existing since v1.5). On degraded success providerLabel is marked "对话模型（降级）", record channel is dialog-fallback, reviewedBy is dialog for auditability. dialog is fallback-only, never the default (no tools, weaker quality than Gemini).',
  'v1.9: AutoIteration (multi-version automatic evolution, round gates, consecutive-rejection circuit breaker), full-role fallback chain (external → dialog → pause).'
].join('\n')

export const WEB_RELAY_EXTERNAL_AI_SKILL_EN = [
  '# web_relay_external_ai_protocol · v1.5 / v1.6',
  '',
  'This Skill defines the duties and output format of the External AI (Gemini/DeepSeek web version, free API, etc.) within the dsh collaboration system. Read and follow it before generating any plan, answer, or code.',
  '',
  '## Three-party labels',
  '- [User]: the human operator, final decision maker.',
  '- [Main agent]: the executor (reads/writes files, runs commands, calls harness services).',
  '- [Side agent / External AI]: the planning and review role (no tools); external AI output enters this system through the relay panel.',
  '',
  '## Collaboration rules (Rule 8 Triage — MUST follow)',
  '- Small change / direct answer: answer directly, no payload needed.',
  '- Complex task (multi-step implementation / design divergence / unverified interfaces): output MUST include',
  '  ① a json:agent-action block (with wake_agent/plan actions and a reason)',
  '  ② a machine-readable steps array (Step List).',
  '  If you do not, the relay paste side will offer one-click completion — that only fixes the format, never the intent.',
  '',
  '## json:agent-action format (with steps)',
  '```json',
  '[',
  '  { "action": "write_file", "path": "<workspace-relative path>", "content": "..." },',
  '  { "action": "run_cmd", "command": "...", "cwd": ".", "timeout_ms": 30000 },',
  '  {',
  '    "action": "wake_agent",',
  '    "reason": "complex task, hand over to the main agent",',
  '    "targetWorkspace": "<path>",',
  '    "context": "<intro, pointing to the task record>",',
  '    "steps": [',
  '      { "id": 1, "title": "Locate source", "detail": "find client.js and index.js", "review": true, "acceptance": "confirm paths and route registration" },',
  '      { "id": 2, "title": "Backend endpoint", "detail": "read the key and call the balance API", "review": true, "acceptance": "returns balance without leaking the full key" }',
  '    ]',
  '  }',
  ']',
  '```',
  '',
  'You may also carry steps in a standalone plan item:',
  '```json',
  '[',
  '  { "action": "plan", "steps": [ ... ] },',
  '  { "action": "wake_agent", "reason": "execute step by step" }',
  ']',
  '```',
  '',
  '## Step List fields',
  '- id: step index (number or string).',
  '- title: step title.',
  '- detail: step description.',
  '- review: boolean, default true; whether the step needs review after completion.',
  '- acceptance: acceptance criteria, used by the main agent for self-check and by reviewers.',
  '- artifacts (optional): expected artifacts.',
  '- artifact_required (optional, v1.5): boolean, default true; false = pure analysis/planning step, no artifact file required.',
  '- reviewedBy (optional, v1.5, maintained by the plugin): reviewer source external | dialog | manual.',
  '- depends_on (optional, v1.6): array of dependency step ids; the step may start only after all dependencies are approved.',
  '- parallel_group (optional, v1.6): parallel group name; steps in the same group have no mutual dependency and may run in parallel.',
  '',
  '## Planning & Architect mode (v1.4)',
  '- The external AI may enter a planning phase first instead of outputting executable steps.',
  '- During planning, analyze the task scope, boundary conditions, affected modules and potential risks in depth.',
  '- For local code/config context, use context_requests to ask the main agent for read-only probing.',
  '- context_requests allows only read-only operations (file_read / search); modifying code is forbidden.',
  '- After the plan is confirmed, enter the executing phase and output a standard steps array.',
  '',
  '## Step-by-step execution and review loop (v1.3 core)',
  '- The main agent executes one step at a time (v1.6: steps whose dependencies are satisfied may run in parallel via subagents).',
  '- After each step, the main agent MUST write the result into the three-party trace and mark the step as "awaiting review".',
  '- The reviewer must review the step: approve or reject.',
  '- Only after approval may the main agent proceed to the next step.',
  '- On rejection, the main agent revises the current step and resubmits.',
  '- The main agent may propose implementation changes during execution; the reviewer verifies and updates subsequent steps or approves.',
  '',
  '## Review degradation chain (v1.5)',
  '- After a step enters review, auto-review degrades in order: External AI → dialog model (no tools) → manual user.',
  '- No GEMINI_API_KEY or call failure → degrade to the dialog model (no tools) review.',
  '- The dialog model only outputs approved/rejected + opinion; it never calls any tool.',
  '- If the dialog model is also unavailable → a manual review box opens for the user to input opinion and choose approve/reject.',
  '- Each step records reviewedBy; after the task completes, a reviewer summary is produced.',
  '',
  '## Artifacts & trace conventions',
  '- Plans land via the relay: web-relay/experiments/dsh-web-relay-<ts>.md',
  '- frontmatter: id / intent (general|project) / channel (manual|gemini-free) / status (pending|done) / created',
  '- Execution trace: web-relay/traces/expr-<ts>.md, three parties (User / Main agent / External AI) may append; idempotent.',
  '- Step List state: web-relay/experiments/expr-<ts>.steps.json (maintained by the plugin).',
  '',
  '## Safety guardrails',
  '- All instructions are executed after [User] confirmation: panel checkbox → /parse preview → /execute.',
  '- Out-of-workspace writes and commands without a timeout are rejected server-side (invalid).',
  '- One-click completion only fixes the format, never the execution intent.',
  '',
  '## v1.6 concurrent scheduling (Step List topological dependencies)',
  '- In v1.6 mode, Step List adds topological dependency fields on top of v1.5; the main agent gates by dependencies; parallel-ready steps are suggested for subagent concurrency.',
  '- depends_on (optional): array of dependency step ids (matching steps ids); the step may start only after all dependencies are approved.',
  '- parallel_group (optional): parallel group name; steps in the same group have no mutual dependency and may run in parallel; steps in different groups or with no group advance by dependency.',
  '- In v1.6 mode you MUST explicitly mark the topology (depends_on / parallel_group); otherwise the main agent cannot gate by dependencies.',
  '',
  'Example (Step 1, 4 in the same group run in parallel; Step 2 depends on 1, 4; Step 3 depends on 2):',
  '```json',
  '[',
  '  { "id": 1, "title": "Probe interfaces", "detail": "...", "review": true, "acceptance": "...", "parallel_group": "A" },',
  '  { "id": 2, "title": "Implement core logic", "detail": "...", "review": true, "acceptance": "...", "depends_on": [1, 4] },',
  '  { "id": 3, "title": "Integration verification", "detail": "...", "review": true, "acceptance": "...", "depends_on": [2] },',
  '  { "id": 4, "title": "Write docs", "detail": "...", "review": true, "acceptance": "...", "parallel_group": "A" }',
  ']',
  '```',
  '',
  '## v1.7 multi-plan comparison (alternatives)',
  '- Complex tasks may ask the External AI for multiple candidate plans; the Main agent proposes feasible candidates (with trade-offs), and the External AI picks the best against the acceptance criteria.',
  '- alternatives (optional): array of candidate plan objects, e.g.:',
  '```json',
  '"alternatives": [',
  '  { "name": "Plan A - direct edit", "summary": "modify existing files in place, minimal change", "pros": "fast, low risk", "cons": "limited reuse" },',
  '  { "name": "Plan B - extract module", "summary": "extract a standalone module then integrate", "pros": "reusable, clean structure", "cons": "larger change surface" }',
  ']',
  '```',
  '- After picking a plan, the External AI may restructure the Step List online (add/merge/reorder steps) and hand it back to the Main agent.',
  '',
  '## v1.7 step importance',
  '- steps elements may declare importance: high | medium | low; default null = normal step.',
  '- low / medium steps may be batch-reviewed together (submit multiple stepIds in batchStepIds to /steps/auto-review); high steps must be reviewed individually and strictly.',
  '- importance is only a review-orchestration hint; it does not change the review state machine (each step still needs approved to advance).',
  '',
  '## v1.7 planning two-way exploration',
  '- During planning, the Main agent may proactively start exploration conversations (not only passively answering context_requests) to align requirements and constraints.',
  '- The Main agent packages exploration conclusions in a 5-section template:',
  '  - data_schema: data structures / field definitions',
  '  - pricing_map: pricing / resource mapping',
  '  - mount_points: mount points / integration locations',
  '  - runtime_limits: runtime limits / timeouts / quotas',
  '  - history_trace: historical trace summary',
  '- The External AI should converge the plan from this packaged information to reduce back-and-forth guessing.',
  '',
  '## v1.8 hybrid mode (importance-driven division)',
  '- importance becomes the execution/review division contract: low = the main agent executes directly without external review (on complete the system auto-sets approved, reviewedBy: mainagent, kept for audit); medium = batch light review (batchStepIds submits several steps at once); high = three-party strict review (submitted individually, running the External AI → dialog model (no tools) → manual degradation chain); default null = normal (v1.7 semantics preserved).',
  '- review:false hard switch (decoupled from importance): when review is not explicitly set, it maps by importance (low → auto approved); explicit review:false → unconditionally bypasses review (complete is immediately approved, reviewedBy: mainagent, even with importance=high); explicit review:true → forces review (even with importance=low). The plugin records reviewSpecified (whether raw explicitly declared review) to distinguish default from explicit true.',
  '- Tweak 1 (restructure state isolation): the External AI may restructure the Step List (POST /dsh-web-relay/steps/restructure) only for pending/rejected steps; approved historical steps and artifacts must never be cleared or tampered with.',
  '- Tweak 2 (atomic batch rejection): batchStepIds batch review is atomic — if any step is rejected, every step in the batch is uniformly returned to rejected (including just-approved ones), pending supplementary evidence.',
  '- Tweak 3 (5-section template default alignment): the planning two-way exploration template uses fixed keys (data_schema / pricing_map / mount_points / runtime_limits / history_trace); write N/A or none for inapplicable fields; omitting a section is forbidden.',
  '',
  '## v1.8.1 clarifications (version stays v1.8)',
  '- reviewSpecified: determined by typeof step.review === "boolean"; review:null or a missing field is always treated as not-explicitly-specified (reviewSpecified=false) and mapped by importance; never use review:null to express explicit intent.',
  '- Security guardrails override: review:false only skips the three-party/human review flow; Main agent local guardrails (dangerous command blocking, out-of-bounds file policies) are the highest-priority runtime hard constraints, above any protocol parameter.',
  '- Rejection side effects: atomic batch rejection only flips step status and clears reviewedBy; never rolls back code; downstream dependencies auto-lock.',
  '- Restructure scope: only pending/rejected steps may be modified/deleted; approved steps and artifacts are never tampered with; deletions are recorded in changes.removed and written to the trace.',
  '- Dangling dependency validation: the restructure endpoint validates all depends_on references server-side and returns 400 when a reference points to a removed step.',
  '- reviewedBy reset: when a step is rejected (single-step, auto-review, or batch-atomic), reviewedBy is cleared (null) and re-recorded only after a later approval.',
  '',
  '## v1.9 AutoIteration & full-role fallback',
  '- AutoIteration: the user may declare {"iterations": N(1-10), "finalAcceptance": "...", "autoDecision": true} in the prompt; each round Vn the External AI reviews the previous output and produces the Vn revised Step List; the Main agent implements at source level + verifies + commits/tags; round gate (Vn+1 only after all Vn approved); at the limit, finalize and wake the user for final acceptance.',
  '- Circuit breaker: any step rejected 3 consecutive times → task auto-pauses (paused) and wakes the user; never retry indefinitely.',
  '- Full-role fallback chain: external(Gemini) → dialog (internal dialog model, no tools) → pause; covers /ask and /steps/auto-review; degraded calls are marked providerLabel "对话模型（降级）" / channel=dialog-fallback / reviewedBy=dialog.',
  '',
  '## Version history',
  '- v1.1: Rule 8 Triage hardcoded.',
  '- v1.2: This Skill formalized as the detailed execution spec of Rule 8.',
  '- v1.3: Step List upgraded to structured steps; step-by-step execution + external AI review loop.',
  '- v1.4: Planning & Architect mode; phase and read-only context_requests probing.',
  '- v1.5: Review degradation chain (External AI → dialog model (no tools) → manual), artifact_required tolerance, reviewedBy.',
  '- v1.6: Step List concurrent scheduling (depends_on / parallel_group); dependency gating + multi-step parallelism; per-step review.',
  '- v1.7: multi-plan comparison (alternatives), step importance (importance) with batch review, planning two-way exploration (5-section packaging).',
  '- v1.8: hybrid mode (importance-driven execution/review division), review:false hard switch, restructure state isolation, atomic batch rejection, 5-section template default alignment.',
  '- v1.9: AutoIteration (multi-version automatic evolution, round gates, consecutive-rejection circuit breaker), full-role fallback chain (external → dialog → pause).'
].join('\n')

// v0.5 record-domain constants: web-relay owns its own directory tree.
const EXPERIMENTS_DIR = 'web-relay/experiments'
const TRACES_DIR = 'web-relay/traces'
const LEGACY_EXPERIMENTS_DIR = 'side/experiments' // read-only compat for pre-v0.5 records
const TRACE_ID_RE = /^expr-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/
const ROLE_LABEL = { user: '用户', mainagent: '主 agent', external: '外部AI' }
const LABEL_ROLE = { '用户': 'user', '主 agent': 'mainagent', '外部AI': 'external' }

const GEMINI_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models'
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? ''
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash'
// v1.9 web-gemini 通道：本地中转服务器（Chrome 扩展 dsh-web-gemini-ext 桥接 gemini.google.com）。
// 可用 DSH_RELAY_BRIDGE 覆盖；无需 API Key、免配额。
export const BRIDGE_BASE = process.env.DSH_RELAY_BRIDGE || 'http://localhost:8899'
// v1.9 claude 通道：默认 Claude 模型（经 harness llm 服务 anthropic provider 调用；
// 需配置 llm-pi-ai providers.anthropic 路由 + ANTHROPIC_API_KEY 环境变量）。可用 DSH_RELAY_CLAUDE_MODEL 覆盖。
export const CLAUDE_DEFAULT_MODEL = process.env.DSH_RELAY_CLAUDE_MODEL || 'claude-sonnet-4-5'

const RUN_CMD_TIMEOUT_DEFAULT = 30000
const RUN_CMD_TIMEOUT_MAX = 60000
// Capture up to 20k bytes per stream so the 2000-char display slice is the HEAD.
const OUTPUT_CAPTURE = 20000
const DISPLAY_LIMIT = 2000
const WRITE_FILE_MAX = 3
const RUN_CMD_MAX = 1

const CORS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type'
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const json = (res, code, payload) => {
  res.writeHead(code, CORS)
  res.end(JSON.stringify(payload))
}

async function callGemini(prompt) {
  const url = `${GEMINI_ROOT}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  })
  const raw = await resp.text().catch(() => '')
  if (!resp.ok) return { ok: false, error: `Gemini HTTP ${resp.status}: ${raw.slice(0, 500)}` }
  let data
  try { data = JSON.parse(raw) } catch { return { ok: false, error: 'Gemini returned non-JSON response' } }
  const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  if (!text) return { ok: false, error: 'Gemini returned empty answer' }
  return { ok: true, text }
}

export function apply(ctx) {
  const { webServer, fs, sandboxPolicy, apiProxy } = ctx
  // shell is optional: run_cmd degrades to a clear error when unavailable.
  const shell = ctx.get('shell')
  // llm is optional: dialog-model auto-review degrades to manual when unavailable.
  const llm = ctx.get('llm')
  const agentDefaultModel = ctx.get('agentDefaultModel')   // v1.9 V2：dialog 修复——取 provider/model 对

  const baseOf = (workspacePath) =>
    (workspacePath && String(workspacePath).trim())
      ? String(workspacePath).trim()
      : (sandboxPolicy?.workspaceRoot || process.cwd())

  const safePolicyFor = (base) =>
    sandboxPolicy?.resolve
      ? { ...sandboxPolicy.resolve({ mode: 'workspace-write' }), workspaceRoot: base }
      : { workspaceRoot: base, mode: 'workspace-write' }

  // ---------- v1.5: 审核辅助 ----------
  // 构建审核 prompt（外部 AI 与对话模型共用）；artifact_required:false 的步骤不要求实体产物。
  // v2.2-1: 增加 artifactsSummary 参数——上一步产物文件内容摘要注入审核上下文，降低盲审打回。
  function buildReviewPrompt(exprId, step, recordText, traceText, reviewer, artifactsSummary) {
    return [
      `你是 dsh-web-relay 的审核员（${reviewer}）。请只审核当前 Step。`,
      '',
      `任务 ID：${exprId}`,
      `Step ID：${step.id}`,
      `标题：${step.title}`,
      `详情：${step.detail || '(无)'}`,
      `验收标准：${step.acceptance || '(无)'}`,
      `要求实体产物：${step.artifact_required === false ? '否（纯分析/规划类，不要求产出文件）' : '是'}`,
      `当前 notes：${JSON.stringify(step.notes || [])}`,
      `artifacts：${JSON.stringify(step.artifacts || [])}`,
      '',
      '主 agent 已提交 review，请根据实际执行结果审核。',
      '',
      artifactsSummary ? artifactsSummary : '',
      '',
      '【任务记录摘要】',
      clip(recordText || '(无)', 4000),
      '',
      '【三方轨迹】',
      clip(traceText || '(无)', 4000),
      '排序说明：以上三方轨迹按时间正序排列，最新内容在末尾，请优先关注末尾的最新状态。',
      '',
      '审核要点：',
      '- 优先依据该步 notes 与轨迹追加日志判断执行证据；若 artifact_required 为 false，不要因缺少实体文件而打回。',
      '- 通过（approved）要求验收标准已达成；否则打回（rejected）并给出具体修改意见。',
      '',
      '请只回复 JSON，格式：{"result":"approved" 或 "rejected","reason":"审核意见"}'
    ].join('\n')
  }

  // v2.2-1: 上一步产物摘要（读取 step.artifacts 指向的文件内容，截断 2000 字符/文件；
  // 无 artifacts 或读取失败时优雅跳过，绝不阻断审核流程）。
  async function buildArtifactsSummary(base, safePolicy, artifacts) {
    const list = Array.isArray(artifacts) ? artifacts : []
    if (list.length === 0) return ''
    const parts = []
    for (const raw of list) {
      const p = String(raw || '').trim()
      if (!p) continue
      try {
        const target = await fs.resolve(p, { cwd: base })
        const text = await fs.readText(target).catch(() => null)
        if (text == null) { parts.push(`（无法读取产物：${p}）`); continue }
        parts.push(`--- ${p} ---\n${clip(text, 2000)}`)
      } catch (err) { parts.push(`（产物路径无法解析：${p}）`) }
    }
    return '【上一步产物摘要（v2.2-1 上下文增强，自动注入）】\n' + parts.join('\n\n')
  }

  // 对话模型（无工具）审核：跟随主会话路由（llm 服务），纯文本输出，不调用任何工具。
  // 任何异常均返回 { ok:false }，由调用方继续降级到手动审核。
  // v1.9 V2 修复：① 递归提取 chunk 文本（适配各种 stream 返回结构）② provider 容错重试
  // （先按显式 provider，空响应或无 provider 时回落 llm 默认路由）。
  function extractChunkText(chunk) {
    if (chunk == null) return ''
    if (typeof chunk === 'string') return chunk
    const direct =
      chunk?.text ?? chunk?.delta?.text ?? chunk?.delta ?? chunk?.content ??
      chunk?.message?.content ?? chunk?.message?.text ?? chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.message?.content
    if (typeof direct === 'string' && direct) return direct
    const parts = []
    const walk = (v, depth) => {
      if (depth > 6 || parts.length > 40) return
      if (typeof v === 'string' && v.trim()) { parts.push(v); return }
      if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return }
      if (v && typeof v === 'object') {
        for (const k of Object.keys(v)) {
          if (k === 'type' || k === 'role' || k === 'id' || k === 'index' || k === 'finishReason' || k === 'finish_reason') continue
          walk(v[k], depth + 1)
        }
      }
    }
    walk(chunk, 0)
    return parts.join('')
  }
  async function callDialogModel(prompt) {
    if (!llm) return { ok: false, error: 'llm 服务不可用' }
    // v1.9 V2（dialog 修复根因）：
    // ① messages.content 用块数组格式 [{ type:'text', text }]（dsh-llm createUserMessage 契约，
    //    字符串 content 与 adapter 的 blocks 处理不符 → 空响应）；
    // ② provider/model 取自 agentDefaultModel.currentSelection()（dsh-llm 契约 provider/model 双字段路由），
    //    回退 deepseek-official。
    let sel = null
    try {
      sel = (agentDefaultModel && typeof agentDefaultModel.currentSelection === 'function')
        ? agentDefaultModel.currentSelection()
        : null
    } catch { /* selection 读取失败走回退 */ }
    const selProvider = sel && typeof sel.provider === 'string' && sel.provider ? sel.provider : null
    const selModel = sel && typeof sel.model === 'string' && sel.model ? sel.model : null
    const messages = [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
    const baseOpts = {
      messages,
      tools: [],
      stream: false,
      signal: AbortSignal.timeout(60000)
    }
    // 尝试顺序：currentSelection provider/model → 显式 deepseek-official → llm 默认路由（不带 provider）
    const attempts = []
    if (selProvider) attempts.push({ provider: selProvider, ...(selModel ? { model: selModel } : {}) })
    attempts.push({ provider: 'deepseek-official' }, {})
    for (const extra of attempts) {
      try {
        const chunks = []
        const stream = llm.stream({ ...baseOpts, ...extra })
        for await (const chunk of stream) {
          if (chunk && chunk.type === 'error') return { ok: false, error: String(chunk.error || 'llm error') }
          if (chunk && chunk.type === 'aborted') return { ok: false, error: 'llm aborted' }
          const text = extractChunkText(chunk)
          if (text) chunks.push(text)
        }
        const text = chunks.join('').trim()
        if (text) return { ok: true, text }
      } catch (e) {
        if (attempts.indexOf(extra) === attempts.length - 1) return { ok: false, error: e?.message || String(e) }
      }
    }
    return { ok: false, error: '对话模型返回空' }
  }

  // 解析审核回复为 { result, reason }
  function parseReview(text) {
    let parsed = null
    const m = String(text || '').match(/\{[\s\S]*\}/)
    if (m) {
      try { parsed = JSON.parse(m[0]) } catch (err) { /* fall through */ }
    }
    const result = parsed && parsed.result
      ? String(parsed.result).toLowerCase()
      : /approved|通过|同意/i.test(text)
        ? 'approved'
        : /rejected|打回|不通过|拒绝/i.test(text)
          ? 'rejected'
          : ''
    const reason = (parsed && parsed.reason) || String(text || '').slice(0, 500)
    return { result, reason }
  }

  // ---------- v1.9 web-gemini 通道：本地中转（Chrome 扩展 dsh-web-gemini-ext）----------
  // 发任务到 BRIDGE_BASE/create-task，轮询 task-result 直到 done；无 API Key、免配额。
  // 返回 { ok, text } 或 { ok:false, error }。
  async function webGeminiAsk(prompt, timeoutMs = 150000) {
    try {
      const c = await fetch(`${BRIDGE_BASE}/create-task`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt })
      })
      const cd = await c.json().catch(() => null)
      if (!cd || !cd.ok || !cd.id) return { ok: false, error: 'bridge create-task 失败（中转服务器未运行？）' }
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000))
        const t = await fetch(`${BRIDGE_BASE}/task-result/${cd.id}`)
        const td = await t.json().catch(() => null)
        if (td && td.ok && td.task && td.task.status === 'done' && td.task.answer) {
          return { ok: true, text: td.task.answer }
        }
      }
      return { ok: false, error: `bridge 超时（${timeoutMs}ms，Gemini 网页未回复）` }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  }

  // ---------- v1.5: 审核状态锁（防重复唤醒/重复提交） ----------
  // 模块级 Map：key = exprId:stepId -> 最近一次审核/唤醒时间戳；同 key 8 秒内拒绝重复。
  const reviewLocks = new Map()
  function lockReview(key) {
    const now = Date.now()
    const prev = reviewLocks.get(key)
    if (prev && now - prev < 8000) return false
    reviewLocks.set(key, now)
    return true
  }

  // ---------- v1.5: Planning 只读探路缓存（高频文件直读，TTL 60s） ----------
  const probeCache = new Map()
  async function probeFile(base, relPath) {
    const key = `${base}|${relPath}`
    const hit = probeCache.get(key)
    if (hit && Date.now() - hit.ts < 60000) return hit.text
    try {
      const target = await fs.resolve(relPath, { cwd: base })
      if (!fs.contains(base, target)) return null
      const stat = await fs.stat(target).catch(() => null)
      if (!stat || stat.type !== 'file') return null
      if ((stat.size ?? 0) > 20000) return null
      const text = await fs.readText(target).catch(() => null)
      if (text == null) return null
      const clipped = clip(text, 2000)
      probeCache.set(key, { ts: Date.now(), text: clipped })
      return clipped
    } catch {
      return null
    }
  }
  // 从 context_requests 提取 file_read 目标并直读（越界/失败静默，交给主 agent 原样处理）
  async function probeContextRequests(base, contextRequests) {
    const out = []
    const seen = new Set()
    for (const req of Array.isArray(contextRequests) ? contextRequests : []) {
      if (!req || typeof req !== 'object') continue
      const p = req.path || req.file || req.target
      if (typeof p !== 'string' || !p.trim() || seen.has(p)) continue
      seen.add(p)
      const text = await probeFile(base, p.trim())
      if (text != null) out.push(`[探路缓存] ${p.trim()}:\n${text}`)
    }
    return out
  }

  // ---------- v1.5: 一键收口（审核来源汇总） ----------
  function summarizeReviewSources(state) {
    const steps = state.steps || []
    const groups = { external: [], dialog: [], manual: [], mainagent: [] }
    for (const s of steps) {
      const who = s.reviewedBy === 'dialog' ? 'dialog' : s.reviewedBy === 'manual' ? 'manual' : s.reviewedBy === 'mainagent' ? 'mainagent' : 'external'
      groups[who].push(`Step ${s.id} ${s.title}`)
    }
    const lines = [
      '【dsh-web-relay 任务收口】',
      `任务: ${state.exprId}`,
      `完成时间: ${new Date().toISOString()}`,
      '',
      `共 ${steps.length} 步，全部 approved。审核来源汇总：`,
      `- 外部 AI 审核：${groups.external.length ? groups.external.join('、') : '（无）'}`,
      `- 对话模型（无工具）审核：${groups.dialog.length ? groups.dialog.join('、') : '（无）'}`,
      `- 用户手动审核：${groups.manual.length ? groups.manual.join('、') : '（无）'}`,
      `- 主 agent 自动豁免：${groups.mainagent.length ? groups.mainagent.join('、') : '（无）'}`
    ]
    const text = lines.join('\n')
    const handoff = [
      '【主 agent 请协助】dsh-web-relay 任务已全部通过，请完成最终收口',
      '',
      text,
      '',
      '请确认任务记录状态为 done，并将上述结论追加到三方轨迹。'
    ].join('\n')
    return { text, handoff }
  }

  const clip = (s, n) => {
    const t = String(s || '')
    return t.length > n ? t.slice(0, n) + '…' : t
  }

  // ---------- server-side instruction parsing (single authority) ----------
  // Accepts several fenced-code shapes (never trusts a bare ```json block
  // unless its content validates as actions), plus a bare-JSON fallback so a
  // pasted Gemini Action Payload (```json or raw object) is still recognized:
  //   { sender, action: 'execute_batch', payload: { files: [{path, content}] }, needsAgent: true }
  //   -> normalized to write_file + wake_agent actions.
  function extractBlocks(text) {
    const blocks = [] // { raw, trusted: boolean }
    const src = text || ''
    const re = /```([^\n`]*)\n([\s\S]*?)```/g
    let m
    while ((m = re.exec(src)) !== null) {
      const lang = m[1].trim()
      const raw = m[2].trim()
      if (!raw) continue
      const lower = lang.toLowerCase()
      if (lang === 'json:agent-action' || lang.startsWith('json:agent-action ')) {
        blocks.push({ raw, trusted: true })
      } else if (lower === 'json' || lower === 'agent-action' || lower === 'json:steps' || lower === 'steps' || lower === 'json:planning' || lower === 'planning' || lower === 'code snippet' || lower === 'codesnippet') {
        blocks.push({ raw, trusted: false }) // content-validated below
      }
      // other fence languages (plaintext etc.) are ignored to avoid false positives
    }
    // Bare-JSON fallback: a pasted raw object/array (e.g. copied straight from
    // Gemini), possibly with a short text prefix. Slice from the first { or [.
    if (blocks.length === 0) {
      const t = text || ''
      for (let i = 0; i < t.length; i++) {
        if (t[i] !== '[' && t[i] !== '{') continue
        let depth = 0, inStr = false, esc = false
        for (let j = i; j < t.length; j++) {
          const c = t[j]
          if (inStr) {
            if (esc) esc = false
            else if (c === '\\') esc = true
            else if (c === '"') inStr = false
            continue
          }
          if (c === '"') inStr = true
          else if (c === '[' || c === '{') depth++
          else if (c === ']' || c === '}') {
            depth--
            if (depth === 0) {
              const candidate = t.slice(i, j + 1)
              try {
                const parsed = JSON.parse(candidate)
                if (parsed && typeof parsed === 'object' && /wake_agent|planning|context_requests|steps/.test(candidate)) {
                  blocks.push({ raw: candidate, trusted: false })
                }
              } catch (err) { /* not valid JSON */ }
              break
            }
          }
        }
        /* continue scanning all JSON candidates */
      }
    }
    return blocks
  }

  // Normalize a Gemini Action Payload protocol object into our action list.
  function geminiActions(obj) {
    const out = []
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out
    const payload = obj.payload && typeof obj.payload === 'object' ? obj.payload : {}
    const files = Array.isArray(payload.files) ? payload.files : []
    if (files.length > 0) {
      for (const f of files) {
        if (f && typeof f === 'object' && typeof f.path === 'string' && typeof f.content === 'string') {
          out.push({ action: 'write_file', path: f.path, content: f.content })
        }
      }
    }
    if (obj.needsAgent === true || obj.needsAgent === 'true') {
      out.push({
        action: 'wake_agent',
        reason: typeof obj.needsAgentReason === 'string' ? obj.needsAgentReason : '网页 AI 请求唤醒主 agent 接管'
      })
    }
    return out
  }

    // v1.8: 统一并发语义判定——v1.6/v1.7/v1.8 继承 DAG 并发调度；v1.5 线性默认不变。
    const isConcurrent = (v) => v === 'v1.6' || v === 'v1.7' || v === 'v1.8' || v === 'v1.9'

    // v1.9 AutoIteration：从 prompt/answer 文本解析自动迭代声明
    // {"iterations": 3, "finalAcceptance": "<验收标准>", "autoDecision": true}
    // 宽松匹配 JSON 片段；缺省 iterations=1（单轮，向后兼容）。
    function extractAutoIterDecl(text) {
      const src = String(text || '')
      const decl = { iterations: 1, finalAcceptance: null, autoDecision: false }
      const m = src.match(/\{\s*"iterations"\s*:\s*(\d+)\s*(?:,\s*"finalAcceptance"\s*:\s*"([^"]*)"\s*)?(?:,\s*"autoDecision"\s*:\s*(true|false)\s*)?\}/)
      if (m) {
        const n = parseInt(m[1], 10)
        if (Number.isInteger(n) && n >= 1 && n <= 10) decl.iterations = n
        if (m[2]) decl.finalAcceptance = m[2]
        if (m[3]) decl.autoDecision = m[3] === 'true'
      }
      return decl
    }

    // ---------- v1.3 Step List parsing / state ----------
    function normalizeStep(raw, index) {
      const id = raw && raw.id != null ? raw.id : raw && raw.stepId != null ? raw.stepId : (index + 1)
      return {
        id: String(id),
        title: String((raw && (raw.title || raw.name)) || `步骤 ${id}`).trim(),
        detail: String((raw && (raw.detail || raw.description)) || '').trim(),
        review: !raw || raw.review !== false,
        // v1.8: 记录 raw 是否显式声明 review（区分缺省与显式 true/false，review:false 硬开关依赖它）
        reviewSpecified: Boolean(raw && typeof raw.review === 'boolean'),
        acceptance: String((raw && (raw.acceptance || raw.accept)) || '').trim(),
        artifacts: Array.isArray(raw && raw.artifacts) ? raw.artifacts.map(String) : [],
        // v1.6: 拓扑依赖透传（depends_on / dependsOn / parallel_group）
        depends_on: Array.isArray(raw && raw.depends_on)
          ? raw.depends_on.map((d) => String(d))
          : Array.isArray(raw && raw.dependsOn)
            ? raw.dependsOn.map((d) => String(d))
            : [],
        parallel_group: (raw && raw.parallel_group) ? String(raw.parallel_group) : null,
        // v1.7: 多方案比较 / 步骤权重透传（importance 缺省 null = 普通；high/medium/low 显式标注）
        alternatives: Array.isArray(raw && raw.alternatives) ? raw.alternatives : [],
        importance: (raw && raw.importance === 'high' || raw && raw.importance === 'medium' || raw && raw.importance === 'low') ? raw.importance : null,
        status: 'pending',
        notes: []
      }
    }

    function collectStepsFromParsed(parsed) {
      const out = []
      const list = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : [])
      for (const item of list) {
        if (item && typeof item === 'object') {
          if (Array.isArray(item.steps)) out.push(...item.steps)
          if (item.payload && Array.isArray(item.payload.steps)) out.push(...item.payload.steps)
        }
      }
      return out
    }

    function extractSteps(text) {
      const blocks = extractBlocks(text)
      const rawSteps = []
      for (const block of blocks) {
        try {
          const parsed = JSON.parse(block.raw)
          rawSteps.push(...collectStepsFromParsed(parsed))
        } catch (err) { /* not JSON steps */ }
      }
      // Also accept a dedicated ```json:steps / ```steps fenced block.
      const src = text || ''
      const re = /```(?:json:steps|steps)\s*\n([\s\S]*?)```/g
      let m
      while ((m = re.exec(src)) !== null) {
        try {
          const parsed = JSON.parse(m[1].trim())
          if (Array.isArray(parsed)) rawSteps.push(...parsed)
        } catch (err) { /* ignore */ }
      }
      // Fallback: parse a human-readable Step List section.
      if (rawSteps.length === 0) {
        const section = src.match(/(?:^|\n)#{2,3}\s*(?:分步实施清单|Step List|步骤清单)[^\n]*\n([\s\S]*?)(?=\n#{2,3}\s|\n```|$)/i)
        if (section) {
          let current = null
          for (const line of section[1].split('\n')) {
            const mm = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)$/)
            if (mm) {
              current = { title: mm[1].trim(), detail: '', review: true, acceptance: '' }
              rawSteps.push(current)
            } else if (current && line.trim()) {
              current.detail = (current.detail ? current.detail + ' ' : '') + line.trim()
            }
          }
        }
      }
      return rawSteps.map((s, i) => normalizeStep(s, i))
    }

    // v1.4: extract a planning payload (phase/context_requests) from external AI text.
    function extractPlanningPayload(text) {
      const blocks = extractBlocks(text)
      for (const block of blocks) {
        try {
          const parsed = JSON.parse(block.raw)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed.phase || Array.isArray(parsed.context_requests))) {
            return parsed
          }
        } catch (err) { /* ignore */ }
      }
      return null
    }



  /**
   * Parse the pasted text into a validated action list.
   * Returns { actions, needsAgent } where each action is
   * { index, type, summary, risk: 'low'|'medium'|'high', checked, detail, ...internals }.
   * `needsAgent` is null unless a plan action or the action count exceeds the threshold.
   */
  async function parseActions(text, base) {
    const blocks = extractBlocks(text)
    if (blocks.length === 0) return { actions: [], needsAgent: null, steps: [] }

    const baseTarget = await fs.resolve('.', { cwd: base })
    const actions = []
    let planSeen = false
    let writeCount = 0
    let cmdCount = 0

    const pushInvalid = (summary, detail) => {
      actions.push({ index: actions.length, type: 'invalid', summary, risk: 'high', checked: false, detail })
    }

    for (const block of blocks) {
      let parsed
      try { parsed = JSON.parse(block.raw) } catch (err) {
        if (block.trusted) pushInvalid('指令块 JSON 解析失败', String(err && err.message || err))
        continue // untrusted broken JSON: skip silently
      }
      // Normalize: array of actions | Gemini protocol object | single action object
      let list
      if (Array.isArray(parsed)) {
        list = parsed
      } else if (parsed && typeof parsed === 'object') {
        const g = geminiActions(parsed)
        list = g.length > 0 ? g : [parsed]
      } else {
        list = [parsed]
      }
      const before = actions.length
      for (const item of list) {
        if (!item || typeof item !== 'object') {
          pushInvalid('非对象指令项', '指令数组的每一项都必须是对象')
          continue
        }
        const action = String(item.action || item.type || '')

        if (action === 'write_file') {
          const path = typeof item.path === 'string' ? item.path.trim() : ''
          const content = typeof item.content === 'string' ? item.content : ''
          if (!path || !content) {
            pushInvalid('write_file 缺 path 或 content', 'write_file 需要 path 与 content 字段')
            continue
          }
          let target = null
          let inWorkspace = false
          try {
            target = await fs.resolve(path, { cwd: base })
            inWorkspace = fs.contains(baseTarget, target)
          } catch (err) { inWorkspace = false }
          if (!inWorkspace) {
            pushInvalid(`write_file 目标越界: ${path}`, `目标必须解析在 workspace 内（${base}）`)
            continue
          }
          const insideSide = path.split(/[\\/]/)[0] === 'side'
          const risk = insideSide ? 'low' : 'medium'
          writeCount += 1
          actions.push({
            index: actions.length,
            type: 'write_file',
            summary: `写入 ${clip(path, 60)}（${content.length} 字符）`,
            risk,
            checked: true, // low/medium default checked
            detail: `目标: ${target.displayPath || path}\n内容长度: ${content.length}`,
            // internals for execute (server-side re-parse rebuilds these)
            path, content
          })
        } else if (action === 'run_cmd') {
          const command = typeof item.command === 'string' ? item.command.trim() : ''
          if (!command) {
            pushInvalid('run_cmd 缺 command', 'run_cmd 需要 command 字段')
            continue
          }
          const cwdRel = typeof item.cwd === 'string' && item.cwd.trim() ? item.cwd.trim() : '.'
          let cwdAbs = base
          let inWorkspace = false
          try {
            const cwdTarget = await fs.resolve(cwdRel, { cwd: base })
            cwdAbs = fs.processPath(cwdTarget)
            inWorkspace = fs.contains(baseTarget, cwdTarget)
          } catch (err) { inWorkspace = false }
          if (!inWorkspace) {
            pushInvalid(`run_cmd cwd 越界: ${cwdRel}`, `cwd 必须解析在 workspace 内（${base}）`)
            continue
          }
          const timeoutMs = Math.min(Math.max(Number(item.timeout_ms) || RUN_CMD_TIMEOUT_DEFAULT, 1000), RUN_CMD_TIMEOUT_MAX)
          cmdCount += 1
          actions.push({
            index: actions.length,
            type: 'run_cmd',
            summary: `执行 ${clip(command, 60)}`,
            risk: 'high',
            checked: false, // high risk: never default-checked
            detail: `命令: ${command}\ncwd: ${cwdAbs}\ntimeout: ${timeoutMs}ms\n⚠ 高风险：确认后再勾选`,
            // internals for execute
            command, cwd: cwdAbs, timeoutMs
          })
        } else if (action === 'wake_agent') {
          actions.push({
            index: actions.length,
            type: 'wake_agent',
            summary: '唤醒主 Agent',
            risk: 'medium',
            checked: true, // wake-up is an explicit cooperation request, default checked
            detail: (typeof item.reason === 'string' && item.reason ? `原因: ${item.reason}\n` : '') + '将调用 apiProxy 注入唤醒主 agent 接管后续工作',
            reason: typeof item.reason === 'string' ? item.reason : ''
          })
        } else if (action === 'plan') {
          planSeen = true
          actions.push({
            index: actions.length,
            type: 'plan',
            summary: '计划型指令（需主 agent 接管）',
            risk: 'high',
            checked: false,
            detail: typeof item.description === 'string' ? item.description : '该指令需要主 agent 规划与执行'
          })
        } else {
          pushInvalid(`未知 action: ${action || '(空)'}`, '仅支持 write_file / run_cmd / wake_agent / plan；未知类型不执行')
        }
      }
      // Content validation for untrusted blocks (```json, bare JSON): roll back
      // the whole block if it produced nothing but invalid entries, so ordinary
      // JSON snippets in the answer are never mistaken for instructions.
      if (!block.trusted && actions.length > before && actions.slice(before).every((a) => a.type === 'invalid')) {
        actions.length = before
      }
    }

    let needsAgent = null
    if (planSeen) {
      needsAgent = { reason: '包含 plan 类型指令，需主 agent 规划执行', handoffText: null }
    } else if (writeCount > WRITE_FILE_MAX || cmdCount > RUN_CMD_MAX) {
      needsAgent = {
        reason: `指令规模超阈值（write_file=${writeCount}（上限${WRITE_FILE_MAX}）, run_cmd=${cmdCount}（上限${RUN_CMD_MAX}）），建议主 agent 接管`,
        handoffText: null
      }
    }
    return { actions, needsAgent, steps: extractSteps(text) }
  }

  // ---------- record persistence ----------
  async function saveRecord({ base, safePolicy, prompt, answer, channel, actions, results, selectedIndices, status, stamp, steps, intent }) {
    const stampFinal = stamp || new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
    const id = `expr-${stampFinal}`
    const relPath = `${EXPERIMENTS_DIR}/dsh-web-relay-${stampFinal}.md`
    const fileTarget = await fs.resolve(relPath, { cwd: base })
    // v1.0.1: intent 支持传递（general | project），默认 general
    const intentFinal = intent === 'project' ? 'project' : 'general'
      const stepSection = steps && steps.length > 0
        ? ['', '## 分步实施清单', '', JSON.stringify(steps, null, 2), '']
        : []
    const content = [
      '---',
      `id: ${id}`,
      `intent: ${intentFinal}`,
      `channel: ${channel}`,
      `status: ${status}`,
      `created: ${new Date().toISOString()}`,
      '---',
      '',
      '## Prompt',
      '',
      prompt || '(无 prompt)',
      '',
      '## Answer',
      '',
      answer || '(无)',
      '',
      '## 指令解析',
      '',
      JSON.stringify(actions, null, 2),
      '',
      selectedIndices && selectedIndices.length > 0
        ? `## 执行所选（indices: [${selectedIndices.join(', ')}]）`
        : '## 执行所选\n\n（未执行任何指令）',
      '',
      results && results.length > 0
        ? results.map((r) => `- [${r.ok ? 'OK' : 'FAIL'}] #${r.index} ${r.type}: ${r.summary}\n  ${r.detail}`).join('\n')
        : '(无结果)',
        ...stepSection,
      ''
    ].join('\n')
    await fs.writeText(fileTarget, content, undefined, undefined, safePolicy)
    return { id, relPath, fileTarget }
  }

    // ---------- v1.3: Step List state ----------
    async function stepStateTarget(base, exprId) {
      return fs.resolve(`${EXPERIMENTS_DIR}/${exprId}.steps.json`, { cwd: base })
    }

    async function readStepState(base, exprId) {
      try {
        const target = await stepStateTarget(base, exprId)
        const text = await fs.readText(target)
        const data = JSON.parse(text)
        if (data && Array.isArray(data.steps)) return { exprId, currentStep: data.currentStep || null, status: data.status || 'open', phase: data.phase || (data.steps.length ? 'executing' : 'planning'), architectNotes: data.architectNotes || null, contextRequests: Array.isArray(data.contextRequests) ? data.contextRequests : [], steps: data.steps, updatedAt: data.updatedAt, autoReview: data.autoReview === true, stopReason: data.stopReason || null, stoppedAt: data.stoppedAt || null, finalized: data.finalized === true, finalizedAt: data.finalizedAt || null, finalSummary: data.finalSummary || null, protocolVersion: data.protocolVersion || 'v1.5', activeSteps: Array.isArray(data.activeSteps) ? data.activeSteps : [], iterations: data.iterations || 1, currentIteration: data.currentIteration || 1, finalAcceptance: data.finalAcceptance || null, autoDecision: data.autoDecision === true, rejectStreak: data.rejectStreak || 0 }
      } catch (err) { /* no state yet */ }
      return { exprId, steps: [], currentStep: null, status: 'open', phase: 'planning', architectNotes: null, contextRequests: [], autoReview: false, stopReason: null, stoppedAt: null, finalized: false, finalizedAt: null, finalSummary: null, protocolVersion: 'v1.5', activeSteps: [], iterations: 1, currentIteration: 1, finalAcceptance: null, autoDecision: false, rejectStreak: 0 }
    }

    async function writeStepState(base, exprId, state, safePolicy) {
      const target = await stepStateTarget(base, exprId)
      const payload = {
        exprId,
        currentStep: state.currentStep || null,
        activeSteps: Array.isArray(state.activeSteps) ? state.activeSteps : [],
        status: state.status || 'open',
        phase: state.phase || (state.steps && state.steps.length ? 'executing' : 'planning'),
          architectNotes: state.architectNotes || null,
          contextRequests: Array.isArray(state.contextRequests) ? state.contextRequests : [],
          autoReview: state.autoReview === true,
          stopReason: state.stopReason || null,
          stoppedAt: state.stoppedAt || null,
          finalized: state.finalized === true,
          finalizedAt: state.finalizedAt || null,
          finalSummary: state.finalSummary || null,
          steps: state.steps || [],
          protocolVersion: state.protocolVersion || 'v1.5',
          // v1.9 AutoIteration：迭代字段必须随写盘持久化（否则版间门/熔断读不到声明）
          iterations: state.iterations || 1,
          currentIteration: state.currentIteration || 1,
          finalAcceptance: state.finalAcceptance || null,
          autoDecision: state.autoDecision === true,
          rejectStreak: state.rejectStreak || 0,
        updatedAt: new Date().toISOString()
      }
      await fs.writeText(target, JSON.stringify(payload, null, 2), undefined, undefined, safePolicy)
      return payload
    }

    // ---------- v1.6: 依赖门控与就绪计算 ----------
    function depsSatisfied(step, state) {
      const deps = step && Array.isArray(step.depends_on) ? step.depends_on : []
      if (deps.length === 0) return true
      return deps.every((d) => {
        const s = (state.steps || []).find((x) => String(x.id) === String(d))
        return s && s.status === 'approved'
      })
    }
    function readySteps(state) {
      return (state.steps || []).filter((s) => s.status === 'pending' && depsSatisfied(s, state))
    }
    function blockedWaitingFor(step, state) {
      const deps = step && Array.isArray(step.depends_on) ? step.depends_on : []
      return deps.filter((d) => {
        const s = (state.steps || []).find((x) => String(x.id) === String(d))
        return !s || s.status !== 'approved'
      })
    }


  // ---------- v0.5: three-party trace (web-relay/traces) ----------
  // One trace file per experiment (same stamp/id as the record): a markdown
  // log of role-labelled entries [用户] / [主 agent] / [外部AI] appended over
  // time. The main agent appends its closure via POST /dsh-web-relay/trace.
  const TRACE_ENTRY_RE = /^## \[(用户|主 agent|外部AI)\] (.+)$/

  function traceEntriesFrom(text) {
    const entries = []
    const lines = String(text || '').split('\n')
    let cur = null
    for (const line of lines) {
      const m = line.match(TRACE_ENTRY_RE)
      if (m) {
        if (cur) entries.push(cur)
        cur = { role: LABEL_ROLE[m[1]] || m[1], at: m[2], text: [] }
      } else if (cur) {
        cur.text.push(line)
      }
    }
    if (cur) entries.push(cur)
    return entries.map((e) => ({ role: e.role, at: e.at, text: e.text.join('\n').trim() }))
  }

  async function loadTrace(base, exprId) {
    const target = await fs.resolve(`${TRACES_DIR}/${exprId}.md`, { cwd: base })
    try {
      const text = await fs.readText(target)
      // v1.0.1: 解析 frontmatter 的 created（保留初始创建时间）
      let created = null
      const fmMatch = text.match(/^---\n([\s\S]*?)\n---/)
      if (fmMatch) {
        for (const line of fmMatch[1].split('\n')) {
          const kv = line.match(/^created:\s*(.+)$/)
          if (kv) created = kv[1].trim()
        }
      }
      const body = text.replace(/^---[\s\S]*?---\n/, '')
      return { target, entries: traceEntriesFrom(body), created }
    } catch (err) {
      return { target, entries: [], created: null }
    }
  }

  const traceEntry = (role, text) => ({ role, at: new Date().toISOString(), text: String(text || '') })

  async function appendTrace({ base, safePolicy, exprId, entries }) {
    const { target, entries: existing, created } = await loadTrace(base, exprId)
    // v1.0.1: 幂等去重——相同 role + text 的条目不重复追加（重复 POST 安全）
    const seen = new Set(existing.map((e) => `${e.role}\u0000${e.text}`))
    const fresh = (entries || []).filter((e) => !seen.has(`${e.role}\u0000${e.text}`))
    const merged = existing.concat(fresh)
    const content = [
      '---',
      `id: ${exprId}`,
      'kind: trace',
      'status: open',
      `created: ${created || new Date().toISOString()}`,   // v1.0.1: 保留初始创建时间，仅首次写入 now
      '---',
      '',
      ...merged.map((e) => [`## [${ROLE_LABEL[e.role] || e.role}] ${e.at}`, '', e.text || '(空)', ''].join('\n'))
    ].join('\n')
    await fs.writeText(target, content, undefined, undefined, safePolicy)
    return { target }
  }

  async function wakeMainAgent({ sessionId, handoffText }) {
    if (!apiProxy || !sessionId || !handoffText) return { agentWoken: false, reason: 'apiProxy 或 sessionId 不可用' }
    try {
      const resp = await apiProxy.sessions.prompt({
        rpcId: randomUUID(),
        payload: {
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: handoffText }]
        }
      })
      const accepted = !!(resp && resp.result && resp.result.ok === true)
      return accepted
        ? { agentWoken: true, reason: null }
        : { agentWoken: false, reason: resp?.result?.error ? `${resp.result.error.code}: ${resp.result.error.message}` : 'unknown error' }
    } catch (err) {
      return { agentWoken: false, reason: String(err && err.message || err) }
    }
  }

  // ---------- v1.6: 双版本协议 payload（context / protocol 端点共用） ----------
  // 顶层 protocol / skill 保持 v1.5（向前兼容）；protocolV15 / protocolV16 各自携带
  // { version, text, skill }，其中 text 为完整协议（v1.5 线性 + v1.6 并发条目）。
  const protocolV15 = {
    version: WEB_RELAY_PROTOCOL_VERSION,
    text: WEB_RELAY_PROTOCOL,
    skill: { name: 'web_relay_external_ai_protocol', version: WEB_RELAY_PROTOCOL_VERSION, text: WEB_RELAY_EXTERNAL_AI_SKILL }
  }
  const protocolV16 = {
    version: WEB_RELAY_PROTOCOL_VERSION_V16,
    text: WEB_RELAY_PROTOCOL,
    skill: { name: 'web_relay_external_ai_protocol', version: WEB_RELAY_PROTOCOL_VERSION_V16, text: WEB_RELAY_EXTERNAL_AI_SKILL }
  }
  // v1.7: 三版本协议 payload（context / protocol 端点共用），text 为完整协议（含 v1.7 条目）。
  const protocolV17 = {
    version: WEB_RELAY_PROTOCOL_VERSION_V17,
    text: WEB_RELAY_PROTOCOL,
    skill: { name: 'web_relay_external_ai_protocol', version: WEB_RELAY_PROTOCOL_VERSION_V17, text: WEB_RELAY_EXTERNAL_AI_SKILL }
  }
  // v1.8: 四版本协议 payload（context / protocol 端点共用），text 为完整协议（含 v1.8 条目）。
  const protocolV18 = {
    version: WEB_RELAY_PROTOCOL_VERSION_V18,
    text: WEB_RELAY_PROTOCOL,
    skill: { name: 'web_relay_external_ai_protocol', version: WEB_RELAY_PROTOCOL_VERSION_V18, text: WEB_RELAY_EXTERNAL_AI_SKILL }
  }
  // v1.9: 五版本协议 payload（含 AutoIteration / 全角色降级链条目）。
  const protocolV19 = {
    version: WEB_RELAY_PROTOCOL_VERSION_V19,
    text: WEB_RELAY_PROTOCOL,
    skill: { name: 'web_relay_external_ai_protocol', version: WEB_RELAY_PROTOCOL_VERSION_V19, text: WEB_RELAY_EXTERNAL_AI_SKILL }
  }

  // ---------- routes ----------
  const statusHandler = (req, res) => {
    if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
    const mem = process.memoryUsage()
    json(res, 200, {
      ok: true,
      geminiConfigured: Boolean(GEMINI_KEY),
      model: GEMINI_MODEL,
      version: PLUGIN_VERSION,   // v2.4-1: 实时版本（原硬编码 1.3.0）
      shellAvailable: Boolean(shell),
      apiProxyAvailable: Boolean(apiProxy),
      uptime: Math.round(process.uptime()),
      memoryUsage: Math.round(mem.rss / 1024 / 1024) // MB
    })
  }

  // v2.4-1: 三端 Health Checker——探测 bridge(8899) 连通性 + 插件版本；
  // Gemini 页面/扩展状态由面板客户端探测（后端无法直接访问浏览器上下文）。
  const healthCheckHandler = async (req, res) => {
    if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
    let bridge = { ok: false, error: '未探测' }
    try {
      const ctrl = AbortSignal.timeout(2500)
      const r = await fetch(`${BRIDGE_BASE}/stats`, { signal: ctrl })
      const d = await r.json().catch(() => null)
      bridge = d && d.ok !== false
        ? { ok: true, total: d.total, byStatus: d.byStatus || {} }
        : { ok: false, error: 'bridge 响应异常' }
    } catch (e) {
      bridge = { ok: false, error: String((e && e.message) || e).slice(0, 120) }
    }
    json(res, 200, {
      ok: true,
      version: PLUGIN_VERSION,
      bridge,
      // Gemini 页面 / 扩展心跳由前端侧探测（见面板 Health Status 状态灯）
      geminiPage: { ok: null, note: '由面板客户端探测' },
      extension: { ok: null, note: '由面板客户端探测' }
    })
  }

  const askHandler = async (req, res) => {
    if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
    let body = ''
    try { body = await readBody(req) } catch { return json(res, 400, { ok: false, error: 'bad body' }) }
    let payload
    try { payload = JSON.parse(body || '{}') } catch { return json(res, 400, { ok: false, error: 'invalid JSON' }) }

    const provider = payload.provider
    const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : ''
    const pasted = typeof payload.answer === 'string' ? payload.answer.trim() : ''
    const workspacePath = typeof payload.workspacePath === 'string' ? payload.workspacePath : null
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : ''
      const protocolVersion = isConcurrent(payload.protocolVersion) ? payload.protocolVersion : 'v1.5'

    if (!provider) return json(res, 400, { ok: false, error: 'missing provider' })

    let providerLabel = provider
    let askChannel = provider === 'gemini-free' ? 'gemini-free' : 'manual'   // v1.9：dialog 降级时标记 dialog-fallback
    let answer = ''

    try {
      if (provider === 'gemini-free') {
        providerLabel = 'Gemini Free API'
        if (!prompt) return json(res, 400, { ok: false, error: '缺少 prompt' })
        const guidedPrompt = [
          prompt,
          '',
          '【dsh-web-relay 协作要求】',
          '如果这是一个复杂任务，请在回答中同时输出 json:agent-action 代码块（含 wake_agent 或 plan）和机器可读 steps 数组。',
          '如果是简单问题，直接回答即可。',
          '',
          WEB_RELAY_PROTOCOL,
          '',
          WEB_RELAY_EXTERNAL_AI_SKILL
        ].join('\n')
        // v1.9 全角色降级链（external → web-gemini → dialog → pause）：
        // Gemini API 失败（429/配额）→ 网页版通道（免配额）→ 内部对话模型 → 报错由用户介入。
        let r = { ok: false, error: 'GEMINI_API_KEY 未配置' }
        let degraded = false
        if (GEMINI_KEY) {
          r = await callGemini(guidedPrompt)
          if (!r.ok) {
            // v1.9 web-gemini：Gemini API 429/失败 → 网页版通道（第一降级节点）
            const w = await webGeminiAsk(guidedPrompt)
            if (w.ok) { r = w; degraded = true; providerLabel = 'Gemini 网页版（web-gemini 降级）' }
            else {
              const d = await callDialogModel(guidedPrompt)
              if (d.ok) { r = d; degraded = true; providerLabel = '对话模型（降级）' }
              else r = { ok: false, error: `Gemini 调用失败（${r.error}）；web-gemini（${w.error}）；对话模型降级亦失败（${d.error}）` }
            }
          }
        } else {
          const w = await webGeminiAsk(guidedPrompt)
          if (w.ok) { r = w; degraded = true; providerLabel = 'Gemini 网页版（web-gemini 降级）' }
          else {
            const d = await callDialogModel(guidedPrompt)
            if (d.ok) { r = d; degraded = true; providerLabel = '对话模型（降级）' }
          }
        }
        if (!r.ok) return json(res, 502, r)
        answer = r.text
        askChannel = degraded ? (providerLabel.startsWith('Gemini 网页版') ? 'web-gemini' : 'dialog-fallback') : 'gemini-free'
      } else if (provider === 'web-gemini') {
        // v1.9: 直接选择 Gemini 网页版通道（Chrome 扩展桥接，免配额）；失败降级 dialog → manual
        providerLabel = 'Gemini 网页版（web-gemini）'
        if (!prompt) return json(res, 400, { ok: false, error: '缺少 prompt' })
        const guidedPrompt = [
          prompt,
          '',
          '【dsh-web-relay 协作要求】',
          '如果这是一个复杂任务，请在回答中同时输出 json:agent-action 代码块（含 wake_agent 或 plan）和机器可读 steps 数组。',
          '如果是简单问题，直接回答即可。',
          '',
          WEB_RELAY_PROTOCOL,
          '',
          WEB_RELAY_EXTERNAL_AI_SKILL
        ].join('\n')
        let r = await webGeminiAsk(guidedPrompt)
        let degraded = false
        if (!r.ok) {
          const d = await callDialogModel(guidedPrompt)
          if (d.ok) { r = d; degraded = true; providerLabel = '对话模型（降级）' }
          else r = { ok: false, error: `web-gemini（${r.error}）；对话模型降级亦失败（${d.error}）` }
        }
        if (!r.ok) return json(res, 502, r)
        answer = r.text
        askChannel = degraded ? 'dialog-fallback' : 'web-gemini'
      } else if (provider === 'claude') {
        // v1.9: Claude API 通道——复用 harness llm 服务的 anthropic provider（llm-pi-ai 路由），
        // 需 ANTHROPIC_API_KEY + cordis.patch.yml 配置 providers.anthropic；失败降级 dialog → manual。
        providerLabel = 'Claude API'
        if (!prompt) return json(res, 400, { ok: false, error: '缺少 prompt' })
        const guidedPrompt = [
          prompt,
          '',
          '【dsh-web-relay 协作要求】',
          '如果这是一个复杂任务，请在回答中同时输出 json:agent-action 代码块（含 wake_agent 或 plan）和机器可读 steps 数组。',
          '如果是简单问题，直接回答即可。',
          '',
          WEB_RELAY_PROTOCOL,
          '',
          WEB_RELAY_EXTERNAL_AI_SKILL
        ].join('\n')
        let r = { ok: false, error: 'llm 服务不可用' }
        let degraded = false
        if (llm) {
          try {
            const chunks = []
            const stream = llm.stream({
              provider: 'anthropic',
              model: CLAUDE_DEFAULT_MODEL,
              messages: [{ role: 'user', content: [{ type: 'text', text: guidedPrompt }] }],
              tools: [],
              stream: false,
              signal: AbortSignal.timeout(120000)
            })
            for await (const chunk of stream) {
              if (chunk && chunk.type === 'error') r = { ok: false, error: String(chunk.error || 'llm error') }
              const text = extractChunkText(chunk)
              if (text) chunks.push(text)
            }
            const text = chunks.join('').trim()
            if (text) r = { ok: true, text }
            else r = { ok: false, error: 'Claude 返回空' }
          } catch (e) {
            r = { ok: false, error: String((e && e.message) || e) }
          }
          if (!r.ok) {
            // 降级链：Claude 失败 → 内部对话模型 → 报错（pause）
            const d = await callDialogModel(guidedPrompt)
            if (d.ok) { r = d; degraded = true }
            else r = { ok: false, error: `Claude 调用失败（${r.error}）；对话模型降级亦失败（${d.error}）` }
          }
        }
        if (!r.ok) return json(res, 502, r)
        answer = r.text
        if (degraded) providerLabel = '对话模型（降级）'
        askChannel = degraded ? 'dialog-fallback' : 'claude'
      } else if (provider === 'manual') {
        providerLabel = '手动粘贴'
        if (!pasted) return json(res, 400, { ok: false, error: 'manual 模式需要粘贴回答' })
        answer = pasted
      } else {
        return json(res, 400, { ok: false, error: `未知 provider: ${provider}` })
      }

      const base = baseOf(workspacePath)
      const safePolicy = safePolicyFor(base)
      const { id, relPath, fileTarget } = await saveRecord({
        base, safePolicy, prompt, answer, channel: askChannel,
        actions: [], results: [], selectedIndices: [], status: 'pending', intent: payload && payload.intent
      })
      // v0.5: seed the three-party trace (用户 prompt → 外部AI answer).
      await appendTrace({ base, safePolicy, exprId: id, entries: [
        traceEntry('user', prompt || '(无 prompt)'),
        traceEntry('external', answer || '(无)')
        ] }).catch(() => {}) // trace is best-effort; the record save is authoritative

        // If the Gemini/manual answer contains agent-action instructions, allow the
        // free-API/manual save flow to wake the main agent too.
        let agentWoken = false
        let wakeReason = null
        let handoffText = null
        let parsedActions = []
        let parsedSteps = []
        let parsedNeedsAgent = null
          let planning = null
        try {
          const parsed = await parseActions(answer, base)
          parsedActions = parsed.actions || []
          parsedSteps = parsed.steps || []
            planning = extractPlanningPayload(answer)
          parsedNeedsAgent = parsed.needsAgent || null
        } catch (err) { /* answer may not be an instruction payload */ }

        // Persist Step List state for Free API / manual flows too.
          const phase = planning && (planning.phase === 'planning' || Array.isArray(planning.context_requests))
            ? 'planning'
            : (parsedSteps.length > 0 ? 'executing' : null)
        // v1.5.2: auxiliary 评审 ask（如 AutoIteration 版间门唤醒的评审请求）不创建 stepState——
        // 评审 Step List 仅供主 agent restructure 参考，不是要执行的状态机；
        // 避免其 created 较新而被 context"最新任务"自动载入（曾导致面板显示评审参考步骤而非主任务）。
        if (!(payload.auxiliary === true) && (phase || parsedSteps.length > 0)) {
          try {
            // v1.4.0: AutoIteration 声明持久化（原缺陷：askHandler 写 stepState 未含迭代字段，
            // 导致 prompt 中 {"iterations":N,...} 声明丢失、版间门无法推进；现与 executeHandler 对齐）
            const ai = extractAutoIterDecl(`${prompt}\n${answer}`)
            await writeStepState(base, id, {
              exprId: id,
              currentStep: null,
              status: 'open',
                phase,
                architectNotes: (planning && (planning.architect_notes || planning.architectNotes)) || null,
                contextRequests: (planning && Array.isArray(planning.context_requests)) ? planning.context_requests : [],
              autoReview: provider === 'gemini-free',
              protocolVersion,
              iterations: ai.iterations,
              currentIteration: 1,
              finalAcceptance: ai.finalAcceptance,
              autoDecision: ai.autoDecision,
              rejectStreak: 0,
              steps: parsedSteps
            }, safePolicy)
          } catch (err) { /* step state is auxiliary */ }
        }

        const shouldWake = parsedNeedsAgent || parsedSteps.length > 0 || (planning && Array.isArray(planning.context_requests) && planning.context_requests.length > 0) || parsedActions.some((a) => a.type === 'wake_agent' || a.type === 'plan')
        if (shouldWake) {
          const probeHits = await probeContextRequests(base, planning && planning.context_requests)
          handoffText = [
            `【主 agent 请协助】dsh-web-relay 收到需要主 agent 接管的内容`,
            '',
            `workspacePath: ${base}`,
            `试验记录: web-relay/experiments/dsh-web-relay-${id.slice(5)}.md（id: ${id}）`,
            `三方轨迹: web-relay/traces/${id}.md`,
            '',
            `请读取该试验记录并整合收口。`,
            '',
            parsedSteps && parsedSteps.length > 0 ? `【Step List】\n${JSON.stringify(parsedSteps, null, 2)}` : '',
              isConcurrent(protocolVersion) && parsedSteps.length > 0 ? `【协议版本】v1.6 并发调度：按步骤 depends_on / parallel_group 依赖门控执行；依赖满足的多个步骤可并行（建议 subagent 并发），每步完成后独立置为 review 等待审核。` : '',
              planning && Array.isArray(planning.context_requests) && planning.context_requests.length > 0
                ? `【只读探路请求】\n${JSON.stringify(planning.context_requests, null, 2)}\n\n请仅执行 file_read / search 等只读操作，并将结果写入三方轨迹供外部 AI 继续评估。`
                : '',
              probeHits.length > 0
                ? `【探路缓存（v1.5，插件直读，可直接引用）】\n${probeHits.join('\n\n')}`
                : ''
          ].join('\n')
          if (sessionId) {
            const wake = await wakeMainAgent({ sessionId, handoffText })
            agentWoken = wake.agentWoken
            wakeReason = wake.reason
          }
          await appendTrace({ base, safePolicy, exprId: id, entries: [traceEntry('mainagent', handoffText)] }).catch(() => {})
        }

        json(res, 200, {
          ok: true,
          answer,
          savedPath: fileTarget?.displayPath || relPath,
          id,
          agentWoken,
          wakeReason,
          handoffText,
          actions: parsedActions,
          needsAgent: parsedNeedsAgent,
          steps: parsedSteps
            ,
            planning
        })

      /* stray closing removed */
    } catch (err) {
      json(res, 500, { ok: false, error: String(err?.message || err) })
    }
  }

  // ---------- v0.5: record + trace listing (shared by context / traces routes) ----------
  async function listRecordSummaries(base) {
    const records = []
    const seen = new Set()
    // web-relay/experiments first, then legacy side/experiments (read-only compat).
    for (const rel of [EXPERIMENTS_DIR, LEGACY_EXPERIMENTS_DIR]) {
      let entries = []
      try {
        const dir = await fs.resolve(rel, { cwd: base })
        entries = await fs.listDir(dir)
      } catch (err) { /* dir not created yet */ }
      const files = entries
        .filter((e) => e.type === 'file' && e.name.endsWith('.md'))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      for (const f of files) {
        if (seen.has(f.name)) continue
        seen.add(f.name)
        try {
          const text = await fs.readText(f.target)
          const meta = {}
          const fm = text.match(/^---\n([\s\S]*?)\n---/)
          if (fm) {
            for (const line of fm[1].split('\n')) {
              const m = line.match(/^([a-zA-Z]+):\s*(.*)$/)
              if (m) meta[m[1]] = m[2]
            }
          }
          const body = fm ? text.slice(fm[0].length).trim() : text
          records.push({
            file: f.name,
            id: meta.id || f.name,
            intent: meta.intent || 'general',
            channel: meta.channel || 'unknown',
            status: meta.status || 'pending',
            created: meta.created || '',
            snippet: body.split('\n').filter((l) => l.trim()).slice(0, 3).join(' ').slice(0, 140)
          })
        } catch (err) { /* skip unreadable */ }
      }
    }
    // v1.5.1: 按创建时间降序（最新任务在前），替代按文件名排序——
    // 文件名前缀（dsh-web-relay-* / expr-* / validation.md 等）会打乱时间序，
    // 导致 context 端点"最新任务"误判（本次任务被旧记录/评审 ask 记录挤到后面）。
    return records.sort((a, b) => {
      const ta = a.created || ''
      const tb = b.created || ''
      return ta < tb ? 1 : ta > tb ? -1 : 0
    })
  }

  async function listTraces(base) {
    const traces = []
    let entries = []
    try {
      const dir = await fs.resolve(TRACES_DIR, { cwd: base })
      entries = await fs.listDir(dir)
    } catch (err) { /* dir not created yet */ }
    const files = entries
      .filter((e) => e.type === 'file' && e.name.endsWith('.md'))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .slice(-20)
    for (const f of files) {
      try {
        const text = await fs.readText(f.target)
        const meta = {}
        const fm = text.match(/^---\n([\s\S]*?)\n---/)
        if (fm) {
          for (const line of fm[1].split('\n')) {
            const m = line.match(/^([a-zA-Z]+):\s*(.*)$/)
            if (m) meta[m[1]] = m[2]
          }
        }
        const body = fm ? text.slice(fm[0].length) : text
        traces.push({
          file: f.name,
          id: meta.id || f.name.replace(/\.md$/, ''),
          created: meta.created || '',
          entries: traceEntriesFrom(body)
        })
      } catch (err) { /* skip unreadable */ }
    }
    return traces
  }

  // GET /dsh-web-relay/context?cwd=...  → { ok, protocol, records, traces }
  // Step 1 (protocol hardening): the three-party protocol is a TOP-LEVEL field,
  // never mixed into records/traces, so any consumer (frontend, external AI,
  // scripts) reads it by name — the external AI always sees the contract even
  // when it calls this endpoint directly instead of /protocol.
  const contextHandler = async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
      const url = new URL(req.url || '/', 'http://localhost')
      const cwd = url.searchParams.get('cwd') || ''
      const base = cwd || sandboxPolicy?.workspaceRoot || process.cwd()
      // v1.5.1: 前 3 条截断会漏掉最新任务（本次 3 版迭代任务即因此从面板 Step List 消失）；
      // 放宽到 20 条，前端用实验选择下拉精确切换任意任务。
      const records = (await listRecordSummaries(base)).slice(0, 20)
      // v0.5: the packaged context carries the web-relay three-party traces
      // instead of the side-window conversation (fully decoupled).
      const traces = await listTraces(base)
        const stepStates = []
        for (const r of records) {
          try {
            const st = await readStepState(base, r.id)
            if (st && Array.isArray(st.steps) && st.steps.length > 0) stepStates.push(st)
          } catch (err) { /* skip */ }
        }
      json(res, 200, {
        ok: true,
        protocol: { version: WEB_RELAY_PROTOCOL_VERSION, text: WEB_RELAY_PROTOCOL },
        skill: { name: 'web_relay_external_ai_protocol', version: WEB_RELAY_PROTOCOL_VERSION, text: WEB_RELAY_EXTERNAL_AI_SKILL },
        protocolV15,
        protocolV16,
        protocolV17,
        protocolV18,
        protocolV19,
        en: {
          protocol: { version: WEB_RELAY_PROTOCOL_VERSION, text: WEB_RELAY_PROTOCOL_EN },
          skill: { name: 'web_relay_external_ai_protocol', version: WEB_RELAY_PROTOCOL_VERSION, text: WEB_RELAY_EXTERNAL_AI_SKILL_EN },
          protocolV15: { version: WEB_RELAY_PROTOCOL_VERSION, text: WEB_RELAY_PROTOCOL_EN },
          protocolV16: { version: WEB_RELAY_PROTOCOL_VERSION_V16, text: WEB_RELAY_PROTOCOL_EN },
          protocolV17: { version: WEB_RELAY_PROTOCOL_VERSION_V17, text: WEB_RELAY_PROTOCOL_EN },
          protocolV18: { version: WEB_RELAY_PROTOCOL_VERSION_V18, text: WEB_RELAY_PROTOCOL_EN },
          protocolV19: { version: WEB_RELAY_PROTOCOL_VERSION_V19, text: WEB_RELAY_PROTOCOL_EN }
        },
        records,
        traces
          ,
          stepStates,
      })
    } catch (err) {
      json(res, 500, { ok: false, error: String(err?.message || err) })
    }
  }

  // POST /dsh-web-relay/parse  body { text, workspacePath? } → { ok, actions, needsAgent }
  const parseHandler = async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
      const payload = JSON.parse((await readBody(req)) || '{}')
      const text = typeof payload.text === 'string' ? payload.text : ''
      const base = baseOf(payload.workspacePath)
        const steps = extractSteps(text)
      const { actions, needsAgent } = await parseActions(text, base)
      // v1.6: 透传协议版本（parse 为预览端点不落盘，由后续 execute / steps 创建时写入 state）
      const protocolVersion = isConcurrent(payload.protocolVersion) ? payload.protocolVersion : 'v1.5'
      json(res, 200, { ok: true, actions, needsAgent, steps, protocolVersion })
    } catch (err) {
      json(res, 500, { ok: false, error: String(err?.message || err) })
    }
  }

  // POST /dsh-web-relay/execute  body { text, indices, workspacePath?, prompt?, sessionId? }
  // Server-side authority: re-parses text, executes only the selected indices, writes ONE record.
  const executeHandler = async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
      const payload = JSON.parse((await readBody(req)) || '{}')
      const text = typeof payload.text === 'string' ? payload.text : ''
      const workspacePath = typeof payload.workspacePath === 'string' ? payload.workspacePath : ''
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
      const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : ''
      const protocolVersion = isConcurrent(payload.protocolVersion) ? payload.protocolVersion : 'v1.5'
      const rawIndices = Array.isArray(payload.indices)
        ? payload.indices.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0)
        : []

      // Precompute the record stamp once so wake/handoff messages can reference
      // the exact record path before it is written (Step 3 cross-workspace bridge).
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)

      const base = baseOf(workspacePath)
      const safePolicy = safePolicyFor(base)

      // NEVER trust client-provided actions: re-parse here.
      const { actions, needsAgent } = await parseActions(text, base)
        const steps = extractSteps(text)
      const byIndex = new Map(actions.map((a) => [a.index, a]))
      const selected = rawIndices.map((i) => byIndex.get(i)).filter(Boolean)

      const results = []
      const mainAgentTrace = [] // v0.5: 主 agent 唤醒/交接消息，随三方轨迹落盘
      for (const action of selected) {
        if (action.type === 'write_file') {
          try {
            const target = await fs.resolve(action.path, { cwd: base })
            await fs.writeText(target, action.content, undefined, undefined, safePolicy)
            results.push({ index: action.index, type: 'write_file', ok: true, summary: `已写入 ${action.path}`, detail: `${action.content.length} 字符` })
          } catch (err) {
            results.push({ index: action.index, type: 'write_file', ok: false, summary: `写入失败: ${action.path}`, detail: String(err && err.message || err) })
          }
        } else if (action.type === 'run_cmd') {
          if (!shell) {
            results.push({ index: action.index, type: 'run_cmd', ok: false, summary: 'shell 服务不可用', detail: 'host 未提供 ctx.shell，无法执行命令' })
            continue
          }
          try {
            const spec = shell.resolve({
              command: action.command,
              workdir: action.cwd,
              timeoutMs: action.timeoutMs,
              stdoutMaxBytes: OUTPUT_CAPTURE,
              sandboxPolicy: safePolicy
            })
            // shell.run never rejects business outcomes: check the result fields.
            const r = await shell.run(spec)
            const ok = r.exitCode === 0 && !r.timedOut && !r.aborted
            const out = clip((r.stdout && r.stdout.text) || '', DISPLAY_LIMIT)
            const errOut = clip((r.stderr && r.stderr.text) || '', DISPLAY_LIMIT)
            const cause = r.timedOut ? ' (timedOut)' : r.aborted ? ' (aborted)' : ''
            results.push({
              index: action.index, type: 'run_cmd', ok,
              summary: ok ? `命令完成 (exit ${r.exitCode})` : `命令未成功 (exit ${r.exitCode}${cause})`,
              detail: `命令: ${action.command}\n--- stdout ---\n${out || '(空)'}\n--- stderr ---\n${errOut || '(空)'}`
            })
          } catch (err) {
            results.push({ index: action.index, type: 'run_cmd', ok: false, summary: '命令执行异常', detail: String(err && err.message || err) })
          }
        } else if (action.type === 'wake_agent') {
          // Explicit wake-up request (e.g. Gemini Action Payload needsAgent: true):
          // inject a user-role message into the main agent session via apiProxy.
          // Step 3 (cross-workspace context bridge): carry the effective
          // workspace + record path so the main agent works against the injected
          // path instead of guessing from its own default cwd.
          const wsFallback = !(workspacePath && String(workspacePath).trim())
          const wakeText = [
            `【主 agent 请协助】dsh-web-relay 试验记录（即将落盘）`,
            '',
            '【跨工作区上下文桥接】',
            `workspacePath: ${base}${wsFallback ? '（fallback 值：client 未传 workspacePath，Host 使用部署根）' : ''}`,
            `试验记录: web-relay/experiments/dsh-web-relay-${stamp}.md（id: expr-${stamp}）`,
            `三方轨迹: web-relay/traces/expr-${stamp}.md（收口结论请追加到该轨迹）`,
            `摘要: actions ${actions.length} 条（${actions.map((a) => a.type).join('/') || '(空)'}）；本次执行 ${selected.length} 条`,
            '',
            '优先按注入的 workspacePath 处理该试验（读取记录、执行指令、回写结论都基于该路径），而非当前默认 cwd。',
            '',
            action.reason || '网页 AI 请求唤醒主 agent 接管',
            '',
            `请读取该试验记录并整合收口。`,
            '',
            '收口方式：把最终结论通过 POST /dsh-web-relay/trace 追加到三方轨迹（body {"workspacePath": "<项目路径>", "exprId": "' + `expr-${stamp}` + '", "role": "mainagent", "text": "<你的发言>"}）。'
              ,
              '',
              '【Step List（v1.3 逐步执行）】',
              steps && steps.length > 0 ? JSON.stringify(steps, null, 2) : '（外部 AI 未提供结构化 steps）',
              '',
              isConcurrent(protocolVersion) ? '【v1.6 并发调度】本任务为并发模式：按步骤 depends_on / parallel_group 依赖门控执行，依赖满足的多个步骤可并行（建议 subagent 并发），每步完成后独立置为 review 等待审核。' : '',
              '请按 Step List 逐步执行：每步完成后通过 POST /dsh-web-relay/steps/update 标记状态并等待外部 AI 审核；审核通过后再执行下一步。'
          ].join('\n')
          mainAgentTrace.push(traceEntry('mainagent', wakeText))
          const wake = await wakeMainAgent({ sessionId, handoffText: wakeText })
          results.push({
            index: action.index, type: 'wake_agent', ok: wake.agentWoken,
            summary: wake.agentWoken ? '已唤醒主 Agent' : '唤醒失败',
            detail: wake.agentWoken ? 'apiProxy 注入成功' : (wake.reason || '注入不可达（缺少 sessionId 或 apiProxy）')
          })
        } else {
          results.push({ index: action.index, type: action.type, ok: false, summary: '未执行', detail: 'invalid/plan 指令不在勾选执行范围' })
        }
      }

      const executed = selected.length > 0
      const allOk = executed && results.length > 0 && results.every((r) => r.ok)
      // status rules (contract-pinned): only-execute + no needsAgent → done; anything else → pending
      const status = executed && allOk && !needsAgent ? 'done' : 'pending'

      const { id, relPath, fileTarget } = await saveRecord({
        base, safePolicy, prompt, answer: text,
        channel: 'manual',
        actions, results,
        selectedIndices: selected.map((a) => a.index),
        status,
        stamp
          ,
          steps,
          intent: payload && payload.intent
      })

        // v1.3: persist Step List state so the panel and main agent share progress.
        let stepState = null
        if (steps && steps.length > 0) {
          // v1.9 AutoIteration：从 prompt/answer 提取迭代声明（iterations/finalAcceptance/autoDecision）
          const ai = extractAutoIterDecl(`${prompt}\n${text}`)
          try { stepState = await writeStepState(base, id, { exprId: id, steps, currentStep: null, status: 'open', autoReview: payload.autoReview === true, protocolVersion, iterations: ai.iterations, currentIteration: 1, finalAcceptance: ai.finalAcceptance, autoDecision: ai.autoDecision, rejectStreak: 0 }, safePolicy) } catch (err) { stepState = null }
        }

      // v0.5: write the three-party trace (用户 prompt → 外部AI 回答 → 主 agent 唤醒消息).
      await appendTrace({ base, safePolicy, exprId: id, entries: [
        traceEntry('user', prompt || '(无 prompt)'),
        traceEntry('external', text || '(无)'),
        ...mainAgentTrace
      ] }).catch(() => {}) // trace is best-effort; the record save is authoritative

      // needsAgent → try apiProxy wake-up; fall back to a copyable handoff block.
      let agentWoken = false
      let wakeReason = null
      let handoffText = null
      if (needsAgent) {
        // Step 3 (cross-workspace context bridge): carry the effective
        // workspace + record path + a short summary in the handoff, so the main
        // agent works against the injected workspace instead of guessing from
        // its own default cwd (empty in a brand-new workspace).
        const wsFallback = !(workspacePath && String(workspacePath).trim())
        const recordText = await fs.readText(fileTarget).catch(() => '')
        const fm = (recordText.match(/^---\n([\s\S]*?)\n---/) || [])[1] || ''
        const fmHead = fm.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 2).join('; ')
        const resSec = (recordText.match(/## 执行所选[^\n]*\n([\s\S]*?)(?=\n## |$)/) || [])[1] || ''
        const summary = clip('frontmatter: ' + fmHead + ' | 执行结果: ' + resSec.trim().replace(/\s+/g, ' '), 200)
        handoffText = [
          `【主 agent 请协助】dsh-web-relay 试验记录 ${id}`,
          '',
          '【跨工作区上下文桥接】',
          `workspacePath: ${base}${wsFallback ? '（fallback 值：client 未传 workspacePath，Host 使用部署根）' : ''}`,
          `试验记录: ${fileTarget.displayPath || relPath}`,
          `三方轨迹: web-relay/traces/${id}.md（收口结论请追加到该轨迹）`,
          `摘要: ${summary}`,
          '',
          '优先按注入的 workspacePath 处理该试验（读取记录、执行指令、回写结论都基于该路径），而非当前默认 cwd。',
          '',
          `请读取并整合：${fileTarget.displayPath || relPath}`,
          '',
          `原因：${needsAgent.reason}`,
          '',
          '指令原文（已解析）：',
          '```json:agent-action',
          JSON.stringify(actions.filter((a) => a.type === 'write_file' || a.type === 'run_cmd' || a.type === 'plan'), null, 2),
          '```',
          '',
            ,
            '',
            '【Step List（v1.3 逐步执行）】',
            steps && steps.length > 0 ? JSON.stringify(steps, null, 2) : '（外部 AI 未提供结构化 steps）',
            '',
            isConcurrent(protocolVersion) ? '【v1.6 并发调度】本任务为并发模式：按步骤 depends_on / parallel_group 依赖门控执行，依赖满足的多个步骤可并行（建议 subagent 并发），每步完成后独立置为 review 等待审核。' : '',
            '请按 Step List 逐步执行：每步完成后通过 POST /dsh-web-relay/steps/update 标记状态并等待外部 AI 审核；审核通过后再执行下一步。'
              ,
          `请按需执行并整合，把最终结论通过 POST /dsh-web-relay/trace 追加到三方轨迹（body {"workspacePath": "${base}", "exprId": "${id}", "role": "mainagent", "text": "<你的发言>"}）。`
        ].join('\n')
        // v0.5: log the handoff as a 主 agent trace entry too.
        await appendTrace({ base, safePolicy, exprId: id, entries: [traceEntry('mainagent', handoffText)] }).catch(() => {})
        const wake = await wakeMainAgent({ sessionId, handoffText })
        agentWoken = wake.agentWoken
        wakeReason = wake.reason
      }

      json(res, 200, {
        ok: true,
        results,
        recordPath: fileTarget?.displayPath || relPath,
        id,
        status,
          steps,
          stepState,
        needsAgent: needsAgent
          ? { reason: needsAgent.reason, agentWoken, wakeReason, handoffText }
          : null
      })
    } catch (err) {
      json(res, 500, { ok: false, error: String(err?.message || err) })
    }
  }

  // GET /dsh-web-relay/traces?cwd=...  → { ok, traces } (trace page feed)
  const tracesHandler = async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
      const url = new URL(req.url || '/', 'http://localhost')
      const cwd = url.searchParams.get('cwd') || ''
      const base = baseOf(cwd)
      const traces = await listTraces(base)
      json(res, 200, { ok: true, traces })
    } catch (err) {
      json(res, 500, { ok: false, error: String(err?.message || err) })
    }
  }

  // GET /dsh-web-relay/record?cwd=...&id=expr-<ts>  → { ok, record: { id, text } }
  const recordHandler = async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
      const url = new URL(req.url || '/', 'http://localhost')
      const cwd = url.searchParams.get('cwd') || ''
      const id = url.searchParams.get('id') || ''
      const base = baseOf(cwd)
      if (!TRACE_ID_RE.test(id)) return json(res, 400, { ok: false, error: 'invalid record id' })
      const rel = `${EXPERIMENTS_DIR}/dsh-web-relay-${id.slice(5)}.md`
      const target = await fs.resolve(rel, { cwd: base })
      const text = await fs.readText(target)
      json(res, 200, { ok: true, record: { id, text } })
    } catch (err) {
      json(res, 404, { ok: false, error: String(err?.message || err) })
    }
  }

  // POST /dsh-web-relay/trace  body { workspacePath?, exprId, role, text }
  // Appends one three-party trace entry (role: user | mainagent | external).
  const traceHandler = async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
      const payload = JSON.parse((await readBody(req)) || '{}')
      const exprId = typeof payload.exprId === 'string' ? payload.exprId.trim() : ''
      const role = typeof payload.role === 'string' ? payload.role.trim() : ''
      const text = typeof payload.text === 'string' ? payload.text : ''
      if (!TRACE_ID_RE.test(exprId)) return json(res, 400, { ok: false, error: 'invalid exprId' })
      if (!Object.prototype.hasOwnProperty.call(ROLE_LABEL, role)) {
        return json(res, 400, { ok: false, error: `invalid role: ${role}（允许 user / mainagent / external）` })
      }
      if (!String(text).trim()) return json(res, 400, { ok: false, error: 'missing text' })
      const base = baseOf(payload.workspacePath)
      const safePolicy = safePolicyFor(base)
      await appendTrace({ base, safePolicy, exprId, entries: [traceEntry(role, text)] })
      json(res, 200, { ok: true, exprId, role })
    } catch (err) {
      json(res, 500, { ok: false, error: String(err?.message || err) })
    }
  }

    // GET /dsh-web-relay/steps?cwd=...&id=expr-... → { ok, exprId, steps, currentStep, status }
    const stepsHandler = async (req, res) => {
      try {
        if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
        const url = new URL(req.url || '/', 'http://localhost')
        const cwd = url.searchParams.get('cwd') || ''
        const id = url.searchParams.get('id') || ''
        if (!TRACE_ID_RE.test(id)) return json(res, 400, { ok: false, error: 'invalid exprId' })
        const base = baseOf(cwd)
        const state = await readStepState(base, id)
        json(res, 200, { ok: true, ...state })
      } catch (err) {
        json(res, 500, { ok: false, error: String(err?.message || err) })
      }
    }

    // POST /dsh-web-relay/steps/update
    // body { workspacePath?, exprId, stepId, action: start|complete|approve|reject|reopen, comment?, role? }
    const stepUpdateHandler = async (req, res) => {
      try {
        if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
        const payload = JSON.parse((await readBody(req)) || '{}')
        const exprId = typeof payload.exprId === 'string' ? payload.exprId.trim() : ''
        const stepId = payload.stepId != null ? String(payload.stepId) : ''
        const action = String(payload.action || '')
        const comment = String(payload.comment || '')
        // v1.4.0: steps/update 支持挂载 artifacts（complete 时追加写入；null=未传，不覆盖已有产物）
        const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts.map((x) => String(x)).filter(Boolean) : null
        const role = Object.prototype.hasOwnProperty.call(ROLE_LABEL, payload.role) ? payload.role : 'mainagent'
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : ''
          const autoReview = payload.autoReview === true
          const nextPhase = typeof payload.phase === 'string' ? payload.phase : ''
        if (!TRACE_ID_RE.test(exprId)) return json(res, 400, { ok: false, error: 'invalid exprId' })
        if (!stepId) return json(res, 400, { ok: false, error: 'missing stepId' })
        const base = baseOf(payload.workspacePath)
        const safePolicy = safePolicyFor(base)
        const state = await readStepState(base, exprId)
        if (!state.steps || state.steps.length === 0) return json(res, 400, { ok: false, error: 'no steps found' })
        const step = state.steps.find((s) => String(s.id) === String(stepId))
        if (!step) return json(res, 404, { ok: false, error: 'step not found' })
          if (state.status === 'stopped' && action !== 'resume' && action !== 'stop' && action !== 'set_auto_review' && action !== 'set_phase') {
            return json(res, 400, { ok: false, error: '试验已停止，不能继续推进；请先 resume 或新建试验' })
          }

        // v1.3 sequential review guard: keep main-agent execution and external-AI
        // review in the intended order.
        if (action === 'start') {
          const idx = state.steps.findIndex((s) => String(s.id) === String(stepId))
          // v1.6 依赖门控：v1.6 模式（或步骤显式声明 depends_on）下以拓扑依赖为准，
          // 位置序限制不再适用；前置依赖未全部 approved 则拒绝开始。
          const hasDeps = Array.isArray(step.depends_on) && step.depends_on.length > 0
          if (isConcurrent(state.protocolVersion) || hasDeps) {
            if (!depsSatisfied(step, state)) {
              const waitingFor = blockedWaitingFor(step, state)
              return json(res, 400, { ok: false, blocked: true, waitingFor, error: `Step ${step.id} 的前置依赖未全部通过，不能开始：${waitingFor.join(', ')}` })
            }
          } else {
            const prevBlocked = state.steps.slice(0, idx).some((s) => s.status !== 'approved')
            if (prevBlocked) return json(res, 400, { ok: false, error: '前面的步骤尚未全部审核通过，不能开始本步' })
          }
        }
        if (action === 'start' && step.status !== 'pending') {
          return json(res, 400, { ok: false, error: `Step ${step.id} 当前状态为 ${step.status}，不能重复开始` })
        }
        if (action === 'complete' && step.status !== 'executing' && step.status !== 'pending') {
          return json(res, 400, { ok: false, error: `Step ${step.id} 尚未开始，不能标记完成` })
        }
        if ((action === 'approve' || action === 'reject') && step.status !== 'review') {
          return json(res, 400, { ok: false, error: `Step ${step.id} 不在待审核状态，不能审核` })
        }

        let traceText = ''
        let artifactsWarning = null   // v1.7 (P5): complete 时前置校验，仅提示不阻断状态流转
        let autoPass = false          // v1.8 混合模式：complete 自动豁免标记（review:false 硬开关 / importance=low 未显式指定 review）
        if (action === 'start') {
          step.status = 'executing'
          state.currentStep = step.id   // v1.0.1: 最近激活步骤（v1.6 并行时 activeSteps 为完整集合）
          state.activeSteps = state.activeSteps || []
          if (!state.activeSteps.some((x) => String(x) === String(step.id))) state.activeSteps.push(String(step.id))
          traceText = `开始执行 Step ${step.id}：${step.title}`
        } else if (action === 'complete') {
          // v1.4.0: complete 时挂载 artifacts（追加语义 + 去重；未传 artifacts 则保留现有产物）
          if (artifacts !== null) {
            const merged = new Set([...(Array.isArray(step.artifacts) ? step.artifacts : []), ...artifacts])
            step.artifacts = [...merged]
          }
          // v1.8 混合模式：review:false 硬开关无条件绕过；importance=low 且未显式指定 review → 主 agent 自动豁免
          autoPass = step.review === false || (step.importance === 'low' && !step.reviewSpecified)
          if (autoPass) {
            step.status = 'approved'
            step.reviewedBy = 'mainagent'
            state.activeSteps = (state.activeSteps || []).filter((x) => String(x) !== String(step.id))
            traceText = `Step ${step.id} 已完成并自动通过（主 agent 自动豁免：${step.review === false ? 'review:false 硬开关' : 'importance=low'}）：${step.title}\n${comment}`
          } else {
            step.status = 'review'
            state.currentStep = step.id
            traceText = `Step ${step.id} 已完成，待外部 AI 审核：${step.title}\n${comment}`
            // 保留现有 v1.7 (P5) artifacts 前置校验（artifactsWarning）
            const artifactsMissing = step.artifact_required === false ? false : (!Array.isArray(step.artifacts) || step.artifacts.length === 0)
            artifactsWarning = artifactsMissing ? `Step ${step.id} 缺少 artifacts 产物，外部 AI 可能打回；请补充实体产物后重提` : null
          }
        } else if (action === 'approve') {
          step.status = 'approved'
          step.reviewedBy = 'manual'   // v1.5：手动审核路径
          state.activeSteps = (state.activeSteps || []).filter((x) => String(x) !== String(step.id))
          traceText = `用户手动审核通过 Step ${step.id}：${step.title}\n${comment}`
        } else if (action === 'reject') {
          step.status = 'rejected'
          step.reviewedBy = null   // v1.8.1：打回清空审核来源（原 'manual'），重新提交通过后再记录
          state.activeSteps = (state.activeSteps || []).filter((x) => String(x) !== String(step.id))
          traceText = `用户手动打回 Step ${step.id}：${step.title}\n${comment}`
        } else if (action === 'reopen') {
          step.status = 'pending'
          state.currentStep = step.id
          traceText = `Step ${step.id} 重新打开：${step.title}\n${comment}`
          } else if (action === 'stop') {
            state.status = 'stopped'
            state.stopReason = comment || '用户手动叫停'
            state.stoppedAt = new Date().toISOString()
            traceText = `试验已停止：${state.stopReason}`
          } else if (action === 'resume') {
            state.status = 'open'
            state.stopReason = null
            state.stoppedAt = null
            traceText = `试验已恢复：${comment || '用户恢复执行'}`
            } else if (action === 'set_auto_review') {
              state.autoReview = autoReview
              traceText = `自动审核模式已${autoReview ? '开启' : '关闭'}`
              } else if (action === 'set_phase') {
                if (nextPhase !== 'planning' && nextPhase !== 'executing' && nextPhase !== 'finished') {
                  return json(res, 400, { ok: false, error: 'phase 必须是 planning / executing / finished' })
                }
                state.phase = nextPhase
                traceText = `阶段已切换为 ${nextPhase}`
        } else {
          return json(res, 400, { ok: false, error: `unknown action: ${action}（允许 start / complete / approve / reject / reopen / stop / resume / set_auto_review / set_phase）` })
        }

        // v1.9 AutoIteration：手动打回同样计入 rejectStreak（approve 清零），≥3 次自动暂停
        if (action === 'approve') {
          state.rejectStreak = 0
        } else if (action === 'reject') {
          state.rejectStreak = (state.rejectStreak || 0) + 1
          if (state.rejectStreak >= 3 && state.status !== 'stopped' && state.status !== 'paused') {
            state.status = 'paused'
            state.stopReason = '连续打回 ≥3 次，AutoIteration 自动暂停，等待用户介入'
            state.stoppedAt = new Date().toISOString()
          }
        }

        if (state.steps.every((s) => s.status === 'approved')) state.status = 'done'

        step.notes = step.notes || []
        step.notes.push({ role, at: new Date().toISOString(), action, text: comment })
        const updated = await writeStepState(base, exprId, state, safePolicy)
        if (traceText) {
          await appendTrace({ base, safePolicy, exprId, entries: [traceEntry(role, traceText)] }).catch(() => {})
        }

          // Wake the main agent when a step is started/reopened or the experiment is stopped.
          let wake = null
          let handoffText = null
          if (action === 'reopen' || action === 'start') {
            handoffText = [
              `【主 agent 请协助】dsh-web-relay Step ${step.id} 已开始/重新打开，请执行`,
              '',
              `试验: ${exprId}`,
              `Step: ${step.id} ${step.title}`,
              `详情: ${step.detail || '(无)'}`,
              `验收标准: ${step.acceptance || '(无)'}`,
              '',
              `请执行 Step ${step.id}，完成后写入三方轨迹并置为 review。`
            ].join('\n')
            // v1.6 并发提示：start/reopen 后若还有依赖已满足的 pending 步骤，附带就绪清单
            if (isConcurrent(state.protocolVersion)) {
              const ready = readySteps(state)
              if (ready.length > 0) {
                const readyList = ready.map((s) => `Step ${s.id}（${s.parallel_group ? `组${s.parallel_group}` : '无组/串行'}）`).join('、')
                handoffText += '\n\n【v1.6 并发提示】以下步骤依赖已满足，可与当前 Step 并行执行：\n' +
                  `⚡ 可并行启动：${readyList} → 建议用 subagent 并发执行`
              }
            }
            if (sessionId) {
              wake = await wakeMainAgent({ sessionId, handoffText })
            }
            await appendTrace({ base, safePolicy, exprId, entries: [traceEntry('mainagent', handoffText)] }).catch(() => {})
          } else if (action === 'stop') {
            handoffText = [
              `【主 agent 请协助】dsh-web-relay 试验已停止`,
              '',
              `试验: ${exprId}`,
              `停止原因: ${comment || '用户手动叫停'}`,
              '',
              `请停止当前操作，确认无残留进程，并将停止状态回传到三方轨迹。`
            ].join('\n')
            if (sessionId) {
              wake = await wakeMainAgent({ sessionId, handoffText })
            }
            await appendTrace({ base, safePolicy, exprId, entries: [traceEntry('mainagent', handoffText)] }).catch(() => {})
          } else if (action === 'complete' && autoPass) {
            // v1.8 混合模式：complete 自动豁免后推进任务（就绪并发 / 等待清单 / 线性下一步 / done 收口）。
            // wakeAfterApproved 内部会 appendTrace，这里不重复追加；done 收口由上面 every() 判断保持。
            const w = await wakeAfterApproved(state, step, '主 agent（自动豁免）', sessionId, base, safePolicy)
            wake = w.wake
            handoffText = w.handoffText
          }

        json(res, 200, { ok: true, stepState: updated, step: updated.steps.find((s) => String(s.id) === String(stepId)), wake, handoffText, artifactsWarning })
      } catch (err) {
        json(res, 500, { ok: false, error: String(err?.message || err) })
      }
    }


    // ---------- v1.7 (P2): 单步自动审核（单步与批量共用） ----------
    // 三级降级链（外部AI → 对话模型(无工具) → 手动）+ 应用结果 + 落盘 + 轨迹。
    // 返回 { state, updated, step, reviewedBy, reviewerLabel, result, reason, manual, fallbackReason, traceText }
    async function reviewOneStep(state, step, base, safePolicy) {
      const exprId = state.exprId
      // 审核上下文：任务记录 + 三方轨迹
      const recordPath = `${EXPERIMENTS_DIR}/dsh-web-relay-${exprId.slice(5)}.md`
      const recordTarget = await fs.resolve(recordPath, { cwd: base })
      const recordText = await fs.readText(recordTarget).catch(() => '')
      const trace = await loadTrace(base, exprId)
      const traceText = (trace.entries || [])
        .map((e) => `[${ROLE_LABEL[e.role] || e.role}] ${e.text}`)
        .join('\n')
      // v2.2-1: 上一步产物摘要（审核上下文增强）
      const artifactsSummary = await buildArtifactsSummary(base, safePolicy, step.artifacts)

      // ---- v1.5 三级降级链：外部AI → 对话模型(无工具) → 手动 ----
      let reviewer = 'external'   // external | dialog | manual
      let fallbackReason = ''
      let r = { ok: false }
      let prompt = ''

      if (GEMINI_KEY) {
        prompt = buildReviewPrompt(exprId, step, recordText, traceText, '外部 AI（Gemini）', artifactsSummary)
        r = await callGemini(prompt)
        if (r.ok) reviewer = 'external'
        else fallbackReason = r.error
      } else {
        fallbackReason = 'GEMINI_API_KEY 未配置'
      }

      if (!r.ok) {
        prompt = buildReviewPrompt(exprId, step, recordText, traceText, '对话模型（无工具）', artifactsSummary)
        r = await callDialogModel(prompt)
        if (r.ok) reviewer = 'dialog'
        else fallbackReason = fallbackReason || r.error
      }

      let result = ''
      let reason = ''
      if (r.ok) {
        const parsed = parseReview(r.text)
        result = parsed.result
        reason = parsed.reason
        if (result !== 'approved' && result !== 'rejected') {
          fallbackReason = fallbackReason || '审核回复无法识别'
          r = { ok: false }
        }
      }

      if (!r.ok) {
        // 降级到手动：前端展开审核框
        return {
          state, step,
          manual: true,
          fallbackReason,
          reviewedBy: 'manual',
          reviewerLabel: '用户',
          result: '',
          reason: '',
          traceText: clip(traceText, 3000),
          updated: null
        }
      }

      const reviewerLabel = reviewer === 'external' ? '外部 AI' : reviewer === 'dialog' ? '对话模型（无工具）' : '用户'
      const role = reviewer === 'manual' ? 'user' : 'external'
      let traceTextEntry = ''
      if (result === 'approved') {
        step.status = 'approved'
        traceTextEntry = `${reviewerLabel} 自动审核通过 Step ${step.id}：${step.title}\n${reason}`
      } else {
        step.status = 'rejected'
        traceTextEntry = `${reviewerLabel} 自动打回 Step ${step.id}：${step.title}\n${reason}`
      }

      // v1.5 审核来源；v1.8.1：打回（rejected）时清空 reviewedBy，不留残留审核信息
      step.reviewedBy = result === 'approved' ? reviewer : null
      // v1.0.1: 审核（通过/打回）后从 activeSteps 移除该步（v1.6 并行集合同步）
      state.activeSteps = (state.activeSteps || []).filter((x) => String(x) !== String(step.id))
      // v1.9 AutoIteration：连续打回熔断——rejectStreak 递增（approve 清零），≥3 次自动暂停并唤醒用户
      if (result === 'approved') {
        state.rejectStreak = 0
      } else {
        state.rejectStreak = (state.rejectStreak || 0) + 1
        if (state.rejectStreak >= 3 && state.status !== 'stopped') {
          state.status = 'paused'
          state.stopReason = '连续打回 ≥3 次，AutoIteration 自动暂停，等待用户介入'
          state.stoppedAt = new Date().toISOString()
        }
      }
      if (state.steps.every((s) => s.status === 'approved')) state.status = 'done'

      step.notes = step.notes || []
      step.notes.push({ role, at: new Date().toISOString(), action: result, text: reason, reviewedBy: reviewer })
      const updated = await writeStepState(base, exprId, state, safePolicy)
      await appendTrace({ base, safePolicy, exprId, entries: [traceEntry(role, traceTextEntry)] }).catch(() => {})

      return { state, step, updated, reviewedBy: reviewer, reviewerLabel, result, reason, manual: false, fallbackReason, traceText: clip(traceText, 3000) }
    }

    // approved 后唤醒主 agent：v1.6 并发就绪清单 / 等待清单 / v1.5 线性下一步 / done 收口。
    // 单步与批量共用；返回 { wake, nextStep, nextSteps, handoffText, waitingFor }
    async function wakeAfterApproved(updated, step, reviewerLabel, sessionId, base, safePolicy) {
      const exprId = updated.exprId
      let wake = null
      let nextStep = null
      let nextSteps = null
      let handoffText = null
      let waitingFor = null
      const idx = updated.steps.findIndex((s) => String(s.id) === String(step.id))
      const ready = isConcurrent(updated.protocolVersion) ? readySteps(updated) : []
      if (ready.length > 0) {
        // v1.6：就绪步骤 ≥ 1 → 并发清单唤醒
        nextSteps = ready
        nextStep = ready[0]
        const readyList = ready.map((s) => `Step ${s.id}（${s.parallel_group ? `组${s.parallel_group}` : '无组/串行'}）`).join('、')
        const readyIds = new Set(ready.map((s) => String(s.id)))
        const waitingList = (updated.steps || [])
          .filter((s) => s.status !== 'approved' && !readyIds.has(String(s.id)))
          .map((s) => {
            const missing = blockedWaitingFor(s, updated)
            return `Step ${s.id}（${missing.length ? `依赖 ${missing.join(',')}` : '等待前序推进'}）`
          })
          .join('、') || '（无）'
        handoffText = [
          '【主 agent 请协助】dsh-web-relay 自动审核已通过，以下步骤依赖已满足，可并行执行：',
          '',
          `⚡ 可并行启动：${readyList} → 建议用 subagent 并发执行`,
          `🔒 等待中：${waitingList}`,
          '',
          `任务: ${exprId}`,
          `已通过 Step: ${step.id} ${step.title}`,
          `审核来源: ${reviewerLabel}`,
          '',
          '请执行上述就绪步骤（可并行），每步完成后独立写入三方轨迹并置为 review 等待审核。'
        ].join('\n')
        if (sessionId) {
          wake = await wakeMainAgent({ sessionId, handoffText })
        }
        await appendTrace({ base, safePolicy, exprId, entries: [traceEntry('mainagent', handoffText)] }).catch(() => {})
      } else {
        // v1.6：就绪为 0 但任务未完成 → 输出等待清单（依赖未满足的步骤），不误导为线性下一步
        if (isConcurrent(updated.protocolVersion)) {
          const notDone = updated.steps.filter((s) => s.status !== 'approved' && s.status !== 'done')
          if (notDone.length > 0) {
            const waitLines = notDone.map((s) => {
              const unmet = blockedWaitingFor(s, updated)
              return `🔒 Step ${s.id} ${s.title}（等待：${unmet.length ? '依赖 ' + unmet.join(', ') : '前置审核'}）`
            })
            handoffText = [
              '【主 agent 请协助】dsh-web-relay 自动审核已通过，但暂无就绪步骤（依赖未满足）',
              '',
              `任务: ${exprId}`,
              `已通过 Step: ${step.id} ${step.title}`,
              `审核来源: ${reviewerLabel}`,
              '',
              '当前等待中：',
              ...waitLines,
              '',
              '无需执行新步骤，前置依赖通过后会自动唤醒。'
            ].join('\n')
            if (sessionId) {
              wake = await wakeMainAgent({ sessionId, handoffText })
            }
            await appendTrace({ base, safePolicy, exprId, entries: [traceEntry('mainagent', handoffText)] }).catch(() => {})
            nextStep = null
            waitingFor = notDone.map((s) => s.id)
            return { wake, nextStep, nextSteps, handoffText, waitingFor }
          }
        }
        // v1.5 线性唤醒（或 v1.6 就绪为 0 且任务完成）：找下一个 pending step 或 done 收口
        nextStep = updated.steps.slice(idx + 1).find((s) => s.status === 'pending') || null
        if (nextStep) {
          handoffText = [
            '【主 agent 请协助】dsh-web-relay 自动审核已通过，请继续下一步',
            '',
            `任务: ${exprId}`,
            `已通过 Step: ${step.id} ${step.title}`,
            `审核来源: ${reviewerLabel}`,
            '',
            `下一步 Step ${nextStep.id}: ${nextStep.title}`,
            `详情: ${nextStep.detail || '(无)'}`,
            `验收标准: ${nextStep.acceptance || '(无)'}`,
            '',
            `请执行 Step ${nextStep.id}，完成后写入三方轨迹并置为 review。`
          ].join('\n')
          if (sessionId) {
            wake = await wakeMainAgent({ sessionId, handoffText })
          }
          await appendTrace({ base, safePolicy, exprId, entries: [traceEntry('mainagent', handoffText)] }).catch(() => {})
        } else if (updated.status === 'done') {
          // v1.9 AutoIteration 版间门：迭代未满 → 自动推进 Vn+1（请外部 AI 评审上版输出修正 Step List），
          // 达到 iterations 上限才收口 done。
          if (updated.iterations > 1 && (updated.currentIteration || 1) < updated.iterations) {
            const nextIter = (updated.currentIteration || 1) + 1
            updated.currentIteration = nextIter
            await writeStepState(base, exprId, updated, safePolicy).catch(() => {})   // 版间门：迭代计数落盘
            handoffText = [
              `【主 agent 请协助】dsh-web-relay 自动迭代 V${nextIter - 1} 全部 approved，进入 V${nextIter}`,
              '',
              `任务: ${exprId}`,
              `迭代: V${nextIter}/${updated.iterations}（共 ${updated.iterations} 版）`,
              `最终验收标准: ${updated.finalAcceptance || '(未声明)'}`,
              '',
              '请通过协议通道（/ask gemini-free）请外部 AI 评审 V' + (nextIter - 1) + ' 的产出与审核反馈，输出 V' + nextIter + ' 修正 Step List（importance 分工），然后按新 Step List 继续执行。'
            ].join('\n')
          } else {
            handoffText = [
              '【主 agent 请协助】dsh-web-relay 自动审核已完成全部步骤，请收口',
              '',
              `任务: ${exprId}`,
              '全部 Step 已 approved，整体状态 done。',
              ...(updated.iterations > 1 ? [`迭代: V${updated.currentIteration || 1}/${updated.iterations} 已完成，达到迭代上限`] : []),
              '',
              '请完成最终收口：确认 steps.json 与任务记录状态为 done，并将最终结论追加到三方轨迹。'
            ].join('\n')
          }
          if (sessionId) {
            wake = await wakeMainAgent({ sessionId, handoffText })
          }
          await appendTrace({ base, safePolicy, exprId, entries: [traceEntry('mainagent', handoffText)] }).catch(() => {})
        }
      }
      return { wake, nextStep, nextSteps, handoffText, waitingFor }
    }

    // rejected 后唤醒主 agent 修改重提（单步与批量共用）
    async function wakeAfterRejected(exprId, step, reason, sessionId, base, safePolicy) {
      let wake = null
      const handoffText = [
        '【主 agent 请协助】dsh-web-relay 自动审核已打回，请修改后重新提交',
        '',
        `任务: ${exprId}`,
        `Step: ${step.id} ${step.title}`,
        `审核意见: ${reason}`,
        '',
        `请根据审核意见修改 Step ${step.id}，完成后重新置为 review 并提交审核。`
      ].join('\n')
      if (sessionId) {
        wake = await wakeMainAgent({ sessionId, handoffText })
      }
      await appendTrace({ base, safePolicy, exprId, entries: [traceEntry('mainagent', handoffText)] }).catch(() => {})
      return { wake, handoffText }
    }

    // POST /dsh-web-relay/steps/auto-review
    // body { workspacePath?, exprId, stepId?, batchStepIds? } → auto-call external AI for review-step(s).
    // v1.7 (P2): batchStepIds（数组）→ 逐个 step 独立审核（复用 reviewOneStep），结果汇总为 batchResults。
    const autoReviewHandler = async (req, res) => {
      try {
        if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
        const payload = JSON.parse((await readBody(req)) || '{}')
        const exprId = typeof payload.exprId === 'string' ? payload.exprId.trim() : ''
        const stepId = payload.stepId != null ? String(payload.stepId) : ''
        const batchStepIds = Array.isArray(payload.batchStepIds)
          ? payload.batchStepIds.map((x) => String(x)).filter(Boolean)
          : []
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : ''
        if (!TRACE_ID_RE.test(exprId)) return json(res, 400, { ok: false, error: 'invalid exprId' })

        const base = baseOf(payload.workspacePath)
        const safePolicy = safePolicyFor(base)
        const state = await readStepState(base, exprId)
        if (!state.steps || state.steps.length === 0) return json(res, 400, { ok: false, error: 'no steps found' })
        if (state.status === 'stopped') return json(res, 400, { ok: false, error: '任务已停止，不能自动审核' })

        // ---- v1.7 (P2) 批量审核：前端一次传多个 stepId，逐个独立审核 ----
        // v1.8 微调2：批量审核原子打回——任一 rejected → batch 内所有步骤（含刚 approved 的）统一退回 rejected。
        if (batchStepIds.length > 0) {
          const batchResults = []
          const reviewed = []   // 实际完成自动审核的 { step, out }（降级手动的步骤不参与原子打回）
          let anyRejected = false
          for (const sid of batchStepIds) {
            const s = state.steps.find((x) => String(x.id) === String(sid))
            if (!s) {
              batchResults.push({ stepId: sid, status: 'not_found', error: 'step not found' })
              continue
            }
            if (s.status !== 'review') {
              batchResults.push({ stepId: sid, status: s.status, error: `Step ${sid} 不在 review 状态，不能自动审核` })
              continue
            }
            // v1.5 状态锁：8 秒内同一 Step 拒绝重复审核/唤醒（按 exprId:stepId）
            if (!lockReview(`${exprId}:${sid}`)) {
              batchResults.push({ stepId: sid, status: s.status, skipped: true, error: '该步骤正在审核中，请勿重复触发' })
              continue
            }
            const out = await reviewOneStep(state, s, base, safePolicy)
            batchResults.push({
              stepId: sid,
              status: s.status,
              reviewedBy: out.reviewedBy,
              manual: out.manual === true,
              reason: out.reason || null,
              fallbackReason: out.fallbackReason || null
            })
            if (out.manual === true) continue   // 降级到手动：未实际审核，不参与原子打回
            reviewed.push({ step: s, out })
            if (out.result === 'rejected') anyRejected = true
          }

          // v1.8 微调2：原子打回——任一 rejected → 整批统一退回 rejected 待补证据
          if (anyRejected) {
            const now = new Date().toISOString()
            const rejectedIds = new Set()
            for (const item of reviewed) {
              item.step.status = 'rejected'
              item.step.reviewedBy = null   // v1.8.1：连带打回清空 reviewedBy，待重新提交通过后再记录
              item.step.notes = item.step.notes || []
              item.step.notes.push({ role: 'mainagent', at: now, action: 'rejected', text: '批量原子打回：同批步骤含被拒项，统一退回 rejected 待补证据' })
              rejectedIds.add(String(item.step.id))
              state.activeSteps = (state.activeSteps || []).filter((x) => String(x) !== String(item.step.id))
            }
            const updated = await writeStepState(base, exprId, state, safePolicy).catch(() => state)
            // 对被统一打回的步骤分别唤醒主 agent 修改重提（去重；approved 分支的 wakeAfterApproved 跳过）
            const woke = new Set()
            for (const item of reviewed) {
              if (woke.has(String(item.step.id))) continue
              woke.add(String(item.step.id))
              await wakeAfterRejected(exprId, item.step, '批量原子打回：同批步骤含被拒项，统一退回 rejected 待补证据', sessionId, base, safePolicy)
            }
            return json(res, 200, {
              ok: true,
              batch: true,
              atomicRejected: true,
              batchResults: batchResults.map((r) => rejectedIds.has(String(r.stepId)) ? { ...r, status: 'rejected', atomicRejected: true } : { ...r, atomicRejected: true }),
              stepState: updated
            })
          }

          // 无被拒项：保持逐步唤醒（approved → 并发/等待/线性/收口；rejected → 修改重提）
          for (const item of reviewed) {
            if (item.out.result === 'approved') {
              await wakeAfterApproved(item.out.updated, item.step, item.out.reviewerLabel, sessionId, base, safePolicy)
            } else if (item.out.result === 'rejected') {
              await wakeAfterRejected(exprId, item.step, item.out.reason, sessionId, base, safePolicy)
            }
          }
          const updated = await writeStepState(base, exprId, state, safePolicy).catch(() => state)
          return json(res, 200, { ok: true, batch: true, atomicRejected: false, batchResults, stepState: updated })
        }

        // ---- 单步审核（v1.5 原有逻辑，抽取为 reviewOneStep）----
        const step = (stepId ? state.steps.find((s) => String(s.id) === String(stepId)) : null)
          || state.steps.find((s) => s.status === 'review')
          || null
        if (!step) return json(res, 404, { ok: false, error: 'no review step found' })
        if (step.status !== 'review') return json(res, 400, { ok: false, error: `Step ${step.id} 不在 review 状态，不能自动审核` })

        // v1.5 状态锁：8 秒内同一 Step 拒绝重复审核/唤醒
        if (!lockReview(`${exprId}:${step.id}`)) {
          return json(res, 200, { ok: true, skipped: true, error: '该步骤正在审核中，请勿重复触发' })
        }

        const out = await reviewOneStep(state, step, base, safePolicy)
        if (out.manual) {
          // 降级到手动：前端展开审核框
          return json(res, 200, {
            ok: true,
            manual: true,
            fallbackReason: out.fallbackReason,
            exprId,
            stepId: String(step.id),
            step: { id: step.id, title: step.title, detail: step.detail, acceptance: step.acceptance },
            traceText: out.traceText
          })
        }

        // 单步审核结果 → 唤醒主 agent（approved: 并发/等待/线性/收口；rejected: 修改重提）
        let wake = null
        let nextStep = null
        let nextSteps = null
        let handoffText = null
        let waitingFor = null
        if (out.result === 'approved') {
          const w = await wakeAfterApproved(out.updated, step, out.reviewerLabel, sessionId, base, safePolicy)
          wake = w.wake
          nextStep = w.nextStep
          nextSteps = w.nextSteps
          handoffText = w.handoffText
          waitingFor = w.waitingFor
        } else if (out.result === 'rejected') {
          const w = await wakeAfterRejected(exprId, step, out.reason, sessionId, base, safePolicy)
          wake = w.wake
          handoffText = w.handoffText
        }

        json(res, 200, {
          ok: true,
          stepState: out.updated,
          step: out.updated.steps.find((s) => String(s.id) === String(step.id)),
          reviewedBy: out.reviewedBy,
          reviewerLabel: out.reviewerLabel,
          nextStep,
          readySteps: nextSteps ? nextSteps.map((s) => s.id) : [],
          ...(waitingFor ? { waitingFor } : {}),
          wake,
          handoffText
        })
      } catch (err) {
        json(res, 500, { ok: false, error: String(err?.message || err) })
      }
    }

    // POST /dsh-web-relay/steps/finalize — v1.5 一键收口
    // body { workspacePath?, exprId, sessionId? } → 仅当所有步骤均 approved 时收口任务，
    // 生成审核来源汇总（finalSummary）、追加三方轨迹，并可唤醒主 agent 完成最终收口。
    const finalizeHandler = async (req, res) => {
      try {
        if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
        const payload = JSON.parse((await readBody(req)) || '{}')
        const exprId = typeof payload.exprId === 'string' ? payload.exprId.trim() : ''
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : ''
        if (!TRACE_ID_RE.test(exprId)) return json(res, 400, { ok: false, error: 'invalid exprId' })

        const base = baseOf(payload.workspacePath)
        const safePolicy = safePolicyFor(base)
        const state = await readStepState(base, exprId)
        if (!state.steps || state.steps.length === 0) return json(res, 400, { ok: false, error: 'no steps found' })
        if (!state.steps.every((s) => s.status === 'approved')) return json(res, 400, { ok: false, error: '还有未通过步骤，不能收口' })
        if (state.status === 'done' && state.finalized) return json(res, 200, { ok: true, alreadyDone: true, state })

        const summary = summarizeReviewSources(state)
        state.status = 'done'
        state.finalized = true
        state.finalizedAt = new Date().toISOString()
        state.finalSummary = summary.text
        const updated = await writeStepState(base, exprId, state, safePolicy)
        await appendTrace({ base, safePolicy, exprId, entries: [traceEntry('mainagent', summary.text)] }).catch(() => {})

        let wake = null
        if (sessionId) {
          wake = await wakeMainAgent({ sessionId, handoffText: summary.handoff }).catch(() => null)
        }
        json(res, 200, { ok: true, state: updated, summary: summary.text, wake })
      } catch (err) {
        json(res, 500, { ok: false, error: String(err?.message || err) })
      }
    }

    // POST /dsh-web-relay/steps/restructure — v1.8 微调1：外部 AI 在线重构 Step List
    // body { workspacePath?, exprId, steps: 新步骤数组 }
    // 状态隔离：仅对 pending/rejected 步骤生效（按 id 匹配更新字段或移除）；
    // approved 历史步骤与产物严禁清除/篡改（原样保留，即使未出现在新数组中）。
    const restructureHandler = async (req, res) => {
      try {
        if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
        const payload = JSON.parse((await readBody(req)) || '{}')
        const exprId = typeof payload.exprId === 'string' ? payload.exprId.trim() : ''
        const newSteps = Array.isArray(payload.steps) ? payload.steps : null
        if (!TRACE_ID_RE.test(exprId)) return json(res, 400, { ok: false, error: 'invalid exprId' })
        if (!newSteps) return json(res, 400, { ok: false, error: 'steps 必须是数组' })

        const base = baseOf(payload.workspacePath)
        const safePolicy = safePolicyFor(base)
        const state = await readStepState(base, exprId)
        if (!state.steps || state.steps.length === 0) return json(res, 400, { ok: false, error: 'no steps found' })

        // 新定义归一化（沿用 normalizeStep 的字段契约）
        const normalizedNew = newSteps.map((s, i) => normalizeStep(s, i))
        const newById = new Map(normalizedNew.map((s) => [String(s.id), s]))
        const newIds = new Set(normalizedNew.map((s) => String(s.id)))

        const updated = []
        const changes = { updated: [], added: [], removed: [], untouchedApproved: 0 }
        const seen = new Set()

        for (const existing of state.steps) {
          // approved（或执行中/待审等非 pending/rejected）状态：原样保留，不更新、不移除
          if (existing.status !== 'pending' && existing.status !== 'rejected') {
            updated.push(existing)
            if (existing.status === 'approved') changes.untouchedApproved += 1
            seen.add(String(existing.id))
            continue
          }
          const def = newById.get(String(existing.id))
          if (def) {
            // 覆盖新定义字段，保留原 status / notes
            const merged = {
              ...existing,
              title: def.title,
              detail: def.detail,
              acceptance: def.acceptance,
              artifacts: def.artifacts,
              importance: def.importance,
              review: def.review,
              reviewSpecified: def.reviewSpecified,
              depends_on: def.depends_on,
              parallel_group: def.parallel_group,
              alternatives: def.alternatives
            }
            updated.push(merged)
            changes.updated.push(String(existing.id))
            seen.add(String(existing.id))
          }
          // 新数组中未出现的 pending/rejected → 移除（approved 即使未出现也保留）
        }

        // 新数组中的新 id → normalizeStep 后追加为 pending
        for (const def of normalizedNew) {
          if (seen.has(String(def.id))) continue
          def.status = 'pending'
          updated.push(def)
          changes.added.push(String(def.id))
          seen.add(String(def.id))
        }

        // removed：原有 pending/rejected 且未出现在新数组中的 id
        for (const existing of state.steps) {
          if (existing.status !== 'pending' && existing.status !== 'rejected') continue
          if (!newIds.has(String(existing.id))) changes.removed.push(String(existing.id))
        }

        state.steps = updated
        // currentStep / activeSteps 只保留仍存在且非 approved 的引用
        const curStill = state.steps.find((s) => String(s.id) === String(state.currentStep))
        state.currentStep = curStill ? curStill.id : null
        state.activeSteps = (state.activeSteps || []).filter((x) => {
          const s = state.steps.find((y) => String(y.id) === String(x))
          return s && s.status !== 'approved'
        })

        // v1.8.1 悬空依赖校验（Dangling Dependency Protection）：
        // 重构后所有步骤的 depends_on 引用必须存在于保留集合（approved 原样保留 + 更新的 pending/rejected + 新增 pending），
        // 否则返回 400 Invalid Dependency，拒绝本次重构。
        const retainedIds = new Set(state.steps.map((s) => String(s.id)))
        const dangling = []
        for (const s of state.steps) {
          for (const d of (s.depends_on || [])) {
            if (!retainedIds.has(String(d))) dangling.push({ step: String(s.id), missing: String(d) })
          }
        }
        if (dangling.length > 0) {
          return json(res, 400, {
            ok: false,
            error: `悬空依赖校验失败：${dangling.map((d) => `Step ${d.step} 引用了不存在的步骤 ${d.missing}`).join('；')}`,
            dangling
          })
        }

        const written = await writeStepState(base, exprId, state, safePolicy)
        const traceLine = `Step List 已重构（v1.8 restructure）：更新 ${changes.updated.length} 新增 ${changes.added.length} 移除 ${changes.removed.length}；approved 步骤保留。`
        await appendTrace({ base, safePolicy, exprId, entries: [traceEntry('mainagent', traceLine)] }).catch(() => {})
        return json(res, 200, { ok: true, stepState: written, changes })
      } catch (err) {
        json(res, 500, { ok: false, error: String(err?.message || err) })
      }
    }
  const protocolHandler = async (req, res) => {
    if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
    json(res, 200, {
      ok: true,
      version: WEB_RELAY_PROTOCOL_VERSION,
      text: WEB_RELAY_PROTOCOL,
      skill: { name: 'web_relay_external_ai_protocol', version: WEB_RELAY_PROTOCOL_VERSION, text: WEB_RELAY_EXTERNAL_AI_SKILL },
      protocolV15,
      protocolV16,
      protocolV17,
      protocolV18,
      protocolV19,
      en: {
        protocol: { version: WEB_RELAY_PROTOCOL_VERSION, text: WEB_RELAY_PROTOCOL_EN },
        skill: { name: 'web_relay_external_ai_protocol', version: WEB_RELAY_PROTOCOL_VERSION, text: WEB_RELAY_EXTERNAL_AI_SKILL_EN },
        protocolV15: { version: WEB_RELAY_PROTOCOL_VERSION, text: WEB_RELAY_PROTOCOL_EN },
        protocolV16: { version: WEB_RELAY_PROTOCOL_VERSION_V16, text: WEB_RELAY_PROTOCOL_EN },
        protocolV17: { version: WEB_RELAY_PROTOCOL_VERSION_V17, text: WEB_RELAY_PROTOCOL_EN },
        protocolV18: { version: WEB_RELAY_PROTOCOL_VERSION_V18, text: WEB_RELAY_PROTOCOL_EN },
        protocolV19: { version: WEB_RELAY_PROTOCOL_VERSION_V19, text: WEB_RELAY_PROTOCOL_EN }
      }
    })
  }

  ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-web-relay/status', handler: statusHandler }), 'dsh-web-relay/status')
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-web-relay/health-check', handler: healthCheckHandler }), 'dsh-web-relay/health-check')
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-web-relay/ask', handler: askHandler }), 'dsh-web-relay/ask')
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-web-relay/context', handler: contextHandler }), 'dsh-web-relay/context')
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-web-relay/parse', handler: parseHandler }), 'dsh-web-relay/parse')
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-web-relay/execute', handler: executeHandler }), 'dsh-web-relay/execute')
    ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-web-relay/steps', handler: stepsHandler }), 'dsh-web-relay/steps')
    ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-web-relay/steps/update', handler: stepUpdateHandler }), 'dsh-web-relay/steps/update')
    ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-web-relay/steps/auto-review', handler: autoReviewHandler }), 'dsh-web-relay/steps/auto-review')
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-web-relay/trace', handler: traceHandler }), 'dsh-web-relay/trace')
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-web-relay/traces', handler: tracesHandler }), 'dsh-web-relay/traces')
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-web-relay/record', handler: recordHandler }), 'dsh-web-relay/record')
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-web-relay/protocol', handler: protocolHandler }), 'dsh-web-relay/protocol')
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-web-relay/steps/finalize', handler: finalizeHandler }), 'dsh-web-relay: finalize route')
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-web-relay/steps/restructure', handler: restructureHandler }), 'dsh-web-relay/steps/restructure')
}
