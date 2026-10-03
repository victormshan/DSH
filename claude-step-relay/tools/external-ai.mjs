#!/usr/bin/env node
// External AI client: ask a model from a different vendor than the implementer (Claude).
// Shared by the auto-iterate review gate and webtest's cross-review. Mirrors the
// dsh-web-relay three-party protocol's external reviewer channels.
//
// CLI:  echo "<prompt>" | node external-ai.mjs [--provider auto|gemini-api|openai|web-gemini] [--json] [--probe]
//   --json   print {provider, model, family, strength, answer} instead of the bare answer
//   --probe  only report which providers are available (JSON), do not ask
// Exit: 0 answered · 3 no external provider available · 1 provider error
//
// Providers (auto tries them in this order, skipping unavailable ones):
//   gemini-api  Google Gemini REST           GEMINI_API_KEY [EXTERNAL_AI_GEMINI_MODEL, default gemini-2.5-flash]
//   openai      OpenAI-compatible chat API   EXTERNAL_AI_BASE_URL + EXTERNAL_AI_API_KEY + EXTERNAL_AI_MODEL,
//                                            or DEEPSEEK_API_KEY (preset api.deepseek.com / deepseek-chat)
//   web-gemini  dsh-web-relay bridge -> Chrome extension -> gemini.google.com (no API quota)
//               DSH_RELAY_BRIDGE (default http://localhost:8899); from WSL, where the bridge's
//               loopback is not reachable, requests go through Windows curl.exe automatically.
import { spawnSync } from 'node:child_process'

/** Reviewer strength, aligned with dsh-web-relay's --min-reviewer scale. */
export const STRENGTH = { 'external-api': 4, 'web-gemini': 3, 'claude-subagent': 2, 'self-review': 1, manual: 5 }

const env = process.env
const BRIDGE = (env.DSH_RELAY_BRIDGE || 'http://localhost:8899').replace(/\/$/, '')

// ---------------------------------------------------------------- HTTP transports

async function httpNative(method, url, headers, body, timeoutMs) {
  const r = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) })
  return { status: r.status, text: await r.text() }
}

function hasCurlExe() {
  return spawnSync('curl.exe', ['--version'], { encoding: 'utf8' }).status === 0
}

// Windows curl.exe via WSL interop: reaches Windows loopback services from WSL.
function httpCurlExe(method, url, headers, body, timeoutMs) {
  const args = ['-s', '-m', String(Math.ceil(timeoutMs / 1000)), '-X', method, '-w', '\n%{http_code}']
  for (const [k, v] of Object.entries(headers || {})) args.push('-H', `${k}: ${v}`)
  if (body !== undefined) args.push('--data-binary', '@-')
  const p = spawnSync('curl.exe', [...args, url], { input: body, encoding: 'utf8', maxBuffer: 32 << 20 })
  if (p.status !== 0) throw new Error(`curl.exe exit ${p.status}`)
  const i = p.stdout.lastIndexOf('\n')
  return { status: Number(p.stdout.slice(i + 1)), text: p.stdout.slice(0, i) }
}

let bridgeTransport = null // resolved once: 'native' | 'curl.exe' | 'none'
async function bridgeHttp(method, path, headers, body, timeoutMs = 10000) {
  if (bridgeTransport === null) {
    try {
      await httpNative('GET', `${BRIDGE}/__token`, {}, undefined, 3000)
      bridgeTransport = 'native'
    } catch {
      bridgeTransport = hasCurlExe() ? 'curl.exe' : 'none'
    }
  }
  if (bridgeTransport === 'none') throw new Error('bridge unreachable')
  const fn = bridgeTransport === 'native' ? httpNative : httpCurlExe
  return fn(method, `${BRIDGE}${path}`, headers, body, timeoutMs)
}

// ---------------------------------------------------------------- providers

const providers = {
  'gemini-api': {
    family: 'gemini',
    channel: 'external-api',
    available: async () => Boolean(env.GEMINI_API_KEY),
    model: () => env.EXTERNAL_AI_GEMINI_MODEL || 'gemini-2.5-flash',
    async ask(prompt) {
      const model = this.model()
      const r = await httpNative(
        'POST',
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
        { 'content-type': 'application/json' },
        JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
        180000
      )
      const d = JSON.parse(r.text)
      if (r.status !== 200) throw new Error(`gemini-api ${r.status}: ${r.text.slice(0, 300)}`)
      return (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')
    }
  },

  openai: {
    channel: 'external-api',
    cfg() {
      if (env.EXTERNAL_AI_API_KEY && env.EXTERNAL_AI_BASE_URL && env.EXTERNAL_AI_MODEL) {
        return { base: env.EXTERNAL_AI_BASE_URL, key: env.EXTERNAL_AI_API_KEY, model: env.EXTERNAL_AI_MODEL }
      }
      if (env.DEEPSEEK_API_KEY) {
        return { base: 'https://api.deepseek.com', key: env.DEEPSEEK_API_KEY, model: env.EXTERNAL_AI_MODEL || 'deepseek-chat' }
      }
      return null
    },
    get family() {
      const c = this.cfg()
      return c && /deepseek/i.test(c.base + c.model) ? 'deepseek' : 'openai-compatible'
    },
    available: async function () { return this.cfg() !== null },
    model() { return this.cfg()?.model },
    async ask(prompt) {
      const c = this.cfg()
      const r = await httpNative(
        'POST',
        `${c.base.replace(/\/$/, '')}/chat/completions`,
        { 'content-type': 'application/json', authorization: `Bearer ${c.key}` },
        JSON.stringify({ model: c.model, messages: [{ role: 'user', content: prompt }] }),
        180000
      )
      if (r.status !== 200) throw new Error(`openai-compatible ${r.status}: ${r.text.slice(0, 300)}`)
      return JSON.parse(r.text).choices?.[0]?.message?.content || ''
    }
  },

  'web-gemini': {
    family: 'gemini',
    channel: 'web-gemini',
    model: () => 'gemini (web)',
    async available() {
      try {
        const r = await bridgeHttp('GET', '/__token', {}, undefined, 4000)
        return r.status === 200 && JSON.parse(r.text).ok === true
      } catch {
        return false
      }
    },
    async ask(prompt, { timeoutMs = 300000, attempts = 3 } = {}) {
      let lastErr
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          return await this.askOnce(prompt, timeoutMs)
        } catch (e) {
          lastErr = e
          // The extension occasionally fails to submit (e.g. leftover composer text); retry once.
          if (attempt < attempts) process.stderr.write(`[external-ai] web-gemini attempt ${attempt} failed: ${e.message}; retrying\n`)
        }
      }
      throw lastErr
    },
    async askOnce(prompt, timeoutMs) {
      const tok = JSON.parse((await bridgeHttp('GET', '/__token', {}, undefined, 4000)).text).token
      const headers = { 'content-type': 'application/json', 'x-dsh-bridge-token': tok }
      const c = await bridgeHttp('POST', '/create-task', headers, JSON.stringify({ prompt }))
      const cd = JSON.parse(c.text || 'null')
      if (!cd || !cd.ok || !cd.id) throw new Error(`bridge create-task failed (${c.status})`)
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000))
        const t = await bridgeHttp('GET', `/task-result/${cd.id}`, headers)
        const task = JSON.parse(t.text || 'null')?.task
        if (task?.status === 'done') return task.answer || ''
        if (task?.status === 'failed') throw new Error(`web-gemini failed: ${String(task.error || '').slice(0, 200)}`)
      }
      throw new Error(`web-gemini timed out after ${timeoutMs / 1000}s`)
    }
  }
}

const ORDER = ['gemini-api', 'openai', 'web-gemini']

export async function probe() {
  const out = {}
  for (const name of ORDER) out[name] = await providers[name].available()
  return out
}

/** Ask an external model. Returns {provider, model, family, channel, strength, answer}. */
export async function ask(prompt, { provider = 'auto' } = {}) {
  const names = provider === 'auto' ? ORDER : [provider]
  const errors = []
  for (const name of names) {
    const p = providers[name]
    if (!p) throw new Error(`unknown provider ${name}`)
    if (!(await p.available())) {
      errors.push(`${name}: unavailable`)
      continue
    }
    try {
      const answer = await p.ask(prompt)
      return { provider: name, model: p.model(), family: p.family, channel: p.channel, strength: STRENGTH[p.channel], answer }
    } catch (e) {
      errors.push(`${name}: ${e.message}`)
      if (provider !== 'auto') break
    }
  }
  const err = new Error(`no external AI answered (${errors.join('; ')})`)
  err.unavailable = errors.every((e) => e.endsWith('unavailable'))
  throw err
}

// ---------------------------------------------------------------- CLI

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const flag = (n) => argv.includes(n)
  const opt = (n, d) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : d)
  if (flag('--probe')) {
    console.log(JSON.stringify(await probe()))
    process.exit(0)
  }
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  const prompt = Buffer.concat(chunks).toString('utf8').trim()
  if (!prompt) {
    console.error('empty prompt on stdin')
    process.exit(2)
  }
  try {
    const r = await ask(prompt, { provider: opt('--provider', 'auto') })
    console.log(flag('--json') ? JSON.stringify(r) : r.answer)
  } catch (e) {
    console.error(e.message)
    process.exit(e.unavailable ? 3 : 1)
  }
}
