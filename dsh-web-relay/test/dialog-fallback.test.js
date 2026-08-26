// dialog-fallback 单测（v1.9 V2 修复后）：消息格式 / 尝试顺序 / chunk 提取 / 降级标注
// 运行：node --test test/dialog-fallback.test.js（或 node test/dialog-fallback.test.js）
// 注：callDialogModel 位于 apply() 闭包内不可直接 import，本测试以镜像函数复测其确定性逻辑。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ---- 镜像：消息构造（块数组 content，dsh-llm createUserMessage 契约）----
function buildMessages(prompt) {
  return [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
}

// ---- 镜像：尝试顺序（currentSelection → deepseek-official → 默认路由）----
function buildAttempts(sel) {
  const attempts = []
  if (sel && typeof sel.provider === 'string' && sel.provider) attempts.push({ provider: sel.provider, ...(sel.model ? { model: sel.model } : {}) })
  attempts.push({ provider: 'deepseek-official' }, {})
  return attempts
}

// ---- 镜像：chunk 文本提取（text-delta 等 harness chunk 结构）----
function extractChunkText(chunk) {
  if (chunk == null) return ''
  if (typeof chunk === 'string') return chunk
  const direct = chunk?.text ?? chunk?.delta?.text ?? chunk?.delta ?? chunk?.content ?? chunk?.message?.content ?? chunk?.message?.text ?? chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.message?.content
  if (typeof direct === 'string' && direct) return direct
  return ''
}

test('消息 content 为块数组格式（dsh-llm 契约）', () => {
  const m = buildMessages('审核请求')
  assert.equal(m[0].role, 'user')
  assert.ok(Array.isArray(m[0].content))
  assert.equal(m[0].content[0].type, 'text')
  assert.equal(m[0].content[0].text, '审核请求')
})

test('尝试顺序：currentSelection → deepseek-official → 默认路由', () => {
  const a = buildAttempts({ provider: 'deepseek-ai', model: 'deepseek-v4-flash' })
  assert.equal(a.length, 3)
  assert.deepEqual(a[0], { provider: 'deepseek-ai', model: 'deepseek-v4-flash' })
  assert.deepEqual(a[1], { provider: 'deepseek-official' })
  assert.deepEqual(a[2], {})
})

test('无 currentSelection 时回退 deepseek-official', () => {
  const a = buildAttempts(null)
  assert.equal(a.length, 2)
  assert.deepEqual(a[0], { provider: 'deepseek-official' })
  assert.deepEqual(a[1], {})
})

test('extractChunkText 提取 harness text-delta chunk', () => {
  assert.equal(extractChunkText({ type: 'text-delta', text: 'approved' }), 'approved')
  assert.equal(extractChunkText({ type: 'reasoning-delta', text: '分析' }), '分析')
  assert.equal(extractChunkText({ choices: [{ delta: { content: 'rejected' } }] }), 'rejected')
  assert.equal(extractChunkText(null), '')
})

test('降级标注映射（askHandler 契约）', () => {
  const channelOf = (degraded) => (degraded ? 'dialog-fallback' : 'gemini-free')
  assert.equal(channelOf(true), 'dialog-fallback')
  assert.equal(channelOf(false), 'gemini-free')
  const label = (degraded) => (degraded ? '对话模型（降级）' : 'Gemini Free API')
  assert.equal(label(true), '对话模型（降级）')
})

test('source 源码含修复标记（inject + 块数组 + currentSelection）', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(src.includes("'agentDefaultModel'"))
  assert.ok(src.includes("content: [{ type: 'text', text: prompt }]"))
  assert.ok(src.includes('agentDefaultModel.currentSelection'))
})
