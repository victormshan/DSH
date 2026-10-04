#!/usr/bin/env node
// Review gate for auto-iterate — the "external reviewer" leg of the three-party protocol.
//
// The implementer (this Claude session) does NOT write the review prompt and does NOT report
// the verdict: this script stages the round's changes, builds the prompt from a fixed template,
// asks an external model (different vendor) and writes a review record that state.mjs requires
// and verifies. The record is bound to the staged git tree, so what gets committed must be
// exactly what was reviewed.
//
//   node review.mjs run    --id <task> [--provider auto|gemini-api|openai|web-gemini] [--evidence <file>]
//   node review.mjs submit --id <task> --channel claude-subagent|self-review|manual --file <review.md>
//                          (fallback channels when no external model is reachable; weaker, see STRENGTH)
//
// Output: one JSON line {verdict, channel, provider, strength, record}. Exit 3 = no external model
// reachable (decide on a fallback); 4 = reviewer reply had no VERDICT line.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { STRENGTH, die, loadState, reviewsDir, git, parseArgs, relayStore } from './common.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MAX_DIFF_CHARS = 60000
// web-gemini relays through a browser and times out on long reviews (~35KB failed every time,
// short prompts pass): large diffs are reviewed in chunks of whole files, each needing a verdict.
const CHUNK_CHARS = Number(process.env.AUTO_ITERATE_CHUNK_CHARS || 10000)

export function parseVerdict(text) {
  const m = /VERDICT\s*[:：]\s*(APPROVED|REJECTED)/i.exec(text || '')
  return m ? m[1].toLowerCase() : null
}

function stageRound(state) {
  git(state.repo, 'add', '-A')
  const tree = git(state.repo, 'write-tree')
  const base = git(state.repo, 'rev-parse', 'HEAD')
  const stat = git(state.repo, 'diff', '--cached', '--stat')
  if (!stat) die('nothing staged: this round has no changes to review')
  let diff = git(state.repo, 'diff', '--cached')
  let truncated = false
  if (diff.length > MAX_DIFF_CHARS) {
    diff = diff.slice(0, MAX_DIFF_CHARS)
    truncated = true
  }
  const files = git(state.repo, 'diff', '--cached', '--name-only').split('\n').filter(Boolean)
  const perFile = files.map((f) => ({ file: f, diff: git(state.repo, 'diff', '--cached', '--', f) }))
  return { tree, base, stat, diff, truncated, chunks: chunkDiff(perFile, CHUNK_CHARS) }
}

/** Packs per-file diffs into chunks of at most `limit` chars; oversized files are split by lines. */
export function chunkDiff(perFile, limit) {
  const pieces = []
  for (const { file, diff } of perFile) {
    if (diff.length <= limit) {
      pieces.push({ files: [file], diff })
      continue
    }
    const lines = diff.split('\n')
    const parts = []
    let cur = ''
    for (const l of lines) {
      if (cur && cur.length + l.length + 1 > limit) {
        parts.push(cur)
        cur = ''
      }
      cur += l + '\n'
    }
    if (cur) parts.push(cur)
    parts.forEach((d, i) => pieces.push({ files: [`${file}（第 ${i + 1}/${parts.length} 部分）`], diff: d }))
  }
  const chunks = []
  for (const p of pieces) {
    const last = chunks[chunks.length - 1]
    if (last && last.diff.length + p.diff.length <= limit) {
      last.files.push(...p.files)
      last.diff += p.diff
    } else {
      chunks.push({ files: [...p.files], diff: p.diff })
    }
  }
  return chunks
}

export function buildPrompt(state, staged, evidence, chunk = null, index = 0, total = 1) {
  const n = state.currentIteration
  const previous = (state.history || [])
    .filter((h) => h.iteration === n && h.verdict === 'rejected')
    .map((h, i) => `第 ${i + 1} 次打回（${h.reviewer?.channel || '?'}）：\n${(h.reviewer?.summary || '').slice(0, 1500)}`)
  return [
    '你是三方协作协议中的【外部审核者】，独立于实施方（另一家厂商的 AI）。你只负责找问题：不重写代码、不打分、不给与问题无关的建议。',
    '',
    `【任务目标】${state.goal}`,
    `【最终验收标准】${state.finalAcceptance}`,
    `【当前版本】第 ${n} / ${state.iterations} 版。只审本版改动是否满足其中对应本版的部分，且没有引入回归。`,
    previous.length ? `【本版此前的打回意见——确认是否已解决】\n${previous.join('\n\n')}` : '',
    evidence ? `【实施方提供的验证证据（未经你独立验证，请审慎采信）】\n${evidence.slice(0, 6000)}` : '',
    `【改动统计（本版全部文件）】\n${staged.stat}`,
    chunk
      ? `【本段 diff：第 ${index + 1}/${total} 段，只含 ${chunk.files.join('、')}】\n只就本段判定 VERDICT；需要其他段才能确认的跨文件问题，标为【非阻断】并说明。\n${chunk.diff}`
      : `【完整 diff${staged.truncated ? `（已截断到前 ${MAX_DIFF_CHARS} 字符，截断部分视为未审，可据此要求拆分）` : ''}】\n${staged.diff}`,
    '',
    '【输出格式（严格）】',
    '第一行只能是 `VERDICT: APPROVED` 或 `VERDICT: REJECTED`（存在任一阻断问题即 REJECTED）。',
    '之后逐条列出问题（最多 8 条，每条不超过 2 行），每条标注【阻断】或【非阻断】，写明文件/位置与具体失败场景。没有问题就写"无"。'
  ]
    .filter(Boolean)
    .join('\n')
}

async function writeRecord(state, staged, fields) {
  const dir = reviewsDir(state.id)
  mkdirSync(dir, { recursive: true })
  const attempt = readdirSync(dir).filter((f) => f.startsWith(`v${state.currentIteration}-`)).length + 1
  const record = {
    id: state.id,
    iteration: state.currentIteration,
    attempt,
    tree: staged.tree,
    base: staged.base,
    ...fields,
    at: new Date().toISOString()
  }
  const path = join(dir, `v${state.currentIteration}-${attempt}.json`)
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n')

  // Visible record in claude-step-relay (the step for this version), written by the gate itself.
  const store = await relayStore()
  if (store && state.exprId) {
    try {
      store.appendTrace(
        state.exprId,
        `外部审核 · ${fields.channel}${fields.provider ? `/${fields.provider}` : ''}`,
        `VERDICT: ${fields.verdict.toUpperCase()}（强度 ${fields.strength}，tree ${staged.tree.slice(0, 10)}）\n\n${fields.text}`
      )
    } catch (e) {
      console.error(`[review] relay trace skipped: ${e.message}`)
    }
  }
  return path
}

async function cmdRun(args) {
  const state = loadState(args.id)
  if (state.status !== 'running') die(`task status is ${state.status}, not running`)
  const evidence = args.evidence ? readFileSync(args.evidence, 'utf8') : ''
  const staged = stageRound(state)

  // Installed skill: copy next to this file. Repo checkout: tools/external-ai.mjs.
  const extPath = [join(HERE, 'external-ai.mjs'), join(HERE, '..', '..', 'tools', 'external-ai.mjs')].find(existsSync)
  if (!extPath) die('external-ai.mjs not found — reinstall the skill (npm run install-skill)')
  const { ask } = await import(pathToFileURL(extPath).href)

  const single = staged.diff.length <= CHUNK_CHARS || staged.chunks.length <= 1
  const parts = single ? [null] : staged.chunks
  const prompts = []
  const answers = []
  let verdict = 'approved'
  let reply
  for (const [i, chunk] of parts.entries()) {
    const prompt = buildPrompt(state, staged, evidence, chunk, i, parts.length)
    prompts.push(prompt)
    if (parts.length > 1) process.stderr.write(`[review] chunk ${i + 1}/${parts.length}: ${chunk.files.join(', ')}\n`)
    try {
      reply = await ask(prompt, { provider: args.provider || state.reviewProvider || 'auto' })
      let v = parseVerdict(reply.answer)
      if (!v) {
        // One format retry: the verdict line is mandatory.
        reply = await ask(`${prompt}\n\n（上一次回复缺少首行 VERDICT。请严格按格式重答。）`, { provider: reply.provider })
        v = parseVerdict(reply.answer)
      }
      if (!v) {
        console.log(JSON.stringify({ verdict: null, error: 'reviewer reply has no VERDICT line', provider: reply.provider, chunk: i + 1 }))
        process.exit(4)
      }
      if (v === 'rejected') verdict = 'rejected'
      answers.push(parts.length > 1 ? `### 第 ${i + 1}/${parts.length} 段（${chunk.files.join('、')}）\n${reply.answer}` : reply.answer)
    } catch (e) {
      console.log(JSON.stringify({ verdict: null, error: e.message, unavailable: Boolean(e.unavailable), chunk: i + 1 }))
      process.exit(e.unavailable ? 3 : 1)
    }
  }
  const summary = parts.length > 1 ? `VERDICT: ${verdict.toUpperCase()}（分 ${parts.length} 段审核，任一段打回即整版打回）\n\n` : ''
  const record = await writeRecord(state, staged, {
    verdict,
    channel: reply.channel,
    provider: reply.provider,
    model: reply.model,
    family: reply.family,
    strength: reply.strength,
    promptSha: createHash('sha256').update(prompts.join('\n---\n')).digest('hex'),
    text: summary + answers.join('\n\n')
  })
  console.log(JSON.stringify({ verdict, channel: reply.channel, provider: reply.provider, strength: reply.strength, record }))
}

async function cmdSubmit(args) {
  const state = loadState(args.id)
  if (state.status !== 'running') die(`task status is ${state.status}, not running`)
  const channel = args.channel
  if (!['claude-subagent', 'self-review', 'manual'].includes(channel)) {
    die('--channel 必须是 claude-subagent | self-review | manual（外部模型请用 review.mjs run）')
  }
  if (!args.file) die('缺少 --file <审核结论文本>')
  const text = readFileSync(args.file, 'utf8')
  const verdict = parseVerdict(text)
  if (!verdict) die('审核文本缺少 `VERDICT: APPROVED|REJECTED` 行', 4)
  const staged = stageRound(state)
  const record = await writeRecord(state, staged, {
    verdict,
    channel,
    provider: channel,
    model: null,
    family: channel === 'manual' ? 'human' : 'claude',
    strength: STRENGTH[channel],
    text
  })
  console.log(JSON.stringify({ verdict, channel, strength: STRENGTH[channel], record }))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...rest] = process.argv.slice(2)
  const args = parseArgs(rest)
  if (cmd === 'run') await cmdRun(args)
  else if (cmd === 'submit') await cmdSubmit(args)
  else die('用法：review.mjs run --id <task> [--provider …] [--evidence <file>] | submit --id <task> --channel … --file <md>')
}
