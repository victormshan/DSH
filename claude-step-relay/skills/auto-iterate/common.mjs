// Shared helpers for the auto-iterate state machine (state.mjs) and review gate (review.mjs).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// State lives outside the iterated repo (it would dirty git status and get committed otherwise).
export const STATE_DIR = process.env.AUTO_ITERATE_STATE_DIR || join(homedir(), '.claude', 'auto-iterate', 'state')

/** Reviewer strength, aligned with dsh-web-relay's --min-reviewer scale (see external-ai.mjs). */
export const STRENGTH = { 'external-api': 4, 'web-gemini': 3, 'claude-subagent': 2, 'self-review': 1, manual: 5 }

export function die(msg, code = 1) {
  console.error(msg)
  process.exit(code)
}

export function statePath(id) {
  // id becomes part of a file path: reject separators and dot-files
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    die(`非法任务 id：${JSON.stringify(id)}（只允许字母数字及 . _ -，最长 64）`)
  }
  return join(STATE_DIR, `${id}.json`)
}

export function reviewsDir(id) {
  return join(STATE_DIR, `${id}.reviews`)
}

export function loadState(id) {
  const p = statePath(id)
  if (!existsSync(p)) die(`no such task: ${id}`)
  return JSON.parse(readFileSync(p, 'utf8'))
}

export function saveState(state) {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(statePath(state.id), JSON.stringify(state, null, 2) + '\n')
}

export function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 }).trim()
}

export function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2)
      const val = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true
      out[key] = val
    }
  }
  return out
}

/**
 * claude-step-relay store, resolved from the Claude Code MCP config so traces land
 * where the MCP server writes. Returns null if not configured (recording is then skipped).
 */
export async function relayStore() {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')).mcpServers?.['claude-step-relay']
    const index = cfg?.args?.find((a) => a.endsWith('index.mjs'))
    if (!index) return null
    if (cfg.env?.STEP_RELAY_DIR && !process.env.STEP_RELAY_DIR) process.env.STEP_RELAY_DIR = cfg.env.STEP_RELAY_DIR
    return await import(pathToFileURL(join(dirname(index), 'lib', 'store.mjs')).href)
  } catch {
    return null
  }
}
