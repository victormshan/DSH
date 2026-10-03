// 看板的数据目录解析：要和 MCP server 实际写入的目录一致，否则看板会显示「暂无任务」。
// 优先级：
//   1. 环境变量 STEP_RELAY_DIR（显式指定，最高优先级）
//   2. Claude Code MCP 配置里 claude-step-relay 的 env.STEP_RELAY_DIR
//      （~/.claude.json 的用户级 mcpServers，或 cwd/.mcp.json 的项目级）——
//      MCP server 就是按这个值写数据的
//   3. 都没有：交给 store.mjs 的默认值（process.cwd() + '/step-relay'），与 index.mjs 一致
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function readMcpDir(file) {
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
    const dir = cfg?.mcpServers?.['claude-step-relay']?.env?.STEP_RELAY_DIR
    return typeof dir === 'string' && dir.trim() ? dir : null
  } catch {
    return null
  }
}

/** @returns {{ dir: string|null, source: string }} dir=null 表示交给 store.mjs 默认值 */
export function resolveDataDir({ env = process.env, home = os.homedir(), cwd = process.cwd() } = {}) {
  if (env.STEP_RELAY_DIR && env.STEP_RELAY_DIR.trim()) {
    return { dir: env.STEP_RELAY_DIR, source: 'env STEP_RELAY_DIR' }
  }
  for (const file of [path.join(cwd, '.mcp.json'), path.join(home, '.claude.json')]) {
    const dir = readMcpDir(file)
    if (dir) return { dir, source: `MCP config ${file}` }
  }
  return { dir: null, source: 'default (cwd/step-relay)' }
}
