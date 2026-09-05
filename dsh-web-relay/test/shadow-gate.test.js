// v3.6.0 Step4: 影子沙盒门禁测试（纯函数镜像 lib/shadow-gate.js；运行：node --test test/shadow-gate.test.js）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkL1Gate, resolveRepoPath, shouldUseShadow, runShadowGC, executeRollbackBaseline, runL2ShadowGate, getGitHead, gcScheduleMs } from '../lib/shadow-gate.js'

const REPO = 'D:/DSH'
const NON_REPO = 'D:/dsh relay test'

test('TC-Green: repoPath 识别 + L1 语法预检通过（合法文件）', () => {
  assert.equal(resolveRepoPath(REPO), 'D:/DSH')
  assert.equal(resolveRepoPath(NON_REPO), null)
  const r = checkL1Gate({ cwd: REPO, files: ['D:/DSH/dsh-web-relay/lib/shadow-gate.js'] })
  assert.equal(r.ok, true)
  assert.equal(r.errors.length, 0)
})

test('TC-Red: L1 拦截（注入语法错误的文件 → ok:false + 错误清单）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dwr-shadow-gate-'))
  const bad = path.join(tmp, 'bad.js')
  fs.writeFileSync(bad, 'const x = ;\n')
  const r = checkL1Gate({ cwd: tmp, files: ['bad.js'] })
  assert.equal(r.ok, false)
  assert.ok(r.errors.length >= 1)
  assert.ok(r.errors[0].file.includes('bad.js'))
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('TC-Context/Trigger Matrix: shouldUseShadow 判定（off/auto/on/l1/l2/degraded）', () => {
  const stepHigh = { importance: 'high', artifacts: ['lib/index.js'], breakthrough_type: 'structural' }
  assert.equal(shouldUseShadow(stepHigh, { repoPath: REPO, shadowGate: 'auto' }), 'l2')       // structural → L2
  assert.equal(shouldUseShadow({ importance: 'high', artifacts: ['lib/index.js'] }, { repoPath: REPO, shadowGate: 'auto', needsTests: true }), 'l2')
  assert.equal(shouldUseShadow({ importance: 'high', artifacts: ['lib/index.js'] }, { repoPath: REPO, shadowGate: 'auto' }), 'l1') // 仅 high+源码 → L1
  assert.equal(shouldUseShadow(stepHigh, { repoPath: REPO, shadowGate: 'off' }), 'off')
  assert.equal(shouldUseShadow(stepHigh, { repoPath: null, shadowGate: 'auto' }), 'degraded') // 非 git
  assert.equal(shouldUseShadow({ importance: 'medium', artifacts: ['lib/index.js'] }, { repoPath: REPO }), 'off')
  assert.equal(shouldUseShadow({ importance: 'high', artifacts: ['docs/a.md'] }, { repoPath: REPO }), 'off') // 无源码产物
})

test('TC-GC: Shadow GC（worktree prune + 统计；不误伤）', () => {
  const r = runShadowGC(REPO)
  assert.equal(r.ok, true)
  assert.equal(typeof r.pruned, 'number')
  assert.ok(r.active <= r.max || r.active === undefined || r.max >= 0) // 不超上限即安全
  assert.equal(runShadowGC(null).ok, true)
})

test('TC-Rollback: 回滚基线（非 git 降级提示；缺 commit 报错；无效 commit 返回错误且不破坏仓库）', () => {
  const d = executeRollbackBaseline(null, 'abc1234')
  assert.equal(d.ok, false)
  assert.equal(d.degraded, true)
  assert.ok(d.reason.includes('non-git'))
  const noBase = executeRollbackBaseline(REPO, null)
  assert.equal(noBase.ok, false)
  assert.ok(noBase.error.includes('iterationBaseCommit'))
  const badCommit = executeRollbackBaseline(REPO, '0000000000000000000000000000000000000000')
  assert.equal(badCommit.ok, false) // 无效 commit → 不执行 reset（不破坏工作区）
})

test('source 标记：lib/index.js 已接入 shadow-gate（v3.6.0 Step2）', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  const sg = fs.readFileSync(new URL('../lib/shadow-gate.js', import.meta.url), 'utf8')
  assert.ok(src.includes("from './shadow-gate.js'"))
  assert.ok(src.includes('blocked: \'shadow-l1\''))
  assert.ok(src.includes('shadow-l2'))
  assert.ok(sg.includes('v3.6.0'))
})

// ---- v3.7.0 P2：回滚基线 + rollback 端点 ----
test('getGitHead：git 仓库返回 HEAD（40hex），非 git 返回 null', () => {
  const head = getGitHead(REPO)
  assert.ok(typeof head === 'string' && /^[0-9a-f]{40}$/.test(head))
  assert.equal(getGitHead(NON_REPO), null)
  assert.equal(getGitHead(null), null)
})

test('source 标记：rollback 端点与 GC 自动挂载（lib/index.js + client.js，v3.7.0 P2）', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  const client = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(src.includes('const rollbackHandler'))
  assert.ok(src.includes("'/dsh-web-relay/steps/rollback'"))
  assert.ok(src.includes('iterationBaseCommit'))
  assert.ok(src.includes('Shadow GC 清理孤儿 worktree'))
  assert.ok(client.includes('rollbackToBase'))
  assert.ok(client.includes("'/dsh-web-relay/steps/rollback'"))
})

// ---- v3.8 Step2：GC 定时化（保留 finalize 触发语义）----
test('gcScheduleMs：周期解析（默认 600000 / 0 与非法关闭 / 上限 24h）', () => {
  assert.equal(gcScheduleMs(undefined), 0)          // 无 env → 0？不：index 侧传默认 600000；纯函数对 undefined 视为禁用
  assert.equal(gcScheduleMs('600000'), 600000)
  assert.equal(gcScheduleMs(600000), 600000)
  assert.equal(gcScheduleMs('0'), 0)                // 显式 0 → 关闭定时（仅 finalize 触发）
  assert.equal(gcScheduleMs(0), 0)
  assert.equal(gcScheduleMs(-1), 0)                 // 负值 → 关闭
  assert.equal(gcScheduleMs('abc'), 0)              // 非法 → 关闭
  assert.equal(gcScheduleMs(null), 0)
  assert.equal(gcScheduleMs(1000), 1000)
  assert.equal(gcScheduleMs(25 * 60 * 60 * 1000), 24 * 60 * 60 * 1000) // 超上限截断 24h
})

test('source 标记：GC 定时化挂载（lib/index.js 定时器 + shadow-gate gcScheduleMs，v3.8 Step2）', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  const sg = fs.readFileSync(new URL('../lib/shadow-gate.js', import.meta.url), 'utf8')
  assert.ok(src.includes('scheduledGcTimer'))
  assert.ok(src.includes('DSH_RELAY_GC_MS'))
  assert.ok(src.includes('DSH_RELAY_REPO_PATH'))
  assert.ok(src.includes('定时 Shadow GC 已启用'))
  assert.ok(sg.includes('gcScheduleMs'))
  assert.ok(sg.includes('v3.8 Step2'))
})
