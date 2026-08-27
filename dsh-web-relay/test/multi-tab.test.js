// v2.3-1/v2.3-2: web-gemini 扩展多 Tab 负载均衡测试（v2.0.0）
// 运行：node --test test/multi-tab.test.js
// 镜像 background.js 的 pickIdleTab / 活跃度维护确定性逻辑。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ---- 镜像：pickIdleTab（最久未用优先；单标签页恒选它）----
function makePicker(activity) {
  return function pickIdleTab(tabs) {
    if (!tabs || tabs.length === 0) return null
    if (tabs.length === 1) return tabs[0]
    let best = tabs[0]
    let bestAt = Infinity
    for (const t of tabs) {
      const at = activity.get(t.id) || 0
      if (at < bestAt) { bestAt = at; best = t }
    }
    return best
  }
}

// ---- 镜像：清理已关闭标签页 ----
function pruneActivity(activity, liveIds) {
  for (const id of activity.keys()) {
    if (!liveIds.has(id)) activity.delete(id)
  }
}

test('单标签页：恒选唯一标签页（行为不变）', () => {
  const act = new Map()
  const pick = makePicker(act)
  assert.equal(pick([{ id: 7 }]).id, 7)
  assert.equal(pick(null), null)
  assert.equal(pick([]), null)
})

test('多标签页：选最久未用（活跃度最小）', () => {
  const act = new Map([[1, 100], [2, 200], [3, 50]])
  const pick = makePicker(act)
  assert.equal(pick([{ id: 1 }, { id: 2 }, { id: 3 }]).id, 3) // 50 最小
})

test('无活跃度记录时按数组序（都视为 0，取第一个）', () => {
  const act = new Map()
  const pick = makePicker(act)
  assert.equal(pick([{ id: 5 }, { id: 6 }]).id, 5)
})

test('使用后活跃度更新 → 下次选另一个 Tab（round-robin 效果）', () => {
  const act = new Map([[1, 0], [2, 0]])
  const pick = makePicker(act)
  const t1 = pick([{ id: 1 }, { id: 2 }])
  act.set(t1.id, Date.now()) // 模拟使用后更新
  const t2 = pick([{ id: 1 }, { id: 2 }])
  assert.notEqual(t1.id, t2.id)
})

test('已关闭标签页活跃度清理', () => {
  const act = new Map([[1, 100], [2, 200]])
  pruneActivity(act, new Set([2]))
  assert.equal(act.has(1), false)
  assert.equal(act.has(2), true)
})

test('source 源码含 v2.3-1 多 Tab 负载均衡标记（background.js）', () => {
  const src = fs.readFileSync(new URL('../../dsh-web-gemini-ext/background.js', import.meta.url), 'utf8')
  assert.ok(src.includes('v2.3-1: 多 Tab 负载均衡'))
  assert.ok(src.includes('pickIdleTab'))
  assert.ok(src.includes('tabActivity'))
  assert.ok(src.includes('最久未使用的 Gemini 标签页'))
})
