import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(__dirname, '..', 'lib', 'index.js'), 'utf8')

test('v3.2.6: dialog 通道超时 60s → 300s（长回答不再被 abort 截断）', () => {
  const m = src.match(/signal: AbortSignal\.timeout\((\d+)\)[\s\S]{0,120}?v3\.2\.6: 长回答根治/)
  // 直接检查 callDialogModel 的 baseOpts 超时
  const dialogBlock = src.match(/async function callDialogModel\(prompt\)[\s\S]{0,1200}?AbortSignal\.timeout\((\d+)\)/)
  assert.ok(dialogBlock, 'callDialogModel 中应存在 AbortSignal.timeout')
  assert.equal(Number(dialogBlock[1]), 300000, 'dialog 通道超时应为 300000ms（5 分钟）')
})

test('v3.2.6: claude 通道超时 120s → 300s', () => {
  const claudeBlock = src.match(/provider: 'anthropic'[\s\S]{0,600}?AbortSignal\.timeout\((\d+)\)/)
  assert.ok(claudeBlock, 'claude 通道应存在 AbortSignal.timeout')
  assert.equal(Number(claudeBlock[1]), 300000, 'claude 通道超时应为 300000ms（5 分钟）')
})

test('v3.2.6: webGeminiAsk 默认轮询超时 150s → 300s', () => {
  const m = src.match(/async function webGeminiAsk\(prompt, timeoutMs = (\d+)\)/)
  assert.ok(m, 'webGeminiAsk 应有默认 timeoutMs')
  assert.equal(Number(m[1]), 300000, 'web-gemini 默认超时应为 300000ms')
})

test('v3.2.6: extractChunkText 跳过 reason/error/code/message 键（abort 错误文本不再混入正文）', () => {
  const m = src.match(/k === 'finish_reason'[\s\S]{0,120}?k === 'reason' \|\| k === 'error' \|\| k === 'code' \|\| k === 'message'/)
  assert.ok(m, 'extractChunkText 的 walk 应跳过 reason/error/code/message 键')
})

test('v3.2.6: dialog 循环拦截 error/aborted chunk 并立即返回（不拼接错误文本）', () => {
  const dialogLoop = src.match(/async function callDialogModel\(prompt\)[\s\S]{0,1800}?chunk\.type === 'error' \|\| chunk\.type === 'aborted'\)[\s\S]{0,200}?return \{ ok: false, error: String\(chunk\.error \|\| chunk\.message/)
  assert.ok(dialogLoop, 'dialog 循环应拦截 error/aborted chunk 并立即返回失败')
})

test('v3.2.6: claude 循环拦截 error/aborted chunk 并 break（不再拼接错误文本）', () => {
  const claudeLoop = src.match(/provider: 'anthropic'[\s\S]{0,1000}?chunk\.type === 'error' \|\| chunk\.type === 'aborted'\)[\s\S]{0,200}?break/)
  assert.ok(claudeLoop, 'claude 循环应拦截 error/aborted chunk 并 break')
})

test('v4.1.0: 版本号已升至 4.1.0', () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
  assert.equal(pkg.version, '4.1.0')
})
