// dsh-web-relay · v4.0 宿主重启续跑（cross-restart resume）纯函数模块（lib/resume-scan.js）
// 语义（外部 AI expr-2026-09-05_13-35-19 设计）：续跑 = 重读落盘 steps.json + 触发新 turn，
// 不恢复 LLM 推理上下文。字段：sessionId（唤醒用）/ bootId（宿主进程标识，写盘打戳）/
// restartCount（同一任务跨重启续接次数，≥2 熔断 paused，防死循环）。

// 判定「跨宿主重启被中断」：状态忙（executing/review/activeSteps 非空）且 bootId ≠ 当前宿主 bootId（
// bootId 为空=旧版未打戳的 expr → 不误判）
export function isExprInterrupted(state, currentBootId) {
  if (!state || !currentBootId) return false
  const busy = state.status === 'executing' || state.status === 'review' || (Array.isArray(state.activeSteps) && state.activeSteps.length > 0)
  const crossBoot = !!state.bootId && state.bootId !== currentBootId
  return busy && crossBoot
}

// 续跑决策：none（未中断）/ resume（可续，restartCount+1）/ pause（restartCount ≥ maxRestarts 熔断）
export function resumeAction(state, currentBootId, { maxRestarts = 2 } = {}) {
  if (!isExprInterrupted(state, currentBootId)) return { action: 'none', restartCount: state.restartCount || 0 }
  const restartCount = (state.restartCount || 0) + 1
  if (restartCount >= maxRestarts) return { action: 'pause', restartCount }
  return { action: 'resume', restartCount }
}

// resume/pause 用的 handoff 文案（供 wakeMainAgent）
export function resumeHandoff(state, exprId) {
  const step = Array.isArray(state.steps) ? state.steps.find((s) => s.status === 'executing' || s.status === 'review') : null
  return [
    '【dsh-web-relay 宿主自愈重启 · 自动续跑】',
    '',
    `任务: ${exprId}`,
    `断点: ${state.status === 'review' ? '步骤审核中' : state.status === 'executing' ? '步骤执行中' : '有活动步骤'}${step ? `（Step ${step.id} ${step.title || ''}，状态 ${step.status}）` : ''}`,
    '宿主进程已重启（bootId 变化），步骤状态机已落盘保留。',
    '请读取 expr-*.steps.json 与最新三方轨迹，自动接管续跑：executing → 先 git 检查残改再续；review → 直接重触发 /steps/auto-review；全 approved → 直接收口。',
    'rejectStreak/iterationBaseCommit 跨重启保持，勿重置。'
  ].join('\n')
}
