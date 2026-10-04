// dsh-web-gemini-ext · content script（gemini.google.com）
// 职责：接收 background 的 handle-task → DOM 自动输入+发送 → MutationObserver 精确判定回复完成 → 抓取回传。
'use strict'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- v0.4.0（Chrome 侧加固 P1）: 页面健康探针 ----
// 供 background 在每次轮询时携带上报（authState/isReady），使桥接能"秒级"识别
// "未登录 / 页面未就绪"，而不是等任务超时（60s pending 早退或 120s sweep）。
// 判定保持轻量（只查关键节点，不做完整 DOM 遍历）：
//   - isReady：存在可编辑输入框（getInput 命中）→ true
//   - authState：命中国家登录入口特征（Sign in / 登录）且无输入框 → LOGGED_OUT；
//                有输入框 → OK；否则 UNKNOWN
function pageHealth() {
  let isReady = false
  try { isReady = Boolean(getInput()) } catch { isReady = false }
  let authState = 'UNKNOWN'
  if (isReady) authState = 'OK'
  else {
    const txt = (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 2000).toLowerCase()
    const hasSignIn = /sign in|登录|signin|log in/.test(txt)
    if (hasSignIn) authState = 'LOGGED_OUT'
  }
  return { authState, isReady, url: location.href, at: Date.now() }
}

// ---- DOM 工具（宽松选择器，避开易变的 class 名）----
// v0.4.0（P1——选择器降级链）: 多套候选显式化，任一命中即可（应对 Gemini 页面改版导致的选择器漂移）。
// 顺序：① 语义属性（aria-label/role，最稳）② 富文本输入容器 ③ 原生 textarea ④ 最后可见输入兜底。
function getInput() {
  const pick = (sel) => { try { return document.querySelector(sel) } catch { return null } }
  const visible = (el) => {
    if (!el) return false
    const r = el.getBoundingClientRect && el.getBoundingClientRect()
    return !r || (r.width > 0 && r.height > 0)
  }
  // ① 语义属性优先（跨改版最稳）
  const semantic = [
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][aria-label*="prompt" i]',
    '[contenteditable="true"][aria-label*="message" i]',
    '[contenteditable="true"][aria-label*="输入"]',
    '[contenteditable="true"][aria-label*="对话"]',
    'rich-textarea [contenteditable="true"]',
    'textarea[aria-label*="prompt" i]',
    'textarea[placeholder*="prompt" i]',
  ]
  for (const sel of semantic) { const el = pick(sel); if (visible(el)) return el }
  // ② 任意 contenteditable（原实现）——按 chat 语义过滤后取最后一个（Gemini 主输入在页面下方）
  const candidates = [
    ...document.querySelectorAll('[contenteditable="true"]'),
    ...document.querySelectorAll('textarea')
  ].filter(visible)
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

// ---- v0.4.1（用户输入保护 + 失败自诊断）----
// 事故背景（2026-09-11 端到端实测）：content script 直接把 prompt 写进 Gemini 输入框，
// 若用户当时正在输入，其内容会被**静默覆盖**（实测发生过，用户侧表现为"我的输入没了"）；
// 且发送失败时把测试文字残留在框里。以下三条纪律：
//   ① 覆盖前先读原内容，非空则视为"用户正在输入"→ 直接放弃本次发送（INPUT_BUSY，不覆盖、不残留）；
//   ② 失败时若曾经有原内容则尽力还原，无原内容则清掉自己写入的残留（不留垃圾）；
//   ③ 失败诊断带上 DOM 结构摘要（可用性数据），使下一次失败能直接定位选择器，无需人工翻 DOM。

/** 读取输入框当前文本（contenteditable 用 innerText，避免把子节点装饰文字算进来）。 */
function readInput(el) {
  if (!el) return ''
  if (el.isContentEditable) return (el.innerText || el.textContent || '')
  return el.value || ''
}

/** contenteditable 常出现"外层可编辑 + 内层真正可编辑"的嵌套：深入最内层，避免事件派发错元素。 */
function innermostEditable(el) {
  if (!el || !el.isContentEditable) return el
  const inner = [...el.querySelectorAll('[contenteditable="true"], [contenteditable=""]')]
    .filter((x) => x !== el && x.offsetParent !== null)
  return inner.length ? inner[inner.length - 1] : el
}

/** 清空输入框（失败时清理自己写入的残留；selectAll+delete 对 contenteditable 最通用）。
 *  v0.4.3：去掉原来的 Enter 兜底——在 Gemini 输入框里按 Enter 就是「发送」，会把残留提示发出去。
 *  返回是否已清空，由调用方决定如何报错。 */
function clearInput(el) {
  if (!el) return true
  try {
    el.focus()
    if (el.isContentEditable) {
      document.execCommand('selectAll', false, null)
      document.execCommand('delete', false, null)
      if (readInput(el).trim()) {
        // 兜底：直接清空节点并通知编辑器（不派发任何按键）
        el.textContent = ''
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }))
      }
    } else {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(el, '')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
  } catch (e) { /* 清理失败由返回值体现 */ }
  return !readInput(el).trim()
}

// ---- v0.4.3（发送判定按提示长度等待）----
// 事故（2026-10-04 实测）：长提示（6KB 以上）点击发送后 Gemini 需要数秒才清空输入框，原实现只等
// 0.7s（按钮）/0.9s（Enter）就判 no-effect，接着尝试下一种方式（可能重复发送），最后判 SEND_FAIL
// 并清掉其实已经发出去的输入。现在每次尝试后按提示长度持续检测，全部方式失败后再给一段宽限。
/** 发送后等待"已发送"信号的时长：2s 起，每 4 个字符加 1ms，最多 10s。 */
function sendSettleMs(promptLength) {
  return Math.min(10000, 2000 + Math.ceil((promptLength || 0) / 4))
}

/** 在 ms 毫秒内每 200ms 检测一次 ok()，任一次为真即返回 true。 */
async function waitSent(ok, ms, step = 200) {
  const deadline = Date.now() + ms
  while (true) {
    if (ok()) return true
    if (Date.now() >= deadline) return false
    await sleep(Math.min(step, Math.max(0, deadline - Date.now())))
  }
}

// ---- v0.4.3（自身残留识别）----
// 事故（2026-10-04 实测）：发送失败或页面中断后，扩展自己写入的提示残留在输入框里；下一次任务
// 把它当成「用户正在输入」报 INPUT_BUSY 放弃——每次都要白白失败一轮，且残留一直不清。
// 做法：写入前把提示指纹记入本标签页的 sessionStorage（页面刷新后仍在）；遇到残留时，与指纹
// 吻合则视为自身残留→清理后继续，否则仍按「用户正在输入」保护（语义不变）。
const OWN_PROMPTS_KEY = 'dsh-web-gemini:own-prompts'
const OWN_PROMPTS_MAX = 8
const FINGERPRINT_CHARS = 80

/** 指纹：去掉所有空白后的前 N 个字符（contenteditable 读回时换行/空格可能被改写）。 */
function promptFingerprint(text) {
  return String(text || '').replace(/\s+/g, '').slice(0, FINGERPRINT_CHARS)
}

function loadOwnPrompts(storage) {
  try { return JSON.parse(storage.getItem(OWN_PROMPTS_KEY) || '[]') } catch (e) { return [] }
}

function rememberOwnPrompt(text, storage = sessionStorage) {
  try {
    const list = loadOwnPrompts(storage).filter((f) => f !== promptFingerprint(text))
    list.push(promptFingerprint(text))
    storage.setItem(OWN_PROMPTS_KEY, JSON.stringify(list.slice(-OWN_PROMPTS_MAX)))
  } catch (e) { /* 存储不可用时退化为旧行为（一律 INPUT_BUSY） */ }
}

/** 残留是否为本扩展先前写入的提示（含被截断/部分发送后的前缀情况）。 */
function isOwnResidue(text, storage = sessionStorage) {
  const fp = promptFingerprint(text)
  if (!fp) return false
  // 至少吻合 20 个字符（指纹本身更短时要求整条吻合），避免"你是"之类的短输入被误认
  return loadOwnPrompts(storage).some((own) => {
    const need = Math.min(20, own.length)
    return fp.length >= need && (own.startsWith(fp) || fp.startsWith(own))
  })
}

/** 发送按钮候选链（显式选择器优先，再按语义兜底），供多次尝试。 */
function sendButtonCandidates(input) {
  const root = composerRoot(input)
  const out = []
  const seen = new Set()
  const push = (el) => { if (el && !seen.has(el) && el.offsetParent !== null) { seen.add(el); out.push(el) } }
  for (const sel of [
    'button[data-test-id="send-button"]', '[data-test-id="send-button"]',
    'button[aria-label*="Send" i]', 'button[aria-label*="发送"]', 'button[aria-label*="傳送"]',
    'button[aria-label*="送出"]', 'button[aria-label*="提交"]',
    'button.send-button', 'button[class*="send-button" i]', 'button[class*="sendButton" i]',
  ]) {
    try { push(root.querySelector(sel)) } catch (e) { /* 非法选择器忽略 */ }
    try { push(document.querySelector(sel)) } catch (e) { /* 同上 */ }
  }
  for (const b of visibleIconButtons(root)) if (isSubmitLike(b)) push(b)
  return out
}

/** 失败诊断：把"页面到底给了什么"压缩成一行可审计数据。 */
function domDiagnostics(input) {
  const root = composerRoot(input)
  const btns = visibleIconButtons(root).slice(0, 6).map((b) => {
    const cls = (typeof b.className === 'string' ? b.className : '').split(/\s+/).filter(Boolean).slice(0, 2).join('.')
    return describeButton(b) + '[' + (b.tagName || '').toLowerCase() + (cls ? '.' + cls : '') + ',disabled=' + Boolean(b.disabled) + ']'
  })
  return 'input=' + (input ? (input.tagName || '').toLowerCase() + (input.isContentEditable ? '/ce' : '') : 'null') +
    ' | composerBtns=' + (btns.length ? btns.join(' ; ') : '无') +
    ' | entrySelectors命中=' + JSON.stringify({
      'send-button': Boolean(root.querySelector('button[data-test-id="send-button"]')),
      'ariaSend': Boolean(root.querySelector('button[aria-label*="Send" i], button[aria-label*="发送"]')),
      'classSend': Boolean(root.querySelector('button[class*="send" i]')),
    }) +
    ' | activeEl=' + (document.activeElement ? (document.activeElement.tagName || '').toLowerCase() + (document.activeElement.isContentEditable ? '/ce' : '') : 'null')
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
  const input = innermostEditable(getInput())
  if (!input) {
    // v2.4.0（wg-gap-analysis 2026-09-10 评审修复）：原实现只 console.error + return ''，
    // handleTask 正常 resolve 空串 → background 侧 resp.answer 为空且无 error → 静默失败
    // → bridge 任务永久停留 processing（本次事故根因之一）。改为 throw 带诊断的 Error，
    // 由 L337-345 既有 .catch 上报 resp.error（遵守不变式：要么 resolve 非空 answer，要么 throw）。
    const diag = 'INPUT_NOT_FOUND: 未找到输入框（页面可能未登录/未加载完成/DOM 结构变化），当前 URL=' + location.href
    console.error('[web-gemini]', diag)
    // v0.4.0（P1——reload 自愈）: 标记 needsReload——页面态异常（未就绪/改版）时让 background
    // 顺手重载一次标签页（节流），使下一次任务能命中新页面，而非持续失败。
    const err = new Error(diag)
    err.needsReload = true
    throw err
  }
  // v0.4.1（用户输入保护）: 覆盖前先读原内容——非空即视为"用户正在输入"，
  // 直接放弃本次发送（不覆盖、不留残留、不 reload），交回宿主走下一级通道。
  // v0.4.3: 例外——残留正是本扩展先前写入的提示时，清理后继续（清不掉则报 INPUT_STUCK 并请求 reload）。
  let preExisting = readInput(input).trim()
  if (preExisting && isOwnResidue(preExisting)) {
    console.warn('[web-gemini] 输入框残留为自身先前写入的提示，清理后继续 | 前30=', JSON.stringify(preExisting.slice(0, 30)))
    if (!clearInput(input)) {
      const diag = 'INPUT_STUCK: 自身残留提示无法清除 | 前30=' + JSON.stringify(readInput(input).trim().slice(0, 30)) + ' | ' + domDiagnostics(input)
      console.error('[web-gemini]', diag)
      const err = new Error(diag)
      err.needsReload = true
      throw err
    }
    preExisting = ''
  }
  if (preExisting) {
    const diag = 'INPUT_BUSY: 输入框已有未发送内容（疑似用户正在输入，已放弃本次发送以免覆盖）' +
      ' | 内容前30=' + JSON.stringify(preExisting.slice(0, 30))
    console.warn('[web-gemini]', diag)
    throw new Error(diag)
  }
  // 发送前记录回复节点基线（旧对话回复不参与抓取）
  const baseCount = replyNodes().length
    // 记录发送前页面文本，用于新回复节点未被选择器捕获时的兜底提取
    const beforePageText = pageText()
  rememberOwnPrompt(task.prompt)
  await setInputValue(input, task.prompt)
  await sleep(400)
  const verify = readInput(input)
  console.log('[web-gemini] 输入框:', input.isContentEditable ? 'contenteditable' : 'textarea',
    '| 填入后内容前40:', JSON.stringify(verify.slice(0, 40)),
    '| 基线回复数:', baseCount)
  // v0.4.1（发送链路加固）: 发送成功判定不再只看"输入框清空"，而是两个信号任一成立——
  //   ① 输入框被清空（Gemini 提交后会清空 composer）② 出现新的回复节点（提交已发生）
  // 依次尝试：显式发送按钮候选（多个）→ Enter（聚焦最内层可编辑元素）→ 表单 requestSubmit。
  const sentOk = () => {
    if (!readInput(input).trim()) return true
    if (replyNodes().length > baseCount) return true
    return false
  }
  const sendAttempts = []
  let sent = false
  const settleMs = sendSettleMs(task.prompt.length)
  const cands = sendButtonCandidates(input)
  for (const b of cands) {
    if (sent) break
    // 长提示粘贴后按钮可能要更久才可用
    const waitBtn = Date.now() + Math.max(1500, settleMs / 2)
    while (b.disabled && Date.now() < waitBtn) await sleep(200)
    if (b.disabled) { sendAttempts.push(describeButton(b) + ':disabled'); continue }
    clickButton(b)
    sent = await waitSent(sentOk, settleMs)
    sendAttempts.push(describeButton(b) + ':' + (sent ? 'ok' : 'no-effect'))
  }
  if (!sent) {
    input.focus()
    const target = document.activeElement && document.activeElement.isContentEditable ? document.activeElement : input
    pressEnter(target)
    sent = await waitSent(sentOk, settleMs)
    sendAttempts.push('Enter:' + (sent ? 'ok' : 'no-effect'))
  }
  if (!sent) {
    const form = input.closest('form')
    if (form && typeof form.requestSubmit === 'function') {
      try {
        form.requestSubmit()
        sent = await waitSent(sentOk, settleMs)
        sendAttempts.push('requestSubmit:' + (sent ? 'ok' : 'no-effect'))
      } catch (e) { sendAttempts.push('requestSubmit:throw') }
    }
  }
  if (!sent) {
    // 宽限：某次尝试可能只是生效得慢——确认确实没发出去再清理，避免清掉已发送的提示
    sent = await waitSent(sentOk, settleMs)
    if (sent) sendAttempts.push('late:ok')
  }
  if (!sent) {
    const diag = 'SEND_FAIL: 输入框=' + (input.isContentEditable ? 'contenteditable' : 'textarea') +
      ' | 尝试=' + sendAttempts.join(' , ') +
      ' | 残留=' + JSON.stringify(readInput(input).slice(0, 30)) +
      ' | ' + domDiagnostics(input)
    console.error('[web-gemini]', diag)
    // v0.4.1: 不留垃圾——清掉自己写入的残留；并标记 needsReload 让 background 节流重载页面
    // （claude-code 审核 Step 2 指出的覆盖盲区：SEND_FAIL 原先既不清理也不触发自愈）。
    const cleared = clearInput(input)
    const err = new Error(cleared ? diag : diag + ' | 残留未能清除')
    err.needsReload = true
    throw err
  }
  console.log('[web-gemini] 已发送任务', task.id)
  const answer = await waitReply(60000, baseCount, beforePageText, task.prompt)
  console.log('[web-gemini] 任务', task.id, '回复完成, 长度', answer.length, '| 内容前40:', JSON.stringify(answer.slice(0, 40)))
  // v2.4.0（wg-gap-analysis 评审修复）：waitReply 有硬兜底 setTimeout(done, maxMs+5000)，
  // 未捕获到回复文本时同样 resolve（空串）→ 原实现把空串当成功答案返回 → background 侧静默
  // 失败 → 任务永久 processing。此处补终态检查：空回复一律 throw 带诊断。
  if (!answer) {
    const diag = 'EMPTY_REPLY: 65s 内未捕获到回复文本（选择器未命中 Gemini 回复 DOM，或页面确实无响应），当前 URL=' + location.href
    console.error('[web-gemini]', diag)
    throw new Error(diag)
  }
  return answer
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // v0.4.0（P1）: 页面健康探针——同步返回（不做异步 DOM 等待），供 background 轮询携带上报
  if (msg && msg.type === 'page-health') {
    try { sendResponse(pageHealth()) } catch (e) { sendResponse({ authState: 'UNKNOWN', isReady: false, error: String((e && e.message) || e) }) }
    return false
  }
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

// 测试钩子：仅在 Node 测试环境（vm 上下文提供 __exports）中导出纯函数，浏览器中无副作用。
if (typeof __exports === 'object' && __exports) {
  Object.assign(__exports, { promptFingerprint, rememberOwnPrompt, isOwnResidue, clearInput, readInput, sendSettleMs, waitSent })
}
