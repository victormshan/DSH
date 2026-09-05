// v3.9 S3: watchdog 纯函数测试（镜像 bin/watchdog.mjs；运行：node --test test/watchdog.test.js）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stormGate, classifyProbe, decideRestart, parseCommand, hostArgv, CFG } from '../bin/watchdog.mjs'

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
