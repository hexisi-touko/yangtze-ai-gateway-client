const PRICES={
  'gpt-5.6-luna':{inputPerMillion:0,outputPerMillion:0,source:'待管理员确认'},
  'kimi-k2':{inputPerMillion:0.6,outputPerMillion:2.4,source:'官方定价'},
  'kimi-k2.5':{inputPerMillion:0.6,outputPerMillion:2.4,source:'官方定价'}
};
function summarize(rows){return rows.map(r=>{const p=PRICES[r.model]||{};const input=Number(r.prompt_tokens)||0,output=Number(r.completion_tokens)||0;return {...r,total_tokens:input+output,estimated_cost_usd:input*(Number(p.inputPerMillion)||0)/1e6+output*(Number(p.outputPerMillion)||0)/1e6,price_source:p.source||'未配置价格'}})}
module.exports={PRICES,summarize};
