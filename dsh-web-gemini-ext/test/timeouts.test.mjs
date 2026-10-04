// 超时链：content.js / background.js / bridge-server.mjs 中的 @timeouts 块必须逐字一致，
// 且对任意提示长度满足 content 最坏耗时 < background 等待 < bridge 判超时。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const FILES = ['content.js', 'background.js', 'bridge-server.mjs']

function block(file) {
  const src = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const start = src.indexOf('// @timeouts-begin')
  const end = src.indexOf('// @timeouts-end')
  assert.ok(start >= 0 && end > start, `${file} 缺少 @timeouts 块`)
  return src.slice(start, end)
}

function fns() {
  const ctx = {}
  vm.createContext(ctx)
  vm.runInContext(block('content.js') + '\nthis.f = { sendSettleMsFor, replyMaxMsFor, contentBudgetMsFor, backgroundTimeoutMsFor, bridgeProcessingTimeoutMsFor }', ctx)
  return ctx.f
}

test('三处 @timeouts 块逐字一致（单一事实来源）', () => {
  const [a, b, c] = FILES.map(block)
  assert.equal(b, a, 'background.js 与 content.js 不一致')
  assert.equal(c, a, 'bridge-server.mjs 与 content.js 不一致')
})

test('任意提示长度：content < background < bridge，且 bridge 不低于原 120s', () => {
  const f = fns()
  for (const len of [0, 1, 500, 6000, 10000, 35000, 200000]) {
    const c = f.contentBudgetMsFor(len)
    const b = f.backgroundTimeoutMsFor(len)
    const r = f.bridgeProcessingTimeoutMsFor(len)
    assert.ok(c < b && b < r, `len=${len}: ${c} < ${b} < ${r}`)
    assert.ok(r >= 120000)
  }
})

test('等回答上限随长度增长（长审核 ≥ 3 分钟），有上限', () => {
  const f = fns()
  assert.equal(f.replyMaxMsFor(0), 60000)
  assert.ok(f.replyMaxMsFor(8000) >= 180000)
  assert.equal(f.replyMaxMsFor(1e6), 240000)
  assert.equal(f.sendSettleMsFor(0), 2000)
  assert.equal(f.sendSettleMsFor(1e6), 10000)
})

test('接线：三处都实际使用了按长度计算的超时', () => {
  const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
  assert.match(src('content.js'), /waitReply\(replyMax,/)
  assert.match(src('content.js'), /\.slice\(0, SEND_CANDIDATES_MAX\)/)
  assert.match(src('background.js'), /SEND_TIMEOUT_MS = backgroundTimeoutMsFor\(/)
  assert.match(src('bridge-server.mjs'), /bridgeProcessingTimeoutMsFor\(String\(t\.prompt/)
  // background 超时后不重发（避免重复提问）
  assert.match(src('background.js'), /resp = null\n\s+break/)
})
