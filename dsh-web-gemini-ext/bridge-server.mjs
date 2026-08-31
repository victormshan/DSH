// dsh-relay Gemini 网页桥接中转服务器（油猴 PoC）
// 作用：主 agent 与 gemini.google.com 油猴脚本之间的消息中转（localhost:8899）
//   POST /create-task {prompt}        → 主 agent 发任务，返回 {id}
//   GET  /next-task                   → 油猴脚本轮询取任务（取到后置 processing）
//   POST /submit-answer {id, answer}  → 油猴脚本回传答案（置 done）
//   GET  /task-result/:id             → 主 agent 取结果
// 内存队列（PoC 够用）；CORS 全开（GM_xmlhttpRequest 本身绕过 CORS，双保险）。
import http from 'node:http'

const tasks = new Map() // id -> { id, prompt, status, answer, createdAt, completedAt }
let seq = 0

const json = (res, code, payload) => {
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  })
  res.end(JSON.stringify(payload))
}
const readBody = (req) => new Promise((resolve) => {
  let b = ''
  req.on('data', (c) => { b += c })
  req.on('end', () => resolve(b))
})

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  console.log(`[req] ${req.method} ${url.pathname}`)
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

  if (req.method === 'POST' && url.pathname === '/create-task') {
    const body = JSON.parse((await readBody(req)) || '{}')
    const prompt = String(body.prompt || '').trim()
    if (!prompt) return json(res, 400, { ok: false, error: 'missing prompt' })
    const id = 't' + String(++seq).padStart(4, '0')
    tasks.set(id, { id, prompt, status: 'pending', answer: null, createdAt: new Date().toISOString() })
    return json(res, 200, { ok: true, id })
  }

  if (req.method === 'GET' && url.pathname === '/next-task') {
    // 找最早 pending 任务（同 id 幂等：processing 任务若上次未完成可重取）
    let picked = null
    for (const t of tasks.values()) {
      if (t.status === 'pending') { picked = t; break }
    }
    if (!picked) return json(res, 200, { ok: true, task: null })
    picked.status = 'processing'
    picked.claimedAt = new Date().toISOString()
    return json(res, 200, { ok: true, task: { id: picked.id, prompt: picked.prompt } })
  }

  if (req.method === 'POST' && url.pathname === '/submit-answer') {
    const body = JSON.parse((await readBody(req)) || '{}')
    const t = tasks.get(String(body.id || ''))
    if (!t) return json(res, 404, { ok: false, error: 'task not found' })
    t.status = 'done'
    t.answer = String(body.answer || '')
    t.completedAt = new Date().toISOString()
    return json(res, 200, { ok: true })
  }

  if (req.method === 'POST' && url.pathname === '/submit-error') {
    const body = JSON.parse((await readBody(req)) || '{}')
    const t = tasks.get(String(body.id || ''))
    if (!t) return json(res, 404, { ok: false, error: 'task not found' })
    t.status = 'failed'
    t.error = String(body.error || '')
    t.completedAt = new Date().toISOString()
    return json(res, 200, { ok: true })
  }

  if (req.method === 'GET' && url.pathname.startsWith('/task-result/')) {
    const id = url.pathname.slice('/task-result/'.length)
    const t = tasks.get(id)
    if (!t) return json(res, 404, { ok: false, error: 'task not found' })
    return json(res, 200, { ok: true, task: t })
  }

  if (req.method === 'GET' && url.pathname === '/stats') {
    return json(res, 200, { ok: true, total: tasks.size, byStatus: {
      pending: [...tasks.values()].filter((t) => t.status === 'pending').length,
      processing: [...tasks.values()].filter((t) => t.status === 'processing').length,
      done: [...tasks.values()].filter((t) => t.status === 'done').length
    } })
  }

  json(res, 404, { ok: false, error: 'not found' })
})

server.listen(8899, () => console.log('[dsh-relay bridge] listening on http://127.0.0.1:8899'))
