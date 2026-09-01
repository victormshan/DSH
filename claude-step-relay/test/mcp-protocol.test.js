// 端到端协议层测试：真实启动 index.mjs 子进程，走完整 MCP stdio 协议，
// 而不是直接调用 lib/store.mjs——用来验证 zod 入参校验、工具注册、
// safe() 错误包装等 index.mjs 自己的逻辑（store.test.js 覆盖不到这些）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_PATH = path.join(__dirname, '..', 'index.mjs')

async function withClient(fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'step-relay-mcp-test-'))
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: { ...process.env, STEP_RELAY_DIR: dataDir }
  })
  const client = new Client({ name: 'test-client', version: '0.0.1' })
  await client.connect(transport)
  try {
    await fn(client, dataDir)
  } finally {
    await client.close()
  }
}

function textOf(result) {
  return result.content[0].text
}
function jsonOf(result) {
  return JSON.parse(textOf(result))
}

test('listTools 返回全部 8 个工具，且都有非空 description', async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools()
    assert.equal(tools.length, 8)
    const names = tools.map((t) => t.name).sort()
    assert.deepEqual(names, [
      'step_relay_append_trace',
      'step_relay_finalize',
      'step_relay_get_state',
      'step_relay_list',
      'step_relay_read_trace',
      'step_relay_set_steps',
      'step_relay_start',
      'step_relay_update_step'
    ])
    for (const t of tools) {
      assert.ok(t.description && t.description.length > 0, `${t.name} 缺少 description`)
    }
  })
})

test('完整工作流：start → set_steps → update_step ×N → finalize → get_state/list/read_trace', async () => {
  await withClient(async (client) => {
    const start = jsonOf(
      await client.callTool({ name: 'step_relay_start', arguments: { title: '端到端流程', prompt: '验证完整流程' } })
    )
    const exprId = start.exprId
    assert.ok(exprId)

    const withSteps = jsonOf(
      await client.callTool({
        name: 'step_relay_set_steps',
        arguments: { exprId, steps: [{ title: '步骤一', acceptance: 'A' }, { title: '步骤二' }] }
      })
    )
    assert.equal(withSteps.steps.length, 2)

    await client.callTool({ name: 'step_relay_update_step', arguments: { exprId, stepId: 1, status: 'done' } })
    await client.callTool({
      name: 'step_relay_update_step',
      arguments: { exprId, stepId: 2, status: 'blocked', note: '等外部依赖' }
    })

    const appendResult = await client.callTool({
      name: 'step_relay_append_trace',
      arguments: { exprId, role: '用户', text: '外部依赖已解决，继续' }
    })
    assert.equal(jsonOf(appendResult).ok, true)

    await client.callTool({ name: 'step_relay_update_step', arguments: { exprId, stepId: 2, status: 'done' } })
    const finalized = jsonOf(
      await client.callTool({ name: 'step_relay_finalize', arguments: { exprId, summary: '两步均已完成' } })
    )
    assert.equal(finalized.status, 'done')

    const state = jsonOf(await client.callTool({ name: 'step_relay_get_state', arguments: { exprId } }))
    assert.ok(state.steps.every((s) => s.status === 'done'))

    const list = jsonOf(await client.callTool({ name: 'step_relay_list', arguments: {} }))
    const found = list.find((x) => x.exprId === exprId)
    assert.equal(found.progress, '2/2')
    assert.equal(found.status, 'done')

    const trace = textOf(await client.callTool({ name: 'step_relay_read_trace', arguments: { exprId } }))
    for (const marker of ['[用户]', '[Claude]', '验证完整流程', '等外部依赖', '外部依赖已解决', '两步均已完成']) {
      assert.ok(trace.includes(marker), `轨迹缺少: ${marker}`)
    }
  })
})

test('zod 入参校验：缺少必填字段在 handler 执行前被拦截', async () => {
  await withClient(async (client) => {
    const r = await client.callTool({ name: 'step_relay_start', arguments: {} })
    assert.equal(r.isError, true)
    assert.match(textOf(r), /Required|title/i)
  })
})

test('zod 入参校验：非法 status 枚举值被拦截', async () => {
  await withClient(async (client) => {
    const start = jsonOf(await client.callTool({ name: 'step_relay_start', arguments: { title: 'x' } }))
    await client.callTool({ name: 'step_relay_set_steps', arguments: { exprId: start.exprId, steps: [{ title: 's' }] } })
    const r = await client.callTool({
      name: 'step_relay_update_step',
      arguments: { exprId: start.exprId, stepId: 1, status: 'approved' }
    })
    assert.equal(r.isError, true)
    assert.match(textOf(r), /Invalid enum value|status/i)
  })
})

test('业务错误：不存在的 exprId 在各工具上都返回 isError 而不抛未捕获异常', async () => {
  await withClient(async (client) => {
    for (const name of ['step_relay_get_state', 'step_relay_read_trace', 'step_relay_finalize', 'step_relay_set_steps']) {
      const args =
        name === 'step_relay_finalize'
          ? { exprId: 'ghost-id', summary: 'x' }
          : name === 'step_relay_set_steps'
            ? { exprId: 'ghost-id', steps: [{ title: 'x' }] }
            : { exprId: 'ghost-id' }
      const r = await client.callTool({ name, arguments: args })
      assert.equal(r.isError, true, `${name} 应返回 isError`)
      assert.match(textOf(r), /not found/, `${name} 错误信息应包含 not found`)
    }
  })
})

test('业务错误：路径穿越 exprId 被 store 层拦截而不是直接触碰文件系统', async () => {
  await withClient(async (client, dataDir) => {
    const r = await client.callTool({ name: 'step_relay_get_state', arguments: { exprId: '../../../../etc/passwd' } })
    assert.equal(r.isError, true)
    assert.match(textOf(r), /invalid exprId/)
    // 确认没有意外在 dataDir 外创建/读取任何东西——目录里应该仍是空的 experiments/traces。
    const exprDir = path.join(dataDir, 'experiments')
    if (fs.existsSync(exprDir)) {
      assert.deepEqual(fs.readdirSync(exprDir), [])
    }
  })
})

test('setSteps 覆盖式语义：第二次调用会替换而不是追加 Step List', async () => {
  await withClient(async (client) => {
    const start = jsonOf(await client.callTool({ name: 'step_relay_start', arguments: { title: '覆盖语义' } }))
    await client.callTool({
      name: 'step_relay_set_steps',
      arguments: { exprId: start.exprId, steps: [{ title: 'v1-a' }, { title: 'v1-b' }, { title: 'v1-c' }] }
    })
    const second = jsonOf(
      await client.callTool({
        name: 'step_relay_set_steps',
        arguments: { exprId: start.exprId, steps: [{ title: 'v2-only' }] }
      })
    )
    assert.equal(second.steps.length, 1)
    assert.equal(second.steps[0].title, 'v2-only')
  })
})

test('并发调用同一 exprId 的 update_step 不会导致文件损坏或状态丢失', async () => {
  await withClient(async (client) => {
    const start = jsonOf(await client.callTool({ name: 'step_relay_start', arguments: { title: '并发更新' } }))
    const steps = Array.from({ length: 10 }, (_, i) => ({ title: `步骤${i + 1}` }))
    await client.callTool({ name: 'step_relay_set_steps', arguments: { exprId: start.exprId, steps } })

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        client.callTool({
          name: 'step_relay_update_step',
          arguments: { exprId: start.exprId, stepId: i + 1, status: 'done' }
        })
      )
    )

    const state = jsonOf(await client.callTool({ name: 'step_relay_get_state', arguments: { exprId: start.exprId } }))
    assert.equal(state.steps.length, 10)
    assert.ok(state.steps.every((s) => s.status === 'done'), 'MCP stdio 单连接下请求串行处理，10 个并发调用应全部生效不丢失')
  })
})
