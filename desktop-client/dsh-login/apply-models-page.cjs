const fs=require('fs'),path=require('path');
function applyModelsPage(projectDir){
require('./apply-quota-errors.cjs').applyQuotaErrors(projectDir);
const file=path.join(projectDir,'node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js');let s=fs.readFileSync(file,'utf8');const start=s.indexOf('const LAB_GPT_ICON=');if(start>=0){const end=s.indexOf('function apply(ctx) {',start);if(end<0)throw Error('Invalid settings module');s=s.slice(0,start)+s.slice(end);}
const registration=' ctx.slots.inject("settings.section", () => ctx.slots.register({name:"settings.section",id:"lab-usage",order:11,label:()=>"用量与成本"}, UsageCostSection));';s=s.replace(registration,'');
const icon=n=>'data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'ui/assets',n)).toString('base64');const code='const LAB_GPT_ICON='+JSON.stringify(icon('gpt-icon.png'))+',LAB_CLAUDE_ICON='+JSON.stringify(icon('claude-icon.png'))+';'+fs.readFileSync(path.join(__dirname,'models-page.js'),'utf8')+fs.readFileSync(path.join(__dirname,'usage-page.js'),'utf8');s=s.replace('function apply(ctx) {',code+'function apply(ctx) {'+registration).replace('}, ModelsSection));','}, AccountModelsSection));');fs.writeFileSync(file,s);}
module.exports={applyModelsPage};
