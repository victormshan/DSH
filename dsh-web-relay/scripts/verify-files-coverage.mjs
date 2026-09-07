// dsh-web-relay 静态覆盖断言（v4.9.2，env_4）：lib import 图 vs 文件系统 / package files
// 校验：① index.js/client.js import 的本地模块都存在 ② 本地模块都在 package.json files 覆盖内（lib 目录全含）
// 用法：node scripts/verify-files-coverage.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const files = Array.isArray(pkg.files) ? pkg.files : []
let errors = []

// 收集本地 import（./x 或 ../x）
function collectLocalImports(file) {
  const src = fs.readFileSync(file, 'utf8')
  const out = []
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) out.push(m[1])
  return out
}

// 解析相对 import 到绝对路径（file 所在目录 + spec）
function resolveLocal(file, spec) {
  return path.resolve(path.dirname(file), spec)
}

const checkFile = (f) => {
  if (!fs.existsSync(f)) errors.push(`MISSING FILE: ${f}`)
}

// ① index.js / client.js 及其递归依赖的本地 import 全存在
const visited = new Set()
function walk(file) {
  const real = fs.realpathSync(file)
  if (visited.has(real)) return
  visited.add(real)
  for (const spec of collectLocalImports(file)) {
    let target = resolveLocal(file, spec)
    if (!fs.existsSync(target)) target += '.js' // 无扩展名兜底
    if (fs.existsSync(target)) {
      if (target.endsWith('.js') || target.endsWith('.mjs')) walk(target)
    } else {
      errors.push(`DANGLING IMPORT: ${file} -> ${spec}`)
    }
  }
}
for (const entry of ['lib/index.js', 'lib/client.js']) {
  const p = path.join(root, entry)
  if (fs.existsSync(p)) walk(p)
  else errors.push(`MISSING ENTRY: ${entry}`)
}

// ② 所有被引用的本地模块都在 files 覆盖内（files 含 "lib" 目录即全含；bin/scripts 显式枚举）
function coveredByFiles(rel) {
  const norm = rel.replace(/\\/g, '/')
  for (const f of files) {
    if (f === norm) return true
    if (f.endsWith('/')) { if (norm.startsWith(f)) return true; continue }
    if (f.endsWith('/*')) { if (norm.startsWith(f.slice(0, -1))) return true; continue }
    // 目录条目（无扩展名路径如 "lib"）——files 里 "lib" 字符串表示整个目录
    if (!f.includes('.') && (norm === f || norm.startsWith(f + '/'))) return true
  }
  return false
}
for (const abs of visited) {
  const rel = path.relative(root, abs).replace(/\\/g, '/')
  if (!coveredByFiles(rel)) errors.push(`NOT COVERED BY FILES: ${rel}`)
}

// ③ watchdog / verify 脚本存在
for (const f of ['bin/watchdog.mjs', 'scripts/verify-capabilities.mjs', 'scripts/verify-lessons.mjs', 'scripts/install-new-env.ps1', 'scripts/export-capability-pack.mjs']) {
  if (!fs.existsSync(path.join(root, f))) errors.push(`MISSING TOOL: ${f}`)
}

console.log(`[coverage] walked ${visited.size} local modules; files entries: ${files.length}`)
if (errors.length === 0) {
  console.log('[coverage] OK — 所有 import 可达且均被 package files 覆盖')
  process.exit(0)
}
console.log('[coverage] FAILURES:')
for (const e of errors) console.log('  - ' + e)
process.exit(1)
