/**
 * reader-vue · 联邦数据库只读 API 服务
 *
 * 零第三方依赖：node:http + node:sqlite（Node ≥ 22.5，内置 SQLite 3.45+，自带 JSON1）
 * 数据源：联邦线产物 kb.sqlite（只读打开，绝不写库）
 *
 * 端点一览（全部 GET，前缀 /api）：
 *   /api/health                                 服务与库状态
 *   /api/books                                  书架（全部书摘要 + 统计 + book_meta 元信息）
 *   /api/books/:book/config                     BookConfig（由 layer_catalog/layer_fields 推导）
 *   /api/books/:book/meta                       BookMeta（卷/条目/实体/mention 统计）
 *   /api/books/:book/chapters                   目录（卷 → 条目）
 *   /api/books/:book/items?volume=02            卷条目块（原文+译文+实体 span）
 *   /api/books/:book/layers/:layer[?item_id=&full=1][&limit=&offset=&field=&value=]
 *                                               层记录（默认瘦身，剔除 original；limit 启用分页，
 *                                               count 恒为该筛选口径总数；field 限该层 config 字段）
 *   /api/books/:book/ent-index                  实体索引（渲染层用，瘦身）
 *   /api/books/:book/entities                   实体表（nodes 聚合）
 *   /api/books/:book/join                       条目-层 关联索引
 *   /api/books/:book/enums                      枚举值域（chips 筛选）
 *   /api/books/:book/search-index               兼容旧检索索引（SearchIndexFile 形态）
 *   /api/search?q=词[&q=词2][&book=书]           检索（默认跨书联邦；多词 AND）
 *   /api/assoc?q=词                              联邦实体关联（canonical/members/record_refs）
 *
 * 用法：
 *   node server/sqlite-api.mjs --db <kb.sqlite> [--port 8787] [--static dist]
 */
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, createReadStream, statSync } from 'node:fs'
import { join, normalize, extname } from 'node:path'
import {
  deriveConfig,
  deriveMeta,
  deriveChapters,
  deriveItemChunk,
  deriveLayer,
  deriveEntIndex,
  deriveEntities,
  deriveJoin,
  deriveEnums,
  deriveSearch,
  deriveAssoc,
  deriveSearchIndex,
  bookMetaOf,
  volLabel,
} from './fed-lib.mjs'

/* ---------------- 参数与环境 ---------------- */
const argv = process.argv.slice(2)
const pick = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const REPORTED_DB =
  process.env.KB_SQLITE || pick('--db')
const PORT = Number(process.env.PORT || pick('--port') || 8787)
const STATIC_DIR = pick('--static')
const HOST = '127.0.0.1'

if (!REPORTED_DB) {
  console.error(
    '[api] 缺少数据库路径。用法：node server/sqlite-api.mjs --db <kb.sqlite> [--port 8787] [--static dist]\n' +
      '      或设置环境变量 KB_SQLITE。',
  )
  process.exit(1)
}
if (!existsSync(REPORTED_DB)) {
  console.error(`[api] 数据库文件不存在：${REPORTED_DB}`)
  process.exit(1)
}

const db = new DatabaseSync(REPORTED_DB, { readOnly: true })
db.exec('PRAGMA query_only = ON')

/* ---------------- 缓存（仅静态结构；数据查询不缓存，保证与库一致） ---------------- */
const configCache = new Map()

function configOf(bookId) {
  let cfg = configCache.get(bookId)
  if (!cfg) {
    cfg = deriveConfig(db, bookId)
    configCache.set(bookId, cfg)
  }
  return cfg
}

function getBook(bookId) {
  return db.prepare('SELECT * FROM books WHERE book_id = ?').get(bookId)
}

function bookColorIndex(bookId) {
  const all = db.prepare('SELECT book_id FROM books ORDER BY book_id').all()
  return all.findIndex((b) => b.book_id === bookId)
}

/* ---------------- 响应工具 ---------------- */
const send = (res, code, body, extra = {}) => {
  const text = code === 204 ? '' : JSON.stringify(body)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    ...extra,
  })
  res.end(text)
}
const ok = (res, body) => send(res, 200, body)
const fail = (res, code, msg) => send(res, code, { error: msg })

/* ---------------- 路由 ---------------- */
function route(req, res, path, params) {
  /* ---- health ---- */
  if (path === '/api/health') {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name)
    return ok(res, { ok: true, db: REPORTED_DB, tables, time: Date.now() })
  }

  /* ---- 书架 ---- */
  if (path === '/api/books') {
    const books = db.prepare('SELECT * FROM books ORDER BY book_id').all()
    const list = books.map((b, i) => {
      const items = db
        .prepare(
          "SELECT COUNT(*) n, COUNT(DISTINCT volume) v FROM items WHERE book_id = ? AND volume <> '00'",
        )
        .get(b.book_id)
      const layers = db
        .prepare(
          "SELECT COUNT(DISTINCT layer_key) c FROM records WHERE book_id = ? AND volume <> '00'",
        )
        .get(b.book_id)
      const ent = db
        .prepare(
          "SELECT COUNT(*) c FROM records WHERE book_id = ? AND layer_key = 'ent' AND volume <> '00'",
        )
        .get(b.book_id)
      const nodes = db
        .prepare(
          // 实体主键去重计数（nodes 表一行一个标注实例，需按归一词形去重）。
          // 曾经是 COUNT(*)，entities 恒等于 mentions，失去统计意义
          // （水东日记曾显示 2253，实际 1900——走查 2026-10-13）。
          // normalized 缺失时退回 label，二者在本库等价（distinct 相同）。
          "SELECT COUNT(DISTINCT COALESCE(json_extract(payload, '$.normalized'), label)) c FROM nodes WHERE book_id = ? AND layer_key = 'ent'",
        )
        .get(b.book_id)
      const event = db
        .prepare(
          "SELECT COUNT(*) c FROM records WHERE book_id = ? AND layer_key IN ('event','evt') AND volume <> '00'",
        )
        .get(b.book_id)
      // 实体类型数（书架「体裁」行的素材）：联邦库 books 表无作者/朝代字段，
      // 副标题与体裁标签一律由真实统计派生，不写死任何一本书的信息
      const typeCount = db
        .prepare(
          "SELECT COUNT(DISTINCT COALESCE(json_extract(payload, '$.type'), 'unknown')) c FROM records WHERE book_id = ? AND layer_key = 'ent' AND volume <> '00'",
        )
        .get(b.book_id)
      // 书架副标题/体裁：优先 book_meta 元信息（如「明·叶盛 · 典章制度与朝野见闻杂记」），
      // 表缺失/无行时回落统计派生（老库未灌种子也能跑，不报错）
      const meta = bookMetaOf(db, b.book_id)
      const subtitle = meta
        ? `${meta.dynasty}·${meta.author} · ${meta.subject}`
        : `联邦库 · ${items.v} 卷 · ${items.n} 条`
      const genre = meta
        ? `${meta.genre} · ${layers.c} 层要素`
        : `${layers.c} 层要素 · ${typeCount.c} 类实体`
      return {
        bookId: b.book_id,
        title: `《${b.name}》`,
        name: b.name,
        volumes: items.v,
        items: items.n,
        layers: layers.c,
        /// 书架徽标口径：entities=实体主键数（nodes 去重），mentions=实体标注实例数（ent 记录数）
        entities: nodes.c,
        mentions: ent.c,
        ...(event.c ? { event: event.c } : {}),
        subtitle,
        genre,
      }
    })
    return ok(res, { count: list.length, books: list })
  }

  /* ---- 层级路由（须在单书路由之前，避免 sub='layers' 被截胡） ---- */
  const lm = path.match(/^\/api\/books\/([^/]+)\/layers\/([^/]+)/)
  if (lm) {
    const bookId = lm[1]
    if (!getBook(bookId)) return fail(res, 404, `未知书籍 book_id=${bookId}`)
    const layer = lm[2]
    const itemId = params.get('item_id') || null
    // full=1 且未指定条目时也返回完整书证（谨慎：大层会拉全量 original）
    const full = params.get('full') === '1'
    // 分页（总览页）：limit 必填才启用；offset 缺省 0；上限 500 防一页拖垮浏览器
    let offset = 0
    let limit = null
    const rawLimit = params.get('limit')
    if (rawLimit != null) {
      limit = Number(rawLimit)
      if (!Number.isFinite(limit) || limit < 1) return fail(res, 400, `limit 须为正整数，收到 ${rawLimit}`)
      limit = Math.min(limit, 500)
      const rawOffset = params.get('offset')
      if (rawOffset != null) {
        offset = Number(rawOffset)
        if (!Number.isFinite(offset) || offset < 0)
          return fail(res, 400, `offset 须为非负整数，收到 ${rawOffset}`)
      }
    }
    // filterBy 下推：field 必须在该层 config 字段白名单内（防任意 json path 进 SQL）
    let field = null
    let value = null
    const rawField = params.get('field')
    if (rawField) {
      const cfg = configOf(bookId)
      const decl = cfg?.layers.find((l) => l.id === layer)
      if (!decl?.fields?.[rawField]) {
        return fail(res, 400, `层 ${layer} 无字段 ${rawField}（可用：${Object.keys(decl?.fields ?? {}).join(',')}）`)
      }
      field = rawField
      value = params.get('value') ?? ''
    }
    const chunk = deriveLayer(db, bookId, layer, { full, itemId, field, value, offset, limit })
    if (!chunk.records.length && !itemId && !chunk.count) {
      return fail(res, 404, `书 ${bookId} 无层 ${layer}`)
    }
    return ok(res, chunk)
  }

  /* ---- 单书路由 ---- */
  const m = path.match(/^\/api\/books\/([^/]+)(?:\/([^/]+))?/)
  if (m) {
    const bookId = m[1]
    const book = getBook(bookId)
    if (!book) return fail(res, 404, `未知书籍 book_id=${bookId}（可用：/api/books 查看）`)
    const sub = m[2]

    if (!sub) {
      const cfg = deriveConfig(db, bookId)
      return ok(res, {
        bookId,
        title: `《${book.name}》`,
        chapters: cfg?.structure.chunkBy ?? 'volume',
        layerKeys: cfg?.layers.map((l) => l.id) ?? [],
      })
    }

    switch (sub) {
      case 'config':
        return ok(res, configOf(bookId))
      case 'meta': {
        const meta = deriveMeta(db, bookId)
        return ok(res, meta)
      }
      case 'chapters':
        return ok(res, { bookId, chapters: deriveChapters(db, bookId) })
      case 'join':
        return ok(res, deriveJoin(db, bookId))
      case 'enums':
        return ok(res, deriveEnums(db, bookId))
      case 'entities':
        return ok(res, deriveEntities(db, bookId))
      case 'ent-index':
        return ok(res, deriveEntIndex(db, bookId))
      case 'search-index':
        return ok(res, deriveSearchIndex(db, bookId))
      case 'items': {
        const volume = params.get('volume') ?? ''
        if (!volume) return fail(res, 400, '缺少 volume 参数，如 /api/books/sdr/items?volume=01')
        return ok(res, deriveItemChunk(db, bookId, volume))
      }
      default:
        return fail(res, 404, `未知子资源 ${sub}`)
    }
  }
  /* ---- 检索 ---- */
  if (path === '/api/search') {
    const terms = params.getAll('q').map((s) => s.trim()).filter(Boolean)
    if (!terms.length) return fail(res, 400, '缺少 q 参数（可多个，多词 AND）')
    const bookId = params.get('book') || null
    if (bookId && !getBook(bookId)) return fail(res, 404, `未知书籍 book_id=${bookId}`)
    const t0 = Date.now()
    const result = deriveSearch(db, { bookId, terms })
    return ok(res, { ...result, elapsed: Date.now() - t0 })
  }

  /* ---- 联邦实体关联 ---- */
  if (path === '/api/assoc') {
    const q = (params.get('q') ?? '').trim()
    if (!q) return fail(res, 400, '缺少 q 参数，如 /api/assoc?q=苏轼')
    const t0 = Date.now()
    const result = deriveAssoc(db, q)
    return ok(res, { ...result, elapsed: Date.now() - t0 })
  }

  /* ---- 静态托管（生产同进程部署） ---- */
  if (STATIC_DIR) return serveStatic(res, path)
  return fail(res, 404, `未找到路由 ${path}`)
}

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

function serveStatic(res, path) {
  let p = normalize(join(STATIC_DIR, path === '/' ? 'index.html' : path))
  if (!p.startsWith(normalize(STATIC_DIR))) return fail(res, 403, 'forbidden')
  const file = existsSync(p) && statSync(p).isFile() ? p : join(STATIC_DIR, 'index.html')
  if (!existsSync(file)) return fail(res, 404, 'not found')
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
  })
  createReadStream(file).pipe(res)
}

/* ---------------- 启动 ---------------- */
const server = createServer((req, res) => {
  if (req.method !== 'GET') return fail(res, 405, '只支持 GET（本服务为只读）')
  // 手动拆 path/search：绕开 new URL 对未编码中文 query 的解析失败
  // （curl 直接请求 ?q=礼部 时请求行含原始 UTF-8 字节，whatwg URL 会抛 Invalid URL）
  const raw = String(req.url ?? '/')
  const qIdx = raw.indexOf('?')
  let path
  try {
    path = decodeURIComponent(qIdx >= 0 ? raw.slice(0, qIdx) : raw)
  } catch {
    path = qIdx >= 0 ? raw.slice(0, qIdx) : raw
  }
  const params = new URLSearchParams(qIdx >= 0 ? raw.slice(qIdx + 1) : '')
  try {
    route(req, res, path, params)
  } catch (err) {
    console.error('[api] 处理请求失败：', err)
    if (!res.headersSent) fail(res, 500, `内部错误：${err.message}`)
    else res.end()
  }
})

server.listen(PORT, HOST, () => {
  console.log(`[api] 联邦数据库只读服务已启动：`)
  console.log(`[api]   db   = ${REPORTED_DB}`)
  console.log(`[api]   url  = http://${HOST}:${PORT}/api/health`)
  if (STATIC_DIR) console.log(`[api]   静态 = ${STATIC_DIR}`)
})

server.on('error', (err) => {
  console.error('[api] 启动失败：', err.message)
  process.exit(1)
})

process.on('SIGINT', () => {
  db.close()
  process.exit(0)
})