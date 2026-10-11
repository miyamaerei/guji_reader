/**
 * 分层加载探针（P5.1 验收）
 *
 * 采指定路由的①数据请求清单 ②渲染后的 DOM 关键标记。
 * 目的是验证「ent 层只拉精简索引、不拉 2.5MB 全量」这一 P5.1 验收项。
 *
 * ⚠️ 层切换不走 URL：`/list/:book` 无 layer 段，层由 Pinia store 持有
 * （LayerTabs → book.setLayer），所以本探针先进 list 页，再在页面内调 store
 * 切层，否则会命中 catch-all 跳回书架、测了个空。
 *
 * 用法：node scripts/probe_layers.mjs [route] [--layer ent] [--url base]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const argv = process.argv.slice(2)
const route = '/' + (argv[0] ?? 'list/shuidong-riji').replace(/^\/+/, '')
const li = argv.indexOf('--layer')
const wantLayer = li >= 0 ? argv[li + 1] : ''
const ui = argv.indexOf('--url')
const BASE = ui >= 0 ? argv[ui + 1] : 'http://localhost:4323'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const port = 9700 + Math.floor(Math.random() * 200)
const profile = mkdtempSync(join(tmpdir(), 'probe-'))
const proc = spawn(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--no-first-run',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let wsUrl = ''
for (let i = 0; i < 80; i++) {
  await sleep(150)
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`)
    wsUrl = (await r.json()).webSocketDebuggerUrl
    if (wsUrl) break
  } catch {
    /* 等 */
  }
}
if (!wsUrl) {
  proc.kill()
  console.error('Chrome DevTools 未就绪')
  process.exit(2)
}

const ws = new WebSocket(wsUrl)
await new Promise((res, rej) => {
  ws.addEventListener('open', res)
  ws.addEventListener('error', rej)
})
let msgId = 0
const pend = new Map()
const reqs = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pend.has(m.id)) {
    const { resolve } = pend.get(m.id)
    pend.delete(m.id)
    resolve(m.result)
  } else if (m.method === 'Network.requestWillBeSent') {
    reqs.push({ url: m.params.request.url, bytes: m.params.request.headers?.['content-length'] })
  }
})
const send = (method, params = {}, sessionId) =>
  new Promise((resolve) => {
    const id = ++msgId
    pend.set(id, { resolve })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Network.enable', {}, sessionId)
await send('Page.enable', {}, sessionId)

await send('Page.navigate', { url: `${BASE}/#${route}` }, sessionId)
await sleep(2500)
// 首屏（config/meta/chapters/join）不算，清掉只看切层后拉的
reqs.length = 0

// 层切换走 Pinia store，URL 不变——必须点 tab 才加载对应层。
// 直接点 DOM 里的层按钮最可靠（不依赖 store 的内部实现）。
if (wantLayer) {
  const clicked = await send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const btns = [...document.querySelectorAll('button, .ltab, [role=tab]')];
        const hit = btns.find(b => (b.textContent||'').trim().startsWith(${JSON.stringify(wantLayer)}));
        if (hit) { hit.click(); return true; }
        return false;
      })()`,
      returnByValue: true,
    },
    sessionId,
  )
  if (!clicked.result?.value) {
    console.warn(`⚠ 未找到层按钮「${wantLayer}」，可能 tab 文案不同；仍会输出已采到的请求`)
  }
  await sleep(5000)
}

// 刻意不传 awaitPromise：对同步表达式会返回空结果且不报错（见 probe_virtual.mjs 注释）
const dom = await send(
  'Runtime.evaluate',
  {
    expression: `(() => ({
      text: document.body.innerText.slice(0, 400),
      rows: document.querySelectorAll('tbody tr').length,
      cards: document.querySelectorAll('.card').length,
      html: document.body.innerHTML.length,
    }))()`,
    returnByValue: true,
  },
  sessionId,
)

const dataReqs = [...new Set(reqs.map((r) => r.url.replace(BASE, '')).filter((u) => u.includes('/data/')))].sort()

console.log(`\n=== 路由 ${route} ===`)
console.log(`DOM ${dom.result.value.html} 字节｜表格行 ${dom.result.value.rows}｜卡片 ${dom.result.value.cards}`)
console.log('\n数据请求：')
for (const u of dataReqs) console.log(`  ${u}`)
const entFull = dataReqs.find((u) => /\/ent\.json$/.test(u))
const entIdx = dataReqs.find((u) => /ent-index\.json$/.test(u))
console.log(`\nent 全量 ent.json：${entFull ?? '未请求 ✅'}`)
console.log(`ent 精简索引：    ${entIdx ?? '未请求'}`)
console.log(`\n正文片段：${dom.result.value.text.replace(/\s+/g, ' ').slice(0, 200)}`)

ws.close()
proc.kill()
try {
  rmSync(profile, { recursive: true, force: true })
} catch {
  /* 忽略 */
}