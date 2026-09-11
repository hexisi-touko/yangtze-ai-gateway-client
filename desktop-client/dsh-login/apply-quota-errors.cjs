const fs=require('node:fs'),path=require('node:path');
function applyQuotaErrors(project){
 const file=path.join(project,'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js');
 let s=fs.readFileSync(file,'utf8');
 const marker='function classifyPiAiError(message) {';
 const guard=' if (/insufficient_user_quota|insufficient_quota|用户额度不足|余额不足/i.test(message) || isQuotaExceededError(message)) return QUOTA_EXCEEDED_CODE;';
 if(!s.includes('insufficient_user_quota|insufficient_quota'))s=s.replace(marker,marker+guard);
 fs.writeFileSync(file,s);
}
module.exports={applyQuotaErrors};
