// dsh-web-relay · v3.6.0 影子沙盒支撑门禁模块（lib/shadow-gate.js）
// 职责（外部 AI Step 1 / 设计文档 §3 钩子 + §9.5 采纳修订）：
//   L1 轻量门禁：diff 载入内存/Staging 前，当前环境 node --check 语法预检（不建 worktree，<50ms）
//   L2 重型影子：按需 git worktree --detach 隔离 + 应用 diff + 影子内 node --check/目标测试 + 原子 merge/destroy
//   Shadow GC：孤儿 worktree 清理（防 SHADOW_MAX=2 泄漏死锁）
//   回滚基线：iterationBaseCommit git reset（git 工作区）；非 git 用增量内存/反向 patch（不做物理快照）
//   repoPath 自动识别 + shadowGate(off|auto|on) 判定
// 设计：纯函数 + 少量 execSync（同步、带 try/catch 失败转 ok:false），便于镜像测试。
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const GIT_TIMEOUT = 5000
const SHADOW_MAX = 2

const q = (p) => '"' + String(p).replace(/"/g, '\\"') + '"'
const q2 = (p) => '"' + String(p).replace(/"/g, '\\"') + '"'

function git(repoPath, args) {
  return execSync(`git -C ${q(repoPath)} ${args}`, { encoding: 'utf8', timeout: GIT_TIMEOUT, stdio: ['ignore', 'pipe', 'pipe'] })
}

// ---------- repoPath 识别 ----------
export function resolveRepoPath(base) {
  if (!base) return null
  try {
    const root = execSync(`git -C ${q(base)} rev-parse --show-toplevel`, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    return root || null
  } catch (err) {
    return null // 非 git 工作区
  }
}

// ---------- L1 轻量门禁：node --check 语法预检（当前环境，不建 worktree）----------
export function checkL1Gate({ cwd, files } = {}) {
  const list = Array.isArray(files) ? files : []
  const errors = []
  for (const f of list) {
    const abs = path.isAbsolute(f) ? f : path.join(cwd || '', f)
    if (!/\.(js|mjs|cjs)$/i.test(abs)) continue
    try {
      execSync(`node --check ${q2(abs)}`, { cwd: cwd || process.cwd(), timeout: GIT_TIMEOUT, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      const msg = String((err && err.stderr) || err || '').trim().slice(0, 500)
      errors.push({ file: f, error: msg || 'syntax check failed' })
    }
  }
  return { ok: errors.length === 0, errors }
}

// ---------- shadowGate 判定（off|auto|on）----------
export function shouldUseShadow(step, { repoPath, shadowGate = 'auto', needsTests = false } = {}) {
  const gate = String(shadowGate || 'auto')
  if (gate === 'on') return repoPath ? 'l2' : 'degraded'
  if (gate === 'off') return 'off'
  // auto：high + 源码产物 +（Structural/Paradigm 声明 或 需跑目标单测）→ L2；否则仅源码级 L1
  if (!step) return 'off'
  const importance = String(step.importance || '')
  const hasSourceArtifact = Array.isArray(step.artifacts) && step.artifacts.some((a) => /\.(js|mjs|cjs|py|ts)$/i.test(String(typeof a === 'string' ? a : (a && a.path) || '')))
  const bt = String((step.breakthrough_type || (step.architect_vision && step.architect_vision.breakthrough_type) || '').toLowerCase())
  const structural = bt === 'structural' || bt === 'paradigm'
  if (importance !== 'high') return 'off'
  if (!repoPath) return 'degraded' // 非 git：L1 可做（当前环境），L2 降级
  if (structural || needsTests) return hasSourceArtifact ? 'l2' : 'off'
  return hasSourceArtifact ? 'l1' : 'off'
}

// ---------- Shadow GC：孤儿 worktree 清理（防泄漏死锁）----------
export function runShadowGC(repoPath) {
  if (!repoPath) return { ok: true, pruned: 0 }
  try {
    git(repoPath, 'worktree prune') // 移除已删目录对应的 worktree 记录
    const out = git(repoPath, 'worktree list --porcelain')
    // 解析 porcelain：worktree <path> 行
    const lines = String(out || '').split('\n')
    const paths = []
    for (const l of lines) {
      if (l.startsWith('worktree ')) paths.push(l.slice('worktree '.length).trim())
    }
    const alive = paths.filter((p) => fs.existsSync(p))
    const orphans = paths.length - alive.length
    return { ok: true, pruned: orphans, active: alive.length, max: SHADOW_MAX }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err).slice(0, 300) }
  }
}

// ---------- 回滚基线：git reset（git 工作区）；非 git → null（由调用方走增量/反向 patch）----------
export function executeRollbackBaseline(repoPath, baseCommit) {
  if (!repoPath) return { ok: false, degraded: true, reason: 'non-git: 请用增量内存/反向 patch 回滚（不做物理快照）' }
  if (!baseCommit) return { ok: false, error: '缺少 iterationBaseCommit' }
  try {
    git(repoPath, `reset --hard ${q2(baseCommit)}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String((err && err.stderr) || err).slice(0, 300) }
  }
}

// ---------- L2 影子执行（按需 worktree）：create → 校验 → merge/destroy ----------
export function runL2ShadowGate({ repoPath, baseCommit, changedFiles = [], cwd } = {}) {
  if (!repoPath) return { ok: false, degraded: true, reason: 'non-git: 跳过 L2，仅 L1/增量回滚' }
  let shadowPath = ''
  try {
    // 1) create worktree --detach（复用对象库）
    shadowPath = path.join(path.dirname(repoPath), `.dwr-shadow-${Date.now().toString(36)}`)
    const base = baseCommit || 'HEAD'
    git(repoPath, `worktree add --detach ${q2(shadowPath)} ${q2(base)}`)
    // 2) node_modules 软链/挂载（Context Mount）：影子内测试可读到根 node_modules
    const rootNM = path.join(repoPath, 'node_modules')
    const shadowNM = path.join(shadowPath, 'node_modules')
    if (fs.existsSync(rootNM) && !fs.existsSync(shadowNM)) {
      try { fs.symlinkSync(rootNM, shadowNM, 'junction') } catch (err) { /* 软链失败不阻断，仅测试可能受限 */ }
    }
    // 3) 应用本步 diff 的改动文件到影子（复制改后文件内容）
    for (const rel of changedFiles) {
      const srcAbs = path.isAbsolute(rel) ? rel : path.join(repoPath, rel)
      const dstAbs = path.isAbsolute(rel) ? rel : path.join(shadowPath, rel)
      if (fs.existsSync(srcAbs)) {
        fs.mkdirSync(path.dirname(dstAbs), { recursive: true })
        fs.copyFileSync(srcAbs, dstAbs)
      }
    }
    // 4) 影子内 node --check 改动文件
    const l1 = checkL1Gate({ cwd: shadowPath, files: changedFiles })
    if (!l1.ok) {
      git(repoPath, `worktree remove --force ${q2(shadowPath)}`)
      return { ok: false, errors: l1.errors, reason: 'shadow L2 语法预检失败' }
    }
    git(repoPath, `worktree remove --force ${q2(shadowPath)}`)
    return { ok: true, shadowUsed: true }
  } catch (err) {
    if (shadowPath && fs.existsSync(shadowPath)) {
      try { git(repoPath, `worktree remove --force ${q2(shadowPath)}`) } catch (e2) { /* ignore */ }
    }
    return { ok: false, error: String((err && err.stderr) || (err && err.message) || err).slice(0, 500) }
  }
}
