// v2.2-1/v2.2-2: auto-review Artifacts 摘要注入测试（v2.0.0）
// 运行：node --test test/context-enhancer.test.js
// 镜像 lib/index.js buildArtifactsSummary 的确定性逻辑（截断/clip/优雅降级）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---- 镜像：clip（与 lib/index.js clip 一致：截断 + 省略号）----
function clip(text, max) {
  const s = String(text || '')
  return s.length > max ? s.slice(0, max) + '…' : s
}

// ---- 镜像：摘要构建（同步版，用于确定性测试）----
function buildSummarySync(base, artifacts, max = 2000) {
  const list = Array.isArray(artifacts) ? artifacts : []
  if (list.length === 0) return ''
  const parts = []
  for (const raw of list) {
    const p = String(raw || '').trim()
    if (!p) continue
    try {
      const target = path.isAbsolute(p) ? p : path.join(base, p)
      const text = fs.readFileSync(target, 'utf8')
      parts.push(`--- ${p} ---\n${clip(text, max)}`)
    } catch (err) {
      parts.push(`（无法读取产物：${p}）`)
    }
  }
  return '【上一步产物摘要（v2.2-1 上下文增强，自动注入）】\n' + parts.join('\n\n')
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

test('无 artifacts 时返回空串（不注入摘要段）', () => {
  assert.equal(buildSummarySync(repoRoot, []), '')
  assert.equal(buildSummarySync(repoRoot, null), '')
  assert.equal(buildSummarySync(repoRoot, undefined), '')
})

test('有 artifacts 时注入摘要段，含文件内容', () => {
  const s = buildSummarySync(repoRoot, ['package.json'])
  assert.ok(s.startsWith('【上一步产物摘要'))
  assert.ok(s.includes('--- package.json ---'))
  assert.ok(s.includes('"name": "dsh-web-relay"'))
})

test('长文件内容按 2000 截断', () => {
  const s = buildSummarySync(repoRoot, ['lib/index.js'], 200)
  const contentPart = s.split('--- lib/index.js ---\n')[1] || ''
  assert.ok(contentPart.length <= 200 + 1) // clip 追加省略号
  assert.ok(contentPart.endsWith('…'))
})

test('不可读/不存在产物优雅降级（不抛错）', () => {
  const s = buildSummarySync(repoRoot, ['no-such-file-xyz.js'])
  assert.ok(s.includes('无法读取产物'))
})

test('绝对路径产物可读取', () => {
  const abs = path.join(repoRoot, 'package.json')
  const s = buildSummarySync(repoRoot, [abs])
  assert.ok(s.includes('"name": "dsh-web-relay"'))
})

test('source 源码含 v2.2-1 摘要注入标记（lib/index.js）', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(src.includes('v2.2-1: 上一步产物摘要'))
  assert.ok(src.includes('buildArtifactsSummary'))
  // v3.1-2: 签名扩展为 7 参（增加 caseBlock 历史拒收案例注入）
  assert.ok(src.includes('buildReviewPrompt(exprId, step, recordText, traceText, reviewer, artifactsSummary, caseBlock)'))
  assert.ok(src.includes('artifactsSummary ? artifactsSummary :'))
})
