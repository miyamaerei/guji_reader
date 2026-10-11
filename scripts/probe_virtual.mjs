/**
 * 虚拟滚动效果探针（P5.2 验收）
 *
 * 验证两件事：
 *  ① DOM 行数是否与数据总量解耦（滚到底部仍是常数行）
 *  ② 滚动帧率是否达标
 *
 * 用法：node scripts/probe_virtual.mjs [route] [--layer 流程] [--url base]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const argv = process.argv.slice(2)
const route = '/' + (argv[0] ?? 'list/xinguan-guifan').replace(/^\/+/, '')
const li = argv.indexOf('--layer')
const wantLayer = li >= 0 ? argv[li + 1] : '流程'
const ui = argv.indexOf('--url')
const BASE = ui >= 0 ? argv[ui + 1] : 'http://localhost:4323'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9900 + Math.floor(Math.random() * 90)
const profile = mkdtempSync(join(tmpdir(), 'vprobe-'))
const proc = spawn(
  CHROME,
  ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
   `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: 'ignore' },
)

let wsUrl = ''
for (let i = 0; i < 80; i++) {
  await sleep(150)
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`)
    wsUrl = (await r.json()).webSocketDebuggerUrl
    if (wsUrl) break
  } catch { /* 等 */ }
}
if (!wsUrl) { proc.kill(); console.error('DevTools 未就绪'); process.exit(2) }

const ws = new WebSocket(wsUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
let msgId = 0
const pend = new Map()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  // resolve m.result（而非整个 m）——CDP 响应形如 {id, result:{result:{value}}},
  // 取值路径是 .result.value；resolve 整个 m 会让层级错一层、静默返回 undefined。
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id) }
})
const send = (method, params = {}, sessionId) =>
  new Promise((res) => { const id = ++msgId; pend.set(id, res); ws.send(JSON.stringify({ id, method, params, sessionId })) })

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
// Network.enable 不能省：CDP 的 Runtime 域要靠它（或 Page/Runtime 任一
// enable 触发的上下文激活）才可求值，否则 evaluate 一律返回空且不报错。
await send('Page.enable', {}, sessionId)
await send('Network.enable', {}, sessionId)

/**
 * 注意：这里刻意**不传 awaitPromise**。
 * CDP 的 awaitPromise=true 会把「非 Promise 结果」也按 thenable 处理，
 * 对 `document.readyState` 这类同步表达式会返回空结果、且不报错——
 * 表现为所有探针值都是 undefined，很难排查。异步表达式改用 .then(...) 显式包。
 */
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)
  const res = r?.result
  if (!res) throw new Error(`无响应：${JSON.stringify(r).slice(0, 200)}`)
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? JSON.stringify(res.exceptionDetails))
  }
  return res.result?.value
}

/** 页面上下文就绪探测（CDP attach 后上下文可能还没建好） */
/**
 * 页面上下文就绪探测。
 *
 * attach 之后立刻 evaluate 会落空（返回值 undefined 且不报错）——
 * 执行上下文还没建好。Page.getFrameTree 返回成功即表示主框架已就绪，
 * 比轮询 readyState 可靠（readyState 那时也可能是 undefined）。
 */
async function waitReady(timeout = 25000) {
  const t0 = Date.now()
  let lastErr = '(无错误)'
  for (;;) {
    try {
      const frameTree = await send('Page.getFrameTree', {}, sessionId)
      if (frameTree?.frameTree?.frame?.id) {
        // 框架就绪后再确认执行上下文可用
        await sleep(400)
        const v = await evalJs('document.readyState')
        if (v) return v
        lastErr = 'frameTree 就绪但 evaluate 仍返回空'
      } else {
        lastErr = 'frameTree 无 frame'
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
    if (Date.now() - t0 > timeout) throw new Error(`页面上下文未就绪：${lastErr}`)
    await sleep(250)
  }
}

/**
 * 求值一个返回 Promise 的表达式。
 * 不用 CDP 的 awaitPromise（对同步表达式会静默返回空），改为在页面里
 * 把结果挂到 window 上轮询取——笨但可靠。
 */
async function evalAsync(expression, timeout = 15000) {
  await evalJs(`(() => {
    window.__probe = { done: false, value: null, err: null };
    Promise.resolve().then(async () => {
      try { window.__probe.value = await (${expression}); }
      catch (e) { window.__probe.err = String(e); }
      finally { window.__probe.done = true; }
    })();
    return true;
  })()`)
  const t0 = Date.now()
  for (;;) {
    const st = await evalJs('JSON.stringify(window.__probe)')
    const parsed = JSON.parse(st)
    if (parsed.done) {
      if (parsed.err) throw new Error(parsed.err)
      return parsed.value
    }
    if (Date.now() - t0 > timeout) throw new Error('evalAsync 超时')
    await sleep(120)
  }
}

await send('Page.navigate', { url: `${BASE}/#${route}` }, sessionId)
const readyState = await waitReady()
await sleep(2000)

const clicked = await evalJs(`(() => {
  const b = [...document.querySelectorAll('button,.tab')].find(x => (x.textContent||'').trim().startsWith(${JSON.stringify(wantLayer)}));
  if (b) b.click();
  return !!b;
})()`)
if (!clicked) console.warn(`⚠ 未找到层按钮「${wantLayer}」`)
await sleep(2500)

const COUNT = `document.querySelectorAll('[data-vrow]').length`
const top = await evalJs(COUNT)
// 滚到中部再滚到底，验证 DOM 规模恒定
const mid = await evalJs(`(() => { const s=document.querySelector('.vcards'); if(!s) return -1; s.scrollTop = s.scrollHeight/2; return s.scrollTop; })()`)
await sleep(600)
const atMid = await evalJs(COUNT)
const bottom = await evalJs(`(() => { const s=document.querySelector('.vcards'); if(!s) return -1; s.scrollTop = s.scrollHeight; return s.scrollTop; })()`)
await sleep(600)
const atBottom = await evalJs(COUNT)

// 滚动帧率：连续滚 2 秒
const fps = await evalAsync(`(async () => {
  const s = document.querySelector('.vcards');
  if (!s) return -1;
  let frames = 0, stop = false;
  const tick = () => { frames++; if (!stop) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const t0 = performance.now();
  for (let i = 0; i < 40; i++) { s.scrollTop += 150; await new Promise(r => setTimeout(r, 50)); }
  stop = true;
  return Math.round(frames / ((performance.now() - t0) / 1000));
})()`)

const stat = await evalJs(`(() => {
  const el = document.querySelector('.vstat');
  return el ? el.textContent.replace(/\\s+/g,' ').trim() : '';
})()`)

console.log(`\n=== 虚拟滚动验证（${route} · ${wantLayer}）===`)
console.log(`首屏渲染行数：${top}`)
console.log(`滚到中部(${Math.round(mid)}px)：${atMid} 行`)
console.log(`滚到底部(${Math.round(bottom)}px)：${atBottom} 行`)
console.log(`滚动帧率：${fps} fps`)
console.log(`组件统计：${stat}`)
const stable = top === atMid && atMid === atBottom
console.log(`\n${stable && top < 60 ? '✅ DOM 规模与总量解耦（恒定 ' + top + ' 行）' : '❌ DOM 行数随滚动变化：' + top + '/' + atMid + '/' + atBottom}`)
console.log(`${fps >= 55 ? '✅' : '❌'} 帧率 ${fps} fps（门禁 ≥55）`)

ws.close()
proc.kill()
try { rmSync(profile, { recursive: true, force: true }) } catch { /* 忽略 */ }