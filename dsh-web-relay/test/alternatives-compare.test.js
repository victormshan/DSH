// v4.9/v2.0: alternatives 多方案裁决模块单测（真实模块 lib/alternatives-compare.js）
// 运行：node --test test/alternatives-compare.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeAlternatives,
  buildAlternativesReviewPrompt,
  parseAlternativesDecision
} from '../lib/alternatives-compare.js'

const ALT_FIXTURE = [
  { name: '方案A-直改', summary: '在现有文件上直接修改，改动最小', pros: '快、风险低', cons: '复用度一般' },
  { name: '方案B-抽取模块', summary: '抽出独立模块再接入', pros: '可复用、结构清晰', cons: '改动面大' }
]

test('normalizeAlternatives：非数组 → []', () => {
  assert.deepEqual(normalizeAlternatives(null), [])
  assert.deepEqual(normalizeAlternatives('x'), [])
  assert.deepEqual(normalizeAlternatives({}), [])
})

test('normalizeAlternatives：对象元素保字段并补齐 name', () => {
  const out = normalizeAlternatives(ALT_FIXTURE)
  assert.equal(out.length, 2)
  assert.equal(out[0].name, '方案A-直改')
  assert.equal(out[0].pros, '快、风险低')
  assert.equal(out[1].cons, '改动面大')
  const minimal = normalizeAlternatives([{ summary: '只有概述' }])
  assert.equal(minimal[0].name, '方案1')
})

test('normalizeAlternatives：字符串元素包装', () => {
  const out = normalizeAlternatives(['直接干', 42])
  assert.equal(out[0].summary, '直接干')
  assert.equal(out[1].summary, '42')
})

test('buildAlternativesReviewPrompt：6 段关键内容齐全', () => {
  const p = buildAlternativesReviewPrompt({
    exprId: 'expr-2026-09-06_16-32-52',
    step: { id: 'v9_1', title: 't', detail: 'd', acceptance: 'a', alternatives: ALT_FIXTURE, notes: [{ role: 'mainagent', action: 'complete', at: 'now', text: '证据' }] },
    recordText: 'rec', traceText: 'trace'
  })
  assert.ok(p.includes('expr-2026-09-06_16-32-52'))
  assert.ok(p.includes('验收标准：a'))
  assert.ok(p.includes('[0] 方案A-直改'))
  assert.ok(p.includes('[1] 方案B-抽取模块'))
  assert.ok(p.includes('优点：快、风险低'))
  assert.ok(p.includes('【执行证据（④）】'))
  assert.ok(p.includes('【任务记录摘要（⑤）】'))
  assert.ok(p.includes('【三方轨迹（⑤）】'))
  assert.ok(p.includes('"chosen"'))
  assert.ok(p.includes('"scores"'))
  assert.ok(p.includes('证据'))
})

test('parseAlternativesDecision：合法 JSON chosen=0 → ok 且归一', () => {
  const text = '{"chosen": 0, "rationale": "改动最小最快", "scores": [{"index":0,"score":9,"pros":"快","cons":"复用一般"},{"index":1,"score":6,"pros":"可复用","cons":"改动大"}]}'
  const r = parseAlternativesDecision(text, ALT_FIXTURE)
  assert.equal(r.ok, true)
  assert.equal(r.decision.chosen, 0)
  assert.equal(r.decision.chosenName, '方案A-直改')
  assert.equal(r.decision.rationale, '改动最小最快')
  assert.equal(r.decision.scores.length, 2)
  assert.equal(r.decision.scores[1].score, 6)
})

test('parseAlternativesDecision：chosen 用 name 匹配 → 归一为 index', () => {
  const r = parseAlternativesDecision('{"chosen": "方案B-抽取模块", "rationale": "结构清晰"}', ALT_FIXTURE)
  assert.equal(r.ok, true)
  assert.equal(r.decision.chosen, 1)
  assert.equal(r.decision.chosenName, '方案B-抽取模块')
})

test('parseAlternativesDecision：无 alternatives 上下文时 name 保留原样', () => {
  const r = parseAlternativesDecision('{"chosen": "方案X", "rationale": "r"}', null)
  assert.equal(r.ok, true)
  assert.equal(r.decision.chosen, '方案X')
})

test('parseAlternativesDecision：空回复/非 JSON → ok false', () => {
  assert.equal(parseAlternativesDecision('', ALT_FIXTURE).ok, false)
  assert.equal(parseAlternativesDecision('完全不是 JSON', ALT_FIXTURE).ok, false)
})

test('parseAlternativesDecision：chosen 越界 → ok false', () => {
  const r = parseAlternativesDecision('{"chosen": 99, "rationale": "越界"}', ALT_FIXTURE)
  assert.equal(r.ok, false)
  assert.ok(r.error.includes('越界') || r.error.includes('chosen'))
})
