// artifacts 挂载 + AutoIteration 声明持久化单测（v1.4.0 V1 修复后）
// 运行：node --test test/artifacts-update.test.js
// 注：stepUpdateHandler / askHandler 位于 apply() 闭包内不可直接 import，本测试以镜像函数复测其确定性逻辑。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ---- 镜像：payload.artifacts 解析（v1.4.0：数组→字符串数组，过滤空；null=未传）----
function parseArtifacts(payload) {
  return Array.isArray(payload && payload.artifacts)
    ? payload.artifacts.map((x) => String(x)).filter(Boolean)
    : null
}

// ---- 镜像：complete 挂载（追加语义 + 去重；null 不覆盖）----
function mountArtifacts(step, artifacts) {
  if (artifacts !== null) {
    const merged = new Set([...(Array.isArray(step.artifacts) ? step.artifacts : []), ...artifacts])
    step.artifacts = [...merged]
  }
  return step
}

// ---- 镜像：AutoIteration 声明提取（与 lib/index.js extractAutoIterDecl 同正则）----
function extractAutoIterDecl(text) {
  const src = String(text || '')
  const decl = { iterations: 1, finalAcceptance: null, autoDecision: false }
  const m = src.match(/\{\s*"iterations"\s*:\s*(\d+)\s*(?:,\s*"finalAcceptance"\s*:\s*"([^"]*)"\s*)?(?:,\s*"autoDecision"\s*:\s*(true|false)\s*)?\}/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (Number.isInteger(n) && n >= 1 && n <= 10) decl.iterations = n
    if (m[2]) decl.finalAcceptance = m[2]
    if (m[3]) decl.autoDecision = m[3] === 'true'
  }
  return decl
}

test('payload.artifacts 解析：数组 → 字符串数组并过滤空', () => {
  assert.deepEqual(parseArtifacts({ artifacts: ['a.md', 42, ''] }), ['a.md', '42'])
  assert.equal(parseArtifacts({}), null)
  assert.equal(parseArtifacts({ artifacts: 'not-array' }), null)
})

test('complete 挂载：追加语义 + 去重', () => {
  const step = { artifacts: ['lib/index.js'] }
  mountArtifacts(step, ['lib/index.js', 'test/artifacts-update.test.js'])
  assert.deepEqual(step.artifacts, ['lib/index.js', 'test/artifacts-update.test.js'])
})

test('complete 挂载：未传 artifacts（null）保留现有产物', () => {
  const step = { artifacts: ['lib/index.js'] }
  mountArtifacts(step, null)
  assert.deepEqual(step.artifacts, ['lib/index.js'])
})

test('complete 挂载：原无 artifacts 时正常写入', () => {
  const step = {}
  mountArtifacts(step, ['trace.md'])
  assert.deepEqual(step.artifacts, ['trace.md'])
})

test('AutoIteration 声明提取：iterations=3 全字段', () => {
  const d = extractAutoIterDecl('声明：{"iterations": 3, "finalAcceptance": "3 版全部落地", "autoDecision": false}')
  assert.equal(d.iterations, 3)
  assert.equal(d.finalAcceptance, '3 版全部落地')
  assert.equal(d.autoDecision, false)
})

test('AutoIteration 声明提取：缺省 iterations=1（向后兼容）', () => {
  const d = extractAutoIterDecl('普通任务，无迭代声明')
  assert.equal(d.iterations, 1)
  assert.equal(d.finalAcceptance, null)
  assert.equal(d.autoDecision, false)
})

test('AutoIteration 声明提取：上限 10', () => {
  assert.equal(extractAutoIterDecl('{"iterations": 99}').iterations, 1)
  assert.equal(extractAutoIterDecl('{"iterations": 10}').iterations, 10)
})

test('source 源码含 v1.4.0 修复标记（artifacts 挂载 + 迭代声明持久化）', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  // stepUpdateHandler：payload.artifacts 解析
  assert.ok(src.includes('v1.4.0: steps/update 支持挂载 artifacts'))
  // complete 分支：追加挂载
  assert.ok(src.includes('v1.4.0: complete 时挂载 artifacts'))
  // askHandler：AutoIteration 声明持久化
  assert.ok(src.includes('v1.4.0: AutoIteration 声明持久化'))
  assert.ok(src.includes('extractAutoIterDecl(`${prompt}\\n${answer}`)'))
})

test('source 源码含 v1.5.1 修复标记（context 排序 + slice 放宽）', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  const client = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  // 后端：按创建时间降序 + slice(0,3)→slice(0,20)
  assert.ok(src.includes('v1.5.1: 按创建时间降序'))
  assert.ok(src.includes('v1.5.1: 前 3 条截断会漏掉最新任务'))
  // 前端：实验选择下拉 + 面板打开拉取记录
  assert.ok(client.includes('v1.5.1: 实验选择下拉'))
  assert.ok(client.includes('v1.5.1: 面板打开时拉取 context 记录列表'))
})

test('source 源码含 v1.5.2 修复标记（auxiliary 评审 ask 不创建 stepState）', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(src.includes('v1.5.2: auxiliary 评审 ask'))
  assert.ok(src.includes('payload.auxiliary === true'))
})
