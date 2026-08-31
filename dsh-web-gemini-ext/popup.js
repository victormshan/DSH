// dsh-web-gemini-ext · popup 状态面板
// 向 background 请求汇总状态并渲染；支持中/英双语提示。
'use strict'

function setDot(ok) {
  const dot = document.getElementById('bridge-dot')
  dot.className = 'dot ' + (ok === 'up' ? 'up' : ok === 'warn' ? 'warn' : 'down')
}

function set(id, text, cls) {
  const el = document.getElementById(id)
  el.textContent = text
  el.className = 'v' + (cls ? ' ' + cls : '')
}

async function refresh() {
  document.getElementById('hint').textContent = '正在读取…'
  let s = null
  try {
    s = await chrome.runtime.sendMessage({ type: 'get-status' })
  } catch (e) {
    document.getElementById('hint').textContent = 'background 不可达：' + (e && e.message)
    setDot('down')
    return
  }
  if (!s) {
    document.getElementById('hint').textContent = '无响应'
    return
  }

  const lang = (navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const t = {
    bridgeUp: lang === 'zh' ? '在线' : 'Online',
    bridgeDown: lang === 'zh' ? '离线' : 'Offline',
    wdUp: lang === 'zh' ? '守护中' : 'Guarding',
    wdDown: lang === 'zh' ? '未守护' : 'Not guarded',
    wdUnknown: '?'
  }

  setDot(s.bridge)
  set('bridge-txt', s.bridge === 'up' ? t.bridgeUp : t.bridgeDown, s.bridge === 'up' ? 'ok' : 'bad')
  set('wd-txt', s.watchdog === 'up' ? t.wdUp : (s.watchdog === 'down' ? t.wdDown : t.wdUnknown),
      s.watchdog === 'up' ? 'ok' : (s.watchdog === 'down' ? 'warn' : 'warn'))
  set('tabs-txt', String(s.geminiTabs), s.geminiTabs > 0 ? 'ok' : 'warn')
  set('poll-txt', (s.pollMs / 1000).toFixed(1) + 's' + (s.consecutiveFails >= 3 ? '（退避）' : ''))

  const st = s.stats || {}
  const by = st.byStatus || {}
  set('q-pending', String(by.pending ?? '—'))
  set('q-processing', String(by.processing ?? '—'))
  set('q-done', String(by.done ?? '—'))

  const ver = document.getElementById('ver')
  ver.textContent = 'v' + (s.version || '?')

  const hints = []
  if (s.bridge !== 'up') hints.push(lang === 'zh' ? '⚠ bridge 离线：检查 node bridge-watchdog.mjs 是否在运行' : '⚠ bridge offline: check node bridge-watchdog.mjs')
  if (s.geminiTabs === 0) hints.push(lang === 'zh' ? '⚠ 未打开 gemini.google.com 标签页' : '⚠ no gemini.google.com tab open')
  if (s.watchdog !== 'up') hints.push(lang === 'zh' ? '⚠ watchdog 未检测到：守护链可能中断' : '⚠ watchdog not detected')
  if (hints.length === 0) hints.push(lang === 'zh' ? '✅ 通道正常' : '✅ channel healthy')
  document.getElementById('hint').textContent = hints.join('\n')
}

document.getElementById('refresh').addEventListener('click', refresh)
refresh()
// 每 5s 自动刷新
setInterval(refresh, 5000)
