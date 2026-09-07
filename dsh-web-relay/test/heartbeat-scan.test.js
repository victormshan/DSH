// v4.9.2: 心跳自查信号扫描单测（真实模块 lib/heartbeat-scan.js）
// 运行：node --test test/heartbeat-scan.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanExprSignals, scanPendingSignals } from '../lib/heartbeat-scan.js'

const now = Date.now()
const base = (over) => ({
  exprId: 'expr-2026-09-07_08-00-00',
  status: 'open', phase: 'executing', autoReview: true, finalized: false,
  updatedAt: new Date(now - 60000).toISOString(),
  activeSteps: [], steps: [], ...over
})

test('scanExprSignals：无待办 → 空信号', () => {
  const st = base({ status: 'done', finalized: true, steps: [{ id: 'a', status: 'approved' }] })
  assert.deepEqual(scanExprSignals(st, { now }).signals, [])
})

test('review-pending：有 review 状态步骤', () => {
  const st = base({ steps: [{ id: 'r1', title: '待审', status: 'review' }] })
  const r = scanExprSignals(st, { now })
  assert.ok(r.signals.includes('review-pending'))
  assert.ok(r.detail[0].includes('r1'))
})

test('rejected-pending：有 rejected 步骤', () => {
  const st = base({ steps: [{ id: 'x1', status: 'rejected' }] })
  const r = scanExprSignals(st, { now })
  assert.ok(r.signals.includes('rejected-pending'))
})

test('executing-stale：executing 且超阈值无进展', () => {
  const st = base({
    status: 'executing',
    updatedAt: new Date(now - 3600000).toISOString(), // 1h 前
    steps: [{ id: 'e1', status: 'executing' }]
  })
  const r = scanExprSignals(st, { now, staleMs: 1200000 })
  assert.ok(r.signals.includes('executing-stale'))
})

test('executing 未超阈值 → 无 stale 信号', () => {
  const st = base({
    status: 'executing',
    updatedAt: new Date(now - 60000).toISOString(),
    steps: [{ id: 'e1', status: 'executing' }]
  })
  assert.ok(!scanExprSignals(st, { now, staleMs: 1200000 }).signals.includes('executing-stale'))
})

test('finalize-pending：全 approved 未收口', () => {
  const st = base({ steps: [{ id: 'a', status: 'approved' }, { id: 'b', status: 'approved' }] })
  const r = scanExprSignals(st, { now })
  assert.ok(r.signals.includes('finalize-pending'))
})

test('resume-circuit-paused：续跑熔断 paused', () => {
  const st = base({ status: 'paused', stopReason: '宿主重启续跑熔断：…', steps: [{ id: 'a', status: 'executing' }] })
  const r = scanExprSignals(st, { now })
  assert.ok(r.signals.includes('resume-circuit-paused'))
})

test('scanPendingSignals：只返回有信号的 expr 且保序', () => {
  const a = base({ exprId: 'expr-1', steps: [{ id: 'r', status: 'review' }] })
  const b = base({ exprId: 'expr-2', status: 'done', finalized: true, steps: [{ id: 'a', status: 'approved' }] })
  const c = base({ exprId: 'expr-3', steps: [{ id: 'x', status: 'rejected' }] })
  const out = scanPendingSignals([a, b, c], { now })
  assert.deepEqual(out.map((x) => x.exprId), ['expr-1', 'expr-3'])
})

test('scanExprSignals：无效输入容错', () => {
  assert.deepEqual(scanExprSignals(null).signals, [])
  assert.deepEqual(scanExprSignals({}).signals, [])
})
