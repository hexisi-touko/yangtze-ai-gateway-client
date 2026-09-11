const os=require('node:os');
function adapter(t,homeDir=os.homedir()){
 const Type=t.id==='codex-gpt'?require('./src/tool-sync/codex-adapter').CodexAdapter:t.id==='claude-code'?require('./src/tool-sync/claude-adapter').ClaudeAdapter:null;
 if(!Type)throw Error('该模型通道不是外部终端');
 return new Type({homeDir});
}
function config(t,model=t.model){return {apiKey:t.key,apiBaseUrl:t.baseURL,model,availableModels:t.models,providerName:'长大计科智慧油田实验室'};}
function describe(t){
 if(t.id==='openai-chat')return {configured:false};
 try{const a=adapter(t);return {configured:t.enabled&&a.getLocalState(config(t)).configured,configPaths:a.configPaths};}
 catch{return {configured:false,configError:'本地终端配置无法读取，请检查配置文件格式'};}
}
module.exports={adapter,config,describe};
