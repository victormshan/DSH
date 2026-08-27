// v2.0-1/v2.0-3: 面板 Version Gate 进度条与熔断状态卡片测试（v2.0.0）
// 运行：node --test test/breaker-ui.test.js
// 注：UI 组件位于 lib/client.js 闭包内不可直接 import，以镜像函数复测确定性逻辑。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ---- 镜像：Version Gate 徽标（iterations>1 显示 Vn/N，否则不显示）----
function versionGateLabel(iterations, currentIteration) {
  const n = Number(iterations) || 1
  if (n <= 1) return null
  return '版本: V' + String(Number(currentIteration) || 1) + '/' + String(n)
}

// ---- 镜像：熔断卡片显隐（status=paused 才显示）----
function breakerCardVisible(status) {
  return status === 'paused'
}

// ---- 镜像：熔断卡片内容（stopReason + rejectStreak）----
function breakerCardText(stopReason, rejectStreak) {
  let t = stopReason || '连续打回 ≥3 次，自动暂停'
  if (rejectStreak) t += '（rejectStreak: ' + String(rejectStreak) + '）'
  return t
}

test('Version Gate：iterations>1 显示 Vn/N', () => {
  assert.equal(versionGateLabel(3, 2), '版本: V2/3')
  assert.equal(versionGateLabel(3, 1), '版本: V1/3')
})

test('Version Gate：单版任务（iterations<=1）不显示', () => {
  assert.equal(versionGateLabel(1, 1), null)
  assert.equal(versionGateLabel(undefined, 1), null)
})

test('熔断卡片：仅 status=paused 显示', () => {
  assert.equal(breakerCardVisible('paused'), true)
  assert.equal(breakerCardVisible('open'), false)
  assert.equal(breakerCardVisible('done'), false)
  assert.equal(breakerCardVisible('stopped'), false)
})

test('熔断卡片：内容含 stopReason 与 rejectStreak', () => {
  assert.equal(breakerCardText('连续打回 ≥3 次，AutoIteration 自动暂停', 3), '连续打回 ≥3 次，AutoIteration 自动暂停（rejectStreak: 3）')
  assert.equal(breakerCardText('', 0), '连续打回 ≥3 次，自动暂停')
})

test('source 源码含 v2.0-1 熔断卡片标记（client.js）', () => {
  const src = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(src.includes('v2.0-1: Version Gate 徽标'))
  assert.ok(src.includes('v2.0-1: 熔断状态卡片'))
  assert.ok(src.includes('circuitBreakerTitle'))
  assert.ok(src.includes("stepState.status === 'paused'"))
  // Resume 按钮复用既有 resumeExperiment
  assert.ok(src.includes('onClick: resumeExperiment'))
})
