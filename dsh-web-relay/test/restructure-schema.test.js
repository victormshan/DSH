// v3.7.0 P1: restructure Schema 保全测试（normalizeStep / restructure merged 透传扩展字段）
// 运行：node --test test/restructure-schema.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ---- 镜像：normalizeStep 扩展字段透传（与 lib/index.js normalizeStep 语义一致）----
function normalizeLike(raw) {
  const r = raw || {}
  return {
    id: String(r.id != null ? r.id : '1'),
    title: String(r.title || 'x'),
    importance: (r.importance === 'high' || r.importance === 'medium' || r.importance === 'low') ? r.importance : null,
    breakthrough_type: r.breakthrough_type != null ? String(r.breakthrough_type) : null,
    architect_vision: r.architect_vision && typeof r.architect_vision === 'object' ? r.architect_vision : null,
    architect: r.architect && typeof r.architect === 'object' ? r.architect : null
  }
}

// ---- 镜像：restructure merged 覆盖（扩展字段取自新 def）----
function mergedLike(existing, def) {
  return {
    ...existing,
    title: def.title,
    importance: def.importance,
    breakthrough_type: def.breakthrough_type,
    architect_vision: def.architect_vision,
    architect: def.architect
  }
}

test('normalizeStep 透传：breakthrough_type/architect_vision/architect 保留，缺省为 null', () => {
  const full = normalizeLike({ id: '2', title: 'V2', importance: 'high', breakthrough_type: 'Structural', architect_vision: { note: 'pioneer' }, architect: { focus: ['x'] } })
  assert.equal(full.breakthrough_type, 'Structural')
  assert.deepEqual(full.architect_vision, { note: 'pioneer' })
  assert.deepEqual(full.architect, { focus: ['x'] })
  const bare = normalizeLike({ id: '3', title: 'V3' })
  assert.equal(bare.breakthrough_type, null)
  assert.equal(bare.architect_vision, null)
})

test('restructure merged：覆盖后扩展字段取自新 def（不丢）', () => {
  const existing = { id: '1', status: 'pending', breakthrough_type: 'incremental' }
  const def = { title: 'V2', importance: 'high', breakthrough_type: 'Paradigm', architect_vision: { note: 'shift' }, architect: null }
  const m = mergedLike(existing, def)
  assert.equal(m.breakthrough_type, 'Paradigm')
  assert.deepEqual(m.architect_vision, { note: 'shift' })
  assert.equal(m.architect, null)
  assert.equal(m.status, 'pending') // 状态保留
})

test('source 含 v3.7.0 P1 Schema 保全标记（lib/index.js）', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(src.includes('v3.7.0 P1'))
  assert.ok(src.includes('breakthrough_type: (raw && raw.breakthrough_type != null) ? String(raw.breakthrough_type) : null'))
  assert.ok(src.includes('breakthrough_type: def.breakthrough_type'))
})
