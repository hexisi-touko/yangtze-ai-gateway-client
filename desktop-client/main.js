const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, session, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { loadDesktopConfig, logoPathForLoginPage } = require('./src/config')
const { NewApiClient, NewApiClientError } = require('./src/new-api-client')
const { PasswordResetStore } = require('./src/password-reset-store')
const { CredentialStore } = require('./src/credential-store')
const { RegistrationStore } = require('./src/registration-store')
const { ToolSyncManager } = require('./src/tool-sync/manager')
const { ClaudeAdapter } = require('./src/tool-sync/claude-adapter')
const { CodexAdapter } = require('./src/tool-sync/codex-adapter')
const { launchTool } = require('./src/tool-sync/process-launcher')
const { HarnessManager } = require('./src/harness-manager')
const { HarnessTask } = require('./src/harness-task')
const { createDesktopToolsCache } = require('./src/desktop-tools-cache')

const diagnosticLogPath = path.join(process.env.TEMP || process.env.TMP || '.', 'api-client-local-test-main.log')
function diagnosticLog(message, details) {
  try {
    const suffix = details === undefined ? '' : ` ${JSON.stringify(details)}`
    require('node:fs').appendFileSync(diagnosticLogPath, `[API-CLIENT-DIAG] ${new Date().toISOString()} ${message}${suffix}\n`)
  } catch {
    // Diagnostics must never prevent the client from starting.
  }
}

diagnosticLog('process-start', { argv: process.argv, execPath: process.execPath, resourcesPath: process.resourcesPath })

const desktopConfig = loadDesktopConfig()
diagnosticLog('config-loaded', { productName: desktopConfig.productName, serverUrl: desktopConfig.serverUrl })
const LOGIN_WINDOW_WIDTH = 420
const LOGIN_WINDOW_HEIGHT = 620
const USER_SESSION_PARTITION = desktopConfig.sessionPartition

let loginWindow = null
let userWindow = null
let toolSwitcherWindow = null
let apiSession = null
let apiClient = null
let passwordResetStore = null
let credentialStore = null
let registrationStore = null
let pendingTwoFactor = null
let pendingRegistration = null
let toolSyncManager = null
let harnessManager = null
let currentAccount = null
let desktopToolsCache = null
let harnessWindow = null
let harnessStartPromise = null
let startupProgressWindow = null

async function showStartupProgress(stage, percent) {
  const text = { login: '正在验证账号', service: '正在启动本地工作台', page: '正在加载工作台页面', sync: '正在同步配置' }[stage] || '正在准备工作台'
  const html = `<meta charset="utf-8"><style>body{margin:0;background:#f7f9fc;color:#203452;font:16px Microsoft YaHei;text-align:center;padding:48px 36px}h2{margin:0 0 28px;font-size:22px}.bar{height:8px;background:#e5eaf3;border-radius:8px;overflow:hidden}.fill{height:100%;width:${percent}%;background:#557bd8;transition:width .25s}p{color:#6d7b93;margin-top:18px}</style><h2>长大计科智慧油田实验室</h2><div class="bar"><div class="fill"></div></div><p>${text} · ${percent}%</p>`
  if (!startupProgressWindow || startupProgressWindow.isDestroyed()) {
    startupProgressWindow = new BrowserWindow({ width: 460, height: 250, resizable: false, frame: true, autoHideMenuBar: true, show: true, alwaysOnTop: true, title: desktopConfig.productName, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
  }
  await startupProgressWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  startupProgressWindow.show()
  startupProgressWindow.focus()
}

function closeStartupProgress() { if (startupProgressWindow && !startupProgressWindow.isDestroyed()) startupProgressWindow.close(); startupProgressWindow = null }

// This Electron runtime cannot start its GPU subprocess on the target Windows
// environment (exit code -1073741515). Keep Chromium's GPU service in-process
// so a failed child process cannot abort the renderer before local pages load.
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('in-process-gpu')
diagnosticLog('hardware-acceleration-disabled')
if (desktopConfig.userDataDirectoryName) {
  app.setPath('userData', path.join(app.getPath('appData'), desktopConfig.userDataDirectoryName))
}
// Keep Chromium's disposable HTTP/cache files out of the persisted account
// directory. This also avoids stale cache locks preventing local file pages
// from creating a renderer during recovery after an interrupted shutdown.
const runtimeCachePath = path.join(app.getPath('temp'), `${desktopConfig.appId}-cache-${process.pid}`)
fs.mkdirSync(runtimeCachePath, { recursive: true })
app.setPath('cache', runtimeCachePath)
diagnosticLog('runtime-paths', { userData: app.getPath('userData'), cache: app.getPath('cache'), temp: app.getPath('temp') })
app.setAppUserModelId(desktopConfig.appId)

function isLoginPage(event) {
  try {
    const sender = new URL(event.senderFrame.url)
    return sender.protocol === 'file:' && path.basename(sender.pathname) === 'login.html'
  } catch {
    return false
  }
}

function requireLoginPage(event) {
  if (!isLoginPage(event)) throw new Error('Unauthorized window request')
}

function isToolSwitcherPage(event) {
  try {
    const sender = new URL(event.senderFrame.url)
    const base = path.basename(sender.pathname)
    return sender.protocol === 'file:' && (base === 'tool-switcher.html' || base === 'workbench.html')
  } catch {
    return false
  }
}

function requireToolSwitcherPage(event) {
  if (!isToolSwitcherPage(event)) throw new Error('Unauthorized window request')
}

function isHarnessUrl(candidate) {
  try { return new URL(candidate).origin === harnessManager.url.slice(0, -1) } catch { return false }
}

function createHarnessMenu() {
  return Menu.buildFromTemplate([
    {
      label: '账号',
      submenu: [
        {
          label: '退出登录',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => {
            void returnToLoginFromHarnessWindow()
          },
        },
        { type: 'separator' },
        {
          label: '退出应用',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit()
          },
        },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '切换开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
  ])
}

async function returnToLoginFromHarnessWindow() {
  diagnosticLog('harness-logout-start')
  try {
    await apiSession?.clearStorageData({ origin: desktopConfig.serverUrl })
  } catch {
    // 忽略清除会话存储时的偶发错误
  }
  toolSyncManager?.setServerConfigs([])
  currentAccount = null
  if (apiClient) apiClient.accessToken = null
  toolSyncManager?.setAccountScope('')
  await harnessManager?.stop()
  if (harnessWindow && !harnessWindow.isDestroyed()) {
    harnessWindow.destroy()
  }
  harnessWindow = null
  showLoginWindow()
}

async function openHarnessWindow(sessionId) {
  const openStartedAt = Date.now()
  await showStartupProgress('service', 35)
  diagnosticLog('harness-window-open-start', { sessionId: sessionId || null })
  const startPromise = harnessStartPromise || (harnessStartPromise = harnessManager.start().finally(() => { harnessStartPromise = null }))
  const result = await startPromise
  diagnosticLog('harness-manager-started', { elapsedMs: Date.now() - openStartedAt, success: result.success })
  if (!result.success) { closeStartupProgress(); return result }
  await showStartupProgress('page', 65)
  if (harnessWindow && !harnessWindow.isDestroyed()) {
    if (sessionId) {
      await harnessWindow.webContents.executeJavaScript(`localStorage.setItem('dsh.sessions.current', ${JSON.stringify(JSON.stringify({ sessionId }))})`)
      if (harnessWindow.webContents.getURL() !== harnessManager.url) await harnessWindow.loadURL(harnessManager.url)
    }
    harnessWindow.show()
    harnessWindow.focus()
    if (userWindow && !userWindow.isDestroyed()) userWindow.destroy()
    userWindow = null
    if (toolSwitcherWindow && !toolSwitcherWindow.isDestroyed()) toolSwitcherWindow.destroy()
    toolSwitcherWindow = null
    if (loginWindow && !loginWindow.isDestroyed()) {
      const completedLoginWindow = loginWindow
      completedLoginWindow.hide()
      setTimeout(() => {
        if (!completedLoginWindow.isDestroyed()) completedLoginWindow.close()
      }, 100)
    }
    closeStartupProgress()
    return { success: true, ...result }
  }

  harnessWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    show: false,
    autoHideMenuBar: false,
    backgroundColor: '#ffffff',
    title: `${desktopConfig.productName} - 编程工作台`,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      spellcheck: false,
      navigateOnDragDrop: false,
    },
  })
  harnessWindow.setMenu(createHarnessMenu())
  harnessWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isHarnessUrl(targetUrl)) event.preventDefault()
  })
  harnessWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  harnessWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => diagnosticLog('harness-renderer-did-fail-load', { errorCode, errorDescription, validatedURL, isMainFrame }))
  harnessWindow.webContents.on('render-process-gone', (_event, details) => diagnosticLog('harness-renderer-process-gone', details))
  harnessWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => diagnosticLog('harness-renderer-console', { level, message, line, sourceId }))
  harnessWindow.once('ready-to-show', () => harnessWindow?.show())
  harnessWindow.on('closed', () => {
    harnessWindow = null
    void harnessManager?.stop()
  })
  try {
    await harnessWindow.loadURL(harnessManager.url)
    await harnessWindow.webContents.executeJavaScript(`(() => {
      const collapseThought = () => {
        for (const el of document.querySelectorAll('button,[role="button"]')) {
          const text = (el.textContent || '').trim()
          if (text === '已思考' || text.startsWith('已思考 ')) {
            el.setAttribute('aria-expanded', 'false')
            el.setAttribute('aria-disabled', 'true')
            el.style.pointerEvents = 'none'
            el.style.cursor = 'default'
            el.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation() }, true)
            el.addEventListener('keydown', event => { event.preventDefault(); event.stopImmediatePropagation() }, true)
          }
        }
      }
      collapseThought()
      const hideContextSources = () => {
        for (const el of document.querySelectorAll('body *')) {
          const text = (el.textContent || '').trim()
          if (!(text.includes('上下文注入') || text === 'AGENTS.md' || text.includes('@deepseek-ai/dsh-system-prompt') || text === 'skill-catalog')) continue
          let row = el
          for (let i = 0; i < 8 && row.parentElement; i++) {
            const parentText = (row.parentElement.textContent || '').trim()
            if (parentText.length > 500) break
            row = row.parentElement
          }
          row.style.setProperty('display', 'none', 'important')
        }
      }
      const hideShellItems = () => {
        for (const el of document.querySelectorAll('body *')) {
          const text = (el.textContent || '').trim()
          if (text !== '标准模式' && text !== '应用') continue
          if (el.children.length > 0) continue
          const row = el.closest('a,button,[role="button"],nav,header,li') || el
          row.style.setProperty('display', 'none', 'important')
        }
      }
      hideContextSources()
      hideShellItems()
      collapseThought()
      new MutationObserver(hideContextSources).observe(document.documentElement, { childList: true, subtree: true })
      new MutationObserver(hideShellItems).observe(document.documentElement, { childList: true, subtree: true })
      new MutationObserver(collapseThought).observe(document.documentElement, { childList: true, subtree: true })
    })()`)
    if (sessionId) {
      await harnessWindow.webContents.executeJavaScript(`localStorage.setItem('dsh.sessions.current', ${JSON.stringify(JSON.stringify({ sessionId }))})`)
    }
    diagnosticLog('harness-window-loaded', { url: harnessManager.url })
    diagnosticLog('harness-first-paint-ready', { elapsedMs: Date.now() - openStartedAt })
    await showStartupProgress('sync', 85)
    void syncHarnessModelsAfterLoad()
    if (userWindow && !userWindow.isDestroyed()) userWindow.destroy()
    userWindow = null
    if (toolSwitcherWindow && !toolSwitcherWindow.isDestroyed()) toolSwitcherWindow.destroy()
    toolSwitcherWindow = null
    if (loginWindow && !loginWindow.isDestroyed()) {
      const completedLoginWindow = loginWindow
      completedLoginWindow.hide()
      setTimeout(() => {
        if (!completedLoginWindow.isDestroyed()) completedLoginWindow.close()
      }, 100)
    }
    closeStartupProgress()
    return { success: true, ...result }
  } catch (error) {
    diagnosticLog('harness-window-load-error', { message: error?.message })
    if (harnessWindow && !harnessWindow.isDestroyed()) harnessWindow.destroy()
    harnessWindow = null
    closeStartupProgress()
    return { success: false, code: 'HARNESS_PAGE_LOAD_FAILED', message: '本机编程工作台页面加载失败。' }
  }
}

async function syncHarnessModelsAfterLoad() {
  try {
    const assigned = await apiClient?.getDesktopTools()
    const configs = await enrichModelsByUpstream(assigned?.tools || [])
    const taskApi = new HarnessTask({ url: harnessManager.url })
    for (const config of configs.filter(tool => ['codex-gpt', 'claude-code'].includes(tool.id) && tool.api_key && tool.api_base_url && tool.available_models?.length)) await taskApi.syncProvider(config)
    diagnosticLog('harness-models-synced', { count: configs.length })
  } catch (error) { diagnosticLog('harness-models-sync-failed', { message: error?.message }) }
}

function publicError(error, fallback) {
  if (error instanceof NewApiClientError) {
    return { success: false, message: error.message, code: error.code }
  }
  return { success: false, message: fallback, code: 'CLIENT_ERROR' }
}

async function enrichModelsByUpstream(configs) {
  const cache = new Map()
  return Promise.all((configs || []).map(async (config) => {
    if (!config?.api_key) return config
    if (config.models_authoritative === true || Array.isArray(config.model_catalog) || Array.isArray(config.available_models)) return config
    const key = `${config.api_base_url || ''}\n${config.api_key}`
    if (!cache.has(key)) cache.set(key, apiClient.getAvailableModels(config.api_key))
    try {
      return { ...config, available_models: await cache.get(key) }
    } catch {
      return { ...config, available_models: Array.isArray(config.available_models) ? config.available_models : [] }
    }
  }))
}

function updateSavedCredentials(credentials) {
  try {
    if (credentials?.rememberCredentials === true) {
      credentialStore.save({ username: credentials.username, password: credentials.password })
    } else {
      credentialStore.clear()
    }
  } catch {
    // 凭据存储失败不能阻止已通过验证的用户进入客户端。
  }
}

async function requireMemberAccount(result) {
  if (result.accountRole === 1) return
  await apiSession.clearStorageData({
    origin: desktopConfig.serverUrl,
    storages: ['cookies', 'localstorage'],
  })
  throw new NewApiClientError('管理员账号请使用 Web 管理后台登录', {
    code: 'DESKTOP_MEMBER_ONLY',
  })
}

function isServerUrl(candidate) {
  try {
    return new URL(candidate).origin === desktopConfig.serverUrl
  } catch {
    return false
  }
}

function isSafeExternalUrl(candidate) {
  try {
    return new URL(candidate).protocol === 'https:'
  } catch {
    return false
  }
}

function showLoginWindow() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.show()
    loginWindow.focus()
    return
  }
  void createLoginWindow()
}

function returnToLoginFromUserWindow() {
  if (userWindow && !userWindow.isDestroyed()) userWindow.destroy()
  userWindow = null
  showLoginWindow()
}

function returnToLoginFromToolSwitcher() {
  if (toolSwitcherWindow && !toolSwitcherWindow.isDestroyed()) toolSwitcherWindow.destroy()
  toolSwitcherWindow = null
  showLoginWindow()
}

function attachUserWindowGuards(window) {
  const guardNavigation = (event, targetUrl) => {
    if (isServerUrl(targetUrl)) return
    event.preventDefault()
    if (isSafeExternalUrl(targetUrl)) void shell.openExternal(targetUrl)
  }

  window.webContents.on('will-navigate', guardNavigation)
  window.webContents.on('will-redirect', guardNavigation)
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isServerUrl(url)) setImmediate(() => window.loadURL(url))
    else if (isSafeExternalUrl(url)) setImmediate(() => void shell.openExternal(url))
    return { action: 'deny' }
  })

  const checkForSignedOutPage = (_event, currentUrl) => {
    if (!isServerUrl(currentUrl)) return
    const pathname = new URL(currentUrl).pathname
    if (pathname === '/sign-in' || pathname === '/login') returnToLoginFromUserWindow()
  }
  window.webContents.on('did-navigate', checkForSignedOutPage)
  window.webContents.on('did-navigate-in-page', checkForSignedOutPage)
}

async function openUserWindow() {
  return openHarnessWindow()
}

async function openDashboardWindow() {
  if (userWindow && !userWindow.isDestroyed()) {
    userWindow.show()
    userWindow.focus()
    return
  }

  userWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    center: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    title: desktopConfig.productName,
    webPreferences: {
      session: apiSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      spellcheck: false,
      navigateOnDragDrop: false,
    },
  })
  attachUserWindowGuards(userWindow)
  userWindow.once('ready-to-show', () => userWindow?.show())
  userWindow.on('closed', () => { userWindow = null })

  try {
    await userWindow.loadURL(new URL(desktopConfig.userPagePath, desktopConfig.serverUrl).toString())
  } catch {
    if (userWindow && !userWindow.isDestroyed()) userWindow.destroy()
    userWindow = null
    throw new NewApiClientError('用户页面加载失败，请检查服务器状态', { code: 'PAGE_LOAD_ERROR' })
  }

  if (loginWindow && !loginWindow.isDestroyed()) {
    const completedLoginWindow = loginWindow
    completedLoginWindow.hide()
    setTimeout(() => {
      if (!completedLoginWindow.isDestroyed()) completedLoginWindow.close()
    }, 100)
  }
}

async function openToolSwitcherWindow() {
  diagnosticLog('workbench-window-open-start')
  if (toolSwitcherWindow && !toolSwitcherWindow.isDestroyed()) {
    toolSwitcherWindow.show()
    toolSwitcherWindow.focus()
    return
  }

  toolSwitcherWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    center: true,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    title: `${desktopConfig.productName} - 编程工作台`,
    webPreferences: {
      preload: path.join(__dirname, 'tool-switcher-preload.js'),
      session: apiSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      spellcheck: false,
      navigateOnDragDrop: false,
    },
  })
  toolSwitcherWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  toolSwitcherWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => diagnosticLog('workbench-renderer-did-fail-load', { errorCode, errorDescription, validatedURL, isMainFrame }))
  toolSwitcherWindow.webContents.on('render-process-gone', (_event, details) => diagnosticLog('workbench-renderer-process-gone', details))
  toolSwitcherWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => diagnosticLog('workbench-renderer-console', { level, message, line, sourceId }))
  toolSwitcherWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  toolSwitcherWindow.once('ready-to-show', () => toolSwitcherWindow?.show())
  toolSwitcherWindow.on('closed', () => { toolSwitcherWindow = null })

  try {
    await toolSwitcherWindow.loadFile(path.join(__dirname, 'ui', 'workbench.html'))
  } catch (error) {
    diagnosticLog('workbench-window-load-error', { message: error?.message, stack: error?.stack })
    if (toolSwitcherWindow && !toolSwitcherWindow.isDestroyed()) toolSwitcherWindow.destroy()
    toolSwitcherWindow = null
    throw new NewApiClientError('编程工作台页面加载失败', { code: 'PAGE_LOAD_ERROR' })
  }

  if (loginWindow && !loginWindow.isDestroyed()) {
    const completedLoginWindow = loginWindow
    completedLoginWindow.hide()
    setTimeout(() => {
      if (!completedLoginWindow.isDestroyed()) completedLoginWindow.close()
    }, 100)
  }
}

async function createLoginWindow() {
  diagnosticLog('login-window-open-start')
  loginWindow = new BrowserWindow({
    width: LOGIN_WINDOW_WIDTH,
    height: LOGIN_WINDOW_HEIGHT,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    center: true,
    frame: false,
    show: false,
    backgroundColor: '#ffffff',
    title: desktopConfig.productName,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      session: apiSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      spellcheck: false,
      navigateOnDragDrop: false,
      disableHtmlFullscreenWindowResize: true,
    },
  })
  loginWindow.setContentSize(LOGIN_WINDOW_WIDTH, LOGIN_WINDOW_HEIGHT)
  loginWindow.webContents.on('did-start-loading', () => diagnosticLog('login-renderer-did-start-loading'))
  loginWindow.webContents.on('did-finish-load', () => diagnosticLog('login-renderer-did-finish-load', { url: loginWindow?.webContents.getURL() }))
  loginWindow.webContents.on('preload-error', (_event, preloadPath, error) => diagnosticLog('login-preload-error', { preloadPath, message: error?.message, stack: error?.stack }))

  await loginWindow.loadFile(path.join(__dirname, 'ui', 'login.html'), {
    query: {
      productName: desktopConfig.productName,
      logoPath: logoPathForLoginPage(desktopConfig),
    },
  })
  loginWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => diagnosticLog('login-renderer-did-fail-load', { errorCode, errorDescription, validatedURL, isMainFrame }))
  loginWindow.webContents.on('render-process-gone', (_event, details) => diagnosticLog('login-renderer-process-gone', details))
  loginWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => diagnosticLog('login-renderer-console', { level, message, line, sourceId }))
  diagnosticLog('login-window-loaded', { url: loginWindow.webContents.getURL() })
  loginWindow.show()
  loginWindow.on('closed', () => { loginWindow = null })
}

function registerIpcHandlers() {
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    }
  })

  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('desktop-tools:get-state', async (event) => {
    requireToolSwitcherPage(event)
    try {
      const cached = desktopToolsCache?.readFresh()
      // Cached configuration is sufficient to paint the window immediately.
      // Account metadata is refreshed separately and must not block first paint.
      if (cached) {
        toolSyncManager.setAccountScope(`${desktopConfig.serverUrl}:${currentAccount?.id || currentAccount?.username || 'cached'}`, currentAccount?.username)
        toolSyncManager.setServerConfigs(cached.tools)
        void Promise.all([apiClient.getSelf(), apiClient.getDesktopTools()]).then(([self, fresh]) => {
          currentAccount = self || currentAccount
          if (fresh?.tools) {
            desktopToolsCache?.write(fresh)
            toolSyncManager.setAccountScope(`${desktopConfig.serverUrl}:${self?.id || currentAccount?.username}`, currentAccount?.username)
            toolSyncManager.setServerConfigs(fresh.tools)
          }
        }).catch(() => {})
        return { success: true, tools: toolSyncManager.getState(), account: currentAccount, serverUrl: desktopConfig.serverUrl, productName: desktopConfig.productName, cached: true }
      }
      const [result, self] = await Promise.all([apiClient.getDesktopTools(), apiClient.getSelf()])
      if (!cached) desktopToolsCache?.write(result)
      currentAccount = self || currentAccount
      toolSyncManager.setAccountScope(`${desktopConfig.serverUrl}:${self?.id || currentAccount?.username}`, currentAccount?.username)
      toolSyncManager.setServerConfigs(result.tools)
      return {
        success: true,
        tools: toolSyncManager.getState(),
        account: self || currentAccount,
        serverUrl: desktopConfig.serverUrl,
        productName: desktopConfig.productName,
      }
    } catch (error) {
      return publicError(error, '无法读取工具配置')
    }
  })

  ipcMain.handle('desktop-tools:refresh', async (event) => {
    requireToolSwitcherPage(event)
    try {
      const [result, self] = await Promise.all([apiClient.getDesktopTools(), apiClient.getSelf()])
      desktopToolsCache?.write(result)
      currentAccount = self || currentAccount
      toolSyncManager.setAccountScope(`${desktopConfig.serverUrl}:${self?.id || currentAccount?.username}`, currentAccount?.username)
      toolSyncManager.setServerConfigs(result.tools)
      return {
        success: true,
        tools: toolSyncManager.getState(),
        account: self || currentAccount,
        serverUrl: desktopConfig.serverUrl,
        productName: desktopConfig.productName,
      }
    } catch (error) {
      return publicError(error, '刷新工具配置失败')
    }
  })

  ipcMain.handle('desktop-tools:ping', async (event) => {
    requireToolSwitcherPage(event)
    const startTime = Date.now()
    try {
      await apiClient.getStatus()
      return { success: true, latencyMs: Date.now() - startTime }
    } catch (error) {
      return { success: false, message: '无法连接服务网关' }
    }
  })

  ipcMain.handle('desktop-tools:enable', async (event, toolId) => {
    requireToolSwitcherPage(event)
    try {
      const result = await apiClient.getDesktopTools()
      const config = result.tools.find((item) => item?.id === toolId)
      if (!config) return { success: false, message: '该工具尚未分配配置', code: 'TOOL_UNCONFIGURED' }
      const [hydrated] = await enrichModelsByUpstream([config])
      const models = Array.isArray(hydrated.available_models) ? hydrated.available_models : []
      if (!models.length) throw new NewApiClientError('当前账号暂无可用模型')
      return toolSyncManager.enable(toolId, hydrated)
    } catch (error) {
      return publicError(error, '启用工具失败，未修改本地配置')
    }
  })

  ipcMain.handle('desktop-tools:disable', (event, toolId) => {
    requireToolSwitcherPage(event)
    try {
      return toolSyncManager.disable(toolId)
    } catch (error) {
      return publicError(error, '禁用工具失败')
    }
  })

  ipcMain.handle('desktop-tools:launch', async (event, toolId) => {
    requireToolSwitcherPage(event)
    try {
      const adapter = toolSyncManager.requireAdapter(toolId)
      const launch = adapter.launch()
      return {
        success: true,
        launched: launch?.launched === true,
        message: launch?.message || '',
      }
    } catch (error) {
      return publicError(error, '启动工具失败')
    }
  })

  ipcMain.handle('desktop-tools:get-models', async (event, toolId) => {
    requireToolSwitcherPage(event)
    try {
      toolSyncManager.requireAdapter(toolId)
      const result = await apiClient.getDesktopTools()
      toolSyncManager.setServerConfigs(await enrichModelsByUpstream(result.tools))
      const config = toolSyncManager.serverConfigs.get(toolId)
      if (!config) throw new NewApiClientError('该工具尚未配置 API 令牌')
      const models = config.availableModels || []
      if (!models.length) throw new NewApiClientError('当前账号暂无可用模型')
      const model = models.includes(config.model) ? config.model : models[0]
      const applied = toolSyncManager.applyModels(toolId, { model }, models)
      return { ...applied, models, model }
    } catch (error) {
      return publicError(error, '获取模型失败')
    }
  })

  ipcMain.handle('desktop-tools:apply-models', async (event, toolId, selection) => {
    requireToolSwitcherPage(event)
    try {
      toolSyncManager.requireAdapter(toolId)
      const result = await apiClient.getDesktopTools()
      toolSyncManager.setServerConfigs(await enrichModelsByUpstream(result.tools))
      const config = toolSyncManager.serverConfigs.get(toolId)
      if (!config) throw new NewApiClientError('该工具尚未配置 API 令牌')
      const models = config.availableModels || []
      return toolSyncManager.applyModels(toolId, selection, models)
    } catch (error) {
      return publicError(error, '模型应用失败')
    }
  })

  ipcMain.handle('desktop-tools:open-dashboard', async (event) => {
    requireToolSwitcherPage(event)
    try {
      await openDashboardWindow()
      return { success: true }
    } catch (error) { return publicError(error, '管理后台打开失败') }
  })

  ipcMain.handle('harness:get-state', async (event) => {
    requireToolSwitcherPage(event)
    return harnessManager.getState()
  })

  ipcMain.handle('harness:start', async (event) => {
    requireToolSwitcherPage(event)
    return harnessManager.start()
  })

  ipcMain.handle('harness:stop', async (event) => {
    requireToolSwitcherPage(event)
    return harnessManager.stop()
  })

  ipcMain.handle('harness:open', async (event) => {
    requireToolSwitcherPage(event)
    return openHarnessWindow()
  })

  ipcMain.handle('desktop-workspace:open-config', async (event) => {
    requireToolSwitcherPage(event)
    const error = await shell.openPath(app.getPath('userData'))
    return { success: !error, message: error || '已打开配置目录' }
  })

  ipcMain.handle('desktop-workspace:select-file', async (event) => {
    requireToolSwitcherPage(event)
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { properties: ['openFile'] })
    return { success: !result.canceled, canceled: result.canceled, path: result.filePaths[0] || '' }
  })

  ipcMain.handle('desktop-workspace:submit-task', async (event, input) => {
    requireToolSwitcherPage(event)
    try {
      const directory = input?.directory
      if (typeof directory !== 'string' || !path.isAbsolute(directory) || !require('node:fs').statSync(directory).isDirectory()) throw new Error('工程目录不存在')
      const tools = await apiClient.getDesktopTools()
      const configs = await enrichModelsByUpstream(tools.tools)
      const config = configs.find(tool => ['codex-gpt', 'claude-code'].includes(tool.id) && tool.available_models?.includes(input.model))
      if (!config) throw new Error('当前模型未授权，请刷新模型目录')
      const started = await harnessManager.start()
      if (!started.success) return started
      const result = await new HarnessTask({ url: harnessManager.url }).submit({ ...input, config })
      const opened = await openHarnessWindow(result.sessionId)
      return { ...result, message: opened.success ? result.message : `${result.message}，但执行窗口打开失败` }
    } catch (error) {
      return { success: false, message: error.message || '提交任务失败' }
    }
  })

  ipcMain.handle('desktop-workspace:select-directory', async (event) => {
    requireToolSwitcherPage(event)
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win, {
      title: '选择本地项目工作区',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths.length) {
      return { success: false, canceled: true }
    }
    const folderPath = result.filePaths[0]
    const name = path.basename(folderPath) || folderPath
    return { success: true, canceled: false, path: folderPath, name }
  })

  ipcMain.handle('desktop-workspace:get-models', async (event) => {
    requireToolSwitcherPage(event)
    try {
      const result = await apiClient.getDesktopTools()
      const self = await apiClient.getSelf()
      currentAccount = self || currentAccount
      const modelsSet = new Set()
      for (const tool of (result.tools || [])) {
        if (Array.isArray(tool.available_models)) {
          tool.available_models.forEach((m) => modelsSet.add(m))
        }
        if (tool.model) modelsSet.add(tool.model)
      }
      if (!modelsSet.size && result.tools?.[0]?.api_key) {
        try {
          const upstream = await apiClient.getAvailableModels(result.tools[0].api_key)
          upstream.forEach((m) => modelsSet.add(m))
        } catch {
          // 优雅回退
        }
      }
      const list = [...modelsSet]
      return {
        success: true,
        models: list,
        account: self || currentAccount,
        serverUrl: desktopConfig.serverUrl,
        productName: desktopConfig.productName,
      }
    } catch (error) {
      return {
        success: false,
        message: error?.message || '获取工作台模型失败',
        models: [],
        account: currentAccount,
        serverUrl: desktopConfig.serverUrl,
        productName: desktopConfig.productName,
      }
    }
  })

  ipcMain.handle('desktop-tools:logout', async (event) => {
    requireToolSwitcherPage(event)
    try {
      await apiSession.clearStorageData({ origin: desktopConfig.serverUrl })
      toolSyncManager.setServerConfigs([])
      currentAccount = null
      apiClient.accessToken = null
      toolSyncManager.setAccountScope('')
      await harnessManager?.stop()
      if (userWindow && !userWindow.isDestroyed()) userWindow.destroy()
      userWindow = null
      if (harnessWindow && !harnessWindow.isDestroyed()) harnessWindow.destroy()
      harnessWindow = null
      returnToLoginFromToolSwitcher()
      return { success: true }
    } catch (error) { return publicError(error, '退出登录失败') }
  })

  ipcMain.handle('auth:status', async (event) => {
    requireLoginPage(event)
    try {
      return await apiClient.getStatus()
    } catch (error) {
      return publicError(error, '无法读取服务器状态')
    }
  })

  ipcMain.handle('auth:get-saved-credentials', (event) => {
    requireLoginPage(event)
    const credentials = credentialStore.load()
    return { success: true, credentials }
  })

  ipcMain.handle('auth:clear-saved-credentials', (event) => {
    requireLoginPage(event)
    credentialStore.clear()
    return { success: true }
  })

  ipcMain.handle('auth:get-registration-application-state', (event) => {
    requireLoginPage(event)
    const registration = pendingRegistration || registrationStore.load()
    if (registration) pendingRegistration = registration
    return { success: true, hasApplication: Boolean(registration), username: registration?.username || '' }
  })

  ipcMain.handle('auth:clear-registration-application', (event) => {
    requireLoginPage(event)
    pendingRegistration = null
    registrationStore.clear()
    return { success: true }
  })

  ipcMain.handle('auth:login', async (event, credentials) => {
    requireLoginPage(event)
    pendingTwoFactor = null
    try {
      await showStartupProgress('login', 15)
      const result = await apiClient.login(credentials || {})
      if (result.requiresTwoFactor) {
        closeStartupProgress()
        pendingTwoFactor = {
          flowToken: result.flowToken,
          expiresAt: result.expiresAt,
          credentials: {
            username: credentials?.username,
            password: credentials?.password,
            rememberCredentials: credentials?.rememberCredentials === true,
          },
        }
        return { success: true, requiresTwoFactor: true, message: result.message }
      }
      await requireMemberAccount(result)
      updateSavedCredentials(credentials)
      if (registrationStore.load()?.username === String(credentials?.username || '').trim()) registrationStore.clear()
      pendingRegistration = null
      currentAccount = { username: credentials?.username || '' }
      const harnessResult = await openHarnessWindow()
      if (!harnessResult.success) {
        return {
          success: false,
          message: harnessResult.message || '编程工作台启动失败',
          code: harnessResult.code || 'HARNESS_START_FAILED',
        }
      }
      return { success: true, authenticated: true, message: result.message }
    } catch (error) {
      closeStartupProgress()
      return publicError(error, '登录失败')
    }
  })

  ipcMain.handle('auth:verify-2fa', async (event, code) => {
    requireLoginPage(event)
    if (!pendingTwoFactor) return { success: false, message: '两步验证流程已失效，请重新登录' }
    if (pendingTwoFactor.expiresAt && Date.now() / 1000 >= pendingTwoFactor.expiresAt) {
      pendingTwoFactor = null
      return { success: false, message: '两步验证码已过期，请重新登录' }
    }
    try {
      const result = await apiClient.verifyTwoFactor({ code, flowToken: pendingTwoFactor.flowToken })
      const credentials = pendingTwoFactor.credentials
      pendingTwoFactor = null
      await requireMemberAccount(result)
      updateSavedCredentials(credentials)
      if (registrationStore.load()?.username === String(credentials?.username || '').trim()) registrationStore.clear()
      pendingRegistration = null
      currentAccount = { username: credentials?.username || '' }
      const harnessResult = await openHarnessWindow()
      if (!harnessResult.success) {
        return {
          success: false,
          message: harnessResult.message || '编程工作台启动失败',
          code: harnessResult.code || 'HARNESS_START_FAILED',
        }
      }
      return { success: true, authenticated: true, message: result.message }
    } catch (error) {
      return publicError(error, '两步验证失败')
    }
  })

  ipcMain.handle('auth:submit-registration-application', async (event, application) => {
    requireLoginPage(event)
    if (!registrationStore.encryptionAvailable()) {
      return { success: false, message: 'Windows 安全存储当前不可用，无法安全保存注册申请' }
    }
    try {
      const registration = application || {}
      const result = await apiClient.submitRegistrationApplication(registration)
      pendingRegistration = {
        username: String(registration.username || '').trim(),
        password: String(registration.password || ''),
        applicationId: result.applicationId == null ? '' : String(result.applicationId),
      }
      try {
        registrationStore.save(pendingRegistration)
        return result
      } catch {
        return { ...result, persistenceWarning: '申请已提交，但无法保存到 Windows 安全存储；关闭客户端后将无法自动恢复进度。' }
      }
    } catch (error) {
      return publicError(error, '提交申请失败')
    }
  })

  ipcMain.handle('auth:registration-application-status', async (event) => {
    requireLoginPage(event)
    if (!pendingRegistration) pendingRegistration = registrationStore.load()
    if (!pendingRegistration) return { success: false, message: '没有可查询的注册申请' }
    try {
      const result = await apiClient.getRegistrationApplicationStatus(pendingRegistration)
      return { ...result, username: pendingRegistration.username }
    } catch (error) {
      return publicError(error, '查询注册申请状态失败')
    }
  })

  ipcMain.handle('auth:submit-password-reset-application', async (event, application) => {
    requireLoginPage(event)
    if (!passwordResetStore.encryptionAvailable()) {
      return { success: false, message: 'Windows 安全存储当前不可用，无法安全保存找回密码申请' }
    }
    try {
      const result = await apiClient.submitPasswordResetApplication(application || {})
      passwordResetStore.save({
        applicationId: result.applicationId,
        secret: result.applicationSecret,
        username: result.username,
      })
      return {
        success: true,
        message: result.message,
        applicationId: result.applicationId,
        status: 'pending',
      }
    } catch (error) {
      return publicError(error, '提交找回密码申请失败')
    }
  })

  ipcMain.handle('auth:get-password-reset-state', (event) => {
    requireLoginPage(event)
    const tracking = passwordResetStore.load()
    return {
      success: true,
      hasApplication: tracking !== null,
      username: tracking?.username || '',
    }
  })

  ipcMain.handle('auth:password-reset-status', async (event) => {
    requireLoginPage(event)
    const tracking = passwordResetStore.load()
    if (!tracking) return { success: false, message: '本机没有待处理的找回密码申请' }
    try {
      const result = await apiClient.getPasswordResetStatus({
        applicationId: tracking.applicationId,
        applicationSecret: tracking.secret,
      })
      if (result.status === 'rejected') passwordResetStore.clear()
      return { ...result, username: tracking.username || '' }
    } catch (error) {
      return publicError(error, '查询审核状态失败')
    }
  })

  ipcMain.handle('auth:complete-password-reset', async (event, newPassword) => {
    requireLoginPage(event)
    const tracking = passwordResetStore.load()
    if (!tracking) return { success: false, message: '找回密码申请已失效，请重新提交' }
    try {
      const result = await apiClient.completePasswordReset({
        applicationId: tracking.applicationId,
        applicationSecret: tracking.secret,
        newPassword,
      })
      passwordResetStore.clear()
      credentialStore.clear()
      return result
    } catch (error) {
      return publicError(error, '重置密码失败')
    }
  })
}

app.whenReady().then(async () => {
  const startupStartedAt = Date.now()
  const startupMark = (stage) => diagnosticLog('startup-stage', { stage, elapsedMs: Date.now() - startupStartedAt })
  diagnosticLog('app-ready')
  app.on('child-process-gone', (_event, details) => diagnosticLog('child-process-gone', details))
  app.on('gpu-info-update', () => diagnosticLog('gpu-info-update'))
  app.on('gpu-process-crashed', (_event, killed) => diagnosticLog('gpu-process-crashed', { killed }))
  apiSession = session.fromPartition(USER_SESSION_PARTITION, { cache: true })
  startupMark('session-created')
  apiSession.setPermissionCheckHandler(() => false)
  apiSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  apiSession.on('will-download', (event) => event.preventDefault())
  apiClient = new NewApiClient({ config: desktopConfig, session: apiSession })
  startupMark('api-client-created')
  const homeDir = app.getPath('home')
  toolSyncManager = new ToolSyncManager({
    preferencesPath: path.join(app.getPath('userData'), 'model-preferences.json'),
    allowInsecureHttp: desktopConfig.allowInsecureHttp,
    adapters: new Map([
      ['claude-code', new ClaudeAdapter({ homeDir, launcher: launchTool })],
      ['codex-gpt', new CodexAdapter({ homeDir, codexHome: process.env.CODEX_HOME, launcher: launchTool })],
    ]),
  })
  startupMark('tool-sync-created')
  desktopToolsCache = createDesktopToolsCache(path.join(app.getPath('userData'), 'desktop-tools-cache.json'))
  harnessManager = new HarnessManager({ userDataPath: app.getPath('userData') })
  startupMark('harness-manager-created')
  // 预热本地工作台；登录页仍可立即使用，点击登录时直接复用已启动实例。
  void harnessManager.start().then(result => diagnosticLog('harness-prewarm', result)).catch(error => diagnosticLog('harness-prewarm-failed', { message: error?.message }))
  passwordResetStore = new PasswordResetStore({
    filePath: path.join(app.getPath('userData'), 'password-reset-request.bin'),
    safeStorage,
  })
  credentialStore = new CredentialStore({
    filePath: path.join(app.getPath('userData'), 'login-credentials.bin'),
    safeStorage,
  })
  registrationStore = new RegistrationStore({
    filePath: path.join(app.getPath('userData'), 'registration-request.bin'),
    safeStorage,
  })
  registerIpcHandlers()
  startupMark('ipc-registered')
  await createLoginWindow()
  startupMark('login-window-created')
  diagnosticLog('startup-complete')
}).catch((error) => {
  diagnosticLog('startup-error', { message: error?.message, stack: error?.stack })
  console.error(error.message)
  app.quit()
})

app.on('activate', () => {
  if (harnessWindow && !harnessWindow.isDestroyed()) harnessWindow.show()
  else if (userWindow && !userWindow.isDestroyed()) userWindow.show()
  else if (!loginWindow || loginWindow.isDestroyed()) showLoginWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void harnessManager?.stop()
})
