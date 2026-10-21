const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawn } = require('node:child_process')

// 已安装的正式版 "DeepSeek Harness" 使用默认的 ~/.dsh。开发构建一旦落到同
// 一个目录，就会把插件软链接铺进正式版的 profiles 里并让它启动崩溃。
const SHARED_DSH_HOME = path.join(os.homedir(), '.dsh')

function resolveDshHome(userDataPath, root) {
  const home = path.resolve(userDataPath || path.join(root, 'dsh-home'))
  if (home.toLowerCase() === SHARED_DSH_HOME.toLowerCase()) {
    throw new Error(`DSH_HOME 指向正式版共用的 ${SHARED_DSH_HOME}，会破坏已安装的 DeepSeek Harness；请改用独立目录`)
  }
  return home
}

class HarnessManager {
  constructor({ userDataPath, port = 3081 } = {}) { this.port = port; this.url = `http://127.0.0.1:${port}/`; this.userDataPath = userDataPath; this.child = null; this.startPromise = null }
  getState() { return { running: !!this.child, url: this.url, port: this.port } }
  async start() {
    if (this.child) return { success: true, ...this.getState() }
    if (this.startPromise) return this.startPromise
    this.startPromise = this._start().finally(() => { this.startPromise = null })
    return this.startPromise
  }
  async _start() {
    const root = process.resourcesPath || path.join(__dirname, '..')
    const bundledNode = path.join(root, 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'node')
    const bin = path.join(root, 'runtime', 'dsh', 'lib', 'bin.js')
    if (!fs.existsSync(bin)) return { success: false, message: '本地工作台运行时缺失' }
    // Released builds may carry a private Node binary. During development, and
    // in builds that rely on Electron's embedded Node, use the current runtime.
    const node = fs.existsSync(bundledNode) ? bundledNode : process.execPath
    let home
    try {
      home = resolveDshHome(this.userDataPath, root)
      fs.mkdirSync(home, { recursive: true })
    } catch (error) {
      return { success: false, message: error.message }
    }
    const env = { ...process.env, DSH_HOME: home }
    if (node === process.execPath && process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1'
    // The page is loaded by the Electron window in main.js. Keep the CLI from
    // opening the system browser when this legacy path is used.
    this.child = spawn(node, [bin, 'web', '--no-open', '--host', '127.0.0.1', '--port', String(this.port)], { windowsHide: true, env, stdio: 'ignore' })
    this.child.once('exit', () => { this.child = null })
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) { try { const res = await fetch(this.url); if (res.ok || res.status < 500) return { success: true, ...this.getState() } } catch {} await new Promise(r => setTimeout(r, 150)) }
    await this.stop(); return { success: false, message: '本地工作台启动超时' }
  }
  async stop() { if (!this.child) return { success: true }; this.child.kill(); this.child = null; return { success: true } }
}
module.exports = { HarnessManager }
