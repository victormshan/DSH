// dsh-relay Gemini 网页桥接中转服务器（油猴 PoC）
// 作用：主 agent 与 gemini.google.com 油猴脚本之间的消息中转（localhost:8899）
//   POST /create-task {prompt}        → 主 agent 发任务，返回 {id}
//   GET  /next-task                   → 油猴脚本轮询取任务（取到后置 processing）
//   POST /submit-answer {id, answer}  → 油猴脚本回传答案（置 done）
//   GET  /task-result/:id             → 主 agent 取结果
// 内存队列（PoC 够用）。
//
// v0.4.0（安全加固，对应改进方案 P0-1）：
//  ① server.listen 显式绑定 127.0.0.1（此前默认绑 0.0.0.0，局域网内可达）
//  ② 共享密钥认证：启动时读取/生成 bridge.token（同目录，0600 权限），
//     所有业务端点校验 X-DSH-Bridge-Token 请求头，无/错 token 一律 401
//  ③ CORS 收窄：不再全开 '*'（GM_xmlhttpRequest 不受 CORS 限制，扩展有 host_permissions，
//     收窄只影响浏览器 fetch 直连场景，属纵深防御）
// v0.4.1：ALLOWED_ORIGIN 内置本机扩展 ID 兜底默认值，watchdog 计划任务开机自启时无需
//  手动 export DSH_BRIDGE_ORIGIN 即可生效；扩展 ID 变化时仍可用该环境变量覆盖。
import http from 'node:http'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TOKEN_FILE = join(__dirname, 'bridge.token')
// 默认值 = 本机已加载的扩展 ID（chrome://extensions 可查）；扩展换目录/换机器重装后 ID 会变，
// 届时通过 DSH_BRIDGE_ORIGIN 环境变量覆盖即可，无需改代码。
const DEFAULT_EXTENSION_ORIGIN = 'chrome-extension://makbmohpkaccbgpdncjmfkdjmhcjnleg'
const ALLOWED_ORIGIN = process.env.DSH_BRIDGE_ORIGIN || DEFAULT_EXTENSION_ORIGIN

// 共享 token：文件不存在则生成（32 字节 hex，不可预测）；存在则读取。
function loadToken() {
  try {
    const existing = fs.readFileSync(TOKEN_FILE, 'utf8').trim()
    if (existing.length >= 32) return existing
  } catch { /* 不存在则生成 */ }
  const token = crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(TOKEN_FILE, token + '\n', { mode: 0o600 })
  console.log('[bridge] 已生成新 token →', TOKEN_FILE)
  return token
}
const BRIDGE_TOKEN = loadToken()

const tasks = new Map() // id -> { id, prompt, status, answer, createdAt, completedAt }
let seq = 0

function authOk(req) {
  const h = req.headers['x-dsh-bridge-token'] || req.headers['X-DSH-Bridge-Token'] || ''
  return typeof h === 'string' && h.trim() === BRIDGE_TOKEN
}

const json = (res, code, payload) => {
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': ALLOWED_ORIGIN || 'http://localhost:8899',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-dsh-bridge-token'
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
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': ALLOWED_ORIGIN || 'http://localhost:8899', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-dsh-bridge-token' }); return res.end() }

  // v0.4.0: token 分发端点——扩展无法读 Node 文件系统，经回环端点取共享 token。
  // 本端点不鉴权（鸡生蛋问题），但 server 已绑定 127.0.0.1，仅本机进程可达，风险可控。
  if (req.method === 'GET' && url.pathname === '/__token') {
    return json(res, 200, { ok: true, token: BRIDGE_TOKEN })
  }

  // 业务端点统一鉴权（/stats /__watchdog 也鉴权，防信息泄露）
  if (!authOk(req)) return json(res, 401, { ok: false, error: 'unauthorized' })

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

  // v0.3.0: 守护状态端点——popup 用它探测守护链是否正常
  if (req.method === 'GET' && url.pathname === '/__watchdog') {
    return json(res, 200, { ok: true, alive: true, pid: process.pid, uptime: Math.round(process.uptime()) })
  }

  json(res, 404, { ok: false, error: 'not found' })
})

// v0.4.0: 显式绑定 127.0.0.1（默认 0.0.0.0 会暴露到局域网，改进方案 P0-1 修复）
server.listen(8899, '127.0.0.1', () => console.log('[dsh-relay bridge] listening on http://127.0.0.1:8899（仅本机）'))
