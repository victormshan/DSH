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
// v0.4.2（stab1_2 可观测性）: 扩展活跃度——lastPollAt/pollCount = 轮询心跳（扩展 SW 是否活着）；
// lastClaimAt/claimCount = 真正认领任务（扩展是否在工作）。二者分开，才能区分：
//   轮询停 → 扩展/标签页全停；轮询在但 claim 不涨 → 空闲（正常）；
//   claim 涨但任务不终态 → content script 无响应（取到任务但不回传）。
let lastPollAt = null
let pollCount = 0
let lastClaimAt = null
let claimCount = 0
// v0.4.0（Chrome 侧加固 P1）: 扩展上报的健康状态（轮询查询参数携带）
let workerAuthState = null    // OK | LOGGED_OUT | UNKNOWN
let workerIsReady = null      // true/false/null（未上报）
let workerLastSeenAt = null
// v0.4.2（可观测性）: 标签页存在性与补建结果（扩展查询参数 tc / ens 上报）
//   tc  = chrome.tabs.query 命中的 gemini 标签页数量（0 = 无标签页）
//   ens = 最近一次补建结果：created:<tabId> | throttled | error:<msg>
// 用途：区分"扩展在跑但没标签页"（tc=0）与"标签页在但页面没就绪"（isReady=false）——
// 此前两者在 /stats 里都表现为旧值，是本轮排查补建问题的主要盲区。
let workerTabCount = null
let workerEnsure = null
// v0.4.2: 标签页指纹（pinned/active/windowId/url-path）——用于解释"扩展能看到、用户看不到"的标签页
let workerTabInfo = null

// v0.4.1（wg-gap-analysis 2026-09-10 评审加固）:
//   ① 服务端超时兜底——processing 超过 PROCESSING_TIMEOUT_MS 仍无终态（消费者未上报
//      submit-answer/submit-error，例如扩展崩溃/无人轮询/消费者中途放弃），主动判定 failed，
//      状态机自身闭环，不依赖任何特定消费者的行为。阈值明显大于 content script 最坏耗时
//      （~74s，见 dsh-web-relay cc 任务 wg-gap-analysis 的分析报告 Q4.2）与宿主侧 stallMs
//      （默认 90s），故取 120s，确保是"最后防线"而不是抢跑。
//   ② 历史任务清理——done/failed 超过 RETENTION_MS 后从内存 Map 删除，避免长期运行
//      （配合 bridge-watchdog.mjs 常驻）内存无界增长。
// @timeouts-begin —— content.js / background.js / bridge-server.mjs 三处必须逐字一致（test/timeouts.test.mjs 校验）
// v0.4.3 超时链：content 内部最坏总耗时 < background 等 content 的时长 < bridge 判 processing 超时；
// 都随提示长度增长（长审核 Gemini 常需 2–4 分钟），避免一层还在等、另一层已判超时。
const SEND_CANDIDATES_MAX = 3
function sendSettleMsFor(len) { return Math.min(10000, 2000 + Math.ceil((len || 0) / 4)) }
function replyMaxMsFor(len) { return Math.min(240000, 60000 + 15 * (len || 0)) }
function contentBudgetMsFor(len) {
  const settle = sendSettleMsFor(len)
  // 按钮候选（等可用 + 等生效）+ Enter/requestSubmit/宽限 + 填入 + 等回答 + 兜底
  return SEND_CANDIDATES_MAX * (settle + Math.max(1500, settle / 2)) + 3 * settle + 3000 + replyMaxMsFor(len) + 5000
}
function backgroundTimeoutMsFor(len) { return contentBudgetMsFor(len) + 15000 }
function bridgeProcessingTimeoutMsFor(len) { return Math.max(120000, backgroundTimeoutMsFor(len) + 30000) }
// @timeouts-end

const PROCESSING_TIMEOUT_MS = 120000
const RETENTION_MS = 3600000
const SWEEP_INTERVAL_MS = 15000
// v0.4.2（stab1_2 实测修复）: pending 无人认领超时——扩展 background.js 的 pollOnce 在
// 「无 gemini.google.com 标签页」时直接 return（不取任务），此时任务会**永久停留 pending**
// （2026-09-10 实测：任务 t0001 停 pending 15s+ 且 claimCount=0，宿主只能白等到 300s 超时）。
// 60s 无任何消费者认领即判定 failed，并给出可诊断原因。
const PENDING_TIMEOUT_MS = 60000

function sweepTasks() {
  const now = Date.now()
  for (const [id, t] of tasks) {
    // ① pending 无人认领（扩展未拾取）→ failed（防宿主白等超时）
    if (t.status === 'pending' && t.createdAt) {
      const age = now - new Date(t.createdAt).getTime()
      if (age >= PENDING_TIMEOUT_MS) {
        t.status = 'failed'
        t.error = `无消费者认领：pending ${Math.round(age / 1000)}s 未被扩展拾取（可能 Chrome 无 gemini.google.com 标签页 / 扩展被停用 / SW 未运行）`
        t.completedAt = new Date().toISOString()
        console.warn('[bridge] 任务', id, '判定无人认领 failed')
      }
    }
    // ② processing 超时（消费者未回传终态）→ failed
    if (t.status === 'processing' && t.claimedAt) {
      const elapsed = now - new Date(t.claimedAt).getTime()
      // v0.4.3: 按任务提示长度计算（不低于 PROCESSING_TIMEOUT_MS），保证晚于扩展各层自己的超时
      const limit = Math.max(PROCESSING_TIMEOUT_MS, bridgeProcessingTimeoutMsFor(String(t.prompt || '').length))
      if (elapsed >= limit) {
        t.status = 'failed'
        t.error = `server 端超时兜底：processing ${Math.round(elapsed / 1000)}s 无终态（消费者未回传 submit-answer/submit-error）`
        t.completedAt = new Date().toISOString()
        console.warn('[bridge] 任务', id, '判定超时 failed')
      }
    }
    // ③ 保留期清理
    if ((t.status === 'done' || t.status === 'failed') && t.completedAt) {
      const age = now - new Date(t.completedAt).getTime()
      if (age >= RETENTION_MS) tasks.delete(id)
    }
  }
}
// unref(): sweep 定时器不应阻止进程退出（与 server.listen 常驻语义无冲突）
setInterval(sweepTasks, SWEEP_INTERVAL_MS).unref()

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
    // v0.4.3（stab1_2 实测修正）: 轮询心跳与任务认领**分开统计**——初版把每次 /next-task 调用
    // 都计入 claimCount，而扩展每秒轮询一次，导致该计数实为"轮询次数"（实测 9.5 分钟累计 299），
    // 无法区分"扩展在轮询但无任务（空闲，正常）"与"扩展取到任务（claim 增长）"。
    lastPollAt = new Date().toISOString()
    pollCount += 1
    // v0.4.0（Chrome 侧加固 P1——健康上报 + 快速降级）: 扩展轮询可携带健康状态
    //   查询参数：authState=OK|LOGGED_OUT|UNKNOWN、isReady=1|0
    // 未登录 / 页面未就绪是"页面态不可控"最常见的两种情形——此时立即把 pending/processing
    // 任务判 failed（宿主侧随即拿到 unavailable 并续降），不再死等 60s pending 早退或 120s sweep。
    const qs = url.searchParams
    const authState = qs.get('authState') || null
    const isReady = qs.has('isReady') ? qs.get('isReady') === '1' : null
    if (authState) workerAuthState = authState
    if (isReady !== null) workerIsReady = isReady
    // v0.4.2: 标签页存在性 / 补建结果（缺省不动，保持"未上报"语义）
    if (qs.has('tc')) workerTabCount = Number(qs.get('tc'))
    if (qs.has('ens')) workerEnsure = qs.get('ens')
    if (qs.has('tinfo')) workerTabInfo = qs.get('tinfo')
    workerLastSeenAt = lastPollAt
    const blockedReason = authState === 'LOGGED_OUT'
      ? '扩展上报未登录（gemini.google.com 未登录）'
      : (isReady === false ? '扩展上报页面未就绪（输入框/选择器不可用）' : null)
    if (blockedReason) {
      let n = 0
      for (const t of tasks.values()) {
        if (t.status === 'pending' || t.status === 'processing') {
          t.status = 'failed'
          t.error = `扩展侧不可用：${blockedReason}`
          t.completedAt = new Date().toISOString()
          n += 1
        }
      }
      if (n > 0) console.warn('[bridge] 扩展上报不可用 →', n, '个任务立即判 failed:', blockedReason)
    }
    // 找最早 pending 任务（同 id 幂等：processing 任务若上次未完成可重取）
    let picked = null
    for (const t of tasks.values()) {
      if (t.status === 'pending') { picked = t; break }
    }
    if (!picked) return json(res, 200, { ok: true, task: null, worker: { authState, isReady } })
    // 仅当真正认领任务时才计 claim（这才是"扩展在工作"的信号）
    lastClaimAt = new Date().toISOString()
    claimCount += 1
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
      done: [...tasks.values()].filter((t) => t.status === 'done').length,
      // v0.4.1: 补 failed 计数（原枚举遗漏——代码已支持 failed 状态，排查时只能靠
      // total-pending-processing-done 反推，本次事故排查即受此困扰）
      failed: [...tasks.values()].filter((t) => t.status === 'failed').length
    },
    // v0.4.2/0.4.3（stab1_2）: 扩展活跃度双指标——lastPollAt/pollCount=轮询心跳；
    // lastClaimAt/claimCount=真正认领任务（区分"空闲轮询"/"扩展停"/"取到不回传"）
    lastPollAt, pollCount, lastClaimAt, claimCount, serverUptimeSec: Math.round(process.uptime()),
    // v0.4.0（P1）: 扩展健康状态（未登录/页面未就绪可在前端一眼看出，不必等任务超时）
    worker: { authState: workerAuthState, isReady: workerIsReady, tabCount: workerTabCount, tabInfo: workerTabInfo, ensure: workerEnsure, lastSeenAt: workerLastSeenAt } })
  }

  // v0.3.0: 守护状态端点——popup 用它探测守护链是否正常
  if (req.method === 'GET' && url.pathname === '/__watchdog') {
    return json(res, 200, { ok: true, alive: true, pid: process.pid, uptime: Math.round(process.uptime()) })
  }

  json(res, 404, { ok: false, error: 'not found' })
})

// v0.4.0: 显式绑定 127.0.0.1（默认 0.0.0.0 会暴露到局域网，改进方案 P0-1 修复）
server.listen(8899, '127.0.0.1', () => console.log('[dsh-relay bridge] listening on http://127.0.0.1:8899（仅本机）'))
