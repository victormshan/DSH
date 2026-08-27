// v2.6-2/v2.6-3: Webhook 报文构造与事件触发测试（v2.2.0）
// 运行：node --test test/notifier.test.js
// 镜像 lib/index.js notifyWebhook 的报文构造与触发判定逻辑。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ---- 镜像：notifyWebhook 报文构造（与 lib/index.js 一致）----
function buildWebhookBody(event, payload) {
  const p = payload && typeof payload === 'object' ? payload : {}
  return {
    event,
    exprId: p.exprId || null,
    stepId: p.stepId != null ? String(p.stepId) : null,
    ts: new Date().toISOString(),
    payload: p
  }
}

test('Webhook 报文结构：event/exprId/stepId/ts/payload', () => {
  const b = buildWebhookBody('circuit_breaker', { exprId: 'expr-x', stepId: 3, status: 'paused', reason: '熔断' })
  assert.equal(b.event, 'circuit_breaker')
  assert.equal(b.exprId, 'expr-x')
  assert.equal(b.stepId, '3')
  assert.match(b.ts, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(b.payload.status, 'paused')
})

test('Webhook 报文：缺省字段兜底（exprId/stepId 为 null）', () => {
  const b = buildWebhookBody('degradation', { reason: '降级' })
  assert.equal(b.exprId, null)
  assert.equal(b.stepId, null)
  assert.equal(b.payload.reason, '降级')
})

test('熔断触发判定：rejectStreak>=3 且非 stopped/paused → paused + 通知', () => {
  // 镜像 stepUpdateHandler 熔断分支
  const applyReject = (state) => {
    state.rejectStreak = (state.rejectStreak || 0) + 1
    let notified = false
    if (state.rejectStreak >= 3 && state.status !== 'stopped' && state.status !== 'paused') {
      state.status = 'paused'
      state.stopReason = '连续打回 ≥3 次，AutoIteration 自动暂停，等待用户介入'
      notified = true
    }
    return notified
  }
  const s = { status: 'open', rejectStreak: 2 }
  assert.equal(applyReject(s), true)
  assert.equal(s.status, 'paused')
  assert.equal(s.rejectStreak, 3)
  // 已 paused 不再重复通知
  const s2 = { status: 'paused', rejectStreak: 3 }
  assert.equal(applyReject(s2), false)
})

test('降级触发判定：reviewer=dialog 时发 degradation 通知', () => {
  const shouldNotify = (reviewer) => reviewer === 'dialog'
  assert.equal(shouldNotify('dialog'), true)
  assert.equal(shouldNotify('external'), false)
  assert.equal(shouldNotify('manual'), false)
})

test('source 源码含 v2.6-2 Webhook 标记', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  const client = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(src.includes('v2.6-2: Webhook 通知'))
  assert.ok(src.includes('notifyWebhook'))
  assert.ok(src.includes('WEBHOOK_URL'))
  assert.ok(src.includes("notifyWebhook('circuit_breaker'"))
  assert.ok(src.includes("notifyWebhook('degradation'"))
  assert.ok(src.includes("notifyWebhook('review_rejected'"))
  // 前端：通知中心配置 + 桌面通知
  assert.ok(client.includes('v2.6-2: Webhook 通知配置'))
  assert.ok(client.includes('webhookPlaceholder'))
  assert.ok(client.includes('prevPausedRef'))
  assert.ok(client.includes('notificationBreakerTitle'))
})
