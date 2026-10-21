const fs=require('fs'),path=require('path'),zlib=require('zlib'),vm=require('vm');
function tarField(buffer,start,length){return buffer.subarray(start,start+length).toString('utf8').replace(/\0.*$/s,'').trim();}
function originalClientFromArchive(projectDir){
 const packageDir=path.join(projectDir,'node_modules/@deepseek-ai/dsh-client-ui-settings-models');
 const packageSetPath=path.join(projectDir,'desktop-packages.json');
 if(!fs.existsSync(packageSetPath))return null;
 const manifest=JSON.parse(fs.readFileSync(path.join(packageDir,'package.json'),'utf8'));
 const packageSet=JSON.parse(fs.readFileSync(packageSetPath,'utf8'));
 const record=(packageSet.packages||[]).find(item=>item.name===manifest.name&&item.version===manifest.version);
 if(!record)throw Error('Desktop package archive missing for '+manifest.name+'@'+manifest.version);
 const archivePath=path.join(projectDir,'desktop-packages',record.file);
 if(!fs.existsSync(archivePath))throw Error('Desktop package archive missing: '+record.file);
 const archive=zlib.gunzipSync(fs.readFileSync(archivePath));
 for(let offset=0;offset+512<=archive.length;){
  const name=tarField(archive,offset,100); if(!name)break;
  const sizeText=tarField(archive,offset+124,12); const size=sizeText?parseInt(sizeText,8):0;
  const bodyStart=offset+512;
  if(name.replace(/^package\//,'')==='lib/client.js')return archive.subarray(bodyStart,bodyStart+size).toString('utf8');
  offset=bodyStart+Math.ceil(size/512)*512;
 }
 throw Error('Desktop package archive has no lib/client.js: '+record.file);
}
function applyModelsPage(projectDir){
require('./apply-quota-errors.cjs').applyQuotaErrors(projectDir);
const file=path.join(projectDir,'node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js');let s=originalClientFromArchive(projectDir)||fs.readFileSync(file,'utf8');
const registration=' ctx.slots.inject("settings.section", () => ctx.slots.register({name:"settings.section",id:"lab-usage",order:11,label:()=>"用量与成本"}, UsageCostSection));';
const dashboardRegistration=' ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({name:"sidebar.footer.action",id:"lab-dashboard",order:-100}, UsageDashboardAction));';
const icon=n=>'data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'ui/assets',n)).toString('base64');const code='const LAB_GPT_ICON='+JSON.stringify(icon('gpt-icon.png'))+',LAB_CLAUDE_ICON='+JSON.stringify(icon('claude-icon.png'))+';'+fs.readFileSync(path.join(__dirname,'models-page.js'),'utf8')+fs.readFileSync(path.join(__dirname,'usage-page.js'),'utf8')+fs.readFileSync(path.join(__dirname,'dashboard-page.js'),'utf8');
const marker='/* lab-models-page-v3 */';
const next=s.replace('function apply(ctx) {',()=>marker+code+'function apply(ctx) {'+registration+dashboardRegistration).replace('}, ModelsSection));','}, AccountModelsSection));');
if(next===s)throw Error('Models settings apply anchor missing');
try{new vm.Script(next,{filename:file});}catch(error){throw Error('Models settings patch produced invalid JavaScript: '+error.message);}
fs.writeFileSync(file,next);
}
module.exports={applyModelsPage};
