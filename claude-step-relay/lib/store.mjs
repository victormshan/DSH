// 文件存储层：Step List + 三方轨迹，纯文件读写，不含任何审核/调度逻辑。
import fs from 'node:fs'
import path from 'node:path'

const BASE_DIR = process.env.STEP_RELAY_DIR
  ? path.resolve(process.env.STEP_RELAY_DIR)
  : path.resolve(process.cwd(), 'step-relay')

const EXPR_DIR = path.join(BASE_DIR, 'experiments')
const TRACE_DIR = path.join(BASE_DIR, 'traces')

const VALID_STATUS = new Set(['pending', 'executing', 'done', 'blocked'])

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
  const ts = new Date().toISOString()
  const entry = `## [${ts}] [${role}]\n\n${text}\n\n`
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

export function readTrace(exprId) {
  const p = tracePath(exprId)
  if (!fs.existsSync(p)) throw new Error(`trace not found: ${exprId}`)
  return fs.readFileSync(p, 'utf8')
}

export const __paths = { BASE_DIR, EXPR_DIR, TRACE_DIR }
