// dsh-web-gemini-ext · background service worker
// 职责：桥接本地中转服务器（localhost:8899）与 gemini.google.com 的 content script。
// 扩展上下文 fetch 不受页面 CSP 限制（host_permissions 授权 localhost:8899）。
// v1.5.0 (V2): 轮询 3s → 1s —— 主循环 setTimeout 自调度（SW 存活期间 1s 轮询），
//   chrome.alarms 仅作 SW 休眠兜底唤醒（Chrome alarms 最小周期约 0.5 分钟，无法做到 1s）；
//   自适应节流：bridge 连续不可达（≥3 次）退避到 5s，防空轮询压力；防并发重入。
// v2.3-1 (v2.0.0): 多 Tab 负载均衡 —— 维护 Gemini 标签页活跃度（tabActivity），
//   取任务时选择最久未使用的标签页分发，多标签页并行处理；单标签页行为不变。
// v2.4.0（wg-gap-analysis 2026-09-10 评审修复）:
//   ① 任务泄漏修复——原实现只在 resp.answer / resp.error 均为真值时才上报终态，
//      resp===null（sendMessage 4 次重试全失败）或 resp={answer:''}（content script
//      正常 resolve 但未捕获到回复文本）都会落入"只打日志、不上报"的静默分支，
//      导致 bridge 任务永久停留 processing（见 dsh-web-relay lib/bridge-poll.js 头注、
//      2026-09-09 探活实测：16/16 历史任务无一成功，AutoIteration 两次 /ask 各白等
//      300s）。现在收敛为两分支：只要没拿到非空 answer，一律 submit-error 带诊断文案，
//      不再存在"既不 submit-answer 也不 submit-error"的第三态。
//   ② token 自愈——原 ensureToken() 只在 bridgeToken 为空串时才重取，一旦缓存过一次
//      就永不刷新；若 bridge.token 文件被删除/bridge 重装导致 token 轮换，扩展会永久
//      401 且无法自愈。现在 bridgeFetch 收到 401 时清空缓存重取一次并重试一次。
//   两处修复均不引入新依赖、不改消息协议字段名（仍是 answer/error/id），与 bridge-server
//   接口、chrome.* API 用法、多 Tab 负载均衡逻辑完全兼容。
'use strict'

const BRIDGE = 'http://localhost:8899'
const POLL_MS = 1000          // v1.5.0 V2: 3s → 1s
const POLL_BACKOFF_MS = 5000  // bridge 连续不可达时退避间隔
let pollTimer = null
let polling = false           // 防并发重入
let consecutiveFails = 0
const tabActivity = new Map() // v2.3-1: { tabId: lastUsedAt } —— 标签页活跃度（多 Tab 负载均衡）
// v2.6.0（架构征询 P0）: 标签页自动补建节流（避免每次无标签页轮询都尝试创建）
const TAB_ENSURE_INTERVAL_MS = 30000
let lastEnsureTabAt = 0
// v0.4.0（P1）: 页面自愈重载节流（{ tabId: lastReloadAt }）——防止失败时 reload 风暴
const tabReloadAt = new Map()
const RELOAD_THROTTLE_MS = 60000
// v0.4.0: 最近一次 offscreen 保活心跳（供 get-status 展示，判断 SW 是否被持续续期）
let lastKeepaliveAt = null
// v0.4.0（P1）: 最近一次上报给桥接的扩展健康状态（供 get-status 展示）
let workerHealth = { authState: 'UNKNOWN', isReady: null }
// v0.4.2（可观测性）：标签页存在性与补建结果——外部（桥接/宿主）借此区分
// "扩展在跑但没标签页"（tabCount=0 + ens=created/throttled/error:*）与"标签页在但页面没就绪"。
// 此前这两种状态在 bridge 侧都表现为 worker 旧值，无法区分（实测排查困难）。
let tabCount = null
let ensureResult = ''

// v0.4.0: 共享 token 认证（与 bridge-server 同机读取 bridge.token；文件缺失时 bridge 处于
// 未认证模式会 401，此时明确报错引导用户检查 bridge 版本/重启，而非静默失败）
let bridgeToken = ''
async function loadInitialToken() {
  try {
    const res = await fetch(BRIDGE + '/__token')
    const data = await res.json()
    bridgeToken = (data && data.token) || ''
  } catch { /* 首次加载 bridge 可能未起，pollOnce 时再取 */ }
}
loadInitialToken()

async function ensureToken() {
  if (bridgeToken) return bridgeToken
  try {
    const t = await (await fetch(BRIDGE + '/__token')).json()
    bridgeToken = (t && t.token) || ''
  } catch { /* 仍不可达 */ }
  return bridgeToken
}

async function bridgeFetch(path, opts) {
  const token = await ensureToken()
  const r = await fetch(BRIDGE + path, {
    ...opts,
    headers: { ...(opts && opts.headers), 'x-dsh-bridge-token': token }
  })
  // v2.4.0: token 可能已轮换（bridge.token 文件被删/bridge 重装）——原实现一旦缓存非空
  // 就永不重取，401 后会永久卡死。这里清空缓存重取一次 token 再重试一次。
  if (r.status === 401 && bridgeToken) {
    bridgeToken = ''
    const freshToken = await ensureToken()
    const retry = await fetch(BRIDGE + path, {
      ...opts,
      headers: { ...(opts && opts.headers), 'x-dsh-bridge-token': freshToken }
    })
    return retry.json().catch(() => ({ ok: false }))
  }
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
    tabCount = (tabs && tabs.length) || 0
    if (!tabs || tabs.length === 0) {
      consecutiveFails = 0
      // v2.6.0（架构征询 P0——web-gemini 最大瓶颈修复）: 无 Gemini 标签页时**自动补建**，
      // 而非原实现的静默 return。根因实测：无标签页 → 扩展不取任务 → 桥接任务永久 pending →
      // 宿主只能靠 60s pending 早退感知"通道不可用"（poll=0 是该状态表征）。
      // 补建策略：每 TAB_ENSURE_INTERVAL_MS（默认 30s）最多尝试一次，pinned + 后台（active:false，
      // 不抢用户焦点）；失败静默（如 Chrome 未运行/无权限），下轮再试。
      const now = Date.now()
      if (now - lastEnsureTabAt > TAB_ENSURE_INTERVAL_MS) {
        lastEnsureTabAt = now
        try {
          const t = await chrome.tabs.create({ url: 'https://gemini.google.com/app', active: false, pinned: true })
          ensureResult = 'created:' + (t && t.id)
          console.log('[web-gemini] 无 Gemini 标签页 → 自动补建（tab', t && t.id, '后台 + pinned）')
        } catch (e) {
          ensureResult = 'error:' + String((e && e.message) || e).slice(0, 60)
          console.warn('[web-gemini] 自动补建标签页失败:', String((e && e.message) || e).slice(0, 120))
        }
      } else {
        ensureResult = 'throttled'
      }
      // v0.4.2（可观测性）: 无标签页分支原先**直接 return，不轮询 bridge** →
      // 外部完全看不到"扩展在跑但没标签页"（bridge 侧 pollCount 也会停，与 SW 死亡混淆）。
      // 现在照样用 healthQs 上报一次（tabCount=0 + ensure 结果），既保留可观测性，
      // 也让宿主可据此快速降级而不是干等。
      await bridgeFetch('/next-task?authState=UNKNOWN&isReady=0&tc=0&ens=' + encodeURIComponent(ensureResult)).catch(() => {})
      return // 本轮不取任务（下一轮即可查到新标签页）
    }
    // v2.3-1: 清理已关闭标签页的活跃度记录
    const liveIds = new Set(tabs.map((t) => t.id))
    for (const id of tabActivity.keys()) {
      if (!liveIds.has(id)) tabActivity.delete(id)
    }
    // v0.4.0（Chrome 侧加固 P1——健康上报）: 轮询时携带扩展侧健康状态，使桥接/宿主能
    // "秒级"识别"未登录/页面未就绪"（而非等 60s pending 早退或 120s sweep）。
    // 探测方式：向当前标签页发一条轻量探针（content script 的 page-health），带 800ms 超时；
    // 探测失败不阻塞轮询（按 UNKNOWN 上报）。
    let health = { authState: 'UNKNOWN', isReady: null }
    try {
      const probe = await Promise.race([
        chrome.tabs.sendMessage(tabs[0].id, { type: 'page-health' }).catch(() => null),
        new Promise((r) => setTimeout(() => r(null), 800)),
      ])
      if (probe && typeof probe === 'object') {
        health = { authState: probe.authState || 'UNKNOWN', isReady: probe.isReady === true }
      }
    } catch { /* 探测失败：按 UNKNOWN 上报 */ }
    workerHealth = health
    // v0.4.2（可观测性）: 标签页指纹——反复出现的"用户说没有标签页、扩展却能探测成功"这类
    // 矛盾只能靠"标签页到底在哪"来解开：pinned/active 状态、windowId、URL 路径。
    // 实测背景：补建出的 pinned 后台标签页在标签栏最左侧，极易被忽略/看成别的东西。
    const t0 = tabs[0]
    let tinfo = ''
    try {
      const path = (() => { try { return new URL(t0.url).pathname } catch { return '' } })()
      tinfo = `${t0.pinned ? 'p' : '-'}${t0.active ? 'a' : '-'}w${t0.windowId}${path.slice(0, 32)}`
    } catch { tinfo = '' }
    const healthQs = `&authState=${encodeURIComponent(health.authState)}${health.isReady === null ? '' : `&isReady=${health.isReady ? '1' : '0'}`}`
      + `&tc=${tabCount}`
      + (tinfo ? '&tinfo=' + encodeURIComponent(tinfo) : '')
      + (ensureResult ? '&ens=' + encodeURIComponent(ensureResult) : '')
    const d = await bridgeFetch('/next-task' + (healthQs ? '?' + healthQs.slice(1) : ''))
    if (d && d.ok && d.task) {
      consecutiveFails = 0
      // v2.3-1: 多 Tab 负载均衡——选择最久未用的标签页分发
      const target = pickIdleTab(tabs)
      if (!target) return
      console.log('[web-gemini] 取到任务', d.task.id, '→ 分发到 Tab', target.id)
      // 自动激活 Gemini 标签页，确保 content script 可响应（即使用户当前在 harness 页）
        try { await chrome.tabs.update(target.id, { active: true }); await chrome.windows.update(target.windowId, { focused: true }) } catch (e) {}
      // v2.5.0（stab1_2 稳定性实测修复）: sendMessage **必须带超时**——原实现只 .catch(() => null)
      // 覆盖 reject，但 chrome.tabs.sendMessage 的 Promise 在 content script 丢失/端口悬挂时
      // 可能**既不 resolve 也不 reject**（既不返回也不报错）→ 循环永久 await，任务永久 processing
      // （2026-09-10 实测：任务 t0001 claimed 后 132s 无终态，只能靠服务端 120s sweep 兜底）。
      // 现在单次等待给 70s（content.js 内部：输入约 3s + waitReply 上限 60s + 5s 兜底 = 65s 之内
      // 必然 sendResponse），超时即视为 NO_RESPONSE 进入 submit-error，使宿主在 90s 停滞阈值前
      // 拿到明确诊断而非 stalled 兜底。
      const SEND_TIMEOUT_MS = 70000
      const sendWithTimeout = (tabId, msg) => Promise.race([
        chrome.tabs.sendMessage(tabId, msg).catch(() => null),
        new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), SEND_TIMEOUT_MS)),
      ])
      let resp = null
      for (let attempt = 0; attempt < 2 && resp === null; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 2000))
          try { await chrome.tabs.update(target.id, { active: true }); await chrome.windows.update(target.windowId, { focused: true }) } catch (e) {}
            console.warn('[web-gemini] 任务', d.task.id, 'sendMessage 第', attempt + 1, '次重试（Tab', target.id + '）')
        }
        const r = await sendWithTimeout(target.id, { type: 'handle-task', task: d.task })
        // 超时哨兵不视为有效响应（继续下一轮重试；最后一轮结束后按 resp===null 走 NO_RESPONSE）
        if (r && r.__timeout) {
          console.warn('[web-gemini] 任务', d.task.id, 'sendMessage 超时', SEND_TIMEOUT_MS + 'ms（content script 无响应，Tab', target.id + '）')
          resp = null
        } else {
          resp = r
        }
      }
      if (resp && resp.answer) {
        tabActivity.set(target.id, Date.now())
        await bridgeFetch('/submit-answer', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: d.task.id, answer: resp.answer })
        })
        console.log('[web-gemini] 任务', d.task.id, '已回传, 长度', resp.answer.length)
      } else {
        // v2.4.0 修复任务泄漏：原实现这里分两支（resp.error 有值才 submit-error，
        // 否则只打日志），resp===null 或 resp={answer:''} 都会落入"只打日志"分支，
        // 导致 bridge 任务永久停留 processing。现在统一在此上报 submit-error——
        // 没有拿到非空 answer 就一定视为失败，区分三种情况给出诊断文案，
        // 让宿主侧 classifyBridgeTask 能立即识别 failed 早退，不再白等 300s 超时。
        tabActivity.set(target.id, Date.now())
        let diag
        let needsReload = false
        if (resp && resp.error) {
          diag = String(resp.error).slice(0, 500)
          // v0.4.0（P1——reload 自愈）: content 侧标记"页面态异常"（未就绪/选择器失配）时，
          // 顺手重载一次标签页（节流 RELOAD_THROTTLE_MS），使下一次任务落到干净页面；
          // 且 NO_RESPONSE（sendMessage 全失败/页面卡死）同样需要 reload 才能恢复。
          needsReload = resp.needsReload === true || /INPUT_NOT_FOUND|EMPTY_REPLY/.test(diag)
        } else if (resp) {
          diag = 'EMPTY_REPLY: content script 未捕获到回复文本（Tab ' + target.id + '，可能选择器未命中回复 DOM 或页面无新增内容），请检查 Gemini 页面是否正常/已登录'
          needsReload = true
        } else {
          diag = 'NO_RESPONSE: sendMessage 重试均未获得响应（Tab ' + target.id + ' content script 可能未注入/页面卡死/扩展上下文失效，请刷新 Gemini 标签页）'
          needsReload = true
        }
        await bridgeFetch('/submit-error', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: d.task.id, error: diag })
        })
        console.warn('[web-gemini] 任务', d.task.id, '失败:', diag)
        // 自愈：节流重载（同 Tab RELOAD_THROTTLE_MS 内最多一次，避免 reload 风暴）
        if (needsReload) {
          const last = tabReloadAt.get(target.id) || 0
          if (Date.now() - last > RELOAD_THROTTLE_MS) {
            tabReloadAt.set(target.id, Date.now())
            try {
              await chrome.tabs.reload(target.id)
              console.warn('[web-gemini] 已触发标签页自愈重载（Tab', target.id + '）')
            } catch (e) { /* reload 失败：下轮再试 */ }
          } else {
            console.warn('[web-gemini] 页面态异常但距上次重载不足节流窗口，跳过 reload（Tab', target.id + '）')
          }
        }
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

// v0.4.0（Chrome 侧加固 P0——Offscreen 保活）:
// MV3 SW 空闲约 30s 会被回收，而本扩展的 1s 级轮询依赖 SW 存活；原实现只有 alarms（≥0.5min）兜底，
// 粒度太粗 → SW 被回收期间轮询停摆（表现为桥接 lastPollAt 停更，宿主只能靠 pending 早退感知）。
// 这里创建一个 offscreen 文档承载 20s 周期的心跳（offscreen.js），使 SW 持续被唤醒续期。
// 注意：仅保活，不做抓取/网络（避免与 content script 职责重叠与 offscreen 滥用风险）。
const OFFSCREEN_PATH = 'offscreen.html'
let ensuringOffscreen = false
async function ensureOffscreen() {
  if (ensuringOffscreen) return
  ensuringOffscreen = true
  try {
    if (!chrome.offscreen || !chrome.offscreen.createDocument) return
    // hasDocument 在较新 Chrome 可用；否则用 getContexts 兜底
    let exists = false
    try {
      if (typeof chrome.offscreen.hasDocument === 'function') exists = await chrome.offscreen.hasDocument()
      else if (chrome.runtime.getContexts) {
        const ctxs = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
        exists = Array.isArray(ctxs) && ctxs.length > 0
      }
    } catch { /* 探测失败按不存在处理 */ }
    if (exists) return
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      // DOM_SCRAPING 是本扩展的语义最接近项（SW 保活用于驱动页面抓取链路）；
      // reasons 属 Chrome 白名单枚举，不能自定义文案。
      reasons: ['DOM_SCRAPING'],
      justification: 'keep MV3 service worker alive so the 1s task polling for gemini.google.com does not stop',
    })
    console.log('[web-gemini] offscreen 保活文档已创建')
  } catch (e) {
    // 失败不应影响主流程（alarms 兜底仍在）；记录供排查
    console.warn('[web-gemini] offscreen 保活创建失败（降级为 alarms 兜底）:', String((e && e.message) || e).slice(0, 160))
    offscreenFailed = String((e && e.message) || e).slice(0, 160)
  } finally {
    ensuringOffscreen = false
  }
}
let offscreenFailed = null
ensureOffscreen()

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // v0.4.0: offscreen 心跳——收到即续期（同时兜底：若 offscreen 已被销毁则重建）
  if (msg && msg.type === 'keepalive-ping') {
    lastKeepaliveAt = new Date().toISOString()
    ensureOffscreen()
    sendResponse({ ok: true })
    return false
  }
  if (msg && msg.type === 'bridge-ready') {
    pollOnce()
    sendResponse({ ok: true, polling: true })
    return false
  }
  // v0.3.0: popup 状态面板——汇总 bridge/守护/标签页/队列状态
  if (msg && msg.type === 'get-status') {
    ;(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' }).catch(() => [])
      const stats = await bridgeFetch('/stats').catch(() => null)
      // v0.4.0: /__watchdog 也走 bridgeFetch（带 token），否则 401
      let watchdog = 'unknown'
      try {
        const wd = await bridgeFetch('/__watchdog')
        watchdog = wd && wd.alive ? 'up' : 'down'
      } catch { watchdog = 'down' }
      sendResponse({
        bridge: stats && stats.ok ? 'up' : 'down',
        stats: stats || null,
        geminiTabs: tabs.length,
        watchdog,
        pollMs: consecutiveFails >= 3 ? POLL_BACKOFF_MS : POLL_MS,
        consecutiveFails,
        version: chrome.runtime.getManifest().version
      })
    })()
    return true   // 异步 sendResponse
  }
  return false
})

// 启动主循环（SW 每次唤醒顶层都会执行）
scheduleNext()

console.log('[web-gemini] background 已加载（1s 轮询 + 多 Tab 负载均衡 + alarms 兜底，bridge 不可达退避 5s）')
