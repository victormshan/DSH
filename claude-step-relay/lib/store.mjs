// 文件存储层：Step List + 三方轨迹，纯文件读写，不含任何审核/调度逻辑。
import fs from 'node:fs'
import path from 'node:path'

const BASE_DIR = process.env.STEP_RELAY_DIR
  ? path.resolve(process.env.STEP_RELAY_DIR)
  : path.resolve(process.cwd(), 'step-relay')

const EXPR_DIR = path.join(BASE_DIR, 'experiments')
const TRACE_DIR = path.join(BASE_DIR, 'traces')

const VALID_STATUS = new Set(['pending', 'executing', 'done', 'blocked'])

// 外部审核记录只能由 review-gate（独立系统用户）写入它自己的文件：
// <REVIEW_GATE_TRACE_DIR>/<exprId>.gate.md。这里拒绝其他人用这些角色写轨迹，
// 读轨迹时再把审核门的文件按时间合并进来。
export const RESERVED_ROLE_PREFIXES = ['外部审核', 'review-gate']
const GATE_TRACE_DIR = path.resolve(process.env.REVIEW_GATE_TRACE_DIR || '/var/lib/reviewgate/relay/traces')

export function isReservedRole(role) {
  const r = String(role ?? '').normalize('NFKC').trim().toLowerCase()
  return RESERVED_ROLE_PREFIXES.some((p) => r.startsWith(p.toLowerCase()))
}

function ensureDirs() {
  fs.mkdirSync(EXPR_DIR, { recursive: true })
  fs.mkdirSync(TRACE_DIR, { recursive: true })
}

function tsId() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

function exprPath(exprId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(exprId)) throw new Error(`invalid exprId: ${exprId}`)
  return path.join(EXPR_DIR, `${exprId}.json`)
}

function tracePath(exprId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(exprId)) throw new Error(`invalid exprId: ${exprId}`)
  return path.join(TRACE_DIR, `${exprId}.md`)
}

export function createExperiment({ title, prompt }) {
  if (!title || !title.trim()) throw new Error('title is required')
  ensureDirs()
  let exprId = tsId()
  while (fs.existsSync(exprPath(exprId))) {
    exprId = tsId() + '-' + Math.random().toString(36).slice(2, 6)
  }
  const now = new Date().toISOString()
  const data = {
    exprId,
    title,
    prompt: prompt || '',
    status: 'open',
    steps: [],
    createdAt: now,
    updatedAt: now
  }
  fs.writeFileSync(exprPath(exprId), JSON.stringify(data, null, 2))
  fs.writeFileSync(tracePath(exprId), `# ${title}\n\nexprId: ${exprId}\n创建时间: ${now}\n\n---\n\n`)
  if (prompt) appendTrace(exprId, '用户', prompt)
  return data
}

export function readExperiment(exprId) {
  const p = exprPath(exprId)
  if (!fs.existsSync(p)) throw new Error(`experiment not found: ${exprId}`)
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function writeExperiment(data) {
  data.updatedAt = new Date().toISOString()
  fs.writeFileSync(exprPath(data.exprId), JSON.stringify(data, null, 2))
  return data
}

export function setSteps(exprId, steps) {
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('steps must be a non-empty array')
  const data = readExperiment(exprId)
  const now = new Date().toISOString()
  data.steps = steps.map((s, i) => ({
    id: s.id ?? i + 1,
    title: s.title,
    detail: s.detail || '',
    acceptance: s.acceptance || '',
    status: 'pending',
    note: '',
    updatedAt: now
  }))
  writeExperiment(data)
  appendTrace(
    exprId,
    'Claude',
    `拆分 Step List（共 ${data.steps.length} 步）：\n` + data.steps.map((s) => `${s.id}. ${s.title}`).join('\n')
  )
  return data
}

export function updateStep(exprId, stepId, status, note) {
  if (!VALID_STATUS.has(status)) throw new Error(`invalid status: ${status}`)
  const data = readExperiment(exprId)
  const step = data.steps.find((s) => String(s.id) === String(stepId))
  if (!step) throw new Error(`step not found: ${stepId}`)
  step.status = status
  if (note) step.note = note
  step.updatedAt = new Date().toISOString()
  writeExperiment(data)
  appendTrace(exprId, 'Claude', `Step ${stepId}「${step.title}」→ ${status}${note ? '\n' + note : ''}`)
  return data
}

export function appendTrace(exprId, role, text) {
  ensureDirs()
  if (!fs.existsSync(tracePath(exprId))) throw new Error(`experiment not found: ${exprId}`)
  if (isReservedRole(role)) {
    throw new Error(`role "${role}" is reserved: external review entries are written only by review-gate`)
  }
  if (/[\r\n\[\]]/.test(String(role))) throw new Error('role must be a single line without brackets')
  const ts = new Date().toISOString()
  // 正文里形如 "## [时间] [角色]" 的行会被当成新条目，转义掉，防止伪造条目头。
  const body = String(text ?? '').replace(/^(#+ \[)/gm, '\\$1')
  const entry = `## [${ts}] [${role}]\n\n${body}\n\n`
  fs.appendFileSync(tracePath(exprId), entry)
  return true
}

export function getState(exprId) {
  return readExperiment(exprId)
}

export function listExperiments() {
  ensureDirs()
  const files = fs.readdirSync(EXPR_DIR).filter((f) => f.endsWith('.json'))
  return files
    .map((f) => {
      const data = JSON.parse(fs.readFileSync(path.join(EXPR_DIR, f), 'utf8'))
      const total = data.steps.length
      const done = data.steps.filter((s) => s.status === 'done').length
      return {
        exprId: data.exprId,
        title: data.title,
        status: data.status,
        progress: `${done}/${total}`,
        updatedAt: data.updatedAt
      }
    })
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export function finalize(exprId, summary) {
  const data = readExperiment(exprId)
  data.status = 'done'
  writeExperiment(data)
  appendTrace(exprId, 'Claude', `任务收口：\n${summary}`)
  return data
}

const ENTRY_HEAD = /^## \[([^\]\n]+)\] \[([^\]\n]+)\]$/gm

// 把轨迹拆成 { head, entries: [{ ts, role, text }] }。
function parseTrace(md) {
  const heads = [...md.matchAll(ENTRY_HEAD)]
  const head = heads.length ? md.slice(0, heads[0].index) : md
  const entries = heads.map((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : md.length
    return { ts: m[1], role: m[2], text: md.slice(m.index + m[0].length, end).replace(/^\n+|\n+$/g, '') }
  })
  return { head, entries }
}

export function gateTracePath(exprId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(exprId)) throw new Error(`invalid exprId: ${exprId}`)
  return path.join(GATE_TRACE_DIR, `${exprId}.gate.md`)
}

// 三方轨迹：Claude/用户写的主文件 + review-gate 写的审核文件，按时间合并。
// 主文件里出现的保留角色条目（比如直接改文件伪造的）会被标注为未经审核门签发；
// 审核门文件里非保留角色的“条目头”（审核文本里碰巧出现的）并回上一条正文。
export function readTrace(exprId) {
  const p = tracePath(exprId)
  if (!fs.existsSync(p)) throw new Error(`trace not found: ${exprId}`)
  const main = parseTrace(fs.readFileSync(p, 'utf8'))
  const entries = main.entries.map((e, i) => ({
    ...e,
    order: i,
    role: isReservedRole(e.role) ? `${e.role}（未经审核门签发，不可信）` : e.role
  }))
  const gp = gateTracePath(exprId)
  if (fs.existsSync(gp)) {
    const gate = []
    for (const e of parseTrace(fs.readFileSync(gp, 'utf8')).entries) {
      if (isReservedRole(e.role) || !gate.length) gate.push({ ...e })
      else gate[gate.length - 1].text += `\n\n\\## [${e.ts}] [${e.role}]\n\n${e.text}`
    }
    gate.forEach((e, i) => entries.push({ ...e, order: main.entries.length + i }))
  }
  entries.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.order - b.order))
  return main.head + entries.map((e) => `## [${e.ts}] [${e.role}]\n\n${e.text}\n\n`).join('')
}

export const __paths = { BASE_DIR, EXPR_DIR, TRACE_DIR, GATE_TRACE_DIR }
