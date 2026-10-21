const MARKER = '/* changda-client-release-check-v2 */'
const CUSTOM_IMPORT = 'const loadCustom = (name) => import(__rewriteRelativeImportExtension(pathToFileURL(join(customRoot, name)).href));'
const MENU_ITEM = "{ label: '更新日志…', click: openReleaseLog },"

function patchClientReleaseCheck(source, config) {
  if (source.includes(MARKER)) return source

  const server = new URL(config.serverUrl)
  const apiPath = config.apiPath || '/api/client-releases/latest'
  if (server.username || server.password || server.search || server.hash) {
    throw new Error('Client release server URL is invalid')
  }
  if (typeof apiPath !== 'string' || !apiPath.startsWith('/') || apiPath.startsWith('//')) {
    throw new Error('Client release API path is invalid')
  }

  const check = `${MARKER}
\tlet clientReleaseUpdateRunning = false;
\tconst checkClientReleaseNow = async (manual) => {
\t\tif (clientReleaseUpdateRunning) return;
\t\tclientReleaseUpdateRunning = true;
\t\ttry {
\t\t\tconst { checkClientRelease } = await loadCustom('client-release-check.cjs');
\t\t\tconst result = await checkClientRelease({
\t\t\t\tconfig: ${JSON.stringify({ serverUrl: server.origin, apiPath })},
\t\t\t\tcurrentVersion: app.getVersion(),
\t\t\t\tplatform: process.arch === 'arm64' ? 'windows-arm64' : 'windows-x64',
\t\t\t\tchannel: 'stable'
\t\t\t});
\t\t\tif (!result.updateAvailable) {
\t\t\t\tif (manual) await dialog.showMessageBox({ type: 'info', title: '检查更新', message: \`当前已是最新版本（\${app.getVersion()}）\` });
\t\t\t\treturn;
\t\t\t}
\t\t\tconst release = result.release;
\t\t\tconst detail = [release.mandatory ? '此版本为必需更新。' : '', release.releaseNotes || '此版本没有填写更新说明。'].filter(Boolean).join('\\n\\n');
\t\t\tif (manual && (await dialog.showMessageBox({ type: 'info', title: '发现客户端更新', message: \`发现新版本：\${release.version}\`, detail, buttons: ['下载并安装', '稍后'], defaultId: 0, cancelId: 1 })).response !== 0) return;
\t\t\tconst { downloadClientRelease, launchWindowsInstaller } = await loadCustom('client-release-updater.cjs');
\t\t\tconst downloaded = await downloadClientRelease({ release, destinationDirectory: join(app.getPath('userData'), 'client-updates') });
\t\t\tconst choice = await dialog.showMessageBox({ type: 'info', title: '客户端更新已下载', message: \`版本 \${release.version} 已下载并通过校验。\`, detail: '立即退出并安装更新？', buttons: ['现在安装并重启', '稍后'], defaultId: 0, cancelId: 1 });
\t\t\tif (choice.response !== 0) return;
\t\t\tif (process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE) throw new Error('便携版客户端不支持自动安装更新，请使用完整安装版');
\t\t\tawait launchWindowsInstaller({ installerPath: downloaded.filePath, executablePath: app.getPath('exe'), ownerPid: process.pid });
\t\t\tshellInstallerOwnsQuit = true;
\t\t\tconst activeHost = host;
\t\t\thost = void 0;
\t\t\tawait activeHost?.stop();
\t\t\tapp.quit();
\t\t} catch (error) {
\t\t\tif (manual) await dialog.showMessageBox({ type: 'error', title: '更新检查失败', message: error instanceof Error ? error.message : '检查更新失败，请稍后重试。' });
\t\t\telse console.warn('client release check failed:', error);
\t\t} finally {
\t\t\tclientReleaseUpdateRunning = false;
\t\t}
\t};`

  if (!source.includes(CUSTOM_IMPORT)) throw new Error('Current client custom-login import anchor was not found')
  if (!source.includes(MENU_ITEM)) throw new Error('Current client release log menu anchor was not found')
  const menuStart = 'const applicationItems = () => ['
  if (!source.includes(menuStart)) throw new Error('Current client application menu anchor was not found')
  const publishAnchor = '\tpublishUpdate(updateState);'
  const publishAt = source.lastIndexOf(publishAnchor)
  if (publishAt === -1) throw new Error('Current client startup completion anchor was not found')

  source = source.replace(CUSTOM_IMPORT, `${CUSTOM_IMPORT}\n${check}`)
  source = source.replace(MENU_ITEM, `${MENU_ITEM}\n\t\t{ label: '检查更新…', click: () => checkClientReleaseNow(true) },`)
  const finalPublishAt = source.lastIndexOf(publishAnchor)
  const insertAt = finalPublishAt + publishAnchor.length
  source = `${source.slice(0, insertAt)}\n\tvoid checkClientReleaseNow(false);${source.slice(insertAt)}`
  return source
}

module.exports = { patchClientReleaseCheck }
