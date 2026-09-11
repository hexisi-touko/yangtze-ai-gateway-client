const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const asar=require('@electron/asar');
const client=path.resolve(__dirname,'..');
const installed=process.argv[2]||'C:/Users/ding/Desktop/长大计科智慧油田实验室';
const out=fs.mkdtempSync(path.resolve(client,'../output/user-release-'));
const unpack=path.join(out,'archive-source'),app=path.join(out,'app'),resources=path.join(out,'resources');
const copy=(a,b)=>{fs.mkdirSync(path.dirname(b),{recursive:true});fs.cpSync(a,b,{recursive:true});};
const runtimeFiles=['apply-brand.cjs','apply-identity.cjs','apply-models-page.cjs','apply-quota-errors.cjs','disable-welcome.cjs','gate.cjs','launch-tool.cjs','model-bridge.cjs','models-page.js','terminal-config.cjs','usage-page.js','preload.js','package.json','desktop.config.local-test.json','lab-icon.ico','lab-icon.png','lab-logo.svg','lab-title-icon.png','blank-icon.png'];
async function main(){
 asar.extractAll(path.join(installed,'resources/app.asar'),unpack);
 for(const name of ['lib','renderer','node_modules'])copy(path.join(unpack,name),path.join(app,name));
 const mainPath=path.join(app,'lib/main.js');
 fs.writeFileSync(mainPath,require('../dsh-login/patch-startup.cjs').patchStartup(fs.readFileSync(mainPath,'utf8')));
 const meta=JSON.parse(fs.readFileSync(path.join(unpack,'package.json'),'utf8'));
 meta.name='yangtze-ai-gateway-client';meta.productName='长大计科智慧油田实验室';meta.description='长大计科智慧油田实验室桌面客户端';meta.main='lib/main.js';
 meta.dependencies['@iarna/toml']='^2.2.5';
 fs.writeFileSync(path.join(app,'package.json'),JSON.stringify(meta,null,2));
 for(const name of runtimeFiles)copy(path.join(client,'dsh-login',name),path.join(app,'new-api-login',name));
 for(const name of ['src','ui'])copy(path.join(client,'dsh-login',name),path.join(app,'new-api-login',name));
 // Deployment, verification and benchmark helpers are development-only and
 // must never ship inside the user-facing application archive.
 const devOnly = [
  'deploy-identity.cjs','deploy-settings.cjs','verify-installed.cjs',
  'verify-terminal-ui.cjs','update-settings.cjs','update-terminal.cjs',
  'benchmark-seed.cjs','check-prebuilt-host.cjs'
 ];
 for(const name of devOnly){
  for(const root of [app, resources]){
   const candidate=path.join(root,'new-api-login',name);
   if(fs.existsSync(candidate))fs.rmSync(candidate);
  }
 }
 for(const name of ['runtime','seed'])copy(path.join(installed,'resources',name),path.join(resources,name));
 if(!fs.existsSync(path.join(app,meta.main)))throw Error('Release entry missing');
 const manifest=[];
 function walk(dir,relative=''){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   const rel=relative?relative+'/'+entry.name:entry.name,full=path.join(dir,entry.name);
   if(entry.isSymbolicLink())throw Error('Unexpected symlink: '+rel);
   if(entry.isDirectory()){walk(full,rel);continue;}
   if(/(^|[/])([.]credentials[.]yaml|auth[.]json|settings[.]yaml|[.]env|Cookies|Login Data|one-api[.]db)$|[.]asar[.]|(^|[/])(sessions|recover-app2)([/]|$)/i.test(rel))throw Error('Private/backup file: '+rel);
   const data=fs.readFileSync(full);
   if(!rel.includes('/node_modules/') && /[.](cjs|mjs|js|json|yaml|html|css)$/.test(rel)){
    const text=data.toString();
    if(/(?:^|[^a-zA-Z])sk-[a-zA-Z0-9_-]{24,}|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/.test(text))throw Error('Possible secret: '+rel);
   }
   manifest.push({path:rel,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')});
  }
 }
 walk(app,'app');walk(resources,'resources');
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
 // Builder consumes only app and resources; archive-source is audit input only.
 fs.writeFileSync(path.join(out,'release-config.cjs'),
 'module.exports='+JSON.stringify({appId:'cn.yangtze.smartoilfield.client',productName:meta.productName,publish:null,asar:true,directories:{app,output:path.join(out,'installer')},files:['**/*','!**/*.test.*','!**/test/**','!**/tests/**','!**/README*'],extraResources:[{from:resources,to:'.',filter:['runtime/**/*','seed/**/*']}],win:{target:'nsis',icon:path.join(app,'new-api-login/lab-icon.ico')},nsis:{oneClick:false,perMachine:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true,createStartMenuShortcut:true,shortcutName:meta.productName,deleteAppDataOnUninstall:false}},null,2));
 fs.writeFileSync(path.join(client,'release-stage.json'),JSON.stringify({directory:out,config:path.join(out,'release-config.cjs'),entry:meta.main,files:manifest.length},null,2));
 console.log(JSON.stringify({directory:out,entry:meta.main,files:manifest.length,config:path.join(out,'release-config.cjs')}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
