const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const gatePath=path.join(__dirname,'gate.cjs');
function fixture(role=1,twoFactor=false){
 const handlers=new Map(),windows=[],storage=new Map();let entered=0;
 class Window extends EventEmitter{constructor(){super();this.webContents={mainFrame:{url:''}};windows.push(this)}setContentSize(){} async loadFile(p){this.webContents.mainFrame.url=require('node:url').pathToFileURL(p).href}show(){}focus(){}isDestroyed(){return !!this.dead}destroy(){this.dead=true;this.emit('closed')} }
 class Store{constructor({filePath}){this.key=filePath}load(){return storage.get(this.key)||null}save(v){storage.set(this.key,v)}clear(){storage.delete(this.key)}encryptionAvailable(){return true}}
 const sess={setPermissionCheckHandler(){},setPermissionRequestHandler(){},async clearStorageData(){}};
 class Client{async getStatus(){return {success:true}}async login({password}){if(password==='bad')throw new Error('bad');return twoFactor?{requiresTwoFactor:true,flowToken:'flow'}:{accountRole:role}}async verifyTwoFactor(){return {accountRole:role}}async getSelf(){return {id:7,role}}}
 const fake={app:{getPath:()=>'/tmp',quit(){}},BrowserWindow:Window,ipcMain:{handle:(n,fn)=>handlers.set(n,fn),on(){}},session:{fromPartition:()=>sess},safeStorage:{}};
 const mod={exports:{}};
 const req=name=>name==='electron'?fake:name==='./src/new-api-client'?{NewApiClient:Client,NewApiClientError:Error}:name.includes('-store')?Object.fromEntries(['CredentialStore','RegistrationStore','PasswordResetStore'].map(k=>[k,Store])):name==='./src/config'?{loadDesktopConfig:()=>({serverUrl:'http://127.0.0.1:3000',productName:'test'}),logoPathForLoginPage:()=>''}:require(name);
 vm.runInNewContext(fs.readFileSync(gatePath,'utf8'),{require:req,module:mod,__dirname:path.dirname(gatePath),URL,Date,console});
 return {async init(){await mod.exports.createLoginGate(async()=>{entered++})},call(n,p){const w=windows.at(-1);return handlers.get(n)({sender:w.webContents,senderFrame:w.webContents.mainFrame},p)},get entered(){return entered},handlers,windows};
}
test('failed login never enters Harness',async()=>{const f=fixture();await f.init();assert.equal((await f.call('auth:login',{password:'bad'})).success,false);assert.equal(f.entered,0)});
test('administrator cannot enter Harness',async()=>{const f=fixture(10);await f.init();assert.equal((await f.call('auth:login',{password:'ok'})).success,false);assert.equal(f.entered,0)});
test('member enters Harness after self verification',async()=>{const f=fixture();await f.init();assert.equal((await f.call('auth:login',{password:'ok'})).authenticated,true);assert.equal(f.entered,1)});
test('two factor blocks Harness until verified',async()=>{const f=fixture(1,true);await f.init();assert.equal((await f.call('auth:login',{password:'ok'})).requiresTwoFactor,true);assert.equal(f.entered,0);assert.equal((await f.call('auth:verify-2fa','123456')).authenticated,true);assert.equal(f.entered,1)});
test('unowned renderer rejected',async()=>{const f=fixture();await f.init();await assert.rejects(f.handlers.get('auth:status')({sender:{},senderFrame:{url:'file:///evil/login.html'}}),/Unauthorized/)});
