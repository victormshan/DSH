// offscreen.js —— dsh-web-gemini-ext v0.4.0（Chrome 侧加固 P0）
//
// 职责（单一）：保活心跳。
//
// 背景：MV3 的 Service Worker 会被 Chrome 回收（空闲约 30s 即可能休眠）。本扩展的 1s 级
// 轮询（pollOnce 自调度 setTimeout）依赖 SW 存活；SW 一旦被回收，轮询停止 → 桥接侧
// lastPollAt 停更（实测该状态与"无 Gemini 标签页"表现相同：宿主只能靠 pending 60s 早退感知，
// 通道静默不可用）。原实现仅靠 chrome.alarms（最小周期约 0.5min）兜底唤醒，粒度太粗。
//
// 本文件在 offscreen 文档里以 KEEPALIVE_MS 周期向 SW 发一条轻量消息：只要 SW 收到消息就会被
// 唤醒并续期。**不做任何 DOM 抓取/网络请求**（避免与 content script 职责重叠与合规风险）。
// 若 SW 已死，sendMessage 会抛错——由 background 侧 onMessage 处理器（触发 SW 启动）兜底。

const KEEPALIVE_MS = 20000 // 20s < Chrome SW 空闲回收阈值（约 30s）

setInterval(() => {
  try {
    chrome.runtime.sendMessage({ type: 'keepalive-ping', at: Date.now() }, () => {
      // 读 lastError 以抑制"无接收者"报错噪声（SW 正在启动时属正常）
      void chrome.runtime.lastError
    })
  } catch (e) {
    // offscreen 文档本身也可能被销毁（如扩展重载）——静默即可
  }
}, KEEPALIVE_MS)

console.log('[web-gemini] offscreen 保活已启动，周期', KEEPALIVE_MS, 'ms')
