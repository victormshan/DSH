#!/usr/bin/env node
// 只读本地看板：把 store.mjs 里的任务/Step List/轨迹通过 HTTP 暴露出来，供 index.html 展示。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function resolvePort(raw) {
  if (raw === undefined || raw.trim() === '') return 5177
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    console.error(`Invalid PORT env var: ${JSON.stringify(raw)} (must be an integer 1-65535)`)
    process.exit(1)
  }
  return n
}
const PORT = resolvePort(process.env.PORT)
const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'index.html'))

// 数据目录要和 MCP server 写入的一致（见 data-dir.mjs）。store.mjs 在 import 时
// 固化 STEP_RELAY_DIR，所以必须先解析、再动态 import。
const { resolveDataDir } = await import('./data-dir.mjs')
const dataDir = resolveDataDir()
if (dataDir.dir) process.env.STEP_RELAY_DIR = dataDir.dir
const store = await import('../lib/store.mjs')

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(INDEX_HTML)
  }

  if (url.pathname === '/api/tasks') {
    try {
      return json(res, 200, store.listExperiments())
    } catch (err) {
      return json(res, 500, { error: err.message })
    }
  }

  const match = url.pathname.match(/^\/api\/tasks\/([^/]+)$/)
  if (match) {
    const exprId = decodeURIComponent(match[1])
    try {
      const state = store.getState(exprId)
      const trace = store.readTrace(exprId)
      return json(res, 200, { ...state, trace })
    } catch (err) {
      return json(res, 404, { error: err.message })
    }
  }

  json(res, 404, { error: 'not found' })
})

const HOST = '127.0.0.1'
server.listen(PORT, HOST, () => {
  console.log(`step-relay UI: http://localhost:${PORT}`)
  console.log(`data dir: ${store.__paths.BASE_DIR}  (${dataDir.source})`)
})
