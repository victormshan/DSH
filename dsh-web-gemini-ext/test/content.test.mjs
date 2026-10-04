// content.js 纯逻辑单测：在 vm 沙箱里加载真实的 content.js（chrome / document / sessionStorage 打桩），
// 通过 __exports 测试钩子取出函数。运行：node --test dsh-web-gemini-ext/test/
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

function memoryStorage() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}

function load() {
  const exp = {}
  const sandbox = {
    __exports: exp,
    console: { log() {}, warn() {}, error() {} },
    sessionStorage: memoryStorage(),
    location: { href: 'https://gemini.google.com/app' },
    chrome: { runtime: { onMessage: { addListener() {} }, sendMessage: () => Promise.resolve() } },
    document: {
      execCommand() { return true },
      querySelector: () => null,
      querySelectorAll: () => [],
      activeElement: null,
    },
    InputEvent: class { constructor(type) { this.type = type } },
    Event: class { constructor(type) { this.type = type } },
    setTimeout,
  }
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8'), sandbox)
  return { ...exp, sandbox }
}

test('自身写入的提示被识别为残留（含空白改写与截断）', () => {
  const c = load()
  const prompt = '你是三方协作协议中的【外部审核者】，独立于实施方（另一家厂商的 AI）。你只负责找问题。'.repeat(3)
  c.rememberOwnPrompt(prompt, c.sandbox.sessionStorage)
  assert.equal(c.isOwnResidue(prompt, c.sandbox.sessionStorage), true)
  // contenteditable 读回时换行/空格被改写
  assert.equal(c.isOwnResidue(prompt.replace(/，/g, '， \n'), c.sandbox.sessionStorage), true)
  // 只残留了前一部分（发送了一半/被截断）
  assert.equal(c.isOwnResidue(prompt.slice(0, 30), c.sandbox.sessionStorage), true)
})

test('用户自己输入的内容不是残留：仍按 INPUT_BUSY 保护', () => {
  const c = load()
  c.rememberOwnPrompt('你是三方协作协议中的【外部审核者】，独立于实施方', c.sandbox.sessionStorage)
  assert.equal(c.isOwnResidue('帮我写一首关于秋天的诗', c.sandbox.sessionStorage), false)
  assert.equal(c.isOwnResidue('你是', c.sandbox.sessionStorage), false, '过短的片段不足以判定为自身残留')
  assert.equal(c.isOwnResidue('', c.sandbox.sessionStorage), false)
})

test('只保留最近若干条指纹，存储损坏时退化为旧行为', () => {
  const c = load()
  const s = c.sandbox.sessionStorage
  for (let i = 0; i < 12; i++) c.rememberOwnPrompt(`第${i}条提示`.padEnd(40, '内容'), s)
  assert.equal(c.isOwnResidue('第0条提示'.padEnd(40, '内容'), s), false)
  assert.equal(c.isOwnResidue('第11条提示'.padEnd(40, '内容'), s), true)
  s.setItem('dsh-web-gemini:own-prompts', '{not json')
  assert.equal(c.isOwnResidue('第11条提示'.padEnd(40, '内容'), s), false)
})

test('clearInput 不再按 Enter（Enter 会把残留发送出去），清不掉时返回 false', () => {
  const c = load()
  const events = []
  const sticky = {
    isContentEditable: true,
    innerText: '残留提示',
    focus() {},
    set textContent(v) { /* 编辑器拒绝修改 */ },
    get textContent() { return '残留提示' },
    dispatchEvent(e) { events.push(e.type) },
  }
  assert.equal(c.clearInput(sticky), false)
  assert.ok(!events.some((t) => /key/.test(t)), `不得派发按键事件：${events}`)
  const ok = {
    isContentEditable: true,
    _t: '残留',
    get innerText() { return this._t },
    focus() {},
    set textContent(v) { this._t = v },
    get textContent() { return this._t },
    dispatchEvent() {},
  }
  assert.equal(c.clearInput(ok), true)
})
