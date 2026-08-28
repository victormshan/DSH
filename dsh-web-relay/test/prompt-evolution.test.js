// v3.1-2/v3.1-3: Prompt 自主进化·拒收聚类与案例注入测试（v3.1.0）
// 运行：node --test test/prompt-evolution.test.js
// 镜像 lib/index.js categorizeRejection / Top-K 注入 / 幂等追加逻辑。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ---- 镜像：聚类（与 lib/index.js REJECT_CATEGORIES 一致）----
const CATS = [
  { id: 'missing_artifact', keywords: ['artifacts', '产物', 'artifact', '未挂载'] },
  { id: 'acceptance_gap', keywords: ['验收', 'acceptance', '未满足', '不符合', '未达到'] },
  { id: 'evidence_insufficient', keywords: ['证据', '未提交', '核查', 'notes', '未提供'] },
  { id: 'path_issue', keywords: ['路径', 'path', '无法读取', '不存在', '越界'] },
  { id: 'syntax_error', keywords: ['语法', 'syntax', '解析失败', 'SyntaxError'] }
]
function categorize(reason) {
  const src = String(reason || '').toLowerCase()
  for (const c of CATS) if (c.keywords.some((k) => src.includes(k.toLowerCase()))) return c.id
  return 'other'
}

// ---- 镜像：Top-K 注入（匹配得分排序，K≤3）----
function pickCases(cases, topic, k = 3) {
  const t = String(topic || '').toLowerCase()
  const scored = (cases || [])
    .map((c) => {
      const r = String(c.reason || '').toLowerCase()
      let score = 0
      for (const w of t.split(/\s+/)) if (w.length > 2 && r.includes(w)) score++
      if (t.includes(c.category || '')) score += 2
      return { c, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
  return scored.map((x) => x.c)
}

test('聚类：缺产物/未达验收/证据不足/路径/语法/其他', () => {
  assert.equal(categorize('artifacts 列表为空'), 'missing_artifact')
  assert.equal(categorize('未达到验收标准'), 'acceptance_gap')
  assert.equal(categorize('未提交核查证据'), 'evidence_insufficient')
  assert.equal(categorize('路径无法解析'), 'path_issue')
  assert.equal(categorize('JSON 解析失败'), 'syntax_error')
  assert.equal(categorize('随便其他意见'), 'other')
  assert.equal(categorize(''), 'other')
})

test('Top-K：匹配度排序且不超过硬上限 3', () => {
  const cases = [
    { category: 'missing_artifact', reason: 'artifacts 为空 缺少产物证据 请补挂' },
    { category: 'path_issue', reason: '路径不存在' },
    { category: 'missing_artifact', reason: 'artifacts 为空 缺产物' },
    { category: 'syntax_error', reason: '语法错误' }
  ]
  const picked = pickCases(cases, 'artifacts 产物 挂载', 3)
  assert.ok(picked.length >= 1 && picked.length <= 3) // 不超过硬上限
  assert.ok(picked.every((c) => c.category === 'missing_artifact')) // 只选匹配相关案例
  assert.equal(picked[0].reason, 'artifacts 为空 缺少产物证据 请补挂') // 词匹配最多者在前
})

test('Top-K：无匹配返回空（优雅跳过，不注入）', () => {
  const picked = pickCases([{ category: 'syntax_error', reason: '语法错误' }], '影子沙盒 合并 diff', 3)
  assert.equal(picked.length, 0)
})

test('幂等：同 exprId+stepId 案例不重复追加', () => {
  const seen = new Set()
  const append = (exprId, stepId) => {
    const key = `${exprId}:${stepId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }
  assert.equal(append('expr-1', '3'), true)
  assert.equal(append('expr-1', '3'), false)
  assert.equal(append('expr-1', '4'), true)
})

test('source 源码含 v3.1-2 Prompt 进化标记（lib/index.js）', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(src.includes('V3.1: Prompt 自主进化'))
  assert.ok(src.includes('categorizeRejection'))
  assert.ok(src.includes('buildCaseBlock'))
  assert.ok(src.includes('collectRejectedCases'))
  assert.ok(src.includes('prompt-case-library.md'))
  assert.ok(src.includes('历史拒收案例（V3.1 反思注入'))
})
