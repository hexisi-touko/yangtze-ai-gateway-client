function UsageDashboardAction({ wide = true }) {
  const h = react_jsx_runtime.jsx
  const hs = react_jsx_runtime.jsxs
  const [open, setOpen] = react.useState(false)
  const [busy, setBusy] = react.useState(false)
  const [error, setError] = react.useState('')
  const [data, setData] = react.useState(null)
  const dialog = react.useRef(null)
  const api = () => window.labUsageDashboard?.load || window.labUsage?.dashboard
  const load = async () => {
    const loadDashboard = api()
    if (typeof loadDashboard !== 'function') {
      setError('当前客户端没有启用数据统计接口')
      return
    }
    setBusy(true)
    setError('')
    try {
      setData(await loadDashboard())
    } catch (e) {
      setError(e?.message || '读取我的数据失败')
    } finally {
      setBusy(false)
    }
  }
  const show = () => {
    setOpen(true)
    load()
  }
  react.useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [open])
  const close = () => {
    if (dialog.current?.open) dialog.current.close()
    setOpen(false)
  }
  const number = (value) => Number(value || 0).toLocaleString('zh-CN')
  const money = (value) => value == null ? '待更新' : '$' + Number(value).toFixed(4)
  const quotaMoney = (value) => '$' + (Number(value || 0) / 500000).toFixed(2)
  const period = (label, summary) => hs('div', { style: dashboardStyles.periodCard, children: [
    h('div', { style: dashboardStyles.muted, children: label }),
    h('strong', { style: dashboardStyles.periodValue, children: number(summary?.totalTokens) }),
    hs('div', { style: dashboardStyles.periodMeta, children: [
      h('span', { children: number(summary?.requests) + ' 次请求' }),
      h('span', { children: money(summary?.estimatedCostUsd) }),
    ]}),
  ]})
  const modelRows = (data?.month?.rows || []).slice().sort((a, b) => {
    const left = Number(a.requests) || (Number(a.prompt_tokens) + Number(a.completion_tokens))
    const right = Number(b.requests) || (Number(b.prompt_tokens) + Number(b.completion_tokens))
    return right - left
  }).slice(0, 5)
  const errorItems = data?.errors?.items || []
  return hs('div', { style: dashboardStyles.actionWrap, children: [
    h('button', {
      type: 'button',
      title: '查看我的数据',
      'aria-label': '查看我的数据',
      onClick: show,
      style: { ...dashboardStyles.action, justifyContent: wide ? 'flex-start' : 'center' },
      children: [
        h('span', { style: dashboardStyles.actionIcon, children: '◉' }),
        wide && h('span', { children: '我的数据' }),
      ],
    }),
    open && hs('dialog', {
      ref: dialog,
      onCancel: close,
      onClose: () => setOpen(false),
      style: dashboardStyles.dialog,
      children: [
        hs('header', { style: dashboardStyles.dialogHeader, children: [
          hs('div', { children: [
            h('h2', { style: dashboardStyles.title, children: '我的数据' }),
            h('p', { style: dashboardStyles.subtitle, children: '当前账号的 Token、成本、额度和请求状态' }),
          ]}),
          hs('div', { style: dashboardStyles.headerActions, children: [
            h('button', { type: 'button', onClick: load, disabled: busy, style: dashboardStyles.refresh, children: busy ? '同步中…' : '↻ 刷新' }),
            h('button', { type: 'button', onClick: close, 'aria-label': '关闭我的数据', style: dashboardStyles.close, children: '×' }),
          ]}),
        ]}),
        error && h('div', { role: 'alert', style: dashboardStyles.error, children: error }),
        !data && !error && h('p', { style: dashboardStyles.empty, children: '正在读取账号数据…' }),
        data && hs('div', { children: [
          hs('div', { style: dashboardStyles.periods, children: [period('今日 Token', data.today), period('本月 Token', data.month)] }),
          hs('div', { style: dashboardStyles.metrics, children: [
            hs('div', { style: dashboardStyles.metric, children: [h('span', { style: dashboardStyles.muted, children: '预计成本（本月）' }), h('strong', { children: money(data.month?.estimatedCostUsd) })] }),
            hs('div', { style: dashboardStyles.metric, children: [h('span', { style: dashboardStyles.muted, children: '剩余额度' }), h('strong', { children: quotaMoney(data.remainingQuota) })] }),
            hs('div', { style: dashboardStyles.metric, children: [h('span', { style: dashboardStyles.muted, children: '累计请求' }), h('strong', { children: number(data.requestCount) })] }),
          ]}),
          hs('section', { style: dashboardStyles.section, children: [
            hs('div', { style: dashboardStyles.sectionHead, children: [h('h3', { style: dashboardStyles.sectionTitle, children: '模型请求量' }), h('span', { style: dashboardStyles.muted, children: '本月 Top 5' })] }),
            modelRows.length ? h('div', { style: dashboardStyles.modelList, children: modelRows.map((row) => hs('div', { style: dashboardStyles.modelRow, children: [h('strong', { style: dashboardStyles.modelName, children: row.model }), h('span', { children: number(row.requests || (Number(row.prompt_tokens) + Number(row.completion_tokens))) + ' 次' }), h('span', { style: dashboardStyles.muted, children: number(Number(row.prompt_tokens) + Number(row.completion_tokens)) + ' tokens' })] }, row.model)) }) : h('p', { style: dashboardStyles.empty, children: '暂无模型请求数据' }),
          ]}),
          hs('section', { style: dashboardStyles.section, children: [
            hs('div', { style: dashboardStyles.sectionHead, children: [h('h3', { style: dashboardStyles.sectionTitle, children: '最近请求错误' }), h('span', { style: dashboardStyles.muted, children: data.errors?.available === false ? '接口未启用' : errorItems.length + ' 条' })] }),
            errorItems.length ? h('div', { style: dashboardStyles.errorList, children: errorItems.map((item, index) => hs('div', { style: dashboardStyles.errorItem, children: [h('strong', { children: item.model_name }), h('span', { style: dashboardStyles.errorText, children: item.error || item.error_code || item.content || '请求失败' })] }, item.id || index)) }) : h('p', { style: dashboardStyles.empty, children: data.errors?.available === false ? '当前服务器没有提供请求日志接口' : '最近没有发现请求错误' }),
          ]}),
          h('p', { style: dashboardStyles.sync, children: data.lastSyncAt ? '最近同步：' + new Date(data.lastSyncAt).toLocaleString('zh-CN') : '尚未同步' }),
        ]}),
      ],
    }),
  ] })
}

const dashboardStyles = {
  actionWrap: { width: '100%', minWidth: 0 },
  action: { width: '100%', border: 0, background: 'transparent', color: 'inherit', borderRadius: 9, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', font: 'inherit', fontSize: 13 },
  actionIcon: { color: 'var(--dsw-alias-brand-primary, #4772d0)', fontSize: 16 },
  dialog: { width: 'min(680px, calc(100vw - 40px))', maxHeight: 'min(760px, calc(100vh - 48px))', border: '1px solid var(--dsw-alias-border-l2, #e3e7ef)', borderRadius: 18, padding: 0, color: 'var(--dsw-alias-label-primary, #26324a)', background: 'var(--dsw-alias-bg-base, #fff)', boxShadow: '0 24px 80px #0003' },
  dialogHeader: { padding: '22px 24px 18px', borderBottom: '1px solid var(--dsw-alias-border-l2, #e8ebf0)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  headerActions: { display: 'flex', alignItems: 'center', gap: 8 },
  title: { margin: 0, fontSize: 23, lineHeight: 1.25 },
  subtitle: { margin: '7px 0 0', color: 'var(--dsw-alias-label-tertiary, #697386)', fontSize: 13 },
  refresh: { border: '1px solid var(--dsw-alias-border-l2, #dce3f0)', borderRadius: 8, background: 'transparent', color: 'inherit', padding: '7px 10px', cursor: 'pointer', font: 'inherit', fontSize: 12 },
  close: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary, #697386)', fontSize: 25, cursor: 'pointer', lineHeight: 1 },
  periods: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '20px 24px 12px' },
  periodCard: { border: '1px solid var(--dsw-alias-border-l2, #e7e9ee)', borderRadius: 13, padding: '15px 16px', background: 'var(--dsw-alias-bg-layer-1, #f7f8fa)' },
  periodValue: { display: 'block', fontSize: 27, lineHeight: 1.25, marginTop: 6 },
  periodMeta: { display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 7, color: 'var(--dsw-alias-label-tertiary, #697386)', fontSize: 12 },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, padding: '0 24px 18px' },
  metric: { minWidth: 0, borderBottom: '1px solid var(--dsw-alias-border-l2, #eef0f3)', padding: '8px 4px 12px', display: 'flex', flexDirection: 'column', gap: 6 },
  section: { padding: '0 24px 18px' },
  sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  sectionTitle: { margin: 0, fontSize: 14 },
  modelList: { border: '1px solid var(--dsw-alias-border-l2, #e7e9ee)', borderRadius: 10, overflow: 'hidden' },
  modelRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 72px 120px', gap: 10, alignItems: 'center', padding: '10px 12px', borderTop: '1px solid var(--dsw-alias-border-l2, #eef0f3)', fontSize: 12 },
  modelName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  errorList: { display: 'grid', gap: 7 },
  errorItem: { display: 'flex', gap: 9, alignItems: 'baseline', borderRadius: 9, background: '#fff5f3', color: '#a94438', padding: '9px 11px', fontSize: 12 },
  errorText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  error: { margin: '18px 24px', borderRadius: 9, padding: '10px 12px', background: '#fff1f0', color: '#c0392b', fontSize: 13 },
  empty: { margin: 0, padding: '10px 0', color: 'var(--dsw-alias-label-tertiary, #697386)', fontSize: 13 },
  muted: { color: 'var(--dsw-alias-label-tertiary, #697386)', fontSize: 12 },
  sync: { margin: '0 24px 22px', color: 'var(--dsw-alias-label-tertiary, #8a93a3)', fontSize: 11 },
}
