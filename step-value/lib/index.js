// step-value — Host half（cordis 静态插件）。
// ===========================================================================
// 解析 DeepSeek Harness 会话日志（~/.dsh/sessions/ 下多帧 zstd 拼接的 JSONL），
// 按 Workspace → Session → Turn 统计 API token 用量与花费，通过 HTTP 路由暴露：
//
//   GET /step-value/summary       所有工作区汇总（turns / tokens / costUSD / costCNY）
//   GET /step-value/tree          Workspace → Session → Turn 树
//   GET /step-value/step-details  ?workspace=<dir>&session=<sessionId>&turn=<n>
//
// 磁盘布局：
//   <sessionsRoot>/<workspaceDir>/<sessionDir>/session.jsonl.zstd
//   - workspaceDir 形如 --D-dsh~0020relay~0020test--（-- 包裹；~XXXX = UTF-16
//     code unit 转义；':' '/' '\' 被官方 projectKey 折叠为 '-'，解码有损）
//   - 每个 zstd 帧 = 一批 JSONL 行；帧魔数 28 b5 2f fd，逐帧独立解压后拼接解析
//   - 每个 type==='assistant/message' 事件 = 一个 Turn（API 步骤），提取：
//     data.message.source.{model,provider}、data.usage.{inputTokens,outputTokens,
//     cacheReadTokens,reasoningTokens}、data.turn（缺失回退 data.step）、事件 time
//
// 价格表 / 汇率 / 扫描上限 / 缓存 TTL 均为可编辑常量（见下）。
// ===========================================================================

import os from 'node:os'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

export const name = 'step-value'
export const inject = ['webServer', 'fs']

// ---------------------------------------------------------------------------
// 可编辑配置
// ---------------------------------------------------------------------------

/**
 * 模型价格表（USD per 1K tokens），按 DeepSeek 官方定价，可编辑。
 * 未知名模型回退 _default。
 */
export const MODEL_PRICES = {
  // USD per 1K tokens
  'deepseek-v4-flash': { input: 0.00027, output: 0.0011, cacheRead: 0.00007, reasoning: 0.00055 },
  'deepseek-chat': { input: 0.00027, output: 0.0011, cacheRead: 0.00007, reasoning: 0.00055 },
  'deepseek-reasoner': { input: 0.00055, output: 0.00219, cacheRead: 0.00014, reasoning: 0.00055 },
  _default: { input: 0.00027, output: 0.0011, cacheRead: 0.00007, reasoning: 0.00055 }
}

/** 汇率 USD → CNY（可编辑）。 */
export const USD_TO_CNY = 7.2

/** 会话日志根目录：默认 ~/.dsh/sessions；可用环境变量 DSH_SESSIONS_ROOT 覆盖。 */
export const SESSIONS_ROOT = process.env.DSH_SESSIONS_ROOT || join(os.homedir(), '.dsh', 'sessions')

/**
 * 每次解析单个会话的扫描上限（可编辑常量）：0 = 不限。
 * 默认值覆盖本机现有全部会话（最大约 2.4 万帧 / 24MB 解压），同时兜底病态超大日志，
 * 保证面板响应快。调小（如 200 帧 / 5MB）可更快但结果会截断——截断通过
 * session.scanned.truncated 透出。解析结果另有 60s 内存缓存（CACHE_TTL_MS）。
 */
export const SCAN_MAX_FRAMES = 50000
export const SCAN_MAX_BYTES = 64 * 1024 * 1024

/** 模块级解析缓存 TTL（毫秒）。 */
export const CACHE_TTL_MS = 60_000

// ---------------------------------------------------------------------------
// HTTP 辅助
// ---------------------------------------------------------------------------

const CORS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type'
}

const json = (res, code, payload) => {
  res.writeHead(code, CORS)
  res.end(JSON.stringify(payload))
}

// ---------------------------------------------------------------------------
// 路径解码
// ---------------------------------------------------------------------------

/** 逆 encodeSegment：把 ~XXXX（4 位 hex，UTF-16 code unit）还原为字符。 */
export function decodeSegment(name) {
  return String(name ?? '').replace(/~([0-9A-Fa-f]{4})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)))
}

/**
 * 把工作区目录名解码为真实工作区路径。
 * 官方 projectKey 编码：'/'、'\\'、':' 折叠为 '-'（有损）、其余不安全字符转 ~XXXX、
 * 整体用 --...-- 包裹。解码：去首尾 '--' → 还原 ~XXXX；再按 Windows 驱动器启发
 * （单字母 + '-'）还原 'X:\...' 前缀（如 --D-dsh~0020relay~0020test-- → D:\dsh relay test）。
 */
export function decodeWorkspaceDir(name) {
  let s = String(name ?? '')
  if (s.startsWith('--') && s.endsWith('--') && s.length > 4) s = s.slice(2, -2)
  s = decodeSegment(s)
  s = s.replace(/^([A-Za-z])-(.+)$/, (m, drive, rest) => `${drive}:\\${rest}`)
  return s
}

// ---------------------------------------------------------------------------
// zstd 分帧与解析
// ---------------------------------------------------------------------------

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** 扫描缓冲区中所有 zstd 帧起始偏移（帧魔数 28 b5 2f fd）。 */
export function zstdFrameOffsets(buf) {
  const offsets = []
  let i = 0
  while (i < buf.length - 3) {
    const idx = buf.indexOf(ZSTD_MAGIC, i)
    if (idx === -1) break
    offsets.push(idx)
    i = idx + 4
  }
  return offsets
}

const round6 = (n) => Math.round(n * 1e6) / 1e6

/** 取模型价格（未知名模型回退 _default）。 */
export function priceFor(model) {
  return MODEL_PRICES[model] || MODEL_PRICES._default
}

/**
 * 计算一次 API 调用的花费（USD）。
 * cost = input*p.input + output*p.output + cacheRead*p.cacheRead + reasoning*p.reasoning，除以 1000。
 */
export function computeCost(tokens, model) {
  const p = priceFor(model)
  const usd =
    (tokens.input * p.input + tokens.output * p.output + tokens.cacheRead * p.cacheRead + tokens.reasoning * p.reasoning) / 1000
  return round6(usd)
}

const toNonNeg = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * 从一条 type==='assistant/message' 事件提取 Turn（API 步骤）。
 * 字段缺失全部容错为 0 / 空字符串；turn 缺失时回退 step。
 */
export function extractTurn(obj) {
  const data = obj?.data
  if (!data || typeof data !== 'object') return null
  const source = data.message?.source ?? {}
  const usage = data.usage ?? {}
  const model = typeof source.model === 'string' && source.model ? source.model : 'unknown'
  const provider = typeof source.provider === 'string' ? source.provider : ''
  const tokens = {
    input: toNonNeg(usage.inputTokens),
    output: toNonNeg(usage.outputTokens),
    cacheRead: toNonNeg(usage.cacheReadTokens),
    reasoning: toNonNeg(usage.reasoningTokens)
  }
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.reasoning
  const costUSD = computeCost(tokens, model)
  const turn = typeof data.turn === 'number' ? data.turn : typeof data.step === 'number' ? data.step : null
  const step = typeof data.step === 'number' ? data.step : null
  return {
    turn,
    step,
    model,
    provider,
    time: typeof obj.time === 'number' ? obj.time : null,
    tokens,
    costUSD,
    costCNY: round6(costUSD * USD_TO_CNY),
    usageRaw: usage, // 原始 usage 字段（step-details 用）
    sourceRaw: source // 原始 source 字段（step-details 用）
  }
}

/**
 * 解析一个会话日志文件（多帧 zstd 拼接的 JSONL；兼容纯文本 .jsonl 由调用方处理）。
 * 逐帧解压（帧魔数切分，单帧失败跳过）、按行 JSON 解析；解压/解析失败不中断整体。
 * 返回 { id, title, createdAt, turnsList, scanned }；文件不存在/不可读返回 null。
 */
export async function parseSessionLog(filePath, limits = {}) {
  const maxFrames = limits.maxFrames ?? SCAN_MAX_FRAMES
  const maxBytes = limits.maxBytes ?? SCAN_MAX_BYTES
  let buf
  try {
    buf = readFileSync(filePath)
  } catch {
    return null
  }
  const offsets = zstdFrameOffsets(buf)
  const result = {
    id: null,
    title: null,
    createdAt: null,
    turnsList: [],
    scanned: { frames: 0, bytes: 0, totalFrames: offsets.length, truncated: false }
  }
  let frames = 0
  let bytes = 0
  for (let f = 0; f < offsets.length; f++) {
    if (maxFrames > 0 && frames >= maxFrames) {
      result.scanned.truncated = true
      break
    }
    // 每 500 帧让出一次事件循环，避免解析大日志时阻塞整个 Node 进程
    if (f > 0 && f % 500 === 0) await new Promise((r) => setImmediate(r))
    const start = offsets[f]
    const end = f + 1 < offsets.length ? offsets[f + 1] : buf.length
    let dec
    try {
      dec = zstdDecompressSync(buf.subarray(start, end))
    } catch {
      frames += 1
      continue // 单帧损坏：跳过，不中断整体
    }
    frames += 1
    bytes += dec.length
    if (maxBytes > 0 && bytes > maxBytes) {
      result.scanned.truncated = true
      break
    }
    const text = dec.toString('utf8')
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (!t) continue
      let obj
      try {
        obj = JSON.parse(t)
      } catch {
        continue // 单行损坏：跳过
      }
      const ty = obj?.type
      if (ty === 'session') {
        result.id = typeof obj.id === 'string' ? obj.id : result.id
        if (typeof obj.createdAt === 'number') result.createdAt = obj.createdAt
      } else if (ty === 'assistant/message') {
        const turn = extractTurn(obj)
        if (turn) result.turnsList.push(turn)
      } else if (ty === 'session/title' && typeof obj?.data?.title === 'string') {
        result.title = obj.data.title // 按日志顺序覆盖，取最新标题
      }
    }
  }
  result.scanned.frames = frames
  result.scanned.bytes = bytes
  if (!result.createdAt && result.turnsList.length > 0) result.createdAt = result.turnsList[0].time
  return result
}

// ---------------------------------------------------------------------------
// 聚合与缓存
// ---------------------------------------------------------------------------

const parseCache = new Map() // logPath -> { ts, sig, result }

/** 带 TTL + 文件 mtime/size 校验的缓存解析。 */
async function cachedParse(logPath) {
  let sig = ''
  try {
    const st = statSync(logPath)
    sig = `${st.mtimeMs}:${st.size}`
  } catch {
    return null
  }
  const hit = parseCache.get(logPath)
  if (hit && hit.sig === sig && Date.now() - hit.ts < CACHE_TTL_MS) return hit.result
  const result = await parseSessionLog(logPath)
  parseCache.set(logPath, { ts: Date.now(), sig, result })
  if (parseCache.size > 500) {
    for (const [k, v] of parseCache) {
      if (Date.now() - v.ts >= CACHE_TTL_MS) parseCache.delete(k)
    }
  }
  return result
}

const logPathFor = (dir) => {
  const z = join(dir, 'session.jsonl.zstd')
  if (existsSync(z)) return { path: z, plain: false }
  const p = join(dir, 'session.jsonl') // 兼容 compression:none 的纯文本布局
  return existsSync(p) ? { path: p, plain: true } : null
}

function buildSession(dirName, parsed) {
  const turns = parsed.turnsList
  const tokens = { input: 0, output: 0, cacheRead: 0, reasoning: 0, total: 0 }
  let costUSD = 0
  let costCNY = 0
  for (const t of turns) {
    tokens.input += t.tokens.input
    tokens.output += t.tokens.output
    tokens.cacheRead += t.tokens.cacheRead
    tokens.reasoning += t.tokens.reasoning
    tokens.total += t.tokens.total
    costUSD += t.costUSD
    costCNY += t.costCNY
  }
  return {
    id: parsed.id || decodeSegment(dirName),
    dir: dirName,
    title: parsed.title || parsed.id || decodeSegment(dirName),
    createdAt: parsed.createdAt ?? null,
    turns: turns.length,
    tokens,
    costUSD: round6(costUSD),
    costCNY: round6(costCNY),
    turnsList: turns,
    scanned: parsed.scanned
  }
}

/** 收集一个工作区目录下的全部会话（解压/解析失败的会话自动跳过）。 */
async function collectSessions(wsDir) {
  const out = []
  let entries = []
  try {
    entries = readdirSync(wsDir, { withFileTypes: true }).filter((d) => d.isDirectory())
  } catch {
    return out
  }
  for (const e of entries) {
    const log = logPathFor(join(wsDir, e.name))
    if (!log) continue
    const parsed = await cachedParse(log.path)
    if (!parsed) continue
    out.push(buildSession(e.name, parsed))
  }
  out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  return out
}

/** 收集全部工作区 → 会话 → Turn（summary 与 tree 共用）。 */
export async function collectWorkspaces(root = SESSIONS_ROOT) {
  const workspaces = []
  let entries = []
  try {
    entries = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())
  } catch {
    return workspaces
  }
  for (const e of entries) {
    if (e.name === '_no-cwd') continue
    const sessions = await collectSessions(join(root, e.name))
    if (sessions.length === 0) continue // 无任何可解析会话的工作区不进面板
    workspaces.push({ dir: e.name, path: decodeWorkspaceDir(e.name), sessions })
  }
  workspaces.sort((a, b) => a.dir.localeCompare(b.dir))
  return workspaces
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : null)

/** summary 负载：所有工作区汇总。 */
export async function buildSummary(root = SESSIONS_ROOT) {
  const workspaces = await collectWorkspaces(root)
  const totalTokens = { input: 0, output: 0, cacheRead: 0, reasoning: 0, total: 0 }
  let totalTurns = 0
  let totalCostUSD = 0
  let totalCostCNY = 0
  const wsOut = []
  for (const ws of workspaces) {
    let turns = 0
    let costUSD = 0
    let costCNY = 0
    for (const s of ws.sessions) {
      turns += s.turns
      costUSD += s.costUSD
      costCNY += s.costCNY
      for (const k of ['input', 'output', 'cacheRead', 'reasoning', 'total']) totalTokens[k] += s.tokens[k]
    }
    totalTurns += turns
    totalCostUSD += costUSD
    totalCostCNY += costCNY
    wsOut.push({ path: ws.path, dir: ws.dir, sessions: ws.sessions.length, turns, costUSD: round6(costUSD), costCNY: round6(costCNY) })
  }
  return {
    generatedAt: new Date().toISOString(),
    totalTurns,
    totalTokens,
    totalCostUSD: round6(totalCostUSD),
    totalCostCNY: round6(totalCostCNY),
    workspaces: wsOut
  }
}

/** tree 负载：Workspace → Session → Turn 树。 */
export async function buildTree(root = SESSIONS_ROOT) {
  const workspaces = await collectWorkspaces(root)
  return {
    workspaces: workspaces.map((ws) => ({
      dir: ws.dir,
      path: ws.path,
      sessions: ws.sessions.map((s) => ({
        id: s.id,
        dir: s.dir,
        title: s.title,
        createdAt: iso(s.createdAt),
        turns: s.turns,
        costUSD: s.costUSD,
        costCNY: s.costCNY,
        turnsList: s.turnsList.map((t) => ({
          turn: t.turn,
          step: t.step,
          model: t.model,
          provider: t.provider,
          time: t.time,
          tokens: t.tokens,
          costUSD: t.costUSD,
          costCNY: t.costCNY
        }))
      }))
    }))
  }
}

const normId = (x) => String(x ?? '').replace(/^session-/, '')
const normPath = (x) => String(x ?? '').replace(/[\\/]+/g, '/').toLowerCase()

/**
 * step-details：按 workspace / session / turn 定位单个 Turn（含原始 usage / source）。
 * 可选 step 参数用于精确匹配（同 turn 下多个 step 的事件，见 tree 的 turnsList[].step）。
 * 返回 { turn } 或 { error }。
 */
export async function findTurn(root, workspaceParam, sessionParam, turnParam, stepParam) {
  const n = Number(turnParam)
  if (!Number.isInteger(n) || n <= 0) return { error: `invalid turn: ${turnParam}` }
  const workspaces = await collectWorkspaces(root)
  const ws = workspaces.find(
    (w) => w.dir === workspaceParam || normPath(w.path) === normPath(workspaceParam)
  )
  if (!ws) return { error: `workspace not found: ${workspaceParam}` }
  const ses = ws.sessions.find(
    (s) => normId(s.dir) === normId(sessionParam) || normId(s.id) === normId(sessionParam)
  )
  if (!ses) return { error: `session not found: ${sessionParam}` }
  // turn 与 step 是两个独立计数器且数值会重叠（如 turn=1 step=2 与 turn=2 step=1），
  // 因此优先按 turn 匹配；提供了 step 时先用 turn+step 精确匹配。
  let t = null
  if (stepParam != null && stepParam !== '') {
    const s = Number(stepParam)
    if (Number.isInteger(s) && s > 0) {
      t = ses.turnsList.find((x) => x.turn === n && x.step === s)
    }
  }
  if (!t) t = ses.turnsList.find((x) => x.turn === n)
  if (!t && stepParam != null && stepParam !== '') t = ses.turnsList.find((x) => x.step === n)
  if (!t) t = ses.turnsList.find((x) => x.step === n)
  if (!t) return { error: `turn not found: ${turnParam}` }
  return {
    turn: {
      turn: t.turn,
      step: t.step,
      model: t.model,
      provider: t.provider,
      time: t.time,
      tokens: t.tokens,
      costUSD: t.costUSD,
      costCNY: t.costCNY,
      usageRaw: t.usageRaw,
      sourceRaw: t.sourceRaw
    }
  }
}

// ---------------------------------------------------------------------------
// cordis 插件入口
// ---------------------------------------------------------------------------

export function apply(ctx) {
  const { webServer } = ctx
  // 注：inject 中的 'fs' 服务按任务要求声明（供后续步骤/功能使用）；
  // 本 half 用 node:fs 直读二进制会话日志（zstd 需要 Buffer 级访问）。

  const summaryHandler = async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
      json(res, 200, { ok: true, ...(await buildSummary()) })
    } catch (err) {
      json(res, 500, { ok: false, error: String(err?.message || err) })
    }
  }

  const treeHandler = async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
      json(res, 200, { ok: true, ...(await buildTree()) })
    } catch (err) {
      json(res, 500, { ok: false, error: String(err?.message || err) })
    }
  }

  const detailsHandler = async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
      const url = new URL(req.url || '/', 'http://localhost')
      const workspace = url.searchParams.get('workspace') || ''
      const session = url.searchParams.get('session') || ''
      const turn = url.searchParams.get('turn') || ''
      const step = url.searchParams.get('step') || ''
      const found = await findTurn(SESSIONS_ROOT, workspace, session, turn, step)
      if (found.error) return json(res, 404, { ok: false, error: found.error })
      json(res, 200, { ok: true, turn: found.turn })
    } catch (err) {
      json(res, 500, { ok: false, error: String(err?.message || err) })
    }
  }

  ctx.effect(() => webServer.register({ kind: 'exact', path: '/step-value/summary', handler: summaryHandler }), 'step-value/summary')
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/step-value/tree', handler: treeHandler }), 'step-value/tree')
  ctx.effect(() => webServer.register({ kind: 'exact', path: '/step-value/step-details', handler: detailsHandler }), 'step-value/step-details')
}
