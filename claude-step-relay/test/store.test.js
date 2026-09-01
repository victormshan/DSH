import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// store.mjs 在 import 时就固定了 BASE_DIR（读一次 process.env.STEP_RELAY_DIR），
// 所以必须在 import 之前设置好隔离的临时目录，避免测试污染真实 step-relay/ 数据。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'step-relay-test-'))
process.env.STEP_RELAY_DIR = tmpDir

const store = await import('../lib/store.mjs')

test('createExperiment 创建任务并写入初始轨迹', () => {
  const data = store.createExperiment({ title: '测试任务', prompt: '这是初始需求' })
  assert.equal(data.title, '测试任务')
  assert.equal(data.status, 'open')
  assert.deepEqual(data.steps, [])
  const trace = store.readTrace(data.exprId)
  assert.match(trace, /\[用户\]/)
  assert.match(trace, /这是初始需求/)
})

test('setSteps 覆盖式写入 Step List 并记录轨迹', () => {
  const expr = store.createExperiment({ title: '拆分任务' })
  const data = store.setSteps(expr.exprId, [
    { title: '第一步', detail: '做点什么', acceptance: '完成即可' },
    { title: '第二步' }
  ])
  assert.equal(data.steps.length, 2)
  assert.equal(data.steps[0].id, 1)
  assert.equal(data.steps[0].status, 'pending')
  const trace = store.readTrace(expr.exprId)
  assert.match(trace, /拆分 Step List（共 2 步）/)
})

test('updateStep 更新状态、拒绝非法状态值', () => {
  const expr = store.createExperiment({ title: '状态流转' })
  store.setSteps(expr.exprId, [{ title: '唯一步骤' }])
  const data = store.updateStep(expr.exprId, 1, 'executing')
  assert.equal(data.steps[0].status, 'executing')
  assert.throws(() => store.updateStep(expr.exprId, 1, 'approved'), /invalid status/)
  assert.throws(() => store.updateStep(expr.exprId, 999, 'done'), /step not found/)
})

test('finalize 标记整体完成并写入收口轨迹', () => {
  const expr = store.createExperiment({ title: '收口任务' })
  store.setSteps(expr.exprId, [{ title: '唯一步骤' }])
  store.updateStep(expr.exprId, 1, 'done')
  const data = store.finalize(expr.exprId, '全部完成')
  assert.equal(data.status, 'done')
  assert.match(store.readTrace(expr.exprId), /任务收口/)
})

test('listExperiments 按更新时间倒序返回进度概览', () => {
  const a = store.createExperiment({ title: 'A' })
  store.setSteps(a.exprId, [{ title: 's1' }, { title: 's2' }])
  store.updateStep(a.exprId, 1, 'done')
  const list = store.listExperiments()
  const found = list.find((x) => x.exprId === a.exprId)
  assert.equal(found.progress, '1/2')
})

test('exprId 校验拒绝路径穿越', () => {
  assert.throws(() => store.readExperiment('../../etc/passwd'), /invalid exprId/)
  assert.throws(() => store.appendTrace('../evil', '用户', 'x'), /invalid exprId/)
})

test('readExperiment 对不存在的任务报错', () => {
  assert.throws(() => store.readExperiment('not-exist-id'), /experiment not found/)
})
