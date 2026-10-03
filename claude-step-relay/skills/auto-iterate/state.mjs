#!/usr/bin/env node
// 状态机：只负责"版间门 + 熔断"的判定与持久化（iterations 上限、rejectStreak 计数
// 这类 claude-step-relay 的 Step schema 里没有的字段），不做任何实施/审核决策，
// 也不是任务的可见记录——可见记录（Step List + 轨迹）交给 claude-step-relay 的
// MCP 工具，两边通过 exprId 关联，见 SKILL.md 的完整流程。
// 状态存放位置（用户级，跨项目共用，不写进被迭代的仓库——否则会弄脏 git status、
// 被每一版的 `git add -A` 一起提交）：
//   $AUTO_ITERATE_STATE_DIR，未设置时为 ~/.claude/auto-iterate/state/<id>.json
// 用法：
//   node state.mjs init   --id <id> --goal <text> --acceptance <text> --iterations <n> --repo <path>
//   node state.mjs link   --id <id> --exprId <exprId>   # 记录 step_relay_start 返回的 exprId
//   node state.mjs show   --id <id>
//   node state.mjs record --id <id> --verdict approved|rejected --findings <n> --channel review|self-review-fallback [--commit <sha>] [--tag <tag>]
//   node state.mjs pause  --id <id> --reason <text>
//   node state.mjs list

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const STATE_DIR = process.env.AUTO_ITERATE_STATE_DIR || join(homedir(), '.claude', 'auto-iterate', 'state')
const REJECT_STREAK_LIMIT = 3

function statePath(id) {
  // id 直接拼进文件路径：拒绝路径分隔符等，防止写到状态目录之外
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    console.error(`非法任务 id：${JSON.stringify(id)}（只允许字母数字及 . _ -，最长 64）`)
    process.exit(1)
  }
  return join(STATE_DIR, `${id}.json`)
}

function load(id) {
  const p = statePath(id)
  if (!existsSync(p)) {
    console.error(`no such task: ${id}`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(p, 'utf8'))
}

function save(state) {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(statePath(state.id), JSON.stringify(state, null, 2) + '\n')
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2)
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
      out[key] = val
    }
  }
  return out
}

function cmdInit(args) {
  const { id, goal, acceptance, iterations, repo } = args
  if (!id || !goal || !acceptance || !iterations || !repo) {
    console.error('缺少参数：--id --goal --acceptance --iterations --repo 均为必填')
    process.exit(1)
  }
  const n = Number(iterations)
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    console.error('--iterations 必须是 1-10 的整数')
    process.exit(1)
  }
  if (existsSync(statePath(id))) {
    console.error(`任务 ${id} 已存在，改用 show/record，或换一个 --id`)
    process.exit(1)
  }
  const state = {
    id,
    exprId: null,
    goal,
    finalAcceptance: acceptance,
    repo,
    iterations: n,
    currentIteration: 1,
    rejectStreak: 0,
    status: 'running',
    stopReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: []
  }
  save(state)
  console.log(JSON.stringify({ action: 'start_round', iteration: state.currentIteration, state }, null, 2))
}

function cmdLink(args) {
  const state = load(args.id)
  if (!args.exprId) {
    console.error('缺少 --exprId')
    process.exit(1)
  }
  state.exprId = args.exprId
  state.updatedAt = new Date().toISOString()
  save(state)
  console.log(JSON.stringify({ action: 'linked', state }, null, 2))
}

function cmdShow(args) {
  const state = load(args.id)
  console.log(JSON.stringify(state, null, 2))
}

function cmdList() {
  if (!existsSync(STATE_DIR)) return console.log('[]')
  const rows = readdirSync(STATE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(STATE_DIR, f), 'utf8')))
    .map((s) => ({ id: s.id, repo: s.repo, status: s.status, progress: `${s.currentIteration - (s.status === 'done' ? 1 : 0)}/${s.iterations}`, updatedAt: s.updatedAt }))
  console.log(JSON.stringify(rows, null, 2))
}

function cmdRecord(args) {
  const state = load(args.id)
  if (state.status !== 'running') {
    console.log(JSON.stringify({ action: 'noop', reason: `task status is ${state.status}, not running`, state }, null, 2))
    return
  }
  const { verdict, findings, channel, commit, tag } = args
  if (verdict !== 'approved' && verdict !== 'rejected') {
    console.error('--verdict 必须是 approved 或 rejected')
    process.exit(1)
  }
  const entry = {
    iteration: state.currentIteration,
    verdict,
    findings: Number(findings || 0),
    channel: channel || 'review',
    commit: commit || null,
    tag: tag || null,
    at: new Date().toISOString()
  }
  state.history.push(entry)
  state.updatedAt = entry.at

  let action
  if (verdict === 'approved') {
    if (!commit || !tag) {
      console.error('approved 必须同时提供 --commit 与 --tag（版间门以 tag 为准）')
      process.exit(1)
    }
    state.rejectStreak = 0
    const finishedIteration = state.currentIteration
    state.currentIteration += 1
    if (state.currentIteration > state.iterations) {
      state.status = 'done'
      action = 'finalize'
    } else {
      action = 'start_round'
    }
    save(state)
    console.log(JSON.stringify({ action, finishedIteration, nextIteration: state.currentIteration, state }, null, 2))
    return
  }

  // rejected
  state.rejectStreak += 1
  if (state.rejectStreak >= REJECT_STREAK_LIMIT) {
    state.status = 'paused'
    state.stopReason = `第 ${state.currentIteration} 版连续 ${state.rejectStreak} 次审核打回，自动熔断`
    action = 'pause'
  } else {
    action = 'retry_same_round'
  }
  save(state)
  console.log(JSON.stringify({ action, rejectStreak: state.rejectStreak, state }, null, 2))
}

function cmdPause(args) {
  const state = load(args.id)
  state.status = 'paused'
  state.stopReason = args.reason || 'manually paused'
  state.updatedAt = new Date().toISOString()
  save(state)
  console.log(JSON.stringify({ action: 'paused', state }, null, 2))
}

const [, , cmd, ...rest] = process.argv
const args = parseArgs(rest)

switch (cmd) {
  case 'init': cmdInit(args); break
  case 'link': cmdLink(args); break
  case 'show': cmdShow(args); break
  case 'list': cmdList(); break
  case 'record': cmdRecord(args); break
  case 'pause': cmdPause(args); break
  default:
    console.error('未知命令，可用：init | link | show | list | record | pause')
    process.exit(1)
}
