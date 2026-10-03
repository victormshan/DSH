#!/usr/bin/env node
// 只读本地看板：把 store.mjs 里的任务/Step List/轨迹通过 HTTP 暴露出来，供 index.html 展示。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT ? Number(process.env.PORT) : 5177
const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'index.html'))

// 默认指向仓库里固定的 ../../step-relay（与 cwd、操作系统无关，用 path 模块自动适配
// Windows/WSL 路径分隔符），除非显式设置了 STEP_RELAY_DIR 覆盖。必须在 import store.mjs
// 之前设置好 env，因为 BASE_DIR 是 store.mjs 模块加载时读取一次的。
if (!process.env.STEP_RELAY_DIR) {
  process.env.STEP_RELAY_DIR = path.resolve(__dirname, '..', '..', 'step-relay')
}
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
})
