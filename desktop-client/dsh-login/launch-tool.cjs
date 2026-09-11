const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const path=require('node:path');
const os=require('node:os');
async function launchConfiguredTool(t,model){
 const system=process.env.SystemRoot||'C:/Windows';
 const ps=path.join(system,'System32/WindowsPowerShell/v1.0/powershell.exe');
 const codex=t.id==='codex-gpt';
 let command;
 if(codex){
  const found=await promisify(execFile)(ps,['-NoProfile','-NonInteractive','-Command','Get-AppxPackage -Name OpenAI.Codex | Select-Object -ExpandProperty PackageFamilyName'],{windowsHide:true});
  const family=found.stdout.trim();
  if(!/^OpenAI[.]Codex_[a-zA-Z0-9]+$/.test(family))throw Error('未检测到 Codex 桌面应用，请先安装');
  command=[path.join(system,'explorer.exe'),['shell:AppsFolder'+String.fromCharCode(92)+family+'!App']];
 }else{
  try{await promisify(execFile)(path.join(system,'System32/where.exe'),['claude'],{windowsHide:true});}catch{throw Error('未检测到 Claude Code，请先安装');}
  command=[ps,['-NoProfile','-NoExit','-Command','claude']];
 }
 const Adapter=codex?require('./src/tool-sync/codex-adapter').CodexAdapter:require('./src/tool-sync/claude-adapter').ClaudeAdapter;
 const localAdapter=new Adapter({homeDir:os.homedir()}); if(!localAdapter.getLocalState(require("./terminal-config.cjs").config(t,model)).configured)localAdapter.apply({apiKey:t.key,apiBaseUrl:t.baseURL,model,availableModels:t.models,providerName:'长大计科智慧油田实验室'});
 await new Promise((resolve,reject)=>{const child=spawn(command[0],command[1],{detached:true,stdio:'ignore',windowsHide:codex});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
 return '配置已同步，已发送'+(codex?' Codex':' Claude Code')+'启动请求';
}
module.exports={launchConfiguredTool};
