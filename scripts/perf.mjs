/**
 * 性能基线测量（P5.0 / P5.4）
 *
 * 用 headless Chrome 采四项真实指标，作为 P5.4 门禁的依据：
 *   ① 首屏：书架 → 阅读器首条正文渲染完成
 *   ② 卷切换：进入某卷 → 该卷正文渲染完成
 *   ③ 搜索：多次采样的 P95
 *   ④ 首屏请求清单：验证「首屏不加载非当前卷数据」这一 P5.1 验收项
 *
 * 为什么用 CDP 而不是猜：性能问题不测就无从判断。虚拟时间预算
 * (--virtual-time-budget) 会加速定时器但不代表真实墙钟时间，
 * 所以这里一律用 performance.now() 在页面内取真实耗时。
 *
 * 运行：node scripts/perf.mjs [--json] [--url http://localhost:4323]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
/**
 * --probe <routeHash>：只采某页的数据请求清单（验证分层加载是否真的按需）
 *
 * ⚠️ 传的是 route hash（如 '/list/xxx/ent'），但 Git Bash 会把以 / 开头的参数
 * 当成 Windows 路径转换掉，所以这里也接受 'list/xxx/ent' 这种无前导斜杠的写法。
 */
const probeIdx = argv.indexOf('--probe')
const probeRouteRaw = probeIdx >= 0 ? argv[probeIdx + 1] : ''
const probeRoute = probeRouteRaw ? '/' + probeRouteRaw.replace(/^\/+/, '').replace(/\\/g, '/') : ''
const urlArg = argv.indexOf('--url')
const BASE = urlArg >= 0 ? argv[urlArg + 1] : 'http://localhost:4323'

/** P5.4 门禁阈值 */
export const THRESHOLDS = {
  firstPaintMs: 2000,
  volumeSwitchMs: 300,
  searchP95Ms: 100,
  minFps: 55,
}

/* ------------------------------------------------------------------ */
/* Chrome DevTools Protocol 最小客户端                                   */
/* ------------------------------------------------------------------ */

async function launch() {
  const port = 9500 + Math.floor(Math.random() * 400)
  const profile = mkdtempSync(join(tmpdir(), 'perf-'))
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  // 等 DevTools 就绪
  let wsUrl = ''
  for (let i = 0; i < 60; i++) {
    await sleep(150)
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`)
      const j = await r.json()
      wsUrl = j.webSocketDebuggerUrl
      if (wsUrl) break
    } catch {
      /* 还没起来，继续等 */
    }
  }
  if (!wsUrl) {
    proc.kill()
    throw new Error('Chrome DevTools 未就绪')
  }
  return { proc, port, profile, wsUrl }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.listeners = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      } else if (msg.method) {
        ;(this.listeners.get(msg.method) ?? []).forEach((fn) => fn(msg.params))
      }
    })
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params, sessionId }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP 超时: ${method}`))
        }
      }, 60000)
    })
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, [])
    this.listeners.get(method).push(fn)
  }
}

/* ------------------------------------------------------------------ */
/* 场景脚本（在页面内执行，返回真实耗时）                                  */
/* ------------------------------------------------------------------ */

/** 等某个选择器出现（应用是 SPA，hash 路由） */
const WAIT_SEL = `
  window.__waitFor = (sel, timeout = 15000) => new Promise((resolve, reject) => {
    const t0 = performance.now();
    (function tick() {
      const el = document.querySelector(sel);
      if (el) return resolve(true);
      if (performance.now() - t0 > timeout) return reject(new Error('timeout: ' + sel));
      requestAnimationFrame(tick);
    })();
  });
`

/** 场景①：进入阅读器，量到首条正文渲染完成 */
const SCENE_FIRST_PAINT = `
  (async () => {
    const t0 = performance.now();
    const nav = performance.getEntriesByType('navigation')[0];
    // 从导航开始算「首屏」，包含 JS 解析 + 数据 fetch + 首次渲染
    location.hash = '#/reader/shuidong-riji';
    await window.__waitFor('.card .iid');
    const firstItem = performance.now();
    return {
      firstPaintMs: Math.round(firstItem - nav.startTime),
      navToFirstItemMs: Math.round(firstItem - t0),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
      loadEvent: Math.round(nav.loadEventEnd - nav.startTime),
    };
  })()
`

/** 场景②：卷切换——量切到另一卷后该卷正文出现 */
const SCENE_VOLUME = `
  (async () => {
    const t0 = performance.now();
    location.hash = '#/reader/shuidong-riji?vol=02';
    // 等卷内出现 02- 开头的条目，确认是新卷内容而非旧卷残留
    const found = await new Promise((resolve) => {
      const deadline = performance.now() + 20000;
      (function tick() {
        const ids = [...document.querySelectorAll('.card .iid')].map(e => e.textContent.trim());
        if (ids.some(x => x.startsWith('02-'))) return resolve(true);
        if (performance.now() > deadline) return resolve(false);
        setTimeout(tick, 50);
      })();
    });
    return { volumeSwitchMs: Math.round(performance.now() - t0), volumeFound: found };
  })()
`

/** 场景③：搜索——多次采样算 P95 */
const SCENE_SEARCH = `
  (async () => {
    location.hash = '#/search/shuidong-riji?q=' + encodeURIComponent('礼部');
    await window.__waitFor('input.kw');
    await new Promise(r => setTimeout(r, 600));
    const terms = ['礼部','知县','文书','印','钱粮','上官','徭役','告示'];
    const samples = [];
    for (const t of terms) {
      const t0 = performance.now();
      const inp = document.querySelector('input.kw');
      inp.value = t;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      // 等去抖 200ms + 渲染
      await new Promise(r => setTimeout(r, 320));
      samples.push(performance.now() - t0 - 320);
    }
    samples.sort((a,b) => a - b);
    const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];
    return { searchSamples: samples.map(s => Math.round(s)), searchP95Ms: Math.round(p95) };
  })()
`

/** 场景④：滚动帧率 */
const SCENE_SCROLL = `
  (async () => {
    const pane = document.querySelector('.stream') || document.querySelector('.col-stream') || document.scrollingElement;
    if (!pane) return { fps: 0, frames: 0, note: 'no scroll pane' };
    let frames = 0;
    let stop = false;
    const count = () => { frames++; if (!stop) requestAnimationFrame(count); };
    requestAnimationFrame(count);
    const start = performance.now();
    // 连续滚动 2 秒，模拟真实滚动
    for (let i = 0; i < 40; i++) {
      pane.scrollTop += 120;
      await new Promise(r => setTimeout(r, 50));
    }
    stop = true;
    const dur = (performance.now() - start) / 1000;
    return { fps: Math.round(frames / dur), frames, durationMs: Math.round(dur * 1000) };
  })()
`

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function run() {
  const { proc, profile, wsUrl } = await launch()
  const results = { base: BASE, at: new Date().toISOString(), ok: true, notes: [] }

  try {
    const ws = new WebSocket(wsUrl)
    await new Promise((res, rej) => {
      ws.addEventListener('open', res)
      ws.addEventListener('error', rej)
    })
    const cdp = new Cdp(ws)

    // 开新 tab 并 attach
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })

    // 记录网络请求（验证 P5.1：首屏不该拉非当前卷数据）
    const requests = []
    cdp.on('Network.requestWillBeSent', (p) => {
      requests.push({ url: p.request.url, t: Math.round(p.timestamp * 1000) })
    })
    await cdp.send('Network.enable', {}, sessionId)
    await cdp.send('Page.enable', {}, sessionId)

    const evalIn = async (expr, awaitPromise = true) => {
      const r = await cdp.send(
        'Runtime.evaluate',
        { expression: expr, awaitPromise, returnByValue: true },
        sessionId,
      )
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description ?? '页面脚本异常')
      }
      return r.result.value
    }

    // --probe 模式：只采指定路由的请求清单，不跑性能场景。
    // 放在场景之前是因为 probe 关心的是「网络拉了什么」，
    // 而性能场景依赖首屏渲染成功——两者互为前提，不能串行。
    if (probeRoute) {
      await cdp.send('Page.navigate', { url: `${BASE}/` }, sessionId)
      await sleep(1500)
      requests.length = 0
      await cdp.send('Page.navigate', { url: `${BASE}/#${probeRoute}` }, sessionId)
      await sleep(5000)
      results.dataRequests = [
        ...new Set(requests.map((r) => r.url.replace(BASE, '')).filter((u) => u.includes('/data/'))),
      ].sort()
      ws.close()
      console.log(`\n=== 数据请求清单：${probeRoute} ===`)
      for (const u of results.dataRequests) console.log(`  ${u}`)
      const entFull = results.dataRequests.find((u) => /\/ent\.json$/.test(u))
      const entIdx = results.dataRequests.find((u) => /ent-index\.json$/.test(u))
      console.log(`\nent 全量 ent.json：${entFull ?? '未请求'}`)
      console.log(`ent 精简索引：    ${entIdx ?? '未请求'}`)
      console.log('')
      proc.kill()
      try {
        rmSync(profile, { recursive: true, force: true })
      } catch {
        /* 忽略清理失败 */
      }
      process.exit(0)
    }

    // 冷启动首屏
    await cdp.send('Page.navigate', { url: `${BASE}/` }, sessionId)
    await sleep(1200)
    await evalIn(WAIT_SEL, false)

    // 场景①首屏
    Object.assign(results, await evalIn(SCENE_FIRST_PAINT))
    results.firstScreenRequests = requests.filter((r) => r.url.includes('/data/')).length

    // 场景②卷切换
    Object.assign(results, await evalIn(SCENE_VOLUME))

    // 场景③搜索
    await evalIn(WAIT_SEL, false)
    Object.assign(results, await evalIn(SCENE_SEARCH))

    // 场景④滚动
    await cdp.send('Page.navigate', { url: `${BASE}/#/reader/shuidong-riji` }, sessionId)
    await sleep(1500)
    await evalIn(WAIT_SEL, false)
    await sleep(500)
    Object.assign(results, await evalIn(SCENE_SCROLL))

    // 数据文件清单（供人工核对分包）
    results.dataRequests = [
      ...new Set(requests.map((r) => r.url.replace(BASE, '')).filter((u) => u.includes('/data/'))),
    ].sort()

    // 门禁判定
    const checks = [
      ['首屏 < 2000ms', results.firstPaintMs, THRESHOLDS.firstPaintMs, 'lt'],
      ['卷切换 < 300ms', results.volumeSwitchMs, THRESHOLDS.volumeSwitchMs, 'lt'],
      ['搜索 P95 < 100ms', results.searchP95Ms, THRESHOLDS.searchP95Ms, 'lt'],
      ['滚动 ≥ 55fps', results.fps, THRESHOLDS.minFps, 'gte'],
    ]
    results.gate = checks.map(([name, actual, limit, op]) => {
      const pass = op === 'lt' ? actual < limit : actual >= limit
      return { name, actual, limit, op, pass }
    })
    results.ok = results.gate.every((g) => g.pass)

    ws.close()
  } catch (e) {
    results.ok = false
    results.error = e instanceof Error ? e.message : String(e)
  } finally {
    proc.kill()
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {
      /* 忽略清理失败 */
    }
  }
  return results
}

const out = await run()
if (asJson) {
  console.log(JSON.stringify(out, null, 2))
} else {
  console.log('\n=== 性能基线（P5.4 门禁）===')
  console.log(`目标：${out.base}   采样：${out.at}`)
  if (out.error) {
    console.log(`\n❌ 测量失败：${out.error}`)
  } else {
    console.log(`首屏（含导航→首条正文）：${out.firstPaintMs} ms   [DOMContentLoaded ${out.domContentLoaded} ms / load ${out.loadEvent} ms]`)
    console.log(`卷切换：${out.volumeSwitchMs} ms`)
    console.log(`搜索 P95：${out.searchP95Ms} ms   样本：${(out.searchSamples || []).join(', ')}`)
    console.log(`滚动帧率：${out.fps} fps（${out.frames} 帧 / ${out.durationMs} ms）`)
    console.log(`首屏数据请求数：${out.firstScreenRequests}`)
    console.log('\n门禁：')
    for (const g of out.gate ?? []) {
      console.log(`  ${g.pass ? '✅' : '❌'} ${g.name}  实际 ${g.actual} / 限 ${g.limit}`)
    }
    console.log(`\n${out.ok ? '✅ 全部通过' : '❌ 存在未达标项'}`)
  }
  console.log('')
}
process.exit(out.ok ? 0 : 1)