function patchStartup(source, releaseConfig){
 source=source.replaceAll('This release includes its matching dsh version. The application will restart after installation.','本版本包含匹配的本地工作台组件，安装后应用将自动重启。').replaceAll('新版本绑定匹配的 dsh，安装后将重新启动。','新版本包含匹配的本地工作台组件，安装后应用将自动重启。');
 const sharedHome='const initialDshHome = resolveDshHome();';
 if(!source.includes('lab-user-data-home-v1')){
  if(!source.includes(sharedHome))throw Error('Initial DSH_HOME anchor missing');
  source=source.replace(sharedHome,' /* lab-user-data-home-v1 */ const initialDshHome = join(app.getPath("userData"), "dsh");');
 }
 if(!source.includes('lab-user-data-paths-v1')){
  if(!source.includes('const paths = resolveDesktopPaths();'))throw Error('Desktop paths anchor missing');
  source=source.replace('const paths = resolveDesktopPaths();',' /* lab-user-data-paths-v1 */ const paths = resolveDesktopPaths(initialDshHome);');
 }
 const accountDshHome = "process.env.DSH_HOME = join(initialDshHome, 'new-api-accounts', createHash('sha256').update(account.serverUrl + '/' + account.id).digest('hex'));";
 if(!source.includes('lab-shared-profile-home-v1')){
  if(!source.includes(accountDshHome))throw Error('Account DSH_HOME anchor missing');
  source=source.replace(accountDshHome,' /* lab-shared-profile-home-v1 */ process.env.DSH_HOME = initialDshHome;');
 }
 const fast='function mergePnpmStore(source, destination) {';
 const move=' /* lab-store-first-install-move */ if (!existsSync(destination)) { mkdirSync(dirname(destination), {recursive:true}); try { renameSync(source,destination); return; } catch(error) { if(error.code!=="EXDEV")throw error; } } ';
 if(!source.includes('lab-store-first-install-move')){
 if(!source.includes(fast))throw Error('Store merge anchor missing');
 source=source.replace(fast,fast+move);
 }
 const activeReleaseFastPath='if (existsSync(this.paths.profile) && this.releaseVersion() === target.version && this.dshVersion() === target.version && this.installedPackageVersion("@deepseek-ai/dsh-desktop-host") === target.version) {';
 const guardedActiveReleaseFastPath='if (existsSync(this.paths.profile) && (() => { try { return this.releaseVersion() === target.version && this.dshVersion() === target.version && this.installedPackageVersion("@deepseek-ai/dsh-desktop-host") === target.version; } catch { return false; } })()) {';
 if(!source.includes('lab-active-profile-recovery-v1')){
  if(!source.includes(activeReleaseFastPath))throw Error('Active profile fast-path anchor missing');
  source=source.replace(activeReleaseFastPath,guardedActiveReleaseFastPath+' /* lab-active-profile-recovery-v1 */');
 }
 if(source.includes('lab-startup-feedback-v1'))return source;
 const verify='verifySeedIntegrity(seedDir);';
 const fastPath='if (existsSync(this.paths.profile) && this.releaseVersion() === target.version && this.dshVersion() === target.version && this.installedPackageVersion("@deepseek-ai/dsh-desktop-host") === target.version) {';
 if(source.includes(verify)&&source.includes(fastPath)){
  source=source.replace(verify,'');
  source=source.replace(fastPath,fastPath+'\n\t\t\tverifySeedIntegrity(seedDir);');
 }
 const updateAnchor='const checkAndPrompt = async (manual) => {';
 if(!source.includes('lab-client-release-check-v1') && source.includes(updateAnchor)){
  if(!releaseConfig || typeof releaseConfig.serverUrl !== 'string')throw Error('Client release server config missing');
  const configuredPath=releaseConfig.apiPaths?.clientReleaseLatest || '/api/client-releases/latest';
  const configuredHistoryPath=releaseConfig.apiPaths?.clientReleaseHistory || '/api/client-releases/history';
  const parsedServer=new URL(releaseConfig.serverUrl);
  if(parsedServer.username||parsedServer.password||parsedServer.search||parsedServer.hash||!configuredPath.startsWith('/')||configuredPath.startsWith('//')||!configuredHistoryPath.startsWith('/')||configuredHistoryPath.startsWith('//'))throw Error('Client release server config invalid');
  const updatePattern=/const checkAndPrompt = async \(manual\) => \{[\s\S]*?\n\t\};\n\tconst openPluginWindow =/;
  if(!updatePattern.test(source))throw Error('Client release prompt anchor missing');
  const updatePrompt=`/* lab-client-release-check-v1 */ const clientReleaseConfig = { serverUrl: ${JSON.stringify(parsedServer.origin)}, apiPath: ${JSON.stringify(configuredPath)}, historyPath: ${JSON.stringify(configuredHistoryPath)} }; ipcMain.handle('dsh-desktop:release-history', async (event) => { assertDesktopSender(event, ['shell']); const { listClientReleaseHistory } = await import('../new-api-login/client-release-check.cjs'); return listClientReleaseHistory({ config: clientReleaseConfig, platform: process.arch === 'arm64' ? 'windows-arm64' : 'windows-x64', channel: 'stable' }); }); const checkAndPrompt = async (manual) => { try { const { checkClientRelease } = await import('../new-api-login/client-release-check.cjs'); const result = await checkClientRelease({ config: clientReleaseConfig, currentVersion: app.getVersion(), platform: process.arch === 'arm64' ? 'windows-arm64' : 'windows-x64', channel: 'stable' }); if (!result.updateAvailable) { if (manual) await dialog.showMessageBox({ type: 'info', title: messages.updateCheckTitle, message: messages.updateCurrent }); return; } const release = result.release; const detail = [release.mandatory ? '此版本为必需更新。' : '', release.releaseNotes || '此版本没有填写更新说明。'].filter(Boolean).join('\\n\\n'); await dialog.showMessageBox({ type: 'info', title: messages.updateTitle, message: messages.updateAvailable + ': ' + release.version, detail, buttons: ['知道了'] }); } catch (error) { if (manual) await dialog.showMessageBox({ type: 'error', title: messages.updateCheckFailedTitle, message: error instanceof Error ? error.message : messages.unknownError }); } };`;
  source=source.replace(updatePattern,updatePrompt+'\n\tconst openPluginWindow =');
 }
 if(!source.includes('lab-client-release-history-v1')){
  const menuAnchor="{ type: \"separator\" },\n{label:'退出登录'";
  const pluginAnchor='\tconst openPluginWindow = () => {';
  if(source.includes(menuAnchor) && source.includes(pluginAnchor)){
   source=source.replace(menuAnchor,"{label:'更新日志…',click:openReleaseNotesWindow},\n\t\t\t"+menuAnchor);
   const historyWindow=`\t/* lab-client-release-history-v1 */ let releaseLogWindow; const openReleaseNotesWindow = () => { if (releaseLogWindow && !releaseLogWindow.isDestroyed()) { releaseLogWindow.focus(); return; } releaseLogWindow = createWindow(appPreload); releaseLogWindow.setSize(760, 680); releaseLogWindow.setMinimumSize(640, 500); releaseLogWindow.setTitle('更新日志'); releaseLogWindow.once('ready-to-show', () => releaseLogWindow?.show()); releaseLogWindow.once('closed', () => { releaseLogWindow = void 0; }); releaseLogWindow.loadURL(\u0060\u0024{SCHEME}://shell/release-log.html\u0060); };\n`;
   source=source.replace(pluginAnchor,historyWindow+pluginAnchor);
  }
 }
 const anchor='async function main() {';
 const html='<meta charset="utf-8"><title>长大计科智慧油田实验室</title><body style="margin:0;padding:42px;font-family:Microsoft YaHei;background:#fafbff;color:#26324a"><h2>长大计科智慧油田实验室</h2><p>正在准备运行环境，请稍候…</p><p style="color:#778198;font-size:14px">首次启动需要初始化本机组件，完成后自动显示登录页。</p></body>';
 const intro=' /* lab-startup-feedback-v1 */ let startupComplete=false; const startupWindow=new BrowserWindow({width:580,height:280,show:true,resizable:false,autoHideMenuBar:true,title:"长大计科智慧油田实验室",webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}}); startupWindow.on("closed",()=>{if(!startupComplete)app.quit()}); await startupWindow.loadURL('+JSON.stringify('data:text/html;charset=utf-8,'+encodeURIComponent(html))+'); await new Promise(resolve=>setTimeout(resolve,60)); ';
 if(!source.includes(anchor)||!source.includes('publishUpdate(updateState);'))throw Error('Startup anchors missing');
 source=source.replace(anchor,anchor+intro);
 source=source.replace('publishUpdate(updateState);','startupComplete=true; if(!startupWindow.isDestroyed())startupWindow.destroy(); publishUpdate(updateState);');
 const authRefresh='host = await startHost(); const {ModelBridge} = await import(\'../new-api-login/model-bridge.cjs\'); modelBridge = new ModelBridge(host,account.apiClient); await modelBridge.refresh(); authenticated = true;';
 if(!source.includes('lab-model-sync-best-effort-v1')){
  if(source.includes(authRefresh)) source=source.replace(authRefresh,"host = await startHost(); const {ModelBridge} = await import('../new-api-login/model-bridge.cjs'); modelBridge = new ModelBridge(host,account.apiClient); try { await modelBridge.refresh(); } catch (error) { modelBridge.syncError = error?.message || '账号模型配置同步失败'; } /* lab-model-sync-best-effort-v1 */ authenticated = true;");
 }
 const startHostAnchor='const startHost = async (projectDir = activeProject) => {';
 if(!source.includes('lab-host-path-diagnostics-v1')){
  if(source.includes(startHostAnchor)) source=source.replace(startHostAnchor,startHostAnchor+" const required = [resources.node, projectDir, join(projectDir, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js')]; const missing = required.filter(path => !existsSync(path)); if (missing.length) throw new Error('本地工作台启动文件缺失: ' + missing.join(' | ')); /* lab-host-path-diagnostics-v1 */");
 }
 return source;
}
module.exports={patchStartup};

