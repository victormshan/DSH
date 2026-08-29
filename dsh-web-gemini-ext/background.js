// dsh-web-gemini-ext · background service worker
// 职责：桥接本地中转服务器（localhost:8899）与 gemini.google.com 的 content script。
// 扩展上下文 fetch 不受页面 CSP 限制（host_permissions 授权 localhost:8899）。
// v1.5.0 (V2): 轮询 3s → 1s —— 主循环 setTimeout 自调度（SW 存活期间 1s 轮询），
//   chrome.alarms 仅作 SW 休眠兜底唤醒（Chrome alarms 最小周期约 0.5 分钟，无法做到 1s）；
//   自适应节流：bridge 连续不可达（≥3 次）退避到 5s，防空轮询压力；防并发重入。
// v2.3-1 (v2.0.0): 多 Tab 负载均衡 —— 维护 Gemini 标签页活跃度（tabActivity），
//   取任务时选择最久未使用的标签页分发，多标签页并行处理；单标签页行为不变。
'use strict'

const BRIDGE = 'http://localhost:8899'
const POLL_MS = 1000          // v1.5.0 V2: 3s → 1s
const POLL_BACKOFF_MS = 5000  // bridge 连续不可达时退避间隔
let pollTimer = null
let polling = false           // 防并发重入
let consecutiveFails = 0
const tabActivity = new Map() // v2.3-1: { tabId: lastUsedAt } —— 标签页活跃度（多 Tab 负载均衡）

async function bridgeFetch(path, opts) {
  const r = await fetch(BRIDGE + path, opts)
  return r.json().catch(() => ({ ok: false }))
}

// v2.3-1: 选择最久未使用的 Gemini 标签页（活跃度优先）；无记录时按数组序
function pickIdleTab(tabs) {
  if (!tabs || tabs.length === 0) return null
  if (tabs.length === 1) return tabs[0]
  let best = tabs[0]
  let bestAt = Infinity
  for (const t of tabs) {
    const at = tabActivity.get(t.id) || 0
    if (at < bestAt) { bestAt = at; best = t }
  }
  return best
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
    // v2.3-1: 清理已关闭标签页的活跃度记录
    const liveIds = new Set(tabs.map((t) => t.id))
    for (const id of tabActivity.keys()) {
      if (!liveIds.has(id)) tabActivity.delete(id)
    }
    const d = await bridgeFetch('/next-task')
    if (d && d.ok && d.task) {
      consecutiveFails = 0
      // v2.3-1: 多 Tab 负载均衡——选择最久未用的标签页分发
      const target = pickIdleTab(tabs)
      if (!target) return
      console.log('[web-gemini] 取到任务', d.task.id, '→ 分发到 Tab', target.id)
      // v0.2.1: sendMessage 失败自动重试（MV3 SW 唤醒竞态兜底——content 注入瞬间端口可能未稳定）
      let resp = null
      for (let attempt = 0; attempt < 3 && resp === null; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 2000))
          console.warn('[web-gemini] 任务', d.task.id, 'sendMessage 第', attempt + 1, '次重试（Tab', target.id + '）')
        }
        resp = await chrome.tabs.sendMessage(target.id, { type: 'handle-task', task: d.task }).catch(() => null)
      }
      if (resp && resp.answer) {
        tabActivity.set(target.id, Date.now())
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
        // v2.3-1: 该标签页不可用（content script 未注入/页面卡死）→ 记录活跃度（下次选别的）并告警
        tabActivity.set(target.id, Date.now())
        console.warn('[web-gemini] 任务', d.task.id, '处理未返回答案（Tab ' + target.id + ' content script 可能未注入，请刷新 Gemini 标签页）')
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

console.log('[web-gemini] background 已加载（1s 轮询 + 多 Tab 负载均衡 + alarms 兜底，bridge 不可达退避 5s）')
