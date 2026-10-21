const fs = require('node:fs')
const path = require('node:path')

const clientRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(clientRoot, '..')
const defaultInstalled = path.join(repoRoot, '.base-3', 'win-unpacked')
const installed = path.resolve(process.argv[2] || defaultInstalled)
const outputRoot = path.resolve(process.argv[3] || path.join(repoRoot, 'output'))
const releaseSource = path.join(installed, 'resources', 'app')
const resourcesSource = path.join(installed, 'resources')
const manifestPath = path.join(releaseSource, 'package.json')
const configPath = path.join(releaseSource, 'custom-login', 'desktop.config.json')
const electronBuilder = path.join(clientRoot, 'node_modules', '.bin', 'electron-builder.cmd')
const releaseLogSource = path.join(clientRoot, 'dsh-login', 'release-log.html')
const releaseCheckSource = path.join(clientRoot, 'dsh-login', 'client-release-check.cjs')
const releaseUpdaterSource = path.join(clientRoot, 'dsh-login', 'client-release-updater.cjs')
const releaseCheckPatch = require('../dsh-login/patch-client-release-check.cjs').patchClientReleaseCheck
const releaseVersion = process.env.CLIENT_RELEASE_VERSION || '1.0.1'
const marker = '/* changda-release-log-v1 */'

function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.cpSync(source, destination, { recursive: true, dereference: true })
}

function assertExists(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} not found: ${file}`)
}

function patchDshUiVersion(dshRoot, version) {
  const settingsGeneralPath = path.join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-general', 'lib', 'client.js')
  assertExists(settingsGeneralPath, 'DSH settings general client bundle')
  let settingsGeneral = fs.readFileSync(settingsGeneralPath, 'utf8')
  const currentVersionPattern = /children: t\("general\.currentVersion", \{ version: "([^"]+)" \}\)/
  const currentVersion = settingsGeneral.match(currentVersionPattern)
  if (currentVersion === null) throw new Error('DSH settings current version anchor was not found')
  settingsGeneral = settingsGeneral.replace(currentVersionPattern, `children: t("general.currentVersion", { version: ${JSON.stringify(version)} })`)
  fs.writeFileSync(settingsGeneralPath, settingsGeneral)

  const sidebarPath = path.join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-sidebar', 'lib', 'client.js')
  if (fs.existsSync(sidebarPath)) {
    let sidebar = fs.readFileSync(sidebarPath, 'utf8')
    const sidebarVersionPattern = /return `0\.2\.0-rc\.2-639ed01` \+ \(\{\}\.DSH_CLIENT_GIT_DIRTY === "true" \? "-dirty" : ""\);/
    if (sidebarVersionPattern.test(sidebar)) {
      sidebar = sidebar.replace(sidebarVersionPattern, `return ${JSON.stringify(version)};`)
      fs.writeFileSync(sidebarPath, sidebar)
    }
  }
}

function patchMain(source, serverUrl, version) {
  const needsReleaseLogPatch = !source.includes(marker)
  const customRootLine = 'const loadCustom = (name) => import(__rewriteRelativeImportExtension(pathToFileURL(join(customRoot, name)).href));'
  if (needsReleaseLogPatch && !source.includes(customRootLine)) throw new Error('Current client custom-login import anchor was not found')

  const setup = `${marker}
	let releaseLogWindow;
	const releaseHistoryConfig = ${JSON.stringify({
    serverUrl: new URL(serverUrl).origin,
    apiPath: '/api/client-releases/latest',
    historyPath: '/api/client-releases/history'
  })};
	const openReleaseLog = () => {
		if (releaseLogWindow !== void 0 && !releaseLogWindow.isDestroyed()) {
			releaseLogWindow.focus();
			return;
		}
		releaseLogWindow = createWindow(fileURLToPath(new URL('./preload-release-log.cjs', import.meta.url)));
		releaseLogWindow.setSize(760, 680);
		releaseLogWindow.setMinimumSize(640, 500);
		releaseLogWindow.setTitle('更新日志');
		releaseLogWindow.once('ready-to-show', () => releaseLogWindow?.show());
		releaseLogWindow.once('closed', () => { releaseLogWindow = void 0; });
		releaseLogWindow.loadURL('dsh-app://shell/release-log.html').catch((error) => {
			console.error('release log window failed to load:', error);
		});
	};
	const { listClientReleaseHistory } = await loadCustom('client-release-check.cjs');
	ipcMain.handle('dsh-desktop:release-history', async (event) => {
		assertDesktopSender(event, ['shell']);
		if (event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== 'dsh-app://shell/release-log.html') throw new Error('dsh desktop: rejected release history request');
		const currentRelease = {
			version: app.getVersion(),
			releaseNotes: '修复客户端启动兼容问题；修复用量与成本页面调用错误；增加更新日志查看入口。',
			mandatory: false,
			publishedAt: Math.floor(Date.UTC(2026, 9, 17) / 1000)
		};
		try {
			const history = await listClientReleaseHistory({ config: releaseHistoryConfig, platform: 'windows-x64', channel: 'stable' });
			if (history.some((release) => release.version === currentRelease.version)) return history;
			return [currentRelease, ...history].slice(0, 50);
		} catch (error) {
			console.warn('client release history unavailable; showing bundled release notes:', error);
			return [currentRelease];
		}
	});
	/* changda-lab-models-ipc-v1 */
	if (!globalThis.__changdaLabModelsIpc) {
		globalThis.__changdaLabModelsIpc = true;
		for (const action of ['state', 'refresh', 'select', 'check', 'balance', 'usage', 'dashboard', 'launch', 'terminal']) {
			ipcMain.handle('lab-models:' + action, async (event, ...args) => {
				assertDesktopSender(event, ['app']);
				const bridge = modelBridge;
				if (bridge === void 0) throw new Error('模型桥未就绪，请重新登录');
				if (action === 'state') return bridge.state();
				return bridge[action](...args);
			});
		}
	}
`
  if (needsReleaseLogPatch) source = source.replace(customRootLine, `${customRootLine}\n${setup}`)

  const runtimeDshLine = 'dsh: (development ? process.env.DSH_DESKTOP_DSH_DIR : void 0) ?? (development ? join(app.getAppPath(), ".desktop-build", "development", "project") : join(app.getAppPath(), "dsh"))'
  const patchedRuntimeDshLine = 'dsh: (development ? process.env.DSH_DESKTOP_DSH_DIR : void 0) ?? (development ? join(app.getAppPath(), ".desktop-build", "development", "project") : join(process.resourcesPath, "dsh"))'
  if (source.includes(runtimeDshLine)) source = source.replace(runtimeDshLine, patchedRuntimeDshLine)
  else if (!source.includes(patchedRuntimeDshLine)) throw new Error('Current client runtime dsh path anchor was not found')

  const runtimeNodeLine = 'node: process.execPath,'
  const patchedRuntimeNodeLine = 'node: development ? process.execPath : join(process.resourcesPath, "runtime", "primary-runtime", "dependencies", "node", "bin", process.platform === "win32" ? "node.exe" : "node"),'
  if (source.includes(runtimeNodeLine)) source = source.replace(runtimeNodeLine, patchedRuntimeNodeLine)
  else if (!source.includes(patchedRuntimeNodeLine)) throw new Error('Current client runtime node path anchor was not found')

  const menuStart = 'const applicationItems = () => ['
  if (!source.includes(menuStart)) throw new Error('Current client application menu anchor was not found')
  if (!source.includes("{ label: '更新日志…', click: openReleaseLog },")) source = source.replace(menuStart, `${menuStart}\n\t\t{ label: '更新日志…', click: openReleaseLog },`)
	const cliCommandMenuBlock = `\t\t...process.platform === "darwin" || process.platform === "win32" ? [{
\t\t\tlabel: currentDesktopLocale().messages.cliCommandMenu,
\t\t\tclick: () => {
\t\t\t\tcommandManager.show();
\t\t\t}
\t\t}] : [],`
	if (source.includes(cliCommandMenuBlock)) source = source.replace(cliCommandMenuBlock, '\t\t/* dsh 命令管理入口对客户版本隐藏。 */')
	const versionReturn = 'return "0.2.0-rc.2";'
	if (source.includes(versionReturn)) source = source.replace(versionReturn, `return ${JSON.stringify(version)};`)
	if (source.includes('devTools: true')) source = source.replaceAll('devTools: true', 'devTools: development')
	const f12HandlerLine = 'if (input.type !== "keyDown" || input.key !== "F12" || input.isAutoRepeat) return;'
	if (source.includes(f12HandlerLine)) source = source.replace(f12HandlerLine, 'if (app.isPackaged || input.type !== "keyDown" || input.key !== "F12" || input.isAutoRepeat) return;')
	const devToolsItemsLine = `\tconst devToolsItems = [{\n\t\trole: "toggleDevTools",\n\t\tvisible: false\n\t}, {\n\t\trole: "toggleDevTools",\n\t\tvisible: false,\n\t\taccelerator: "F12"\n\t}];`
	if (source.includes(devToolsItemsLine)) source = source.replace(devToolsItemsLine, '\tconst devToolsItems = development ? [{\n\t\trole: "toggleDevTools",\n\t\tvisible: true\n\t}, {\n\t\trole: "toggleDevTools",\n\t\tvisible: true,\n\t\taccelerator: "F12"\n\t}] : [];')
  return releaseCheckPatch(source, { serverUrl, apiPath: '/api/client-releases/latest' })
}

function makePreload() {
  return `const { contextBridge, ipcRenderer } = require('electron')\n\ncontextBridge.exposeInMainWorld('desktopReleaseLog', {\n  load: () => ipcRenderer.invoke('dsh-desktop:release-history')\n})\n`
}

function validateConfig(config) {
  const url = new URL(config.serverUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid server URL protocol')
  if (url.username || url.password || url.search || url.hash) throw new Error('Invalid server URL')
  config.apiPaths = { ...(config.apiPaths || {}),
    clientReleaseLatest: '/api/client-releases/latest',
    clientReleaseHistory: '/api/client-releases/history'
  }
  return config
}

async function main() {
  assertExists(path.join(installed, 'resources', 'app'), 'Current unpacked app')
  assertExists(path.join(resourcesSource, 'runtime'), 'Current bundled runtime')
  assertExists(manifestPath, 'App package manifest')
  assertExists(configPath, 'Production desktop config')
  assertExists(electronBuilder, 'electron-builder')
  assertExists(releaseLogSource, 'Release log page')
  assertExists(releaseCheckSource, 'Release history API client')
  assertExists(releaseUpdaterSource, 'Client release updater')

  const metadata = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (metadata.version !== '1.0.0') {
    throw new Error(`Unexpected current client version: ${metadata.version}`)
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(releaseVersion)) {
    throw new Error(`Invalid client release version: ${releaseVersion}`)
  }
  if (metadata.dshDesktopAppId !== 'com.changda.oilfield.desktop') throw new Error('Unexpected current client app id')
  const config = validateConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')))
  const releaseDir = fs.mkdtempSync(path.join(outputRoot, `current-client-${releaseVersion}-`))
  const appDir = path.join(releaseDir, 'app')
  const resourcesDir = path.join(releaseDir, 'resources')
  copy(releaseSource, appDir)
  copy(path.join(resourcesSource, 'runtime'), path.join(resourcesDir, 'runtime'))
  const unpackedDsh = path.join(installed, 'resources', 'app.asar.unpacked', 'dsh')
  const bundledDsh = path.join(resourcesSource, 'dsh')
  if (!fs.existsSync(unpackedDsh) && !fs.existsSync(bundledDsh)) {
    throw new Error(`DSH runtime dependencies not found: ${unpackedDsh} or ${bundledDsh}`)
  }
  copy(path.join(releaseSource, 'dsh'), path.join(resourcesDir, 'dsh'))
  copy(fs.existsSync(unpackedDsh) ? unpackedDsh : bundledDsh, path.join(resourcesDir, 'dsh'))
  patchDshUiVersion(path.join(resourcesDir, 'dsh'), releaseVersion)
  for (const name of ['icon.png', 'tray.ico', 'elevate.exe']) {
    const source = path.join(resourcesSource, name)
    if (fs.existsSync(source)) copy(source, path.join(resourcesDir, name))
  }

  const mainPath = path.join(appDir, 'lib', 'main.js')
  fs.writeFileSync(mainPath, patchMain(fs.readFileSync(mainPath, 'utf8'), config.serverUrl, releaseVersion))
  fs.writeFileSync(path.join(appDir, 'custom-login', 'desktop.config.json'), `${JSON.stringify(config, null, 2)}\n`)
  copy(releaseCheckSource, path.join(appDir, 'custom-login', 'client-release-check.cjs'))
  copy(releaseUpdaterSource, path.join(appDir, 'custom-login', 'client-release-updater.cjs'))
  copy(releaseLogSource, path.join(appDir, 'renderer', 'release-log.html'))
  fs.writeFileSync(path.join(appDir, 'lib', 'preload-release-log.cjs'), makePreload())

  const stagedMetadata = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'))
  stagedMetadata.version = releaseVersion
  fs.writeFileSync(path.join(appDir, 'package.json'), `${JSON.stringify(stagedMetadata, null, 2)}\n`)
  const verifiedMetadata = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'))
  if (verifiedMetadata.version !== releaseVersion) throw new Error('Staging changed the client release version')
  const configuredIcon = config.appIconPath ? path.join(appDir, config.appIconPath) : ''
  const iconPath = configuredIcon && fs.existsSync(configuredIcon)
    ? configuredIcon
    : path.join(appDir, 'custom-login', 'lab-icon.ico')
  const configFile = path.join(releaseDir, 'electron-builder.config.cjs')
  const builderConfig = {
    appId: metadata.dshDesktopAppId,
    productName: config.productName,
    electronVersion: '44.1.0',
    asar: false,
    publish: null,
    directories: { app: appDir, output: path.join(releaseDir, 'installer') },
    files: ['**/*', '!**/*.test.*', '!**/test/**', '!**/tests/**', '!**/README*'],
    extraResources: [{ from: resourcesDir, to: '.', filter: ['runtime/**/*', 'dsh/**/*', 'icon.png', 'tray.ico', 'elevate.exe'] }],
    win: {
      target: ['nsis', 'portable'],
      artifactName: `长大计科智慧油田实验室-\${version}-\${arch}.\${ext}`,
      icon: iconPath
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: config.productName,
      deleteAppDataOnUninstall: false
    },
    portable: { artifactName: `长大计科智慧油田实验室-Portable-\${version}-\${arch}.\${ext}` }
  }
  fs.writeFileSync(configFile, `module.exports = ${JSON.stringify(builderConfig, null, 2)}\n`)
  fs.writeFileSync(path.join(releaseDir, 'build-manifest.json'), JSON.stringify({
    source: installed,
    sourceVersion: releaseVersion,
    baseClientVersion: metadata.version,
    version: releaseVersion,
    runtimeVersion: JSON.parse(fs.readFileSync(path.join(appDir, 'dsh', 'desktop-runtime.json'), 'utf8')).release.version,
    serverUrl: config.serverUrl,
    appId: metadata.dshDesktopAppId
  }, null, 2))
  fs.writeFileSync(path.join(clientRoot, 'current-release-stage.json'), JSON.stringify({
    directory: releaseDir,
    config: configFile,
    sourceVersion: releaseVersion,
    baseClientVersion: metadata.version,
    version: releaseVersion
  }, null, 2))
  console.log(JSON.stringify({ directory: releaseDir, sourceVersion: releaseVersion, baseClientVersion: metadata.version, version: releaseVersion, config: configFile }))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
