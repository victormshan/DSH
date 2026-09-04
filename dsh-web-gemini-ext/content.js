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
  // 只把“像发送键”的元素收进来，避免误点 Google apps / 占位提示按钮
  const SEND_SELECTOR = 'button, [role="button"], [data-testid*="send" i], [data-testid*="submit" i], [aria-label*="send" i], [aria-label*="submit" i], [aria-label*="发送" i], [aria-label*="發送" i], [aria-label*="傳送" i], [aria-label*="送出" i], [aria-label*="提交" i], [class*="send" i], [class*="submit" i]'
  const rawBtns = [...document.querySelectorAll(SEND_SELECTOR)]
  const btns = rawBtns.filter((el, idx, arr) => arr.indexOf(el) === idx)
  // 若给了输入框，优先在输入框附近的 form/composer 容器里找，避免扩大到整页工具栏
  let scope = btns
  if (input) {
    const container = input.closest('form, [role="form"], [class*="composer" i], [class*="input-container" i], [class*="prompt-container" i], [class*="chat-input" i], [class*="input-area" i], [class*="input-area-container" i]')
    if (container) {
      const inner = [...container.querySelectorAll(SEND_SELECTOR)]
      if (inner.length > 0) scope = inner
    } else {
      let el = input.parentElement, hops = 0
      while (el && hops < 4) {
        const inScope = btns.filter((b) => el.contains(b))
        if (inScope.length > 0) { scope = inScope; break }
        el = el.parentElement
        hops++
      }
    }
  }
  const isSendLike = (b) => {
    const label = ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')).toLowerCase()
    const text = (b.textContent || '').toLowerCase()
    const cls = (typeof b.className === 'string' ? b.className : '') + ' ' + (b.getAttribute('data-testid') || '')
    // 注意不要匹配 prompt 占位文本，只匹配明确的发送/提交语义
    return /send|submit|發送|傳送|送出|发送|提交/.test(label + ' ' + text + ' ' + cls) ||
      (text.includes('send') && b.textContent.trim().length < 12)
  }
  const send = scope.find(isSendLike)
  if (send) return send
  // 回退：在输入框所在区域内找“已启用的图标按钮”，通常是输入后出现的上箭头发送键
  const iconBtn = scope.filter((b) => {
    if (b.disabled || b.offsetParent === null) return false
    const text = (b.textContent || '').trim()
    return text.length < 12
  }).pop()
  return iconBtn || null
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
  // 兼容新旧 Gemini DOM：model-response 自定义元素 + 常见 data-testid / role / class
  return [...document.querySelectorAll(
    'model-response, .model-response-text, [data-test-id="model-response"], [data-testid="model-response"], ' +
    '[data-test-id="assistant-message"], [data-testid="assistant-message"], ' +
    '[data-message-author-role="model"], [data-role="model"], ' +
    '[class*="model-response" i], [class*="assistant-message" i], [class*="response-content" i]'
  )]
}
function lastReplyNode() {
  const nodes = replyNodes()
  return nodes[nodes.length - 1] || null
}
// 清理回复文本：去掉 Gemini 页面里可能隐藏/折叠的 reasoning / thinking / thought 等内部思考内容，
// 只保留用户实际看到的最终回答。
function cleanReplyText(node) {
  if (!node) return ''
  const clone = node.cloneNode(true)
  try {
    clone.querySelectorAll(
      '[class*="reasoning" i], [class*="thinking" i], [class*="thought" i], ' +
      '[data-test-id*="reasoning" i], [data-testid*="reasoning" i], ' +
      '[data-test-id*="thinking" i], [data-testid*="thinking" i], ' +
      '[data-test-id*="thought" i], [data-testid*="thought" i], ' +
      'model-reasoning, .model-reasoning, [class*="chain-of-thought" i]'
    ).forEach((el) => el.remove())
  } catch (e) { /* 清理失败时回退全文 */ }
  return (clone.textContent || '').trim()
}

function pageText() {
  return document.body ? (document.body.innerText || '') : ''
}
// 页面文本兜底：如果新回复节点没被选择器捕获，就用“发送后页面新增文本”来提取。
// 同时会去掉新增文本里可能包含的“用户刚发送的 prompt”前缀。
function addedPageText(beforeText, promptText) {
  if (!beforeText) return ''
  const now = pageText()
  if (now.length <= beforeText.length) return ''
  let added = ''
  if (now.startsWith(beforeText)) {
    added = now.slice(beforeText.length)
  } else {
    const idx = now.lastIndexOf(beforeText)
    if (idx >= 0) added = now.slice(idx + beforeText.length)
  }
  if (promptText) {
    const p = String(promptText).trim()
    const pi = added.indexOf(p)
    if (pi >= 0) added = added.slice(pi + p.length)
  }
  return added.trim()
}
// v0.3.0 基线法：只抓取"发送之后新出现的回复"，避免抓到页面上旧对话的回复
// 注意：如果 fresh 为空，绝不回退到旧回复，否则插件会显示上一次/剪贴板里的旧内容。
function grabReply(baseCount, beforeText, promptText) {
  const nodes = replyNodes()
  const fresh = nodes.slice(baseCount || 0)
  const target = fresh[fresh.length - 1] || null
  if (target) return cleanReplyText(target)
  return addedPageText(beforeText, promptText)
}
function freshReplyLen(baseCount, beforeText, promptText) {
  const nodes = replyNodes()
  const fresh = nodes.slice(baseCount || 0)
  const target = fresh[fresh.length - 1] || null
  if (target) return cleanReplyText(target).length
  return addedPageText(beforeText, promptText).length
}

// ---- MutationObserver + 定时器判定回复完成（基线法，含复查防截断）----
// 关键：Gemini 长回答生成中可能有 >2s 停顿（文字→代码块切换），
// 简单稳定判定会误判完成导致抓取截断。因此：稳定 2s 后**复查**——
// 再等 2s 若文本仍不变才判定完成；文本继续变化则重新计时。
function waitReply(maxMs, baseCount, beforeText, promptText) {
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
      resolve(grabReply(baseCount, beforeText, promptText))
    }
    const scheduleSettle = () => {
      clearTimeout(settleTimer)
      settleTimer = setTimeout(async () => {
        if (settled) return
        if (!seen) return
        const lenNow = freshReplyLen(baseCount, beforeText, promptText)
        if (lenNow < 5) { scheduleSettle(); return }
        // 复查 1：再等 2s，文本仍相同才继续（排除生成中停顿）
        await new Promise((r) => setTimeout(r, 2000))
        if (settled) return
        const len1 = freshReplyLen(baseCount, beforeText, promptText)
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
        const len2 = freshReplyLen(baseCount, beforeText, promptText)
        if (len2 !== len1) { scheduleSettle() /* 文本继续变化：重新计时 */ ; return }
        console.log('[web-gemini] 完成判定（双复查稳定）len=' + len2)
        done()
      }, 2000)
    }
    const observer = new MutationObserver(() => {
      const now = Date.now()
      const len = freshReplyLen(baseCount, beforeText, promptText)
      if (now > deadline) { done(); return }
      if (len >= 5) seen = true
      if (len !== lastLen) { lastLen = len; scheduleSettle() }
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    setTimeout(() => { done() }, maxMs + 5000)
  })
}

// ---- v3.4: 精确识别“输入后才出现的上箭头 Submit 按钮” ----
function composerRoot(input) {
  return input.closest('form, [role="form"], [class*="composer" i], [class*="input-container" i], [class*="prompt-container" i], [class*="chat-input" i], [class*="input-area" i], [class*="input-area-container" i]') || input.parentElement || document
}
function visibleIconButtons(root) {
  const nodes = [...root.querySelectorAll('button, [role="button"]')]
  return nodes.filter((b) => b.offsetParent !== null && !b.disabled && (b.textContent || '').trim().length < 12)
}
function buttonAttrs(b) {
  const parts = [
    b.getAttribute('aria-label') || '',
    b.getAttribute('title') || '',
    b.getAttribute('data-tooltip') || '',
    b.getAttribute('data-testid') || '',
    typeof b.className === 'string' ? b.className : '',
    b.textContent || ''
  ]
  for (const el of b.querySelectorAll('[aria-label],[title],[data-tooltip],[data-testid]')) {
    parts.push(el.getAttribute('aria-label') || '', el.getAttribute('title') || '', el.getAttribute('data-tooltip') || '', el.getAttribute('data-testid') || '')
  }
  return parts.join(' ').toLowerCase()
}
function describeButton(b) {
  if (!b) return '未找到'
  return (b.getAttribute('aria-label') || b.getAttribute('title') || b.getAttribute('data-tooltip') || (b.textContent || '').trim() || '?').trim().slice(0, 30)
}
function isSubmitLike(b) {
  return /send|submit|發送|傳送|送出|发送|提交/.test(buttonAttrs(b))
}
function clickButton(btn) {
  if (!btn) return false
  const opts = { bubbles: true, cancelable: true, composed: true, view: window }
  try { btn.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse' })) } catch (e) {}
  try { btn.dispatchEvent(new MouseEvent('mousedown', opts)) } catch (e) {}
  try { btn.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, pointerType: 'mouse' })) } catch (e) {}
  try { btn.dispatchEvent(new MouseEvent('mouseup', opts)) } catch (e) {}
  try { btn.dispatchEvent(new MouseEvent('click', opts)) } catch (e) {}
  return true
}
async function findNewSubmitButton(input) {
  const root = composerRoot(input)
  const before = visibleIconButtons(root)
  // 输入后等待最多 2s，直到出现新的可用图标按钮（通常就是上箭头发送键）
  for (let i = 0; i < 10; i++) {
    const after = visibleIconButtons(root)
    const candidates = after.filter((b) => !before.includes(b))
    const labeled = candidates.find(isSubmitLike)
    if (labeled) return labeled
    if (candidates.length > 0) return candidates[candidates.length - 1]
    await sleep(200)
  }
  return null
}


async function handleTask(task) {
  const input = getInput()
  if (!input) { console.error('[web-gemini] 未找到输入框'); return '' }
  // 发送前记录回复节点基线（旧对话回复不参与抓取）
  const baseCount = replyNodes().length
    // 记录发送前页面文本，用于新回复节点未被选择器捕获时的兜底提取
    const beforePageText = pageText()
  await setInputValue(input, task.prompt)
  await sleep(400)
  const send = getSendButton()
  const verify = input.isContentEditable ? (input.textContent || '') : (input.value || '')
  console.log('[web-gemini] 输入框:', input.isContentEditable ? 'contenteditable' : 'textarea',
    '| 填入后内容前40:', JSON.stringify(verify.slice(0, 40)),
    '| 发送按钮:', describeButton(send),
    '| 基线回复数:', baseCount)
  // 发送：填入后等待发送按钮可用（Gemini 输入有效后 disabled→enabled）再点击；
  // 找不到/不可用则 Enter 发送。
  let sendBtn = await findNewSubmitButton(input) || getSendButton(input)
  const waitBtn = Date.now() + 3000
  while (sendBtn && sendBtn.disabled && Date.now() < waitBtn) {
    await sleep(300)
    sendBtn = await findNewSubmitButton(input) || getSendButton(input)
  }
  if (sendBtn && !sendBtn.disabled) {
    clickButton(sendBtn)
    console.log('[web-gemini] 点击发送按钮:', describeButton(sendBtn), '| disabled:', sendBtn.disabled)
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
        ' | 按钮=' + (sendBtn ? describeButton(sendBtn) + '(disabled=' + sendBtn.disabled + ')' : '未找到') +
        ' | 重试后残留=' + JSON.stringify(after2.slice(0, 30))
      console.error('[web-gemini]', diag)
      throw new Error(diag)
    }
  }
  console.log('[web-gemini] 已发送任务', task.id)
  const answer = await waitReply(60000, baseCount, beforePageText, task.prompt)
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
