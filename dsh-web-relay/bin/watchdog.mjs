// dsh-web-relay · v3.9 S3 宿主 watchdog（bin/watchdog.mjs，独立进程，不进插件 lib）
// 职责：每 CHECK_MS 探测 dsh web 宿主 /health-check；连续 miss ≥ MISS_N 次 →
//   先 POST /admin/prepare-restart（优雅落盘+停新任务领取）→ 树杀旧 PID → 重新拉起宿主；
//   防风暴：WINDOW_MS 内重启 ≥ MAX_RESTARTS 次则暂停 PAUSE_MS。
// 参考骨架：dsh-web-gemini-ext/bridge-watchdog.mjs（崩溃自愈 + 防风暴限速）。
// 运行：node bin/watchdog.mjs            （Windows 计划任务 AtLogOn，任务名 DSH-WEB-Watchdog）
// 环境变量：DSH_WEB_PORT / DSH_WEB_CMD（整条命令，优先）/ DSH_WEB_BIN / DSH_WEB_ARGS /
//           DSH_NODE_EXE / DSH_RELAY_GC_MS 无关；CHECK_MS/TIMEOUT_MS/MISS_N/MAX_RESTARTS/WINDOW_MS/PAUSE_MS 可覆盖
import { spawn, spawnSync, execSync } from 'node:child_process'
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
  lockFile: process.env.DSH_WEB_LOCK || path.join(__dirname, '.watchdog.lock'),
  dryRun: process.env.DSH_WEB_DRYRUN === '1',   // 模拟模式：只打日志不 kill/spawn（验收模拟用，防误杀真实宿主）
  // v3.9.3（总守护）：桥接链路托管——探测 8899，发现 DSH-Bridge-Watchdog 未运行则拉起
  bridgePort: Number(process.env.DSH_WEB_BRIDGE_PORT) || 8899,
  bridgeCheckEvery: Math.floor(num(process.env.DSH_WEB_BRIDGE_CHECK_EVERY, 12)), // 每 N 个 tick 查一次桥
  bridgeIgnoreProc: process.env.DSH_WEB_BRIDGE_IGNORE_PROC === '1',               // 模拟：跳过进程存在性检查
  bridgeWatchdogPath: process.env.DSH_BRIDGE_WATCHDOG_PATH
    || (fs.existsSync('D:\\DSH\\dsh-web-gemini-ext\\bridge-watchdog.mjs') ? 'D:\\DSH\\dsh-web-gemini-ext\\bridge-watchdog.mjs' : '')
}
const healthUrl = () => `http://127.0.0.1:${CFG.port}/dsh-web-relay/health-check`
const prepareUrl = () => `http://127.0.0.1:${CFG.port}/dsh-web-relay/admin/prepare-restart`
const bridgeProbeUrl = () => `http://127.0.0.1:${CFG.bridgePort}/__token`

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

// ---------- 注册表环境补注入（v3.9.1-fix）----------
// 背景：GEMINI_API_KEY 等以 DPAPI blob 存于 User/Machine 环境（dsh 启动时解密注入）。
// 若 watchdog 进程自身 env 缺该变量（继承链早于注册表设置/经深层子进程链拉起），
// 其 spawn 的宿主会丢 key（/status geminiConfigured=false）。
// 修复：spawn 前从注册表 User→Machine 回读指定变量，并入子进程 env。
const REG_USER = 'HKCU\\Environment'
const REG_MACHINE = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
// 解析 `reg query` 输出中的 REG_SZ 值（纯函数可单测；注意 CRLF——先剥行尾 \r 再匹配）
export function parseRegValue(out, name) {
  const lines = String(out || '').split('\n')
  for (const raw of lines) {
    const l = raw.replace(/\r$/, '')
    const m = l.match(/^\s*(\S+)\s+REG_\w+\s+(.*)$/)
    if (m && m[1].toUpperCase() === String(name).toUpperCase()) return m[2].trim()
  }
  return null
}
export function readRegistryEnv(name) {
  for (const hive of [REG_USER, REG_MACHINE]) {
    try {
      const out = execSync(`reg query "${hive}" /v ${name}`, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] })
      const v = parseRegValue(out, name)
      if (v) return v
    } catch { /* try next hive */ }
  }
  return null
}
export function childEnv() {
  const env = { ...process.env }
  // 仅当进程 env 缺失时补注入（避免覆盖已存在的明文/解密值）
  for (const name of ['GEMINI_API_KEY', 'GEMINI_MODEL']) {
    if (!env[name]) {
      const v = readRegistryEnv(name)
      if (v) env[name] = v
    }
  }
  return env
}

// ---------- v3.9.3 总守护：桥接链路（DSH-Bridge-Watchdog / 8899）----------
// 决策（纯函数）：bridge 在线 → ok；bridge 掉线但 watchdog 进程在 → 交给它自愈（不重复拉起）；
// 两者皆无且有路径配置 → spawn-watchdog；无配置 → no-config
export function bridgeDecision({ bridgeAlive, watchdogAlive, path = CFG.bridgeWatchdogPath }) {
  if (bridgeAlive) return { action: 'ok' }
  if (watchdogAlive) return { action: 'watchdog-holds' }
  if (path) return { action: 'spawn-watchdog', path }
  return { action: 'no-config' }
}
// 探测 DSH-Bridge-Watchdog 进程是否在跑（Windows：spawnSync powershell，避开 cmd 引号地狱）
export function bridgeWatchdogRunning() {
  if (CFG.bridgeIgnoreProc) return false
  try {
    const ps = `$p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'bridge-watchdog' } | Select-Object -First 1; if ($p) { 'FOUND' } else { 'NONE' }`
    const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 6000 })
    return /FOUND/.test(String(out.stdout || ''))
  } catch { return false }
}

// ---------- 单例锁（v3.9.2：防手动调试与计划任务双开竞态）----------
export function parseLock(text) {
  const n = Number(String(text || '').trim())
  return Number.isInteger(n) && n > 0 ? n : null
}
export function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch (e) { return false }
}
export function acquireLock(logFn = log) {
  try {
    const existing = parseLock(fs.existsSync(CFG.lockFile) ? fs.readFileSync(CFG.lockFile, 'utf8') : '')
    if (existing && pidAlive(existing)) {
      logFn(`已有 watchdog 实例在运行（PID=${existing}，锁 ${CFG.lockFile}），本实例退出`)
      return false
    }
    fs.writeFileSync(CFG.lockFile, String(process.pid))
    process.on('exit', () => { try { fs.unlinkSync(CFG.lockFile) } catch {} })
    return true
  } catch (err) {
    logFn(`单例锁获取失败（${err && err.message}），继续运行（不阻断）`)
    return true
  }
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
let tickCount = 0
const restartTimes = []

function spawnHost() {
  const argv = hostArgv()
  const env = childEnv() // v3.9.1-fix: 补注入注册表 GEMINI_API_KEY/GEMINI_MODEL（防深层链丢 key）
  const injected = Object.keys(env).filter((k) => (k === 'GEMINI_API_KEY' || k === 'GEMINI_MODEL') && env[k] !== process.env[k])
  log(`拉起宿主：${CFG.nodeExe} ${argv.join(' ')}${injected.length ? `（env 补注入：${injected.join(',')}）` : ''}`)
  let out
  try { out = fs.openSync(CFG.logFile, 'a') } catch { out = 'ignore' }
  child = spawn(CFG.nodeExe, argv, { cwd: __dirname, stdio: ['ignore', out, out], windowsHide: true, env })
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
  tickCount += 1
  const r = await probe()
  if (r.alive) {
    if (missCount > 0) { log(`宿主恢复（此前连续 miss ${missCount} 次）`); missCount = 0 }
    if (child && !child.killed && child.exitCode === null) { /* 子进程存活且端口通 → 正常 */ }
  } else {
    missCount += 1
    if (decideRestart({ missCount })) {
      log(`连续 miss ${missCount} 次（≥${CFG.missN}）→ 重启宿主（err=${r.error || '无响应'}）`)
      missCount = 0
      doRestart()
    } else {
      log(`miss ${missCount}/${CFG.missN}（${r.error || '无响应'}）`)
    }
  }
  // v3.9.3 总守护：周期检查桥接链路（DSH-Bridge-Watchdog / 8899）
  if (CFG.bridgeCheckEvery > 0 && tickCount % CFG.bridgeCheckEvery === 0) {
    await auxBridgeTick().catch((e) => log(`[bridge] aux 检查异常：${String((e && e.message) || e).slice(0, 200)}`))
  }
}

let childBridge = null
let bridgeDownStreak = 0
const bridgeRestartTimes = []
async function auxBridgeTick() {
  const b = await httpGetJson(bridgeProbeUrl(), 1500)
  if (classifyProbe(b)) {
    if (bridgeDownStreak > 0) { bridgeDownStreak = 0; log(`[bridge] 桥接恢复（8899 在线）`) }
    return
  }
  bridgeDownStreak += 1
  if (bridgeDownStreak < 2) return // 首轮只观察：给既有 DSH-Bridge-Watchdog 自愈窗口（RESTART_DELAY 2s + CHECK 5s）
  const wdAlive = bridgeWatchdogRunning()
  const d = bridgeDecision({ bridgeAlive: false, watchdogAlive: wdAlive, path: CFG.bridgeWatchdogPath })
  if (d.action === 'watchdog-holds') {
    log(`[bridge] 8899 掉线但 DSH-Bridge-Watchdog 进程在（自愈中，观察第 ${bridgeDownStreak} 轮）`)
  } else if (d.action === 'no-config') {
    log('[bridge] 8899 掉线且 watchdog 未运行，但未配置路径（DSH_BRIDGE_WATCHDOG_PATH），跳过')
  } else if (d.action === 'spawn-watchdog') {
    const att = attemptRestart(bridgeRestartTimes)
    if (!att.allowed) { log(`[bridge] 防风暴暂停：${Math.round(att.pauseRemainingMs / 1000)}s（窗口内已拉 ${bridgeRestartTimes.length} 次）`); return }
    if (CFG.dryRun) {
      log(`[DRYRUN][bridge] 8899 掉线且 DSH-Bridge-Watchdog 未运行 → 将拉起 ${d.path}`)
      return
    }
    log(`[bridge] 8899 掉线且 DSH-Bridge-Watchdog 未运行 → 拉起 ${d.path}`)
    childBridge = spawn(CFG.nodeExe, [d.path], { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true })
    childBridge.on('exit', (code) => { log(`[bridge] DSH-Bridge-Watchdog 退出（code=${code}）；下轮复查`); childBridge = null })
    childBridge.on('error', (err) => { log(`[bridge] 拉起失败：${err.message}`); childBridge = null })
  }
}

// 仅作为 CLI 主入口运行时启动（被测试 import 时不执行）
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href
if (isMain) {
  if (!acquireLock()) process.exit(0) // 单例锁：已有实例则退出
  const restartNow = process.argv[2] === 'restart-now'
  if (restartNow) {
    // v4.4 U4: restart-now 原子子命令——prepare → 确认 → 树杀当前宿主 → 进入监控（首检自动拉起新宿主）
    if (CFG.dryRun) {
      log(`[DRYRUN][restart-now] 将执行：POST /admin/prepare-restart → taskkill 当前宿主 → 首检拉起新宿主（不实际执行）`)
    } else {
      log('[restart-now] 触发优雅停机准备…')
      prepareBestEffort()
      await new Promise((r) => setTimeout(r, 800)) // 等待 prepare 生效（落盘/停新任务）
      const pid = findPortPid()
      if (pid) {
        log(`[restart-now] 树杀当前宿主 PID=${pid}`)
        killPidTree(pid)
      } else {
        log('[restart-now] 未发现 3080 宿主进程（可能已不在线），直接进入拉起流程')
      }
      log('[restart-now] 宿主已停，进入监控（首检将立即拉起新宿主）')
    }
  }
  log(`开始守护 dsh web @127.0.0.1:${CFG.port}（每 ${CFG.checkMs / 1000}s 探测，miss ≥ ${CFG.missN} 重启；防风暴 ${CFG.maxRestarts} 次/${CFG.windowMs / 60000}min）`)
  log(`宿主命令：${CFG.nodeExe} ${hostArgv().join(' ')}`)
  ;(async () => {
    // v3.9.2: 启动首检——未响应立即拉起（不等 miss×N 轮询，缩短开机/恢复空窗）
    const r = await probe()
    if (r.alive) log('宿主在线：进入监控模式')
    else {
      log(`启动首检未响应（${r.error || '无响应'}）→ 立即拉起（不等 miss ${CFG.missN} 轮询）`)
      doRestart()
    }
    setInterval(tick, CFG.checkMs)
  })()
}
