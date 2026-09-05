// dsh-web-relay · v3.8 Step3 回滚后步骤状态复位策略（纯函数模块，lib/rollback-state.js）
// 背景：POST /steps/rollback 成功执行 git reset 到迭代基线后，代码已回到基线，
// 该基线之后产出的 approved/executing/review 步骤不再代表当前代码状态，需要复位。
// 策略（trace 记录版）：
//   approved / executing / review → pending（可重跑重审；历史 notes 与产物保留，仅追加 reset 说明）
//   rejected                     → 原样保留（拒绝历史与证据不清理；需要时 reopen 重提）
//   pending                      → 原样保留
//   门禁自然重算：finalize 要求全部 approved，复位后未全部 approved → 收口自动解锁为可再次执行
//   （rollback 是显式用户动作，允许改状态，与 restructure 的 approved 保留语义不冲突）
// 非 git 降级 / 缺基线：不改步骤状态，仅落盘标记（rollbackDegraded / 400 不落盘）。

const RESET_FROM = ['approved', 'executing', 'review']

// 计划：返回将复位的步骤清单 [{ id, from }]
export function planRollbackReset(state) {
  const steps = Array.isArray(state && state.steps) ? state.steps : []
  return steps.filter((s) => RESET_FROM.includes(s.status)).map((s) => ({ id: String(s.id), from: s.status }))
}

// 执行：就地修改 state（调用方持有 readStepState 的新对象）并返回摘要
export function applyRollbackReset(state, { base } = {}) {
  const affected = planRollbackReset(state)
  const now = new Date().toISOString()
  const baseShort = String(base || '').slice(0, 12)
  for (const { id, from } of affected) {
    const s = state.steps.find((x) => String(x.id) === id)
    if (!s) continue
    s.status = 'pending'
    s.reviewedBy = null // 与 v1.8.1 打回清空审核来源一致：pending 不代表曾被外部审核过
    s.notes = s.notes || []
    s.notes.push({ role: 'mainagent', at: now, action: 'reset', text: `v3.8 rollback：代码已回退到基线 ${baseShort}，本步由 ${from} 复位为 pending（历史 notes/产物保留，待重跑重审）` })
  }
  state.status = 'open' // 解除 done（若曾全部 approved）
  state.currentStep = (state.steps.find((s) => s.status === 'pending') || {}).id || null
  state.activeSteps = [] // executing 注册清空（复位后从 pending 重新 start）
  state.incrementalStreak = 0
  state.rolledBackAt = now
  state.rollbackBase = String(base || '') || null
  state.rollbackSteps = affected.length
  state.rollbackDegraded = null // 清除旧的降级标记（本次为成功回滚）
  return { state, count: affected.length, affected }
}

// 降级标记：非 git 工作区无法物理回滚 → 只落盘标记，不动步骤
export function markRollbackDegraded(state, reason) {
  state.rollbackDegraded = { at: new Date().toISOString(), reason: String(reason || '').slice(0, 400) }
  return state
}
