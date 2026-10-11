/**
 * 通用图书数据打包器（P1）
 *
 *   node scripts/build_book_data.mjs shuidong-riji
 *   node scripts/build_book_data.mjs --all
 *
 * 设计原则：
 *   1. 书特有的一切都放在 scripts/profiles/<book>.mjs，本文件不含任何书名/字段硬编码。
 *   2. 输出严格遵循 docs/data-contract.md，前端只认契约、不认源数据。
 *   3. 三件套缺失在打包期补全并计入 meta.imputed，绝不静默丢弃。
 *   4. span 定位失败不丢记录，标记 s=-1 由渲染层跳过着色。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { locateAll, dedupeSpans } from './lib/span.mjs'
import { ENT_INDEX_FIELDS } from './lib/ent-fields.mjs'
import {
  bump,
  excerpt,
  ordinalOf,
  out,
  pct,
  readJson,
  squash,
  tally,
  volumeOf,
  writeJson,
} from './lib/util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_BASE = path.join(ROOT, 'public/data')
const DEFAULT_SOURCE = '原文'

/* ------------------------------------------------------------------ */
/* 报告                                                                */
/* ------------------------------------------------------------------ */

function newReport() {
  return { errors: [], warnings: [], notes: [] }
}
const err = (r, m) => r.errors.push(m)
const warn = (r, m) => r.warnings.push(m)
const note = (r, m) => r.notes.push(m)

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function buildBook(bookKey, report) {
  const profPath = path.join(ROOT, 'scripts/profiles', `${bookKey}.mjs`)
  if (!fs.existsSync(profPath)) {
    err(report, `找不到 profile: scripts/profiles/${bookKey}.mjs`)
    return null
  }
  const prof = await import(pathToFileURL(profPath).href)
  const bookId = prof.bookId

  out(`\n═══ 打包《${prof.meta.title}》(${bookId}) ═══`)

  /* ---- 1. 配置 ---- */
  const config = readJson(path.join(ROOT, prof.configPath))
  const layerDecls = new Map(config.layers.map((l) => [l.id, l]))
  out(`  层配置 ${config.layers.length} 个：${config.layers.map((l) => l.id).join(', ')}`)

  /* ---- 2. 各层记录 ---- */
  const raw = new Map() // layerId -> records[]
  for (const layer of prof.layers) {
    const recs = prof.loadLayer(layer)
    raw.set(layer.id, recs)
    out(`  源层 ${layer.id.padEnd(6)} ${String(recs.length).padStart(5)} 条`)
    if (!layerDecls.has(layer.id)) warn(report, `${bookId}：层 ${layer.id} 有数据但未在 book.config.json 声明`)
  }
  for (const l of config.layers) {
    if (l.reserved) continue
    if (!raw.has(l.id)) warn(report, `${bookId}：配置声明层 ${l.id} 但源数据缺失（P2 会显示「待补建」）`)
  }

  /* ---- 3. 条目骨架 + 原文 ---- */
  const joinRows = prof.loadItems()
  const itemsById = new Map()
  for (const r of joinRows) {
    const iid = r[prof.joinKey]
    if (itemsById.has(iid)) err(report, `${bookId}：条目 ${iid} 在 join 中重复`)
    itemsById.set(iid, {
      iid,
      volume: r.volume ?? volumeOf(iid),
      chapter: r.chapter ?? undefined,
      source: r.source || DEFAULT_SOURCE,
    })
  }
  out(`  条目骨架 ${itemsById.size} 条`)

  // 原文：优先用条目注册表（若书提供），否则从层记录的 original 取；译文从 trl 取
  const originalOf = new Map()
  const translationOf = new Map()
  const normOf = new Map()
  if (prof.originals) {
    for (const [iid, o] of prof.originals()) originalOf.set(iid, o)
  }
  let originalConflict = 0
  for (const layer of prof.layers) {
    for (const r of raw.get(layer.id)) {
      const iid = r[layer.itemKey]
      const o = r.original
      if (o && o.trim()) {
        const prev = originalOf.get(iid)
        if (prev === undefined) {
          originalOf.set(iid, o)
          normOf.set(iid, r.norm || o)
        } else if (squash(prev) !== squash(o) && ++originalConflict <= 3) { // 仅作校验
          warn(report, `${bookId}：条目 ${iid} 层 ${layer.id} 的 original 与先前不一致（取首次）`)
        }
      }
      if (layer.id === 'trl' && r.translation) translationOf.set(iid, r.translation)
    }
  }
  const noOriginal = [...itemsById.keys()].filter((i) => !originalOf.has(i))
  if (noOriginal.length) {
    warn(report, `${bookId}：${noOriginal.length} 条无原文（${noOriginal.slice(0, 5).join(', ')}…）`)
  }
  out(`  原文覆盖 ${originalOf.size}/${itemsById.size}（${pct(originalOf.size, itemsById.size)}）｜译文 ${translationOf.size}`)

  /* ---- 4. 实体主键表 ---- */
  const entLayer = prof.layers.find((l) => l.id === 'ent')
  /** 条目 id 字段名由 profile 决定（水东 item_id / 新官注入的 _item_id） */
  const IK = entLayer?.itemKey ?? 'item_id'
  const entityTable = {}
  const mentionByItem = new Map() // iid -> mention[]
  const mentionOf = new Map() // 源标注对象 -> {mid, eid}
  if (entLayer) {
    const anns = raw.get('ent')
    // ENT-NNN 是「实体主键」，同一主键可跨条目复现 → 按 normalized 聚合
    const byNorm = new Map()
    let seq = 0
    for (const a of anns) {
      const iid = a[IK]
      const key = a.normalized || a.text
      let e = byNorm.get(key)
      if (!e) {
        e = {
          eid: a.id,
          normalized: key,
          type: a.type,
          surfaces: new Set(),
          count: 0,
          items: new Set(),
          first_source: iid,
        }
        byNorm.set(key, e)
      }
      e.surfaces.add(a.text)
      e.count++
      e.items.add(iid)
      const mid = `M${String(++seq).padStart(5, '0')}`
      mentionOf.set(a, { mid, eid: e.eid })
      if (!mentionByItem.has(iid)) mentionByItem.set(iid, [])
      mentionByItem.get(iid).push({ ann: a, mid, eid: e.eid })
    }
    for (const e of byNorm.values()) {
      entityTable[e.eid] = {
        eid: e.eid,
        normalized: e.normalized,
        type: e.type,
        surfaces: [...e.surfaces].sort(),
        count: e.count,
        first_source: e.first_source,
        items: [...e.items].sort(),
        gid: null,
      }
    }
    out(`  实体主键 ${Object.keys(entityTable).length} 个 / 标注 ${anns.length} 条`)
  }

  /* ---- 5. span 定位（P1.2 关键） ---- */
  let spanStats = { L1: 0, L2: 0, L3: 0, L0: 0 }
  let spanDropped = 0
  let spanOverlap = 0
  const spansByItem = new Map()
  if (entLayer) {
    const allAnns = []
    for (const [, list] of mentionByItem) for (const m of list) allAnns.push(m.ann)
    const { results, stats, unlocated } = locateAll(allAnns, (a) => originalOf.get(a[IK]) || '')
    spanStats = stats
    const byItem = new Map()
    for (const r of results) {
      const iid = r.ann[IK]
      if (!byItem.has(iid)) byItem.set(iid, [])
      const mo = mentionOf.get(r.ann)
      byItem.get(iid).push({
        id: mo.mid,
        eid: mo.eid,
        // L3 命中异体字形时取原文实际切片，保证 text.slice(s,e)===text 恒成立；
        // 源标注词形另存 surface，供实体归并检索。
        text: r.level === 'L3' ? r.matched : r.ann.text,
        surface: r.level === 'L3' ? r.ann.text : undefined,
        type: r.ann.type,
        s: r.s,
        e: r.e,
        normalized: r.ann.normalized,
        confidence: r.ann.confidence ?? null,
        _level: r.level,
      })
    }
    for (const [iid, spans] of byItem) {
      const { spans: kept, dropped } = dedupeSpans(spans)
      spanDropped += dropped
      spansByItem.set(iid, kept.map(({ _level, ...s }) => s))
    }
    const located = stats.L1 + stats.L2 + stats.L3
    spanOverlap = spanDropped - stats.L0
    out(
      `  span 定位 L1精确 ${stats.L1} / L2直查 ${stats.L2} / L3模糊 ${stats.L3} / 未定位 ${stats.L0}` +
        ` ｜ 覆盖 ${pct(located, allAnns.length)}｜重叠丢弃 ${spanOverlap}`,
    )
    const unpPath = path.join(ROOT, 'scripts/out', `${bookId}.unlocated.json`)
    if (unlocated.length) {
      warn(report, `${bookId}：${unlocated.length} 条实体未能定位，正文不着色（不影响检索与跳转）`)
      writeJson(unpPath, unlocated, { pretty: true })
    } else {
      fs.rmSync(unpPath, { force: true }) // 全部定位成功时清掉上一轮遗留清单
    }
  }

  /* ---- 6. 输出目录 ---- */
  const outDir = path.join(OUT_BASE, bookId)
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })

  /* ---- 7. 层文件（字段映射 + 三件套补全） ---- */
  const imputed = { source: 0, confidence: 0 }
  const layerCounts = {}
  for (const layer of prof.layers) {
    const decl = layerDecls.get(layer.id)
    const records = raw.get(layer.id).map((r) => {
      // 主键层（ent）：源 id 是实体主键、可跨条目复现，改用 mention 唯一 id，
      // 主键另存 eid —— 否则前端用 id 做 key / 路由会撞车。
      const mo = mentionOf.get(r)
      const rec = { id: mo ? mo.mid : r[layer.idKey], item_id: r[layer.itemKey] }
      if (mo) rec.eid = mo.eid
      // 契约字段（含重命名）
      for (const [dst, src] of Object.entries(layer.map)) {
        if (r[src] !== undefined) rec[dst] = r[src]
      }
      // 未映射的标量字段原样保留，避免丢信息
      for (const [k, v] of Object.entries(r)) {
        if (k.startsWith('_') || k === layer.idKey || k === layer.itemKey) continue
        if (k === 'original' || k === 'norm' || k === 'source' || k === 'confidence') continue
        if (Object.values(layer.map).includes(k)) continue
        if (rec[k] === undefined) rec[k] = v
      }
      // 三件套：标注层等不带 original 的层，回查条目原文
      rec.original = r.original || originalOf.get(rec.item_id) || ''
      rec.source = r.source || DEFAULT_SOURCE
      if (rec.source === DEFAULT_SOURCE && !r.source) imputed.source++
      rec.confidence = Number.isFinite(r.confidence) ? r.confidence : null
      if (rec.confidence === null) imputed.confidence++
      rec.volume = r._vol ?? volumeOf(rec.item_id)
      return rec
    })
    // id 唯一性
    const seen = new Set()
    const dupIds = []
    for (const rec of records) {
      if (seen.has(rec.id)) dupIds.push(rec.id)
      seen.add(rec.id)
    }
    if (dupIds.length) {
      warn(report, `${bookId}/${layer.id}：${dupIds.length} 个重复记录 id（源数据中该层 id 非唯一，已保留全部）`)
    }
    layerCounts[layer.id] = records.length
    writeJson(path.join(outDir, `layers/${layer.id}.json`), {
      layer: layer.id,
      count: records.length,
      records,
    })

    // ent 层额外出一份精简索引（P5.1）：书证全文 original 占 83% 体积，
    // 而实体列表只需 text/type/eid 做筛选与展示——不该让列表替详情页买单。
    // 全量文件保留（含书证），供详情与导出使用。
    if (layer.id === 'ent') {
      const slim = records.map((r) => {
        const o = {}
        for (const k of ENT_INDEX_FIELDS) if (r[k] !== undefined) o[k] = r[k]
        return o
      })
      const idxPath = path.join(outDir, `layers/${layer.id}-index.json`)
      writeJson(idxPath, { layer: layer.id, count: records.length, full: false, records: slim })
      const fullSize = JSON.stringify(records).length
      const slimSize = JSON.stringify(slim).length
      out(
        `  ent 精简索引：${(slimSize / 1024).toFixed(0)}KB（原 ${(fullSize / 1024).toFixed(0)}KB，` +
          `省 ${(100 - (slimSize / fullSize) * 100).toFixed(0)}%）`,
      )
    }
  }
  out(`  层文件已输出，三件套补全：source ${imputed.source} / confidence ${imputed.confidence}`)

  /* ---- 7.5 实体主键表 ---- */
  writeJson(path.join(outDir, 'entities.json'), entityTable)

  /* ---- 8. items chunk（按卷） ---- */
  const byVolume = new Map()
  for (const item of itemsById.values()) {
    if (!byVolume.has(item.volume)) byVolume.set(item.volume, [])
    byVolume.get(item.volume).push(item)
  }
  const volumes = [...byVolume.keys()].sort()
  const useChapter = config.structure.tree.includes('chapter')
  /** 卷内排序：有章时先按章再按条序，否则纯条序 */
  const cmpItem = (a, b) => {
    if (useChapter) {
      const d = String(a.chapter ?? '').localeCompare(String(b.chapter ?? ''))
      if (d) return d
    }
    return ordinalOf(a.iid) - ordinalOf(b.iid)
  }
  const volInfo = []
  let itemWritten = 0
  for (const vol of volumes) {
    const list = byVolume.get(vol).sort(cmpItem)
    const items = list.map((it) => ({
      iid: it.iid,
      ordinal: ordinalOf(it.iid),
      volume: it.volume,
      chapter: it.chapter,
      text: originalOf.get(it.iid) ?? '',
      norm: normOf.get(it.iid) ?? undefined,
      translation: translationOf.get(it.iid),
      spans: spansByItem.get(it.iid) ?? [],
    }))
    writeJson(path.join(outDir, `items/${vol}.json`), { volume: vol, items })
    volInfo.push({ id: vol, label: prof.volumeLabel ? prof.volumeLabel(vol) : `第${vol}卷`, itemCount: items.length })
    itemWritten += items.length
  }
  out(`  items chunk ${volumes.length} 卷 / ${itemWritten} 条`)

  /* ---- 9. join ---- */
  const joinIdsByItem = new Map()
  for (const layer of prof.layers) {
    if (layer.joinMode === 'primary') continue
    for (const r of raw.get(layer.id)) {
      const iid = r[layer.itemKey]
      if (!joinIdsByItem.has(iid)) joinIdsByItem.set(iid, new Map())
      const m = joinIdsByItem.get(iid)
      if (!m.has(layer.id)) m.set(layer.id, [])
      const arr = m.get(layer.id)
      const id = r[layer.idKey]
      if (!arr.includes(id)) arr.push(id)
    }
  }
  // ent 层：层文件的 id 是 mention 唯一 id（源主键可跨条目复现），join 必须与之一致
  if (entLayer) {
    for (const r of raw.get('ent')) {
      const iid = r[entLayer.itemKey]
      if (!joinIdsByItem.has(iid)) joinIdsByItem.set(iid, new Map())
      const m = joinIdsByItem.get(iid)
      if (!m.has('ent')) m.set('ent', [])
      const arr = m.get('ent')
      const mid = mentionOf.get(r)?.mid ?? r[entLayer.idKey]
      if (!arr.includes(mid)) arr.push(mid)
    }
  }
  const joinColumns = prof.layers.map((l) => l.id)
  const rows = [...itemsById.values()]
    .sort((a, b) => {
      const d = String(a.volume).localeCompare(String(b.volume))
      return d || cmpItem(a, b)
    })
    .map((it) => {
      const m = joinIdsByItem.get(it.iid) || new Map()
      const ids = {}
      for (const c of joinColumns) ids[c] = m.get(c) ?? []
      const layer_count = Object.values(ids).reduce((n, a) => n + (a.length ? 1 : 0), 0)
      return { item_id: it.iid, volume: it.volume, source: it.source, layer_count, ids }
    })
  writeJson(path.join(outDir, 'join.json'), { columns: joinColumns, rows })
  out(`  join ${rows.length} 行`)

  /* ---- 10. enums ---- */
  const enums = {}
  for (const layer of prof.layers) {
    const decl = layerDecls.get(layer.id)
    if (!decl?.fields) continue
    const fields = {}
    for (const [k, f] of Object.entries(decl.fields)) {
      if (f.type !== 'enum') continue
      const c = new Map()
      for (const r of raw.get(layer.id)) {
        const v = r[Object.entries(layer.map).find(([, src]) => src === f.key)?.[0] ?? f.key]
        if (v === undefined || v === null || v === '') continue
        bump(c, Array.isArray(v) ? v.join('、') : v)
      }
      fields[k] = tally(c)
    }
    if (Object.keys(fields).length) enums[layer.id] = fields
  }
  writeJson(path.join(outDir, 'enums.json'), enums)

  /* ---- 11. chapters（层级由 config.structure.tree 决定） ---- */
  const rowById = new Map(rows.map((r) => [r.item_id, r]))
  const leafNode = (it) => {
    const row = rowById.get(it.iid)
    return {
      key: it.iid,
      label: `${it.iid}　${excerpt(originalOf.get(it.iid) || '', 16)}`,
      count: row ? row.layer_count : 0,
    }
  }
  const chapters = volInfo.map((v) => {
    const list = byVolume.get(v.id).slice().sort(cmpItem)
    if (!useChapter) {
      return { key: v.id, label: v.label, count: list.length, children: list.map(leafNode) }
    }
    // 三层：卷 → 章 → 条目
    const byCh = new Map()
    for (const it of list) {
      const c = it.chapter ?? '__'
      if (!byCh.has(c)) byCh.set(c, [])
      byCh.get(c).push(it)
    }
    return {
      key: v.id,
      label: v.label,
      count: list.length,
      children: [...byCh.entries()]
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(([c, items]) => ({
          key: `${v.id}/${c}`,
          label: prof.chapterLabel ? prof.chapterLabel(c) : `第${c}章`,
          count: items.length,
          children: items.map(leafNode),
        })),
    }
  })
  writeJson(path.join(outDir, 'chapters.json'), chapters)

  /* ---- 12. meta ---- */
  const stats = { items: itemWritten, volumes: volumes.length, entities: Object.keys(entityTable).length, mentions: layerCounts.ent ?? 0 }
  for (const [k, v] of Object.entries(layerCounts)) if (k !== 'ent') stats[k] = v
  const meta = {
    bookId,
    title: prof.meta.title,
    subtitle: prof.meta.subtitle,
    genre: prof.meta.genre,
    stats,
    volumes: volInfo,
    vol_modes: prof.volumeModes ? prof.volumeModes(volInfo) : undefined,
    build: {
      span: spanStats,
      /** 真重叠（嵌套）被丢弃的数量；未定位的 L0 不计入 */
      span_dropped_overlap: spanOverlap,
      imputed,
      generated_at: new Date().toISOString(),
      generator: 'scripts/build_book_data.mjs',
    },
  }
  writeJson(path.join(outDir, 'meta.json'), meta, { pretty: true })

  /* ---- 13. 搜索索引 ---- */
  const docs = rows.map((r) => {
    const iid = r.item_id
    const own = {}
    const parts = []
    for (const layer of prof.layers) {
      const ids = r.ids[layer.id] || []
      if (!ids.length) continue
      const set = new Set(raw.get(layer.id).filter((x) => ids.includes(x[layer.idKey])).map((x) => x[layer.itemKey]))
      if (!set.has(iid)) continue
      for (const rec of raw.get(layer.id)) {
        if (!ids.includes(rec[layer.idKey]) || rec[layer.itemKey] !== iid) continue
        for (const [dst, src] of Object.entries(layer.map)) {
          const v = rec[src]
          if (typeof v === 'string' && v) parts.push(v)
          else if (v && typeof v === 'object' && v.text) parts.push(v.text)
        }
      }
    }
    return {
      iid,
      volume: r.volume,
      text: excerpt(originalOf.get(iid) || '', 160),
      translation: translationOf.get(iid) ? excerpt(translationOf.get(iid), 160) : undefined,
      fields: [...new Set(parts)].join(' ').slice(0, 1200),
    }
  })
  writeJson(path.join(outDir, 'search-index.json'), { bookId, count: docs.length, docs })
  out(`  搜索索引 ${docs.length} 条`)

  /* ---- 14. 复制配置 ---- */
  writeJson(path.join(outDir, 'book.config.json'), config, { pretty: true })

  note(report, `${bookId}：stats=${JSON.stringify(stats)}`)
  return { bookId, title: prof.meta.title, subtitle: prof.meta.subtitle, genre: prof.meta.genre, stats, layers: config.layers.length }
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

const args = process.argv.slice(2)
const report = newReport()
const summaries = []

const targets = args.includes('--all') ? ['shuidong-riji', 'xinguan-guifan'] : args.filter((a) => !a.startsWith('--'))
if (!targets.length) {
  out('用法：node scripts/build_book_data.mjs <profile> [--all]')
  process.exit(1)
}

for (const t of targets) {
  const s = await buildBook(t, report)
  if (s) summaries.push(s)
}

// 书架清单
if (summaries.length) {
  const idxPath = path.join(OUT_BASE, 'index.json')
  let manifest = { books: [] }
  if (fs.existsSync(idxPath)) manifest = readJson(idxPath)
  const map = new Map(manifest.books.map((b) => [b.bookId, b]))
  for (const s of summaries) {
    map.set(s.bookId, {
      bookId: s.bookId,
      title: s.title,
      subtitle: s.subtitle,
      genre: s.genre,
      layerCount: s.layers,
      stats: s.stats,
    })
  }
  const order = ['shuidong-riji', 'xinguan-guifan']
  manifest.books = [...map.values()]
    .filter((b) => b.bookId !== 'sample') // sample 是 P0 契约验证用的假书，不进书架
    .sort((a, b) => order.indexOf(a.bookId) - order.indexOf(b.bookId))
  writeJson(idxPath, manifest, { pretty: true })
  out(`\n  书架清单：${manifest.books.map((b) => b.title).join(' / ')}`)
}

/* 报告 */
out('\n─── 打包报告 ───')
for (const n of report.notes) out('  · ' + n)
for (const w of report.warnings) out('  ⚠ ' + w)
for (const e of report.errors) out('  ✗ ' + e)
out(
  `  合计：${report.errors.length} 错误 / ${report.warnings.length} 警告`,
)
process.exit(report.errors.length ? 1 : 0)
