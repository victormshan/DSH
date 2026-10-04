// auto-iterate v2：状态机 + 审核门（三方协议对齐）。用临时 git 仓库与模拟 bridge，
// 每个用例独立的 AUTO_ITERATE_STATE_DIR，不碰真实 ~/.claude/auto-iterate，也不写 step-relay（未 link exprId）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SKILL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'auto-iterate')

function setup() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-state-'))
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-repo-'))
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim()
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'v0\n'); g('add', '-A'); g('commit', '-qm', 'base')
  const env = { ...process.env, AUTO_ITERATE_STATE_DIR: stateDir, DSH_RELAY_BRIDGE: 'http://127.0.0.1:9' }
  const node = (script, ...args) => {
    const r = spawnSync(process.execPath, [path.join(SKILL, script), ...args], { env, encoding: 'utf8' })
    let out = null
    try { out = JSON.parse(r.stdout) } catch { /* not json */ }
    return { code: r.status, out, err: r.stderr }
  }
  const st = (...a) => node('state.mjs', ...a)
  const submit = (id, channel, verdict) => {
    const f = path.join(stateDir, `review-${Math.random()}.md`)
    fs.writeFileSync(f, `VERDICT: ${verdict}\n\n- 无`)
    return node('review.mjs', 'submit', '--id', id, '--channel', channel, '--file', f)
  }
  const commitAndTag = (msg, tag) => { g('commit', '-qm', msg); g('tag', tag); return g('rev-parse', 'HEAD') }
  return { stateDir, repo, g, env, st, submit, commitAndTag, node }
}

const init = (t, id, n, min) =>
  t.st('init', '--id', id, '--goal', 'g', '--acceptance', 'a', '--iterations', String(n), '--repo', t.repo, ...(min ? ['--min-reviewer', min] : []))

test('record 不接受口头 verdict：必须带 review.mjs 写出的审核记录', () => {
  const t = setup()
  init(t, 'x', 1, 'manual')
  fs.writeFileSync(path.join(t.repo, 'a.txt'), 'v1\n')
  const r = t.st('record', '--id', 'x', '--verdict', 'approved', '--commit', 'HEAD', '--tag', 'v1')
  assert.notEqual(r.code, 0)
  assert.match(r.err, /必须带 --review/)
})

test('通过路径：提交的 tree 必须与被审 tree 一致；一致才推进并 finalize', () => {
  const t = setup()
  init(t, 'ok', 1, 'manual')
  fs.writeFileSync(path.join(t.repo, 'a.txt'), 'v1\n')
  const rev = t.submit('ok', 'manual', 'APPROVED')
  assert.equal(rev.code, 0, rev.err)
  // 审核后又偷偷改了内容再提交 → 拒绝
  fs.writeFileSync(path.join(t.repo, 'a.txt'), 'v1-sneaky\n')
  t.g('add', '-A')
  const bad = t.commitAndTag('sneaky', 'bad-tag')
  let r = t.st('record', '--id', 'ok', '--review', rev.out.record, '--commit', bad, '--tag', 'bad-tag')
  assert.notEqual(r.code, 0)
  assert.match(r.err, /提交内容与被审内容不一致/)
  // 回到被审内容重新提交 → 通过
  t.g('reset', '-q', '--hard', 'HEAD~1'); t.g('tag', '-d', 'bad-tag')
  fs.writeFileSync(path.join(t.repo, 'a.txt'), 'v1\n'); t.g('add', '-A')
  const good = t.commitAndTag('v1', 'auto/v1')
  r = t.st('record', '--id', 'ok', '--review', rev.out.record, '--commit', good, '--tag', 'auto/v1')
  assert.equal(r.code, 0, r.err)
  assert.equal(r.out.action, 'finalize')
  assert.equal(r.out.state.history[0].reviewer.channel, 'manual')
})

test('审核记录一次性：同一记录不能用两次', () => {
  const t = setup()
  init(t, 'once', 3, 'manual')
  fs.writeFileSync(path.join(t.repo, 'a.txt'), 'v1\n')
  const rev = t.submit('once', 'manual', 'REJECTED')
  assert.equal(t.st('record', '--id', 'once', '--review', rev.out.record).out.action, 'retry_same_round')
  const again = t.st('record', '--id', 'once', '--review', rev.out.record)
  assert.notEqual(again.code, 0)
  assert.match(again.err, /已被使用过/)
})

test('强度门：同模型子 agent 审核达不到默认门槛（web-gemini）→ pause 等人，不计打回', () => {
  const t = setup()
  init(t, 'weak', 2) // 默认 min-reviewer = web-gemini
  fs.writeFileSync(path.join(t.repo, 'a.txt'), 'v1\n')
  const rev = t.submit('weak', 'claude-subagent', 'APPROVED')
  const r = t.st('record', '--id', 'weak', '--review', rev.out.record, '--commit', 'HEAD', '--tag', 'x')
  assert.equal(r.out.action, 'pause')
  assert.match(r.out.state.stopReason, /强度不足/)
  assert.equal(r.out.state.rejectStreak, 0)
})

test('显式放宽门槛到 claude-subagent 时，子 agent 审核可推进', () => {
  const t = setup()
  init(t, 'relaxed', 1, 'claude-subagent')
  fs.writeFileSync(path.join(t.repo, 'a.txt'), 'v1\n')
  const rev = t.submit('relaxed', 'claude-subagent', 'APPROVED')
  const c = t.commitAndTag('v1', 'r/v1')
  assert.equal(t.st('record', '--id', 'relaxed', '--review', rev.out.record, '--commit', c, '--tag', 'r/v1').out.action, 'finalize')
})

test('熔断：同一版连续 3 次打回 → pause', () => {
  const t = setup()
  init(t, 'brk', 2, 'manual')
  fs.writeFileSync(path.join(t.repo, 'a.txt'), 'v1\n')
  let last
  for (let i = 0; i < 3; i++) last = t.st('record', '--id', 'brk', '--review', t.submit('brk', 'manual', 'REJECTED').out.record)
  assert.equal(last.out.action, 'pause')
  assert.match(last.out.state.stopReason, /连续 3 次/)
})

test('审核记录必须来自本任务的审核目录（不能拿任意文件冒充）', () => {
  const t = setup()
  init(t, 'fake', 1, 'manual')
  const f = path.join(t.stateDir, 'forged.json')
  fs.writeFileSync(f, JSON.stringify({ id: 'fake', iteration: 1, verdict: 'approved', channel: 'manual', strength: 5 }))
  const r = t.st('record', '--id', 'fake', '--review', f, '--commit', 'HEAD', '--tag', 'x')
  assert.notEqual(r.code, 0)
  assert.match(r.err, /必须位于/)
})

test('非法 id 被拒绝，不在状态目录外写文件', () => {
  const t = setup()
  for (const bad of ['../evil', 'a/b', '.hidden']) assert.notEqual(init(t, bad, 1).code, 0)
  assert.deepEqual(fs.readdirSync(t.stateDir), [])
})

// ---- review.mjs run：经模拟 bridge 走外部 AI（web-gemini 通道），提示由模板生成 ----
function mockBridge(answers) {
  const seen = { prompts: [] }
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
      if (req.url === '/__token') return send({ ok: true, token: 't'.repeat(64) })
      if (req.headers['x-dsh-bridge-token'] !== 't'.repeat(64)) { res.writeHead(401); return res.end('{}') }
      if (req.url === '/create-task') { seen.prompts.push(JSON.parse(body).prompt); return send({ ok: true, id: `t${seen.prompts.length}` }) }
      const n = Number(req.url.split('/t').pop())
      const a = answers[n - 1]
      return send({ ok: true, task: a.fail ? { status: 'failed', error: a.fail } : { status: 'done', answer: a } })
    })
  })
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, seen, url: `http://127.0.0.1:${server.address().port}` })))
}

function runAsync(t, env, ...args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(SKILL, 'review.mjs'), ...args], { env })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (code) => resolve({ code, out: out ? JSON.parse(out) : null, err }))
  })
}

test('review run：外部 AI 首次发送失败自动重试；记录通道/强度并绑定 tree；提示含目标与 diff', async () => {
  const t = setup()
  const b = await mockBridge([{ fail: 'SEND_FAIL: composer' }, 'VERDICT: APPROVED\n\n- 无'])
  try {
    init(t, 'ext', 1)
    fs.writeFileSync(path.join(t.repo, 'a.txt'), 'v1-external\n')
    const r = await runAsync(t, { ...t.env, DSH_RELAY_BRIDGE: b.url }, 'run', '--id', 'ext', '--provider', 'web-gemini')
    assert.equal(r.code, 0, r.err)
    assert.equal(r.out.verdict, 'approved')
    assert.equal(r.out.channel, 'web-gemini')
    assert.equal(r.out.strength, 3)
    assert.equal(b.seen.prompts.length, 2, '首次 SEND_FAIL 后重试一次')
    assert.match(b.seen.prompts[1], /外部审核者/)
    assert.match(b.seen.prompts[1], /v1-external/)
    const rec = JSON.parse(fs.readFileSync(r.out.record, 'utf8'))
    assert.equal(rec.tree, t.g('write-tree'))
    const c = t.commitAndTag('v1', 'e/v1')
    assert.equal(t.st('record', '--id', 'ext', '--review', r.out.record, '--commit', c, '--tag', 'e/v1').out.action, 'finalize')
  } finally {
    b.server.close()
  }
})

test('review run：没有任何外部 AI 可用 → exit 3（由技能决定降级或等人）', async () => {
  const t = setup()
  init(t, 'none', 1)
  fs.writeFileSync(path.join(t.repo, 'a.txt'), 'v1\n')
  const env = { ...t.env, DSH_RELAY_BRIDGE: 'http://127.0.0.1:9', PATH: '/usr/bin:/bin' } // 无 curl.exe、无 key
  delete env.GEMINI_API_KEY; delete env.DEEPSEEK_API_KEY; delete env.EXTERNAL_AI_API_KEY
  const r = await runAsync(t, env, 'run', '--id', 'none')
  assert.equal(r.code, 3, r.err)
  assert.equal(r.out.unavailable, true)
})

test('review run：大 diff 按文件分段审核，任一段打回即整版打回', async () => {
  const t = setup()
  const b = await mockBridge(['VERDICT: APPROVED\n\n- 无', 'VERDICT: REJECTED\n\n- 【阻断】b.txt 有问题'])
  try {
    init(t, 'chunk', 1)
    fs.writeFileSync(path.join(t.repo, 'a.txt'), 'A'.repeat(300) + '\n')
    fs.writeFileSync(path.join(t.repo, 'b.txt'), 'B'.repeat(300) + '\n')
    const env = { ...t.env, DSH_RELAY_BRIDGE: b.url, AUTO_ITERATE_CHUNK_CHARS: '600' }
    const r = await runAsync(t, env, 'run', '--id', 'chunk', '--provider', 'web-gemini')
    assert.equal(r.code, 0, r.err)
    assert.equal(r.out.verdict, 'rejected')
    assert.equal(b.seen.prompts.length, 2)
    assert.match(b.seen.prompts[0], /第 1\/2 段，只含 a\.txt/)
    assert.doesNotMatch(b.seen.prompts[0], /BBBB/)
    const rec = JSON.parse(fs.readFileSync(r.out.record, 'utf8'))
    assert.match(rec.text, /分 2 段审核/)
    assert.match(rec.text, /第 2\/2 段（b\.txt）/)
  } finally {
    b.server.close()
  }
})

test('chunkDiff：小文件合并、超大文件按行切分', async () => {
  const { chunkDiff } = await import(path.join(SKILL, 'review.mjs'))
  const big = Array.from({ length: 50 }, (_, i) => `+line ${i}`).join('\n')
  const chunks = chunkDiff([{ file: 'x', diff: 'aa\n' }, { file: 'y', diff: 'bb\n' }, { file: 'z', diff: big }], 120)
  assert.deepEqual(chunks[0].files, ['x', 'y'])
  assert.ok(chunks.length > 2 && chunks.every((c) => c.diff.length <= 120 + 20))
  assert.match(chunks[1].files[0], /z（第 1\/\d+ 部分）/)
})
