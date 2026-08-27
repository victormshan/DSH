// v2.1-2/v2.1-3: 面板 DAG 拓扑分层渲染测试（v2.0.0）
// 运行：node --test test/dag-viewer.test.js
// 镜像 lib/client.js 的 dagLayers / colorOfStatus 确定性逻辑。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ---- 镜像：DAG 分层（与 client.js dagLayers 一致）----
function dagLayers(list) {
  const byId = new Map((list || []).map((s) => [String(s.id), s]))
  const layerOf = new Map()
  const calc = (s) => {
    const k = String(s.id)
    if (layerOf.has(k)) return layerOf.get(k)
    const deps = Array.isArray(s.depends_on) ? s.depends_on : []
    let L = 0
    for (const d of deps) {
      const dep = byId.get(String(d))
      if (dep) L = Math.max(L, calc(dep) + 1)
    }
    layerOf.set(k, L)
    return L
  }
  for (const s of list || []) calc(s)
  const groups = {}
  for (const s of list || []) {
    const g = s.parallel_group
    if (g) groups[g] = Math.max(groups[g] || 0, layerOf.get(String(s.id)) || 0)
  }
  for (const s of list || []) {
    const g = s.parallel_group
    if (g) layerOf.set(String(s.id), groups[g])
  }
  const layers = []
  for (const s of list || []) {
    const L = layerOf.get(String(s.id)) || 0
    layers[L] = layers[L] || []
    layers[L].push(s)
  }
  return layers.filter(Boolean)
}

const colorOfStatus = (st) => st === 'approved' ? '#4ade80' : st === 'review' ? '#fbbf24' : st === 'executing' ? '#60a5fa' : st === 'rejected' ? '#f87171' : st === 'paused' ? '#ef4444' : '#71717a'

test('串行链分层：A→B→C 为 3 层', () => {
  const steps = [
    { id: 'A', depends_on: [] },
    { id: 'B', depends_on: ['A'] },
    { id: 'C', depends_on: ['B'] }
  ]
  const L = dagLayers(steps)
  assert.equal(L.length, 3)
  assert.deepEqual(L.map((l) => l.map((s) => s.id)), [['A'], ['B'], ['C']])
})

test('并行分支分层：多根依赖合并到同层', () => {
  const steps = [
    { id: 'R1', depends_on: [] },
    { id: 'R2', depends_on: [] },
    { id: 'X', depends_on: ['R1', 'R2'] }
  ]
  const L = dagLayers(steps)
  assert.equal(L.length, 2)
  assert.deepEqual(L[0].map((s) => s.id).sort(), ['R1', 'R2'])
  assert.deepEqual(L[1].map((s) => s.id), ['X'])
})

test('parallel_group 强制同层', () => {
  const steps = [
    { id: 'P', depends_on: [], parallel_group: 'G' },
    { id: 'Q', depends_on: ['P'], parallel_group: 'G' },
    { id: 'Z', depends_on: ['P'] }
  ]
  const L = dagLayers(steps)
  // 组 G 取组内最大层（Q 的层 1），P 被拉到同层 → P/Q 同层；Z 依赖 P 也在层 1 → 全部 1 层
  assert.equal(L.length, 1)
  const ids = L[0].map((s) => s.id).sort()
  assert.deepEqual(ids, ['P', 'Q', 'Z'])
})

test('悬空依赖安全：不存在的依赖被忽略，步骤在 0 层', () => {
  const steps = [
    { id: 'A', depends_on: ['missing'] }
  ]
  const L = dagLayers(steps)
  assert.equal(L.length, 1)
  assert.deepEqual(L[0].map((s) => s.id), ['A'])
})

test('状态色映射', () => {
  assert.equal(colorOfStatus('approved'), '#4ade80')
  assert.equal(colorOfStatus('review'), '#fbbf24')
  assert.equal(colorOfStatus('executing'), '#60a5fa')
  assert.equal(colorOfStatus('rejected'), '#f87171')
  assert.equal(colorOfStatus('paused'), '#ef4444')
  assert.equal(colorOfStatus('pending'), '#71717a')
})

test('source 源码含 v2.1-2 DAG 渲染标记（client.js）', () => {
  const src = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(src.includes('v2.1-2: DAG 拓扑分层'))
  assert.ok(src.includes('v2.1-2: DAG 拓扑图预览'))
  assert.ok(src.includes('dagLayers'))
  assert.ok(src.includes('dagPreviewTitle'))
})
