/**
 * 数据包校验（P1.4 门禁）
 *
 *   node scripts/validate_pack.mjs            # 校验全部书
 *   node scripts/validate_pack.mjs shuidong-riji
 *
 * 校验项（对应 docs/data-contract.md 的 4 条硬约束）：
 *   C1 计数守恒    meta.stats 与层文件 / items / join / chapters 实际条数一致
 *   C2 span 断言   text.slice(s,e) === span.text，s=-1（未定位）单独统计
 *   C3 引用完整    join.ids / spans.eid / chapters.key 均能反查到目标
 *   C4 三件套      层记录 original / source 非空；confidence 为数或显式 null
 *   C5 主键唯一    items iid、层记录 id、实体 eid 均唯一
 *   C6 序号一致    item.ordinal === parseInt(iid 尾段)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ordinalOf, out, readJson } from './lib/util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'public/data')

const REQUIRED = ['book.config.json', 'meta.json', 'chapters.json', 'join.json', 'enums.json', 'entities.json', 'search-index.json']

let FAIL = 0
let WARN = 0
function fail(scope, msg) {
  FAIL++
  out(`  ✗ [${scope}] ${msg}`)
}
function warn(scope, msg) {
  WARN++
  out(`  ⚠ [${scope}] ${msg}`)
}
function ok(scope, msg) {
  out(`  ✓ [${scope}] ${msg}`)
}

function validate(bookId) {
  out(`\n─── 校验 ${bookId} ───`)
  const dir = path.join(DATA, bookId)

  /* 文件完整性 */
  for (const f of REQUIRED) {
    if (!fs.existsSync(path.join(dir, f))) fail(bookId, `缺少文件 ${f}`)
  }
  const config = readJson(path.join(dir, 'book.config.json'))
  const meta = readJson(path.join(dir, 'meta.json'))
  const join = readJson(path.join(dir, 'join.json'))
  const chapters = readJson(path.join(dir, 'chapters.json'))
  const entities = readJson(path.join(dir, 'entities.json'))
  const enums = readJson(path.join(dir, 'enums.json'))
  const search = readJson(path.join(dir, 'search-index.json'))
  ok(bookId, `必需文件齐全（${REQUIRED.length} 个）`)

  /* 层文件 */
  const layerFiles = new Map()
  for (const l of config.layers) {
    const p = path.join(dir, `layers/${l.id}.json`)
    if (l.reserved) {
      if (fs.existsSync(p)) warn(bookId, `预留层 ${l.id} 却有数据文件，应确认是否已转正式层`)
      continue
    }
    if (!fs.existsSync(p)) {
      fail(bookId, `层 ${l.id} 在配置中声明但缺少 layers/${l.id}.json`)
      continue
    }
    layerFiles.set(l.id, readJson(p))
  }

  /* C1 计数守恒 */
  let itemsTotal = 0
  const itemsByVol = new Map()
  const itemsDir = path.join(dir, 'items')
  for (const f of fs.readdirSync(itemsDir)) {
    const c = readJson(path.join(itemsDir, f))
    itemsByVol.set(c.volume, c.items)
    itemsTotal += c.items.length
    if (!fs.existsSync(path.join(itemsDir, f))) fail(bookId, `chunk ${f} 读取失败`)
  }
  if (meta.stats.items !== itemsTotal) fail(bookId, `C1 items 计数不符：meta ${meta.stats.items} ≠ 实际 ${itemsTotal}`)
  else ok(bookId, `C1 items 守恒 ${itemsTotal}`)

  if (meta.volumes.length !== itemsByVol.size) fail(bookId, `C1 卷数不符：meta ${meta.volumes.length} ≠ chunk ${itemsByVol.size}`)
  for (const v of meta.volumes) {
    const n = itemsByVol.get(v.id)?.length ?? -1
    if (n !== v.itemCount) fail(bookId, `C1 卷 ${v.id} 条数不符：meta ${v.itemCount} ≠ 实际 ${n}`)
  }
  for (const [lid, lf] of layerFiles) {
    if (lf.count !== lf.records.length) fail(bookId, `C1 ${lid} 层 count 字段不符：${lf.count} ≠ ${lf.records.length}`)
    const expect = lid === 'ent' ? meta.stats.mentions : meta.stats[lid]
    if (expect !== undefined && expect !== lf.records.length) {
      fail(bookId, `C1 ${lid} 层计数不符：meta ${expect} ≠ 实际 ${lf.records.length}`)
    }
  }
  if (join.rows.length !== itemsTotal) fail(bookId, `C1 join 行数 ${join.rows.length} ≠ items ${itemsTotal}`)
  else ok(bookId, `C1 join 守恒 ${join.rows.length}`)
  if (Object.keys(entities).length !== meta.stats.entities) {
    fail(bookId, `C1 实体主键不符：meta ${meta.stats.entities} ≠ 实际 ${Object.keys(entities).length}`)
  } else ok(bookId, `C1 实体主键守恒 ${Object.keys(entities).length}`)
  if (search.count !== search.docs.length) fail(bookId, `C1 搜索索引 count 不符`)

  /* C2 span 断言 */
  let spanTotal = 0,
    spanBad = 0,
    spanUnlocated = 0
  const badEx = []
  for (const [, items] of itemsByVol) {
    for (const it of items) {
      for (const sp of it.spans || []) {
        spanTotal++
        if (sp.s < 0) {
          spanUnlocated++
          continue
        }
        const actual = it.text.slice(sp.s, sp.e)
        if (actual !== sp.text) {
          spanBad++
          if (badEx.length < 5) badEx.push(`${it.iid}/${sp.id} 期望「${sp.text}」实际「${actual}」`)
        }
      }
    }
  }
  // 源数据未能定位的实体不进 items.spans（只着色已定位的），数量以 meta 为准
  const L0 = meta.build?.span?.L0 ?? 0
  if (spanUnlocated > 0) fail(bookId, `C2 items.spans 中出现 ${spanUnlocated} 条 s=-1 的记录，应在打包期剔除`)
  if (spanBad) {
    fail(bookId, `C2 span 偏移错位 ${spanBad}/${spanTotal}：${badEx.join('；')}`)
  } else {
    ok(bookId, `C2 span 断言通过 ${spanTotal} 条`)
  }
  if (L0 > 0) {
    const total = (meta.stats.mentions ?? 0) - (meta.build?.span_dropped_overlap ?? 0)
    if (spanTotal + L0 !== total) {
      fail(bookId, `C2 span 数量不守恒：已定位 ${spanTotal} + 未定位 ${L0} ≠ 应有 ${total}`)
    } else {
      warn(bookId, `C2 ${L0} 条实体源数据未能定位（不入 spans，正文不着色，但仍在层与 join 中可查）`)
    }
  }

  /* C3 引用完整 */
  const layerIdSets = new Map()
  for (const [lid, lf] of layerFiles) {
    const s = new Set()
    for (const r of lf.records) s.add(r.id)
    layerIdSets.set(lid, s)
  }
  let dangling = 0
  const dangEx = []
  for (const row of join.rows) {
    for (const [lid, ids] of Object.entries(row.ids)) {
      const set = layerIdSets.get(lid)
      if (!set) continue
      for (const id of ids) {
        if (!set.has(id)) {
          dangling++
          if (dangEx.length < 5) dangEx.push(`${row.item_id}/${lid}/${id}`)
        }
      }
    }
  }
  if (dangling) fail(bookId, `C3 join 悬空引用 ${dangling} 处：${dangEx.join('，')}`)
  else ok(bookId, `C3 join 引用完整`)

  let eidBad = 0
  for (const [, items] of itemsByVol) {
    for (const it of items)
      for (const sp of it.spans || []) if (sp.eid && !entities[sp.eid]) eidBad++
  }
  if (eidBad) fail(bookId, `C3 span.eid 指向不存在的实体 ${eidBad} 处`)
  else ok(bookId, `C3 span.eid 全部可反查`)

  // 实体 items 反查
  let entItemBad = 0
  const allIids = new Set(join.rows.map((r) => r.item_id))
  for (const e of Object.values(entities)) {
    for (const iid of e.items || []) if (!allIids.has(iid)) entItemBad++
  }
  if (entItemBad) fail(bookId, `C3 实体 items 反查到不存在的条目 ${entItemBad} 处`)

  // chapters 叶节点 key 必须是真实 iid
  let chBad = 0
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.children?.length) walk(n.children)
      else if (!allIids.has(n.key)) chBad++
    }
  }
  walk(chapters)
  if (chBad) fail(bookId, `C3 chapters 叶节点 key 非真实条目 ${chBad} 处`)
  else ok(bookId, `C3 chapters 叶节点均可反查`)

  /* C4 三件套 */
  let noOriginal = 0,
    noSource = 0,
    nullConf = 0
  for (const [lid, lf] of layerFiles) {
    for (const r of lf.records) {
      if (!r.original) noOriginal++
      if (!r.source) noSource++
      if (r.confidence === null || r.confidence === undefined) nullConf++
    }
  }
  if (noOriginal) fail(bookId, `C4 层记录缺 original ${noOriginal} 条`)
  if (noSource) fail(bookId, `C4 层记录缺 source ${noSource} 条`)
  if (nullConf) warn(bookId, `C4 ${nullConf} 条层记录 confidence 缺失（源数据未提供，已置 null）`)
  if (!noOriginal && !noSource) ok(bookId, `C4 三件套齐全（confidence 缺失 ${nullConf} 条已显式置 null）`)

  /* C5 主键唯一 */
  const dup = (arr) => {
    const s = new Set(),
      d = new Set()
    for (const x of arr) (s.has(x) ? d : s).add(x)
    return [...d]
  }
  const iids = join.rows.map((r) => r.item_id)
  const dupIid = dup(iids)
  if (dupIid.length) fail(bookId, `C5 条目 iid 重复 ${dupIid.length} 个：${dupIid.slice(0, 3).join(',')}`)
  else ok(bookId, `C5 条目 iid 唯一 ${iids.length}`)
  for (const [lid, lf] of layerFiles) {
    const d = dup(lf.records.map((r) => r.id))
    if (d.length) fail(bookId, `C5 层 ${lid} 记录 id 重复 ${d.length} 个：${d.slice(0, 3).join(',')}`)
  }

  /* C6 序号一致 */
  let ordBad = 0
  for (const [, items] of itemsByVol)
    for (const it of items) if (it.ordinal !== ordinalOf(it.iid)) ordBad++
  if (ordBad) fail(bookId, `C6 item.ordinal 与 iid 不一致 ${ordBad} 条`)
  else ok(bookId, `C6 序号口径一致`)

  /* enums 非空 */
  const enumLayers = Object.keys(enums)
  if (!enumLayers.length) warn(bookId, `enums.json 为空，筛选 chips 将无数据`)
  else ok(bookId, `enums 覆盖层：${enumLayers.join(',')}`)

  /* 汇总 */
  out(
    `  汇总：条目 ${itemsTotal} / 卷 ${meta.volumes.length} / 实体 ${Object.keys(entities).length} / ` +
      `span ${spanTotal}（未定位 ${spanUnlocated}）`,
  )
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
let bookIds = args
if (!bookIds.length) {
  const manifest = readJson(path.join(DATA, 'index.json'))
  bookIds = manifest.books.filter((b) => b.bookId !== 'sample').map((b) => b.bookId)
}
for (const b of bookIds) validate(b)

out(`\n═══ 校验结果：${FAIL} 错误 / ${WARN} 警告 ═══`)
process.exit(FAIL ? 1 : 0)
