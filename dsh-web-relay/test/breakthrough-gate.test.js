// P3(v3.5.0): Architect 突破度门禁测试（纯函数镜像 lib/breakthrough-gate.js）
// 运行：node --test test/breakthrough-gate.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { breakthroughTypeOf, versionTypeOf, auditBreakthrough } from '../lib/breakthrough-gate.js'

test('breakthroughTypeOf：识别三种类型与来源字段（顶层/architect_vision）', () => {
  assert.equal(breakthroughTypeOf({ breakthrough_type: 'Incremental' }), 'incremental')
  assert.equal(breakthroughTypeOf({ breakthrough_type: 'STRUCTURAL' }), 'structural')
  assert.equal(breakthroughTypeOf({ architect_vision: { breakthrough_type: 'paradigm' } }), 'paradigm')
  assert.equal(breakthroughTypeOf({ title: '重构' }), null)
  assert.equal(breakthroughTypeOf(null), null)
})

test('versionTypeOf：含 breakthrough 的版本优先计为突破', () => {
  assert.equal(versionTypeOf([{ breakthrough_type: 'incremental' }, { breakthrough_type: 'paradigm' }]), 'breakthrough')
  assert.equal(versionTypeOf([{ breakthrough_type: 'incremental' }, { title: 'x' }]), 'incremental')
  assert.equal(versionTypeOf([{ title: 'x' }]), null)
})

test('auditBreakthrough：连续 2 个 Incremental 版本触发 warn；突破项重置', () => {
  const inc = [{ breakthrough_type: 'incremental' }]
  const v1 = auditBreakthrough(inc, 0)
  assert.equal(v1.streak, 1)
  assert.equal(v1.warn, null)
  const v2 = auditBreakthrough(inc, v1.streak)
  assert.equal(v2.streak, 2)
  assert.ok(v2.warn.includes('连续 2 个版本为 Incremental'))
  // 第三版含 paradigm → 重置
  const v3 = auditBreakthrough([{ breakthrough_type: 'paradigm' }], v2.streak)
  assert.equal(v3.streak, 0)
  assert.equal(v3.warn, null)
})

test('auditBreakthrough：unknown 版不计不重置（防误报）', () => {
  const r = auditBreakthrough([{ title: '探路' }], 1)
  assert.equal(r.streak, 1)
  assert.equal(r.warn, null)
})

test('source 含 P3 门禁标记（lib/breakthrough-gate.js + index.js）', () => {
  const b = fs.readFileSync(new URL('../lib/breakthrough-gate.js', import.meta.url), 'utf8')
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(b.includes('P3(v3.5.0)'))
  assert.ok(src.includes('auditBreakthrough'))
  assert.ok(src.includes('Architect 突破度门禁'))
})
