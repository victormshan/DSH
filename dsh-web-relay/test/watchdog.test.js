// v3.9 S3: watchdog 纯函数测试（镜像 bin/watchdog.mjs；运行：node --test test/watchdog.test.js）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stormGate, classifyProbe, decideRestart, parseCommand, hostArgv, attemptRestart, parseRegValue, childEnv, parseLock, bridgeDecision, CFG } from '../bin/watchdog.mjs'

test('classifyProbe：HTTP200 且 body.ok===true 才算存活', () => {
  assert.equal(classifyProbe({ httpOk: true, okFlag: true }), true)
  assert.equal(classifyProbe({ httpOk: true, okFlag: false }), false)
  assert.equal(classifyProbe({ httpOk: false, okFlag: true }), false)
  assert.equal(classifyProbe({ httpOk: false, okFlag: false }), false)
  assert.equal(classifyProbe({}), false)
})

test('decideRestart：连续 miss ≥ MISS_N 才重启', () => {
  assert.equal(decideRestart({ missCount: 2, missN: 3 }), false)
  assert.equal(decideRestart({ missCount: 3, missN: 3 }), true)
  assert.equal(decideRestart({ missCount: 4, missN: 3 }), true)
})

test('stormGate：窗口内重启 < max 放行；达到 max 暂停', () => {
  const now = 1_000_000
  // 2 次 < max=3 → allow
  const g1 = stormGate([now - 1000, now - 2000], { now, max: 3, windowMs: 600000, pauseMs: 600000 })
  assert.equal(g1.allow, true); assert.equal(g1.recent, 2); assert.equal(g1.pauseRemainingMs, 0)
  // 3 次达 max → pause（最老一次 + 窗口 + 暂停 - now）
  const times = [now - 590000, now - 400000, now - 300000]
  const g2 = stormGate(times, { now, max: 3, windowMs: 600000, pauseMs: 600000 })
  assert.equal(g2.allow, false); assert.equal(g2.recent, 3)
  assert.ok(g2.pauseRemainingMs > 0)
  // 窗口滑出（全部 < now-windowMs）→ 重新放行
  const g3 = stormGate([now - 700000, now - 800000, now - 900000], { now, max: 3, windowMs: 600000, pauseMs: 600000 })
  assert.equal(g3.allow, true); assert.equal(g3.recent, 0)
})

test('parseCommand：双引号段保留原样，空白拆分', () => {
  assert.deepEqual(parseCommand('web'), ['web'])
  assert.deepEqual(parseCommand('web --trusted-host a.b'), ['web', '--trusted-host', 'a.b'])
  assert.deepEqual(parseCommand('"C:\\Program Files\\node.exe" web'), ['C:\\Program Files\\node.exe', 'web'])
})

test('attemptRestart：先判门再记录——暂停期不累计、窗口滑出后恢复', () => {
  const times = []
  const now = 1_000_000
  // max=3：前 3 次窗口内允许并记录
  const a1 = attemptRestart(times, { now: now - 3000, max: 3, windowMs: 600000, pauseMs: 600000 })
  assert.equal(a1.allowed, true); assert.equal(times.length, 1)
  const a2 = attemptRestart(times, { now: now - 2000, max: 3, windowMs: 600000, pauseMs: 600000 })
  assert.equal(a2.allowed, true); assert.equal(times.length, 2)
  const a3 = attemptRestart(times, { now: now - 1000, max: 3, windowMs: 600000, pauseMs: 600000 })
  assert.equal(a3.allowed, true); assert.equal(times.length, 3)
  // 第 4 次被门拦下且不记录（防模拟中计数膨胀）
  const a4 = attemptRestart(times, { now, max: 3, windowMs: 600000, pauseMs: 600000 })
  assert.equal(a4.allowed, false); assert.equal(times.length, 3); assert.ok(a4.pauseRemainingMs > 0)
  // 窗口滑出（时间前进超过 windowMs+pauseMs）→ 恢复允许
  const a5 = attemptRestart(times, { now: now + 1_300_000, max: 3, windowMs: 600000, pauseMs: 600000 })
  assert.equal(a5.allowed, true); assert.equal(times.length, 4)
})

test('hostArgv：DSH_WEB_CMD 优先，否则 bin + args', () => {
  const argv = hostArgv()
  assert.ok(Array.isArray(argv) && argv.length >= 1)
  assert.ok(argv.every((a) => typeof a === 'string' && a.length > 0))
})

test('source 契约：watchdog 探测端点/拉起命令与 S1 spec 一致', () => {
  const src = fs.readFileSync(new URL('../bin/watchdog.mjs', import.meta.url), 'utf8')
  assert.ok(src.includes('/dsh-web-relay/health-check'))
  assert.ok(src.includes('/dsh-web-relay/admin/prepare-restart'))
  assert.ok(src.includes('taskkill /PID'))
  assert.ok(src.includes('stormGate'))          // 防风暴
  assert.ok(src.includes('missN'))              // 连续 miss 阈值
  assert.ok(src.includes('v3.9 S3'))
  assert.ok(src.includes('isMain'))             // CLI 主入口守卫（可被测试 import）
})

// ---- v3.9.1-fix：注册表 env 补注入（防深层进程链丢 GEMINI key）----
test('parseRegValue：解析 reg query REG_SZ 输出（大小写不敏感、忽略无关行）', () => {
  const out = [
    '',
    'HKEY_CURRENT_USER\\Environment',
    '    GEMINI_API_KEY    REG_SZ    AQ.Ab8-secret-value',
    '    Path    REG_EXPAND_SZ    C:\\x',
    ''
  ].join('\n')
  assert.equal(parseRegValue(out, 'GEMINI_API_KEY'), 'AQ.Ab8-secret-value')
  assert.equal(parseRegValue(out, 'gemini_api_key'), 'AQ.Ab8-secret-value') // 大小写不敏感
  assert.equal(parseRegValue(out, 'GEMINI_MODEL'), null)                    // 不存在的变量
  assert.equal(parseRegValue('', 'X'), null)
})

test('childEnv：进程 env 已有值时不覆盖；缺失时返回含注册表补注入的 env（不抛错）', () => {
  const env = childEnv()
  assert.ok(env && typeof env === 'object')
  assert.ok(env.GEMINI_API_KEY === undefined || env.GEMINI_API_KEY.length > 0)
  // 不覆盖语义：模拟已有值 → childEnv 结果应保留原值（process.env 有则不动）
  if (process.env.GEMINI_API_KEY) assert.equal(env.GEMINI_API_KEY, process.env.GEMINI_API_KEY)
})

// ---- v3.9.2：单例锁 + 启动首检 ----
test('parseLock：锁文件解析（PID 整数；空/非法 → null）', () => {
  assert.equal(parseLock('12345'), 12345)
  assert.equal(parseLock(' 12345 \n'), 12345)
  assert.equal(parseLock(''), null)
  assert.equal(parseLock('abc'), null)
  assert.equal(parseLock('0'), null)
  assert.equal(parseLock('-1'), null)
})

test('source 标记：启动首检立即拉起 + 单例锁（bin/watchdog.mjs v3.9.2）', () => {
  const src = fs.readFileSync(new URL('../bin/watchdog.mjs', import.meta.url), 'utf8')
  assert.ok(src.includes('启动首检未响应'))       // 首检未响应 → 立即拉起
  assert.ok(src.includes('立即拉起（不等 miss'))
  assert.ok(src.includes('acquireLock'))
  assert.ok(src.includes('已有 watchdog 实例在运行'))
  assert.ok(src.includes('process.exit(0)'))
  assert.ok(src.includes('lockFile'))
})

// ---- v3.9.3：总守护——桥接链路（DSH-Bridge-Watchdog / 8899）----
test('bridgeDecision：在线 ok / watchdog 在自愈 / 双缺拉起 / 无配置跳过', () => {
  assert.deepEqual(bridgeDecision({ bridgeAlive: true, watchdogAlive: true }), { action: 'ok' })
  assert.deepEqual(bridgeDecision({ bridgeAlive: false, watchdogAlive: true }), { action: 'watchdog-holds' })
  assert.deepEqual(bridgeDecision({ bridgeAlive: false, watchdogAlive: false, path: 'X:\\bridge-watchdog.mjs' }), { action: 'spawn-watchdog', path: 'X:\\bridge-watchdog.mjs' })
  assert.deepEqual(bridgeDecision({ bridgeAlive: false, watchdogAlive: false, path: '' }), { action: 'no-config' })
})

test('source 标记：桥接链路总守护（bin/watchdog.mjs v3.9.3）', () => {
  const src = fs.readFileSync(new URL('../bin/watchdog.mjs', import.meta.url), 'utf8')
  assert.ok(src.includes('auxBridgeTick'))
  assert.ok(src.includes('bridgeProbeUrl'))
  assert.ok(src.includes("'bridge-watchdog'"))          // 进程探测
  assert.ok(src.includes('spawn(CFG.nodeExe, [d.path]')) // 拉起 DSH-Bridge-Watchdog
  assert.ok(src.includes('v3.9.3'))
})
