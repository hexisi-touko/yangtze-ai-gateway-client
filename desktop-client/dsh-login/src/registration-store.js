const fs = require('node:fs')
const path = require('node:path')

class RegistrationStore {
  constructor({ filePath, safeStorage, fsModule = fs }) {
    this.filePath = filePath
    this.safeStorage = safeStorage
    this.fs = fsModule
  }

  encryptionAvailable() { return this.safeStorage?.isEncryptionAvailable() === true }

  save(registration) {
    if (!this.encryptionAvailable()) throw new Error('系统安全存储当前不可用')
    const username = typeof registration?.username === 'string' ? registration.username.trim() : ''
    const password = typeof registration?.password === 'string' ? registration.password : ''
    const applicationId = registration?.applicationId == null ? '' : String(registration.applicationId)
    if (!username || !password || username.length > 64 || password.length > 256 || applicationId.length > 128) {
      throw new Error('注册申请记录无效')
    }
    const encrypted = this.safeStorage.encryptString(JSON.stringify({ username, password, applicationId }))
    this.fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    this.fs.writeFileSync(this.filePath, encrypted)
  }

  load() {
    if (!this.encryptionAvailable() || !this.fs.existsSync(this.filePath)) return null
    try {
      const registration = JSON.parse(this.safeStorage.decryptString(this.fs.readFileSync(this.filePath)))
      if (!registration || typeof registration.username !== 'string' || typeof registration.password !== 'string' ||
          typeof registration.applicationId !== 'string' || !registration.username.trim() || !registration.password ||
          registration.username.length > 64 || registration.password.length > 256 || registration.applicationId.length > 128) return null
      return { ...registration, username: registration.username.trim() }
    } catch { return null }
  }

  clear() {
    if (this.fs.existsSync(this.filePath)) this.fs.rmSync(this.filePath, { force: true })
  }
}

module.exports = { RegistrationStore }
