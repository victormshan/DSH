#!/usr/bin/env node
// claude-step-relay MCP server：Step List 拆分 + 三方轨迹记录，无外部 AI 审核门槛。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import * as store from './lib/store.mjs'

const server = new McpServer({ name: 'claude-step-relay', version: '0.1.0' })

const textResult = (obj) => ({
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }]
})
const errorResult = (err) => ({
  content: [{ type: 'text', text: `错误: ${err.message}` }],
  isError: true
})
const safe = (fn) => async (args) => {
  try {
    return textResult(await fn(args))
  } catch (err) {
    return errorResult(err)
  }
}

server.tool(
  'step_relay_start',
  '开始一个新任务：创建 Step List 容器 + 三方轨迹文件，记录初始 prompt。返回 exprId，后续所有操作都要带上它。',
  { title: z.string().describe('任务标题，简短'), prompt: z.string().optional().describe('用户原始需求/上下文，可选') },
  safe(({ title, prompt }) => store.createExperiment({ title, prompt }))
)

server.tool(
  'step_relay_set_steps',
  '为指定任务定义/替换 Step List（覆盖式）。每步含 title，可选 detail/acceptance。',
  {
    exprId: z.string(),
    steps: z.array(
      z.object({
        id: z.union([z.number(), z.string()]).optional(),
        title: z.string(),
        detail: z.string().optional(),
        acceptance: z.string().optional()
      })
    )
  },
  safe(({ exprId, steps }) => store.setSteps(exprId, steps))
)

server.tool(
  'step_relay_update_step',
  '更新某个 Step 的状态（pending/executing/done/blocked）并可附说明，自动写入轨迹。',
  {
    exprId: z.string(),
    stepId: z.union([z.number(), z.string()]),
    status: z.enum(['pending', 'executing', 'done', 'blocked']),
    note: z.string().optional()
  },
  safe(({ exprId, stepId, status, note }) => store.updateStep(exprId, stepId, status, note))
)

server.tool(
  'step_relay_append_trace',
  '手动追加一条三方轨迹记录（比如用户反馈、关键决策），role 建议用 用户 或 Claude。',
  { exprId: z.string(), role: z.string(), text: z.string() },
  safe(({ exprId, role, text }) => {
    store.appendTrace(exprId, role, text)
    return { ok: true }
  })
)

server.tool(
  'step_relay_get_state',
  '读取指定任务当前的完整状态（Step List + 各步状态）。',
  { exprId: z.string() },
  safe(({ exprId }) => store.getState(exprId))
)

server.tool(
  'step_relay_list',
  '列出所有任务及其进度概览，按最近更新排序。',
  {},
  safe(() => store.listExperiments())
)

server.tool(
  'step_relay_read_trace',
  '读取指定任务的完整三方轨迹（Markdown 原文）。',
  { exprId: z.string() },
  safe(({ exprId }) => store.readTrace(exprId))
)

server.tool(
  'step_relay_finalize',
  '收口任务：全部步骤完成后调用，标记整体 done 并写入最终结论到轨迹。',
  { exprId: z.string(), summary: z.string() },
  safe(({ exprId, summary }) => store.finalize(exprId, summary))
)

const transport = new StdioServerTransport()
await server.connect(transport)
