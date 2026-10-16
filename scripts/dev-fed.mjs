/**
 * dev:fed —— 联邦数据库模式一键开发启动
 *
 * 同时拉起两个进程：
 *   1. SQLite 只读 API 服务（node server/sqlite-api.mjs，默认端口 8787）
 *   2. Vite 开发服务器（默认 5173，/api 代理到 8787）
 *
 * 用法：npm run dev:fed [--db <kb.sqlite 路径>]
 * 环境变量 KB_SQLITE 可替代 --db。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const dbFlag = argv.indexOf('--db')
const DB =
  process.env.KB_SQLITE ||
  (dbFlag >= 0 && argv[dbFlag + 1]) ||
  join('E:/git/ToolBox/guji/tools/kb-federation/kb.sqlite')

if (!existsSync(DB)) {
  console.error(`[dev] 找不到联邦库：${DB}`)
  console.error('[dev] 请用 --db 指定路径，或设置环境变量 KB_SQLITE')
  process.exit(1)
}

const API_PORT = process.env.API_PORT || '8787'
const VITE_PORT = process.env.VITE_PORT || '5173'

const label = (name) => {
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  return `[${t} ${name}]`
}

const apiProc = spawn(
  process.execPath,
  ['server/sqlite-api.mjs', '--db', DB, '--port', API_PORT],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)
const viteProc = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--port', VITE_PORT],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)

apiProc.stdout.on('data', (d) => process.stdout.write(`${label('api')} ${d}`))
apiProc.stderr.on('data', (d) => process.stderr.write(`${label('api')} ${d}`))
viteProc.stdout.on('data', (d) => process.stdout.write(`${label('vite')} ${d}`))
viteProc.stderr.on('data', (d) => process.stderr.write(`${label('vite')} ${d}`))

let closing = false
function shutdown(code = 0) {
  if (closing) return
  closing = true
  console.log('\n[dev] 正在停止服务…')
  apiProc.kill('SIGTERM')
  viteProc.kill('SIGTERM')
  setTimeout(() => process.exit(code), 300)
}

apiProc.on('exit', (code) => {
  console.log(`[dev] API 服务退出（code=${code}）`)
  if (!closing) shutdown(code ?? 1)
})
viteProc.on('exit', (code) => {
  console.log(`[dev] Vite 退出（code=${code}）`)
  if (!closing) shutdown(code ?? 1)
})

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))