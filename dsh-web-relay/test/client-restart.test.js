// v4.2.0 (AutoIteration 实验 V2): 重启续跑面板/审计测试（source 标记 + docs 存在性）
// 运行：node --test test/test-client-restart.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

test('source：client.js 重启续跑徽标键与审计日志（v4.2.0）', () => {
  const client = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  // 徽标键（v4.1.0）
  assert.ok(client.includes('bootIdLabel'))
  assert.ok(client.includes('resumeCountLabel'))
  assert.ok(client.includes('resumeActiveNote'))
  assert.ok(client.includes('resumePausedNote'))
  assert.ok(client.includes("health.bootId")) // bootId 短显消费点
  // v4.2.0 审计日志
  assert.ok(client.includes('重启续跑状态:'))
  assert.ok(client.includes('重启续跑熔断暂停:'))
  assert.ok(client.includes('console.warn'))
})

test('docs：OPS-RESTART-RESUME.md 存在且覆盖关键机制', () => {
  const p = path.join(here, '..', 'docs', 'OPS-RESTART-RESUME.md')
  const doc = fs.readFileSync(p, 'utf8')
  assert.ok(doc.includes('bootId'))
  assert.ok(doc.includes('restartCount'))
  assert.ok(doc.includes('重启续跑熔断'))
  assert.ok(doc.includes('DSH-WEB-Watchdog'))
  assert.ok(doc.includes('应急手动恢复'))
})
