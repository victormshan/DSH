// dsh-web-relay · P3(v3.5.0) Architect 突破度门禁（非阻断 warn）
// 纯函数模块，便于镜像测试。
// 语义（协议层）：每 2 个 Incremental 版本后，下一版应含 Structural/Paradigm 突破项。
// 版本级判定：一个版本的 steps 中任一含 structural/paradigm → 本版计为"突破"（重置连增）；
//             否则任一含 incremental → 本版计为 incremental（连增 +1）；均无（unknown）→ 不计不重置（防误报）。
// 提示级（warn），不阻断 restructure/plan。

const TYPE_LEVEL = { incremental: 1, structural: 2, paradigm: 3 }

// 取单个 step 的突破度类型（incremental/structural/paradigm），无法识别返回 null
export function breakthroughTypeOf(step) {
  if (!step) return null
  const raw = step.breakthrough_type
    || (step.architect_vision && step.architect_vision.breakthrough_type)
    || (step.architect && step.architect.breakthrough_type)
  if (raw == null) return null
  const v = String(raw).trim().toLowerCase()
  return TYPE_LEVEL[v] ? v : null
}

// 版本级突破类型：包含突破项→'breakthrough'；否则含 incremental→'incremental'；否则 null
export function versionTypeOf(steps) {
  const seq = Array.isArray(steps) ? steps : []
  let hasInc = false
  for (const s of seq) {
    const t = breakthroughTypeOf(s)
    if (t === 'structural' || t === 'paradigm') return 'breakthrough'
    if (t === 'incremental') hasInc = true
  }
  return hasInc ? 'incremental' : null
}

// 版本门禁：传入本版 steps 与历史连增 streak，返回 { streak, warn }
export function auditBreakthrough(steps, prevStreak = 0) {
  const vt = versionTypeOf(steps)
  let streak = Number(prevStreak) || 0
  if (vt === 'breakthrough') streak = 0
  else if (vt === 'incremental') streak += 1
  const warn = streak >= 2
    ? `Architect 突破度提示（P3）：连续 ${streak} 个版本为 Incremental 且无 Structural/Paradigm 突破项——协议建议每 2 个 Incremental 后下一版含突破项（warn 不阻断）`
    : null
  return { streak, warn }
}
