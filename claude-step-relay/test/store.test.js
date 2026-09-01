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

test('createExperiment 拒绝空标题/纯空白标题', () => {
  assert.throws(() => store.createExperiment({ title: '' }), /title is required/)
  assert.throws(() => store.createExperiment({ title: '   ' }), /title is required/)
})

test('setSteps 拒绝空数组/非数组', () => {
  const expr = store.createExperiment({ title: '拒绝空 steps' })
  assert.throws(() => store.setSteps(expr.exprId, []), /non-empty array/)
  assert.throws(() => store.setSteps(expr.exprId, 'not-an-array'), /non-empty array/)
})

test('setSteps 保留自定义字符串 id', () => {
  const expr = store.createExperiment({ title: '自定义 id' })
  const data = store.setSteps(expr.exprId, [{ id: 'step-a', title: '步骤A' }])
  assert.equal(data.steps[0].id, 'step-a')
  const updated = store.updateStep(expr.exprId, 'step-a', 'done')
  assert.equal(updated.steps[0].status, 'done')
})

test('对不存在的任务：setSteps/updateStep/appendTrace/finalize 均报错', () => {
  assert.throws(() => store.setSteps('ghost-id', [{ title: 'x' }]), /experiment not found/)
  assert.throws(() => store.updateStep('ghost-id', 1, 'done'), /experiment not found/)
  assert.throws(() => store.appendTrace('ghost-id', '用户', 'x'), /experiment not found/)
  assert.throws(() => store.finalize('ghost-id', 'x'), /experiment not found/)
})

test('readTrace 对不存在的轨迹报错', () => {
  assert.throws(() => store.readTrace('ghost-id'), /trace not found/)
})

test('BASE_DIR 在模块加载时即固化，运行期修改 env 不生效', () => {
  // __paths.BASE_DIR 应等于测试文件顶部 import 前设置的 tmpDir，
  // 不会因为某个测试用例中途改了 process.env.STEP_RELAY_DIR 而漂移——
  // 这是需要显式记录的架构约束，避免以后有人误以为能运行期切换存储目录。
  assert.equal(store.__paths.BASE_DIR, tmpDir)
})

test('并发创建多个实验时 exprId 保证唯一', () => {
  const ids = new Set()
  for (let i = 0; i < 20; i++) {
    const data = store.createExperiment({ title: `并发任务${i}` })
    ids.add(data.exprId)
  }
  assert.equal(ids.size, 20)
})

test('多次 updateStep 累积轨迹记录，每次一条', () => {
  const expr = store.createExperiment({ title: '轨迹累积' })
  store.setSteps(expr.exprId, [{ title: '唯一步骤' }])
  store.updateStep(expr.exprId, 1, 'executing')
  store.updateStep(expr.exprId, 1, 'blocked', '被依赖阻塞')
  store.updateStep(expr.exprId, 1, 'done')
  const trace = store.readTrace(expr.exprId)
  const claudeEntries = trace.match(/\[Claude\]/g) || []
  // 1 条 setSteps 记录 + 3 条 updateStep 记录 = 4
  assert.equal(claudeEntries.length, 4)
  assert.match(trace, /被依赖阻塞/)
})

test('note 为空字符串时不覆盖已有 note（已知行为，非 bug）', () => {
  const expr = store.createExperiment({ title: 'note 行为' })
  store.setSteps(expr.exprId, [{ title: '唯一步骤' }])
  store.updateStep(expr.exprId, 1, 'executing', '第一次说明')
  const data = store.updateStep(expr.exprId, 1, 'done', '')
  assert.equal(data.steps[0].note, '第一次说明')
})

test('特殊字符/超长文本/emoji 不导致读写异常', () => {
  const weirdTitle = '```markdown注入``` # 标题 emoji😀🚀 "引号" \\反斜杠\\ \n换行'
  const longText = 'x'.repeat(20000)
  const expr = store.createExperiment({ title: weirdTitle, prompt: longText })
  assert.equal(expr.title, weirdTitle)
  const reloaded = store.readExperiment(expr.exprId)
  assert.equal(reloaded.prompt, longText)
  const trace = store.readTrace(expr.exprId)
  assert.ok(trace.includes(longText))
})

test('50 步 Step List 正确写入与逐一更新', () => {
  const expr = store.createExperiment({ title: '大规模 Step List' })
  const steps = Array.from({ length: 50 }, (_, i) => ({ title: `步骤 ${i + 1}` }))
  const data = store.setSteps(expr.exprId, steps)
  assert.equal(data.steps.length, 50)
  for (let i = 1; i <= 50; i++) {
    store.updateStep(expr.exprId, i, 'done')
  }
  const final = store.getState(expr.exprId)
  assert.ok(final.steps.every((s) => s.status === 'done'))
  const list = store.listExperiments()
  const found = list.find((x) => x.exprId === expr.exprId)
  assert.equal(found.progress, '50/50')
})
