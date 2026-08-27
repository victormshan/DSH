// dsh-web-gemini-ext · background service worker
// 职责：桥接本地中转服务器（localhost:8899）与 gemini.google.com 的 content script。
// 扩展上下文 fetch 不受页面 CSP 限制（host_permissions 授权 localhost:8899）。
// 轮询用 chrome.alarms（MV3 SW 休眠也可被唤醒），不依赖 content script 通知；
// 自动查找 gemini.google.com 标签页派发任务。
'use strict'

const BRIDGE = 'http://localhost:8899'
const POLL_MS = 3000

async function bridgeFetch(path, opts) {
  const r = await fetch(BRIDGE + path, opts)
  return r.json().catch(() => ({ ok: false }))
}

async function pollOnce() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' }).catch(() => [])
    if (!tabs || tabs.length === 0) return // 无 Gemini 标签页：跳过
    const tabId = tabs[0].id
    const d = await bridgeFetch('/next-task')
    if (d && d.ok && d.task) {
      console.log('[web-gemini] 取到任务', d.task.id)
      const resp = await chrome.tabs.sendMessage(tabId, { type: 'handle-task', task: d.task }).catch(() => null)
      if (resp && resp.answer) {
        await bridgeFetch('/submit-answer', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: d.task.id, answer: resp.answer })
        })
        console.log('[web-gemini] 任务', d.task.id, '已回传, 长度', resp.answer.length)
      } else {
        console.warn('[web-gemini] 任务', d.task.id, '处理未返回答案（content script 可能未注入，请刷新 Gemini 标签页）')
      }
    }
  } catch (e) {
    if (Date.now() % 60000 < 3000) console.warn('[web-gemini] bridge 不可达:', e && e.message)
  }
}

// 常驻轮询：chrome.alarms（SW 休眠可唤醒）；content script 就绪消息也触发立即轮询
chrome.alarms.create('web-gemini-poll', { periodInMinutes: 0.1 })
chrome.alarms.onAlarm.addListener((a) => {
  if (a && a.name === 'web-gemini-poll') pollOnce()
})
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'bridge-ready') {
    pollOnce()
    sendResponse({ ok: true, polling: true })
  }
  return false
})

console.log('[web-gemini] background 已加载（alarms 轮询每 3s）')
