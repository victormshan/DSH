// v3.8 Step3: 回滚后步骤状态复位策略测试（纯函数镜像 lib/rollback-state.js；运行：node --test test/rollback-state.test.js）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { planRollbackReset, applyRollbackReset, markRollbackDegraded } from '../lib/rollback-state.js'

function makeState(over = {}) {
  return {
    exprId: 'expr-x',
    status: 'done',
    currentStep: '2',
    activeSteps: ['2'],
    steps: [
      { id: '1', status: 'approved', reviewedBy: 'external', notes: [], artifacts: ['a.md'] },
      { id: '2', status: 'executing', reviewedBy: null, notes: [] },
      { id: '3', status: 'review', reviewedBy: null, notes: [] },
      { id: '4', status: 'rejected', reviewedBy: null, notes: [{ role: 'external', action: 'rejected', text: '缺证据' }] },
      { id: '5', status: 'pending', reviewedBy: null, notes: [] }
    ],
    ...over
  }
}

test('planRollbackReset：仅 approved/executing/review 进入复位清单（rejected/pending 不列入）', () => {
  const plan = planRollbackReset(makeState())
  assert.deepEqual(plan.map((p) => p.id), ['1', '2', '3'])
  assert.deepEqual(plan.map((p) => p.from), ['approved', 'executing', 'review'])
})

test('applyRollbackReset：状态翻转 + rejected/pending 保留 + 历史 notes 追加不清理', () => {
  const st = makeState()
  const { count, affected } = applyRollbackReset(st, { base: 'abc1234def5678' })
  assert.equal(count, 3)
  assert.equal(affected.length, 3)
  const byId = Object.fromEntries(st.steps.map((s) => [s.id, s]))
  assert.equal(byId['1'].status, 'pending'); assert.equal(byId['1'].reviewedBy, null)
  assert.equal(byId['2'].status, 'pending'); assert.equal(byId['2'].reviewedBy, null)
  assert.equal(byId['3'].status, 'pending'); assert.equal(byId['3'].reviewedBy, null)
  assert.equal(byId['4'].status, 'rejected')   // rejected 保留
  assert.equal(byId['5'].status, 'pending')
  // 复位动作落痕：每个受影响步骤追加 action=reset note
  for (const id of ['1', '2', '3']) {
    const resetNotes = byId[id].notes.filter((n) => n.action === 'reset')
    assert.equal(resetNotes.length, 1)
    assert.ok(resetNotes[0].text.includes('pending'))
  }
  assert.equal(byId['4'].notes.length, 1)      // rejected 历史不被清理
  // 状态机字段
  assert.equal(st.status, 'open')              // done 解除（finalize 门禁解锁）
  assert.equal(st.currentStep, '1')            // 指向第一个 pending
  assert.deepEqual(st.activeSteps, [])
  assert.equal(st.incrementalStreak, 0)
  assert.equal(st.rollbackBase, 'abc1234def5678')
  assert.equal(st.rollbackSteps, 3)
  assert.ok(st.rolledBackAt)
  assert.equal(st.rollbackDegraded, null)
})

test('applyRollbackReset：无受影响步骤（全部 pending/rejected）幂等不报错', () => {
  const st = makeState({
    status: 'open',
    steps: [
      { id: '1', status: 'pending', notes: [] },
      { id: '2', status: 'rejected', notes: [] }
    ]
  })
  const { count } = applyRollbackReset(st, { base: 'x' })
  assert.equal(count, 0)
  assert.equal(st.rollbackSteps, 0)
  assert.equal(st.currentStep, '1')
})

test('markRollbackDegraded：非 git 降级只落盘标记，不动步骤状态', () => {
  const st = makeState({ status: 'open' })
  markRollbackDegraded(st, '非 git 工作区：不做物理快照回滚')
  assert.ok(st.rollbackDegraded)
  assert.ok(st.rollbackDegraded.at)
  assert.ok(st.rollbackDegraded.reason.includes('非 git'))
  assert.deepEqual(st.steps.map((s) => s.status), ['approved', 'executing', 'review', 'rejected', 'pending']) // 未翻转
  assert.equal(st.rollbackSteps, undefined)
})

test('source 标记：rollback 端点接入复位策略（lib/index.js v3.8 Step3）', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(src.includes("from './rollback-state.js'"))
  assert.ok(src.includes('applyRollbackReset(state, { base: target })'))
  assert.ok(src.includes('markRollbackDegraded(state'))
  assert.ok(src.includes('resetInfo'))
  assert.ok(src.includes('rolledBackAt'))
})

test('source 标记：面板回滚状态展示增强（lib/client.js v3.8 Step4）', () => {
  const client = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  // 新增文案键
  assert.ok(client.includes('rollbackBaseLabel'))
  assert.ok(client.includes('noRollbackBase'))
  assert.ok(client.includes('rollbackStepsReset'))
  // 状态行消费 stepState（基线/降级/回滚历史）与 resetInfo（复位步数提示）
  assert.ok(client.includes('stepState.rollbackDegraded'))
  assert.ok(client.includes('stepState.iterationBaseCommit || stepState.rollbackBase'))
  assert.ok(client.includes('stepState.rolledBackAt'))
  assert.ok(client.includes('data.resetInfo.stepsReset'))
  assert.ok(client.includes('data.marked')) // 降级落盘标记提示
})
