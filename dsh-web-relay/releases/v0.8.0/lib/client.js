window.__ModuleLoader__.load({
  id: 'dsh-web-relay',
  factory: (require) => {
    // 规则1：browser bundle 无 Node module/exports，必须自备
    var module = { exports: {} }; var exports = module.exports;

    // 规则2：只用小写闭包绑定 react
    const react = require('react')
    const { useState, useEffect, useRef } = react
    const h = react.createElement

    // ---- 规则4：跨组件状态用 window CustomEvent ----
    const PANEL_EVENT = 'dsh-web-relay:panel-toggle'
    const dispatchToggle = () => {
      window.dispatchEvent(new CustomEvent(PANEL_EVENT, { detail: { ts: Date.now() } }))
    }
    const usePanelOpen = () => {
      const [open, setOpen] = useState(false)
      useEffect(() => {
        const on = () => setOpen((v) => !v)
        window.addEventListener(PANEL_EVENT, on)
        return () => window.removeEventListener(PANEL_EVENT, on)
      }, [])
      return [open, setOpen]
    }

    // ---- 真实 state 形状：WorkspaceListState = { items, recentWorkspaceId }；WorkspaceView = { workspaceId, path, ... } ----
    const recentWorkspacePath = (ws) => {
      const items = ws?.items
      if (!Array.isArray(items)) return null
      const target = ws.recentWorkspaceId
      const item = target != null ? items.find((w) => w?.workspaceId === target) : items[0]
      return item?.path ?? null
    }

    // ---- 样式（v0.6 平铺布局：与 DSH 页面左右平铺 + 可拖动分割条，tokens 跟随宿主）----
    const SPLITTER_WIDTH = 5
    const PANEL_STORAGE_KEY = 'dsh-web-relay:panel-width'
    const DEFAULT_PANEL_WIDTH = 360
    const MIN_PANEL_WIDTH = 320
    const MAX_PANEL_RATIO = 0.5

    const loadPanelWidth = () => {
      try {
        const raw = Number(localStorage.getItem(PANEL_STORAGE_KEY))
        if (Number.isFinite(raw) && raw > 0) return raw
      } catch (e) { /* ignore */ }
      return DEFAULT_PANEL_WIDTH
    }
    const savePanelWidth = (w) => {
      try { localStorage.setItem(PANEL_STORAGE_KEY, String(w)) } catch (e) { /* ignore */ }
    }

    // 平铺布局核心：html[data-dwr-docked] 时 body padding-right 让 DSH 主页面让出空间，
    // 面板与主页面左右平铺；分割条与折叠 rail 用 DSH tokens（--dsw-alias-*）+ fallback。
    const DOCK_CSS = '' +
      'html[data-dwr-docked]{--dwr-splitter-width:5px}' +
      'html[data-dwr-docked],html[data-dwr-docked] body{overflow-x:hidden}' +
      'html[data-dwr-docked] body{padding-right:calc(var(--dwr-panel-width) + var(--dwr-splitter-width)) !important;box-sizing:border-box}' +
      '.dwr-splitter{position:fixed;top:60px;bottom:0;width:5px;cursor:col-resize;z-index:2147483001;touch-action:none;user-select:none}' +
      '.dwr-splitter::after{content:"";position:absolute;left:1px;top:50%;transform:translateY(-50%);width:3px;height:24px;border-radius:2px;background:var(--dsw-alias-border-l1,rgba(0,0,0,.15));transition:background .15s ease}' +
      '.dwr-splitter:hover::after,.dwr-splitter.dwr-dragging::after{background:var(--dsw-alias-brand-primary,#3b82f6)}' +
      '.dwr-rail{position:fixed;top:60px;right:0;bottom:0;width:28px;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-overlay,#18181b);border-left:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));cursor:pointer;z-index:2147483000}' +
      '.dwr-ghost:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}'

    const panelStyle = {
      position: 'fixed', top: 60, right: 0, bottom: 0, zIndex: 2147483000,
      width: 'var(--dwr-panel-width, 360px)',
      display: 'flex', flexDirection: 'column',
      background: 'var(--dsw-alias-bg-overlay, #18181b)', color: 'var(--dsw-alias-label-primary, #e4e4e7)',
      borderLeft: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))',
      boxShadow: '-4px 0 16px rgba(0,0,0,.08)',
      fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5,
      pointerEvents: 'auto',   // 规则3：shell.overlay 是 click-through 层
      transition: 'width .15s ease'
    }
    const panelBodyStyle = { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: 12 }
    const panelFootStyle = { flex: '0 0 auto', padding: '10px 12px', borderTop: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }
    const inputStyle = {
      width: '100%', boxSizing: 'border-box', margin: '6px 0',
      background: 'var(--dsw-alias-bg-layer-2, #18181b)', color: 'var(--dsw-alias-label-primary, #e4e4e7)',
      border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.15))',
      borderRadius: 8, padding: '6px 8px', fontFamily: 'inherit', fontSize: 13, resize: 'vertical'
    }
    const btnStyle = {
      padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
      background: 'var(--dsw-alias-brand-primary, #3b82f6)', color: 'var(--dsw-alias-label-primary-foreground, #fff)', fontSize: 13
    }
    // 幽灵/次级按钮：透明背景 + 细边框，hover 浅色（DOCK_CSS .dwr-ghost:hover）
    const btnGhostStyle = {
      ...btnStyle,
      background: 'transparent',
      border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18))',
      color: 'var(--dsw-alias-label-primary, #e4e4e7)'
    }
    // 语义色幽灵（状态性操作保留可读的语义色文字，收敛大面积撞色）
    const ghostGreen = { ...btnGhostStyle, color: 'var(--dsw-alias-state-success-primary, #4ade80)', borderColor: 'var(--dsw-alias-state-success-primary, rgba(74,222,128,.45))' }
    const ghostRed = { ...btnGhostStyle, color: 'var(--dsw-alias-state-error-primary, #f87171)', borderColor: 'var(--dsw-alias-state-error-primary, rgba(248,113,113,.45))' }
    const ghostPurple = { ...btnGhostStyle, color: '#a78bfa', borderColor: 'rgba(167,139,250,.45)' }
    const btnWarnStyle = { ...btnStyle, background: 'var(--dsw-alias-state-error-primary, #dc2626)', color: '#fff' }
    const hintStyle = { color: 'var(--dsw-alias-label-secondary, #a1a1aa)', fontSize: 12, margin: '4px 0' }
    const warnStyle = { color: 'var(--dsw-alias-state-warn-primary, #fbbf24)', fontSize: 12, margin: '4px 0' }
    const savedStyle = { color: '#4ade80', fontSize: 12, wordBreak: 'break-all', marginTop: 6 }
    const preStyle = {
      background: 'var(--dsw-alias-bg-layer-1, #18181b)', border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.15))', borderRadius: 8,
      padding: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflow: 'auto'
    }
    const riskColor = (risk) =>
      risk === 'low' ? '#4ade80' : risk === 'medium' ? '#fbbf24' : '#f87171'
    const riskLabel = (risk) =>
      risk === 'low' ? '低风险' : risk === 'medium' ? '中风险' : '高风险'
    const typeLabel = (t) =>
      t === 'write_file' ? '写入文件' : t === 'run_cmd' ? '执行命令' : t === 'plan' ? '计划任务' : t === 'wake_agent' ? '唤醒主 Agent' : '无效指令'

    // ---- v0.5: web-relay three-party roles (用户 / 主 agent / 外部AI) ----
    const ROLE_LABEL = { user: '用户', mainagent: '主 agent', external: '外部AI' }
    const ROLE_COLOR = { user: '#3b82f6', mainagent: '#f59e0b', external: '#a855f7' }
      const summarizeTrace = (t) => {
        const entries = t && Array.isArray(t.entries) ? t.entries : []
        const userEntry = entries.find((e) => e.role === 'user')
        const mainAgentEntries = entries.filter((e) => e.role === 'mainagent')
        const externalEntries = entries.filter((e) => e.role === 'external')
        const approvedCount = entries.filter((e) => /通过|approved/i.test(e.text || '')).length
        const rejectedCount = entries.filter((e) => /打回|rejected/i.test(e.text || '')).length
        const last = entries[entries.length - 1]
        return {
          userTask: (userEntry && userEntry.text ? userEntry.text : '(无用户任务)').replace(/\s+/g, ' ').slice(0, 120),
          overview: `主 agent ${mainAgentEntries.length} 条 · 外部AI ${externalEntries.length} 条 · 通过 ${approvedCount} 次 · 打回 ${rejectedCount} 次`,
          result: (last && last.text ? last.text : '(暂无成果摘要)').replace(/\s+/g, ' ').slice(0, 200)
        }
      }

    const tabBtnStyle = {
      background: 'transparent', border: 'none', cursor: 'pointer',
      padding: '4px 2px', marginRight: 16, fontSize: 13,
      color: 'var(--dsw-alias-label-secondary, #a1a1aa)',
      borderBottom: '2px solid transparent',
      fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'color .15s ease, border-color .15s ease'
    }
    const tabActiveStyle = {
      ...tabBtnStyle,
      color: 'var(--dsw-alias-brand-primary, #3b82f6)',
      borderBottom: '2px solid var(--dsw-alias-brand-primary, #3b82f6)',
      fontWeight: 600
    }

    // ---- footer 按钮 ----
    const FooterButton = (props) => {
      const [open] = usePanelOpen()
      return h('button', {
        onClick: dispatchToggle,
        title: 'dsh-web-relay: 外部AI协作平台（Gemini / 手动粘贴 / 指令执行）',
        'aria-label': 'dsh-web-relay external AI collaboration platform',
        style: {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, borderRadius: 6, border: 'none',
          background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 14
        }
      }, open ? '✕' : '⇄')
    }

    // ---- overlay 面板 ----
    const RelayPanel = (props) => {
      const [open] = usePanelOpen()
      const [provider, setProvider] = useState('manual')
      const [prompt, setPrompt] = useState('')
      const [pasted, setPasted] = useState('')
      const [sending, setSending] = useState(false)
      const [answer, setAnswer] = useState('')
      const [savedPath, setSavedPath] = useState('')
      const [error, setError] = useState('')
      const [config, setConfig] = useState(null)
      const [contextRecords, setContextRecords] = useState(null)
      const [contextText, setContextText] = useState('')
      const [contextCopied, setContextCopied] = useState(false)
      const [showContextPreview, setShowContextPreview] = useState(false)
      // v0.3: instruction preview state
      const [actions, setActions] = useState(null)       // parsed actions or null (not parsed yet)
      const [checks, setChecks] = useState({})           // { index: boolean }
      const [expanded, setExpanded] = useState({})       // { index: boolean }
      const [needsAgent, setNeedsAgent] = useState(null) // { reason, agentWoken, wakeReason, handoffText }
      const [execResults, setExecResults] = useState(null)
      const [phase, setPhase] = useState('input')        // input | parsing | preview | working | done
      const [hover, setHover] = useState(false)          // v0.4.1: hover transparency (0.92 -> 1)
      // v0.5: drag + collapse (Step 2/3)
      const [pos, setPos] = useState({ top: null, left: null }) // null = use CSS top/right defaults
      const [collapsed, setCollapsed] = useState(false)
      const dragRef = useRef(null) // { startX, startY, origTop, origLeft, moved }
      // v0.6: docked sidebar + splitter (布局方案：面板宽度 320px ~ 50% 视口，localStorage 持久化)
      const [panelWidth, setPanelWidth] = useState(() => {
        const stored = loadPanelWidth()
        const maxWidth = Math.max(MIN_PANEL_WIDTH, Math.floor(window.innerWidth * MAX_PANEL_RATIO))
        return Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, stored))
      })
      const [splitterDragging, setSplitterDragging] = useState(false)
      // v0.5 (record-domain independence): tab = experiment form | three-party trace page
      const [tab, setTab] = useState('main') // 'main' | 'trace'
      const [traces, setTraces] = useState(null)
      const [traceError, setTraceError] = useState('')
      const [traceLoading, setTraceLoading] = useState(false)
      const [expandedTrace, setExpandedTrace] = useState({}) // id -> bool
      const [traceRecord, setTraceRecord] = useState({})     // id -> record text
        const [traceOrder, setTraceOrder] = useState('asc') // 'asc' 正序时间线 | 'desc' 最新优先
      // v0.5.1 Step 2: protocol auto-mount — fetched on panel open (covers new
      // sessions), shown as a quiet version line + collapsible full text.
      const [protocol, setProtocol] = useState(null)
      const [showProtocol, setShowProtocol] = useState(false)
      // v0.5.2 Step 2: rule-8 payload guardrail state
      const [showGuard, setShowGuard] = useState(false)
        // v1.4: architect planning mode toggle
        const [architectMode, setArchitectMode] = useState(false)
        // v1.3: Step List execution + external-AI review
        const [exprId, setExprId] = useState('')
        const [steps, setSteps] = useState(null)
        const [stepState, setStepState] = useState(null)
        const [stepBusy, setStepBusy] = useState(false)
        const [stepComment, setStepComment] = useState('')
        const [stepLoadId, setStepLoadId] = useState('')


      const workspacePath = props.useWorkspaces ? props.useWorkspaces(recentWorkspacePath) : null
      // sessionId: the RAW value of useSessions((st) => st.current) — a SessionId string, not an object.
      let sessionId = ''
      try {
        sessionId = props && props.useSessions
          ? props.useSessions((st) => st.current) || ''
          : ''
      } catch (err) { sessionId = '' }

      // Step 2: auto-mount the three-party protocol every time the panel opens,
      // so a new session/workspace never degrades to a plain chat AI.
      useEffect(() => {
        if (!open) return
        let cancelled = false
        fetch('/dsh-web-relay/protocol')
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => { if (!cancelled && d && d.ok) setProtocol({ version: d.version, text: d.text }) })
          .catch(() => { /* fallback: packContext re-fetches */ })
        return () => { cancelled = true }
      }, [open])

      useEffect(() => {
        fetch('/dsh-web-relay/status')
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => setConfig(d))
          .catch(() => setConfig({ ok: false, geminiConfigured: false }))
      }, [])

      // reset preview when the pasted text changes
      useEffect(() => {
        setActions(null); setChecks({}); setNeedsAgent(null); setExecResults(null)
          setSteps(null); setStepState(null); setExprId(''); setStepComment('')
        setPhase('input')
      }, [pasted, provider])

        // v1.3: when an exprId is known, load the authoritative Step List state
        // from the server so the panel reflects persisted statuses (e.g. review).
        useEffect(() => {
          if (!open || !exprId) return
          let cancelled = false
          fetch('/dsh-web-relay/steps?cwd=' + encodeURIComponent(workspacePath || '') + '&id=' + encodeURIComponent(exprId))
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              if (cancelled || !data || !data.ok || !Array.isArray(data.steps)) return
              setSteps(data.steps)
              setStepState(data)
            })
            .catch(() => {})
          return () => { cancelled = true }
        }, [open, exprId, workspacePath])

        // v1.3: when no exprId is known yet, auto-load the latest Step List state
        // from the workspace context so reopening the panel shows persisted statuses.
        useEffect(() => {
          if (!open || exprId) return
          let cancelled = false
          fetch('/dsh-web-relay/context?cwd=' + encodeURIComponent(workspacePath || ''))
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              if (cancelled || !data || !data.ok || !Array.isArray(data.stepStates) || data.stepStates.length === 0) return
              const latest = data.stepStates[0]
              if (!latest || !Array.isArray(latest.steps)) return
              setExprId(latest.exprId || '')
              setSteps(latest.steps)
              setStepState(latest)
            })
            .catch(() => {})
          return () => { cancelled = true }
        }, [open, exprId, workspacePath])



      // ---- v0.5.2 Step 2: rule-8 payload guardrail ----
      // Detect "a solution without a json:agent-action payload" and offer
      // one-click wrapping. Never pops for pure questions or texts that
      // already carry a payload. Purely a format aid — ignorable.
      const SOLUTION_WORDS = ['实现', '方案', '步骤', '修改', '需要执行', '落地', '改造', '升级', '新增']
      const guardHint = '这是格式辅助提示，可忽略，不影响保存。'
      useEffect(() => {
        if (provider !== 'manual' || !pasted.trim()) { setShowGuard(false); return }
        const hasPayload = /```json:agent-action|"action"\s*:\s*"wake_agent"/.test(pasted)
        const hasSolution = SOLUTION_WORDS.some((w) => pasted.includes(w))
        setShowGuard(!hasPayload && hasSolution)
      }, [pasted, provider])

      // One-click wrap: append a wake_agent payload (format only, no write_file
      // auto-actions). context is a pointer, not the full carrier — the full
      // text lives in the record; the reason tells the main agent what/where.
      const wrapPayload = () => {
        const body = pasted.trim()
        const contextText = body.slice(0, 1500)
        const wrapped = body + '\n\n```json:agent-action\n' +
          JSON.stringify([{
            action: 'wake_agent',
            reason: '复杂任务，请主 agent 按规则 8 接管（含方案但缺 Payload，已由护栏补全格式）',
            targetWorkspace: workspacePath || '',
            context: contextText
          }], null, 2) + '\n```'
        setPasted(wrapped)
        setShowGuard(false)
      }

      const packContext = async () => {
        setContextCopied(false); setContextText(''); setContextRecords(null)
        try {
          const resp = await fetch('/dsh-web-relay/context?cwd=' + encodeURIComponent(workspacePath || ''))
          const data = await resp.json().catch(() => ({ ok: false, error: 'bad response' }))
          if (!data.ok) { setError(data.error || 'context fetch failed'); return }
          setContextRecords(data.records || [])
          // Step 1 hardening: /context now returns protocol as a top-level field
          // (never mixed into records/traces); use it directly, fall back to the
          // protocol state fetched at panel open, then to a local default.
          let protocolText = ''
          if (data.protocol && data.protocol.text) {
            protocolText = data.protocol.text
          } else if (protocol && protocol.text) {
            protocolText = protocol.text
          }
          if (!protocolText) {
            protocolText = '三方主体（web-relay 语境）：用户 (the human) / 主 agent (the tool-using agent in the main harness session，负责执行与收口) / 外部AI (external web AI — Gemini/DeepSeek 网页版或 free API，负责提供方案与回答)。试验记录在 web-relay/experiments/，三方轨迹在 web-relay/traces/。复杂任务需输出 json:agent-action + 结构化 steps，主 agent 逐步执行并由外部 AI 审核。（/dsh-web-relay/protocol 不可用时的兜底文本）'
          }
          const lines = [
            '【三方协作机制（web-relay 语境，每次回答都必须遵循）】',
            ...protocolText.split('\n'),
            '',
            '【外部 AI Skill：web_relay_external_ai_protocol（本协议的细化执行规范，必须遵循）】',
            ...(data.skill && data.skill.text ? data.skill.text.split('\n') : []),
            '',
            '【项目上下文】',
            'workspace: ' + (workspacePath || '(未知)'),
            '最近试验:'
          ]
          for (const r of (data.records || [])) {
            lines.push('  - ' + r.id + ' [' + r.intent + '/' + r.status + '] ' + r.snippet)
          }
          if (data.traces && data.traces.length > 0) {
            lines.push('', '【三方轨迹（最近 ' + data.traces.length + ' 条，web-relay 语境）】')
              const sortedTraces = (data.traces || []).slice().sort((a, b) => (a.created || '').localeCompare(b.created || ''))
              if (sortedTraces.length > 1) sortedTraces.unshift(sortedTraces.pop())
              lines.push('排序说明：最新一条协作记录已置顶；其余按时间正序排列。请优先关注最上方的最新内容，再回溯历史。')
            for (const t of sortedTraces) {
              lines.push('### ' + t.id)
              for (const e of (t.entries || [])) {
                lines.push((ROLE_LABEL[e.role] || e.role) + ': ' + String(e.text || '').replace(/\s+/g, ' ').slice(0, 300))
              }
            }
          }
            if (data.stepStates && data.stepStates.length > 0) {
              lines.push('', '【Step List 状态（最近记录）】')
              for (const st of data.stepStates) {
                lines.push('### ' + st.exprId + ' · ' + (st.status || 'open'))
                for (const s of (st.steps || [])) {
                  lines.push('  - Step ' + s.id + ' [' + (s.status || 'pending') + '] ' + s.title + (s.acceptance ? ' · 验收: ' + s.acceptance : ''))
                }
              }
            }

          lines.push('', '【我要提问】', prompt || '(未填写，可留空后自行补充)')
          const text = lines.join('\n')
          setContextText(text)
          try {
            await navigator.clipboard.writeText(text)
            setContextCopied(true)
          } catch (e) {
            setContextCopied(false)
          }
          setShowContextPreview(true)
        } catch (e) { setError(String(e?.message || e)) }
      }

      // ---- v0.5: three-party trace page ----
      const loadTraces = async () => {
        setTraceLoading(true); setTraceError('')
        try {
          const resp = await fetch('/dsh-web-relay/traces?cwd=' + encodeURIComponent(workspacePath || ''))
          const data = await resp.json().catch(() => ({ ok: false, error: 'bad response' }))
          if (!data.ok) { setTraceError(data.error || 'traces fetch failed'); return }
          setTraces(data.traces || [])
        } catch (e) { setTraceError(String(e?.message || e)) }
        finally { setTraceLoading(false) }
      }

      const expandRecord = async (id) => {
        const next = { ...expandedTrace, [id]: !expandedTrace[id] }
        setExpandedTrace(next)
        if (next[id] && !traceRecord[id]) {
          try {
            const resp = await fetch('/dsh-web-relay/record?cwd=' + encodeURIComponent(workspacePath || '') + '&id=' + encodeURIComponent(id))
            const data = await resp.json().catch(() => null)
            if (data && data.ok && data.record) setTraceRecord((r) => ({ ...r, [id]: data.record.text }))
            else setTraceError('试验记录读取失败')
          } catch (e) { setTraceError(String(e?.message || e)) }
        }
      }

      // load the trace page on first visit
      useEffect(() => {
        if (tab === 'trace' && traces === null) loadTraces()
      }, [tab])

      // manual: submit → parse → preview (or plain save when no instructions)
      const submitManual = async () => {
        if (!pasted.trim()) { setError('manual 模式需要粘贴回答'); return }
        setError(''); setSending(true); setPhase('parsing'); setAnswer(''); setSavedPath('')
        try {
          const resp = await fetch('/dsh-web-relay/parse', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: pasted, workspacePath })
          })
          const data = await resp.json().catch(() => ({ ok: false, error: 'bad response' }))
          if (!data.ok) { setError(data.error || 'parse failed'); setPhase('input'); return }
          const acts = data.actions || []
          setNeedsAgent(data.needsAgent || null)
            setSteps(data.steps || [])
            setStepState(data.steps && data.steps.length > 0 ? { phase: 'executing', steps: data.steps, autoReview: false } : null)
          if (acts.length === 0) {
            // no instructions → plain save (status pending)
            await plainSave()
            return
          }
          setActions(acts)
          const chk = {}
          for (const a of acts) chk[a.index] = !!a.checked
          setChecks(chk)
          setPhase('preview')
        } catch (e) { setError(String(e?.message || e)); setPhase('input') }
        finally { setSending(false) }
      }

      // plain save without executing anything (no instructions found)
      const plainSave = async () => {
        try {
          const resp = await fetch('/dsh-web-relay/ask', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: 'manual', prompt, answer: pasted, workspacePath })
          })
          const data = await resp.json().catch(() => ({ ok: false, error: 'bad response' }))
          if (!data.ok) { setError(data.error || 'request failed'); return }
          setAnswer(data.answer || '')
          setSavedPath(data.savedPath || '')
            setExprId(data.id || '')
          setPhase('done')
        } catch (e) { setError(String(e?.message || e)) }
        finally { setSending(false) }
      }

      // execute: save-only (indices=[]) or execute selected indices
      const execute = async (indices) => {
        setSending(true); setError(''); setExecResults(null); setNeedsAgent(null); setPhase('working')
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 75000) // > run_cmd cap (60s)
        try {
          const resp = await fetch('/dsh-web-relay/execute', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              text: pasted,
              indices,
              workspacePath,
              prompt,
              sessionId
            }),
            signal: controller.signal
          })
          const data = await resp.json().catch(() => ({ ok: false, error: 'bad response' }))
          if (!data.ok) { setError(data.error || 'execute failed'); setPhase('preview'); return }
          setExecResults(data.results || [])
          setSavedPath(data.recordPath || '')
          if (data.needsAgent) setNeedsAgent(data.needsAgent)
            setExprId(data.id || '')
            setSteps(data.steps || [])
            setStepState(data.stepState || null)
          setPhase('done')
        } catch (e) {
          setError('执行超时或失败: ' + String(e?.message || e))
          setPhase('preview')
        } finally {
          clearTimeout(timer)
          setSending(false)
        }
      }

        // v1.3: update Step List state (start / complete / approve / reject / reopen)
        const callStepUpdate = async (stepId, action, commentText) => {
          if (!exprId) { setError('缺少 exprId，请先执行保存/执行'); return }
          setStepBusy(true); setError('')
          try {
            const role = (action === 'approve' || action === 'reject') ? 'external' : 'mainagent'
            const resp = await fetch('/dsh-web-relay/steps/update', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ workspacePath, exprId, stepId, action, comment: commentText || '', role, sessionId })
            })
            const data = await resp.json().catch(() => ({ ok: false, error: 'bad response' }))
            if (!data.ok) { setError(data.error || 'step update failed'); return }
            setStepState(data.stepState || null)
            if (data.stepState && Array.isArray(data.stepState.steps)) setSteps(data.stepState.steps)
            if (data.stepState && data.stepState.autoReview && action === 'complete') {
              setTimeout(() => autoReviewStep(stepId), 300)
            }
            if (data.wake && !data.wake.agentWoken) {
              setError('状态已更新，但未能自动唤醒主 agent：' + (data.wake.reason || '未知原因'))
            }
            setStepComment('')
          } catch (e) { setError(String(e?.message || e)) }
          finally { setStepBusy(false) }
        }

        // v1.3 auto-review: ask the server to call the configured external AI.
        const autoReviewStep = async (stepId) => {
          if (!exprId) { setError('缺少 exprId，请先执行保存/执行'); return }
          setStepBusy(true); setError('')
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 30000)
          try {
            const resp = await fetch('/dsh-web-relay/steps/auto-review', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ workspacePath, exprId, stepId, sessionId })
                ,
                signal: controller.signal
            })
            const data = await resp.json().catch(() => ({ ok: false, error: 'bad response' }))
            if (!data.ok) {
                const errText = data.error || 'auto review failed'
                setError(/429|RESOURCE_EXHAUSTED|quota|limit/i.test(errText) ? 'Gemini 限流，请稍后重试：' + errText : errText)
                return
              }
            setStepState(data.stepState || null)
            if (data.stepState && Array.isArray(data.stepState.steps)) setSteps(data.stepState.steps)
            if (data.wake && !data.wake.agentWoken) {
              setError('自动审核完成，但未能自动唤醒主 agent：' + (data.wake.reason || '未知原因'))
            }
          } catch (e) { setError(String(e?.message || e)) }
          finally { setStepBusy(false) }
        }

        // v1.3: user can stop the experiment; subsequent steps are blocked.
        const stopExperiment = async () => {
          if (!exprId) return
          const stepId = (stepState && stepState.currentStep) || (steps && steps[0] && steps[0].id)
          if (!stepId) return
          await callStepUpdate(stepId, 'stop', '用户手动叫停')
        }

        // v1.3: resume a stopped experiment so steps can continue.
        const resumeExperiment = async () => {
          if (!exprId) return
          const stepId = (stepState && stepState.currentStep) || (steps && steps[0] && steps[0].id)
          if (!stepId) return
          await callStepUpdate(stepId, 'resume', '用户恢复执行')
        }

        // v1.3: toggle auto-review mode for the current experiment.
        const toggleAutoReview = async () => {
          if (!exprId) return
          const stepId = (stepState && stepState.currentStep) || (steps && steps[0] && steps[0].id)
          if (!stepId) return
          const next = !(stepState && stepState.autoReview)
          setStepBusy(true); setError('')
          try {
            const resp = await fetch('/dsh-web-relay/steps/update', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ workspacePath, exprId, stepId, action: 'set_auto_review', autoReview: next, role: 'user', sessionId })
            })
            const data = await resp.json().catch(() => ({ ok: false, error: 'bad response' }))
            if (!data.ok) { setError(data.error || 'toggle auto review failed'); return }
            setStepState(data.stepState || null)
            if (data.stepState && Array.isArray(data.stepState.steps)) setSteps(data.stepState.steps)
            if (next && data.stepState && Array.isArray(data.stepState.steps)) {
              const reviewStep = data.stepState.steps.find((s) => s.status === 'review')
              if (reviewStep) setTimeout(() => autoReviewStep(reviewStep.id), 300)
            }
          } catch (e) { setError(String(e?.message || e)) }
          finally { setStepBusy(false) }
        }

        // v1.4: switch phase, e.g. planning -> executing.
        const setExperimentPhase = async (nextPhase) => {
          if (!exprId) return
          const stepId = (stepState && stepState.currentStep) || (steps && steps[0] && steps[0].id)
          if (!stepId) return
          setStepBusy(true); setError('')
          try {
            const resp = await fetch('/dsh-web-relay/steps/update', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ workspacePath, exprId, stepId, action: 'set_phase', phase: nextPhase, role: 'user', sessionId })
            })
            const data = await resp.json().catch(() => ({ ok: false, error: 'bad response' }))
            if (!data.ok) { setError(data.error || 'set phase failed'); return }
            setStepState(data.stepState || null)
            if (data.stepState && Array.isArray(data.stepState.steps)) setSteps(data.stepState.steps)
          } catch (e) { setError(String(e?.message || e)) }
          finally { setStepBusy(false) }
        }






        // v1.3: load an existing Step List state by expr id (useful when reopening
        // an already persisted experiment from the panel).
        const loadStepState = async (id) => {
          const target = (id || exprId || '').trim()
          if (!target) { setError('请输入 expr id'); return }
          setStepBusy(true); setError('')
          try {
            const resp = await fetch('/dsh-web-relay/steps?cwd=' + encodeURIComponent(workspacePath || '') + '&id=' + encodeURIComponent(target))
            const data = await resp.json().catch(() => ({ ok: false, error: 'bad response' }))
            if (!data.ok || !Array.isArray(data.steps)) { setError((data && data.error) || '未找到 Step List 状态'); return }
            setExprId(target)
            setSteps(data.steps)
            setStepState(data)
            setStepLoadId('')
          } catch (e) { setError(String(e?.message || e)) }
          finally { setStepBusy(false) }
        }

        // v1.3: refresh the current Step List state from the server.
        const refreshStepState = async () => {
          if (!exprId) return
          try {
            const resp = await fetch('/dsh-web-relay/steps?cwd=' + encodeURIComponent(workspacePath || '') + '&id=' + encodeURIComponent(exprId))
            const data = await resp.json().catch(() => ({ ok: false, error: 'bad response' }))
            if (!data || !data.ok || !Array.isArray(data.steps)) return
            setSteps(data.steps)
            setStepState(data)
          } catch (e) { /* silent refresh failure */ }
        }

        // v1.3: poll the authoritative Step List state while the panel is open so
        // external status changes (auto-review, other panels, server updates) are
        // reflected without reopening the panel.
        useEffect(() => {
          if (!open || !exprId) return
          const timer = setInterval(() => { refreshStepState() }, 5000)
          return () => clearInterval(timer)
        }, [open, exprId, workspacePath])





      // gemini-free: plain question (no instruction flow in this version)
      const submitGemini = async () => {
        if (!prompt.trim()) { setError('请填写提问内容'); return }
        setError(''); setSending(true); setAnswer(''); setSavedPath(''); setPhase('working')
        try {
          const resp = await fetch('/dsh-web-relay/ask', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: 'gemini-free', prompt: architectMode ? '[MODE: ARCHITECT_PLANNING_v1.4]\n' + prompt : prompt, answer: '', workspacePath, sessionId })
          })
          const data = await resp.json().catch(() => ({ ok: false, error: 'bad response' }))
          if (!data.ok) { setError(data.error || 'request failed'); return }
          setAnswer(data.answer || '')
          setSavedPath(data.savedPath || '')
            setExprId(data.id || '')
            setSteps(data.steps || [])
            setStepState(null)
            if (data.handoffText && !data.agentWoken) {
              setError('已生成 handoff，但未能自动唤醒主 agent：' + (data.wakeReason || '未知原因'))
            }
          setPhase('done')
        } catch (e) { setError(String(e?.message || e)) }
        finally { setSending(false) }
      }

      const copyHandoff = async (text) => {
        try {
          await navigator.clipboard.writeText(text)
          setError('')
        } catch (e) {
          setError('剪贴板不可用，请手动复制下方文本')
        }
      }

      // ---- v0.5 Step 2: header drag ----
      // mousedown on header starts a potential drag; real drag only begins after
      // 3px movement (so clicks on header buttons still work). mousemove/mouseup
      // are window-scoped and removed on mouseup.
      useEffect(() => {
        const onMove = (e) => {
          const d = dragRef.current
          if (!d) return
          if (!d.moved) {
            const dx = e.clientX - d.startX
            const dy = e.clientY - d.startY
            if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return
            d.moved = true
          }
          const curTop = d.origTop
          const curLeft = d.origLeft
          const nextTop = Math.max(8, curTop + (e.clientY - d.startY))
          const nextLeft = Math.max(8, curLeft + (e.clientX - d.startX))
          setPos({ top: nextTop, left: nextLeft })
          d.origTop = nextTop
          d.origLeft = nextLeft
          d.startX = e.clientX
          d.startY = e.clientY
        }
        const onUp = () => { dragRef.current = null }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
        }
      }, [])

      const onHeaderMouseDown = (e) => {
        if (e.button !== 0) return // left button only
        // current position: explicit pos if dragged before, else defaults
        const baseTop = 60
        const baseLeft = window.innerWidth - 20 - 400 // right:20 + width:400
        const origTop = pos.top != null ? pos.top : baseTop
        const origLeft = pos.left != null ? pos.left : baseLeft
        dragRef.current = {
          startX: e.clientX, startY: e.clientY,
          origTop, origLeft, moved: false
        }
      }

      const stop = (e) => e.stopPropagation()

      // v0.6: docked sidebar —— 打开且未折叠时，在 <html> 挂 data-dwr-docked 并写入面板宽度，
      // body padding-right 让 DSH 主页面让出空间形成左右平铺；关闭/折叠时清除。
      useEffect(() => {
        if (!open || collapsed) {
          document.documentElement.removeAttribute('data-dwr-docked')
          document.documentElement.style.removeProperty('--dwr-panel-width')
          return
        }
        document.documentElement.setAttribute('data-dwr-docked', 'true')
        document.documentElement.style.setProperty('--dwr-panel-width', panelWidth + 'px')
        return () => {
          document.documentElement.removeAttribute('data-dwr-docked')
          document.documentElement.style.removeProperty('--dwr-panel-width')
        }
      }, [open, collapsed, panelWidth])

      // v0.6: splitter 拖拽（左侧边缘），宽度 320px ~ 50% 视口，实时持久化
      const startSplitterDrag = (e) => {
        if (e.button !== 0) return
        e.preventDefault()
        const startX = e.clientX
        const startWidth = panelWidth
        setSplitterDragging(true)
        document.body.style.cursor = 'col-resize'
        const onMove = (ev) => {
          const maxWidth = Math.max(MIN_PANEL_WIDTH, Math.floor(window.innerWidth * MAX_PANEL_RATIO))
          const next = Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, startWidth + (startX - ev.clientX)))
          setPanelWidth(next)
          savePanelWidth(next)
          document.documentElement.style.setProperty('--dwr-panel-width', next + 'px')
        }
        const onUp = () => {
          setSplitterDragging(false)
          document.body.style.cursor = ''
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      }

      if (!open) return null

      const onEnterSubmit = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          if (provider === 'gemini-free') submitGemini()
          else if (phase === 'input') submitManual()
        }
      }

      const checkedIndices = actions
        ? actions.filter((a) => checks[a.index]).map((a) => a.index)
        : []

        // v1.3 trace display order: asc = full timeline; desc = latest pinned, rest asc.
        const sortedTraces = (() => {
          const arr = (traces || []).slice()
          if (traceOrder === 'desc') {
            arr.sort((a, b) => (a.created || '').localeCompare(b.created || ''))
            if (arr.length > 1) arr.unshift(arr.pop())
          } else {
            arr.sort((a, b) => (a.created || '').localeCompare(b.created || ''))
          }
          return arr
        })()


      // footer actions depend on phase
      let footer = null
      if (provider === 'gemini-free') {
        const stopped = stepState && stepState.status === 'stopped'
        footer = h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', width: '100%' } },
          h('button', { onClick: submitGemini, disabled: sending, style: { ...btnStyle, opacity: sending ? 0.6 : 1 } },
            sending ? '提问中…' : '提问'),
          exprId && !stopped && h('button', {
            onClick: stopExperiment,
            disabled: sending,
            className: 'dwr-ghost', style: { ...ghostRed, opacity: sending ? 0.6 : 1 }
          }, '停止'),
          exprId && stopped && h('button', {
            onClick: resumeExperiment,
            disabled: sending,
            className: 'dwr-ghost', style: { ...btnGhostStyle, opacity: sending ? 0.6 : 1 }
          }, '恢复')
        )
      } else if (phase === 'input' || phase === 'parsing') {
        footer = h('button', { onClick: submitManual, disabled: sending || phase === 'parsing', style: { ...btnStyle, opacity: (sending || phase === 'parsing') ? 0.6 : 1 } },
          (phase === 'parsing') ? '解析中…' : '解析并预览')
      } else if (phase === 'preview') {
        footer = h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', width: '100%' } },
          h('button', { onClick: () => execute([]), disabled: sending, className: 'dwr-ghost', className: 'dwr-ghost', style: { ...btnGhostStyle, opacity: sending ? 0.6 : 1 } },
            sending ? '保存中…' : '仅保存记录'),
          h('button', {
            onClick: () => execute(checkedIndices),
            disabled: sending || checkedIndices.length === 0,
            style: { ...btnStyle, opacity: (sending || checkedIndices.length === 0) ? 0.6 : 1 }
          }, sending ? '执行中…' : `执行所选 (${checkedIndices.length})`)
        )
      } else if (phase === 'working') {
        footer = h('button', { disabled: true, style: { ...btnStyle, opacity: 0.6 } }, '处理中…')
      } else if (phase === 'done') {
        footer = h('button', {
          onClick: () => { setActions(null); setChecks({}); setNeedsAgent(null); setExecResults(null); setSteps(null); setStepState(null); setExprId(''); setStepComment(''); setPhase('input'); setSavedPath('') },
          style: btnGhostStyle
        }, '新对话')
      }

      if (collapsed) return h('div', { className: 'dwr-rail', onClick: () => setCollapsed(false), title: '展开插件面板', 'aria-label': 'expand dsh-web-relay panel' }, '◀')
      return h('div', {
        style: {
          ...panelStyle,
          ...(splitterDragging ? { transition: 'none' } : {})
        },
        className: splitterDragging ? 'dwr-dragging' : undefined
      },
        // v0.6: splitter bar at the left edge of the docked plugin
        h('div', {
          onMouseDown: startSplitterDrag,
          className: 'dwr-splitter' + (splitterDragging ? ' dwr-dragging' : ''),
          style: { right: panelWidth, width: SPLITTER_WIDTH },
          title: '拖动调整插件宽度'
        }),
        h('div', {
          style: {
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 16px', borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))',
            cursor: 'default', userSelect: 'none'
          }
        },
          h('strong', { style: { fontWeight: 600 } }, 'dsh-web-relay · 外部AI协作平台'),
          h('div', { style: { display: 'flex', gap: 4 } },
            h('button', {
              onClick: (e) => { stop(e); setCollapsed(true) },
              'aria-label': '最小化',
              title: '最小化',
              style: { background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14 }
            }, '—'),
            h('button', { onClick: (e) => { stop(e); dispatchToggle() }, 'aria-label': 'close', style: { background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' } }, '✕')
          )
        ),
        // v0.5: tab bar (experiment form | three-party trace page)
        !collapsed &&
        h('div', { style: { display: 'flex', gap: 0, marginBottom: 8, borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))' } },
          h('button', { onClick: () => setTab('main'), style: tab === 'main' ? tabActiveStyle : tabBtnStyle }, '协作对话'),
          h('button', { onClick: () => setTab('trace'), style: tab === 'trace' ? tabActiveStyle : tabBtnStyle }, '轨迹')
        ),
        !collapsed && tab === 'main' &&
        h('div', { style: panelBodyStyle },
          config && !config.geminiConfigured
            ? h('div', { style: warnStyle }, '⚠ 未检测到 GEMINI_API_KEY，gemini-free 不可用；可用 manual 粘贴模式。')
            : (config && h('div', { style: hintStyle }, `v${config.version || '?'} · ${config.geminiConfigured ? 'Gemini 已就绪 · model: ' + config.model : 'Gemini 未配置'} · shell: ${config.shellAvailable ? '✓' : '✗'} · apiProxy: ${config.apiProxyAvailable ? '✓' : '✗'}`)),
          // Step 2: quiet protocol version line + collapsible full text (locks
          // the external-AI role on every session, without stealing the UI).
          protocol && h('div', { style: { margin: '2px 0' } },
            h('button', {
              onClick: () => setShowProtocol(!showProtocol),
              style: { background: 'none', border: 'none', color: 'var(--dsw-alias-label-secondary, #a1a1aa)', cursor: 'pointer', fontSize: 12, padding: 0, fontFamily: 'inherit' }
            }, showProtocol ? '▼ 三方协议 ' + (protocol.version || '') : '▶ 三方协议 ' + (protocol.version || '')),
            showProtocol && h('div', { style: { ...preStyle, marginTop: 4, maxHeight: 160, fontSize: 12 } }, protocol.text)
          ),
          h('select', {
            value: provider,
            onChange: (e) => setProvider(e.target.value),
            style: { ...inputStyle, width: 'auto' }
          },
            h('option', { value: 'manual' }, '手动粘贴（DeepSeek/Gemini 网页）'),
            h('option', { value: 'gemini-free' }, 'Gemini Free API（官方免费）')
          ),
          provider === 'manual'
            ? h('div', { style: hintStyle }, '粘贴网页 AI 的回答；含 ```json:agent-action 指令块时会先解析预览，逐条确认后才执行。')
            : h('div', { style: hintStyle }, '试验 prompt 会作为问题发给 Gemini：'),
          h('textarea', {
            value: prompt,
            onChange: (e) => setPrompt(e.target.value),
            onKeyDown: onEnterSubmit,
            placeholder: '协作对话 prompt / 问题……（Enter 提交，Shift+Enter 换行）',
            rows: 2, style: inputStyle
          }),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0' } },
            h('button', { onClick: packContext, style: btnStyle }, '📦 打包上下文'),
              h('button', { onClick: () => setArchitectMode(!architectMode), className: 'dwr-ghost', style: architectMode ? ghostPurple : btnGhostStyle }, architectMode ? '🧭 架构探讨开' : '🧭 架构探讨'),
            contextCopied && h('span', { style: { ...savedStyle, marginTop: 0 } }, '已复制，去网页 Ctrl+V'),
            !contextCopied && contextText && h('span', { style: hintStyle }, '剪贴板不可用，请手动复制预览区')
          ),
          contextText && h('div', { style: { margin: '4px 0' } },
            h('button', {
              onClick: () => setShowContextPreview(!showContextPreview),
              style: { background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: 12, padding: 0 }
            }, showContextPreview ? '收起预览 ▲' : '展开预览 ▼'),
            showContextPreview && h('div', { style: preStyle }, contextText)
          ),
          provider === 'manual' &&
            h('textarea', {
              value: pasted,
              onChange: (e) => setPasted(e.target.value),
              onKeyDown: onEnterSubmit,
              placeholder: '从网页版粘贴回答……（Enter 解析，Shift+Enter 换行）',
              rows: 6, style: inputStyle
            }),
          // v0.5.2 Step 2: rule-8 payload guardrail card
          showGuard && h('div', { style: { margin: '4px 0', border: '1px solid #f59e0b', borderRadius: 6, padding: 8, background: 'rgba(245,158,11,.08)' } },
            h('div', { style: { color: '#fbbf24', fontSize: 12, fontWeight: 600 } }, '⚠ 检测到方案但缺少规则 8 Payload'),
            h('div', { style: { ...hintStyle, marginTop: 2 } }, '复杂任务需包含 json:agent-action 代码块（wake_agent + Step List）才能让主 agent 接管。'),
            h('div', { style: { display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' } },
              h('button', { onClick: wrapPayload, style: { ...btnStyle, padding: '4px 10px', fontSize: 12 } }, '一键封装规则 8 Payload'),
              h('span', { style: hintStyle }, guardHint)
            )
          ),

          // v0.3: instruction cards
          actions && actions.length > 0 && h('div', { style: { marginTop: 8 } },
            h('div', { style: { ...hintStyle, fontWeight: 600, color: '#93c5fd' } }, '检测到可执行指令，逐条确认：'),
            actions.map((a) => h('div', {
              key: a.index,
              style: {
                display: 'flex', alignItems: 'flex-start', gap: 8,
                background: 'var(--dsw-alias-bg-layer-1, #18181b)', border: '1px solid var(--dsw-alias-border-l1, #3f3f46)',
                borderRadius: 6, padding: '6px 8px', marginTop: 6
              }
            },
              h('input', {
                type: 'checkbox',
                checked: !!checks[a.index],
                disabled: a.type === 'invalid' || a.type === 'plan' || sending,
                onChange: (e) => setChecks((c) => ({ ...c, [a.index]: e.target.checked })),
                style: { marginTop: 3 }
              }),
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
                  h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #a1a1aa)' } }, `#${a.index} ${typeLabel(a.type)}`),
                  h('span', { style: { fontSize: 11, color: riskColor(a.risk), border: '1px solid ' + riskColor(a.risk), borderRadius: 4, padding: '0 4px' } }, riskLabel(a.risk)),
                  a.type === 'run_cmd' && h('span', { style: { fontSize: 11, color: '#f87171' } }, '高风险·确认后再勾')
                ),
                h('div', { style: { marginTop: 2, wordBreak: 'break-word' } }, a.summary),
                h('button', {
                  onClick: () => setExpanded((x) => ({ ...x, [a.index]: !x[a.index] })),
                  style: { background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: 12, padding: 0, marginTop: 2 }
                }, expanded[a.index] ? '收起 ▲' : '详情 ▼'),
                expanded[a.index] && h('div', { style: { ...preStyle, marginTop: 4, fontSize: 12 } }, a.detail)
              )
            ))
          ),

          // needsAgent card
          needsAgent && h('div', { style: { marginTop: 8, border: '1px solid #f59e0b', borderRadius: 6, padding: 8, background: 'rgba(245,158,11,.08)' } },
            h('div', { style: { color: '#fbbf24', fontWeight: 600 } }, '⚠ 该指令需主 agent 接管'),
            h('div', { style: { ...hintStyle, marginTop: 4 } }, needsAgent.reason || ''),
            needsAgent.agentWoken
              ? h('div', { style: { ...savedStyle, marginTop: 6 } }, '✅ 已唤醒主 agent（注入成功），请到主会话查看。')
              : h('div', { style: { marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                  h('span', { style: hintStyle }, needsAgent.wakeReason
                    ? `注入不可达（${needsAgent.wakeReason}），请复制 handoff：`
                    : '请复制 handoff 文本交给主 agent：'),
                  needsAgent.handoffText && h('button', {
                    onClick: () => copyHandoff(needsAgent.handoffText),
                    className: 'dwr-ghost', style: { ...ghostRed, padding: '4px 10px', fontSize: 12 }
                  }, '复制 handoff 文本')
                ),
            needsAgent.handoffText && h('div', { style: { ...preStyle, marginTop: 6, maxHeight: 160 } }, needsAgent.handoffText)
          ),

            // v1.3: always allow loading an existing Step List by expr id,
              // v1.4: planning phase helper — paste executing reply below or switch phase.
              stepState && stepState.phase === 'planning' && h('div', { style: { marginTop: 8, border: '1px solid #f59e0b', borderRadius: 6, padding: 8, background: 'rgba(245,158,11,.06)' } },
                h('div', { style: { color: '#fbbf24', fontWeight: 600, fontSize: 12 } }, '当前处于 Planning 阶段'),
                h('div', { style: { ...hintStyle, marginTop: 4 } }, '请将外部 AI 的 executing 回复粘贴到上方手动输入框并点击解析；或先点击「进入执行阶段」再继续。'),
                h('button', { onClick: () => setExperimentPhase('executing'), disabled: stepBusy, style: { ...btnStyle, padding: '4px 10px', fontSize: 12, marginTop: 4 } }, '进入执行阶段')
              ),

            // even when the current panel state is empty after a restart.
            h('div', { style: { marginTop: 8, border: '1px solid var(--dsw-alias-border-l1, #3f3f46)', borderRadius: 6, padding: 8 } },
              h('div', { style: { ...hintStyle, fontWeight: 600, color: '#93c5fd' } }, 'Step List 载入'),
              h('div', { style: { display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' } },
                h('input', {
                  value: stepLoadId,
                  onChange: (e) => setStepLoadId(e.target.value),
                  placeholder: '载入已有 expr id，如 expr-2026-08-23_14-34-09',
                  style: { ...inputStyle, margin: 0, flex: 1, fontSize: 12 }
                }),
                h('button', { onClick: () => loadStepState(stepLoadId), disabled: stepBusy, className: 'dwr-ghost', style: { ...btnGhostStyle, padding: '4px 10px', fontSize: 12 } }, '载入')
                  ,
                  h('button', { onClick: () => refreshStepState(), disabled: stepBusy || !exprId, className: 'dwr-ghost', style: { ...btnGhostStyle, padding: '4px 10px', fontSize: 12 } }, '刷新')
              )
            ),

            // v1.3: Step List execution + external-AI review
            steps && steps.length > 0 && h('div', { style: { marginTop: 8, border: '1px solid var(--dsw-alias-border-l1, #3f3f46)', borderRadius: 6, padding: 8 } },
              h('div', { style: { ...hintStyle, fontWeight: 600, color: '#93c5fd' } }, 'Step List · 逐步执行/外部 AI 审核'),
                stepState && stepState.phase && h('span', { style: { fontSize: 11, color: stepState.phase === 'planning' ? '#f59e0b' : '#4ade80', marginLeft: 6 } }, '· 阶段: ' + stepState.phase),
                stepState && stepState.autoReview && h('span', { style: { fontSize: 11, color: '#7c3aed', marginLeft: 6 } }, '· 自动审核模式开'),
                  h('button', { onClick: toggleAutoReview, disabled: stepBusy, className: 'dwr-ghost', style: { ...btnGhostStyle, padding: '2px 8px', fontSize: 11, marginLeft: 6 } }, stepState && stepState.autoReview ? '关闭自动审核' : '开启自动审核'),
                  stepState && stepState.phase === 'planning' && h('button', { onClick: () => setExperimentPhase('executing'), disabled: stepBusy, className: 'dwr-ghost', style: { ...btnGhostStyle, padding: '2px 8px', fontSize: 11, marginLeft: 6 } }, '进入执行阶段'),
                h('div', { style: { display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' } },
                  h('input', {
                    value: stepLoadId,
                    onChange: (e) => setStepLoadId(e.target.value),
                    placeholder: '载入已有 expr id，如 expr-2026-08-22_13-51-32',
                    style: { ...inputStyle, margin: 0, flex: 1, fontSize: 12 }
                  }),
                  h('button', { onClick: () => loadStepState(stepLoadId), disabled: stepBusy, className: 'dwr-ghost', style: { ...btnGhostStyle, padding: '4px 10px', fontSize: 12 } }, '载入')
                ),

              steps.map((s) => h('div', { key: s.id, style: { marginTop: 6, padding: 6, background: 'var(--dsw-alias-bg-layer-1, #18181b)', border: '1px solid var(--dsw-alias-border-l1, #3f3f46)', borderRadius: 6 } },
                h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
                  h('span', { style: { color: '#93c5fd', fontWeight: 600 } }, `Step ${s.id}`),
                  h('span', { style: { color: 'var(--dsw-alias-label-primary, #e4e4e7)' } }, s.title),
                  h('span', { style: { fontSize: 11, color: s.status === 'approved' ? '#4ade80' : s.status === 'rejected' ? '#f87171' : s.status === 'review' ? '#fbbf24' : s.status === 'executing' ? '#60a5fa' : '#a1a1aa' } },
                    (({ pending: '待开始', executing: '执行中', review: '待审核', approved: '已通过', rejected: '已打回' })[s.status] || s.status))
                ),
                s.detail && h('div', { style: { ...hintStyle, marginTop: 2 } }, s.detail),
                s.acceptance && h('div', { style: { ...hintStyle, marginTop: 2 } }, '验收：' + s.acceptance),
                h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 } },
                  h('button', { onClick: () => callStepUpdate(s.id, 'start'), disabled: stepBusy, className: 'dwr-ghost', style: { ...btnGhostStyle, padding: '2px 8px', fontSize: 11 } }, '开始'),
                  h('button', { onClick: () => callStepUpdate(s.id, 'complete'), disabled: stepBusy, className: 'dwr-ghost', style: { ...btnGhostStyle, padding: '2px 8px', fontSize: 11 } }, '完成待审核'),
                    h('button', { onClick: () => autoReviewStep(s.id), disabled: stepBusy, className: 'dwr-ghost', style: { ...ghostPurple, padding: '2px 8px', fontSize: 11 } }, '自动审核'),
                  h('button', { onClick: () => callStepUpdate(s.id, 'approve'), disabled: stepBusy, className: 'dwr-ghost', style: { ...ghostGreen, padding: '2px 8px', fontSize: 11 } }, '外部通过'),
                  h('button', { onClick: () => callStepUpdate(s.id, 'reject'), disabled: stepBusy, className: 'dwr-ghost', style: { ...ghostRed, padding: '2px 8px', fontSize: 11 } }, '外部打回'),
                  h('button', { onClick: () => callStepUpdate(s.id, 'reopen'), disabled: stepBusy, className: 'dwr-ghost', style: { ...btnGhostStyle, padding: '2px 8px', fontSize: 11 } }, '重开')
                )
              )),
              h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
                h('input', {
                  value: stepComment,
                  onChange: (e) => setStepComment(e.target.value),
                  placeholder: '审核/执行备注（可选）',
                  style: { ...inputStyle, margin: 0, flex: 1 }
                })
              )
            ),


          // execution results
          execResults && execResults.length > 0 && h('div', { style: { marginTop: 8 } },
            h('div', { style: { ...hintStyle, fontWeight: 600, color: '#93c5fd' } }, '执行结果：'),
            execResults.map((r) => h('div', {
              key: r.index,
              style: { background: 'var(--dsw-alias-bg-layer-1, #18181b)', border: '1px solid var(--dsw-alias-border-l1, #3f3f46)', borderRadius: 6, padding: 6, marginTop: 6 }
            },
              h('div', { style: { color: r.ok ? '#4ade80' : '#f87171', fontWeight: 600 } },
                `${r.ok ? '✓' : '✗'} #${r.index} ${typeLabel(r.type)} · ${r.summary}`),
              h('div', { style: { ...preStyle, marginTop: 4, fontSize: 12 } }, r.detail)
            ))
          ),

          error && h('div', { style: { ...warnStyle, whiteSpace: 'pre-wrap' } }, error),
          answer && h('div', { style: { marginTop: 8 } },
            h('div', { style: hintStyle }, '回答：'),
            h('div', { style: preStyle }, answer)
          ),
          savedPath && h('div', { style: savedStyle }, `记录：${savedPath}`)
        ),
        // v0.5: three-party trace page (用户 / 主 agent / 外部AI)
        !collapsed && tab === 'trace' &&
        h('div', { style: panelBodyStyle },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
            h('span', { style: { ...hintStyle, margin: 0, fontWeight: 600, color: '#93c5fd' } }, '三方轨迹（用户 / 主 agent / 外部AI）'),
            h('span', { style: hintStyle }, traces ? `${traces.length} 条` : ''),
              h('button', {
                onClick: () => setTraceOrder(traceOrder === 'asc' ? 'desc' : 'asc'),
                className: 'dwr-ghost',
                style: { ...btnGhostStyle, padding: '3px 10px', fontSize: 12 }
              }, traceOrder === 'asc' ? '倒序（最新优先）' : '正序（时间线）'),
            h('button', {
              onClick: loadTraces,
              disabled: traceLoading,
              className: 'dwr-ghost', style: { ...btnGhostStyle, padding: '3px 10px', fontSize: 12, marginLeft: 'auto', opacity: traceLoading ? 0.6 : 1 }
            }, traceLoading ? '刷新中…' : '刷新')
          ),
          traceError && h('div', { style: warnStyle }, traceError),
          traces === null
            ? h('div', { style: hintStyle }, '加载中…')
            : traces.length === 0
              ? h('div', { style: hintStyle }, '暂无轨迹。开始一次协作对话（含唤醒/收口）后，这里会显示三方对话流水（web-relay/traces/）。')
              : sortedTraces.map((t) => h('div', { key: t.id, style: { background: 'var(--dsw-alias-bg-layer-1, #18181b)', border: '1px solid var(--dsw-alias-border-l1, #3f3f46)', borderRadius: 6, padding: 8, marginBottom: 8 } },
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 } },
                    h('span', { style: { color: '#93c5fd', fontWeight: 600, fontSize: 12, wordBreak: 'break-all' } }, t.id),
                    h('button', {
                      onClick: () => expandRecord(t.id),
                      style: { background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }
                    }, expandedTrace[t.id] ? '收起协作记录 ▲' : '查看协作记录 ▼')
                  ),
                    !expandedTrace[t.id] && (() => {
                      const s = summarizeTrace(t)
                      return h('div', { style: { marginTop: 6, padding: 8, background: 'var(--dsw-alias-bg-layer-1, #101018)', border: '1px solid var(--dsw-alias-border-l1, #2a2a35)', borderRadius: 6 } },
                        h('div', { style: { fontSize: 11, color: '#93c5fd', fontWeight: 600 } }, '用户任务'),
                        h('div', { style: { ...hintStyle, marginTop: 2 } }, s.userTask),
                        h('div', { style: { fontSize: 11, color: '#f59e0b', fontWeight: 600, marginTop: 6 } }, '过程概述'),
                        h('div', { style: { ...hintStyle, marginTop: 2 } }, s.overview),
                        h('div', { style: { fontSize: 11, color: '#4ade80', fontWeight: 600, marginTop: 6 } }, '成果摘要'),
                        h('div', { style: { ...hintStyle, marginTop: 2 } }, s.result)
                      )
                    })(),
                  !expandedTrace[t.id] ? null : (t.entries || []).map((e, i) => h('div', { key: i, style: { marginTop: 6, borderLeft: '2px solid ' + (ROLE_COLOR[e.role] || '#52525b'), paddingLeft: 8 } },
                    h('div', { style: { fontSize: 11, color: ROLE_COLOR[e.role] || '#a1a1aa' } },
                      (ROLE_LABEL[e.role] || e.role) + ' · ' + String(e.at || '').replace('T', ' ').replace(/\.\d+Z$/, 'Z')),
                    h('div', { style: { ...preStyle, marginTop: 2, maxHeight: 140, fontSize: 12 } }, e.text || '(空)')
                  )),
                  expandedTrace[t.id] && traceRecord[t.id] && h('div', { style: { ...preStyle, marginTop: 6, maxHeight: 220, fontSize: 12 } }, traceRecord[t.id])
                ))
        ),
        !collapsed &&
        h('div', { style: panelFootStyle },
          tab === 'trace'
            ? h('button', { onClick: loadTraces, disabled: traceLoading, className: 'dwr-ghost', style: { ...btnGhostStyle, opacity: traceLoading ? 0.6 : 1 } }, traceLoading ? '刷新中…' : '刷新轨迹')
            : footer,
          h('span', { style: hintStyle }, 'Enter 提交 · Shift+Enter 换行')
        )
      )
    }

    const apply = (ctx) => {
      // v0.6: 注入平铺布局 CSS（body 留白 / 分割条 / 折叠 rail / tokens）
      if (typeof document !== 'undefined' && !document.querySelector('style[data-dwr-dock-css]')) {
        const style = document.createElement('style')
        style.dataset.dwrDockCss = 'true'
        style.textContent = DOCK_CSS
        document.head.append(style)
      }
      const slots = ctx.get('slots')
      slots.inject('sidebar.footer.action', () =>
        slots.register({ name: 'sidebar.footer.action', id: 'dsh-web-relay', order: 120 }, FooterButton)
      )
      slots.inject('shell.overlay', () =>
        slots.register({ name: 'shell.overlay', id: 'dsh-web-relay-panel', order: 120 }, RelayPanel)
      )
    }

    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  }
})
