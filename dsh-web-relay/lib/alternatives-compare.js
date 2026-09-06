// dsh-web-relay · v4.9/v2.0 多方案比较裁决模块（alternatives）
// 职责：为含 alternatives 的 Step 构建「6 段式对比评审 Prompt」（纯函数），
// 并把外部 AI 的择优回复解析为结构化 decision。
// 本模块为纯函数、无副作用，便于镜像单测（与 swarm-prompts.js 同风格）。
// 输出 JSON 约定：
//   { "chosen": <number|string>, "rationale": "<中文理由>",
//     "scores": [ { "index": 0, "score": 8, "pros": "...", "cons": "..." } ] }
//   chosen 可以是 alternatives 数组下标（0-based number）或该方案 name（string）。

const clip = (s, n) => {
  const t = String(s || '')
  return t.length > n ? t.slice(0, n) + '…(截断)' : t
}

/**
 * 规范化 alternatives 列表（容错：非数组→[]；元素非对象→字符串包装）。
 * @param {unknown} alts
 * @returns {Array<{name: string, summary: string, pros: string, cons: string, [k:string]: unknown}>}
 */
export function normalizeAlternatives(alts) {
  if (!Array.isArray(alts)) return []
  return alts
    .map((a, i) => {
      if (a && typeof a === 'object' && !Array.isArray(a)) {
        return {
          name: String(a.name ?? `方案${i + 1}`),
          summary: String(a.summary ?? a.detail ?? ''),
          pros: String(a.pros ?? a.advantage ?? ''),
          cons: String(a.cons ?? a.disadvantage ?? a.risk ?? ''),
          ...a
        }
      }
      return { name: `方案${i + 1}`, summary: String(a ?? ''), pros: '', cons: '' }
    })
}

/**
 * 构建 6 段式 alternatives 对比评审 Prompt（v2.0，D 方向模板增强落地）。
 * 段：①角色与任务 ②Step/验收 ③候选方案逐项 ④执行证据（notes+artifacts）
 *     ⑤任务记录+三方轨迹 ⑥决策输出要求（严格 JSON）。
 * @param {object} p
 * @param {string} p.exprId
 * @param {object} p.step 含 id/title/detail/acceptance/notes/alternatives/artifacts
 * @param {string} [p.recordText]
 * @param {string} [p.traceText]
 * @param {string} [p.artifactsSummary]
 * @returns {string}
 */
export function buildAlternativesReviewPrompt({ exprId, step, recordText, traceText, artifactsSummary }) {
  const alts = normalizeAlternatives(step && step.alternatives)
  const altLines = alts.length
    ? alts.map((a, i) => {
        const bits = [`[${i}] ${a.name}`]
        if (a.summary) bits.push(`概述：${a.summary}`)
        if (a.pros) bits.push(`优点：${a.pros}`)
        if (a.cons) bits.push(`缺点/风险：${a.cons}`)
        return bits.join('\n')
      }).join('\n\n')
    : '（无候选方案）'
  const notes = Array.isArray(step && step.notes) ? step.notes : []
  const evidence = notes.length
    ? notes.slice(-6).map((n) => `- [${n.action}](${n.role || '?'} @ ${n.at || ''}) ${clip(n.text, 600)}`).join('\n')
    : '（无 notes 执行记录）'
  return [
    '你是 dsh-web-relay 的方案裁决员。请针对当前 Step 的多套候选方案（alternatives）做对比评审，依据验收标准与执行证据择优。',
    '',
    `任务 ID：${exprId}`,
    `Step ID：${step && step.id}`,
    `标题：${(step && step.title) || '(无)'}`,
    `详情：${(step && step.detail) || '(无)'}`,
    `验收标准：${(step && step.acceptance) || '(无)'}`,
    '',
    '【候选方案逐项（③）】',
    altLines,
    '',
    '【执行证据（④）】',
    evidence,
    '',
    artifactsSummary ? `【产物摘要（④）】\n${clip(artifactsSummary, 4000)}` : '',
    '',
    '【任务记录摘要（⑤）】',
    clip(recordText || '(无)', 3000),
    '',
    '【三方轨迹（⑤）】',
    clip(traceText || '(无)', 3000),
    '排序说明：三方轨迹按时间正序，最新在末尾，请优先关注末尾最新状态。',
    '',
    '【决策要求（⑥）】',
    '请逐方案打分（0-10）并对比优劣，依据验收标准给出推荐。只回复一个 JSON（不要代码块围栏），格式：',
    '{"chosen": <推荐方案的下标数字 或 其 name 字符串>, "rationale": "<中文裁决理由，说明为何该方案最优、其他方案为何落选>", "scores": [{"index": 0, "score": 8, "pros": "…", "cons": "…"}]}',
    '若某方案明显不符合验收标准，score 应低并说明原因；不得推荐无意义方案。'
  ].filter(Boolean).join('\n')
}

/**
 * 解析外部 AI 的择优回复 → { ok, decision, error }。
 * 严格 JSON 优先（取首个 {…} 对象）；宽松兜底：按 “方案N/chosen” 文本猜测。
 * @param {string} text
 * @param {unknown[]} [alts] 候选数组（用于 name→index 归一）
 * @returns {{ok: boolean, decision: object|null, error: string|null}}
 */
export function parseAlternativesDecision(text, alts) {
  const src = String(text || '').trim()
  if (!src) return { ok: false, decision: null, error: '空回复' }
  let obj = null
  const m = src.match(/\{[\s\S]*\}/)
  if (m) {
    try { obj = JSON.parse(m[0]) } catch { obj = null }
  }
  if (!obj) return { ok: false, decision: null, error: '无法解析为 JSON 对象' }
  const normalized = normalizeAlternatives(alts)
  let chosen = obj.chosen ?? obj.choice ?? obj.decision ?? obj.recommend ?? null
  let chosenIndex = null
  if (typeof chosen === 'number' && Number.isFinite(chosen)) {
    chosenIndex = chosen
  } else if (typeof chosen === 'string') {
    const named = normalized.findIndex((a) => String(a.name).trim() === chosen.trim())
    if (named >= 0) chosenIndex = named
    else {
      const byIdx = chosen.match(/^\s*(\d+)\s*$/)
      if (byIdx) chosenIndex = Number(byIdx[1])
    }
  }
  const scores = Array.isArray(obj.scores)
    ? obj.scores.map((s) => ({
        index: Number.isFinite(Number(s && s.index)) ? Number(s.index) : null,
        score: Number.isFinite(Number(s && s.score)) ? Number(s.score) : null,
        pros: String((s && s.pros) || ''),
        cons: String((s && s.cons) || '')
      }))
    : []
  const decision = {
    chosen: chosenIndex != null && chosenIndex >= 0 && chosenIndex < normalized.length
      ? chosenIndex
      : (typeof chosen === 'string' ? chosen : null),
    chosenName: chosenIndex != null && chosenIndex >= 0 && chosenIndex < normalized.length
      ? normalized[chosenIndex].name
      : (typeof chosen === 'string' ? chosen : null),
    rationale: String(obj.rationale || obj.reason || obj.why || ''),
    scores,
    raw: clip(src, 1000)
  }
  return { ok: decision.chosen != null, decision, error: decision.chosen == null ? '无法定位 chosen（越界或缺失）' : null }
}
