#!/usr/bin/env node
// 状态机：版间门 + 熔断 + 审核门的判定与持久化。不做实施/审核决策；可见记录（Step List + 轨迹）
// 交给 claude-step-relay，两边用 exprId 关联（见 SKILL.md）。
//
// 三方协议对齐（v2）：verdict 不再由实施方口头上报——record 必须带 review.mjs 写出的审核记录，
// 状态机自己读取并校验：
//   - 记录属于本任务、本版，且未被用过（一次性）
//   - 审核通道强度 ≥ minReviewer（不足则 pause 等人，不算打回——对应 dsh-web-relay 的强度门）
//   - approved 时：提交的 tree 与被审 tree 完全一致、父提交即审核时的 base、tag 指向该提交
//
// 状态存放：$AUTO_ITERATE_STATE_DIR，默认 ~/.claude/auto-iterate/state/（不进被迭代仓库）。
// 用法：
//   node state.mjs init   --id <id> --goal <text> --acceptance <text> --iterations <n> --repo <path>
//                         [--min-reviewer web-gemini|external-api|claude-subagent|self-review|manual]
//                         [--review-provider auto|gemini-api|openai|web-gemini]
//   node state.mjs link   --id <id> --exprId <exprId>
//   node state.mjs show   --id <id>
//   node state.mjs record --id <id> --review <record.json> [--commit <sha> --tag <tag>]   # approved 需要 commit/tag
//   node state.mjs pause  --id <id> --reason <text>
//   node state.mjs list
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { STATE_DIR, STRENGTH, die, statePath, reviewsDir, loadState, saveState, git, parseArgs } from './common.mjs'

const REJECT_STREAK_LIMIT = 3
const DEFAULT_MIN_REVIEWER = 'web-gemini'

function out(obj) {
  console.log(JSON.stringify(obj, null, 2))
}

function cmdInit(args) {
  const { id, goal, acceptance, iterations, repo } = args
  if (!id || !goal || !acceptance || !iterations || !repo) die('缺少参数：--id --goal --acceptance --iterations --repo 均为必填')
  const n = Number(iterations)
  if (!Number.isInteger(n) || n < 1 || n > 10) die('--iterations 必须是 1-10 的整数')
  const minReviewer = args['min-reviewer'] || DEFAULT_MIN_REVIEWER
  if (!(minReviewer in STRENGTH)) die(`--min-reviewer 必须是 ${Object.keys(STRENGTH).join(' | ')}`)
  if (existsSync(statePath(id))) die(`任务 ${id} 已存在，改用 show/record，或换一个 --id`)
  const now = new Date().toISOString()
  const state = {
    id,
    exprId: null,
    goal,
    finalAcceptance: acceptance,
    repo: resolve(repo),
    iterations: n,
    currentIteration: 1,
    rejectStreak: 0,
    minReviewer,
    reviewProvider: args['review-provider'] || 'auto',
    implementerFamily: 'claude',
    status: 'running',
    stopReason: null,
    createdAt: now,
    updatedAt: now,
    history: []
  }
  saveState(state)
  out({ action: 'start_round', iteration: 1, state })
}

function cmdLink(args) {
  const state = loadState(args.id)
  if (!args.exprId) die('缺少 --exprId')
  state.exprId = args.exprId
  state.updatedAt = new Date().toISOString()
  saveState(state)
  out({ action: 'linked', state })
}

function cmdList() {
  if (!existsSync(STATE_DIR)) return console.log('[]')
  const rows = readdirSync(STATE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(STATE_DIR, f), 'utf8')))
    .map((s) => ({
      id: s.id,
      repo: s.repo,
      status: s.status,
      progress: `${s.currentIteration - (s.status === 'done' ? 1 : 0)}/${s.iterations}`,
      minReviewer: s.minReviewer || '(v1: none)',
      updatedAt: s.updatedAt
    }))
  out(rows)
}

/** Loads and validates a review record; returns it or dies with the reason. */
function checkReview(state, path) {
  if (!path || path === true) die('record 必须带 --review <review.mjs 写出的审核记录>（实施方不能口头上报 verdict）')
  const abs = resolve(path)
  if (!abs.startsWith(resolve(reviewsDir(state.id)) + '/')) die(`审核记录必须位于 ${reviewsDir(state.id)}（由 review.mjs 写出）`)
  if (!existsSync(abs)) die(`审核记录不存在：${abs}`)
  const r = JSON.parse(readFileSync(abs, 'utf8'))
  if (r.id !== state.id || r.iteration !== state.currentIteration) {
    die(`审核记录不属于本任务本版（记录：${r.id} v${r.iteration}；当前：${state.id} v${state.currentIteration}）`)
  }
  if (state.history.some((h) => h.reviewer?.record === abs)) die('该审核记录已被使用过（一次性）')
  if (!['approved', 'rejected'].includes(r.verdict)) die(`审核记录 verdict 非法：${r.verdict}`)
  if (STRENGTH[r.channel] !== r.strength) die(`审核记录通道与强度不一致：${r.channel}/${r.strength}`)
  return { ...r, path: abs }
}

function cmdRecord(args) {
  const state = loadState(args.id)
  if (state.status !== 'running') {
    out({ action: 'noop', reason: `task status is ${state.status}, not running`, state })
    return
  }
  const r = checkReview(state, args.review)
  if (args.verdict && args.verdict !== r.verdict) die(`--verdict ${args.verdict} 与审核记录 ${r.verdict} 不一致`)
  const min = state.minReviewer || DEFAULT_MIN_REVIEWER
  const reviewer = {
    channel: r.channel,
    provider: r.provider,
    model: r.model,
    family: r.family,
    strength: r.strength,
    record: r.path,
    summary: (r.text || '').slice(0, 2000)
  }
  const now = new Date().toISOString()

  // 强度门：通道不够强 → 停止等人（不计入打回、不推进），同 dsh-web-relay --min-reviewer。
  if (r.strength < STRENGTH[min]) {
    state.history.push({ iteration: state.currentIteration, verdict: 'insufficient-reviewer', reviewer, at: now })
    state.status = 'paused'
    state.stopReason = `审核通道强度不足：${r.channel}(${r.strength}) < 门槛 ${min}(${STRENGTH[min]})——需要外部 AI 或人工审核`
    state.updatedAt = now
    saveState(state)
    out({ action: 'pause', state })
    return
  }

  if (r.verdict === 'approved') {
    const { commit, tag } = args
    if (!commit || !tag || commit === true || tag === true) die('approved 必须同时提供 --commit 与 --tag')
    const commitTree = git(state.repo, 'rev-parse', `${commit}^{tree}`)
    if (commitTree !== r.tree) die(`提交内容与被审内容不一致：commit tree ${commitTree} ≠ 审核 tree ${r.tree}`)
    const parent = git(state.repo, 'rev-parse', `${commit}^`)
    if (parent !== r.base) die(`提交的父提交 ${parent} ≠ 审核时的 base ${r.base}`)
    const tagged = git(state.repo, 'rev-parse', `${tag}^{commit}`)
    if (tagged !== git(state.repo, 'rev-parse', commit)) die(`tag ${tag} 没有指向 ${commit}`)

    state.history.push({ iteration: state.currentIteration, verdict: 'approved', commit, tag, reviewer, at: now })
    state.rejectStreak = 0
    const finished = state.currentIteration
    state.currentIteration += 1
    const action = state.currentIteration > state.iterations ? 'finalize' : 'start_round'
    if (action === 'finalize') state.status = 'done'
    state.updatedAt = now
    saveState(state)
    out({ action, finishedIteration: finished, nextIteration: state.currentIteration, state })
    return
  }

  // rejected
  state.history.push({ iteration: state.currentIteration, verdict: 'rejected', reviewer, at: now })
  state.rejectStreak += 1
  let action = 'retry_same_round'
  if (state.rejectStreak >= REJECT_STREAK_LIMIT) {
    state.status = 'paused'
    state.stopReason = `第 ${state.currentIteration} 版连续 ${state.rejectStreak} 次审核打回，自动熔断`
    action = 'pause'
  }
  state.updatedAt = now
  saveState(state)
  out({ action, rejectStreak: state.rejectStreak, state })
}

function cmdPause(args) {
  const state = loadState(args.id)
  state.status = 'paused'
  state.stopReason = args.reason || 'manually paused'
  state.updatedAt = new Date().toISOString()
  saveState(state)
  out({ action: 'paused', state })
}

const [cmd, ...rest] = process.argv.slice(2)
const args = parseArgs(rest)
switch (cmd) {
  case 'init': cmdInit(args); break
  case 'link': cmdLink(args); break
  case 'show': out(loadState(args.id)); break
  case 'list': cmdList(); break
  case 'record': cmdRecord(args); break
  case 'pause': cmdPause(args); break
  default:
    die('未知命令，可用：init | link | show | list | record | pause')
}
