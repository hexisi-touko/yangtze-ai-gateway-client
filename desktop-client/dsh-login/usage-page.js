function UsageCostSection(){
  const [rows,setRows]=react.useState([]),[busy,setBusy]=react.useState(false),[error,setError]=react.useState('');
  const load=async()=>{setBusy(true);setError('');try{const result=await window.labUsage.load({});setRows(result||[])}catch(e){setError(e.message||'读取用量失败')}finally{setBusy(false)}};
  react.useEffect(()=>{load()},[]);
  const total=rows.reduce((n,r)=>n+(Number(r.prompt_tokens)||0)+(Number(r.completion_tokens)||0),0);
  const h=react_jsx_runtime.jsx,hs=react_jsx_runtime.jsxs;
  return hs('section',{style:{padding:8},children:[hs('div',{style:{display:'flex',justifyContent:'space-between'},children:[h('h2',{children:'用量与成本'}),h('button',{onClick:load,disabled:busy,children:busy?'读取中…':'刷新'})]}),h('p',{children:'按模型统计当前账号用量。成本估算尚未启用，实际扣费以服务端为准。'}),error&&h('p',{role:'alert',children:error}),h('p',{children:'总 Token：'+total}),...(rows||[]).map(r=>h('p',{children:r.model+'：输入 '+(Number(r.prompt_tokens)||0)+'，输出 '+(Number(r.completion_tokens)||0)+'，请求 '+r.requests},r.model))]});
}
