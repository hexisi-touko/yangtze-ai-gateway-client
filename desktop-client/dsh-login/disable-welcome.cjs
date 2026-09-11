const fs=require('node:fs'),path=require('node:path');
function disableWelcomeNotice(projectDir){
const target=path.join(projectDir,'node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js');
let source=fs.readFileSync(target,'utf8');
for(const [id,component] of [['welcome-notice','WelcomeNotice'],['deepseek-official','DeepSeekOnboardingDialog']]){
const pos=source.indexOf('id: "'+id+'"');if(pos<0)continue;
const start=source.lastIndexOf('ctx.slots.inject("settings.onboarding"',pos),suffix='}, '+component+'));',end=source.indexOf(suffix,pos)+suffix.length;
if(start<0||end<=pos||end-start>400)throw new Error('Unexpected onboarding registration');
source=source.slice(0,start)+'/* Desktop onboarding disabled: '+id+' */'+source.slice(end);
}fs.writeFileSync(target,source);
}
module.exports={disableWelcomeNotice};if(require.main===module)disableWelcomeNotice(process.argv[2]);