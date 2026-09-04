#!/usr/bin/env node
// dsh-web-relay 能力注册表验证脚本
// 用法: node scripts/verify-capabilities.mjs
// 检查:
//   1. registry.yaml 存在且可读取
//   2. 每条能力记录的 source/skill 文件存在
//   3. 每条验证规则中的 file-exists 文件存在
//   4. 每条验证规则中的 content-contains 能在对应文件中找到文本
//   5. 能力 id 不重复
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const registryPath = join(root, 'docs', 'capabilities', 'registry.yaml')

function fail(msg) {
  console.error('❌ ' + msg)
  process.exitCode = 1
}

function ok(msg) {
  console.log('✅ ' + msg)
}

function readText(p) {
  return readFileSync(p, 'utf8')
}

function extractRecords(text) {
  // 极简逐行解析 YAML 子集，避免把注释/首块误计为记录
  const lines = text.split(/\r?\n/)
  const records = []
  let cur = null
  for (const line of lines) {
    const idMatch = line.match(/^- id:\s*(\S+)/)
    if (idMatch) {
      if (cur) records.push(cur)
      cur = { id: idMatch[1], source: null, skill: null, body: line + '\n' }
      continue
    }
    if (!cur) continue
    cur.body += line + '\n'
    const srcMatch = line.match(/^source:\s*(\S+)/)
    if (srcMatch) cur.source = srcMatch[1]
    const skillMatch = line.match(/^skill:\s*(\S+)/)
    if (skillMatch && skillMatch[1] !== 'null') cur.skill = skillMatch[1]
  }
  if (cur) records.push(cur)
  return records
}

if (!existsSync(registryPath)) {
  fail(`registry.yaml 不存在: ${registryPath}`)
  process.exit(1)
}

const registryText = readText(registryPath)
const records = extractRecords(registryText)

if (records.length === 0) {
  fail('registry.yaml 中没有解析到任何能力记录')
  process.exit(1)
}

ok(`registry.yaml 已解析，共 ${records.length} 条能力`)

const seenIds = new Set()
for (const rec of records) {
  if (seenIds.has(rec.id)) {
    fail(`能力 id 重复: ${rec.id}`)
  }
  seenIds.add(rec.id)

  if (rec.source) {
    const p = join(root, rec.source)
    if (existsSync(p)) ok(`[${rec.id}] source 存在: ${rec.source}`)
    else fail(`[${rec.id}] source 缺失: ${rec.source}`)
  }

  if (rec.skill) {
    const p = join(root, rec.skill)
    if (existsSync(p)) ok(`[${rec.id}] skill 存在: ${rec.skill}`)
    else fail(`[${rec.id}] skill 缺失: ${rec.skill}`)
  }

  // 检查验证规则
  const fileRules = [...rec.body.matchAll(/file-exists:\s*([^\s]+)/g)].map((m) => m[1])
  for (const rel of fileRules) {
    const p = join(root, rel)
    if (existsSync(p)) ok(`[${rec.id}] 验证文件存在: ${rel}`)
    else fail(`[${rec.id}] 验证文件缺失: ${rel}`)
  }

  const contentRules = [...rec.body.matchAll(/content-contains:\s*\n\s+file:\s*([^\s]+)\s*\n\s+text:\s*"([^"]+)"/g)]
  for (const m of contentRules) {
    const file = m[1]
    const text = m[2]
    const p = join(root, file)
    if (!existsSync(p)) {
      fail(`[${rec.id}] content-contains 文件缺失: ${file}`)
      continue
    }
    const content = readText(p)
    if (content.includes(text)) ok(`[${rec.id}] 内容包含: ${text}`)
    else fail(`[${rec.id}] 内容缺少: ${text} (${file})`)
  }
}

console.log('\n能力验证完成。')
