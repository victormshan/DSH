#!/usr/bin/env node
// cap_3 (v4.8): 能力包一键导出 + skills 同步
// 1) 同步 repo skills/ → ~/.dsh/skills/（覆盖）
// 2) 打包 docs/ + skills/ + scripts/（校验工具）到 dist/dsh-relay-capability-pack-<ver>.tar.gz（tar.exe）
// 用法: node scripts/export-capability-pack.mjs
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const ver = pkg.version
const homeSkills = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh', 'skills')

// 1) skills 同步
let synced = 0
for (const name of fs.readdirSync(path.join(root, 'skills'))) {
  const src = path.join(root, 'skills', name, 'SKILL.md')
  const dstDir = path.join(homeSkills, name)
  if (!fs.existsSync(src)) continue
  fs.mkdirSync(dstDir, { recursive: true })
  fs.copyFileSync(src, path.join(dstDir, 'SKILL.md'))
  synced++
}
console.log(`[pack] skills 同步完成：${synced} 个 → ${homeSkills}`)

// 2) tar 打包 docs+skills+scripts
const dist = path.join(root, 'dist')
fs.mkdirSync(dist, { recursive: true })
const out = path.join(dist, `dsh-relay-capability-pack-${ver}.tar.gz`)
try { fs.unlinkSync(out) } catch {}
// tar -czf out -C root docs skills scripts（tar.exe Windows 用 -czf；bsdtar 兼容）
try {
  execSync(`tar -czf "${out}" -C "${root}" docs skills scripts`, { stdio: 'ignore', timeout: 60000 })
} catch (e) {
  console.error('[pack] tar 失败：', e.message)
  process.exit(1)
}
const size = fs.statSync(out).size
console.log(`[pack] 能力包已导出：${out} (${(size / 1024).toFixed(1)} KB, ver=${ver})`)
console.log('[pack] 完成。跨 profile/机器：解压包 → docs/skills/scripts 到目标 repo 或同步 skills 到 ~/.dsh/skills')
