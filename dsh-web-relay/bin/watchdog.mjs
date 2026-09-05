// dsh-web-relay · v3.9 S3 宿主 watchdog（bin/watchdog.mjs，独立进程，不进插件 lib）
// 职责：每 CHECK_MS 探测 dsh web 宿主 /health-check；连续 miss ≥ MISS_N 次 →
//   先 POST /admin/prepare-restart（优雅落盘+停新任务领取）→ 树杀旧 PID → 重新拉起宿主；
//   防风暴：WINDOW_MS 内重启 ≥ MAX_RESTARTS 次则暂停 PAUSE_MS。
// 参考骨架：dsh-web-gemini-ext/bridge-watchdog.mjs（崩溃自愈 + 防风暴限速）。
// 运行：node bin/watchdog.mjs            （Windows 计划任务 AtLogOn，任务名 DSH-WEB-Watchdog）
// 环境变量：DSH_WEB_PORT / DSH_WEB_CMD（整条命令，优先）/ DSH_WEB_BIN / DSH_WEB_ARGS /
//           DSH_NODE_EXE / DSH_RELAY_GC_MS 无关；CHECK_MS/TIMEOUT_MS/MISS_N/MAX_RESTARTS/WINDOW_MS/PAUSE_MS 可覆盖
import { spawn, execSync } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d }

export const CFG = {
  port: Number(process.env.DSH_WEB_PORT) || 3080,
  checkMs: num(process.env.DSH_WEB_CHECK_MS, 5000),
  timeoutMs: num(process.env.DSH_WEB_TIMEOUT_MS, 2000),
  missN: Math.floor(num(process.env.DSH_WEB_MISS_N, 3)),
  restartDelayMs: num(process.env.DSH_WEB_RESTART_DELAY_MS, 2000),
  maxRestarts: Math.floor(num(process.env.DSH_WEB_MAX_RESTARTS, 3)),
  windowMs: num(process.env.DSH_WEB_WINDOW_MS, 10 * 60 * 1000),
  pauseMs: num(process.env.DSH_WEB_PAUSE_MS, 10 * 60 * 1000),
  nodeExe: process.env.DSH_NODE_EXE || (() => { try { return fs.realpathSync(process.execPath) } catch { return process.execPath } })(),
  // 默认宿主命令：<node> <nvm node_modules>/@deepseek-ai/dsh/lib/bin.js web [DSH_WEB_ARGS]
  webBin: process.env.DSH_WEB_BIN || path.join(path.dirname(process.execPath), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  webArgs: (process.env.DSH_WEB_ARGS || 'web').trim(),
  webCmd: (process.env.DSH_WEB_CMD || '').trim(),
  logFile: process.env.DSH_WEB_LOG || path.join(__dirname, 'watchdog-host.log'),
  dryRun: process.env.DSH_WEB_DRYRUN === '1'   // 模拟模式：只打日志不 kill/spawn（验收模拟用，防误杀真实宿主）
}
const healthUrl = () => `http://127.0.0.1:${CFG.port}/dsh-web-relay/health-check`
const prepareUrl = () => `http://127.0.0.1:${CFG.port}/dsh-web-relay/admin/prepare-restart`

// ---------- 纯函数（可单测）----------
// 防风暴门：WINDOW_MS 内重启次数 < max → allow；否则返回需暂停毫秒
export function stormGate(restartTimes, { now = Date.now(), max = CFG.maxRestarts, windowMs = CFG.windowMs, pauseMs = CFG.pauseMs } = {}) {
  const cutoff = now - windowMs
  const recent = restartTimes.filter((t) => t > cutoff)
  if (recent.length < max) return { allow: true, recent: recent.length, pauseRemainingMs: 0 }
  const oldestInWindow = Math.min(...recent)
  return { allow: false, recent: recent.length, pauseRemainingMs: Math.max(0, oldestInWindow + windowMs + pauseMs - now) }
}
export function classifyProbe({ httpOk, okFlag } = {}) { return httpOk === true && okFlag === true }
export function decideRestart({ missCount, missN = CFG.missN } = {}) { return missCount >= missN }
// 重启尝试门：先判防风暴再记录（暂停期不累计，避免次数无限膨胀）
export function attemptRestart(restartTimes, { now = Date.now(), max = CFG.maxRestarts, windowMs = CFG.windowMs, pauseMs = CFG.pauseMs } = {}) {
  const gate = stormGate(restartTimes, { now, max, windowMs, pauseMs })
  if (!gate.allow) return { allowed: false, pauseRemainingMs: gate.pauseRemainingMs, restartTimes }
  restartTimes.push(now)
  return { allowed: true, pauseRemainingMs: 0, restartTimes }
}
// 简单命令解析：双引号段保持原样（不处理转义），其余按空白拆分
export function parseCommand(cmd) {
  const out = []
  const re = /"([^"]*)"|(\S+)/g
  let m
  while ((m = re.exec(cmd))) out.push(m[1] !== undefined ? m[1] : m[2])
  return out
}
export function hostArgv() {
  if (CFG.webCmd) return parseCommand(CFG.webCmd)
  const base = [CFG.webBin]
  if (CFG.webArgs) base.push(...parseCommand(CFG.webArgs))
  return base
}

// ---------- 运行时 ----------
function httpGetJson(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let raw = ''
      res.on('data', (c) => { raw += c })
      res.on('end', () => { let j = null; try { j = JSON.parse(raw) } catch {}; resolve({ httpOk: res.statusCode === 200, okFlag: j && j.ok === true, body: j }) })
    })
    req.on('timeout', () => { req.destroy(); resolve({ httpOk: false, okFlag: false, error: 'timeout' }) })
    req.on('error', (e) => resolve({ httpOk: false, okFlag: false, error: String((e && e.message) || e) }))
  })
}
function probe() { return httpGetJson(healthUrl(), CFG.timeoutMs).then((r) => ({ alive: classifyProbe(r), ...r })) }
function log(line) {
  const msg = `[watchdog ${new Date().toISOString()}] ${line}`
  console.log(msg)
  try { fs.appendFileSync(CFG.logFile, msg + '\n') } catch {}
}
function prepareBestEffort() {
  httpGetJson(prepareUrl(), 3000).catch(() => {}) // fire-and-forget
}
function killPidTree(pid) {
  try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); return true } catch (e) { return false }
}
function findPortPid() {
  // netstat -ano 解析 LISTENING 于 127.0.0.1:port（或 0.0.0.0:port）的 PID
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/)
      if (m && Number(m[2]) === CFG.port && (m[1] === '127.0.0.1' || m[1] === '0.0.0.0' || m[1] === '[::]')) return Number(m[3])
    }
  } catch {}
  return null
}

let child = null
let missCount = 0
const restartTimes = []

function spawnHost() {
  const argv = hostArgv()
  log(`拉起宿主：${CFG.nodeExe} ${argv.join(' ')}`)
  let out
  try { out = fs.openSync(CFG.logFile, 'a') } catch { out = 'ignore' }
  child = spawn(CFG.nodeExe, argv, { cwd: __dirname, stdio: ['ignore', out, out], windowsHide: true })
  child.on('exit', (code, signal) => {
    log(`宿主退出（code=${code} signal=${signal}）；${CFG.restartDelayMs}ms 后重新探测`)
    child = null
    setTimeout(() => { if (!child) tick() }, CFG.restartDelayMs)
  })
  child.on('error', (err) => { log(`宿主启动失败：${err.message}`); child = null })
}

function doRestart() {
  const attempt = attemptRestart(restartTimes)
  if (!attempt.allowed) { log(`防风暴暂停：暂停 ${Math.round(attempt.pauseRemainingMs / 1000)}s（窗口内已重启 ${restartTimes.length} 次，暂停期不累计）`); return }
  if (CFG.dryRun) {
    log(`[DRYRUN] 将执行重启流程：POST /admin/prepare-restart → taskkill 旧 PID → spawn 宿主（${CFG.nodeExe} ${hostArgv().join(' ')}）；防风暴仍生效（已重启 ${restartTimes.length} 次）`)
    return
  }
  prepareBestEffort()
  log('触发重启流程：已请求 /admin/prepare-restart（优雅落盘）')
  if (child) { killPidTree(child.pid); child = null }
  const pid = findPortPid()
  if (pid) { log(`树杀旧宿主 PID=${pid}`); killPidTree(pid) }
  setTimeout(spawnHost, CFG.restartDelayMs)
}

async function tick() {
  const r = await probe()
  if (r.alive) {
    if (missCount > 0) { log(`宿主恢复（此前连续 miss ${missCount} 次）`); missCount = 0 }
    if (child && !child.killed && child.exitCode === null) { /* 子进程存活且端口通 → 正常 */ }
    return
  }
  missCount += 1
  if (decideRestart({ missCount })) {
    log(`连续 miss ${missCount} 次（≥${CFG.missN}）→ 重启宿主（err=${r.error || '无响应'}）`)
    missCount = 0
    doRestart()
  } else {
    log(`miss ${missCount}/${CFG.missN}（${r.error || '无响应'}）`)
  }
}

// 仅作为 CLI 主入口运行时启动（被测试 import 时不执行）
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href
if (isMain) {
  log(`开始守护 dsh web @127.0.0.1:${CFG.port}（每 ${CFG.checkMs / 1000}s 探测，miss ≥ ${CFG.missN} 重启；防风暴 ${CFG.maxRestarts} 次/${CFG.windowMs / 60000}min）`)
  log(`宿主命令：${CFG.nodeExe} ${hostArgv().join(' ')}`)
  ;(async () => {
    const r = await probe()
    if (r.alive) log('宿主在线：进入监控模式')
    else { missCount = 1; log(`宿主未响应：${r.error || '无响应'}（miss 1/${CFG.missN}）`) }
    setInterval(tick, CFG.checkMs)
  })()
}
