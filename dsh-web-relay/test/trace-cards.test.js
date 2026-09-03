// v3.4.0 V2 Step1: 多版本轨迹分组卡片 + reviewedBy 审核来源识别（镜像函数测试）
// 运行：node --test test/trace-cards.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'

// ---- 镜像 A：把 trace entries 按 AutoIteration 版本标记分组 ----
function groupTraceByVersion(entries) {
  const groups = []
  let cur = { version: null, total: null, items: [] }
  const pushCur = () => { if (cur.items.length) groups.push(cur) }
  for (const e of entries || []) {
    const text = String(e.text || '')
    const vm = text.match(/(?:迭代[:：]?\s*)?V(\d+)\/(\d+)|【V(\d+)|(?:^|\s)V(\d+)\s*[-—:：]?\s*(?:版间门|完成|评审|restructure|收口)/)
    const v = vm ? (vm[1] || vm[3] || vm[4]) : null
    if (v && cur.version !== v) {
      pushCur()
      cur = { version: v, total: (vm && vm[2]) || null, items: [] }
    }
    cur.items.push(e)
  }
  pushCur()
  return groups
}

// ---- 镜像 B：从 trace 文本识别审核来源角色（优先级：显式 reviewedBy → external/dialog/manual 强信号 → mainagent 弱信号）----
function reviewedByFromText(text) {
  const t = String(text || '')
  const m = t.match(/reviewedBy[:：]?\s*(\w+)/i)
  if (m) {
    const r = m[1].toLowerCase()
    if (r === 'external' || r === 'dialog' || r === 'manual' || r === 'mainagent') return r
  }
  if (/外部 ?AI|external/i.test(t)) return 'external'
  if (/对话模型|dialog|兜底/i.test(t)) return 'dialog'
  if (/manual ?审核|手动审核|用户手动/i.test(t)) return 'manual'
  if (/mainagent|主 ?agent 代审|自动豁免/i.test(t)) return 'mainagent'
  return null
}

const ROLE_ENTRY = (role, text) => ({ role, at: '2026-09-03T01:27:21.131Z', text })

test('版本分组：无版本标记归入总览组', () => {
  const g = groupTraceByVersion([ROLE_ENTRY('user', '对本插件自动迭代3个版本')])
  assert.equal(g.length, 1)
  assert.equal(g[0].version, null)
})

test('版本分组：按“迭代: V1/3”与【V2 标记切组并带 total', () => {
  const entries = [
    ROLE_ENTRY('user', '对本插件自动迭代3个版本'),
    ROLE_ENTRY('mainagent', '迭代: V1/3 已完成，达到迭代上限'),
    ROLE_ENTRY('mainagent', '【V2 restructure（外部 AI 授权）】已落盘'),
    ROLE_ENTRY('mainagent', '【V2 实施】轨迹卡片化完成')
  ]
  const g = groupTraceByVersion(entries)
  assert.equal(g.length, 3)
  assert.equal(g[0].version, null)
  assert.equal(g[1].version, '1')
  assert.equal(g[1].total, '3')
  assert.equal(g[2].version, '2')
})

test('审核来源识别：external/dialog/manual/mainagent 与中文叙述', () => {
  assert.equal(reviewedByFromText('外部 AI 自动审核通过 Step 1'), 'external')
  assert.equal(reviewedByFromText('对话模型（无工具） 自动审核通过 Step 2（dialog 兜底）'), 'dialog')
  assert.equal(reviewedByFromText('manual 审核：主 agent 代审 Step 3'), 'manual')
  assert.equal(reviewedByFromText('mainagent 自动豁免 Step 4（review:false）'), 'mainagent')
  assert.equal(reviewedByFromText('reviewedBy: dialog'), 'dialog')
  assert.equal(reviewedByFromText('普通回复内容无审核来源'), null)
})

test('版本分组：reviewedBy 识别不与分组互相干扰（纯函数隔离）', () => {
  const text = '主 agent 代审 Step 3（manual 审核（降级链终点））'
  assert.equal(reviewedByFromText(text), 'manual')
})
