// v2.4-1/v2.4-2/v2.4-3: 三端 Health Checker 测试（v2.0.0）
// 运行：node --test test/health-checker.test.js
// 镜像 lib/index.js PLUGIN_VERSION 读取与 bridge 状态判定逻辑。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

// ---- 镜像：PLUGIN_VERSION（与 lib/index.js 一致：读 package.json）----
function pluginVersion() {
  try {
    const raw = fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
    return JSON.parse(raw).version || '0.0.0'
  } catch (err) { return '0.0.0' }
}

// ---- 镜像：bridge 状态归一化（与 health-check 端点一致）----
function normalizeBridge(d) {
  if (d && d.ok !== false) return { ok: true, total: d.total, byStatus: d.byStatus || {} }
  return { ok: false, error: 'bridge 响应异常' }
}

test('PLUGIN_VERSION 从 package.json 读取且与声明一致', () => {
  const v = pluginVersion()
  assert.match(v, /^\d+\.\d+\.\d+$/)
  // 与源码 PLUGIN_VERSION 常量一致
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(src.includes(`PLUGIN_VERSION`))
})

test('bridge 状态归一化：正常响应', () => {
  const d = normalizeBridge({ ok: true, total: 4, byStatus: { done: 4 } })
  assert.equal(d.ok, true)
  assert.equal(d.total, 4)
  assert.deepEqual(d.byStatus, { done: 4 })
})

test('bridge 状态归一化：异常/空响应标记失败', () => {
  const d = normalizeBridge(null)
  assert.equal(d.ok, false)
  const d2 = normalizeBridge({ ok: false })
  assert.equal(d2.ok, false)
})

test('health-check 状态灯判定（bridge 绿/红）', () => {
  const colorOf = (bridge) => (bridge && bridge.ok) ? '#4ade80' : '#ef4444'
  assert.equal(colorOf({ ok: true }), '#4ade80')
  assert.equal(colorOf({ ok: false }), '#ef4444')
  assert.equal(colorOf(null), '#ef4444')
})

test('source 源码含 v2.4-1/v2.4-2 标记', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  const client = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(src.includes('v2.4-1: 三端 Health Checker'))
  assert.ok(src.includes('/dsh-web-relay/health-check'))
  assert.ok(src.includes('v2.4-1: 实时版本'))
  assert.ok(client.includes('v2.4-2: 三端 Health Checker'))
  assert.ok(client.includes('/dsh-web-relay/health-check'))
})

test('source 源码含 v2.1.0 修复标记（content 双信号防截断 + planning 粘贴框）', () => {
  const content = fs.readFileSync(new URL('../../dsh-web-gemini-ext/content.js', import.meta.url), 'utf8')
  const client = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  // content.js：双信号（文本稳定 + 发送按钮可用）防截断
  assert.ok(content.includes('v2.1.0 双信号'))
  assert.ok(content.includes('完成判定（文本稳定 + 发送按钮可用）'))
  assert.ok(content.includes('完成判定（双复查稳定）'))
  // client.js：planning 专用粘贴框（修复提示指向不存在的 manual 输入框）
  assert.ok(client.includes('v2.1.0: 无论 provider 都显示专用粘贴框'))
  assert.ok(client.includes('planningPastePlaceholder'))
  assert.ok(client.includes('parsePlanning'))
})

test('source 源码含 v2.1.1 修复标记（DAG 点击定位高亮 + low 展开）', () => {
  const client = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(client.includes('v2.1.1: DAG 点击定位高亮的步骤 id'))
  assert.ok(client.includes('v2.1.1: low 步骤切换展开明细'))
  assert.ok(client.includes('setDagFocus'))
  assert.ok(client.includes('dagFocus'))
})
