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
function getSendButton() {
  const btns = [...document.querySelectorAll('button')]
  // 宽泛匹配：aria-label / title / textContent 含 send/发送/message/消息/stop(停止态也在发送按钮上)
  const send = btns.find((b) => {
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

// ---- MutationObserver 精确判定回复完成（基线法）----
// 发送前记录回复节点基线 baseCount；观察新回复节点：峰值 ≥5 字符 + 发送按钮可点 + 稳定 3s → 完成。
function waitReply(maxMs, baseCount) {
  return new Promise((resolve) => {
    const deadline = Date.now() + maxMs
    let lastLen = -1
    let peakLen = 0
    let stableSince = 0
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      observer.disconnect()
      resolve(grabReply(baseCount))
    }
    const observer = new MutationObserver(() => {
      const send = getSendButton()
      const len = freshReplyLen(baseCount)
      const now = Date.now()
      if (now > deadline) { done(); return }
      if (len > peakLen) peakLen = len
      if (len !== lastLen) { lastLen = len; stableSince = now; return }
      // 完成判定：峰值 ≥5 字符 + 发送按钮可点（停止态结束）+ 稳定 3s（避免捕获生成中的短帧/乱码）
      if (peakLen >= 5 && send && !send.disabled && now - stableSince > 3000) {
        console.log('[web-gemini] 判定完成 peakLen=' + peakLen + ' len=' + len)
        done()
      }
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
  // 发送：Enter 键优先（最通用，Gemini 输入框 Enter=发送），按钮点击备选
  let sent = false
  const sendBtn = getSendButton()
  if (sendBtn) {
    sendBtn.click()
    sent = true
    console.log('[web-gemini] 点击发送按钮:', (sendBtn.getAttribute('aria-label') || sendBtn.textContent || '?').trim().slice(0, 20))
  } else {
    pressEnter(input)
    sent = true
    console.log('[web-gemini] 未找到发送按钮，改用 Enter 发送')
  }
  // 发送确认：发送成功输入框会清空；1.5s 后未清空则 Enter 重试一次
  await sleep(1500)
  const after = input.isContentEditable ? (input.textContent || '') : (input.value || '')
  if (after.trim()) {
    console.warn('[web-gemini] 输入框未清空（发送可能未生效），Enter 重试')
    pressEnter(input)
    await sleep(1000)
    const after2 = input.isContentEditable ? (input.textContent || '') : (input.value || '')
    if (after2.trim()) { console.error('[web-gemini] 发送仍失败，输入框残留内容'); }
  }
  console.log('[web-gemini] 已发送任务', task.id)
  const answer = await waitReply(120000, baseCount)
  console.log('[web-gemini] 任务', task.id, '回复完成, 长度', answer.length, '| 内容前40:', JSON.stringify(answer.slice(0, 40)))
  return answer
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'handle-task') {
    handleTask(msg.task)
      .then((answer) => sendResponse({ answer }))
      .catch((e) => { console.error('[web-gemini] 处理失败:', e); sendResponse({ answer: '' }) })
    return true // 异步 sendResponse
  }
  return false
})

// 就绪通知（background 开始轮询）
chrome.runtime.sendMessage({ type: 'bridge-ready' }).catch(() => {})
console.log('[web-gemini] content 已加载')
