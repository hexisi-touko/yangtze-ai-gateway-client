#!/usr/bin/env node
/*
 * dsh-dev: 从本仓库的 runtime/dsh 启动 DeepSeek Harness，并强制使用项目内的
 * 独立数据目录（.dsh-home），绝不落到 ~/.dsh。
 *
 * 背景：dsh 的数据根目录由环境变量 DSH_HOME 决定，未设置时默认取 `~/.dsh`
 * （见 runtime/dsh/node_modules/@deepseek-ai/dsh-home-paths）。而已安装的
 * 正式版 "DeepSeek Harness" 桌面端用的正是默认的 ~/.dsh。过去直接从本仓库
 * 裸跑 dsh 会把开发构建的插件软链接铺进 ~/.dsh/profiles，导致正式版启动时
 * 报 "2 required plugins did not activate" 而崩溃。
 *
 * 用法：
 *   node scripts/dsh-dev.cjs --profile web
 *   npm run dsh -- --profile web
 * 若调用方已显式设置 DSH_HOME，则沿用该值，但仍拒绝指向 ~/.dsh。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const BIN = path.join(ROOT, 'runtime', 'dsh', 'lib', 'bin.js')
const BUNDLED_NODE = path.join(ROOT, 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'node')
const SHARED_HOME = path.join(os.homedir(), '.dsh')

function resolveHome() {
  const fromCaller = process.env.DSH_HOME && process.env.DSH_HOME.trim()
  const home = fromCaller ? path.resolve(fromCaller) : path.join(ROOT, '.dsh-home')
  // 大小写不敏感比较：Windows 上 D:\ 与 d:\ 指同一位置。
  if (home.toLowerCase() === SHARED_HOME.toLowerCase()) {
    console.error(
      `[dsh-dev] 拒绝启动：DSH_HOME 指向正式版共用的 ${SHARED_HOME}。\n` +
      '           裸跑开发构建会覆盖正式版插件集并让它崩溃。\n' +
      '           去掉 DSH_HOME 以使用项目内的 .dsh-home，或显式指定其它目录。'
    )
    process.exit(2)
  }
  return home
}

const home = resolveHome()
fs.mkdirSync(home, { recursive: true })
if (!fs.existsSync(BIN)) {
  console.error(`[dsh-dev] 未找到 dsh 运行时：${BIN}\n           先执行 runtime 构建产物同步。`)
  process.exit(1)
}

const node = fs.existsSync(BUNDLED_NODE) ? BUNDLED_NODE : process.execPath
const child = spawn(node, [BIN, ...process.argv.slice(2)], {
  cwd: ROOT,
  windowsHide: true,
  stdio: 'inherit',
  env: { ...process.env, DSH_HOME: home },
})

child.on('error', error => {
  console.error(`[dsh-dev] 启动失败：${error.message}`)
  process.exit(1)
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { if (!child.killed) child.kill(signal) })
}
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))

console.log(`[dsh-dev] DSH_HOME = ${home}`)
