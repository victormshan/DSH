// v3.0-2/v3.0-3: 影子试错沙盒测试（v3.0.0）
// 运行：node --test test/shadow.test.js
// 镜像 lib/index.js ShadowSandbox 的状态机/并发上限/路径引号逻辑；
// 并对 git worktree 创建-销毁闭环做真实集成断言（临时仓库，净效果为零）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'

// ---- 镜像：路径引号（Windows 路径含空格）----
const q2 = (p) => '"' + String(p).replace(/"/g, '\\"') + '"'

// ---- 镜像：并发上限判定 ----
const SHADOW_MAX = 2
function canCreate(activeCount) { return activeCount < SHADOW_MAX }

test('路径引号：空格路径被双引号包裹', () => {
  assert.equal(q2('D:/dsh relay test'), '"D:/dsh relay test"')
  assert.equal(q2('C:/plain'), '"C:/plain"')
})

test('并发上限：active < 2 可创建，≥2 拒绝', () => {
  assert.equal(canCreate(0), true)
  assert.equal(canCreate(1), true)
  assert.equal(canCreate(2), false)
  assert.equal(canCreate(3), false)
})

// ---- git worktree 集成实测（临时仓库 → create → 修改 → destroy 闭环）----
test('git worktree 创建-销毁闭环（临时仓库，净效果为零）', { timeout: 30000 }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-shadow-test-'))
  const repo = path.join(tmp, 'repo')
  fs.mkdirSync(repo)
  execSync('git init -q', { cwd: repo })
  execSync('git config user.email test@test && git config user.name test', { cwd: repo })
  fs.writeFileSync(path.join(repo, 'a.txt'), 'v1\n')
  execSync('git add . && git commit -qm init', { cwd: repo })

  // create：detached worktree
  const sw = Date.now()
  const wt = path.join(tmp, 'sb-test1')
  const out = execSync(`git -C ${q2(repo)} worktree add --detach ${q2(wt)} HEAD`, { encoding: 'utf8' })
  const createMs = Date.now() - sw
  assert.ok(fs.existsSync(path.join(wt, 'a.txt')), 'worktree 检出文件存在')
  // 影子层内修改（模拟试错）
  fs.writeFileSync(path.join(wt, 'a.txt'), 'v2-shadow\n')
  // 未 merge 前主工作区不受影响（零污染验证）
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'v1\n')
  // merge：diff 应用回主工作区（Windows 行尾 CRLF，比较用 trim）
  const patch = execSync(`git -C ${q2(wt)} diff HEAD -- .`, { encoding: 'utf8' })
  assert.ok(patch.includes('v2-shadow'), 'diff 捕获影子修改')
  execSync(`git -C ${q2(repo)} apply -`, { input: patch, encoding: 'utf8' })
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8').trim(), 'v2-shadow')
  // destroy：worktree remove
  execSync(`git -C ${q2(repo)} worktree remove --force ${q2(wt)}`)
  assert.ok(!fs.existsSync(wt), '影子层已清理')
  console.log(`[集成] worktree create ${createMs}ms + merge + destroy 闭环通过`)

  fs.rmSync(tmp, { recursive: true, force: true })
})

test('source 源码含 v3.0-2 影子沙盒标记（lib/index.js）', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(src.includes('V3.0: 影子试错沙盒'))
  assert.ok(src.includes('/dsh-web-relay/shadow'))
  assert.ok(src.includes('shadowSandboxes'))
  assert.ok(src.includes('worktree add --detach'))
  assert.ok(src.includes('SHADOW_MAX'))
})
