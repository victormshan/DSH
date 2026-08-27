// dsh-web-gemini-ext · content script（gemini.google.com）
// 职责：接收 background 的 handle-task → DOM 自动输入+发送 → MutationObserver 精确判定回复完成 → 抓取回传。
'use strict'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- DOM 工具（宽松选择器，避开易变的 class 名）----
function getInput() {
  // 精确优先：contenteditable + 聊天相关 aria-label/role；回退现选择器
  const candidates = [
    ...document.querySelectorAll('[contenteditable="true"]'),
    ...document.querySelectorAll('textarea')
  ]
  const chat = candidates.find((el) => {
    const label = (el.getAttribute('aria-label') || '').toLowerCase()
    const role = (el.getAttribute('role') || '').toLowerCase()
    return label.includes('prompt') || label.includes('message') || label.includes('输入') || label.includes('对话') || role === 'textbox'
  })
  return chat || candidates[candidates.length - 1] || null
}
function getSendButton(input) {
  const btns = [...document.querySelectorAll('button')]
  // 若给了输入框，优先在其祖先容器内找发送按钮（避免匹配页面其他按钮）
  let scope = btns
  if (input) {
    let el = input.parentElement, hops = 0
    while (el && hops < 5) {
      const inScope = btns.filter((b) => el.contains(b))
      if (inScope.length > 0) { scope = inScope; break }
      el = el.parentElement
      hops++
    }
  }
  const send = scope.find((b) => {
    const label = ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')).toLowerCase()
    const text = (b.textContent || '').toLowerCase()
    return (label.includes('send') || label.includes('发送') || label.includes('stop') || label.includes('停止')) ||
      (text.includes('send') && b.textContent.trim().length < 12)
  })
  return send || null
}
function pressEnter(el) {
  for (const type of ['keydown', 'keypress', 'keyup']) {
    el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))
  }
}
async function setInputValue(el, text) {
  el.focus()
  if (el.isContentEditable) {
    // 主方案：ClipboardEvent + DataTransfer（同步构造、立即生效、中文 UTF-8 保真）
    // 备用：navigator.clipboard（带 800ms 超时保护——无用户手势时 writeText 可能挂起）
    try {
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      const evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
      el.dispatchEvent(evt)
      const got = el.textContent || ''
      if (got.trim() === text.trim()) return true
    } catch { /* 模拟粘贴失败，走备用 */ }
    try {
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise((_, rej) => setTimeout(() => rej(new Error('clipboard timeout')), 800))
      ])
      document.execCommand('paste')
      const got = el.textContent || ''
      if (got.trim() === text.trim()) return true
    } catch { /* clipboard 权限/挂起，走回退 */ }
    document.execCommand('selectAll', false, null)
    document.execCommand('insertText', false, text)
    return true
  } else {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }
}
function replyNodes() {
  return [...document.querySelectorAll('model-response, .model-response-text, [data-test-id="model-response"]')]
}
function lastReplyNode() {
  const nodes = replyNodes()
  return nodes[nodes.length - 1] || null
}
// v0.3.0 基线法：只抓取"发送之后新出现的回复"，避免抓到页面上旧对话的回复
function grabReply(baseCount) {
  const nodes = replyNodes()
  const fresh = nodes.slice(baseCount || 0)
  const target = fresh[fresh.length - 1] || nodes[nodes.length - 1] || null
  return target ? (target.textContent || '').trim() : ''
}
function freshReplyLen(baseCount) {
  const nodes = replyNodes()
  const fresh = nodes.slice(baseCount || 0)
  const target = fresh[fresh.length - 1] || null
  return target ? (target.textContent || '').trim().length : 0
}

// ---- MutationObserver + 定时器判定回复完成（基线法，含复查防截断）----
// 关键：Gemini 长回答生成中可能有 >2s 停顿（文字→代码块切换），
// 简单稳定判定会误判完成导致抓取截断。因此：稳定 2s 后**复查**——
// 再等 2s 若文本仍不变才判定完成；文本继续变化则重新计时。
function waitReply(maxMs, baseCount) {
  return new Promise((resolve) => {
    const deadline = Date.now() + maxMs
    let lastLen = -1
    let seen = false
    let settled = false
    let settleTimer = null
    const done = () => {
      if (settled) return
      settled = true
      clearTimeout(settleTimer)
      observer.disconnect()
      resolve(grabReply(baseCount))
    }
    const scheduleSettle = () => {
      clearTimeout(settleTimer)
      settleTimer = setTimeout(async () => {
        if (settled) return
        if (!seen) return
        const lenNow = freshReplyLen(baseCount)
        if (lenNow < 5) { scheduleSettle(); return }
        // 复查 1：再等 2s，文本仍相同才继续（排除生成中停顿）
        await new Promise((r) => setTimeout(r, 2000))
        if (settled) return
        const len1 = freshReplyLen(baseCount)
        if (len1 !== lenNow) { scheduleSettle(); return }
        // v2.1.0 双信号：文本稳定后若发送按钮已回到「Send 可用」状态 → 判定完成（快）；
        // 否则（按钮仍为 Stop/不可用 = 可能分两段输出：文字→停顿→代码块）再复查 2s，
        // 文本仍不变才判定完成（防截断兜底，覆盖 v2.0.0 评审 ask 截断案例）。
        const btn = getSendButton()
        const label = btn ? (((btn.getAttribute('aria-label') || '') + ' ' + (btn.getAttribute('title') || '')).toLowerCase()) : ''
        const sendReady = Boolean(btn) && !label.includes('stop') && !label.includes('停止') && !btn.disabled
        if (sendReady) {
          console.log('[web-gemini] 完成判定（文本稳定 + 发送按钮可用）len=' + len1)
          done()
          return
        }
        await new Promise((r) => setTimeout(r, 2000))
        if (settled) return
        const len2 = freshReplyLen(baseCount)
        if (len2 !== len1) { scheduleSettle() /* 文本继续变化：重新计时 */ ; return }
        console.log('[web-gemini] 完成判定（双复查稳定）len=' + len2)
        done()
      }, 2000)
    }
    const observer = new MutationObserver(() => {
      const now = Date.now()
      const len = freshReplyLen(baseCount)
      if (now > deadline) { done(); return }
      if (len >= 5) seen = true
      if (len !== lastLen) { lastLen = len; scheduleSettle() }
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    setTimeout(() => { done() }, maxMs + 5000)
  })
}

async function handleTask(task) {
  const input = getInput()
  if (!input) { console.error('[web-gemini] 未找到输入框'); return '' }
  // 发送前记录回复节点基线（旧对话回复不参与抓取）
  const baseCount = replyNodes().length
  await setInputValue(input, task.prompt)
  await sleep(400)
  const send = getSendButton()
  const verify = input.isContentEditable ? (input.textContent || '') : (input.value || '')
  console.log('[web-gemini] 输入框:', input.isContentEditable ? 'contenteditable' : 'textarea',
    '| 填入后内容前40:', JSON.stringify(verify.slice(0, 40)),
    '| 发送按钮:', send ? (send.getAttribute('aria-label') || send.textContent || '?').trim().slice(0, 20) : '未找到',
    '| 基线回复数:', baseCount)
  // 发送：填入后等待发送按钮可用（Gemini 输入有效后 disabled→enabled）再点击；
  // 找不到/不可用则 Enter 发送。
  let sendBtn = getSendButton(input)
  const waitBtn = Date.now() + 3000
  while (sendBtn && sendBtn.disabled && Date.now() < waitBtn) {
    await sleep(300)
    sendBtn = getSendButton(input)
  }
  if (sendBtn && !sendBtn.disabled) {
    sendBtn.click()
    console.log('[web-gemini] 点击发送按钮:', (sendBtn.getAttribute('aria-label') || sendBtn.textContent || '?').trim().slice(0, 20), '| disabled:', sendBtn.disabled)
  } else {
    pressEnter(input)
    console.log('[web-gemini] 发送按钮不可用/未找到（disabled=' + (sendBtn ? sendBtn.disabled : 'n/a') + '），改用 Enter 发送')
  }
  // 发送确认：发送成功输入框会清空；1.5s 后未清空则 Enter 重试一次
  await sleep(1500)
  const after = input.isContentEditable ? (input.textContent || '') : (input.value || '')
  if (after.trim()) {
    console.warn('[web-gemini] 输入框未清空（发送可能未生效），Enter 重试')
    pressEnter(input)
    await sleep(1000)
    const after2 = input.isContentEditable ? (input.textContent || '') : (input.value || '')
    if (after2.trim()) {
      const diag = 'SEND_FAIL: 输入框类型=' + (input.isContentEditable ? 'contenteditable' : 'textarea') +
        ' | 填入后内容前40=' + JSON.stringify(verify.slice(0, 40)) +
        ' | 按钮=' + (sendBtn ? (sendBtn.getAttribute('aria-label') || sendBtn.textContent || '?').trim().slice(0, 20) + '(disabled=' + sendBtn.disabled + ')' : '未找到') +
        ' | 重试后残留=' + JSON.stringify(after2.slice(0, 30))
      console.error('[web-gemini]', diag)
      throw new Error(diag)
    }
  }
  console.log('[web-gemini] 已发送任务', task.id)
  const answer = await waitReply(60000, baseCount)
  console.log('[web-gemini] 任务', task.id, '回复完成, 长度', answer.length, '| 内容前40:', JSON.stringify(answer.slice(0, 40)))
  return answer
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'handle-task') {
    handleTask(msg.task)
      .then((answer) => sendResponse({ answer }))
      .catch((e) => { console.error('[web-gemini] 处理失败:', e && e.message); sendResponse({ answer: '', error: (e && e.message) || String(e) }) })
    return true // 异步 sendResponse
  }
  return false
})

// 就绪通知（background 开始轮询）
chrome.runtime.sendMessage({ type: 'bridge-ready' }).catch(() => {})
console.log('[web-gemini] content 已加载')
