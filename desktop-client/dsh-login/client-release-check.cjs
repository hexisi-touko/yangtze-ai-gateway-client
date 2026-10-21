const fs = require('node:fs')

const DEFAULT_LATEST_PATH = '/api/client-releases/latest'
const DEFAULT_HISTORY_PATH = '/api/client-releases/history'
const MAX_RESPONSE_LENGTH = 256 * 1024
const REQUEST_TIMEOUT_MS = 10_000

function readClientReleaseConfig(configPath) {
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (!raw || typeof raw !== 'object') throw new Error('客户端更新配置无效')
  if (typeof raw.serverUrl !== 'string' || raw.serverUrl.trim() === '') throw new Error('客户端更新服务器地址缺失')
  const apiPath = raw.apiPaths?.clientReleaseLatest || DEFAULT_LATEST_PATH
  if (typeof apiPath !== 'string' || !apiPath.startsWith('/') || apiPath.startsWith('//')) {
    throw new Error('客户端更新接口路径无效')
  }
  const serverUrl = new URL(raw.serverUrl)
  if (serverUrl.username || serverUrl.password || serverUrl.search || serverUrl.hash) {
    throw new Error('客户端更新服务器地址包含不允许的内容')
  }
  return { serverUrl: serverUrl.origin, apiPath }
}

function normalizeRelease(release) {
  if (!release || typeof release !== 'object') return null
  if (typeof release.version !== 'string' || release.version.trim() === '') return null
  return {
    version: release.version.trim(),
    releaseNotes: typeof release.release_notes === 'string' ? release.release_notes.trim() : '',
    mandatory: release.mandatory === true,
    downloadUrl: typeof release.download_url === 'string' ? release.download_url : '',
    fileName: typeof release.file_name === 'string' ? release.file_name : '',
    sha256: typeof release.sha256 === 'string' ? release.sha256 : '',
    publishedAt: Number.isSafeInteger(release.published_at) ? release.published_at : 0,
  }
}

async function requestJson(url, signal) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', 'X-Lab-Client': 'changda-lab' },
    cache: 'no-store',
    redirect: 'error',
    signal,
  })
  const text = await response.text()
  if (text.length > MAX_RESPONSE_LENGTH) throw new Error('客户端更新响应过大')
  let payload
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    throw new Error('客户端更新响应格式无效')
  }
  if (!response.ok || payload?.success === false) {
    throw new Error(typeof payload?.message === 'string' && payload.message.trim() ? payload.message : `客户端更新检查失败（${response.status}）`)
  }
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload
}

function releaseEndpoint(config, apiPath, query) {
  const url = new URL(apiPath, config.serverUrl)
  if (url.origin !== config.serverUrl) throw new Error('客户端更新接口地址越界')
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return url
}

async function checkClientRelease({ config, currentVersion, platform = 'windows-x64', channel = 'stable' }) {
  if (!config || typeof currentVersion !== 'string' || currentVersion.trim() === '') {
    throw new Error('客户端更新检查参数无效')
  }
  const url = releaseEndpoint(config, config.apiPath || DEFAULT_LATEST_PATH, {
    platform,
    channel,
    current_version: currentVersion.trim(),
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const data = await requestJson(url, controller.signal)
    const release = normalizeRelease(data?.release)
    if (release?.downloadUrl) release.downloadUrl = new URL(release.downloadUrl, config.serverUrl).toString()
    return { updateAvailable: data?.update_available === true && release !== null, release }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('客户端更新检查超时')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function listClientReleaseHistory({ config, platform = 'windows-x64', channel = 'stable' }) {
  if (!config || typeof config.serverUrl !== 'string') throw new Error('客户端更新检查参数无效')
  const url = releaseEndpoint(config, config.historyPath || DEFAULT_HISTORY_PATH, { platform, channel })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const data = await requestJson(url, controller.signal)
    if (!Array.isArray(data)) throw new Error('客户端更新日志格式无效')
    return data
      .filter(release => release?.published === true)
      .map(normalizeRelease)
      .filter(Boolean)
      .slice(0, 50)
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('客户端更新日志加载超时')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

module.exports = { checkClientRelease, listClientReleaseHistory, readClientReleaseConfig }
