function UsageCostSection(){
  const [rows,setRows]=react.useState([]),[busy,setBusy]=react.useState(false),[error,setError]=react.useState(''),[availability,setAvailability]=react.useState('unknown');
  const availabilityRef=react.useRef('unknown');
  const load=async()=>{setBusy(true);setError('');try{const result=await window.labUsage.load({});const unavailable=result?.available===false;availabilityRef.current=unavailable?'unavailable':'available';setAvailability(availabilityRef.current);setRows(Array.isArray(result)?result:(result?.rows||[]));}catch(e){availabilityRef.current='available';setAvailability('available');setError(e.message||'读取用量失败')}finally{setBusy(false)}};
  react.useEffect(()=>{load();const timer=setInterval(()=>{if(availabilityRef.current!=='unavailable')load()},30000);return()=>clearInterval(timer)},[]);
  const total=rows.reduce((n,r)=>n+(Number(r.prompt_tokens)||0)+(Number(r.completion_tokens)||0),0);
  const costOf=r=>{const v=r.cost??r.estimated_cost_usd??r.estimated_cost??r.cost_usd;return v==null||v===''?null:Number(v)};
  const totalCost=rows.reduce((n,r)=>n+(costOf(r)||0),0);
  const hasCost=rows.some(r=>costOf(r)!=null);
  const h=react_jsx_runtime.jsx,hs=react_jsx_runtime.jsxs;
  const fmt=n=>Number(n||0).toLocaleString('zh-CN');
  const card={background:'#f7f8fa',border:'1px solid #e7e9ee',borderRadius:14,padding:'18px 20px'};
  const muted={color:'#697386',fontSize:13};
  return hs('section',{style:{padding:'8px 10px 28px',maxWidth:820},children:[
    hs('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:22},children:[
      hs('div',{children:[h('h2',{style:{margin:'0 0 8px',fontSize:28,lineHeight:1.2,letterSpacing:'-0.02em'},children:'用量与成本'}),h('p',{style:{...muted,margin:0},children:'按模型统计当前账号用量，帮助你了解请求分布与 Token 消耗。'})]}),
      h('button',{onClick:load,disabled:busy,'aria-label':busy?'正在刷新':'刷新用量',title:busy?'正在刷新':'刷新用量',style:{width:40,height:40,border:'1px solid #dce3f0',background:busy?'#f3f6fb':'#fff',borderRadius:'50%',display:'grid',placeItems:'center',fontSize:19,cursor:busy?'wait':'pointer',color:'#4772d0',boxShadow:'0 2px 8px rgba(53,88,145,.08)',transition:'all .18s ease',opacity:busy?.72:1},children:busy?'…':'↻'})
    ]}),
    error&&h('div',{role:'alert',style:{background:'#fff1f0',color:'#c0392b',border:'1px solid #ffd4d0',borderRadius:10,padding:'11px 14px',marginBottom:16},children:error}),
    availability==='unavailable'&&h('div',{role:'status',style:{background:'#f5f7fb',color:'#697386',border:'1px solid #dce3f0',borderRadius:10,padding:'11px 14px',marginBottom:16},children:'当前服务器暂未提供用量统计，其他功能不受影响。'}),
    hs('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:24},children:[
      hs('div',{style:{...card,display:'flex',alignItems:'center',justifyContent:'space-between'},children:[hs('div',{children:[h('div',{style:muted,children:'总 Token'}),h('div',{style:{fontSize:32,fontWeight:700,marginTop:5,letterSpacing:'-0.02em'},children:fmt(total)})]}),h('div',{style:{width:42,height:42,borderRadius:12,background:'#e8efff',color:'#4772d0',display:'grid',placeItems:'center',fontSize:21},children:'∑'})]}),
      hs('div',{style:{...card,display:'flex',alignItems:'center',justifyContent:'space-between'},children:[hs('div',{children:[h('div',{style:muted,children:'预计成本'}),h('div',{style:{fontSize:27,fontWeight:700,marginTop:8,letterSpacing:'-0.02em'},children:hasCost?'$'+totalCost.toFixed(4):'待更新'})]}),h('div',{style:{width:42,height:42,borderRadius:12,background:'#e9f8ef',color:'#2b9a5b',display:'grid',placeItems:'center',fontSize:20},children:'$'})]})
    ]}),
    hs('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10},children:[h('h3',{style:{fontSize:16,margin:0},children:'模型明细'}),h('span',{style:muted,children:rows.length+' 个模型'})]}),
    rows.length===0&&!busy?h('div',{style:{...card,textAlign:'center',color:'#697386',padding:'34px 20px'},children:'暂无用量数据'}):
      hs('div',{style:{border:'1px solid #e7e9ee',borderRadius:14,overflow:'hidden',background:'#fff'},children:[
        hs('div',{style:{display:'grid',gridTemplateColumns:'minmax(160px,1.4fr) 1fr 1fr 90px 100px',gap:12,padding:'12px 18px',background:'#f7f8fa',...muted},children:[h('span',{children:'模型'}),h('span',{children:'输入 Token'}),h('span',{children:'输出 Token'}),h('span',{style:{textAlign:'right'},children:'请求数'}),h('span',{style:{textAlign:'right'},children:'成本'})]}),
        ...(rows||[]).map((r,i)=>h('div',{style:{display:'grid',gridTemplateColumns:'minmax(160px,1.4fr) 1fr 1fr 90px 100px',gap:12,padding:'16px 18px',alignItems:'center',borderTop:i?'1px solid #eef0f3':'none'},children:[h('strong',{style:{fontSize:14,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},children:r.model}),h('span',{children:fmt(r.prompt_tokens)}),h('span',{children:fmt(r.completion_tokens)}),h('span',{style:{textAlign:'right',color:'#697386'},children:fmt(r.requests)}),h('span',{style:{textAlign:'right',color:'#697386'},children:costOf(r)==null?'待更新':'$'+costOf(r).toFixed(4)})]},r.model))
      ]})
  ]});
}
