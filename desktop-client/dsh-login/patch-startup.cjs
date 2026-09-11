function patchStartup(source){
 source=source.replaceAll('This release includes its matching dsh version. The application will restart after installation.','本版本包含匹配的本地工作台组件，安装后应用将自动重启。').replaceAll('新版本绑定匹配的 dsh，安装后将重新启动。','新版本包含匹配的本地工作台组件，安装后应用将自动重启。');
 const fast='function mergePnpmStore(source, destination) {';
 const move=' /* lab-store-first-install-move */ if (!existsSync(destination)) { mkdirSync(dirname(destination), {recursive:true}); try { renameSync(source,destination); return; } catch(error) { if(error.code!=="EXDEV")throw error; } } ';
 if(!source.includes('lab-store-first-install-move')){
 if(!source.includes(fast))throw Error('Store merge anchor missing');
 source=source.replace(fast,fast+move);
 }
 if(source.includes('lab-startup-feedback-v1'))return source;
 const verify='verifySeedIntegrity(seedDir);';
 const fastPath='if (existsSync(this.paths.profile) && this.releaseVersion() === target.version && this.dshVersion() === target.version && this.installedPackageVersion("@deepseek-ai/dsh-desktop-host") === target.version) {';
 if(source.includes(verify)&&source.includes(fastPath)){
  source=source.replace(verify,'');
  source=source.replace(fastPath,fastPath+'\n\t\t\tverifySeedIntegrity(seedDir);');
 }
 const anchor='async function main() {';
 const html='<meta charset="utf-8"><title>长大计科智慧油田实验室</title><body style="margin:0;padding:42px;font-family:Microsoft YaHei;background:#fafbff;color:#26324a"><h2>长大计科智慧油田实验室</h2><p>正在准备运行环境，请稍候…</p><p style="color:#778198;font-size:14px">首次启动需要初始化本机组件，完成后自动显示登录页。</p></body>';
 const intro=' /* lab-startup-feedback-v1 */ let startupComplete=false; const startupWindow=new BrowserWindow({width:580,height:280,show:true,resizable:false,autoHideMenuBar:true,title:"长大计科智慧油田实验室",webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}}); startupWindow.on("closed",()=>{if(!startupComplete)app.quit()}); await startupWindow.loadURL('+JSON.stringify('data:text/html;charset=utf-8,'+encodeURIComponent(html))+'); await new Promise(resolve=>setTimeout(resolve,60)); ';
 if(!source.includes(anchor)||!source.includes('publishUpdate(updateState);'))throw Error('Startup anchors missing');
 source=source.replace(anchor,anchor+intro);
 source=source.replace('publishUpdate(updateState);','startupComplete=true; if(!startupWindow.isDestroyed())startupWindow.destroy(); publishUpdate(updateState);');
 return source;
}
module.exports={patchStartup};

