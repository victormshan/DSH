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
    // v1.6: 顶栏协议版本下拉（inputStyle 小号变体：紧凑，不占行）
    const protoSelectStyle = {
      ...inputStyle,
      width: 'auto', margin: 0, marginRight: 8,
      fontSize: 11, padding: '2px 6px', borderRadius: 6, cursor: 'pointer', flex: '0 0 auto'
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

    // ---- v1.5: i18n（中/英）字典 —— 渲染处用 T = localeDict[locale] 取当前语言文案 ----
    const LOCALE_KEY = 'dsh-web-relay:locale'
    const loadLocale = () => {
      try {
        const v = localStorage.getItem(LOCALE_KEY)
        if (v === 'zh' || v === 'en') return v
      } catch (e) { /* ignore */ }
      return 'zh'
    }
    const localeDict = {
      zh: {
        title: 'dsh-web-relay · 外部AI协作平台',
        tabChat: '协作对话',
        tabTrace: '轨迹',
        railExpand: '展开插件面板',
        stepListLoad: 'Step List 载入',
        stepListExec: 'Step List · 逐步执行/外部 AI 审核',
        phaseLabel: '阶段',
        autoReviewModeLabel: '自动审核模式开',
        acceptanceLabel: '验收：',
        loadPlaceholder: '载入已有 expr id，如 expr-2026-08-23_14-34-09',
        commentPlaceholder: '审核/执行备注（可选）',
        reviewCommentPlaceholder: '审核意见（可选）',
        promptPlaceholder: '协作对话 prompt / 问题……（Enter 提交，Shift+Enter 换行）',
        pastePlaceholder: '从网页版粘贴回答……（Enter 解析，Shift+Enter 换行）',
        manualHint: '粘贴网页 AI 的回答；含 ```json:agent-action 指令块时会先解析预览，逐条确认后才执行。',
        geminiHint: '任务 prompt 会作为问题发给 Gemini：',
        geminiNotConfigured: '⚠ 未检测到 GEMINI_API_KEY，gemini-free 不可用；可用 manual 粘贴模式。',
        configVersion: 'v',
        configReady: 'Gemini 已就绪',
        configNotReady: 'Gemini 未配置',
        copiedHint: '已复制，去网页 Ctrl+V',
        clipboardUnavailable: '剪贴板不可用，请手动复制预览区',
        providerManual: '手动粘贴（DeepSeek/Gemini 网页）',
        providerGemini: 'Gemini Free API（官方免费）',
        architectOn: '🧭 架构探讨开',
        architectOff: '🧭 架构探讨',
        protocolExpand: '▶ 三方协议',
        protocolCollapse: '▼ 三方协议',
        planningCardTitle: '当前处于 Planning 阶段',
        planningCardHint: '请将外部 AI 的 executing 回复粘贴到上方手动输入框并点击解析；或先点击「进入执行阶段」再继续。',
        traceTitle: '三方轨迹（用户 / 主 agent / 外部AI）',
        traceCountUnit: '条',
        traceEmpty: '暂无轨迹。开始一次协作对话（含唤醒/收口）后，这里会显示三方对话流水（web-relay/traces/）。',
        traceLoading: '加载中…',
        traceRefresh: '刷新',
        traceRefreshing: '刷新中…',
        traceOrderAsc: '正序（时间线）',
        traceOrderDesc: '倒序（最新优先）',
        footerHint: 'Enter 提交 · Shift+Enter 换行',
        progressStep: 'Step',
        progressWaiting: '等待外部AI',
        badgeWaitReview: '等待审核',
        badgeExecuting: '主 agent 执行中',
        badgeDone: '已完成',
        badgePlanning: '架构探讨中',
        badgeStopped: '已停止',
        manualReviewTitle: '手动审核（外部 AI 不可用，降级到人工审核）',
        fallbackReasonLabel: '降级原因：',
        expandTrace: '展开轨迹摘要 ▼',
        collapseTrace: '收起轨迹摘要 ▲',
        finalSummaryTitle: '审核来源汇总',
        btn: {
          load: '载入', refresh: '刷新', clear: '清空',
          ask: '提问', asking: '提问中…',
          stop: '停止', resume: '恢复',
          packContext: '📦 打包上下文',
          start: '开始', complete: '完成待审核',
          autoReview: '自动审核', autoReviewing: '审核中…',
          extApprove: '外部通过', extReject: '外部打回', reopen: '重开',
          finalize: '一键收口', finalizing: '收口中…',
          enterExec: '进入执行阶段',
          autoReviewOn: '关闭自动审核', autoReviewOff: '开启自动审核',
          newChat: '新对话',
          copyHandoff: '复制 handoff 文本',
          approve: '通过', reject: '打回',
          expandPreview: '展开预览 ▼', collapsePreview: '收起预览 ▲',
          minimize: '—', close: '✕',
          langBtn: 'EN',
          langTitle: 'Switch to English / 切换到 English'
        },
        status: { pending: '待开始', executing: '执行中', review: '待审核', approved: '已通过', rejected: '已打回' },
        phase: { planning: '架构探讨', executing: '执行' },
        reviewerExternal: '外部AI',
        reviewerDialog: '对话模型',
        reviewerManual: '手动',
        roleLabel: { user: '用户', mainagent: '主 agent', external: '外部AI' },
        parsing: '解析中…',
        parsePreview: '解析并预览',
        saving: '保存中…',
        saveOnly: '仅保存记录',
        manualNeedPaste: 'manual 模式需要粘贴回答',
        expandRecord: '查看协作记录',
        collapseRecord: '收起协作记录',
        userTaskLabel: '用户任务',
        processOverviewLabel: '过程概述',
        resultSummaryLabel: '成果摘要',
        noUserTask: '(无用户任务)',
        noResultSummary: '(暂无成果摘要)',
        // v1.6: 协议版本选择 + 版本 directive + 步骤依赖标注 + 看板就绪数
        protoV15: 'v1.5 线性',
        protoV16: 'v1.6 DAG 并发',
        protoTitle: '协议版本：v1.5 线性 / v1.6 并发调度',
        protoV15Directive: '【协议 v1.5 线性执行】请按线性步骤生成 steps 数组，主 agent 将按顺序逐一执行。',
        protoV16Directive: '【协议 v1.6 并发调度】请分析模块独立性，对无依赖冲突的步骤显式声明 parallel_group 与 depends_on，指导主 agent 并发调度。',
        depGroup: '组',
        depOn: '依赖',
        progressReady: '就绪',
        summaryCounts: (m, e, a, r) => `主 agent ${m} 条 · 外部AI ${e} 条 · 通过 ${a} 次 · 打回 ${r} 次`,
        // v1.7: importance 徽标 / 批量自动审核 / 候选方案 / artifacts 警告 / 5 段式打包模板 / v1.7 协议
        protoV17: 'v1.7 智能编排',
        protoV17Directive: '【协议 v1.7 智能编排】在 v1.6 并发调度基础上，每个步骤可携带 importance（高/中/低）与 alternatives（候选方案），主 agent 按优先级与风险自主编排执行顺序。',
        importanceHigh: '高优先',
        importanceMedium: '中',
        importanceLow: '低',
        batchReview: '批量自动审核',
        alternatives: '候选方案',
        artifactsWarning: '⚠ 缺少产物，外部 AI 可能打回',
        tmplHeader: '主 agent 上下文模板',
        tmplDataSchema: '会话日志 JSONL 首条结构（usage/model/timestamp）',
        tmplPricingMap: 'MODEL_PRICES 常量 + 汇率',
        tmplMountPoints: '插件扩展槽位（sidebar.footer.action / shell.overlay）',
        tmplRuntimeLimits: '不支持 HTTP 动态热加载（需降级方案）',
        tmplHistoryTrace: '（主 agent 填充上次尝试/降级记录）',
        // v1.8: 混合模式（importance 分工契约 + review 硬开关 + reviewedBy mainagent + 批量原子打回 + 重构 Step List + 5 段固定键名）
        protoV18: 'v1.8 混合模式',
        protoV18Directive: '【协议 v1.8 混合模式】importance 升级为执行/审核分工契约：low=主 agent 直做免审（complete 自动 approved，reviewedBy=mainagent 留审计）、medium=批量轻审、high=三方严格审；review:false 为硬开关，显式指定则无条件绕过审核。',
        reviewerMainagent: '主 agent 豁免',
        batchAtomicReject: '批量审核原子打回：同批存在被拒步骤，涉及步骤已全部退回 rejected，请分别补证据后重提',
        restructureBtn: '重构 Step List',
        restructurePlaceholder: '粘贴新的 steps JSON 数组（仅对 pending/rejected 生效，approved 步骤与产物保留）',
        restructureApply: '应用重构',
        restructureResult: '重构完成：更新 {updated} 新增 {added} 移除 {removed}，approved 保留 {untouched}',
        tmplNA: '（5 段固定键名：不适用项填 N/A 或 none，严禁省略字段）',
        // v1.9: AutoIteration 自动迭代 + 全角色降级链
        protoV19: 'v1.9 自动迭代',
        protoV19Directive: '【协议 v1.9 自动迭代】用户可声明 {"iterations":N, "finalAcceptance":"...", "autoDecision":true} 自动演进 N 版（版间门 Vn+1、连续打回≥3 熔断）；Gemini 限流时全角色自动降级内部对话模型（external→dialog→pause）。'
      },
      en: {
        title: 'dsh-web-relay · External AI Collaboration',
        tabChat: 'Chat',
        tabTrace: 'Trace',
        railExpand: 'Expand panel',
        stepListLoad: 'Step List Load',
        stepListExec: 'Step List · Execute / External AI Review',
        phaseLabel: 'Phase',
        autoReviewModeLabel: 'auto-review on',
        acceptanceLabel: 'Acceptance: ',
        loadPlaceholder: 'Load expr id, e.g. expr-2026-08-23_14-34-09',
        commentPlaceholder: 'Comment (optional)',
        reviewCommentPlaceholder: 'Review comment (optional)',
        promptPlaceholder: 'Chat prompt / question… (Enter to submit, Shift+Enter newline)',
        pastePlaceholder: 'Paste answer from web AI… (Enter to parse, Shift+Enter newline)',
        manualHint: 'Paste the web AI reply; instruction blocks (```json:agent-action) are parsed and previewed for per-item confirmation.',
        geminiHint: 'The task prompt will be sent to Gemini:',
        geminiNotConfigured: '⚠ GEMINI_API_KEY not detected; gemini-free unavailable. Use manual paste mode.',
        configVersion: 'v',
        configReady: 'Gemini ready',
        configNotReady: 'Gemini not configured',
        copiedHint: 'Copied — paste into the web AI (Ctrl+V)',
        clipboardUnavailable: 'Clipboard unavailable; copy the preview manually',
        providerManual: 'Manual paste (DeepSeek/Gemini web)',
        providerGemini: 'Gemini Free API (official free)',
        architectOn: '🧭 Architecture on',
        architectOff: '🧭 Architecture',
        protocolExpand: '▶ Protocol',
        protocolCollapse: '▼ Protocol',
        planningCardTitle: 'Currently in Planning phase',
        planningCardHint: 'Paste the external AI executing reply into the manual input above and parse it; or click "Enter execution phase" to continue.',
        traceTitle: 'Three-party trace (User / Main agent / External AI)',
        traceCountUnit: 'items',
        traceEmpty: 'No traces yet. Start a collaboration chat (wake/finalize) to see the three-party flow here (web-relay/traces/).',
        traceLoading: 'Loading…',
        traceRefresh: 'Refresh',
        traceRefreshing: 'Refreshing…',
        traceOrderAsc: 'Ascending (timeline)',
        traceOrderDesc: 'Descending (latest first)',
        footerHint: 'Enter to submit · Shift+Enter for newline',
        progressStep: 'Step',
        progressWaiting: 'Waiting for external AI',
        badgeWaitReview: 'Awaiting review',
        badgeExecuting: 'Main agent running',
        badgeDone: 'Done',
        badgePlanning: 'Planning',
        badgeStopped: 'Stopped',
        manualReviewTitle: 'Manual review (external AI unavailable — degraded to human review)',
        fallbackReasonLabel: 'Fallback reason: ',
        expandTrace: 'Expand trace summary ▼',
        collapseTrace: 'Collapse trace summary ▲',
        finalSummaryTitle: 'Review source summary',
        btn: {
          load: 'Load', refresh: 'Refresh', clear: 'Clear',
          ask: 'Ask', asking: 'Asking…',
          stop: 'Stop', resume: 'Resume',
          packContext: '📦 Pack Context',
          start: 'Start', complete: 'Complete (review)',
          autoReview: 'Auto Review', autoReviewing: 'Reviewing…',
          extApprove: 'Approve', extReject: 'Reject', reopen: 'Reopen',
          finalize: 'Finalize', finalizing: 'Finalizing…',
          enterExec: 'Enter execution phase',
          autoReviewOn: 'Disable auto-review', autoReviewOff: 'Enable auto-review',
          newChat: 'New chat',
          copyHandoff: 'Copy handoff text',
          approve: 'Approve', reject: 'Reject',
          expandPreview: 'Expand preview ▼', collapsePreview: 'Collapse preview ▲',
          minimize: '—', close: '✕',
          langBtn: '中',
          langTitle: 'Switch to Chinese / 切换到中文'
        },
        status: { pending: 'Pending', executing: 'Executing', review: 'Review', approved: 'Approved', rejected: 'Rejected' },
        phase: { planning: 'Planning', executing: 'Executing' },
        reviewerExternal: 'External AI',
        reviewerDialog: 'Dialog',
        reviewerManual: 'Manual',
        roleLabel: { user: 'User', mainagent: 'Main agent', external: 'External AI' },
        parsing: 'Parsing…',
        parsePreview: 'Parse & Preview',
        saving: 'Saving…',
        saveOnly: 'Save record only',
        manualNeedPaste: 'Manual mode requires a pasted answer',
        expandRecord: 'View record',
        collapseRecord: 'Collapse record',
        userTaskLabel: 'User Task',
        processOverviewLabel: 'Overview',
        resultSummaryLabel: 'Summary',
        noUserTask: '(No user task)',
        noResultSummary: '(No summary yet)',
        // v1.6: protocol version selector + directives + step dependency markers + ready count
        protoV15: 'v1.5 Linear',
        protoV16: 'v1.6 DAG Parallel',
        protoTitle: 'Protocol: v1.5 Linear / v1.6 DAG Parallel',
        protoV15Directive: '[Protocol v1.5 Linear] Generate a linear steps array; the main agent executes in order.',
        protoV16Directive: '[Protocol v1.6 DAG] Analyze module independence; mark conflict-free steps with parallel_group + depends_on to enable parallel scheduling.',
        depGroup: 'Group',
        depOn: 'depends',
        progressReady: 'ready',
        summaryCounts: (m, e, a, r) => `main agent ${m} · external AI ${e} · approved ${a} · rejected ${r}`,
        // v1.7: importance badge / batch auto-review / alternatives / artifacts warning / 5-section pack template / v1.7 protocol
        protoV17: 'v1.7 Orchestrated',
        protoV17Directive: '[Protocol v1.7 Smart Orchestration] On top of v1.6 DAG scheduling, each step may carry importance (high/medium/low) and alternatives; the main agent orchestrates execution order by priority and risk.',
        importanceHigh: 'High',
        importanceMedium: 'Med',
        importanceLow: 'Low',
        batchReview: 'Batch auto-review',
        alternatives: 'Alternatives',
        artifactsWarning: '⚠ Missing artifacts — the external AI may reject',
        tmplHeader: 'Main agent context template',
        tmplDataSchema: 'First JSONL record of session log (usage/model/timestamp)',
        tmplPricingMap: 'MODEL_PRICES constant + exchange rate',
        tmplMountPoints: 'Plugin extension slots (sidebar.footer.action / shell.overlay)',
        tmplRuntimeLimits: 'No HTTP dynamic hot-reload (degrade plan required)',
        tmplHistoryTrace: '(main agent fills last attempt / degradation record)',
        // v1.8: hybrid mode (importance duty contract + review hard switch + reviewedBy mainagent + atomic batch reject + restructure Step List + fixed 5-section keys)
        protoV18: 'v1.8 Hybrid',
        protoV18Directive: '[Protocol v1.8 Hybrid] importance becomes an execution/review duty contract: low = main agent executes directly without review (complete auto-approves, reviewedBy=mainagent kept for audit), medium = lightweight batch review, high = strict three-party review; review:false is a hard switch — explicitly setting it bypasses review unconditionally.',
        reviewerMainagent: 'MainAgent',
        batchAtomicReject: 'Atomic batch reject: one step rejected in the batch — all involved steps were rolled back to rejected; re-submit each with evidence',
        restructureBtn: 'Restructure Steps',
        restructurePlaceholder: 'Paste a new steps JSON array (applies to pending/rejected only; approved steps and artifacts are preserved)',
        restructureApply: 'Apply',
        restructureResult: 'Restructure complete: updated {updated}, added {added}, removed {removed}, approved preserved {untouched}',
        tmplNA: '(5 fixed section keys: fill N/A or none when not applicable; omitting fields is forbidden)',
        // v1.9: AutoIteration + full-role fallback chain
        protoV19: 'v1.9 AutoIteration',
        protoV19Directive: '[Protocol v1.9 AutoIteration] The user may declare {"iterations":N, "finalAcceptance":"...", "autoDecision":true} to auto-evolve N versions (round gates Vn+1, consecutive-rejection ≥3 circuit breaker); on Gemini rate limits every role auto-falls back to the internal dialog model (external→dialog→pause).'
      }
    }

    // ---- v0.5: web-relay three-party roles（显示标签随界面语言，见 localeDict.roleLabel） ----
    const ROLE_COLOR = { user: '#3b82f6', mainagent: '#f59e0b', external: '#a855f7' }
      const summarizeTrace = (t, T) => {
        const entries = t && Array.isArray(t.entries) ? t.entries : []
        const userEntry = entries.find((e) => e.role === 'user')
        const mainAgentEntries = entries.filter((e) => e.role === 'mainagent')
        const externalEntries = entries.filter((e) => e.role === 'external')
        const approvedCount = entries.filter((e) => /通过|approved/i.test(e.text || '')).length
        const rejectedCount = entries.filter((e) => /打回|rejected/i.test(e.text || '')).length
        const last = entries[entries.length - 1]
        const d = T || localeDict.zh
        return {
          userTask: (userEntry && userEntry.text ? userEntry.text : d.noUserTask).replace(/\s+/g, ' ').slice(0, 120),
          overview: d.summaryCounts(mainAgentEntries.length, externalEntries.length, approvedCount, rejectedCount),
          result: (last && last.text ? last.text : d.noResultSummary).replace(/\s+/g, ' ').slice(0, 200)
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
        // 用户主动「清空」后抑制「exprId 为空时自动载入最新任务」，防止清空被自动恢复覆盖；
        // 面板重开时重置，恢复「打开面板自动载入最新任务」的原行为。
        const suppressAutoLoadRef = useRef(false)
        // v1.5: locale（中/英 i18n）+ M4 手动审核框 + 一键收口 + busy 动作标记
        const [locale, setLocale] = useState(loadLocale)
        const [manualReview, setManualReview] = useState(null)   // { exprId, stepId, step, fallbackReason, traceText } | null
        const [manualReviewComment, setManualReviewComment] = useState('')
        const [showReviewTrace, setShowReviewTrace] = useState(false)
        const [finalSummary, setFinalSummary] = useState(null)
        const [stepBusyAction, setStepBusyAction] = useState('')
        // v1.7: low 优先级步骤详情展开状态 + 候选方案展开状态（均按 stepId 记录）
        const [lowExpanded, setLowExpanded] = useState({})
        const [altOpen, setAltOpen] = useState({})
        // v1.6/v1.7/v1.8: 协议版本选择（v1.5 线性 / v1.6 DAG 并发 / v1.7 智能编排 / v1.8 混合模式），localStorage 持久化
        const [protocolVersion, setProtocolVersion] = useState(() => {
          try {
            const v = localStorage.getItem('dsh-web-relay:protocol-version')
            if (v === 'v1.6' || v === 'v1.7' || v === 'v1.8' || v === 'v1.9') return v
          } catch (e) { /* ignore */ }
          return 'v1.5'
        })
        // v1.8: 重构 Step List UI 状态（展开开关 / textarea 输入 / busy）
        const [restructureOpen, setRestructureOpen] = useState(false)
        const [restructureText, setRestructureText] = useState('')
        const [restructureBusy, setRestructureBusy] = useState(false)

      const workspacePath = props.useWorkspaces ? props.useWorkspaces(recentWorkspacePath) : null
      // sessionId: the RAW value of useSessions((st) => st.current) — a SessionId string, not an object.
      let sessionId = ''
      try {
        sessionId = props && props.useSessions
          ? props.useSessions((st) => st.current) || ''
          : ''
      } catch (err) { sessionId = '' }

      // v1.5: 语言持久化（localStorage）+ 当前字典 T + 切换；busyLabel 给按钮 busy 文案加 '…'
      useEffect(() => {
        try { localStorage.setItem(LOCALE_KEY, locale) } catch (e) { /* ignore */ }
      }, [locale])
      // v1.6: 协议版本持久化
      useEffect(() => {
        try { localStorage.setItem('dsh-web-relay:protocol-version', protocolVersion) } catch (e) { /* ignore */ }
      }, [protocolVersion])
      const T = localeDict[locale] || localeDict.zh
      const toggleLocale = () => setLocale((l) => (l === 'zh' ? 'en' : 'zh'))
      const busyLabel = (action, label) => (stepBusy && stepBusyAction === action) ? label + '…' : label

      // Step 2: auto-mount the three-party protocol every time the panel opens,
      // so a new session/workspace never degrades to a plain chat AI.
      useEffect(() => {
        if (!open) return
        let cancelled = false
        fetch('/dsh-web-relay/protocol')
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => { if (!cancelled && d && d.ok) setProtocol({ version: d.version, text: d.text, v16: d.protocolV16 || null, v17: d.protocolV17 || null, v18: d.protocolV18 || null, v19: d.protocolV19 || null, en: d.en || null }) })
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
        setManualReview(null); setManualReviewComment(''); setShowReviewTrace(false); setFinalSummary(null)
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

        // v1.3: when no exprId is known yet, auto-load the latest task's Step List
        // state from the workspace context so reopening the panel shows persisted
        // statuses. Suppressed right after an explicit 清空 (see suppressAutoLoadRef).
        useEffect(() => {
          if (!open || exprId || suppressAutoLoadRef.current) return
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

        // 面板重开时重置抑制标记（保留「打开面板自动载入最新任务」）
        useEffect(() => {
          if (open) suppressAutoLoadRef.current = false
        }, [open])



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
          // v1.6: /context 可能同时返回 protocolV16（{version,text,skill}）——
          // 当前选择 v1.6 时优先用 protocolV16，否则退回 v1.5 的 protocol；
          // 界面语言为 en 时使用后端英文协议文本（data.en）。
          const localeCtx = (locale === 'en' && data.en) ? data.en : null
          const pickProtocol = (v15, v16, v17, v18, v19) => {
            if (protocolVersion === 'v1.9' && v19) return v19
            if (protocolVersion === 'v1.8' && v18) return v18
            if (protocolVersion === 'v1.7' && v17) return v17
            if (protocolVersion === 'v1.6' && v16) return v16
            return v15
          }
          const ctxProto = pickProtocol(
            (localeCtx ? localeCtx.protocol : data.protocol) || (protocol && (locale === 'en' && protocol.en ? protocol.en.protocol : protocol)),
            (localeCtx ? localeCtx.protocolV16 : data.protocolV16) || (protocol && protocolVersion === 'v1.6' && locale === 'en' && protocol.en ? protocol.en.protocolV16 : null),
            (localeCtx ? localeCtx.protocolV17 : data.protocolV17) || (protocol && protocolVersion === 'v1.7' && locale === 'en' && protocol.en ? protocol.en.protocolV17 : null),
            (localeCtx ? localeCtx.protocolV18 : data.protocolV18) || (protocol && protocolVersion === 'v1.8' && locale === 'en' && protocol.en ? protocol.en.protocolV18 : null),
            (localeCtx ? localeCtx.protocolV19 : data.protocolV19) || (protocol && protocolVersion === 'v1.9' && locale === 'en' && protocol.en ? protocol.en.protocolV19 : null)
          )
          const ctxSkill = (localeCtx ? localeCtx.skill : data.skill) || null
          // v1.9: 优先取 protocolV19 全文，其次 v1.8 的 protocolV18，再 v1.7 的 protocolV17，再 v1.6 的 protocolV16，退回 v1.5 protocol
          const v19 = (protocolVersion === 'v1.9' && (localeCtx ? localeCtx.protocolV19 : data.protocolV19)) ? (localeCtx ? localeCtx.protocolV19 : data.protocolV19) : null
          const v18 = (protocolVersion === 'v1.8' && (localeCtx ? localeCtx.protocolV18 : data.protocolV18)) ? (localeCtx ? localeCtx.protocolV18 : data.protocolV18) : null
          const v17 = (protocolVersion === 'v1.7' && (localeCtx ? localeCtx.protocolV17 : data.protocolV17)) ? (localeCtx ? localeCtx.protocolV17 : data.protocolV17) : null
          const v16 = (protocolVersion === 'v1.6' && (localeCtx ? localeCtx.protocolV16 : data.protocolV16)) ? (localeCtx ? localeCtx.protocolV16 : data.protocolV16) : null
          let protocolText = ''
          if (v19 && v19.text) {
            protocolText = v19.text
          } else if (v18 && v18.text) {
            protocolText = v18.text
          } else if (v17 && v17.text) {
            protocolText = v17.text
          } else if (v16 && v16.text) {
            protocolText = v16.text
          } else if (ctxProto && ctxProto.text) {
            protocolText = ctxProto.text
          } else if (protocol && protocol.text) {
            protocolText = protocol.text
          }
          if (!protocolText) {
            protocolText = '三方主体（web-relay 语境）：用户 (the human) / 主 agent (the tool-using agent in the main harness session，负责执行与收口) / 外部AI (external web AI — Gemini/DeepSeek 网页版或 free API，负责提供方案与回答)。任务记录在 web-relay/experiments/，三方轨迹在 web-relay/traces/。复杂任务需输出 json:agent-action + 结构化 steps，主 agent 逐步执行并由外部 AI 审核。（/dsh-web-relay/protocol 不可用时的兜底文本）'
          }
          const v16Skill = (v16 && v16.skill && v16.skill.text) ? v16.skill.text : null
          const skillText = (v16Skill ? v16Skill : (ctxSkill && ctxSkill.text ? ctxSkill.text : (data.skill && data.skill.text ? data.skill.text : null)))
          const lines = [
            '【三方协作机制（web-relay 语境，每次回答都必须遵循）】',
            protocolVersion === 'v1.9' ? T.protoV19Directive : protocolVersion === 'v1.8' ? T.protoV18Directive : protocolVersion === 'v1.7' ? T.protoV17Directive : protocolVersion === 'v1.6' ? T.protoV16Directive : T.protoV15Directive,
            ...protocolText.split('\n'),
            // v1.7 T5 / v1.8: 5 段式打包模板（v1.7/v1.8 注入：data_schema / pricing_map / mount_points / runtime_limits / history_trace，键名固定严禁省略）
            ...(protocolVersion === 'v1.7' || protocolVersion === 'v1.8' || protocolVersion === 'v1.9' ? [
              '',
              '【' + T.tmplHeader + '】',
              '- data_schema: ' + T.tmplDataSchema,
              '- pricing_map: ' + T.tmplPricingMap,
              '- mount_points: ' + T.tmplMountPoints,
              '- runtime_limits: ' + T.tmplRuntimeLimits,
              '- history_trace: ' + T.tmplHistoryTrace,
              T.tmplNA
            ] : []),
            '',
            '【外部 AI Skill：web_relay_external_ai_protocol（本协议的细化执行规范，必须遵循）】',
            ...(skillText ? skillText.split('\n') : []),
            '',
            '【项目上下文】',
            'workspace: ' + (workspacePath || '(未知)'),
            '最近任务:'
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
                lines.push((T.roleLabel[e.role] || e.role) + ': ' + String(e.text || '').replace(/\s+/g, ' ').slice(0, 300))
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
            else setTraceError('任务记录读取失败')
          } catch (e) { setTraceError(String(e?.message || e)) }
        }
      }

      // load the trace page on first visit
      useEffect(() => {
        if (tab === 'trace' && traces === null) loadTraces()
      }, [tab])

      // manual: submit → parse → preview (or plain save when no instructions)
      const submitManual = async () => {
        if (!pasted.trim()) { setError(T.manualNeedPaste); return }
        setError(''); setSending(true); setPhase('parsing'); setAnswer(''); setSavedPath('')
        try {
          const resp = await fetch('/dsh-web-relay/parse', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: pasted, workspacePath, protocolVersion })
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
            body: JSON.stringify({ provider: 'manual', prompt, answer: pasted, workspacePath, protocolVersion })
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
              sessionId,
              protocolVersion
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
        // v1.5: 返回 boolean 供手动审核框判断成功；busy 时记录动作以显示 '…' 文案
        const callStepUpdate = async (stepId, action, commentText) => {
          if (!exprId) { setError('缺少 exprId，请先执行保存/执行'); return false }
          setStepBusy(true); setError(''); setStepBusyAction(action)
          try {
            const role = (action === 'approve' || action === 'reject') ? 'external' : 'mainagent'
            const resp = await fetch('/dsh-web-relay/steps/update', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ workspacePath, exprId, stepId, action, comment: commentText || '', role, sessionId, protocolVersion })
            })
            const data = await resp.json().catch(() => ({ ok: false, error: 'bad response' }))
            if (!data.ok) { setError(data.error || 'step update failed'); return false }
            setStepState(data.stepState || null)
            if (data.stepState && Array.isArray(data.stepState.steps)) setSteps(data.stepState.steps)
            if (data.stepState && data.stepState.autoReview && action === 'complete') {
              setTimeout(() => autoReviewStep(stepId), 300)
            }
            if (data.wake && !data.wake.agentWoken) {
              setError('状态已更新，但未能自动唤醒主 agent：' + (data.wake.reason || '未知原因'))
            } else if (data.artifactsWarning) {
              // v1.7 T4: complete 时 artifacts 为空 → 警告外部 AI 可能打回（warnStyle 顶部提示）
              setError(T.artifactsWarning)
            }
            setStepComment('')
            return true
          } catch (e) { setError(String(e?.message || e)); return false }
          finally { setStepBusy(false); setStepBusyAction('') }
        }

        // v1.3 auto-review: ask the server to call the configured external AI.
        // v1.5 M4: 支持降级到手动（manual:true → 展开手动审核框）与状态锁跳过（skipped）。
        const autoReviewStep = async (stepId) => {
          if (!exprId) { setError('缺少 exprId，请先执行保存/执行'); return }
          setStepBusy(true); setError(''); setStepBusyAction('autoReview')
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 30000)
          try {
            const resp = await fetch('/dsh-web-relay/steps/auto-review', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ workspacePath, exprId, stepId, sessionId, protocolVersion }),
              signal: controller.signal
            })
            const data = await resp.json().catch(() => ({ ok: false, error: 'bad response' }))
            if (!data.ok) {
              const errText = data.error || 'auto review failed'
              setError(/429|RESOURCE_EXHAUSTED|quota|limit/i.test(errText) ? 'Gemini 限流，请稍后重试：' + errText : errText)
              return
            }
            if (data.skipped) {
              // 状态锁跳过：仅提示，不破坏当前 Step List 展示
              setError(data.error || 'auto review skipped')
              return
            }
            if (data.manual) {
              // 降级到手动：展开手动审核框（acceptance + 轨迹摘要 + 意见 + 通过/打回）
              setManualReview({
                exprId: data.exprId || exprId,
                stepId: data.stepId || stepId,
                step: data.step || null,
                fallbackReason: data.fallbackReason || '',
                traceText: data.traceText || ''
              })
              setManualReviewComment('')
              setShowReviewTrace(false)
              return
            }
            setStepState(data.stepState || null)
            if (data.stepState && Array.isArray(data.stepState.steps)) setSteps(data.stepState.steps)
            if (data.wake && !data.wake.agentWoken) {
              setError('自动审核完成，但未能自动唤醒主 agent：' + (data.wake.reason || '未知原因'))
            }
          } catch (e) { setError(String(e?.message || e)) }
          finally { setStepBusy(false); setStepBusyAction('') }
        }

        // v1.7 T2: 批量自动审核 —— 收集 review 的 low/medium 步骤，batchStepIds 一次交给后端逐个审。
        // 后端响应 { ok, batchResults: [{stepId, status, reviewedBy, manual?}], stepState }。
        const batchAutoReview = async () => {
          if (!exprId) { setError('缺少 exprId，请先执行保存/执行'); return }
          const cands = (steps || []).filter((s) => s.status === 'review')
          const pref = cands.filter((s) => s.importance === 'low' || s.importance === 'medium')
          const targets = pref.length > 0 ? pref : cands
          const ids = targets.map((s) => String(s.id))
          if (ids.length < 2) { setError('批量自动审核需要至少 2 个待审核步骤'); return }
          setStepBusy(true); setError(''); setStepBusyAction('batchReview')
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 60000)
          try {
            const resp = await fetch('/dsh-web-relay/steps/auto-review', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ workspacePath, exprId, sessionId, protocolVersion, batchStepIds: ids }),
              signal: controller.signal
            })
            const data = await resp.json().catch(() => ({ ok: false, error: 'bad response' }))
            if (!data.ok) {
              const errText = data.error || 'batch auto review failed'
              setError(/429|RESOURCE_EXHAUSTED|quota|limit/i.test(errText) ? 'Gemini 限流，请稍后重试：' + errText : errText)
              return
            }
            // batchResults 逐个处理：任一 manual 降级 → 展开手动审核框（取第一个 manual）
            const results = Array.isArray(data.batchResults) ? data.batchResults : []
            // v1.8: 原子打回标记（后端顶层 atomicRejected 字段，或 batchResults 内任一 atomicRejected:true）
            const atomicHit = data.atomicRejected === true || results.some((r) => r && r.atomicRejected === true)
            const manualHit = results.find((r) => r && r.manual)
            if (manualHit) {
              const step = (data.stepState && Array.isArray(data.stepState.steps))
                ? data.stepState.steps.find((x) => String(x.id) === String(manualHit.stepId))
                : null
              setManualReview({
                exprId: data.exprId || exprId,
                stepId: manualHit.stepId,
                step: step || null,
                fallbackReason: (data.fallbackReason || '') + (manualHit.reason ? manualHit.reason : ''),
                traceText: data.traceText || ''
              })
              setManualReviewComment('')
              setShowReviewTrace(false)
            }
            setStepState(data.stepState || null)
            if (data.stepState && Array.isArray(data.stepState.steps)) setSteps(data.stepState.steps)
            if (atomicHit) {
              // v1.8: 批量审核原子打回（同批任一 rejected → 全 batch 退回 rejected，前端提示后仍正常刷新步骤展示）
              setError(T.batchAtomicReject)
            } else if (data.wake && !data.wake.agentWoken) {
              setError('批量自动审核完成，但未能自动唤醒主 agent：' + (data.wake.reason || '未知原因'))
            }
          } catch (e) { setError(String(e?.message || e)) }
          finally { setStepBusy(false); setStepBusyAction('') }
        }

        // v1.8 H: 重构 Step List（POST /dsh-web-relay/steps/restructure，仅对 pending/rejected 生效，approved 步骤与产物保留）
        const applyRestructure = async () => {
          if (!exprId) { setError('缺少 exprId，请先执行保存/执行'); return }
          let parsed
          try {
            parsed = JSON.parse(restructureText)
          } catch (e) {
            setError('重构 JSON 解析失败：' + String(e && e.message ? e.message : e))
            return
          }
          if (!Array.isArray(parsed)) { setError('重构输入必须是 steps JSON 数组'); return }
          setRestructureBusy(true); setError('')
          try {
            const resp = await fetch('/dsh-web-relay/steps/restructure', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ workspacePath, exprId, steps: parsed })
            })
            const data = await resp.json().catch(() => ({ ok: false, error: 'bad response' }))
            if (!data.ok) { setError(data.error || 'restructure failed'); return }
            const changes = (data.changes && typeof data.changes === 'object') ? data.changes : {}
            if (data.stepState) {
              setStepState(data.stepState)
              if (Array.isArray(data.stepState.steps)) setSteps(data.stepState.steps)
            }
            // 用 changes 填充 {updated}/{added}/{removed}/{untouched}
            const msg = T.restructureResult
              .replace('{updated}', String(changes.updated != null ? changes.updated : 0))
              .replace('{added}', String(changes.added != null ? changes.added : 0))
              .replace('{removed}', String(changes.removed != null ? changes.removed : 0))
              .replace('{untouched}', String(changes.untouched != null ? changes.untouched : 0))
            setError(msg)
            setRestructureOpen(false)
            setRestructureText('')
          } catch (e) { setError(String(e && e.message ? e.message : e)) }
          finally { setRestructureBusy(false) }
        }

        // v1.5 M4: 手动审核框提交（approve/reject 走 steps/update，后端标记 reviewedBy='manual'）
        const submitManualReview = async (action) => {
          if (!manualReview) return
          const ok = await callStepUpdate(manualReview.stepId, action, (manualReviewComment || '').trim())
          if (ok) { setManualReview(null); setManualReviewComment(''); setShowReviewTrace(false) }
        }

        // v1.5 M4: 一键收口（status=done 时收口任务，汇总审核来源）
        const finalizeTask = async () => {
          if (!exprId) { setError('缺少 exprId，请先执行保存/执行'); return }
          setStepBusy(true); setError(''); setStepBusyAction('finalize')
          try {
            const resp = await fetch('/dsh-web-relay/steps/finalize', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ workspacePath, exprId, sessionId, protocolVersion })
            })
            const data = await resp.json().catch(() => ({ ok: false, error: 'bad response' }))
            if (!data.ok) { setError(data.error || 'finalize failed'); return }
            if (data.summary) setFinalSummary(data.summary)
            if (data.state) {
              setStepState(data.state)
              if (Array.isArray(data.state.steps)) setSteps(data.state.steps)
            }
            if (data.wake && !data.wake.agentWoken) {
              setError('收口完成，但未能自动唤醒主 agent：' + (data.wake.reason || '未知原因'))
            }
            refreshStepState()
          } catch (e) { setError(String(e?.message || e)) }
          finally { setStepBusy(false); setStepBusyAction('') }
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
              body: JSON.stringify({ workspacePath, exprId, stepId, action: 'set_auto_review', autoReview: next, role: 'user', sessionId, protocolVersion })
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
              body: JSON.stringify({ workspacePath, exprId, stepId, action: 'set_phase', phase: nextPhase, role: 'user', sessionId, protocolVersion })
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
            setManualReview(null); setManualReviewComment(''); setShowReviewTrace(false)
            setFinalSummary(null)
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

        // v1.3: clear the loaded Step List display and the load input (start fresh).
        // 抑制「exprId 为空自动载入最新任务」，清空后不会自动恢复；点「刷新」才回到最新任务。
        const clearStepState = () => {
          suppressAutoLoadRef.current = true
          setStepLoadId('')
          setSteps(null)
          setStepState(null)
          setExprId('')
          setStepComment('')
          setStepBusy(false)
          setManualReview(null); setManualReviewComment(''); setShowReviewTrace(false)
          setFinalSummary(null)
        }

        // v1.3: load the LATEST task's Step List + current state from the workspace
        // context（刷新 = 回到最新任务，无论当前显示的是哪个任务）。
        const loadLatestTask = async () => {
          try {
            const resp = await fetch('/dsh-web-relay/context?cwd=' + encodeURIComponent(workspacePath || ''))
            const data = await resp.json().catch(() => null)
            if (!data || !data.ok || !Array.isArray(data.stepStates) || data.stepStates.length === 0) return
            const latest = data.stepStates[0]
            if (!latest || !Array.isArray(latest.steps)) return
            setExprId(latest.exprId || '')
            setSteps(latest.steps)
            setStepState(latest)
            setStepLoadId('')
            setManualReview(null); setManualReviewComment(''); setShowReviewTrace(false)
            setFinalSummary(null)
          } catch (e) { /* ignore */ }
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
            body: JSON.stringify({ provider: 'gemini-free', prompt: architectMode ? '[MODE: ARCHITECT_PLANNING_v1.4]\n' + prompt : prompt, answer: '', workspacePath, sessionId, protocolVersion })
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
          const rawNext = startWidth + (startX - ev.clientX)
          // v1.5 M6: 拖到 <180px 自动折叠为 rail（结束拖拽，避免宽度被最小值钳住）
          if (rawNext < 180) {
            setCollapsed(true)
            onUp()
            return
          }
          const next = Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, rawNext))
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


        // v1.5 T1: M3 流程进度看板计算（当前步 = 第一个 executing/review 的 step，否则取已完成数）
        const progSteps = (steps && Array.isArray(steps)) ? steps : []
        const progTotal = progSteps.length
        const progCurrent = progSteps.find((s) => s.status === 'executing' || s.status === 'review')
        let progPos = progCurrent ? progSteps.indexOf(progCurrent) + 1 : progSteps.filter((s) => s.status === 'approved').length
        if (progTotal > 0) progPos = Math.min(progTotal, Math.max(1, progPos))
        const progPhase = (stepState && stepState.phase) || ''
        let progBadge = T.progressWaiting
        let progBadgeColor = 'var(--dsw-alias-label-secondary, #a1a1aa)'
        if (stepState && stepState.status === 'stopped') { progBadge = T.badgeStopped; progBadgeColor = '#f87171' }
        else if (progPhase === 'planning') { progBadge = T.badgePlanning; progBadgeColor = 'var(--dsw-alias-state-warn-primary, #fbbf24)' }
        else if (progCurrent && progCurrent.status === 'review') { progBadge = T.badgeWaitReview; progBadgeColor = 'var(--dsw-alias-state-warn-primary, #fbbf24)' }
        else if (progCurrent && progCurrent.status === 'executing') { progBadge = T.badgeExecuting; progBadgeColor = '#60a5fa' }
        else if (progTotal > 0 && progSteps.every((s) => s.status === 'approved')) { progBadge = T.badgeDone; progBadgeColor = '#4ade80' }

        // v1.6: 就绪步骤数（pending 且 depends_on 均已 approved；无 depends_on 视为就绪）。
        // 仅 v1.6 显示——线性 v1.5 下该语义无意义。
        const progReadyCount = protocolVersion === 'v1.6'
          ? progSteps.filter((s) => {
              if (s.status !== 'pending') return false
              if (!Array.isArray(s.depends_on) || s.depends_on.length === 0) return true
              const approvedIds = {}
              for (const x of progSteps) if (x.status === 'approved') approvedIds[String(x.id)] = true
              return s.depends_on.every((d) => approvedIds[String(d)])
            }).length
          : -1

        // v1.7 T2: 批量自动审核候选（status=review 且 importance low/medium；无 low/medium 时回退全部 review）
        const batchCandidates = progSteps.filter((s) => s.status === 'review' && (s.importance === 'low' || s.importance === 'medium'))
        const batchReviewTargets = batchCandidates.length > 0 ? batchCandidates : progSteps.filter((s) => s.status === 'review')


      // footer actions depend on phase
      let footer = null
      if (provider === 'gemini-free') {
        const stopped = stepState && stepState.status === 'stopped'
        footer = h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', width: '100%' } },
          h('button', { onClick: submitGemini, disabled: sending, style: { ...btnStyle, opacity: sending ? 0.6 : 1 } },
            sending ? T.btn.asking : T.btn.ask),
          exprId && !stopped && h('button', {
            onClick: stopExperiment,
            disabled: sending,
            className: 'dwr-ghost', style: { ...ghostRed, opacity: sending ? 0.6 : 1 }
          }, T.btn.stop),
          exprId && stopped && h('button', {
            onClick: resumeExperiment,
            disabled: sending,
            className: 'dwr-ghost', style: { ...btnGhostStyle, opacity: sending ? 0.6 : 1 }
          }, T.btn.resume)
        )
      } else if (phase === 'input' || phase === 'parsing') {
        footer = h('button', { onClick: submitManual, disabled: sending || phase === 'parsing', style: { ...btnStyle, opacity: (sending || phase === 'parsing') ? 0.6 : 1 } },
          (phase === 'parsing') ? T.parsing : T.parsePreview)
      } else if (phase === 'preview') {
        footer = h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', width: '100%' } },
          h('button', { onClick: () => execute([]), disabled: sending, className: 'dwr-ghost', className: 'dwr-ghost', style: { ...btnGhostStyle, opacity: sending ? 0.6 : 1 } },
            sending ? T.saving : T.saveOnly),
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
          onClick: () => { setActions(null); setChecks({}); setNeedsAgent(null); setExecResults(null); setSteps(null); setStepState(null); setExprId(''); setStepComment(''); setPhase('input'); setSavedPath(''); setManualReview(null); setManualReviewComment(''); setShowReviewTrace(false); setFinalSummary(null) },
          style: btnGhostStyle
        }, T.btn.newChat)
      }

      if (collapsed) return h('div', { className: 'dwr-rail', onClick: () => setCollapsed(false), title: T.railExpand, 'aria-label': 'expand dsh-web-relay panel' }, '◀')
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
          h('strong', { style: { fontWeight: 600, fontSize: 12, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, T.title),
          h('div', { style: { display: 'flex', gap: 4, alignItems: 'center', flex: '0 0 auto' } },
            h('button', {
              onClick: (e) => { stop(e); toggleLocale() },
              'aria-label': T.btn.langTitle,
              title: T.btn.langTitle,
              style: { background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 12, padding: '0 4px' }
            }, T.btn.langBtn),
            h('button', {
              onClick: (e) => { stop(e); setCollapsed(true) },
              'aria-label': T.btn.minimize,
              title: T.btn.minimize,
              style: { background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14 }
            }, T.btn.minimize),
            h('button', { onClick: (e) => { stop(e); dispatchToggle() }, 'aria-label': T.btn.close, title: T.btn.close, style: { background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' } }, T.btn.close)
          )
        ),
        // v0.5: tab bar (experiment form | three-party trace page)
        !collapsed &&
        h('div', { style: { display: 'flex', gap: 0, marginBottom: 8, borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))' } },
          h('button', { onClick: () => setTab('main'), style: tab === 'main' ? tabActiveStyle : tabBtnStyle }, T.tabChat),
          h('button', { onClick: () => setTab('trace'), style: tab === 'trace' ? tabActiveStyle : tabBtnStyle }, T.tabTrace)
        ),
        !collapsed && tab === 'main' &&
        h('div', { style: panelBodyStyle },
          config && !config.geminiConfigured
            ? h('div', { style: warnStyle }, T.geminiNotConfigured)
            : (config && h('div', { style: hintStyle }, `${T.configVersion}${config.version || '?'} · ${config.geminiConfigured ? T.configReady + ' · model: ' + config.model : T.configNotReady} · shell: ${config.shellAvailable ? '✓' : '✗'} · apiProxy: ${config.apiProxyAvailable ? '✓' : '✗'}`)),
          // 协议版本选择 + 可展开全文（中/英随界面语言；打包上下文与 Step 实施按所选版本执行）
          protocol && h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, margin: '2px 0' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              h('select', {
                value: protocolVersion,
                onChange: (e) => setProtocolVersion(e.target.value),
                title: T.protoTitle,
                'aria-label': T.protoTitle,
                style: protoSelectStyle
              },
                h('option', { value: 'v1.5' }, T.protoV15),
                h('option', { value: 'v1.6' }, T.protoV16),
                h('option', { value: 'v1.7' }, T.protoV17),
                h('option', { value: 'v1.8' }, T.protoV18),
                h('option', { value: 'v1.9' }, T.protoV19)
              ),
              h('button', {
                onClick: () => setShowProtocol(!showProtocol),
                style: { background: 'none', border: 'none', color: 'var(--dsw-alias-label-secondary, #a1a1aa)', cursor: 'pointer', fontSize: 12, padding: 0, fontFamily: 'inherit' }
              }, (showProtocol ? T.protocolCollapse : T.protocolExpand) + ' ' + (protocolVersion === 'v1.9' && protocol.v19 ? 'v1.9' : protocolVersion === 'v1.8' && protocol.v18 ? 'v1.8' : protocolVersion === 'v1.6' && protocol.v16 ? 'v1.6' : protocolVersion === 'v1.7' && protocol.v17 ? 'v1.7' : 'v1.5'))
            ),
            showProtocol && h('div', { style: { ...preStyle, marginTop: 0, maxHeight: 160, fontSize: 12, width: '100%', boxSizing: 'border-box' } },
              (() => {
                const active = (locale === 'en' && protocol.en) ? protocol.en : protocol
                const pick = protocolVersion === 'v1.9' && active.protocolV19 ? active.protocolV19
                  : protocolVersion === 'v1.8' && active.protocolV18 ? active.protocolV18
                  : protocolVersion === 'v1.6' && active.protocolV16 ? active.protocolV16
                  : protocolVersion === 'v1.7' && active.protocolV17 ? active.protocolV17
                  : active.protocol
                return pick ? pick.text : protocol.text
              })())
          ),
          h('select', {
            value: provider,
            onChange: (e) => setProvider(e.target.value),
            style: { ...inputStyle, width: 'auto' }
          },
            h('option', { value: 'manual' }, T.providerManual),
            h('option', { value: 'gemini-free' }, T.providerGemini)
          ),
          provider === 'manual'
            ? h('div', { style: hintStyle }, T.manualHint)
            : h('div', { style: hintStyle }, T.geminiHint),
          h('textarea', {
            value: prompt,
            onChange: (e) => setPrompt(e.target.value),
            onKeyDown: onEnterSubmit,
            placeholder: T.promptPlaceholder,
            rows: 2, style: inputStyle
          }),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0' } },
            h('button', { onClick: packContext, style: btnStyle }, T.btn.packContext),
              h('button', { onClick: () => setArchitectMode(!architectMode), className: 'dwr-ghost', style: architectMode ? ghostPurple : btnGhostStyle }, architectMode ? T.architectOn : T.architectOff),
            contextCopied && h('span', { style: { ...savedStyle, marginTop: 0 } }, T.copiedHint),
            !contextCopied && contextText && h('span', { style: hintStyle }, T.clipboardUnavailable)
          ),
          contextText && h('div', { style: { margin: '4px 0' } },
            h('button', {
              onClick: () => setShowContextPreview(!showContextPreview),
              style: { background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: 12, padding: 0 }
            }, showContextPreview ? T.btn.collapsePreview : T.btn.expandPreview),
            showContextPreview && h('div', { style: preStyle }, contextText)
          ),
          provider === 'manual' &&
            h('textarea', {
              value: pasted,
              onChange: (e) => setPasted(e.target.value),
              onKeyDown: onEnterSubmit,
              placeholder: T.pastePlaceholder,
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
                  }, T.btn.copyHandoff)
                ),
            needsAgent.handoffText && h('div', { style: { ...preStyle, marginTop: 6, maxHeight: 160 } }, needsAgent.handoffText)
          ),

            // v1.3: always allow loading an existing Step List by expr id,
              // v1.4: planning phase helper — paste executing reply below or switch phase.
              stepState && stepState.phase === 'planning' && h('div', { style: { marginTop: 8, border: '1px solid #f59e0b', borderRadius: 6, padding: 8, background: 'rgba(245,158,11,.06)' } },
                h('div', { style: { color: '#fbbf24', fontWeight: 600, fontSize: 12 } }, T.planningCardTitle),
                h('div', { style: { ...hintStyle, marginTop: 4 } }, T.planningCardHint),
                h('button', { onClick: () => setExperimentPhase('executing'), disabled: stepBusy, style: { ...btnStyle, padding: '4px 10px', fontSize: 12, marginTop: 4 } }, T.btn.enterExec)
              ),

            // v1.5 T1: M3 流程进度看板（有 stepState/steps 时显示在 tab 之下、Step List 载入卡片之上）
            stepState && steps && steps.length > 0 && h('div', {
              style: { marginTop: 8, border: '1px solid var(--dsw-alias-border-l1, #3f3f46)', borderRadius: 6, padding: '6px 8px', background: 'var(--dsw-alias-bg-layer-1, rgba(24,24,27,.5))' }
            },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-primary, #e4e4e7)' } },
                  T.progressStep + ' ',
                  h('span', { style: { color: 'var(--dsw-alias-brand-primary, #3b82f6)', fontWeight: 700 } }, String(progPos)),
                  '/' + String(progTotal)
                ),
                h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #a1a1aa)' } },
                  '· ' + T.phaseLabel + ': ' + (T.phase[progPhase] || progPhase || '—')),
                protocolVersion === 'v1.6' && progReadyCount >= 0 && h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #a1a1aa)' } },
                  '· ' + T.progressReady + ': ' + String(progReadyCount)),
                h('span', { style: { fontSize: 12, fontWeight: 600, color: progBadgeColor } }, '· ' + progBadge)
              ),
              h('div', { style: { marginTop: 4, height: 4, borderRadius: 2, background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,.2))', overflow: 'hidden' } },
                h('div', { style: { height: '100%', width: (progTotal > 0 ? (progPos / progTotal) * 100 : 0) + '%', background: 'var(--dsw-alias-brand-primary, #3b82f6)', borderRadius: 2, transition: 'width .3s ease' } })
              )
            ),
            // even when the current panel state is empty after a restart.
            h('div', { style: { marginTop: 8, border: '1px solid var(--dsw-alias-border-l1, #3f3f46)', borderRadius: 6, padding: 8 } },
              h('div', { style: { ...hintStyle, fontWeight: 600, color: '#93c5fd' } }, T.stepListLoad),
              h('div', { style: { display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' } },
                h('input', {
                  value: stepLoadId,
                  onChange: (e) => setStepLoadId(e.target.value),
                  placeholder: T.loadPlaceholder,
                  style: { ...inputStyle, margin: 0, flex: 1, fontSize: 12 }
                }),
                h('button', { onClick: () => loadStepState(stepLoadId), disabled: stepBusy, className: 'dwr-ghost', style: { ...btnGhostStyle, padding: '4px 10px', fontSize: 12 } }, T.btn.load),
                h('button', { onClick: () => loadLatestTask(), disabled: stepBusy, className: 'dwr-ghost', style: { ...btnGhostStyle, padding: '4px 10px', fontSize: 12 } }, T.btn.refresh),
                h('button', { onClick: clearStepState, disabled: stepBusy, className: 'dwr-ghost', style: { ...btnGhostStyle, padding: '4px 10px', fontSize: 12 } }, T.btn.clear)
              )
            ),

            // v1.3: Step List execution + external-AI review
            steps && steps.length > 0 && h('div', { style: { marginTop: 8, border: '1px solid var(--dsw-alias-border-l1, #3f3f46)', borderRadius: 6, padding: 8 } },
              h('div', { style: { ...hintStyle, fontWeight: 600, color: '#93c5fd' } }, T.stepListExec),
                stepState && stepState.phase && h('span', { style: { fontSize: 11, color: stepState.phase === 'planning' ? '#f59e0b' : '#4ade80', marginLeft: 6 } }, '· ' + T.phaseLabel + ': ' + (T.phase[stepState.phase] || stepState.phase)),
                stepState && stepState.autoReview && h('span', { style: { fontSize: 11, color: '#7c3aed', marginLeft: 6 } }, '· ' + T.autoReviewModeLabel),
                  h('button', { onClick: toggleAutoReview, disabled: stepBusy, className: 'dwr-ghost', style: { ...btnGhostStyle, padding: '2px 8px', fontSize: 11, marginLeft: 6 } }, stepState && stepState.autoReview ? T.btn.autoReviewOn : T.btn.autoReviewOff),
                  stepState && stepState.phase === 'planning' && h('button', { onClick: () => setExperimentPhase('executing'), disabled: stepBusy, className: 'dwr-ghost', style: { ...btnGhostStyle, padding: '2px 8px', fontSize: 11, marginLeft: 6 } }, T.btn.enterExec),
                  // v1.7 T2: 批量自动审核（≥2 个 review 的 low/medium 步骤时显示，ghostPurple）
                  batchReviewTargets.length >= 2 && h('button', {
                    onClick: batchAutoReview,
                    disabled: stepBusy,
                    className: 'dwr-ghost',
                    style: { ...ghostPurple, padding: '2px 8px', fontSize: 11, marginLeft: 6 }
                  }, (stepBusy && stepBusyAction === 'batchReview') ? T.batchReview + '…' : T.batchReview),
                  // v1.8 H: 重构 Step List 入口（展开 textarea 粘贴新 steps JSON 数组）
                  h('button', {
                    onClick: () => setRestructureOpen(!restructureOpen),
                    disabled: stepBusy,
                    className: 'dwr-ghost',
                    style: { ...ghostPurple, padding: '2px 8px', fontSize: 11, marginLeft: 6 }
                  }, T.restructureBtn),
                // 载入/刷新统一在上方「Step List 载入」卡片（含刷新）；此处不再重复载入输入框

              // v1.8 H: 重构输入区（textarea + 应用重构按钮；JSON 解析失败提示，成功后用返回 stepState.steps 更新展示）
              restructureOpen && h('div', { style: { marginTop: 6, border: '1px solid rgba(167,139,250,.4)', borderRadius: 6, padding: 6, background: 'rgba(167,139,250,.06)' } },
                h('textarea', {
                  value: restructureText,
                  onChange: (e) => setRestructureText(e.target.value),
                  placeholder: T.restructurePlaceholder,
                  rows: 3,
                  style: { ...inputStyle, margin: 0, fontSize: 12, fontFamily: 'monospace' }
                }),
                h('div', { style: { display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' } },
                  h('button', {
                    onClick: applyRestructure,
                    disabled: restructureBusy || !restructureText.trim(),
                    className: 'dwr-ghost',
                    style: { ...ghostPurple, padding: '4px 10px', fontSize: 12, opacity: (restructureBusy || !restructureText.trim()) ? 0.6 : 1 }
                  }, restructureBusy ? T.restructureApply + '…' : T.restructureApply)
                )
              ),

              steps.map((s) => {
                // v1.7 T1: importance 徽标 + low 步骤默认折叠（仅标题行，可展开）
                const lowStep = s.importance === 'low'
                const lowOpen = !!lowExpanded[String(s.id)]
                return h('div', { key: s.id, style: { marginTop: 6, padding: 6, background: 'var(--dsw-alias-bg-layer-1, #18181b)', border: '1px solid var(--dsw-alias-border-l1, #3f3f46)', borderRadius: 6 } },
                  h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
                    h('span', { style: { color: '#93c5fd', fontWeight: 600 } }, `Step ${s.id}`),
                    // v1.7: importance 徽标（high 红 / medium 黄 / low 灰）
                    s.importance && h('span', {
                      style: {
                        fontSize: 10, fontWeight: 600, marginLeft: 6, padding: '1px 6px', borderRadius: 4, whiteSpace: 'nowrap',
                        color: s.importance === 'high' ? '#f87171' : s.importance === 'medium' ? '#fbbf24' : '#a1a1aa',
                        border: '1px solid ' + (s.importance === 'high' ? 'rgba(248,113,113,.5)' : s.importance === 'medium' ? 'rgba(251,191,36,.5)' : 'rgba(161,161,170,.5)')
                      }
                    }, s.importance === 'high' ? T.importanceHigh : s.importance === 'medium' ? T.importanceMedium : T.importanceLow),
                    // v1.6: DAG 标注 —— 并发组（⚡紫色）+ 依赖（🔒琥珀色）
                    s.parallel_group && h('span', { style: { fontSize: 10, fontWeight: 600, color: '#a78bfa', marginLeft: 6 } }, '⚡' + T.depGroup + s.parallel_group),
                    s.depends_on && s.depends_on.length > 0 && h('span', { style: { fontSize: 10, color: '#fbbf24', marginLeft: 6 } }, '🔒' + T.depOn + ' ' + s.depends_on.map((d) => 'Step ' + d).join(',')),
                    h('span', { style: { color: 'var(--dsw-alias-label-primary, #e4e4e7)' } }, s.title),
                    h('span', { style: { fontSize: 11, color: s.status === 'approved' ? '#4ade80' : s.status === 'rejected' ? '#f87171' : s.status === 'review' ? '#fbbf24' : s.status === 'executing' ? '#60a5fa' : '#a1a1aa' } },
                      (T.status[s.status] || s.status)),
                    // v1.0.1: 审核来源徽标（external / dialog / manual）
                    s.reviewedBy && h('span', {
                      style: {
                        fontSize: 10, fontWeight: 600, marginLeft: 6, padding: '1px 6px', borderRadius: 4, whiteSpace: 'nowrap',
                        color: s.reviewedBy === 'external' ? '#93c5fd' : s.reviewedBy === 'dialog' ? '#a78bfa' : s.reviewedBy === 'mainagent' ? '#4ade80' : '#fbbf24',
                        border: '1px solid ' + (s.reviewedBy === 'external' ? 'rgba(147,197,253,.5)' : s.reviewedBy === 'dialog' ? 'rgba(167,139,250,.5)' : s.reviewedBy === 'mainagent' ? 'rgba(74,222,128,.5)' : 'rgba(251,191,36,.5)')
                      }
                    }, s.reviewedBy === 'external' ? T.reviewerExternal : s.reviewedBy === 'dialog' ? T.reviewerDialog : s.reviewedBy === 'mainagent' ? T.reviewerMainagent : T.reviewerManual),
                    // v1.7: low 步骤折叠开关（详情收起时仅显示标题行）
                    lowStep && h('button', {
                      onClick: () => setLowExpanded((x) => ({ ...x, [String(s.id)]: !lowOpen })),
                      style: { background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: 12, padding: '0 2px' }
                    }, lowOpen ? '收起 ▲' : '展开 ▼')
                  ),
                  // v1.7: low 步骤未展开时隐藏详情（detail / acceptance / 候选方案 / 操作按钮）
                  (!lowStep || lowOpen) && h('div', {},
                    s.detail && h('div', { style: { ...hintStyle, marginTop: 2 } }, s.detail),
                    s.acceptance && h('div', { style: { ...hintStyle, marginTop: 2 } }, T.acceptanceLabel + s.acceptance),
                    // v1.7 T3: 候选方案（折叠区，每个 alternative 显示 label + risk + reason）
                    s.alternatives && Array.isArray(s.alternatives) && s.alternatives.length > 0 && h('div', { style: { marginTop: 4 } },
                      h('button', {
                        onClick: () => setAltOpen((x) => ({ ...x, [String(s.id)]: !altOpen[String(s.id)] })),
                        style: { background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: 12, padding: 0 }
                      }, (altOpen[String(s.id)] ? '收起 ' : '展开 ') + T.alternatives + (altOpen[String(s.id)] ? ' ▲' : ' ▼')),
                      altOpen[String(s.id)] && h('div', { style: { marginTop: 2, display: 'flex', flexDirection: 'column', gap: 4 } },
                        s.alternatives.map((alt, ai) => h('div', {
                          key: ai,
                          style: { border: '1px solid var(--dsw-alias-border-l1, #3f3f46)', borderRadius: 4, padding: '4px 6px', fontSize: 11, background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,.15))' }
                        },
                          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
                            h('span', { style: { color: 'var(--dsw-alias-label-primary, #e4e4e7)', fontWeight: 600 } }, alt.label || ('Alt ' + (ai + 1))),
                            alt.risk && h('span', { style: { fontSize: 10, color: riskColor(alt.risk), border: '1px solid ' + riskColor(alt.risk), borderRadius: 4, padding: '0 4px' } }, riskLabel(alt.risk))
                          ),
                          alt.reason && h('div', { style: { ...hintStyle, marginTop: 2, marginBottom: 0 } }, alt.reason)
                        ))
                      )
                    ),
                    h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 } },
                      h('button', { onClick: () => callStepUpdate(s.id, 'start'), disabled: stepBusy, className: 'dwr-ghost', style: { ...btnGhostStyle, padding: '2px 8px', fontSize: 11 } }, busyLabel('start', T.btn.start)),
                      h('button', { onClick: () => callStepUpdate(s.id, 'complete'), disabled: stepBusy, className: 'dwr-ghost', style: { ...btnGhostStyle, padding: '2px 8px', fontSize: 11 } }, busyLabel('complete', T.btn.complete)),
                      h('button', { onClick: () => autoReviewStep(s.id), disabled: stepBusy, className: 'dwr-ghost', style: { ...ghostPurple, padding: '2px 8px', fontSize: 11 } }, (stepBusy && stepBusyAction === 'autoReview') ? T.btn.autoReviewing : T.btn.autoReview),
                      h('button', { onClick: () => callStepUpdate(s.id, 'approve'), disabled: stepBusy, className: 'dwr-ghost', style: { ...ghostGreen, padding: '2px 8px', fontSize: 11 } }, busyLabel('approve', T.btn.extApprove)),
                      h('button', { onClick: () => callStepUpdate(s.id, 'reject'), disabled: stepBusy, className: 'dwr-ghost', style: { ...ghostRed, padding: '2px 8px', fontSize: 11 } }, busyLabel('reject', T.btn.extReject)),
                      h('button', { onClick: () => callStepUpdate(s.id, 'reopen'), disabled: stepBusy, className: 'dwr-ghost', style: { ...btnGhostStyle, padding: '2px 8px', fontSize: 11 } }, busyLabel('reopen', T.btn.reopen))
                    )
                  )
                )
              }),
              h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
                h('input', {
                  value: stepComment,
                  onChange: (e) => setStepComment(e.target.value),
                  placeholder: T.commentPlaceholder,
                  style: { ...inputStyle, margin: 0, flex: 1 }
                })
              ),
              // v1.5 M4: 手动审核框（auto-review 降级到 manual 时展开，steps.map 之外、Step List 容器内）
              manualReview && h('div', { style: { marginTop: 8, border: '1px solid rgba(251,191,36,.5)', borderRadius: 6, padding: 8, background: 'rgba(245,158,11,.06)' } },
                h('div', { style: { color: 'var(--dsw-alias-state-warn-primary, #fbbf24)', fontWeight: 600, fontSize: 12 } }, '⚠ ' + T.manualReviewTitle),
                manualReview.fallbackReason && h('div', { style: { ...warnStyle, marginTop: 2 } }, T.fallbackReasonLabel + manualReview.fallbackReason),
                h('div', { style: { marginTop: 4 } },
                  h('div', { style: { ...hintStyle, fontWeight: 600, color: '#93c5fd' } },
                    (manualReview.step ? 'Step ' + manualReview.step.id + ' · ' + (manualReview.step.title || '') : 'Step ' + manualReview.stepId) + ' · ' + T.acceptanceLabel),
                  manualReview.step && manualReview.step.acceptance && h('div', { style: { ...preStyle, marginTop: 2, fontSize: 12, maxHeight: 120 } }, manualReview.step.acceptance)
                ),
                manualReview.traceText && h('div', { style: { marginTop: 4 } },
                  h('button', {
                    onClick: () => setShowReviewTrace(!showReviewTrace),
                    style: { background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: 12, padding: 0 }
                  }, showReviewTrace ? T.collapseTrace : T.expandTrace),
                  showReviewTrace && h('div', { style: { ...preStyle, marginTop: 2, fontSize: 12 } }, manualReview.traceText)
                ),
                h('textarea', {
                  value: manualReviewComment,
                  onChange: (e) => setManualReviewComment(e.target.value),
                  placeholder: T.reviewCommentPlaceholder,
                  rows: 2, style: { ...inputStyle, margin: '6px 0 0' }
                }),
                h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
                  h('button', { onClick: () => submitManualReview('approve'), disabled: stepBusy, className: 'dwr-ghost', style: { ...ghostGreen, padding: '4px 10px', fontSize: 12 } }, busyLabel('approve', T.btn.approve)),
                  h('button', { onClick: () => submitManualReview('reject'), disabled: stepBusy, className: 'dwr-ghost', style: { ...ghostRed, padding: '4px 10px', fontSize: 12 } }, busyLabel('reject', T.btn.reject))
                )
              ),
              // v1.5 M4: 一键收口（status=done 且未收口时显示）
              stepState && stepState.status === 'done' && steps && steps.length > 0 && !finalSummary &&
              h('div', { style: { marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 } },
                h('button', { onClick: finalizeTask, disabled: stepBusy, style: { ...btnStyle, padding: '6px 14px' } },
                  (stepBusy && stepBusyAction === 'finalize') ? T.btn.finalizing : T.btn.finalize)
              ),
              // v1.5 M4: 审核来源汇总（finalize 成功后的汇总文本）
              finalSummary && h('div', { style: { marginTop: 8 } },
                h('div', { style: { ...hintStyle, fontWeight: 600, color: '#4ade80' } }, T.finalSummaryTitle),
                h('div', { style: { ...preStyle, marginTop: 4, fontSize: 12, maxHeight: 200 } }, finalSummary)
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
            h('span', { style: { ...hintStyle, margin: 0, fontWeight: 600, color: '#93c5fd' } }, T.traceTitle),
            h('span', { style: hintStyle }, traces ? `${traces.length} ${T.traceCountUnit}` : ''),
              h('button', {
                onClick: () => setTraceOrder(traceOrder === 'asc' ? 'desc' : 'asc'),
                className: 'dwr-ghost',
                style: { ...btnGhostStyle, padding: '3px 10px', fontSize: 12 }
              }, traceOrder === 'asc' ? T.traceOrderDesc : T.traceOrderAsc),
            h('button', {
              onClick: loadTraces,
              disabled: traceLoading,
              className: 'dwr-ghost', style: { ...btnGhostStyle, padding: '3px 10px', fontSize: 12, marginLeft: 'auto', opacity: traceLoading ? 0.6 : 1 }
            }, traceLoading ? T.traceRefreshing : T.traceRefresh)
          ),
          traceError && h('div', { style: warnStyle }, traceError),
          traces === null
            ? h('div', { style: hintStyle }, T.traceLoading)
            : traces.length === 0
              ? h('div', { style: hintStyle }, T.traceEmpty)
              : sortedTraces.map((t) => h('div', { key: t.id, style: { background: 'var(--dsw-alias-bg-layer-1, #18181b)', border: '1px solid var(--dsw-alias-border-l1, #3f3f46)', borderRadius: 6, padding: 8, marginBottom: 8 } },
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 } },
                    h('span', { style: { color: '#93c5fd', fontWeight: 600, fontSize: 12, wordBreak: 'break-all' } }, t.id),
                    h('button', {
                      onClick: () => expandRecord(t.id),
                      style: { background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }
                    }, expandedTrace[t.id] ? T.collapseRecord + ' ▲' : T.expandRecord + ' ▼')
                  ),
                    !expandedTrace[t.id] && (() => {
                      const s = summarizeTrace(t, T)
                      return h('div', { style: { marginTop: 6, padding: 8, background: 'var(--dsw-alias-bg-layer-1, #101018)', border: '1px solid var(--dsw-alias-border-l1, #2a2a35)', borderRadius: 6 } },
                        h('div', { style: { fontSize: 11, color: '#93c5fd', fontWeight: 600 } }, T.userTaskLabel),
                        h('div', { style: { ...hintStyle, marginTop: 2 } }, s.userTask),
                        h('div', { style: { fontSize: 11, color: '#f59e0b', fontWeight: 600, marginTop: 6 } }, T.processOverviewLabel),
                        h('div', { style: { ...hintStyle, marginTop: 2 } }, s.overview),
                        h('div', { style: { fontSize: 11, color: '#4ade80', fontWeight: 600, marginTop: 6 } }, T.resultSummaryLabel),
                        h('div', { style: { ...hintStyle, marginTop: 2 } }, s.result)
                      )
                    })(),
                  !expandedTrace[t.id] ? null : (t.entries || []).map((e, i) => h('div', { key: i, style: { marginTop: 6, borderLeft: '2px solid ' + (ROLE_COLOR[e.role] || '#52525b'), paddingLeft: 8 } },
                    h('div', { style: { fontSize: 11, color: ROLE_COLOR[e.role] || '#a1a1aa' } },
                      (T.roleLabel[e.role] || e.role) + ' · ' + String(e.at || '').replace('T', ' ').replace(/\.\d+Z$/, 'Z')),
                    h('div', { style: { ...preStyle, marginTop: 2, maxHeight: 140, fontSize: 12 } }, e.text || '(空)')
                  )),
                  expandedTrace[t.id] && traceRecord[t.id] && h('div', { style: { ...preStyle, marginTop: 6, maxHeight: 220, fontSize: 12 } }, traceRecord[t.id])
                ))
        ),
        !collapsed &&
        h('div', { style: panelFootStyle },
          tab === 'trace'
            ? h('button', { onClick: loadTraces, disabled: traceLoading, className: 'dwr-ghost', style: { ...btnGhostStyle, opacity: traceLoading ? 0.6 : 1 } }, traceLoading ? T.traceRefreshing : T.traceRefresh)
            : footer,
          h('span', { style: hintStyle }, T.footerHint)
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
