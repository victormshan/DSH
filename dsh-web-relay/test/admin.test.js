// v3.9 S2/S4: 优雅停机准备端点与面板状态测试（source 标记；运行：node --test test/admin.test.js）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('source 标记：/admin/prepare-restart 端点（lib/index.js v3.9 S2）', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  // 路由注册
  assert.ok(src.includes("'/dsh-web-relay/admin/prepare-restart'"))
  assert.ok(src.includes('adminPrepareHandler'))
  // 进程级准备状态 + GET 查询 / POST {cancel} 语义
  assert.ok(src.includes('let prepareRestartState = null'))
  assert.ok(src.includes('preparing: Boolean(prepareRestartState)'))
  assert.ok(src.includes("payload.cancel === true"))
  assert.ok(src.includes('ready: true'))
  // 新任务领取拒绝（ask 409）
  assert.ok(src.includes("return json(res, 409, { ok: false, preparing: true, preparedAt: prepareRestartState.at, reason: '宿主优雅停机准备中（/admin/prepare-restart 已触发）"))
  // 新步骤启动拒绝（steps/update start 409）
  assert.ok(src.includes("action === 'start' && prepareRestartState"))
  // /health-check 暴露 preparing 供 watchdog/面板
  assert.ok(src.includes('preparing: Boolean(prepareRestartState),'))
})

test('source 标记：面板优雅停机准备提示（lib/client.js v3.9 S4）', () => {
  const client = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(client.includes('preparingRestart'))
  assert.ok(client.includes('health.preparing'))
  assert.ok(client.includes('dwr-blink'))
})
