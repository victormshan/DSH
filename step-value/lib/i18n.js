// step-value 中英文词汇表
//
// 两类"步骤"概念必须区分，避免 UI 文案混淆：
// - API Turn 步骤：每次 assistant/message 的 API 调用（turn），是费用统计的基本单位
// - Task Step 任务步骤：web-relay 的 Step List 任务步骤，本插件不做任务步骤统计，
//   但 UI 中相关文案（apiTurnLabel / taskStepLabel / costPerTurn 等）需明确区分
export const STEP_VALUE_I18N = {
  zh: {
    pluginTitle: 'step-value · API 费用看板',
    totalCost: '总开销',
    turnCost: '单次调用花费',
    inputTokens: '输入 Token',
    outputTokens: '输出 Token',
    cacheTokens: '缓存 Token',
    reasoningTokens: '推理 Token',
    totalTokens: 'Token 总量',
    modelRate: '模型单价',
    model: '模型',
    provider: '服务商',
    workspace: '工作区',
    session: '对话',
    turn: 'API 调用',
    taskStep: '任务步骤',
    apiTurnLabel: 'API 调用（费用单位）',
    taskStepLabel: '任务步骤（web-relay Step List）',
    currencyUSD: '美元 (USD)',
    currencyCNY: '人民币 (CNY)',
    turnCount: '调用次数',
    sessionCount: '对话数',
    costPerTurn: '每步花费',
    loadMore: '加载更多',
    refreshing: '刷新中…',
    noData: '暂无数据',
    updatedAt: '更新时间',
    expand: '展开',
    collapse: '收起',
    usdPer1k: 'USD / 1K tokens'
  },
  en: {
    pluginTitle: 'step-value · API Cost Dashboard',
    totalCost: 'Total Cost',
    turnCost: 'Turn Cost',
    inputTokens: 'Input Tokens',
    outputTokens: 'Output Tokens',
    cacheTokens: 'Cache Tokens',
    reasoningTokens: 'Reasoning Tokens',
    totalTokens: 'Total Tokens',
    modelRate: 'Model Rate',
    model: 'Model',
    provider: 'Provider',
    workspace: 'Workspace',
    session: 'Session',
    turn: 'API Call',
    taskStep: 'Task Step',
    apiTurnLabel: 'API Call (cost unit)',
    taskStepLabel: 'Task Step (web-relay Step List)',
    currencyUSD: 'USD',
    currencyCNY: 'CNY',
    turnCount: 'Calls',
    sessionCount: 'Sessions',
    costPerTurn: 'Cost per Step',
    loadMore: 'Load more',
    refreshing: 'Refreshing…',
    noData: 'No data',
    updatedAt: 'Updated',
    expand: 'Expand',
    collapse: 'Collapse',
    usdPer1k: 'USD / 1K tokens'
  }
}

export const STEP_VALUE_I18N_DEFAULT_LOCALE = 'zh'
