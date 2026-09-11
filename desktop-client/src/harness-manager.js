const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')

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
    const node = path.join(root, 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'node')
    const bin = path.join(root, 'runtime', 'dsh', 'lib', 'bin.js')
    if (!fs.existsSync(node) || !fs.existsSync(bin)) return { success: false, message: '本地工作台运行时缺失' }
    this.child = spawn(node, [bin, 'web', '--host', '127.0.0.1', '--port', String(this.port)], { windowsHide: true, env: { ...process.env, DSH_HOME: this.userDataPath || path.join(root, 'dsh-home') }, stdio: 'ignore' })
    this.child.once('exit', () => { this.child = null })
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) { try { const res = await fetch(this.url); if (res.ok || res.status < 500) return { success: true, ...this.getState() } } catch {} await new Promise(r => setTimeout(r, 150)) }
    await this.stop(); return { success: false, message: '本地工作台启动超时' }
  }
  async stop() { if (!this.child) return { success: true }; this.child.kill(); this.child = null; return { success: true } }
}
module.exports = { HarnessManager }
