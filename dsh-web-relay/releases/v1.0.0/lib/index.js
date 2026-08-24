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

export const name = 'dsh-web-relay'
// apiProxy must be a HARD inject (like dsh-side-window): ctx.get('apiProxy')
// returns undefined because the gateway registers later in composition order.
// shell stays optional via ctx.get (fallback: run_cmd reports unavailable).
export const inject = ['webServer', 'fs', 'sandboxPolicy', 'apiProxy']

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
export const WEB_RELAY_PROTOCOL = [
  '三方主体（web-relay 语境）：用户 (the human) / 主 agent (the tool-using agent in the main harness session，负责执行与收口) / 外部AI (external web AI — Gemini/DeepSeek 网页版或 free API，负责提供方案与回答)。全程一致使用这三个称谓。',
  '协作规则：任务记录保存在 web-relay/experiments/，三方对话流水（轨迹）保存在 web-relay/traces/。用户在 web-relay 面板发起任务，外部AI 回答，主 agent 按需执行并收口；主 agent 的收口结论通过 POST /dsh-web-relay/trace 追加到对应轨迹，不再写入 side/。',
  '规则 8（Triage 分流）：小改动 → 直接给结论。复杂任务（多步实现/设计分歧/接口未验证）→ 回复生成时必须同时包含：① json:agent-action 代码块（含 wake_agent/plan 动作，reason 说明）② 机器可读的 steps 数组（Step List）。外部 AI 若未遵守，粘贴端将提示一键补全（见面板护栏）——但补全不改变内容本质，仅补格式。',
  'Step List 执行协议（v1.3）：每个复杂任务必须提供结构化 steps。每步默认需要外部 AI 审核（review: true）；主 agent 按步骤执行，每步完成后回写轨迹并等待审核；审核通过后主 agent 继续下一步，被打回则主 agent 修改后重新提交。主 agent 在执行中可提出落地方案变更，审核方核实后更新步骤或通过。',
  'Planning & Architect 协议（v1.4）：复杂任务可先进入 planning 阶段。外部 AI 作为架构师，先深挖任务场景、边界与影响面；如需本地代码/配置上下文，可通过 context_requests 请求主 agent 做只读探路；方案确认后再进入 executing 阶段输出 steps。context_requests 仅允许只读文件读取与搜索，严禁修改代码。',
  '审核降级链协议（v1.5）：每步完成进入 review 后，按 外部AI → 对话模型（无工具）→ 用户手动 的顺序自动审核。无 GEMINI_API_KEY 或调用失败时，自动降级为对话模型（无工具，只读 acceptance 输出 approved/rejected + 意见），仍失败则展开手动审核框。每步记录审核来源（reviewedBy: external | dialog | manual）；任务全部审核完成后统一汇总各步审核来源。',
  '审核容错协议（v1.5）：steps 元素可声明 artifact_required: false（纯分析/规划类步骤不要求实体产物）；审核校验器优先读取该步 notes 与轨迹追加日志判断执行证据，避免因缺少实体文件误打回。',
  '外部 AI Skill（v1.5 新增）：所有外部 AI 生成的内容必须遵循 web_relay_external_ai_protocol（版本 v1.5）——本协议的细化执行规范。三方称谓、规则 8 Triage 分流、json:agent-action Payload 格式、steps 结构、逐步审核循环、产出物与轨迹约定的完整说明见该 Skill 正文（常量 WEB_RELAY_EXTERNAL_AI_SKILL）。版本号：v1.5。',
  '并发调度协议（v1.6）：复杂任务可声明 v1.6 模式（protocolVersion: v1.6），Step List 元素支持 depends_on（依赖步骤 id 数组）与 parallel_group（并行组名）。主 agent 按拓扑依赖门控执行：仅当某步的全部依赖步骤均已 approved 时该步才可开始；无依赖或依赖已满足的多个步骤可并行执行，建议用 subagent 并发；审核仍逐步独立进行（每步完成后单独提交审核）。v1.5 线性模式保持默认不变。'
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
  '## 版本历史',
  '- v1.1：规则 8 Triage 分流硬编码。',
  '- v1.2：本 Skill 固化，作为规则 8 的细化执行规范。',
  '- v1.3：Step List 升级为结构化 steps，加入逐步执行 + 外部 AI 审核回路。',
  '- v1.4：加入 Planning & Architect 模式，支持 phase 与 context_requests 只读探路。',
  '- v1.5：审核降级链（外部AI → 对话模型(无工具) → 手动）、artifact_required 容错、reviewedBy 审核来源。',
  '- v1.6：Step List 并发调度（depends_on / parallel_group），主 agent 依赖门控 + 多步并行，审核逐步独立。'
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
  'Concurrent scheduling protocol (v1.6): complex tasks may opt into v1.6 mode (protocolVersion: v1.6); Step List elements support depends_on (array of dependency step ids) and parallel_group (parallel group name). The main agent gates execution by topological dependencies: a step may start only when all its dependency steps are approved; multiple steps with no unmet dependencies may run in parallel (suggested via subagents); review stays per-step (each step is reviewed independently after completion). v1.5 linear mode remains the default.'
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
  '## Version history',
  '- v1.1: Rule 8 Triage hardcoded.',
  '- v1.2: This Skill formalized as the detailed execution spec of Rule 8.',
  '- v1.3: Step List upgraded to structured steps; step-by-step execution + external AI review loop.',
  '- v1.4: Planning & Architect mode; phase and read-only context_requests probing.',
  '- v1.5: Review degradation chain (External AI → dialog model (no tools) → manual), artifact_required tolerance, reviewedBy.',
  '- v1.6: Step List concurrent scheduling (depends_on / parallel_group); dependency gating + multi-step parallelism; per-step review.'
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
  function buildReviewPrompt(exprId, step, recordText, traceText, reviewer) {
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

  // 对话模型（无工具）审核：跟随主会话路由（llm 服务），纯文本输出，不调用任何工具。
  // 任何异常均返回 { ok:false }，由调用方继续降级到手动审核。
  async function callDialogModel(prompt) {
    if (!llm) return { ok: false, error: 'llm 服务不可用' }
    try {
      const chunks = []
      const stream = llm.stream({
        provider: 'deepseek-official',
        messages: [{ role: 'user', content: prompt }],
        tools: [],
        stream: false,
        signal: AbortSignal.timeout(60000)
      })
      for await (const chunk of stream) {
        if (chunk && chunk.type === 'error') return { ok: false, error: String(chunk.error || 'llm error') }
        if (chunk && chunk.type === 'aborted') return { ok: false, error: 'llm aborted' }
        const text = chunk?.text ?? chunk?.delta?.text ?? chunk?.delta ?? chunk?.content ?? chunk?.message?.content ?? ''
        if (typeof text === 'string' && text) chunks.push(text)
      }
      const text = chunks.join('')
      if (!text) return { ok: false, error: '对话模型返回空' }
      return { ok: true, text }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    }
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
    const groups = { external: [], dialog: [], manual: [] }
    for (const s of steps) {
      const who = s.reviewedBy === 'dialog' ? 'dialog' : s.reviewedBy === 'manual' ? 'manual' : 'external'
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
      `- 用户手动审核：${groups.manual.length ? groups.manual.join('、') : '（无）'}`
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

    // ---------- v1.3 Step List parsing / state ----------
    function normalizeStep(raw, index) {
      const id = raw && raw.id != null ? raw.id : raw && raw.stepId != null ? raw.stepId : (index + 1)
      return {
        id: String(id),
        title: String((raw && (raw.title || raw.name)) || `步骤 ${id}`).trim(),
        detail: String((raw && (raw.detail || raw.description)) || '').trim(),
        review: !raw || raw.review !== false,
        acceptance: String((raw && (raw.acceptance || raw.accept)) || '').trim(),
        artifacts: Array.isArray(raw && raw.artifacts) ? raw.artifacts.map(String) : [],
        // v1.6: 拓扑依赖透传（depends_on / dependsOn / parallel_group）
        depends_on: Array.isArray(raw && raw.depends_on)
          ? raw.depends_on.map((d) => String(d))
          : Array.isArray(raw && raw.dependsOn)
            ? raw.dependsOn.map((d) => String(d))
            : [],
        parallel_group: (raw && raw.parallel_group) ? String(raw.parallel_group) : null,
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
        if (data && Array.isArray(data.steps)) return { exprId, currentStep: data.currentStep || null, status: data.status || 'open', phase: data.phase || (data.steps.length ? 'executing' : 'planning'), architectNotes: data.architectNotes || null, contextRequests: Array.isArray(data.contextRequests) ? data.contextRequests : [], steps: data.steps, updatedAt: data.updatedAt, autoReview: data.autoReview === true, stopReason: data.stopReason || null, stoppedAt: data.stoppedAt || null, finalized: data.finalized === true, finalizedAt: data.finalizedAt || null, finalSummary: data.finalSummary || null, protocolVersion: data.protocolVersion || 'v1.5', activeSteps: Array.isArray(data.activeSteps) ? data.activeSteps : [] }
      } catch (err) { /* no state yet */ }
      return { exprId, steps: [], currentStep: null, status: 'open', phase: 'planning', architectNotes: null, contextRequests: [], autoReview: false, stopReason: null, stoppedAt: null, finalized: false, finalizedAt: null, finalSummary: null, protocolVersion: 'v1.5', activeSteps: [] }
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

  // ---------- routes ----------
  const statusHandler = (req, res) => {
    if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
    const mem = process.memoryUsage()
    json(res, 200, {
      ok: true,
      geminiConfigured: Boolean(GEMINI_KEY),
      model: GEMINI_MODEL,
      version: '1.0.0',
      shellAvailable: Boolean(shell),
      apiProxyAvailable: Boolean(apiProxy),
      uptime: Math.round(process.uptime()),
      memoryUsage: Math.round(mem.rss / 1024 / 1024) // MB
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
      const protocolVersion = payload.protocolVersion === 'v1.6' ? 'v1.6' : 'v1.5'

    if (!provider) return json(res, 400, { ok: false, error: 'missing provider' })

    let providerLabel = provider
    let answer = ''

    try {
      if (provider === 'gemini-free') {
        providerLabel = 'Gemini Free API'
        if (!GEMINI_KEY) return json(res, 400, { ok: false, error: 'GEMINI_API_KEY 未配置；设置环境变量后重启 dsh web 再试。' })
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
        const r = await callGemini(guidedPrompt)
        if (!r.ok) return json(res, 502, r)
        answer = r.text
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
        base, safePolicy, prompt, answer, channel: provider === 'gemini-free' ? 'gemini-free' : 'manual',
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
        if (phase || parsedSteps.length > 0) {
          try {
            await writeStepState(base, id, {
              exprId: id,
              currentStep: null,
              status: 'open',
                phase,
                architectNotes: (planning && (planning.architect_notes || planning.architectNotes)) || null,
                contextRequests: (planning && Array.isArray(planning.context_requests)) ? planning.context_requests : [],
              autoReview: provider === 'gemini-free',
              protocolVersion,
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
              protocolVersion === 'v1.6' && parsedSteps.length > 0 ? `【协议版本】v1.6 并发调度：按步骤 depends_on / parallel_group 依赖门控执行；依赖满足的多个步骤可并行（建议 subagent 并发），每步完成后独立置为 review 等待审核。` : '',
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
    return records.sort((a, b) => (a.file < b.file ? 1 : a.file > b.file ? -1 : 0))
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
      const records = (await listRecordSummaries(base)).slice(0, 3)
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
        en: {
          protocol: { version: WEB_RELAY_PROTOCOL_VERSION, text: WEB_RELAY_PROTOCOL_EN },
          skill: { name: 'web_relay_external_ai_protocol', version: WEB_RELAY_PROTOCOL_VERSION, text: WEB_RELAY_EXTERNAL_AI_SKILL_EN },
          protocolV15: { version: WEB_RELAY_PROTOCOL_VERSION, text: WEB_RELAY_PROTOCOL_EN },
          protocolV16: { version: WEB_RELAY_PROTOCOL_VERSION_V16, text: WEB_RELAY_PROTOCOL_EN }
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
      const protocolVersion = payload.protocolVersion === 'v1.6' ? 'v1.6' : 'v1.5'
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
      const protocolVersion = payload.protocolVersion === 'v1.6' ? 'v1.6' : 'v1.5'
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
              protocolVersion === 'v1.6' ? '【v1.6 并发调度】本任务为并发模式：按步骤 depends_on / parallel_group 依赖门控执行，依赖满足的多个步骤可并行（建议 subagent 并发），每步完成后独立置为 review 等待审核。' : '',
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
          try { stepState = await writeStepState(base, id, { exprId: id, steps, currentStep: null, status: 'open', autoReview: payload.autoReview === true, protocolVersion }, safePolicy) } catch (err) { stepState = null }
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
            protocolVersion === 'v1.6' ? '【v1.6 并发调度】本任务为并发模式：按步骤 depends_on / parallel_group 依赖门控执行，依赖满足的多个步骤可并行（建议 subagent 并发），每步完成后独立置为 review 等待审核。' : '',
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
          if (state.protocolVersion === 'v1.6' || hasDeps) {
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
        if (action === 'start') {
          step.status = 'executing'
          state.currentStep = step.id   // v1.0.1: 最近激活步骤（v1.6 并行时 activeSteps 为完整集合）
          state.activeSteps = state.activeSteps || []
          if (!state.activeSteps.some((x) => String(x) === String(step.id))) state.activeSteps.push(String(step.id))
          traceText = `开始执行 Step ${step.id}：${step.title}`
        } else if (action === 'complete') {
          step.status = 'review'
          state.currentStep = step.id
          traceText = `Step ${step.id} 已完成，待外部 AI 审核：${step.title}\n${comment}`
        } else if (action === 'approve') {
          step.status = 'approved'
          step.reviewedBy = 'manual'   // v1.5：手动审核路径
          state.activeSteps = (state.activeSteps || []).filter((x) => String(x) !== String(step.id))
          traceText = `用户手动审核通过 Step ${step.id}：${step.title}\n${comment}`
        } else if (action === 'reject') {
          step.status = 'rejected'
          step.reviewedBy = 'manual'   // v1.5：手动审核路径
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
            if (state.protocolVersion === 'v1.6') {
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
          }

        json(res, 200, { ok: true, stepState: updated, step: updated.steps.find((s) => String(s.id) === String(stepId)), wake, handoffText })
      } catch (err) {
        json(res, 500, { ok: false, error: String(err?.message || err) })
      }
    }


    // POST /dsh-web-relay/steps/auto-review
    // body { workspacePath?, exprId, stepId? } → auto-call external AI for a review-step.
    const autoReviewHandler = async (req, res) => {
      try {
        if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
        const payload = JSON.parse((await readBody(req)) || '{}')
        const exprId = typeof payload.exprId === 'string' ? payload.exprId.trim() : ''
        const stepId = payload.stepId != null ? String(payload.stepId) : ''
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : ''
        if (!TRACE_ID_RE.test(exprId)) return json(res, 400, { ok: false, error: 'invalid exprId' })

        const base = baseOf(payload.workspacePath)
        const safePolicy = safePolicyFor(base)
        const state = await readStepState(base, exprId)
        if (!state.steps || state.steps.length === 0) return json(res, 400, { ok: false, error: 'no steps found' })
        if (state.status === 'stopped') return json(res, 400, { ok: false, error: '任务已停止，不能自动审核' })

        const step = (stepId ? state.steps.find((s) => String(s.id) === String(stepId)) : null)
          || state.steps.find((s) => s.status === 'review')
          || null
        if (!step) return json(res, 404, { ok: false, error: 'no review step found' })
        if (step.status !== 'review') return json(res, 400, { ok: false, error: `Step ${step.id} 不在 review 状态，不能自动审核` })

        // v1.5 状态锁：8 秒内同一 Step 拒绝重复审核/唤醒
        if (!lockReview(`${exprId}:${step.id}`)) {
          return json(res, 200, { ok: true, skipped: true, error: '该步骤正在审核中，请勿重复触发' })
        }

        // 审核上下文：任务记录 + 三方轨迹
        const recordPath = `${EXPERIMENTS_DIR}/dsh-web-relay-${exprId.slice(5)}.md`
        const recordTarget = await fs.resolve(recordPath, { cwd: base })
        const recordText = await fs.readText(recordTarget).catch(() => '')
        const trace = await loadTrace(base, exprId)
        const traceText = (trace.entries || [])
          .map((e) => `[${ROLE_LABEL[e.role] || e.role}] ${e.text}`)
          .join('\n')

        // ---- v1.5 三级降级链：外部AI → 对话模型(无工具) → 手动 ----
        let reviewer = 'external'   // external | dialog | manual
        let fallbackReason = ''
        let r = { ok: false }
        let prompt = ''

        if (GEMINI_KEY) {
          prompt = buildReviewPrompt(exprId, step, recordText, traceText, '外部 AI（Gemini）')
          r = await callGemini(prompt)
          if (r.ok) reviewer = 'external'
          else fallbackReason = r.error
        } else {
          fallbackReason = 'GEMINI_API_KEY 未配置'
        }

        if (!r.ok) {
          prompt = buildReviewPrompt(exprId, step, recordText, traceText, '对话模型（无工具）')
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
          return json(res, 200, {
            ok: true,
            manual: true,
            fallbackReason,
            exprId,
            stepId: String(step.id),
            step: { id: step.id, title: step.title, detail: step.detail, acceptance: step.acceptance },
            traceText: clip(traceText, 3000)
          })
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

        // v1.5 审核来源
        step.reviewedBy = reviewer
        // v1.0.1: 审核（通过/打回）后从 activeSteps 移除该步（v1.6 并行集合同步）
        state.activeSteps = (state.activeSteps || []).filter((x) => String(x) !== String(step.id))
        if (state.steps.every((s) => s.status === 'approved')) state.status = 'done'

        step.notes = step.notes || []
        step.notes.push({ role, at: new Date().toISOString(), action: result, text: reason, reviewedBy: reviewer })
        const updated = await writeStepState(base, exprId, state, safePolicy)
        await appendTrace({ base, safePolicy, exprId, entries: [traceEntry(role, traceTextEntry)] }).catch(() => {})

        // After an approved step, wake the main agent to continue with the next pending step(s).
        // v1.6 并发唤醒：approved 后计算就绪步骤（可能有多个）→ 输出并发清单；就绪为 0 或 v1.5 保持线性找下一步 / done 收口。
        let wake = null
        let nextStep = null
        let nextSteps = null
        let handoffText = null
        if (result === 'approved') {
          const idx = updated.steps.findIndex((s) => String(s.id) === String(step.id))
          const ready = state.protocolVersion === 'v1.6' ? readySteps(state) : []
          if (ready.length > 0) {
            // v1.6：就绪步骤 ≥ 1 → 并发清单唤醒
            nextSteps = ready
            nextStep = ready[0]
            const readyList = ready.map((s) => `Step ${s.id}（${s.parallel_group ? `组${s.parallel_group}` : '无组/串行'}）`).join('、')
            const readyIds = new Set(ready.map((s) => String(s.id)))
            const waitingList = (state.steps || [])
              .filter((s) => s.status !== 'approved' && !readyIds.has(String(s.id)))
              .map((s) => {
                const missing = blockedWaitingFor(s, state)
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
            if (updated.protocolVersion === 'v1.6') {
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
                return json(res, 200, {
                  ok: true,
                  stepState: updated,
                  step: updated.steps.find((s) => String(s.id) === String(step.id)),
                  reviewedBy: reviewer,
                  reviewerLabel,
                  waitingFor: notDone.map((s) => s.id),
                  wake,
                  handoffText
                })
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
              handoffText = [
                '【主 agent 请协助】dsh-web-relay 自动审核已完成全部步骤，请收口',
                '',
                `任务: ${exprId}`,
                '全部 Step 已 approved，整体状态 done。',
                '',
                '请完成最终收口：确认 steps.json 与任务记录状态为 done，并将最终结论追加到三方轨迹。'
              ].join('\n')
              if (sessionId) {
                wake = await wakeMainAgent({ sessionId, handoffText })
              }
              await appendTrace({ base, safePolicy, exprId, entries: [traceEntry('mainagent', handoffText)] }).catch(() => {})
            }
          }
        } else if (result === 'rejected') {
          handoffText = [
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
        }

        json(res, 200, {
          ok: true,
          stepState: updated,
          step: updated.steps.find((s) => String(s.id) === String(step.id)),
          reviewedBy: reviewer,
          reviewerLabel,
          nextStep,
          readySteps: nextSteps ? nextSteps.map((s) => s.id) : [],
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
  const protocolHandler = async (req, res) => {
    if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
    json(res, 200, {
      ok: true,
      version: WEB_RELAY_PROTOCOL_VERSION,
      text: WEB_RELAY_PROTOCOL,
      skill: { name: 'web_relay_external_ai_protocol', version: WEB_RELAY_PROTOCOL_VERSION, text: WEB_RELAY_EXTERNAL_AI_SKILL },
      protocolV15,
      protocolV16,
      en: {
        protocol: { version: WEB_RELAY_PROTOCOL_VERSION, text: WEB_RELAY_PROTOCOL_EN },
        skill: { name: 'web_relay_external_ai_protocol', version: WEB_RELAY_PROTOCOL_VERSION, text: WEB_RELAY_EXTERNAL_AI_SKILL_EN },
        protocolV15: { version: WEB_RELAY_PROTOCOL_VERSION, text: WEB_RELAY_PROTOCOL_EN },
        protocolV16: { version: WEB_RELAY_PROTOCOL_VERSION_V16, text: WEB_RELAY_PROTOCOL_EN }
      }
    })
  }

  ctx.effect(() => webServer.register({ kind: 'exact', path: '/dsh-web-relay/status', handler: statusHandler }), 'dsh-web-relay/status')
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
}
