import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveDataDir } from '../ui/data-dir.mjs'

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'step-relay-ui-dir-'))
}
const mcp = (dir) => JSON.stringify({ mcpServers: { 'claude-step-relay': { command: 'node', env: { STEP_RELAY_DIR: dir } } } })

test('环境变量 STEP_RELAY_DIR 优先级最高', () => {
  const home = tmp()
  fs.writeFileSync(path.join(home, '.claude.json'), mcp('/from/config'))
  const r = resolveDataDir({ env: { STEP_RELAY_DIR: '/from/env' }, home, cwd: tmp() })
  assert.deepEqual(r, { dir: '/from/env', source: 'env STEP_RELAY_DIR' })
})

test('未设环境变量时读用户级 MCP 配置（与 MCP server 写入目录一致）', () => {
  const home = tmp()
  fs.writeFileSync(path.join(home, '.claude.json'), mcp('/from/user-config'))
  const r = resolveDataDir({ env: {}, home, cwd: tmp() })
  assert.equal(r.dir, '/from/user-config')
  assert.match(r.source, /\.claude\.json$/)
})

test('项目级 .mcp.json 优先于用户级配置', () => {
  const home = tmp()
  const cwd = tmp()
  fs.writeFileSync(path.join(home, '.claude.json'), mcp('/from/user-config'))
  fs.writeFileSync(path.join(cwd, '.mcp.json'), mcp('/from/project-config'))
  assert.equal(resolveDataDir({ env: {}, home, cwd }).dir, '/from/project-config')
})

test('配置缺失/损坏/无该 server 时回退到 store.mjs 默认值', () => {
  const home = tmp()
  fs.writeFileSync(path.join(home, '.claude.json'), '{ not json')
  const cwd = tmp()
  fs.writeFileSync(path.join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { other: {} } }))
  assert.deepEqual(resolveDataDir({ env: { STEP_RELAY_DIR: '  ' }, home, cwd }), {
    dir: null,
    source: 'default (cwd/step-relay)'
  })
})
