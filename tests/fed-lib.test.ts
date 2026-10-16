/**
 * 服务端派生逻辑单测（联邦库 SQLite → 前端数据契约）
 *
 * 锁死三条契约（全部来自走查 2026-10-13 的真实故障）：
 *   1. lean 层记录剔除 original/norm——norm 实为 original 副本（C 类数据问题），
 *      不剔会让 kzz 瘦身 ent 层膨胀到 19.5MB，EntityDetail mention 加载被拖死；
 *   2. entIndex 不再逐条查询原文（52 秒 → 0.24 秒），span 仍满足 slice(s,e)===text；
 *   3. entities 归集 items——前端「出现 N 次 / M 条」曾恒显示 0 条。
 */
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { deriveEntIndex, deriveEntities, deriveLayer } from '../server/fed-lib.mjs'

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE books (book_id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE records (
      book_id TEXT, layer_key TEXT, local_id TEXT, item_id TEXT, volume TEXT, payload TEXT
    );
    CREATE TABLE nodes (
      uid TEXT, book_id TEXT, layer_key TEXT, local_id TEXT, label TEXT, type TEXT, payload TEXT
    );
  `)
  return db
}

const ORIGINAL = '洪武三年五月初一日，命礼部颁行科举成式，始定子、午、卯、酉年乡试。'

function entPayload(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ent_id: 'ENT-0001',
    text: '礼部',
    normalized: '礼部',
    type: 'institution',
    surfaces: ['礼部', '禮部'],
    confidence: 0.9,
    original: ORIGINAL,
    norm: ORIGINAL, // C 类数据问题：norm 实为 original 副本
    start: ORIGINAL.indexOf('礼部'),
    end: ORIGINAL.indexOf('礼部') + 2,
    ...over,
  })
}

function seed(db: DatabaseSync): void {
  const p1 = entPayload()
  const p2 = entPayload({
    text: '乡试',
    surfaces: ['乡试'],
    // 无 start/end：应回落 indexOf 定位
    start: undefined,
    end: undefined,
  })
  db.prepare(
    "INSERT INTO records (book_id, layer_key, local_id, item_id, volume, payload) VALUES (?,?,?,?,?,?)",
  ).run('kzz', 'ent', '01:ENT-0001', '01-005', '01', p1)
  db.prepare(
    "INSERT INTO records (book_id, layer_key, local_id, item_id, volume, payload) VALUES (?,?,?,?,?,?)",
  ).run('kzz', 'ent', '02:ENT-0001', '02-003', '02', p2)
  db.prepare(
    'INSERT INTO nodes (uid, book_id, layer_key, local_id, label, type, payload) VALUES (?,?,?,?,?,?,?)',
  ).run('kzz:01:ENT-0001', 'kzz', 'ent', '01:ENT-0001', '礼部', 'institution', p1)
  db.prepare(
    'INSERT INTO nodes (uid, book_id, layer_key, local_id, label, type, payload) VALUES (?,?,?,?,?,?,?)',
  ).run('kzz:02:ENT-0001', 'kzz', 'ent', '02:ENT-0001', '乡试', 'institution', p2)
}

/* ---- 1. lean 剔除 original/norm；full 保留 ---- */
{
  const db = freshDb()
  seed(db)
  const lean = deriveLayer(db, 'kzz', 'ent')
  assert.equal(lean.count, 2)
  for (const r of lean.records) {
    assert.equal(r.original, '', 'lean 必须剔除 original')
    assert.ok(!('norm' in r), 'lean 必须剔除 norm（否则 ent 层 19.5MB 拖死详情页）')
    assert.equal(r.source, '联邦库')
    assert.equal(r.confidence, 0.9)
  }
  const full = deriveLayer(db, 'kzz', 'ent', { full: true })
  assert.equal(full.records[0].original, ORIGINAL, 'full=1 保留 original')
  assert.ok('norm' in full.records[0], 'full=1 保留 norm 原件')
  // 单条目反查同样带回书证（详情场景）
  const byItem = deriveLayer(db, 'kzz', 'ent', { itemId: '01-005' })
  assert.equal(byItem.records.length, 1)
  assert.equal(byItem.records[0].original, ORIGINAL)
  console.log('  ✓ lean 剔除 original/norm，full 与 itemId 反查保留书证')
}

/* ---- 2. entities 归集 items（出现 N 次 / M 条不再恒 0） ---- */
{
  const db = freshDb()
  seed(db)
  const table = deriveEntities(db, 'kzz')
  const e = table['ENT-0001']
  assert.ok(e, 'ENT-0001 应聚合出一个主键')
  assert.equal(e.count, 2, '两个卷各一次出现')
  assert.deepEqual(e.items, ['01-005', '02-003'], 'items 从 ent 记录归集并排序')
  assert.equal(e.normalized, '礼部')
  assert.equal(e.type, 'institution')
  assert.deepEqual(e.surfaces, ['礼部', '禮部', '乡试'], 'surfaces 跨行合并去重')
  console.log('  ✓ entities 归集 items/surfaces/count')
}

/* ---- 3. entIndex：span 不变量 + eid 透出（无逐条查询回归） ---- */
{
  const db = freshDb()
  seed(db)
  const idx = deriveEntIndex(db, 'kzz')
  assert.equal(idx.count, 2)
  const withSpan = idx.records.find((r) => r.item_id === '01-005')!
  assert.equal(withSpan.eid, 'ENT-0001')
  assert.equal(withSpan.original, '', '索引不回传书证全文')
  assert.ok(withSpan.s != null && withSpan.e != null, '应带 span')
  assert.equal(
    ORIGINAL.slice(withSpan.s!, withSpan.e!),
    '礼部',
    'span 不变量：original.slice(s,e) === text',
  )
  const fallback = idx.records.find((r) => r.item_id === '02-003')!
  assert.equal(ORIGINAL.slice(fallback.s!, fallback.e!), '乡试', '缺 start/end 回落 indexOf')
  console.log('  ✓ entIndex span 不变量与 indexOf 回落')
}

/* ---- 4. 分页：offset/limit 取页、count 恒为总数；field/value 筛选下推 ---- */
{
  const db = freshDb()
  seed(db)
  for (let i = 0; i < 5; i++) {
    db.prepare(
      'INSERT INTO records (book_id, layer_key, local_id, item_id, volume, payload) VALUES (?,?,?,?,?,?)',
    ).run('kzz', 'ent', `03:ENT-${100 + i}`, `03-00${i}`, '03', entPayload({ type: i % 2 ? 'person' : 'institution' }))
  }
  const p1 = deriveLayer(db, 'kzz', 'ent', { limit: 3, offset: 0 })
  assert.equal(p1.count, 7, 'count 是全层总数，不是页内条数')
  assert.equal(p1.records.length, 3)
  assert.deepEqual(p1.records.map((r) => r.id), ['01:ENT-0001', '02:ENT-0001', '03:ENT-100'])
  const p3 = deriveLayer(db, 'kzz', 'ent', { limit: 3, offset: 6 })
  assert.equal(p3.count, 7)
  assert.equal(p3.records.length, 1, '末页只剩 1 条')
  assert.equal(p3.offset, 6)
  // 页间不重不漏：三页并起来 = 全量
  const all = [0, 3, 6].flatMap((o) => deriveLayer(db, 'kzz', 'ent', { limit: 3, offset: o }).records)
  assert.deepEqual(all.map((r) => r.id).sort(), deriveLayer(db, 'kzz', 'ent').records.map((r) => r.id).sort())
  // 筛选下推：person 只有 2 条，count 同步为筛选口径总数
  const person = deriveLayer(db, 'kzz', 'ent', { field: 'type', value: 'person', limit: 10 })
  assert.equal(person.count, 2)
  assert.ok(person.records.every((r) => r.type === 'person'))
  // 无 limit 时保持旧形态（不带 offset/limit 字段）
  assert.ok(!('offset' in deriveLayer(db, 'kzz', 'ent')), '不传 limit 响应形态与旧版一致')
  console.log('  ✓ 分页 offset/limit/count 与筛选下推')
}
