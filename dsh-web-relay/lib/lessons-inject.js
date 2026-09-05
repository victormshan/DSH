// dsh-web-relay · Lesson Top-K 触发注入（v4.4 U1，schema §4 v0.3 愿景落地）
// 思路：对 trigger 文本与每条 lesson 语料（title+trigger+decision+category）做字符 bigram 包含度打分，
// 中文/英文均无需分词；跳过 superseded；取 Top-K（默认 5，可配下限），新近优先破平。
import fs from 'node:fs'

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
}
function bigrams(s) {
  const n = norm(s)
  const out = new Set()
  for (let i = 0; i < n.length - 1; i++) out.add(n.slice(i, i + 2))
  return out
}
// 包含度：trigger 的 bigram 有多少比例出现在 lesson 语料中（0..1）
export function lessonScore(lesson, trigger) {
  const corpus = norm(`${lesson.title} ${lesson.trigger || ''} ${lesson.decision || ''} ${lesson.category || ''}`)
  const tBig = bigrams(trigger)
  if (tBig.size === 0) return 0
  const cSet = bigrams(corpus)
  let hit = 0
  for (const b of tBig) if (cSet.has(b)) hit++
  return hit / tBig.size
}
export function filterActive(lessons) {
  return (Array.isArray(lessons) ? lessons : []).filter((l) => l && l.status !== 'superseded')
}
// Top-K：按 score 降序、同分按 recordedAt 新近；低于 minScore 的剔除（默认 0.08 防纯噪声注入）
export function topLessonsForTrigger(lessons, trigger, { k = 5, minScore = 0.08 } = {}) {
  return filterActive(lessons)
    .map((l) => ({ lesson: l, score: lessonScore(l, trigger) }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => (b.score - a.score) || (String(b.lesson.recordedAt || '').localeCompare(String(a.lesson.recordedAt || ''))))
    .slice(0, k)
    .map((x) => x.lesson)
}
export function renderLessonBlock(lessons) {
  if (!lessons || lessons.length === 0) return ''
  return [
    '',
    '【相关教训 Top-K（主 agent 语境能力，按当前触发词匹配）】',
    ...lessons.map((l, i) => `${i + 1}. [${l.id}] ${l.title}（${l.category}）→ ${String(l.decision || '').slice(0, 160)}`)
  ].join('\n')
}
// 读取 lessons.json（含缓存校验：mtime 变化才重读）
let cache = { mtime: 0, lessons: [] }
export function loadLessonsFile(absPath) {
  try {
    const st = fs.statSync(absPath)
    if (st.mtimeMs !== cache.mtime) {
      cache = { mtime: st.mtimeMs, lessons: JSON.parse(fs.readFileSync(absPath, 'utf8')).lessons || [] }
    }
    return cache.lessons
  } catch (err) {
    return cache.lessons
  }
}
