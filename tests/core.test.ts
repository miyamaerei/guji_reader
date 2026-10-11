/**
 * 核心语义单测（TreeNav 的「前缀匹配 + 子孙累计」锁死在这里）
 *
 * 旧版最痛的 bug 是「筛选计数 ≠ 结果数」：点一个写着 12 的分类，出来 7 条。
 * 根因是计数预先算好后不再随筛选更新。以下断言把
 *
 *     节点上显示的数字 === 点它实际会看到的条数
 *
 * 变成可回归的硬约束。改 tree.ts / toc.ts 任意逻辑，这里必须仍然全绿。
 *
 * 运行：npm test（scripts/test.mjs 用 esbuild 现编现跑，不引测试框架）
 */
import assert from 'node:assert/strict'
import {
  buildHierarchy,
  buildTagHierarchy,
  collectLeaves,
  countByPrefix,
  countOf,
  filterTree,
  findPath,
  flattenTree,
  valueHasTag,
  type TreeNode,
} from '../src/core/tree'
import { buildIidVolumeMap, buildTocTree } from '../src/core/toc'
import { excerpt, searchDocs, segmentSnippet, tokenize } from '../src/core/search'
import { detailHref } from '../src/core/routes'
import { buildApptTimeline, buildRelSubgraph, rosterRows, trlPair, textOf } from '../src/core/layerBlocks'
import {
  buildProcGraph,
  buildRuleSlots,
  readModalities,
  siblingsOfRule,
  structRows,
  summarizeDims,
} from '../src/core/xinguanBlocks'
import { ENT_INDEX_FIELDS, entIndexSufficient, toEntIndexRecord } from '../src/core/entIndex'
import { averageHeight, computeWindow, indexAtOffset } from '../src/core/virtual'
import { displayValue, labelOf } from '../src/core/format'
import { deriveVolProfile } from '../src/core/vol'
import type { ChapterNode, LayerRecord, SearchDoc } from '../src/core/types'

let passed = 0
let failed = 0

function test(name: string, fn: () => void): void {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    console.log(`  ✗ ${name}`)
    console.log(`      ${e instanceof Error ? e.message : String(e)}`)
  }
}

function group(name: string): void {
  console.log(`\n${name}`)
}

/* ------------------------------------------------------------------ */
/* 计数：子孙累计                                                      */
/* ------------------------------------------------------------------ */

const leaf = (key: string, n = 1): TreeNode => ({ key, label: key, count: n })

const tree: TreeNode[] = [
  {
    key: 'v1',
    label: '卷一',
    children: [
      { key: 'v1#0', label: '第 1–2 条', children: [leaf('01-001'), leaf('01-002')] },
      { key: 'v1#1', label: '第 3–3 条', children: [leaf('01-003')] },
    ],
  },
  { key: 'v2', label: '卷二', children: [leaf('02-001')] },
]

group('countOf · 子孙累计')

test('叶子用自身 count', () => {
  assert.equal(countOf(leaf('x', 3)), 3)
})

test('非叶子忽略自身 count，取子节点之和', () => {
  // 故意给父节点写错 count，验证 countOf 不采信它
  const bad: TreeNode = { key: 'p', label: 'p', count: 99, children: [leaf('a'), leaf('b')] }
  assert.equal(countOf(bad), 2)
})

test('多层累计', () => {
  assert.equal(countOf(tree[0]), 3)
  assert.equal(countOf(tree[1]), 1)
})

/* ------------------------------------------------------------------ */
/* 过滤：计数 === 结果数                                               */
/* ------------------------------------------------------------------ */

group('filterTree · 筛选计数必须等于结果数')

test('自身命中的节点保留整棵子树，count 重新累计', () => {
  const out = filterTree(tree, '卷一')
  assert.equal(out.length, 1)
  assert.equal(out[0].count, 3)
  assert.equal(countOf(out[0]), 3)
})

test('仅子孙命中时，父节点 count = 命中子孙之和（不是原值）', () => {
  const out = filterTree(tree, '01-003')
  // 卷一(count 原 3) → 只剩 第3-3条(count 1)
  assert.equal(out.length, 1)
  assert.equal(out[0].key, 'v1')
  assert.equal(out[0].count, 1, '父节点计数应收缩为命中条数')
  assert.equal(countOf(out[0]), 1)
})

test('计数守恒：过滤后所有可见叶子数 === 根节点 count 之和', () => {
  const q = '01-00'
  const out = filterTree(tree, q)
  const leaves = out.flatMap((n) => collectLeaves(n))
  const declared = out.reduce((s, n) => s + countOf(n), 0)
  assert.equal(leaves.length, declared, `声明 ${declared} 条，实际可见 ${leaves.length} 条`)
})

test('无命中返回空', () => {
  assert.deepEqual(filterTree(tree, '不存在'), [])
})

test('空查询返回原树（不重算、不改结构）', () => {
  assert.equal(filterTree(tree, ''), tree)
})

/* ------------------------------------------------------------------ */
/* 扁平化                                                              */
/* ------------------------------------------------------------------ */

group('flattenTree')

test('未展开时只出顶层', () => {
  const rows = flattenTree(tree, new Set())
  assert.deepEqual(
    rows.map((r) => r.node.key),
    ['v1', 'v2'],
  )
})

test('展开后按深度递增输出，depth 正确', () => {
  const rows = flattenTree(tree, new Set(['v1', 'v1#0']))
  assert.deepEqual(
    rows.map((r) => `${r.node.key}@${r.depth}`),
    ['v1@0', 'v1#0@1', '01-001@2', '01-002@2', 'v1#1@1', 'v2@0'],
  )
})

test('搜索态自动展开命中路径（不用手动点开三层）', () => {
  const rows = flattenTree(tree, new Set(), '01-002')
  const keys = rows.map((r) => r.node.key)
  assert.ok(keys.includes('01-002'), '命中项应可见')
  assert.equal(rows.find((r) => r.node.key === '01-002')?.depth, 2)
})

test('path 是祖先链且不含自身', () => {
  const rows = flattenTree(tree, new Set(['v1', 'v1#0']))
  const row = rows.find((r) => r.node.key === '01-001')
  assert.deepEqual(row?.path, ['v1', 'v1#0'])
})

test('maxDepth 限制展开深度', () => {
  const rows = flattenTree(tree, new Set(['v1', 'v1#0']), '', 1)
  assert.ok(!rows.some((r) => r.depth === 2))
})

/* ------------------------------------------------------------------ */
/* 层级枚举：前缀匹配 === 子孙累计                                     */
/* ------------------------------------------------------------------ */

group('buildHierarchy · 前缀匹配计数与子孙累计交叉验证')

const enums = [
  { value: '礼制>朝仪', count: 4 },
  { value: '礼制>祭祀', count: 3 },
  { value: '礼制', count: 2 },
  { value: '官制>铨选', count: 5 },
  { value: '军政', count: 1 },
]

/**
 * 用 payload.value（真实筛选值）而不是 key 建映射。
 * 「（本类）」子节点与父节点同值，父节点先访问到，因此只记首次出现。
 */
function valueCountMap(nodes: TreeNode[]): Map<string, number> {
  const flat = new Map<string, number>()
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      const v = String(n.payload?.value ?? n.key)
      if (!flat.has(v)) flat.set(v, n.count ?? 0)
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return flat
}

test('父节点 count === 前缀匹配总数', () => {
  const nodes = buildHierarchy(enums)
  const values = enums.map((e) => e.value)
  const prefixes = ['礼制', '官制', '军政', '礼制>朝仪', '礼制>祭祀', '官制>铨选']
  const byPrefix = countByPrefix(enums, prefixes)
  const flat = valueCountMap(nodes)
  assert.ok(values.length > 0)

  for (const p of prefixes) {
    assert.equal(
      flat.get(p),
      byPrefix.get(p),
      `节点 ${p} 显示 ${flat.get(p)}，前缀匹配实际 ${byPrefix.get(p)}`,
    )
  }
})

test('混合值域：自身值做成「（本类）」子节点，不漏计', () => {
  const nodes = buildHierarchy(enums)
  const lz = nodes.find((n) => String(n.payload?.value) === '礼制')
  assert.ok(lz?.children?.some((c) => c.label === '（本类）' && c.count === 2))
})

test('礼制 = 朝仪4 + 祭祀3 + 自身2 = 9', () => {
  const nodes = buildHierarchy(enums)
  const lz = nodes.find((n) => n.key === '礼制')
  assert.equal(lz?.count, 9)
})

test('根节点计数守恒：顶层和 === 全部枚举值之和', () => {
  const nodes = buildHierarchy(enums)
  const total = nodes.reduce((s, n) => s + countOf(n), 0)
  assert.equal(total, enums.reduce((s, e) => s + e.count, 0))
})

test('等值自身也计入前缀（礼制 不只是 礼制>*）', () => {
  const m = countByPrefix(
    [
      { value: '礼制', count: 1 },
      { value: '礼制>朝仪', count: 1 },
    ],
    ['礼制'],
  )
  assert.equal(m.get('礼制'), 2)
})

test('不会把「礼制仪注」误判为「礼制」的后代', () => {
  const m = countByPrefix([{ value: '礼制仪注', count: 7 }], ['礼制'])
  assert.equal(m.get('礼制'), 0)
})

/* ------------------------------------------------------------------ */
/* 多标签归属树（新官规则层）                                          */
/* ------------------------------------------------------------------ */

group('buildTagHierarchy · 组合值同时归入多个基类')

const rules = [
  { value: '程序型+禁止型', count: 49 },
  { value: '程序型', count: 41 },
  { value: '禁止型+程序型', count: 6 },
  { value: '义务型', count: 48 },
]

test('父节点计数 = 含该标签的全部组合之和（不漏「禁止型+程序型」）', () => {
  const { nodes } = buildTagHierarchy(rules)
  const byLabel = new Map(nodes.map((n) => [n.label, countOf(n)]))
  assert.equal(byLabel.get('程序型'), 49 + 41 + 6, '前缀树会漏掉「禁止型+程序型」')
  assert.equal(byLabel.get('禁止型'), 49 + 6)
  assert.equal(byLabel.get('义务型'), 48)
})

test('各基类之和大于总数，差额由 overlap 显式给出', () => {
  const { nodes, total, overlap } = buildTagHierarchy(rules)
  assert.equal(total, 49 + 41 + 6 + 48)
  assert.equal(
    nodes.reduce((s, n) => s + countOf(n), 0),
    total + overlap,
    'overlap 必须等于「各基类之和 − 总数」',
  )
  assert.ok(overlap > 0, '有组合值时 overlap 必然为正')
})

test('计数与结果数同源：valueHasTag 判定出的条数 === 节点显示的数', () => {
  const { nodes } = buildTagHierarchy(rules)
  for (const n of nodes) {
    const actual = rules
      .filter((r) => valueHasTag(r.value, n.label))
      .reduce((s, r) => s + r.count, 0)
    assert.equal(countOf(n), actual, `基类「${n.label}」显示 ${countOf(n)}，实际筛出 ${actual}`)
  }
})

test('叶子 key 全局唯一（同一组合挂多个基类也不会撞）', () => {
  const { nodes } = buildTagHierarchy(rules)
  const keys = nodes.flatMap((n) => (n.children ?? []).map((c) => c.key))
  assert.equal(new Set(keys).size, keys.length)
})

test('valueHasTag 不做子串误判', () => {
  assert.equal(valueHasTag('禁止型+程序型', '程序型'), true)
  assert.equal(valueHasTag('禁止型+程序型', '禁止型'), true)
  assert.equal(valueHasTag('禁止型', '程序型'), false)
  assert.equal(valueHasTag('程序型', '程序'), false, '不做前缀匹配')
})

/* ------------------------------------------------------------------ */
/* 目录树构建                                                          */
/* ------------------------------------------------------------------ */

group('buildTocTree')

const chapters2: ChapterNode[] = [
  {
    key: '01',
    label: '卷一',
    count: 5,
    children: [
      { key: '01-001', label: '01-001', count: 3 },
      { key: '01-002', label: '01-002', count: 1 },
      { key: '01-003', label: '01-003', count: 0 },
    ],
  },
  { key: '02', label: '卷二', count: 1, children: [{ key: '02-001', label: '02-001', count: 2 }] },
]

test('两层书：卷 → 组 → 条；组大小生效', () => {
  const { nodes } = buildTocTree(chapters2, { tree: ['volume', 'item'], groupSize: 2 })
  assert.equal(nodes[0].children?.length, 2, '5 条按 2 分组 → 2 组（2+1）… 实际 3 条 → 2 组')
  assert.equal(nodes[0].children?.[0].children?.length, 2)
  assert.equal(nodes[0].children?.[1].children?.length, 1)
})

test('分组序号按容器内下标，不按 iid 数值（卷二序号从 1 重新起算）', () => {
  const { nodes, index } = buildTocTree(chapters2, { tree: ['volume', 'item'], groupSize: 2 })
  assert.equal(index.groupOf.get('01-003'), 1)
  assert.equal(index.groupOf.get('02-001'), 0, '02-001 是卷二的第 1 条，应回到组 0')
  assert.equal(index.volumeOf.get('02-001'), '02')
  assert.equal(nodes.length, 2)
})

test('三层书：卷 → 章 → 组 → 条', () => {
  const chapters3: ChapterNode[] = [
    {
      key: '01',
      label: '卷上',
      count: 3,
      children: [
        {
          key: '01/01',
          label: '体立',
          count: 3,
          children: [
            { key: '01-001', label: '01-001', count: 1 },
            { key: '01-002', label: '01-002', count: 1 },
            { key: '01-003', label: '01-003', count: 1 },
          ],
        },
      ],
    },
  ]
  const { nodes, index } = buildTocTree(chapters3, {
    tree: ['volume', 'chapter', 'item'],
    groupSize: 2,
  })
  const chap = nodes[0].children?.[0]
  assert.equal(chap?.key, '01/01')
  assert.equal(chap?.label, '体立', '章名必须取 chapters.json 的中文 label，不能从 key 切出章号')
  assert.equal(chap?.children?.length, 2, '3 条按 2 分组 → 2 组')
  assert.equal(index.containerOf.get('01-003'), '01/01')
  assert.equal(index.groupOf.get('01-003'), 1)
})

test('条目数守恒：树里叶子数 === chapters 里条目数', () => {
  const { nodes } = buildTocTree(chapters2, { tree: ['volume', 'item'], groupSize: 2 })
  const leaves = nodes.flatMap((n) => collectLeaves(n))
  assert.equal(leaves.length, 4)
})

test('tagOf 注入层命中徽标', () => {
  const { nodes } = buildTocTree(chapters2, {
    tree: ['volume', 'item'],
    groupSize: 10,
    tagOf: (iid) => (iid === '01-001' ? [{ text: 'EN' }] : []),
  })
  const l = collectLeaves(nodes[0]).find((n) => n.iid === '01-001')
  assert.deepEqual(l?.tags, [{ text: 'EN' }])
})

/* ------------------------------------------------------------------ */
/* iid → 卷：两书前缀语义不同，只能靠树解析                            */
/* ------------------------------------------------------------------ */

group('buildIidVolumeMap')

const xgChapters: ChapterNode[] = [
  { key: '00', label: '卷首', count: 1, children: [{ key: '00-001', label: '00-001', count: 0 }] },
  { key: '01', label: '卷上', count: 1, children: [{ key: '01-001', label: '01-001', count: 5 }] },
  {
    key: '02',
    label: '卷下',
    count: 2,
    children: [
      { key: '02/02', label: '牧民备用', count: 1, children: [{ key: '02-001', label: '02-001', count: 1 }] },
      { key: '02/11', label: '词讼第九', count: 1, children: [{ key: '11-001', label: '11-001', count: 1 }] },
    ],
  },
]

test('新官：卷下的 11-001 归卷 02，不是「卷 11」', () => {
  const m = buildIidVolumeMap(xgChapters)
  assert.equal(m.get('11-001'), '02')
  assert.equal(m.get('02-001'), '02')
  assert.equal(m.get('01-001'), '01')
  assert.equal(m.get('00-001'), '00')
  // 用前缀猜会得到 '11'，而 items 目录下没有 11.json
  assert.equal(m.size, 4)
})

test('水东：前缀即卷号，映射结果与前缀一致', () => {
  const sd: ChapterNode[] = [
    { key: '01', label: '卷一', count: 2, children: [{ key: '01-001', label: '01-001', count: 1 }, { key: '01-002', label: '01-002', count: 1 }] },
    { key: '38', label: '卷三十八', count: 1, children: [{ key: '38-001', label: '38-001', count: 1 }] },
  ]
  const m = buildIidVolumeMap(sd)
  assert.equal(m.get('01-002'), '01')
  assert.equal(m.get('38-001'), '38')
})

test('映射覆盖全部叶子，无遗漏', () => {
  const m = buildIidVolumeMap(xgChapters)
  const countLeaves = (ns: ChapterNode[]): number =>
    ns.reduce((s, n) => s + (n.children?.length ? countLeaves(n.children) : 1), 0)
  assert.equal(m.size, countLeaves(xgChapters))
})

/* ------------------------------------------------------------------ */
/* findPath                                                            */
/* ------------------------------------------------------------------ */

group('findPath')

test('找到返回祖先链', () => {
  assert.deepEqual(findPath(tree, '01-002'), ['v1', 'v1#0'])
})

test('找不到返回 null', () => {
  assert.equal(findPath(tree, '99-999'), null)
})

/* ------------------------------------------------------------------ */
/* 检索                                                                */
/* ------------------------------------------------------------------ */

group('search')

const docs: SearchDoc[] = [
  { iid: '01-001', volume: '01', text: '礼部尚书胡濙奏事', translation: '礼部尚书胡濙上奏', fields: '胡濙 礼部尚书' },
  { iid: '01-002', volume: '01', text: '翰林名人送行文', translation: '翰林文人赠序', fields: '' },
  { iid: '02-001', volume: '02', text: '礼部祠祭司', translation: '', fields: '礼部' },
]

test('tokenize 按空白拆词', () => {
  assert.deepEqual(tokenize('  礼部   胡濙 '), ['礼部', '胡濙'])
  assert.deepEqual(tokenize(''), [])
})

test('多词 AND：缺一词即丢弃', () => {
  const r = searchDocs(docs, '礼部 胡濙')
  assert.deepEqual(
    r.map((h) => h.iid),
    ['01-001'],
  )
})

test('单词命中原文/译文/层字段任一即算', () => {
  assert.deepEqual(
    searchDocs(docs, '翰林').map((h) => h.iid),
    ['01-002'],
  )
  assert.deepEqual(
    searchDocs(docs, '祠祭').map((h) => h.iid),
    ['02-001'],
  )
})

test('where 标注命中来源', () => {
  const r = searchDocs(docs, '礼部')
  const one = r.find((h) => h.iid === '01-001')
  assert.ok(one?.where.includes('text'))
  assert.ok(one?.where.includes('translation'))
})

test('按分数降序', () => {
  const r = searchDocs(docs, '礼部')
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].score >= r[i].score)
})

test('片段高亮位置可还原（切段后拼回原片段）', () => {
  const r = searchDocs(docs, '胡濙')
  const segs = segmentSnippet(r[0].snippet, r[0].ranges)
  assert.equal(segs.map((s) => s.text).join(''), r[0].snippet)
  assert.ok(segs.some((s) => s.hit && s.text === '胡濙'))
})

test('limit 生效', () => {
  assert.equal(searchDocs(docs, '礼部', 1).length, 1)
})

test('空查询返回空（不做全量返回）', () => {
  assert.equal(searchDocs(docs, '   ').length, 0)
})

test('命中词跨截取窗口边界时，高亮不吞入末尾省略号', () => {
  // 复现 01-015 的「礼…」bug：第二个 礼部 恰好落在窗口末端，旧逻辑 range 越界到省略号
  const long =
    '驾将旋礼部累有会奏言迎复事上多以敌情多诈为言将抵居庸一奏始得防羣臣同礼部……'
  const { snippet, ranges } = excerpt(long, '礼部', 30)
  const segs = segmentSnippet(snippet, ranges)
  const hitText = segs.filter((s) => s.hit).map((s) => s.text)
  // 每一个命中段都必须是完整的「礼部」，绝不允许出现「礼…」
  for (const t of hitText) assert.equal(t, '礼部', `高亮段必须是完整词，实际得到 ${JSON.stringify(t)}`)
  assert.ok(!segs.some((s) => s.hit && s.text.includes('…')), '命中段不得包含省略号')
})

/* ------------------------------------------------------------------ */
/* 路由辅助（P2.9：修复「整页」链接缺 book 段）                          */

test('detailHref 必带 book 段，结构与路由 /detail/:book/:kind/:id 对齐', () => {
  assert.equal(detailHref('shuidong-riji', 'item', '01-001'), '#/detail/shuidong-riji/item/01-001')
  assert.equal(detailHref('xinguan-guifan', 'entity', 'ENT-001'), '#/detail/xinguan-guifan/entity/ENT-001')
  assert.equal(detailHref('xinguan-guifan', 'rule', 'R-0003'), '#/detail/xinguan-guifan/rule/R-0003')
})

test('detailHref 缺失 bookId 时退回书架，不产生段数错位的路径', () => {
  // 旧 bug：拼成 /detail/item/01-001（少 book 段）→ 命中 catch-all 跳首页
  assert.equal(detailHref('', 'item', '01-001'), '#/')
})


/* ------------------------------------------------------------------ */
/* P3 专用块纯逻辑（聚合 / 建图 / 取表 / 对照）                          */

function rec(partial: Record<string, unknown>): LayerRecord {
  return { id: 'X', item_id: '00-000', original: '', source: '', confidence: null, ...partial } as LayerRecord
}

test('buildApptTimeline 按人物聚合且按条目时序排序', () => {
  const all = [
    rec({ id: 'A1', item_id: '03-002', person: { text: '叶盛' }, office: { text: '侍郎' }, status: '现任' }),
    rec({ id: 'A2', item_id: '01-001', person: { text: '叶盛' }, office: { text: '编修' }, status: '升迁' }),
    rec({ id: 'A3', item_id: '02-005', person: { text: '王翱' }, office: { text: '御史' }, status: '现任' }),
  ]
  const { segments, people } = buildApptTimeline(all, '叶盛')
  assert.equal(segments.length, 2)
  // 时序：01-001 (ord 1) 应排在 03-002 (ord 2) 之前
  assert.equal(segments[0].item_id, '01-001')
  assert.equal(segments[1].item_id, '03-002')
  // 多段任职人物清单：叶盛 2 段入选，王翱 1 段不入选
  assert.equal(people.length, 1)
  assert.equal(people[0].name, '叶盛')
})

test('buildRelSubgraph 单向带 directed、按关系类型着色、BFS 收邻域', () => {
  const all = [
    rec({ person_a: { text: '甲' }, person_b: { text: '乙' }, type: '同僚', direction: '双向' }),
    rec({ person_a: { text: '乙' }, person_b: { text: '丙' }, type: '师生', direction: '单向' }),
    rec({ person_a: { text: '丁' }, person_b: { text: '戊' }, type: '同乡', direction: '双向' }),
  ]
  const g = buildRelSubgraph(all, ['甲'], 2)
  // 2 跳：甲-乙-丙 连通，丁-戊 孤立在外
  assert.deepEqual(g.nodes.map((n) => n.name).sort(), ['丙', '乙', '甲'])
  assert.equal(g.categories.includes('师生'), true)
  assert.equal(g.categories.includes('同僚'), true)
  assert.equal(g.links.some((l) => l.directed), true)
  // 组件「显示全部」用全部人物名作种子：应覆盖所有 5 个节点
  const full = buildRelSubgraph(all, ['甲', '乙', '丙', '丁', '戊'], 99)
  assert.equal(full.nodes.length, 5)
})

test('rosterRows 空 entries 返回空、有数据返回四元组', () => {
  assert.equal(rosterRows(rec({ entries: [] })).length, 0)
  const rows = rosterRows(
    rec({
      entries: [
        { seq: 1, person: '陈镒', courtesy_name: '未明', hometown: '未明', office: '左都御史' },
        { seq: 2, person: '王翱', courtesy_name: '未明', hometown: '未明', office: '左都御史' },
      ],
    }),
  )
  assert.equal(rows.length, 2)
  assert.equal(rows[0].person, '陈镒')
  assert.equal(rows[1].office, '左都御史')
})

test('trlPair 抽取原文/译文/风格/注释', () => {
  const p = trlPair(
    rec({ original: '原文X', translation: { text: '译文X' }, style: '直译', note: '注X' }),
  )
  assert.equal(p.original, '原文X')
  assert.equal(p.translation, '译文X')
  assert.equal(p.style, '直译')
  assert.equal(p.note, '注X')
})

test('deriveVolProfile 无 vol_modes 时退化为单一全卷模式', () => {
  const vp = deriveVolProfile({
    bookId: 'shuidong-riji',
    title: '水东日记',
    stats: {},
    volumes: [
      { id: '01', label: '卷一', itemCount: 17 },
      { id: '02', label: '卷二', itemCount: 15 },
    ],
  })
  assert.equal(vp.modes.length, 1)
  assert.equal(vp.modes[0].label, '全卷')
  assert.equal(vp.modes[0].volumeCount, 2)
  assert.equal(vp.byVolume['01'], 'all')
  assert.equal(vp.byVolume['02'], 'all')
})

test('deriveVolProfile 有真实 vol_modes 时原样采用', () => {
  const real = {
    modes: [{ key: 'zong', label: '总论', volumeCount: 3, itemCount: 40 }],
    byVolume: { '01': 'zong', '02': 'zong', '03': 'zong' },
  }
  const vp = deriveVolProfile({
    bookId: 'sd',
    title: 'sd',
    stats: {},
    volumes: [{ id: '01', label: 'a', itemCount: 1 }],
    vol_modes: real,
  })
  assert.equal(vp.modes[0].key, 'zong')
  assert.equal(vp.byVolume['01'], 'zong')
})

test('textOf 兼容 ent-ref 嵌套对象与纯字符串', () => {
  assert.equal(textOf({ text: '礼部' }), '礼部')
  assert.equal(textOf('鸿胪寺'), '鸿胪寺')
  assert.equal(textOf(null), '')
})


/* ------------------------------------------------------------------ */
/* P4 新官专用层                                                       */
/* ------------------------------------------------------------------ */

test('buildRuleSlots 只输出有值槽位，且行为簇按模态显隐', () => {
  // 数据实样 XGF-R-001：禁止型单模态，禁止有值、义务/允许为空
  const onlyProhibit = buildRuleSlots({
    type: '禁止型',
    modality: ['prohibit'],
    condition: '新官未任之先',
    subject: '官府（知县）',
    prohibition: '安歇官民之家或公馆庙庵等处',
    prohibited_effect: '不惹嫌疑',
  } as never)
  const keys1 = onlyProhibit.filled.map((s) => s.key)
  assert.deepEqual(keys1, ['condition', 'subject', 'prohibition', 'prohibited_effect'])
  // 禁止型不该挂空的「义务」节点
  const behavior = onlyProhibit.root.children.find((n) => n.key === 'behavior')
  assert.ok(behavior)
  assert.deepEqual(behavior!.children.map((c) => c.key), ['prohibition'])

  // 多模态 XGF-R-002 形态：程序型 + 义务/对象/目的（无禁止模态，行为簇只挂义务）
  const proc1 = buildRuleSlots({
    type: '程序型',
    condition: '到任行礼之前',
    obligation: '预先分付礼房吏',
    object: '礼房吏、礼生、生员',
    purpose: '到任行礼不致差错',
  } as never)
  // condition / obligation / object / purpose —— 程序型不含「禁止」，故无 prohibition 槽
  assert.equal(proc1.filled.length, 4)
  assert.deepEqual(proc1.root.children.map((n) => n.key), ['condition', 'behavior', 'constraint'])
  const bh = proc1.root.children.find((n) => n.key === 'behavior')!
  assert.deepEqual(bh.children.map((c) => c.key), ['obligation'])

  // 多模态形态：禁止型+义务型 应同时挂 prohibition 与 obligation
  const multi = buildRuleSlots({
    type: '义务型+禁止型',
    obligation: '上报',
    prohibition: '不得隐匿',
  } as never)
  const mb = multi.root.children.find((n) => n.key === 'behavior')!
  assert.deepEqual(mb.children.map((c) => c.key), ['obligation', 'prohibition'])
})

test('readModalities 对「义务型+禁止型」与「禁止型+义务型」输出同序（数据里两种都有）', () => {
  const a = readModalities({ type: '义务型+禁止型' } as never)
  const b = readModalities({ type: '禁止型+义务型' } as never)
  assert.deepEqual(a, b)
  assert.deepEqual(a, ['义务型', '禁止型'])
  // type 为空时退回英文 modality 映射，顺序同样按 MODALITY_COLORS 声明序（程序在禁止前）
  assert.deepEqual(readModalities({ modality: ['prohibit', 'procedure'] } as never), ['程序型', '禁止型'])
})

test('buildProcGraph 按 next 建有向边，END 收成共享终点', () => {
  // 数据实样 XGF-P-002：两步，第二步 next=END
  const g = buildProcGraph({
    steps: [
      { step_id: '01-002-s1', state: '唤礼', action: '分付礼房吏', agent: '礼房', next: '01-002-s2' },
      { step_id: '01-002-s2', state: '手本', action: '开写仪注手本', agent: '礼生', next: 'END' },
    ],
    states: ['三日之后'],
  } as never)
  // 2 步 + 1 个 END 终点
  assert.equal(g.nodes.length, 3)
  assert.deepEqual(g.links, [
    { source: '01-002-s1', target: '01-002-s2', label: '' },
    { source: '01-002-s2', target: 'END', label: '' },
  ])
  assert.equal(g.nodes[0].kind, 0, '首步 kind=0')
  assert.equal(g.nodes[1].kind, 2, 'next=END 的步骤 kind=2')
  assert.equal(g.cyclic, false)
  assert.deepEqual(g.states, ['三日之后'])
})

test('buildProcGraph 检出悬空 next 与步骤环（数据异常兜底，不静默丢边）', () => {
  const dangling = buildProcGraph({
    steps: [{ step_id: 'a', state: 's', action: 'x', agent: '', next: 'ghost' }],
  } as never)
  assert.deepEqual(dangling.dangling, ['ghost'])
  assert.equal(dangling.links.length, 0)

  const cyclic = buildProcGraph({
    steps: [
      { step_id: 'a', state: 's1', action: 'x', agent: '', next: 'b' },
      { step_id: 'b', state: 's2', action: 'y', agent: '', next: 'a' },
    ],
  } as never)
  assert.equal(cyclic.cyclic, true)
})

test('summarizeDims 按实测填充率决定各维字段集，角色/防弊无附加字段', () => {
  const all = [
    { dimension: '文簿', purpose: 'p', keeper: 'k', entry: 'e', frequency: '每日', check: 'c', anti_fraud: 'a' },
    { dimension: '时限', frequency: '一次性' },
    { dimension: '文书', anti_fraud: '防弊' },
    { dimension: '角色', name: '新官' },
    { dimension: '防弊', name: '防弊点' },
  ] as never[]
  const dims = summarizeDims(all)
  // 按 count 降序；此处每维各 1 条，故顺序仅验证集合
  assert.equal(dims.length, 5)
  const led = dims.find((d) => d.dimension === '文簿')!
  assert.equal(led.fields.length, 6, '文簿六字段全有值')
  assert.equal(dims.find((d) => d.dimension === '时限')!.fields.length, 1)
  assert.equal(dims.find((d) => d.dimension === '角色')!.fields.length, 0)
})

test('structRows 只返回该维度有值的行（铁律：显示行数 === 有值字段数）', () => {
  const rows = structRows({
    dimension: '时限',
    name: '未任之先',
    frequency: '一次性',
    purpose: '不该出现（时限维度无 purpose）',
  } as never)
  assert.deepEqual(rows.map((r) => r.key), ['frequency'])
})

test('siblingsOfRule 按 derived_rule 聚合跨维记录', () => {
  const all = [
    { id: 'ACT-001', dimension: '角色', derived_rule: 'XGF-R-001' },
    { id: 'TME-001', dimension: '时限', derived_rule: 'XGF-R-001' },
    { id: 'LGR-001', dimension: '文簿', derived_rule: 'XGF-R-002' },
  ] as never[]
  assert.equal(siblingsOfRule(all, 'XGF-R-001').length, 2)
  assert.equal(siblingsOfRule(all, '').length, 0)
})


/* ------------------------------------------------------------------ */
/* P5.1 ent 层瘦身                                                     */
/* ------------------------------------------------------------------ */

test('ent 精简索引剔除书证全文，列表字段齐备', () => {
  const rec = {
    id: 'M00001',
    eid: 'ENT-001',
    text: '礼部',
    normalized: '礼部',
    type: 'official',
    item_id: '01-001',
    volume: '01',
    original: '「原始书证全文，这段很占体积」',
    source: '01_卷一.xhtml#条1',
    confidence: 0.9,
    start: 3,
    end: 5,
  } as never
  const slim = toEntIndexRecord(rec)
  // 列表要用的字段都在
  for (const k of ['id', 'eid', 'text', 'normalized', 'type', 'item_id', 'volume']) {
    assert.ok(slim[k] !== undefined, `索引缺字段 ${k}`)
  }
  // 占体积的书证与溯源字段不在索引里
  for (const k of ['original', 'source', 'confidence', 'start', 'end']) {
    assert.equal(slim[k], undefined, `索引不该带 ${k}`)
  }
})

test('entIndexSufficient 自检：索引缺字段时立刻暴露而非静默渲染空证据', () => {
  const idx = { layer: 'ent', count: 2, full: false, records: [] }
  // 列表所需字段 —— 索引够用
  assert.equal(entIndexSufficient(['text', 'type', 'eid'], idx), true)
  // 详情所需字段 —— 索引不够，必须回全量
  assert.equal(entIndexSufficient(['text', 'original'], idx), false)
  // full=true 时一律够用（旧数据包回落全量）
  assert.equal(entIndexSufficient(['original'], { ...idx, full: true }), true)
})


/* ------------------------------------------------------------------ */
/* P5.2 虚拟滚动                                                       */
/* ------------------------------------------------------------------ */

test('computeWindow 只渲染视口内行 + overscan，DOM 规模与总量无关', () => {
  // 2253 行、每行 32px，视口 640px（20 行）
  const base = { viewportH: 640, total: 2253, heights: new Map<number, number>(), avgH: 32 }
  const top = computeWindow({ ...base, scrollTop: 0 })
  assert.equal(top.start, 0)
  // 20 行可见 + 尾部 overscan 6
  assert.equal(top.end, 26)
  // 关键性质：滚到中段，渲染行数不随位置增长
  const mid = computeWindow({ ...base, scrollTop: 30000 })
  assert.ok(mid.end - mid.start <= 40, `中段窗口 ${mid.end - mid.start} 行应远小于总量`)
  const bottom = computeWindow({ ...base, scrollTop: 999999 })
  assert.equal(bottom.end, 2253, '触底必须覆盖到最后一行')
  assert.ok(bottom.start < bottom.end)
  // 总高度恒等于 行数 × 行高
  assert.equal(top.totalHeight, 2253 * 32)
})

test('computeWindow 支持不等行高（实测缓存优先于均值）', () => {
  // 第 0 行 200px（长条目），其余 20px；视口 300px
  const heights = new Map<number, number>([[0, 200]])
  const w = computeWindow({ scrollTop: 0, viewportH: 300, total: 100, heights, avgH: 20 })
  // 第一行就占满 200px，再加 5 行 20px 覆盖 300px → end 至少 6
  assert.ok(w.end >= 6, `end=${w.end} 应覆盖视口`)
  // 总高度应按实测修正：200 + 99×20
  assert.equal(w.totalHeight, 200 + 99 * 20)
  // 滚过第 0 行后窗口应右移；注意 start 含 overscan 回退，
  // 所以 scrollTop=200（第 0 行恰好覆盖 0~200）时 start 仍可为 0，
  // 要滚到 overscan 之外才观察得到右移。
  const w2 = computeWindow({ scrollTop: 400, viewportH: 300, total: 100, heights, avgH: 20 })
  assert.ok(w2.start > 0, `滚远后 start=${w2.start} 应 >0`)
  // 起点不会超过「真实起点 + overscan」：真实起点≈11，overscan 6
  assert.ok(w2.start <= 20, `start=${w2.start} 不应跑太远`)
})

test('computeWindow 空列表与单行不崩', () => {
  const empty = computeWindow({ scrollTop: 0, viewportH: 600, total: 0, heights: new Map(), avgH: 32 })
  assert.deepEqual(empty, { start: 0, end: 0, totalHeight: 0 })
  const one = computeWindow({ scrollTop: 500, viewportH: 600, total: 1, heights: new Map(), avgH: 32 })
  assert.equal(one.start, 0)
  assert.equal(one.end, 1)
})

test('indexAtOffset 定位到覆盖该偏移的行', () => {
  const base = { viewportH: 640, total: 1000, heights: new Map<number, number>(), avgH: 32 }
  assert.equal(indexAtOffset({ ...base, scrollTop: 0 }, 0), 0)
  assert.equal(indexAtOffset({ ...base, scrollTop: 0 }, 100), 3)
  // 超出末尾时钳到最后一行
  assert.equal(indexAtOffset({ ...base, scrollTop: 0 }, 999999), 999)
})

test('averageHeight 无测量时回落默认，有测量取均值', () => {
  assert.equal(averageHeight(new Map()), 32)
  assert.equal(averageHeight(new Map([[0, 40], [1, 60]])), 50)
})

test('对象数组取可读标签，不吐 [object Object]（proc.steps 曾如此）', () => {
  // 与 FieldValue 用同一个 displayValue，单测真的跑在渲染所用的函数上
  assert.equal(
    displayValue([
      { state: '择日', action: '暂为择日到任' },
      { state: '手本', action: '开写' },
    ]),
    '择日 → 手本',
  )
  // 无 label 类字段时退回第一个字符串字段
  assert.equal(displayValue([{ foo: '甲' }, { foo: '乙' }]), '甲 → 乙')
  // 纯字符串数组仍用「、」
  assert.equal(displayValue(['每日', '每月2次']), '每日、每月2次')
  assert.equal(displayValue([]), '')
  // labelOf 单项
  assert.equal(labelOf({ agent: '新官' }), '新官')
  assert.equal(labelOf(null), '')
  assert.equal(labelOf(7), '7')
})


console.log(`\n${failed === 0 ? '✅' : '❌'} 通过 ${passed} 项，失败 ${failed} 项`)
if (failed > 0) process.exit(1)
