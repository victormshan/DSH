// auto-iterate 状态机（skills/auto-iterate/state.mjs）：版间门、熔断、id 校验、状态存放位置。
// 每个用例用独立的 AUTO_ITERATE_STATE_DIR，不碰真实的 ~/.claude/auto-iterate。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const STATE_MJS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'auto-iterate', 'state.mjs')

function runner() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-iterate-state-'))
  const run = (...args) => {
    const r = spawnSync(process.execPath, [STATE_MJS, ...args], {
      env: { ...process.env, AUTO_ITERATE_STATE_DIR: dir },
      encoding: 'utf8'
    })
    return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr }
  }
  return { dir, run }
}

const init = (run, id, n = 2) =>
  run('init', '--id', id, '--goal', 'g', '--acceptance', 'a', '--iterations', String(n), '--repo', '/tmp/repo')

test('状态写在 AUTO_ITERATE_STATE_DIR 下，而不是技能目录/被迭代仓库', () => {
  const { dir, run } = runner()
  const r = init(run, 't1')
  assert.equal(r.code, 0)
  assert.equal(r.out.action, 'start_round')
  assert.ok(fs.existsSync(path.join(dir, 't1.json')))
  assert.ok(!fs.existsSync(path.join(path.dirname(STATE_MJS), 'state', 't1.json')))
})

test('版间门：approved 必须带 commit+tag；全部通过后 finalize', () => {
  const { run } = runner()
  init(run, 't2', 2)
  assert.notEqual(run('record', '--id', 't2', '--verdict', 'approved').code, 0, '缺 commit/tag 必须拒绝')
  let r = run('record', '--id', 't2', '--verdict', 'approved', '--commit', 'abc', '--tag', 'v1')
  assert.equal(r.out.action, 'start_round')
  assert.equal(r.out.nextIteration, 2)
  r = run('record', '--id', 't2', '--verdict', 'approved', '--commit', 'def', '--tag', 'v2')
  assert.equal(r.out.action, 'finalize')
  assert.equal(r.out.state.status, 'done')
  assert.equal(run('record', '--id', 't2', '--verdict', 'approved', '--commit', 'x', '--tag', 'y').out.action, 'noop')
})

test('熔断：同一版连续 3 次打回自动 pause；中间一次通过会清零', () => {
  const { run } = runner()
  init(run, 't3', 3)
  assert.equal(run('record', '--id', 't3', '--verdict', 'rejected', '--findings', '1').out.action, 'retry_same_round')
  assert.equal(run('record', '--id', 't3', '--verdict', 'rejected', '--findings', '1').out.action, 'retry_same_round')
  assert.equal(run('record', '--id', 't3', '--verdict', 'approved', '--commit', 'c', '--tag', 'v1').out.state.rejectStreak, 0)
  run('record', '--id', 't3', '--verdict', 'rejected')
  run('record', '--id', 't3', '--verdict', 'rejected')
  const r = run('record', '--id', 't3', '--verdict', 'rejected')
  assert.equal(r.out.action, 'pause')
  assert.equal(r.out.state.status, 'paused')
  assert.match(r.out.state.stopReason, /第 2 版连续 3 次/)
})

test('非法 id（路径穿越等）被拒绝，不在状态目录外写文件', () => {
  const { dir, run } = runner()
  for (const bad of ['../evil', 'a/b', '.hidden', '']) {
    assert.notEqual(init(run, bad).code, 0, `应拒绝 ${JSON.stringify(bad)}`)
  }
  assert.deepEqual(fs.readdirSync(dir), [])
})

test('list 汇总多个项目的任务并带上 repo', () => {
  const { run } = runner()
  init(run, 'p1', 1)
  init(run, 'p2', 2)
  const rows = run('list').out
  assert.deepEqual(rows.map((r) => r.id).sort(), ['p1', 'p2'])
  assert.ok(rows.every((r) => r.repo === '/tmp/repo'))
})
