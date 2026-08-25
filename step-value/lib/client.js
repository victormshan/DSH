// step-value — Browser half（cordis 静态插件 bundle）
// ===========================================================================
// 形态与 dsh-web-relay/lib/client.js 一致：window.__ModuleLoader__.load({ id, factory })。
// 浏览器端没有 Node module/exports，factory 顶部必须自备
// `var module = { exports: {} }; var exports = module.exports;`。
//
// 功能：
//   1. FooterButton（底部栏 ⚡ 按钮）↔ StepValuePanel（shell.overlay 右侧面板），
//      跨槽位开关状态用 window CustomEvent 同步
//   2. 打开面板时 fetch /step-value/tree（全树）+ /step-value/summary（顶部汇总）
//   3. 左列（45%）：总开销卡片 + Workspace（可展开）→ Session（可选中）
//   4. 右列（55%）：选中 Session 的 Turn 费用卡片瀑布流（CSS columns）
//   5. 卡片点击 → fetch /step-value/step-details 展开 usageRaw / sourceRaw
//   6. 面板内 中/EN 切换（localStorage 'step-value:locale' 持久化）
//
// i18n 字典（STEP_VALUE_I18N，zh/en 各 29 键）内联复制自 lib/i18n.js ——
// browser bundle 不能 import 外部文件，运行时零外部依赖。
// ===========================================================================

window.__ModuleLoader__.load({
  id: 'step-value',
  factory: (require) => {
    // 规则1：browser bundle 无 Node module/exports，必须自备
    var module = { exports: {} }; var exports = module.exports;

    // 规则2：只用小写闭包绑定 react（React.* 会抛 ReferenceError）
    const react = require('react')
    const { useState, useEffect, useRef } = react
    const h = react.createElement

    // ---- i18n 字典（内联自 lib/i18n.js；29 键，zh/en 键集合一致）----
    const STEP_VALUE_I18N = {
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
    const STEP_VALUE_I18N_DEFAULT_LOCALE = 'zh'
    const LOCALE_KEY = 'step-value:locale'
    const loadLocale = () => {
      try {
        const v = localStorage.getItem(LOCALE_KEY)
        if (v === 'zh' || v === 'en') return v
      } catch (e) { /* ignore */ }
      return STEP_VALUE_I18N_DEFAULT_LOCALE
    }

    // ---- 规则4：跨组件状态用 window CustomEvent（footer 按钮 ↔ overlay 面板）----
    const PANEL_EVENT = 'step-value:panel-toggle'
    const dispatchToggle = () => {
      try { window.dispatchEvent(new CustomEvent(PANEL_EVENT, { detail: { ts: Date.now() } })) } catch (e) { /* ignore */ }
    }
    const usePanelOpen = () => {
      const [open, setOpen] = useState(false)
      useEffect(() => {
        const on = () => setOpen((v) => !v)
        try { window.addEventListener(PANEL_EVENT, on) } catch (e) { /* ignore */ }
        return () => { try { window.removeEventListener(PANEL_EVENT, on) } catch (e) { /* ignore */ } }
      }, [])
      return [open, setOpen]
    }

    // ---- 展示工具 ----
    const fmtUSD = (n) => {
      const v = Number(n) || 0
      return v >= 0.01 ? v.toFixed(4) : v.toFixed(6) // 4~6 位小数
    }
    const fmtCNY = (n) => (Number(n) || 0).toFixed(2)
    const fmtInt = (n) => String(Number(n) || 0)
    const fmtTime = (t) => {
      if (!t) return '—'
      try { return new Date(t).toLocaleString() } catch (e) { return String(t) }
    }
    const isoSlice = (s) => String(s || '').replace('T', ' ').replace(/\.\d+Z$/, 'Z')

    // ---- 样式（DSH tokens --dsw-alias-* + fallback，参照 dsh-web-relay）----
    const panelStyle = {
      position: 'fixed', top: 60, right: 0, bottom: 0, width: 440,
      zIndex: 2147483000,
      display: 'flex', flexDirection: 'column',
      background: 'var(--dsw-alias-bg-overlay, #18181b)',
      color: 'var(--dsw-alias-label-primary, #e4e4e7)',
      borderLeft: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))',
      boxShadow: '-4px 0 16px rgba(0,0,0,.08)',
      fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5,
      pointerEvents: 'auto' // 规则3：shell.overlay 是 click-through 层
    }
    const panelHeadStyle = {
      flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 10px', borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))'
    }
    const panelFootStyle = {
      flex: '0 0 auto', padding: '6px 10px',
      borderTop: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))',
      fontSize: 11, color: 'var(--dsw-alias-label-secondary, #a1a1aa)'
    }
    const headBtnStyle = {
      background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18))',
      color: 'var(--dsw-alias-label-primary, #e4e4e7)', cursor: 'pointer',
      borderRadius: 6, padding: '3px 8px', fontSize: 12, fontFamily: 'inherit', whiteSpace: 'nowrap'
    }
    const cardStyle = {
      background: 'var(--dsw-alias-bg-layer-1, #18181b)',
      border: '1px solid var(--dsw-alias-border-l1, #3f3f46)',
      borderRadius: 6, padding: 6
    }
    const preStyle = {
      background: 'var(--dsw-alias-bg-layer-1, #101018)',
      border: '1px solid var(--dsw-alias-border-l1, #2a2a35)',
      borderRadius: 6, padding: 6, marginTop: 4,
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      maxHeight: 180, overflow: 'auto', fontSize: 11,
      color: 'var(--dsw-alias-label-primary, #e4e4e7)'
    }
    const hintStyle = { color: 'var(--dsw-alias-label-secondary, #a1a1aa)', fontSize: 11 }

    // ---- 底部栏入口按钮 ----
    const FooterButton = (props) => {
      const [open] = usePanelOpen()
      return h('button', {
        onClick: dispatchToggle,
        title: 'step-value · API 费用看板',
        'aria-label': 'step-value cost dashboard',
        style: {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, borderRadius: 6, border: 'none',
          background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 14
        }
      }, open ? '✕' : '⚡')
    }

    // ---- 右侧停靠面板（shell.overlay）----
    const StepValuePanel = (props) => {
      const [open] = usePanelOpen()
      const [locale, setLocale] = useState(loadLocale)
      const [tree, setTree] = useState(null)            // null = 未加载
      const [summary, setSummary] = useState(null)
      const [reloadTick, setReloadTick] = useState(0)   // 手动刷新计数
      const [loading, setLoading] = useState(false)
      const [error, setError] = useState('')            // '' | 'nodata' | 原始错误信息
      const [expandedWs, setExpandedWs] = useState({})          // wsDir -> bool
      const [selected, setSelected] = useState(null)            // { wsDir, sessionDir } | null
      const [sessionLimits, setSessionLimits] = useState({})    // wsDir -> 会话展示上限
      const [expandedTurns, setExpandedTurns] = useState({})    // 'turn:step' -> bool
      const [details, setDetails] = useState({})                // 'turn:step' -> step-details payload

      // 语言持久化 + 当前字典
      useEffect(() => {
        try { localStorage.setItem(LOCALE_KEY, locale) } catch (e) { /* ignore */ }
      }, [locale])
      const T = STEP_VALUE_I18N[locale] || STEP_VALUE_I18N[STEP_VALUE_I18N_DEFAULT_LOCALE]

      // 打开面板（或手动刷新）时加载 tree + summary
      useEffect(() => {
        if (!open) return
        let cancelled = false
        setLoading(true); setError('')
        const load = async () => {
          try {
            const [tr, sm] = await Promise.all([
              fetch('/step-value/tree').then((r) => (r.ok ? r.json() : null)).catch(() => null),
              fetch('/step-value/summary').then((r) => (r.ok ? r.json() : null)).catch(() => null)
            ])
            if (cancelled) return
            if (tr && tr.ok && Array.isArray(tr.workspaces)) {
              setTree(tr)
              // 首次加载：展开第一个工作区 + 自动选中其第一个会话
              setExpandedWs((p) => {
                if (Object.keys(p).length > 0) return p
                const first = tr.workspaces[0]
                return first ? { [first.dir]: true } : p
              })
              setSelected((prev) => {
                if (prev) return prev
                const ws = tr.workspaces[0]
                const ses = ws && Array.isArray(ws.sessions) ? ws.sessions[0] : null
                return ws && ses ? { wsDir: ws.dir, sessionDir: ses.dir } : null
              })
            }
            if (sm && sm.ok) setSummary(sm)
            if ((!tr || !tr.ok) && (!sm || !sm.ok)) setError('nodata')
          } catch (e) {
            if (!cancelled) setError(String((e && e.message) || e))
          } finally {
            if (!cancelled) setLoading(false)
          }
        }
        load()
        return () => { cancelled = true }
      }, [open, reloadTick])

      const refresh = () => setReloadTick((t) => t + 1)
      const toggleWs = (dir) => setExpandedWs((p) => ({ ...p, [dir]: !p[dir] }))
      const pickSession = (wsDir, sessionDir) => setSelected({ wsDir, sessionDir })

      // 展开/收起 Turn 卡片并惰性加载 step-details
      const turnKey = (t) => (t.turn != null ? t.turn : '?') + ':' + (t.step != null ? t.step : '?')
      const toggleTurn = (t) => {
        const key = turnKey(t)
        const next = !expandedTurns[key]
        setExpandedTurns((p) => ({ ...p, [key]: next }))
        if (next && !details[key] && selected) {
          const params = new URLSearchParams()
          params.set('workspace', selected.wsDir)
          params.set('session', selected.sessionDir)
          params.set('turn', String(t.turn != null ? t.turn : ''))
          if (t.step != null) params.set('step', String(t.step))
          fetch('/step-value/step-details?' + params.toString())
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (d && d.ok && d.turn) setDetails((p) => ({ ...p, [key]: d })) })
            .catch(() => { /* 忽略：保留 loading 占位 */ })
        }
      }

      const workspaces = tree && Array.isArray(tree.workspaces) ? tree.workspaces : []

      // 当前选中会话对象（tree 中查找）
      let currentSession = null
      if (selected) {
        const ws = workspaces.find((w) => w.dir === selected.wsDir)
        if (ws && Array.isArray(ws.sessions)) {
          currentSession = ws.sessions.find((s) => s.dir === selected.sessionDir) || null
        }
      }

      if (!open) return null

      // ---- 左列：总开销卡片 + Workspace → Session 树 ----
      const leftCol = h('div', {
        style: {
          width: '45%', minWidth: 0, boxSizing: 'border-box',
          borderRight: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))',
          overflowY: 'auto', padding: 8
        }
      },
        // 总开销卡片（summary）
        h('div', { style: { ...cardStyle, marginBottom: 8 } },
          h('div', { style: { fontSize: 11, color: '#93c5fd', fontWeight: 600 } }, T.totalCost),
          h('div', { style: { fontSize: 14, fontWeight: 700, color: '#4ade80', marginTop: 2 } },
            '$' + fmtUSD(summary && summary.totalCostUSD) + ' ' + T.currencyUSD),
          h('div', { style: { fontSize: 13, fontWeight: 700, color: '#fbbf24', marginTop: 1 } },
            '¥' + fmtCNY(summary && summary.totalCostCNY) + ' ' + T.currencyCNY),
          h('div', { style: { ...hintStyle, marginTop: 2 } },
            T.workspace + ': ' + fmtInt(summary && summary.workspaces && summary.workspaces.length) +
            ' · ' + T.turnCount + ': ' + fmtInt(summary && summary.totalTurns) +
            ' · ' + T.totalTokens + ': ' + fmtInt(summary && summary.totalTokens && summary.totalTokens.total))
        ),
        // 加载 / 空 / 错误 状态
        loading && h('div', { style: { ...hintStyle, padding: '8px 2px' } }, T.refreshing),
        error && error !== 'nodata' && h('div', {
          style: { ...hintStyle, padding: '8px 2px', color: 'var(--dsw-alias-state-error-primary, #f87171)', wordBreak: 'break-all' }
        }, error),
        error === 'nodata' && h('div', { style: { ...hintStyle, padding: '8px 2px' } }, T.noData),
        !loading && !error && workspaces.length === 0 && h('div', { style: { ...hintStyle, padding: '8px 2px' } }, T.noData),
        // Workspace 列表
        workspaces.map((ws) => {
          const wsOpen = !!expandedWs[ws.dir]
          const sessions = Array.isArray(ws.sessions) ? ws.sessions : []
          const limit = sessionLimits[ws.dir] || 8
          const shown = sessions.slice(0, limit)
          return h('div', { key: ws.dir, style: { marginBottom: 4 } },
            h('div', {
              onClick: () => toggleWs(ws.dir),
              title: (ws.path || ws.dir) + ' — ' + (wsOpen ? T.collapse : T.expand),
              style: {
                cursor: 'pointer', padding: '4px 6px', borderRadius: 6,
                background: 'var(--dsw-alias-bg-layer-1, #18181b)',
                border: '1px solid var(--dsw-alias-border-l1, #3f3f46)'
              }
            },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h('span', { style: { color: '#93c5fd', fontWeight: 600, flex: '0 0 auto' } }, wsOpen ? '▼' : '▶'),
                h('span', { style: { fontWeight: 600, wordBreak: 'break-all', flex: 1 } }, ws.path || ws.dir)
              ),
              h('div', { style: { ...hintStyle, marginTop: 2 } },
                T.sessionCount + ': ' + fmtInt(sessions.length) + ' · ' + T.turnCount + ': ' + fmtInt(ws.turns) +
                ' · $' + fmtUSD(ws.costUSD) + ' · ¥' + fmtCNY(ws.costCNY))
            ),
            wsOpen && h('div', {
              style: {
                marginTop: 2, marginLeft: 10, paddingLeft: 6,
                borderLeft: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))'
              }
            },
              shown.map((s) => {
                const active = selected && selected.wsDir === ws.dir && selected.sessionDir === s.dir
                return h('div', {
                  key: s.dir,
                  onClick: () => pickSession(ws.dir, s.dir),
                  title: s.id || s.dir,
                  style: {
                    cursor: 'pointer', padding: '4px 6px', marginBottom: 2, borderRadius: 4,
                    background: active ? 'var(--dsw-alias-interactive-bg-hover, rgba(59,130,246,.15))' : 'transparent',
                    border: '1px solid ' + (active ? 'var(--dsw-alias-brand-primary, #3b82f6)' : 'transparent')
                  }
                },
                  h('div', {
                    style: {
                      fontWeight: 600, fontSize: 12, wordBreak: 'break-all',
                      color: active ? 'var(--dsw-alias-brand-primary, #3b82f6)' : 'inherit'
                    }
                  }, s.title || s.id || s.dir),
                  h('div', { style: { ...hintStyle, marginTop: 1 } },
                    T.turnCount + ': ' + fmtInt(s.turns) + ' · $' + fmtUSD(s.costUSD) + ' · ¥' + fmtCNY(s.costCNY))
                )
              }),
              sessions.length > limit && h('button', {
                onClick: () => setSessionLimits((p) => ({ ...p, [ws.dir]: (p[ws.dir] || 8) + 8 })),
                style: { ...headBtnStyle, marginTop: 2, width: '100%', padding: '2px 6px', fontSize: 11 }
              }, T.loadMore)
            )
          )
        })
      )

      // ---- 右列：Turn 费用卡片瀑布流（CSS columns）----
      const rightCol = h('div', {
        style: { flex: 1, width: '55%', minWidth: 0, boxSizing: 'border-box', overflowY: 'auto', padding: 8 }
      },
        !currentSession
          ? h('div', { style: { ...hintStyle, padding: '8px 2px' } }, T.noData)
          : h('div', {},
              h('div', { style: { marginBottom: 6, padding: '4px 6px', borderLeft: '3px solid var(--dsw-alias-brand-primary, #3b82f6)' } },
                h('div', { style: { fontWeight: 700, wordBreak: 'break-all' } }, currentSession.title || currentSession.id || currentSession.dir),
                h('div', { style: { ...hintStyle, marginTop: 1 } },
                  T.session + ': ' + (currentSession.id || currentSession.dir) + ' · ' +
                  T.turnCount + ': ' + fmtInt(currentSession.turns) + ' · ' +
                  '$' + fmtUSD(currentSession.costUSD) + ' · ¥' + fmtCNY(currentSession.costCNY))
              ),
              h('div', { style: { columnWidth: 150, columnGap: 8 } },
                (currentSession.turnsList || []).map((t) => {
                  const key = turnKey(t)
                  const openDet = !!expandedTurns[key]
                  const det = details[key]
                  return h('div', {
                    key: key,
                    onClick: () => toggleTurn(t),
                    title: openDet ? T.collapse : T.expand,
                    style: { breakInside: 'avoid', marginBottom: 8, cursor: 'pointer', ...cardStyle }
                  },
                    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 4 } },
                      h('span', { style: { color: '#93c5fd', fontWeight: 700 } },
                        'Turn ' + (t.turn != null ? t.turn : '?') + ' · Step ' + (t.step != null ? t.step : '?')),
                      h('span', { style: { color: 'var(--dsw-alias-label-secondary, #a1a1aa)' } }, openDet ? '▲' : '▼')
                    ),
                    h('div', { style: { marginTop: 4, fontSize: 12 } },
                      h('div', {}, T.model + ': ' + (t.model || 'unknown')),
                      h('div', {}, T.provider + ': ' + (t.provider || '—')),
                      h('div', { style: hintStyle }, fmtTime(t.time)),
                      h('div', { style: { ...hintStyle, marginTop: 2, wordBreak: 'break-word' } },
                        T.inputTokens + ' ' + fmtInt(t.tokens && t.tokens.input) + ' · ' +
                        T.outputTokens + ' ' + fmtInt(t.tokens && t.tokens.output) + ' · ' +
                        T.cacheTokens + ' ' + fmtInt(t.tokens && t.tokens.cacheRead) + ' · ' +
                        T.reasoningTokens + ' ' + fmtInt(t.tokens && t.tokens.reasoning) + ' · ' +
                        T.totalTokens + ' ' + fmtInt(t.tokens && t.tokens.total)
                      ),
                      h('div', {
                        style: { marginTop: 4, fontWeight: 700, color: '#4ade80', wordBreak: 'break-word' },
                        title: T.costPerTurn
                      }, T.turnCost + ': $' + fmtUSD(t.costUSD) + ' · ¥' + fmtCNY(t.costCNY))
                    ),
                    openDet && h('div', { style: { marginTop: 4 } },
                      h('div', { style: { fontSize: 11, color: '#a78bfa', fontWeight: 600 } },
                        T.turn + ': ' + (t.turn != null ? t.turn : '—') + ' · ' + T.taskStep + ': ' + (t.step != null ? t.step : '—')),
                      det && det.turn && h('div', {},
                        h('div', { style: { fontSize: 11, color: '#a78bfa', fontWeight: 600, marginTop: 4 } }, 'usageRaw'),
                        h('div', { style: preStyle }, JSON.stringify(det.turn.usageRaw, null, 2)),
                        h('div', { style: { fontSize: 11, color: '#a78bfa', fontWeight: 600, marginTop: 4 } }, 'sourceRaw'),
                        h('div', { style: preStyle }, JSON.stringify(det.turn.sourceRaw, null, 2))
                      ),
                      !det && h('div', { style: { ...hintStyle, marginTop: 2 } }, T.refreshing)
                    )
                  )
                })
              )
            )
      )

      // ---- 面板根 ----
      return h('div', { style: panelStyle },
        h('div', { style: panelHeadStyle },
          h('span', {
            style: { fontWeight: 700, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
          }, T.pluginTitle),
          h('button', { onClick: refresh, title: T.refreshing, style: headBtnStyle }, '↻'),
          h('button', {
            onClick: () => setLocale((l) => (l === 'zh' ? 'en' : 'zh')),
            title: locale === 'zh' ? 'Switch to English' : '切换到中文',
            style: headBtnStyle
          }, locale === 'zh' ? 'EN' : '中'),
          h('button', { onClick: dispatchToggle, title: T.collapse, style: headBtnStyle }, '✕')
        ),
        h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'row' } },
          leftCol,
          rightCol
        ),
        h('div', { style: panelFootStyle },
          h('div', {}, T.apiTurnLabel + ' · ' + T.taskStepLabel),
          h('div', {}, T.modelRate + ': ' + T.usdPer1k),
          summary && summary.generatedAt && h('div', {}, T.updatedAt + ': ' + isoSlice(summary.generatedAt))
        )
      )
    }

    // ---- 规则5：slot 注册 ----
    const apply = (ctx) => {
      const slots = ctx.get('slots')
      slots.inject('sidebar.footer.action', () =>
        slots.register({ name: 'sidebar.footer.action', id: 'step-value', order: 130 }, FooterButton)
      )
      slots.inject('shell.overlay', () =>
        slots.register({ name: 'shell.overlay', id: 'step-value-panel', order: 130 }, StepValuePanel)
      )
    }

    exports.inject = ['slots']
    exports.apply = apply
    // 暴露 i18n 字典供冒烟测试校验（zh/en 各 29 键）；运行时无副作用
    exports.i18n = STEP_VALUE_I18N
    exports.i18nDefaultLocale = STEP_VALUE_I18N_DEFAULT_LOCALE
    return module.exports
  }
})
