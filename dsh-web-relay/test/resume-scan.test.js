// v4.0 Step1-3: 宿主重启续跑纯函数测试（镜像 lib/resume-scan.js + lib/index.js 接线）
// 运行：node --test test/resume-scan.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isExprInterrupted, resumeAction, resumeHandoff, isScanEligible, planResumes } from '../lib/resume-scan.js'

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
  // v4.4.1-fix: paused/stopped（已熔断/已叫停）即使 activeSteps 残留也不判忙（96-96-96 restartCount 2→3 案例）
  assert.equal(isExprInterrupted({ ...busyState(), status: 'paused', activeSteps: ['1'] }, BOOT_B), false)
  assert.equal(isExprInterrupted({ ...busyState(), status: 'stopped', activeSteps: ['1'] }, BOOT_B), false)
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
  assert.ok(src.includes('wakeSid = st.sessionId || process.env.DSH_SESSION_ID'))  // v4.9.1 双回退唤醒
  assert.ok(src.includes('resumeHandoff(st, exprId)'))
  assert.ok(src.includes('sessionId: sessionId || null'))           // askHandler 创建落盘 sessionId
  assert.ok(src.includes('adminResumeScanHandler'))                  // 手动触发端点
  assert.ok(src.includes("'/dsh-web-relay/admin/resume-scan'"))
  assert.ok(src.includes('resumeScanBases'))                         // 候选基准（env > sandbox > cwd）
  assert.ok(src.includes('DSH_RELAY_WORKSPACE'))
  // v4.7 接线：isTest 逻辑归档过滤 + 白名单
  assert.ok(src.includes('isScanEligible(st)'))
  assert.ok(src.includes('isTest: data.isTest === true'))
  assert.ok(src.includes('isTest: state.isTest === true'))
})

// ---- v4.7.0 (v7_1/v7_2/v7_3): isTest 归档 + 多会话并发批量计划 ----
test('isScanEligible：isTest 且已完成 → 跳过（逻辑归档）；其他照常', () => {
  const done = { isTest: true, status: 'done', finalized: true }
  assert.equal(isScanEligible(done), false)
  assert.equal(isScanEligible({ isTest: true, status: 'done', finalized: false }), false)
  assert.equal(isScanEligible({ isTest: true, status: 'executing', finalized: false }), true)  // isTest 进行中仍可续
  assert.equal(isScanEligible({ isTest: false, status: 'done' }), true)                        // 业务 done 由状态机跳过
  assert.equal(isScanEligible(null), false)
})

test('planResumes：多 expr（不同 sessionId）跨 boot 全处理不丢、顺序保持、isTest-done 排除', () => {
  const states = [
    { exprId: 'e1', sessionId: 'sess-A', status: 'executing', activeSteps: ['1'], bootId: BOOT_A },
    { exprId: 'e2', sessionId: 'sess-B', status: 'review', bootId: BOOT_A },
    { exprId: 'e3', sessionId: 'sess-A', status: 'executing', bootId: BOOT_A, isTest: true },
    { exprId: 'e4', sessionId: 'sess-B', status: 'done', finalized: true, bootId: BOOT_A, isTest: true }
  ]
  const plan = planResumes(states, BOOT_B)
  assert.deepEqual(plan.map((p) => p.exprId), ['e1', 'e2', 'e3']) // e4 isTest-done 排除；顺序保持不丢
  assert.equal(plan.length, 3)
  assert.ok(plan.every((p) => p.action === 'resume' && p.restartCount === 1))
  assert.deepEqual(plan.map((p) => p.sessionId), ['sess-A', 'sess-B', 'sess-A']) // 不同会话独立不冲突
})
