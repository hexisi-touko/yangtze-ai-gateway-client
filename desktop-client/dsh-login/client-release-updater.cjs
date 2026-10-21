const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { Readable } = require('node:stream')

const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000

function validateRelease(release) {
  if (!release || typeof release !== 'object') throw new Error('更新信息无效')
  if (!/^[a-f0-9]{64}$/i.test(release.sha256 || '')) throw new Error('更新包缺少有效的 SHA-256 校验值')
  if (typeof release.fileName !== 'string' || release.fileName !== path.basename(release.fileName) || !/\.exe$/i.test(release.fileName) || /portable/i.test(release.fileName)) {
    throw new Error('更新包必须是 Windows 安装版 EXE')
  }
  const url = new URL(release.downloadUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('更新包下载地址无效')
  return url
}

async function downloadClientRelease({ release, destinationDirectory, signal, onProgress }) {
  const url = validateRelease(release)
  await fsp.mkdir(destinationDirectory, { recursive: true })
  const destination = path.join(destinationDirectory, release.fileName)
  const partial = path.join(destinationDirectory, `.${release.fileName}.${crypto.randomUUID()}.download`)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('更新包下载超时')), DOWNLOAD_TIMEOUT_MS)
  const abort = () => controller.abort(signal.reason)
  signal?.addEventListener('abort', abort, { once: true })
  let bytes = 0
  const digest = crypto.createHash('sha256')
  try {
    const response = await fetch(url, { redirect: 'error', signal: controller.signal })
    if (!response.ok || !response.body) throw new Error(`更新包下载失败（${response.status}）`)
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_INSTALLER_BYTES) throw new Error('更新包超过 1 GB，已取消下载')
    const meter = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length
        if (bytes > MAX_INSTALLER_BYTES) return callback(new Error('更新包超过 1 GB，已取消下载'))
        digest.update(chunk)
        onProgress?.({ bytes, totalBytes: Number.isFinite(declaredLength) ? declaredLength : 0 })
        callback(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(partial, { flags: 'wx' }))
    if (digest.digest('hex').toLowerCase() !== release.sha256.toLowerCase()) throw new Error('更新包 SHA-256 校验失败，已删除下载文件')
    await fsp.rm(destination, { force: true })
    await fsp.rename(partial, destination)
    return { filePath: destination, bytes }
  } catch (error) {
    await fsp.rm(partial, { force: true }).catch(() => {})
    if (error?.name === 'AbortError') throw new Error('更新包下载已取消或超时')
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function makeWindowsInstallScript({ installerPath, executablePath, ownerPid, scriptPath }) {
  if (!Number.isSafeInteger(ownerPid) || ownerPid < 1) throw new Error('客户端进程标识无效')
  return [
    "$ErrorActionPreference = 'Stop'",
    `$ownerPid = ${ownerPid}`,
    'while (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }',
    `$installer = ${quotePowerShell(installerPath)}`,
    `$application = ${quotePowerShell(executablePath)}`,
    `$script = ${quotePowerShell(scriptPath)}`,
    "Start-Process -FilePath $installer -ArgumentList '/S' -Wait",
    'if (Test-Path -LiteralPath $application) { Start-Process -FilePath $application }',
    'Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue',
    'Remove-Item -LiteralPath $script -Force -ErrorAction SilentlyContinue',
  ].join(os.EOL)
}

async function launchWindowsInstaller({ installerPath, executablePath, ownerPid = process.pid, spawnProcess = spawn }) {
  if (process.platform !== 'win32') throw new Error('客户端自动安装目前仅支持 Windows 安装版')
  if (process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE) throw new Error('便携版客户端不支持自动安装更新，请使用完整安装版')
  const scriptPath = path.join(path.dirname(installerPath), `install-update-${crypto.randomUUID()}.ps1`)
  await fsp.writeFile(scriptPath, makeWindowsInstallScript({ installerPath, executablePath, ownerPid, scriptPath }), { encoding: 'utf8', mode: 0o600 })
  return new Promise((resolve, reject) => {
    const child = spawnProcess('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
    ], { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', async (error) => {
      await fsp.rm(scriptPath, { force: true }).catch(() => {})
      reject(error)
    })
    child.once('spawn', () => {
      child.unref()
      resolve({ scriptPath })
    })
  })
}

module.exports = { downloadClientRelease, launchWindowsInstaller, makeWindowsInstallScript, validateRelease }
