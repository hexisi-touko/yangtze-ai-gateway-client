const { app, BrowserWindow, ipcMain, safeStorage, session, shell } = require('electron')
const path = require('node:path')
const { loadDesktopConfig, logoPathForLoginPage } = require('./src/config')
const { NewApiClient, NewApiClientError } = require('./src/new-api-client')
const { PasswordResetStore } = require('./src/password-reset-store')
const { CredentialStore } = require('./src/credential-store')
const { RegistrationStore } = require('./src/registration-store')

const { pathToFileURL } = require('node:url');
const desktopConfig = loadDesktopConfig('desktop.config.json');
const LOGIN_WINDOW_WIDTH = 420, LOGIN_WINDOW_HEIGHT = 620;
let loginWindow, apiSession, apiClient, passwordResetStore, credentialStore, registrationStore;
let pendingTwoFactor = null, pendingRegistration = null, currentAccount = null;
let enterHarness;
function reportProgress(percent, label) {
 if (loginWindow && !loginWindow.isDestroyed()) loginWindow.webContents.send('auth:login-progress', {percent, label});
}
function requireLoginPage(event) {
 const expected = pathToFileURL(path.join(__dirname, 'ui/login.html')).href;
 if (!loginWindow || loginWindow.isDestroyed() || event.sender !== loginWindow.webContents || event.senderFrame !== loginWindow.webContents.mainFrame || event.senderFrame.url.split('?')[0] !== expected) throw new Error('Unauthorized window request');
}
function publicError(error, fallback) {
 const rawMessage = error instanceof NewApiClientError ? error.message : error?.message;
 const message = typeof rawMessage === 'string' && rawMessage.trim()
  ? rawMessage.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 300)
  : fallback;
 const code = typeof error?.code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(error.code)
  ? error.code
  : 'CLIENT_ERROR';
 return {success:false,message,code};
}
async function openUserWindow() {
 const self = await apiClient.getSelf();
 if (!self || !Number.isSafeInteger(self.id) || self.id <= 0 || self.role !== 1) throw new NewApiClientError('无法验证当前成员账号');
 await enterHarness({id:self.id,serverUrl:desktopConfig.serverUrl,apiClient});
 reportProgress(100, '登录完成');
 if (loginWindow && !loginWindow.isDestroyed()) loginWindow.destroy();
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
  apiClient.accessToken = null; await apiSession.clearStorageData({
    origin: desktopConfig.serverUrl,
    storages: ['cookies', 'localstorage'],
  })
  throw new NewApiClientError('管理员账号请使用 Web 管理后台登录', {
    code: 'DESKTOP_MEMBER_ONLY',
  })
}

async function createLoginWindow() {
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
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      navigateOnDragDrop: false,
      disableHtmlFullscreenWindowResize: true,
    },
  })
  loginWindow.setContentSize(LOGIN_WINDOW_WIDTH, LOGIN_WINDOW_HEIGHT)

  await loginWindow.loadFile(path.join(__dirname, 'ui', 'login.html'), {
    query: {
      productName: desktopConfig.productName,
      logoPath: logoPathForLoginPage(desktopConfig),
    },
  })
  loginWindow.show()
  loginWindow.on('closed', () => { loginWindow = null })
}


module.exports.createLoginGate = async function(onAuthenticated) {
 enterHarness = onAuthenticated;
 apiSession = session.fromPartition('new-api-dsh-auth');
 apiSession.setPermissionCheckHandler(() => false);
 apiSession.setPermissionRequestHandler((_w,_p,cb) => cb(false));
 apiClient = new NewApiClient({config:desktopConfig,session:apiSession});
 const storePath = name => path.join(app.getPath('userData'),'new-api-auth',name);
 credentialStore = new CredentialStore({filePath:storePath('credentials.bin'),safeStorage});
 registrationStore = new RegistrationStore({filePath:storePath('registration.bin'),safeStorage});
 passwordResetStore = new PasswordResetStore({filePath:storePath('password-reset.bin'),safeStorage});
 ipcMain.on('window:minimize', event => {requireLoginPage(event);loginWindow.minimize()});
 ipcMain.on('window:close', event => {requireLoginPage(event);app.quit()});
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
      reportProgress(15, '正在连接服务…')
      const result = await apiClient.login(credentials || {})
      reportProgress(55, result.requiresTwoFactor ? '等待两步验证…' : '账号验证成功，正在初始化会话…')
      if (result.requiresTwoFactor) {
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
      reportProgress(75, '正在加载用户配置…')
      updateSavedCredentials(credentials)
      if (registrationStore.load()?.username === String(credentials?.username || '').trim()) registrationStore.clear()
      pendingRegistration = null
      currentAccount = { username: credentials?.username || '' }
      await openUserWindow()
      reportProgress(100, '登录完成')
      return { success: true, authenticated: true, message: result.message }
    } catch (error) {
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
      reportProgress(75, '正在加载用户配置…')
      updateSavedCredentials(credentials)
      if (registrationStore.load()?.username === String(credentials?.username || '').trim()) registrationStore.clear()
      pendingRegistration = null
      currentAccount = { username: credentials?.username || '' }
      await openUserWindow()
      reportProgress(100, '登录完成')
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

 await createLoginWindow();
 return {
 focus() {if(loginWindow && !loginWindow.isDestroyed()){loginWindow.show();loginWindow.focus();}},
 async logout() {pendingTwoFactor=null;currentAccount=null;apiClient.accessToken=null;await apiSession.clearStorageData();await createLoginWindow();}
 };
};
