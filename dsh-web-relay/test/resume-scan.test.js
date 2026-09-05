// v4.0 Step1-3: 宿主重启续跑纯函数测试（镜像 lib/resume-scan.js + lib/index.js 接线）
// 运行：node --test test/resume-scan.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isExprInterrupted, resumeAction, resumeHandoff } from '../lib/resume-scan.js'

const BOOT_A = 'boot-A'
const BOOT_B = 'boot-B'
function busyState(over = {}) {
  return { status: 'executing', activeSteps: ['1'], bootId: BOOT_A, restartCount: 0, steps: [{ id: '1', status: 'executing', title: 's1' }], ...over }
}

test('isExprInterrupted：忙状态 + bootId 跨宿主才算中断', () => {
  assert.equal(isExprInterrupted(busyState(), BOOT_B), true)             // executing + 跨 boot
  assert.equal(isExprInterrupted({ ...busyState(), status: 'review' }, BOOT_B), true)
  assert.equal(isExprInterrupted({ ...busyState(), status: 'open', activeSteps: ['1'] }, BOOT_B), true) // activeSteps 非空
  assert.equal(isExprInterrupted(busyState(), BOOT_A), false)            // 同 boot（当前宿主写入）→ 不中断
  assert.equal(isExprInterrupted({ ...busyState(), bootId: null }, BOOT_B), false) // 旧版未打戳 → 不误判
  assert.equal(isExprInterrupted({ ...busyState(), status: 'approved', activeSteps: [] }, BOOT_B), false) // 非忙（approved+无活动步骤）→ 不误判
  assert.equal(isExprInterrupted(null, BOOT_B), false)
})

test('resumeAction：resume（+1）/ pause（≥max 熔断）/ none', () => {
  assert.deepEqual(resumeAction(busyState({ restartCount: 0 }), BOOT_B), { action: 'resume', restartCount: 1 })
  assert.deepEqual(resumeAction(busyState({ restartCount: 1 }), BOOT_B), { action: 'pause', restartCount: 2 }) // 第 2 次即熔断（maxRestarts=2）
  assert.deepEqual(resumeAction(busyState(), BOOT_A), { action: 'none', restartCount: 0 })
})

test('resumeHandoff：含断点步骤与续跑指引', () => {
  const t = resumeHandoff(busyState(), 'expr-x')
  assert.ok(t.includes('expr-x'))
  assert.ok(t.includes('Step 1'))
  assert.ok(t.includes('rejectStreak/iterationBaseCommit 跨重启保持'))
})

test('source 标记：lib/index.js 接线（v4.0 重启续跑）', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(src.includes("from './resume-scan.js'"))
  assert.ok(src.includes('CURRENT_BOOT_ID'))
  assert.ok(src.includes('bootId: CURRENT_BOOT_ID'))               // writeStepState 打戳
  assert.ok(src.includes('sessionId: data.sessionId || null'))     // readStepState 白名单
  assert.ok(src.includes('restartCount: data.restartCount || 0'))
  assert.ok(src.includes('bootResumeScan'))                         // 启动扫描
  assert.ok(src.includes('重启续跑熔断'))
  assert.ok(src.includes('wakeMainAgent({ sessionId: st.sessionId'))
  assert.ok(src.includes('resumeHandoff(st, exprId)'))
  assert.ok(src.includes('sessionId: sessionId || null'))           // askHandler 创建落盘 sessionId
})
