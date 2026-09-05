// v4.4 U3: AutoIteration 声明解析测试（镜像 lib/autoiter-decl.js）
// 运行：node --test test/auto-iter-decl.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { extractAutoIterDecl } from '../lib/autoiter-decl.js'

test('标准 JSON 块（finalAcceptance 在 autoDecision 前，旧序）', () => {
  const d = extractAutoIterDecl('请做 {"iterations": 3, "finalAcceptance": "完成ABC", "autoDecision": true} 的迭代')
  assert.equal(d.iterations, 3); assert.equal(d.finalAcceptance, '完成ABC'); assert.equal(d.autoDecision, true)
})

test('JSON 字段顺序无关（autoDecision 在 finalAcceptance 前——V1 实验失败形态）', () => {
  const d = extractAutoIterDecl('声明：{"iterations": 3, "autoDecision": true, "finalAcceptance": "完成发布"}')
  assert.equal(d.iterations, 3); assert.equal(d.finalAcceptance, '完成发布'); assert.equal(d.autoDecision, true)
})

test('叙述式行内（带引号：iterations": 3 / autoDecision": true——V1 实验另一失败形态）', () => {
  const d = extractAutoIterDecl('自动迭代声明 iterations": 5 版本，autoDecision": true，finalAcceptance": "x"')
  assert.equal(d.iterations, 5); assert.equal(d.autoDecision, true); assert.equal(d.finalAcceptance, 'x')
})

test('中文叙述「自动迭代 3 个版本」', () => {
  const d = extractAutoIterDecl('这次要自动迭代 3 个版本，重点是把面板块做出来')
  assert.equal(d.iterations, 3)
})

test('缺省与非法：无声明 → 1/false/null；超限 99 不采纳', () => {
  assert.deepEqual(extractAutoIterDecl('普通任务文本'), { iterations: 1, finalAcceptance: null, autoDecision: false })
  const d2 = extractAutoIterDecl('{"iterations": 99}')
  assert.equal(d2.iterations, 1)
})

test('source：lib/index.js 已改用 lib/autoiter-decl.js（U3 接线）', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(src.includes("from './autoiter-decl.js'"))
  assert.ok(src.includes('extractAutoIterDeclLib(text)'))
})
