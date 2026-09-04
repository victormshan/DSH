// dsh-web-relay · V3.2 多角色盲审 Swarm Prompt 模板与 Schema
// 职责：为 reviewOneStep 的 enableSwarm 模式提供 Security-Auditor 与 Refactoring-Architect
// 两个专职视角的评审 Prompt，以及共识合成规则（决策矩阵：双 Approve 才通过）。
// 本模块为纯数据/纯函数，无副作用，便于镜像测试。

export const SWARM_ROLES = {
  security: {
    id: 'security',
    label: 'Security-Auditor（安全审计）',
    focus: ['路径越界/任意文件读写', '资源泄露（句柄/内存/临时文件）', '鉴权与权限边界', '注入类风险（命令/路径/原型链）'],
    system: `你是 dsh-web-relay 的 Security-Auditor（安全审计员）。请只从**安全与边界**视角审核当前 Step 的产出。
专注检查（任一项命中即应 rejected）：
- 路径越界：文件路径可被外部输入控制逃逸工作区（../、绝对路径注入）
- 资源泄露：未释放的句柄、无界内存/磁盘占用、临时文件不清理
- 鉴权/权限：绕过权限检查、越权读写
- 注入风险：命令注入、路径注入、原型链污染
请忽略代码风格与重构类问题（那是 Refactoring-Architect 的职责）。`
  },
  refactor: {
    id: 'refactor',
    label: 'Refactoring-Architect（架构重构）',
    focus: ['代码耦合与模块边界', '异常处理完备性', '测试覆盖与断言质量', '性能与可维护性'],
    system: `你是 dsh-web-relay 的 Refactoring-Architect（架构重构评审员）。请只从**架构与质量**视角审核当前 Step 的产出。
专注检查（任一项命中即应 rejected）：
- 代码耦合：模块边界模糊、职责混乱、可测试性差
- 异常处理：缺 try/catch、错误被静默吞掉、无失败路径
- 测试完备性：缺关键断言、边界未覆盖、测试不可复现
- 性能与可维护性：明显低效实现、魔法数字、重复代码
请忽略安全类问题（那是 Security-Auditor 的职责）。`
  }
}

// 共识合成规则（决策矩阵）：双 Approve 才通过；任一 Reject → 整体 Rejected
export function swarmConsensus(securityVerdict, refactorVerdict) {
  const s = String(securityVerdict || '').toLowerCase()
  const r = String(refactorVerdict || '').toLowerCase()
  const sOk = s === 'approved'
  const rOk = r === 'approved'
  if (sOk && rOk) return { result: 'approved', summary: '双角色均通过（Security-Auditor ✓ + Refactoring-Architect ✓）' }
  if (!sOk && !rOk) return { result: 'rejected', summary: '双角色均打回（Security-Auditor ✗ + Refactoring-Architect ✗）' }
  return {
    result: 'rejected',
    summary: `单角色打回（${sOk ? 'Refactoring-Architect' : 'Security-Auditor'} ✗），双 Approve 才通过`
  }
}

// 角色 Review 结果解析（每角色输出 JSON：{"verdict":"approved"|"rejected","findings":["..."],"suggestion":"..."}）
export function parseRoleReview(text) {
  const src = String(text || '')
  try {
    const obj = JSON.parse(src)
    return {
      verdict: obj.verdict === 'approved' ? 'approved' : 'rejected',
      findings: Array.isArray(obj.findings) ? obj.findings.map(String).slice(0, 5) : [],
      suggestion: String(obj.suggestion || '')
    }
  } catch (err) {
    // 宽松匹配 verdict
    const v = /"verdict"\s*:\s*"(approved|rejected)"/.exec(src)
    return { verdict: v ? v[1] : 'rejected', findings: [], suggestion: '' }
  }
}

// 生成角色审核 Prompt（由 reviewOneStep 注入上下文）
export function buildRolePrompt(roleId, contextBlock, reviewer) {
  const role = SWARM_ROLES[roleId]
  if (!role) return ''
  return [
    role.system,
    '',
    `审核员：${reviewer}（${role.label}）`,
    '',
    contextBlock,
    '',
    '请只回复 JSON，格式：{"verdict":"approved" 或 "rejected","findings":["发现的问题1","问题2"],"suggestion":"改进建议"}',
    '注意：verdict 必须严格是 approved 或 rejected 二者之一。'
  ].join('\n')
}

// P2(v3.5.0): Swarm 启用策略——importance:high 默认开（未显式指定时）；显式 enableSwarm=true/false 优先。
// 返回 { enabled, hint, source }；hint 为成本提示文案（供面板展示）。
export function swarmEnablePolicy({ importance, enableSwarm } = {}) {
  const hint = 'Swarm 双角色盲审约 2× 审核成本（Security-Auditor + Refactoring-Architect）'
  if (enableSwarm === true) return { enabled: true, hint, source: 'explicit-on' }
  if (enableSwarm === false) return { enabled: false, hint: '', source: 'explicit-off' }
  if (String(importance) === 'high') return { enabled: true, hint, source: 'high-default' }
  return { enabled: false, hint: '', source: 'importance-not-high' }
}
