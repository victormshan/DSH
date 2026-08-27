// dsh-web-gemini-ext · background service worker
// 职责：桥接本地中转服务器（localhost:8899）与 gemini.google.com 的 content script。
// 扩展上下文 fetch 不受页面 CSP 限制（host_permissions 授权 localhost:8899）。
// v1.5.0 (V2): 轮询 3s → 1s —— 主循环 setTimeout 自调度（SW 存活期间 1s 轮询），
//   chrome.alarms 仅作 SW 休眠兜底唤醒（Chrome alarms 最小周期约 0.5 分钟，无法做到 1s）；
//   自适应节流：bridge 连续不可达（≥3 次）退避到 5s，防空轮询压力；防并发重入。
'use strict'

const BRIDGE = 'http://localhost:8899'
const POLL_MS = 1000          // v1.5.0 V2: 3s → 1s
const POLL_BACKOFF_MS = 5000  // bridge 连续不可达时退避间隔
let pollTimer = null
let polling = false           // 防并发重入
let consecutiveFails = 0

async function bridgeFetch(path, opts) {
  const r = await fetch(BRIDGE + path, opts)
  return r.json().catch(() => ({ ok: false }))
}

async function pollOnce() {
  if (polling) return
  polling = true
  try {
    const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' }).catch(() => [])
    if (!tabs || tabs.length === 0) {
      consecutiveFails = 0
      return // 无 Gemini 标签页：跳过（1s 轻轮询成本低）
    }
    const tabId = tabs[0].id
    const d = await bridgeFetch('/next-task')
    if (d && d.ok && d.task) {
      consecutiveFails = 0
      console.log('[web-gemini] 取到任务', d.task.id)
      const resp = await chrome.tabs.sendMessage(tabId, { type: 'handle-task', task: d.task }).catch(() => null)
      if (resp && resp.answer) {
        await bridgeFetch('/submit-answer', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: d.task.id, answer: resp.answer })
        })
        console.log('[web-gemini] 任务', d.task.id, '已回传, 长度', resp.answer.length)
      } else if (resp && resp.error) {
        // 处理失败：把诊断错误上报 bridge（webGeminiAsk 可读取）
        await bridgeFetch('/submit-error', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: d.task.id, error: String(resp.error).slice(0, 500) })
        })
        console.warn('[web-gemini] 任务', d.task.id, '失败:', String(resp.error).slice(0, 200))
      } else {
        console.warn('[web-gemini] 任务', d.task.id, '处理未返回答案（content script 可能未注入，请刷新 Gemini 标签页）')
      }
    } else {
      consecutiveFails = 0 // 无任务：正常（保持 1s 轻轮询）
    }
  } catch (e) {
    consecutiveFails++
    if (Date.now() % 60000 < 5000) console.warn('[web-gemini] bridge 不可达:', e && e.message)
  } finally {
    polling = false
    scheduleNext()
  }
}

// 自适应节流：连续失败（bridge 不可达）退避 5s；正常 1s
function scheduleNext() {
  clearTimeout(pollTimer)
  const delay = consecutiveFails >= 3 ? POLL_BACKOFF_MS : POLL_MS
  pollTimer = setTimeout(pollOnce, delay)
}

// alarms 兜底：SW 休眠后被唤醒时重新启动主循环（Chrome alarms 最小周期约 0.5 分钟）
chrome.alarms.create('web-gemini-poll', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener((a) => {
  if (a && a.name === 'web-gemini-poll') {
    if (!pollTimer) scheduleNext()
    pollOnce()
  }
})
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'bridge-ready') {
    pollOnce()
    sendResponse({ ok: true, polling: true })
  }
  return false
})

// 启动主循环（SW 每次唤醒顶层都会执行）
scheduleNext()

console.log('[web-gemini] background 已加载（1s 轮询 + alarms 兜底，bridge 不可达退避 5s）')
