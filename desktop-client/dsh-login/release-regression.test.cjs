const test=require('node:test'),assert=require('node:assert/strict');
test('terminal status checks actual credentials without exposing them to renderer',()=>{
 const config=require('./terminal-config.cjs'),original=config.describe;
 try{
 config.describe=t=>({configured:t.key==='test-private-key'});
 const {ModelBridge}=require('./model-bridge.cjs'),bridge=new ModelBridge();
 bridge.tools=[{id:'codex-gpt',enabled:true,key:'test-private-key',models:['test-model']}];
 const state=bridge.state();assert.equal(state.tools[0].configured,true);assert.equal(JSON.stringify(state).includes('test-private-key'),false);
 }finally{config.describe=original;}
});
