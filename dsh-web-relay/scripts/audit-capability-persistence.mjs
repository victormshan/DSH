// 能力持久化审计脚本：invariants 检查
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
const D = path.join(here, '..')

// 1) lessons.json
const lessons = JSON.parse(fs.readFileSync(path.join(D, 'docs', 'main-agent-lessons.json'), 'utf8'))
const ls = lessons.lessons
const required = ['id', 'title', 'category', 'layer', 'trigger', 'decision', 'rationale', 'evidence', 'confidence', 'status', 'recordedAt']
const missing = []
const ids = new Set()
for (const l of ls) {
  if (ids.has(l.id)) missing.push(`dup-id:${l.id}`)
  ids.add(l.id)
  for (const f of required) if (!(f in l)) missing.push(`${l.id}:missing:${f}`)
}
const statuses = {}
for (const l of ls) statuses[l.status] = (statuses[l.status] || 0) + 1
const categories = {}
for (const l of ls) categories[l.category] = (categories[l.category] || 0) + 1
console.log('lessons:', ls.length, '| dup/缺字段:', missing.length ? missing : '无')
console.log('status 分布:', JSON.stringify(statuses))
console.log('category 分布:', JSON.stringify(categories))
console.log('首条:', ls[0].id, '| 末条:', ls[ls.length - 1].id)
console.log('recordedAt 范围:', ls[0].recordedAt, '→', ls[ls.length - 1].recordedAt)

// 2) 能力文档 A-D 与 E 区
const cap = fs.readFileSync(path.join(D, 'docs', 'main-agent-auto-iteration-capabilities.md'), 'utf8')
const rows = cap.split('\n').filter((l) => /^\| [A-E]\d*\s*\|/.test(l) || /^\| [A-E]\s*\|/.test(l))
console.log('\n能力文档行数（A-E 表格行）:', rows.length)
const eRows = rows.filter((l) => /^\| E\d+\s*\|/.test(l))
console.log('E 区机制行:', eRows.length, '|', eRows.map((r) => r.match(/^\| (E\d+)\s*\|/)[1]).join(','))
const verTags = [...new Set((cap.match(/v4\.\d+\.\d+|v3\.9\.\d+|v3\.8\.\d+/g) || []))]
console.log('文档提及版本 tag:', verTags.join(','))
console.log('文档是否含 v4.0/v4.1/v4.2/v4.3:', ['v4.0.0', 'v4.1.0', 'v4.2.0', 'v4.3.0'].map((v) => v + '=' + cap.includes(v)).join(' '))

// 3) registry.yaml 解析（简单行抓取 name/version 字段）
const reg = fs.readFileSync(path.join(D, 'docs', 'capabilities', 'registry.yaml'), 'utf8')
const regNames = [...reg.matchAll(/^\s*-\s+id:\s*(\S+)/gm)].map((m) => m[1])
const regLatest = [...reg.matchAll(/latestVersion:\s*(\S+)/g)].map((m) => m[1])
console.log('\nregistry 条目:', regNames.length)
console.log('registry ids:', regNames.join(','))
console.log('registry latestVersion 提及:', [...new Set(regLatest)].join(','))

// 4) master-ledger / pending-list 新鲜度
for (const f of ['main-agent-capability-persistence-master-ledger.md', 'main-agent-capability-pending-list.md', 'v1.8-v1.9-capability-persistence-ledger.md']) {
  const t = fs.readFileSync(path.join(D, 'docs', f), 'utf8')
  const vs = [...new Set((t.match(/v\d+\.\d+\.\d+/g) || []))]
  console.log(`\n${f}: 提及版本=${vs.join(',') || '(无)'}`)
}
