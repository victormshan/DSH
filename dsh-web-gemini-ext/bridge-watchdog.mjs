// dsh-relay bridge 守护进程（watchdog）
// 作用：持续检测 localhost:8899 的 bridge-server 是否存活，挂了自动拉起。
// 配合 Windows 计划任务实现开机自启 + 崩溃自愈。
// 运行：node bridge-watchdog.mjs
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BRIDGE_PORT = 8899
const BRIDGE_SCRIPT = 'bridge-server.mjs'
// node 可执行文件真实路径（nvm 的 nodejs 是 symlink，spawn 在部分环境解析失败；
// DSH_NODE_EXE 可覆盖；默认用当前进程真实路径，若为 symlink 则解引用到 nvm 实际目录）
const NODE_EXE = process.env.DSH_NODE_EXE
  || (() => {
      try { return fs.realpathSync(process.execPath) } catch { return process.execPath }
    })()
const WORKDIR = dirname(fileURLToPath(import.meta.url))   // 脚本所在目录（正确处理空格/URL 编码）
const CHECK_INTERVAL_MS = 5000
const RESTART_DELAY_MS = 2000

let child = null
let restarts = 0
let lastRestartAt = 0

function bridgeAlive() {
  return new Promise((resolve) => {
    // v0.4.0: 探测 /__token（免鉴权端点）而非 /stats（后者 401 会误判 bridge 死亡导致反复重启）
    const req = http.get({ host: '127.0.0.1', port: BRIDGE_PORT, path: '/__token', timeout: 2000 }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
  })
}

function startBridge() {
  const now = Date.now()
  // 限速：1 分钟内最多重启 5 次，防崩溃风暴
  if (now - lastRestartAt < 60000 && restarts >= 5) {
    console.log(`[watchdog] 1 分钟内重启已达 ${restarts} 次，暂停拉起（防风暴）`)
    return
  }
  restarts += 1
  lastRestartAt = now
  console.log(`[watchdog] 启动 bridge-server（第 ${restarts} 次）...`)
  child = spawn(NODE_EXE, [BRIDGE_SCRIPT], { cwd: WORKDIR, stdio: 'inherit', windowsHide: true })
  child.on('exit', (code, signal) => {
    console.log(`[watchdog] bridge-server 退出（code=${code} signal=${signal}），${RESTART_DELAY_MS}ms 后重启`)
    child = null
    setTimeout(() => { if (!child) startBridge() }, RESTART_DELAY_MS)
  })
  child.on('error', (err) => {
    console.log(`[watchdog] bridge-server 启动失败: ${err.message}`)
    child = null
    setTimeout(() => { if (!child) startBridge() }, RESTART_DELAY_MS)
  })
}

// 主循环：每 5s 探测端口，若 bridge 既无子进程又无监听 → 拉起
async function tick() {
  const alive = await bridgeAlive()
  if (!alive && !child) {
    startBridge()
  } else if (alive && child) {
    // 端口活着但子进程记录还在（可能子进程被外部杀掉但端口被复用）——记录归零
    if (child.exitCode === null && child.signalCode === null && !child.killed) {
      // 子进程仍运行且端口通 → 正常
    } else {
      child = null
    }
  }
}

console.log(`[watchdog] 开始守护 bridge-server @127.0.0.1:${BRIDGE_PORT}（每 ${CHECK_INTERVAL_MS / 1000}s 探测）`)
// 启动时先探测：端口已存活则仅监控；否则拉起
;(async () => {
  const alive = await bridgeAlive()
  if (alive) {
    console.log('[watchdog] 检测到 bridge 已在运行，进入监控模式')
  } else {
    startBridge()
  }
  setInterval(tick, CHECK_INTERVAL_MS)
})()
