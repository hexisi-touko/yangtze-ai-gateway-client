const fs = require('node:fs')
const path = require('node:path')

function createDesktopToolsCache(filePath, maxAgeMs = 24 * 60 * 60 * 1000) {
  function read() {
    try {
      const value = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (!value || !Array.isArray(value.tools)) return null
      return value
    } catch { return null }
  }
  function write(value) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      const temp = `${filePath}.${process.pid}.tmp`
      fs.writeFileSync(temp, JSON.stringify({ savedAt: Date.now(), tools: value.tools }), 'utf8')
      fs.renameSync(temp, filePath)
    } catch { /* cache failure must never block login */ }
  }
  return {
    readFresh() { const value = read(); return value && Date.now() - value.savedAt <= maxAgeMs ? value : null },
    readAny: read,
    write,
  }
}

module.exports = { createDesktopToolsCache }
