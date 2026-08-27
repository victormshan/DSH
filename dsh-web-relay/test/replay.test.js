// v2.5-2/v2.5-3: Trace Replay 离线调试沙盒测试（v2.2.0）
// 运行：node --test test/replay.test.js
// 镜像 lib/index.js replayHandler 的确定性解析逻辑（timeline / review / relatedTrace）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ---- 镜像：timeline 还原（notes → action 序列）----
function buildTimeline(notes) {
  return (notes || []).map((n) => ({ action: n.action, by: n.role, at: n.at, text: n.text }))
}

// ---- 镜像：最终审核记录（最后一个 approved/rejected）----
function lastReview(notes) {
  const lastRev = [...(notes || [])].reverse().find((n) => n.action === 'approved' || n.action === 'rejected')
  return lastRev ? { result: lastRev.action, by: lastRev.role, reason: lastRev.text, at: lastRev.at } : null
}

// ---- 镜像：relatedTrace 过滤（start 时间起，最多 20 条）----
function relatedTrace(entries, startAt, max = 20) {
  let related = entries || []
  if (startAt) related = related.filter((e) => e.at >= startAt)
  return related.slice(-max)
}

test('timeline 还原 notes 状态流转序列', () => {
  const notes = [
    { role: 'mainagent', at: 'T1', action: 'start', text: '' },
    { role: 'mainagent', at: 'T2', action: 'complete', text: '完成' },
    { role: 'external', at: 'T3', action: 'rejected', text: '缺产物' },
    { role: 'mainagent', at: 'T4', action: 'reopen', text: '重提' },
    { role: 'external', at: 'T5', action: 'approved', text: '通过' }
  ]
  const tl = buildTimeline(notes)
  assert.equal(tl.length, 5)
  assert.deepEqual(tl.map((t) => t.action), ['start', 'complete', 'rejected', 'reopen', 'approved'])
  assert.equal(tl[4].by, 'external')
})

test('review：取最后一个 approved/rejected', () => {
  const notes = [
    { role: 'external', action: 'rejected', text: '缺产物', at: 'T3' },
    { role: 'external', action: 'approved', text: '通过', at: 'T5' }
  ]
  const r = lastReview(notes)
  assert.deepEqual(r, { result: 'approved', by: 'external', reason: '通过', at: 'T5' })
  assert.equal(lastReview([]), null)
  assert.equal(lastReview([{ action: 'start' }]), null)
})

test('relatedTrace：start 时间起的 trace 事件', () => {
  const entries = [
    { role: 'user', at: 'T0', text: '旧' },
    { role: 'mainagent', at: 'T1', text: '开始' },
    { role: 'external', at: 'T2', text: '审核' }
  ]
  const r = relatedTrace(entries, 'T1')
  assert.deepEqual(r.map((e) => e.at), ['T1', 'T2'])
})

test('relatedTrace：无 start 时全量，最多 20 条', () => {
  const entries = Array.from({ length: 25 }, (_, i) => ({ at: 'T' + i, text: String(i) }))
  assert.equal(relatedTrace(entries, null).length, 20)
  assert.equal(relatedTrace(entries, null, 20)[0].at, 'T5')
})

test('source 源码含 v2.5-2 Replay 标记（lib/index.js）', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(src.includes('v2.5-2: Trace Replay 离线调试沙盒'))
  assert.ok(src.includes('/dsh-web-relay/replay'))
  assert.ok(src.includes('offline: true'))
  assert.ok(src.includes('relatedTrace'))
  assert.ok(src.includes('lastRev'))
})

test('source 源码含 v2.2.1 Replay 面板 UI 标记（lib/client.js）', () => {
  const client = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(client.includes('v2.5-2 (UI): Trace Replay 离线复现'))
  assert.ok(client.includes('v2.5-2 (UI): Trace Replay 还原结果展示'))
  assert.ok(client.includes('runReplay'))
  assert.ok(client.includes('/dsh-web-relay/replay'))
  assert.ok(client.includes('replayTitle'))
})
