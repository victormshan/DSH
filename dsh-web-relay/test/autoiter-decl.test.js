// v3.3.2: extractAutoIterDecl 叙述式/中文声明解析修复测试（镜像函数，运行：node --test test/autoiter-decl.test.js）
// 背景：expr-2026-09-03_01-27-21 外部 AI 将声明写在叙述文本（"（配置：iterations: 3, autoDecision: true）"），
// 旧逻辑仅认严格 JSON 块 → stepState 落为 iterations:1/autoDecision:false（声称自动迭代未生效）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

// ---- 镜像：lib/index.js extractAutoIterDecl（v3.3.2 修复后）----
function extractAutoIterDecl(text) {
  const src = String(text || '')
  const decl = { iterations: 1, finalAcceptance: null, autoDecision: false }
  const clamp = (n) => (Number.isInteger(n) && n >= 1 && n <= 10 ? n : null)
  // 1) 严格 JSON 片段（协议推荐形态）
  const m = src.match(/\{\s*"iterations"\s*:\s*(\d+)\s*(?:,\s*"finalAcceptance"\s*:\s*"([^"]*)"\s*)?(?:,\s*"autoDecision"\s*:\s*(true|false)\s*)?\}/)
  if (m) {
    const n = clamp(parseInt(m[1], 10))
    if (n) decl.iterations = n
    if (m[2]) decl.finalAcceptance = m[2]
    if (m[3]) decl.autoDecision = m[3] === 'true'
    return decl
  }
  // 2) 叙述式声明兜底
  const n2 = src.match(/\biterations\s*[:：]\s*(\d+)/i)
  const ni = n2 && clamp(parseInt(n2[1], 10))
  if (!ni) {
    const mC = src.match(/(?:自动迭代|自动演进|迭代)\s*[:：]?\s*(\d{1,2})\s*(?:个|次|轮)?版本/)
    if (mC) { const n3 = clamp(parseInt(mC[1], 10)); if (n3) decl.iterations = n3 }
  } else decl.iterations = ni
  const ma = src.match(/autoDecision\s*[:：]\s*(true|false)/i)
  if (ma) decl.autoDecision = ma[1].toLowerCase() === 'true'
  const mf = src.match(/finalAcceptance\s*[:：]\s*["'“”‘’]([^"'“”‘’]+)["'“”‘’]/)
  if (mf) decl.finalAcceptance = mf[1]
  return decl
}

test('叙述式声明（expr-2026-09-03_01-27-21 实际形态）：iterations=3 / autoDecision=true', () => {
  const src = '对本插件自动迭代3个版本\n\n已开启 AutoIteration（配置：`iterations: 3`, `autoDecision: true`），将通过 V1/V2/V3 递进演进。'
  assert.deepEqual(extractAutoIterDecl(src), { iterations: 3, finalAcceptance: null, autoDecision: true })
})

test('中文 prompt「自动迭代3个版本」：iterations=3（autoDecision 缺省 false）', () => {
  assert.deepEqual(extractAutoIterDecl('对本插件自动迭代3个版本'), { iterations: 3, finalAcceptance: null, autoDecision: false })
})

test('严格 JSON 声明块仍优先命中（含 finalAcceptance）', () => {
  const src = '{"iterations": 2, "finalAcceptance": "E2E 全过", "autoDecision": true}'
  assert.deepEqual(extractAutoIterDecl(src), { iterations: 2, finalAcceptance: 'E2E 全过', autoDecision: true })
})

test('无声明文本 → 默认单轮向后兼容', () => {
  assert.deepEqual(extractAutoIterDecl('随便聊聊'), { iterations: 1, finalAcceptance: null, autoDecision: false })
})

test('「自动演进 5 次版本」语义命中 iterations=5', () => {
  assert.equal(extractAutoIterDecl('请对本插件自动演进 5 次版本').iterations, 5)
})

test('防误报：叙述含「版本迭代过程中」无数字 → 不命中', () => {
  assert.equal(extractAutoIterDecl('在版本迭代过程中增加功能').iterations, 1)
})

test('防误报：多轮迭代 3 个步骤（无“版本”计数）→ 不命中', () => {
  assert.equal(extractAutoIterDecl('对步骤做多轮迭代 3 个步骤的检查').iterations, 1)
})

test('越界保护：iterations 超过 10 按 1 处理', () => {
  assert.equal(extractAutoIterDecl('自动迭代 99 个版本').iterations, 1)
})
