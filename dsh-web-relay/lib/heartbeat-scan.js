// dsh-web-relay · v4.9.2 心跳自查信号扫描（lib/heartbeat-scan.js）
// 纯函数：给定 expr 状态数组，判定「需要主 agent 新一轮检查」的信号集（无副作用，便于单测）。
// 双保险续跑：机制 a = 重启事件驱动（bootResumeScan 注入）；机制 b = 本模块时间驱动（宿主周期心跳）——
// 覆盖非重启场景的停滞：review 待审未触发、rejected 待重提、executing 长时间无进展、续跑熔断需介入汇报。

/**
 * 判定单个 expr 的待办信号。
 * @param {object} st expr state（readStepState 输出；含 exprId/status/autoReview/steps/updatedAt/stopReason 等）
 * @param {object} [opts]
 * @param {number} [opts.staleMs=1200000] executing 停滞阈值（默认 20 分钟）
 * @param {number} [opts.maxAgeMs=0] 陈旧过滤：updatedAt 早于 now-maxAgeMs 的 expr 视为历史僵尸，不产生任何信号（0=不过滤）
 * @param {number} [opts.now=Date.now()]
 * @returns {{exprId: string, signals: string[], detail: string[]}} signals 空 = 无需 agent 介入
 */
export function scanExprSignals(st, { staleMs = 1200000, maxAgeMs = 0, now = Date.now() } = {}) {
  if (!st || !st.exprId) return { exprId: '', signals: [], detail: [] }
  const signals = []
  const detail = []
  const steps = Array.isArray(st.steps) ? st.steps : []
  // 陈旧过滤：心跳场景避免把数周前的遗留 expr 当待办刷屏（其状态多为历史残留，agent 无需介入）
  if (maxAgeMs > 0) {
    const updated = st.updatedAt ? new Date(st.updatedAt).getTime() : 0
    if (updated > 0 && now - updated > maxAgeMs) return { exprId: st.exprId, signals, detail }
  }

  // ① 续跑熔断 paused（stopReason 含「续跑熔断」）——设计上需用户/agent 介入汇报根因
  if (st.status === 'paused' && /续跑熔断|熔断/.test(st.stopReason || '')) {
    signals.push('resume-circuit-paused')
    detail.push(`任务 paused（${st.stopReason}）——需介入：确认根因后 resume 或收口`)
  }

  // ② review 状态步骤待审（autoReview 开启但尚未触发 /steps/auto-review）
  const reviewSteps = steps.filter((s) => s.status === 'review')
  if (reviewSteps.length > 0) {
    signals.push('review-pending')
    detail.push(`有 ${reviewSteps.length} 步待审核：${reviewSteps.map((s) => `Step ${s.id} ${s.title}`).join('、')}——请触发 /steps/auto-review（或手动审）`)
  }

  // ③ rejected 步骤待重提（被打回未重新提交）
  const rejectedSteps = steps.filter((s) => s.status === 'rejected')
  if (rejectedSteps.length > 0) {
    signals.push('rejected-pending')
    detail.push(`有 ${rejectedSteps.length} 步被打回待重提：${rejectedSteps.map((s) => `Step ${s.id}`).join('、')}——请按拒收意见补证据后 reopen→start→complete 重提`)
  }

  // ④ executing 停滞（updatedAt 早于阈值，agent 可能断线未续）
  if (st.status === 'executing') {
    const updated = st.updatedAt ? new Date(st.updatedAt).getTime() : 0
    const execSteps = steps.filter((s) => s.status === 'executing')
    if (updated > 0 && now - updated > staleMs && (execSteps.length > 0 || (Array.isArray(st.activeSteps) && st.activeSteps.length > 0))) {
      signals.push('executing-stale')
      detail.push(`任务 executing 停滞（updatedAt ${st.updatedAt}，超过 ${Math.round(staleMs / 60000)} 分钟无进展）——请检查是否断线：git 残改检查后续跑或收口`)
    }
  }

  // ⑤ 全 approved 但未 finalize（可收口未收口）
  if (steps.length > 0 && steps.every((s) => s.status === 'approved') && st.status !== 'done' && !st.finalized) {
    signals.push('finalize-pending')
    detail.push('全部步骤已 approved 但任务未 finalize——请调 /steps/finalize 收口')
  }

  return { exprId: st.exprId, signals, detail }
}

/**
 * 批量扫描：给定 state 列表 → 有信号的 expr 数组（保持顺序）。
 * @param {Array<object>} states
 * @param {object} [opts]
 * @returns {Array<{exprId: string, signals: string[], detail: string[]}>}
 */
export function scanPendingSignals(states, opts) {
  const out = []
  for (const st of Array.isArray(states) ? states : []) {
    const r = scanExprSignals(st, opts)
    if (r.signals.length > 0) out.push(r)
  }
  return out
}
