// dsh-web-relay · AutoIteration 声明解析（v4.4 U3 重构：可测 + 兜底增强）
// 输入：prompt+answer 文本 → { iterations, finalAcceptance, autoDecision }
// 解析路径：① 含 iterations 的 JSON 对象（JSON.parse 容错，字段顺序无关）② 行内/叙述式（容忍引号）

export function extractAutoIterDecl(text) {
  const src = String(text || '')
  const decl = { iterations: 1, finalAcceptance: null, autoDecision: false }
  const clamp = (n) => (Number.isInteger(n) && n >= 1 && n <= 10 ? n : null)

  // ① JSON 对象形态（顺序无关）：抓取含 "iterations" 的最内层 {…} 后 JSON.parse
  const obj = src.match(/\{[^{}]*"iterations"\s*:\s*\d+[^{}]*\}/)
  if (obj) {
    try {
      const parsed = JSON.parse(obj[0])
      const n = clamp(parsed.iterations)
      if (n) decl.iterations = n
      if (typeof parsed.finalAcceptance === 'string' && parsed.finalAcceptance) decl.finalAcceptance = parsed.finalAcceptance
      if (typeof parsed.autoDecision === 'boolean') decl.autoDecision = parsed.autoDecision
      return decl
    } catch (err) { /* fallthrough to narrative */ }
  }

  // ② 叙述式/行内（容忍字段名与冒号间引号，如 iterations": 3、autoDecision": true）
  const mIt = src.match(new RegExp('iterations\\s*"?\\s*[:：]\\s*"?\\s*(\\d+)', 'i'))
  const ni = mIt && clamp(parseInt(mIt[1], 10))
  if (!ni) {
    const mC = src.match(/(?:自动迭代|自动演进|迭代)\s*[:：]?\s*(\d{1,2})\s*(?:个|次|轮)?版本/)
    if (mC) { const n3 = clamp(parseInt(mC[1], 10)); if (n3) decl.iterations = n3 }
  } else decl.iterations = ni
  const ma = src.match(new RegExp('autoDecision\\s*"?\\s*[:：]\\s*"?\\s*(true|false)', 'i'))
  if (ma) decl.autoDecision = ma[1].toLowerCase() === 'true'
  const mf = src.match(new RegExp('finalAcceptance\\s*"?\\s*[:：]\\s*"?\\s*["\'“”‘’]([^"\'“”‘’]+)["\'“”‘’]', 'i'))
  if (mf) decl.finalAcceptance = mf[1]
  return decl
}

// 供 node 直接运行本文件时打印样例结果（调试用）
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  const t = process.argv.slice(2).join(' ') || '声明：{"iterations": 3, "autoDecision": true, "finalAcceptance": "test"}'
  console.log(JSON.stringify(extractAutoIterDecl(t)))
}
