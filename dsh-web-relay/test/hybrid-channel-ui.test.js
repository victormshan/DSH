// v4.9.2/hb_1: 混合架构 claude-code 通道前端入口源码断言（面板可选 + 徽标兼容）
// 运行：node --test test/hybrid-channel-ui.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('前端审核通道选择器含 claude-code 第三项（zh/en）', () => {
  assert.ok(src.includes("h('option', { value: 'claude-code' }, T.reviewChannelClaudeCode)"))
  assert.ok(src.includes("reviewChannelClaudeCode: 'claude-code（本地 Claude Code）'"))
  assert.ok(src.includes("reviewChannelClaudeCode: 'claude-code (local Claude Code)'"))
})

test('auto-review 请求透传 reviewChannel（单步与批量）', () => {
  const single = src.indexOf('reviewChannel }),')
  const batch = src.indexOf('batchStepIds: ids, enableSwarm: swarmOn, disableShadow: shadowOff, reviewChannel }),')
  assert.ok(single > 0 && batch > single, `单步/批量请求均应携带 reviewChannel（single=${single} batch=${batch}）`)
})

test('reviewedBy=claude-code 徽标：label/颜色/边框/rbColor 兼容', () => {
  assert.ok(src.includes("reviewerClaudeCode: 'Claude Code'"))           // zh/en label 键
  assert.ok(src.includes("s.reviewedBy === 'claude-code' ? '#f97316'"))    // 徽标橙色
  assert.ok(src.includes("s.reviewedBy === 'claude-code' ? T.reviewerClaudeCode"))
  assert.ok(src.includes("rb === 'claude-code' ? '#f97316'"))              // replay 徽标
})

test('协议 v2.0 文本收敛：/ask 不经 claude-code（审核专有）', () => {
  const idx = src.indexOf('reviewChannelClaudeCode')
  // 协议收敛在 lib/index.js（WEB_RELAY_PROTOCOL），此处断言 client 无 /ask 混淆文案即可
  assert.ok(idx > 0)
  const idxJs = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(idxJs.includes('claude-code 为审核/代码实施专有通道'))
  assert.ok(idxJs.includes('/ask（方案生成/裁决问答）降级链为 external → web-gemini → dialog，不经 claude-code'))
})
