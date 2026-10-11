/**
 * 专用层视图的纯逻辑层（P3）
 *
 * 把「聚合 / 建图 / 取表」等可单测的部分从 Vue 组件里抽出来，
 * 组件只负责把结果喂给 ECharts 或渲染表格。这样逻辑改动有回归保护，
 * 也避免组件里塞满数据处理。
 *
 * 字段形态约定（见 docs/data-contract.md §4 LayerRecord）：
 *  - ent-ref 字段是 `{ text, <layer>_ent_ids: [] }` 嵌套对象；
 *    个别来源可能是纯字符串，统一用 `textOf` 兜底。
 *  - `item_id` 形如 `01-003`，数值化口径 `parseInt(iid.slice(3))`。
 */

import type { LayerRecord } from '@/core/types'

/* ------------------------------------------------------------------ */
/* 通用取值                                                            */
/* ------------------------------------------------------------------ */

/** ent-ref 嵌套对象或纯字符串 → 展示文本 */
export function textOf(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.text === 'string') return o.text
  }
  return String(v)
}

/** `01-003` → 3（用于任职/关系按时序排序） */
export function ordinalOf(iid: string): number {
  const n = parseInt(iid.slice(3), 10)
  return Number.isFinite(n) ? n : 0
}

/* ------------------------------------------------------------------ */
/* P3.1 appt 任职时间线                                                */
/* ------------------------------------------------------------------ */

export interface ApptSegment {
  id: string
  item_id: string
  office: string
  institution: string
  when: string
  status: string
  ordinal: number
}

/**
 * 按人物文本聚合该人的全部任职，按时序（item 序号）排列。
 * 返回该人多段任职片段，以及在全层中「有多段任职」的人物清单（供快速切换）。
 */
export function buildApptTimeline(
  all: LayerRecord[],
  personText: string,
): { segments: ApptSegment[]; people: { name: string; count: number }[] } {
  const personCounts = new Map<string, number>()
  for (const r of all) {
    const p = textOf(r.person)
    if (!p) continue
    personCounts.set(p, (personCounts.get(p) ?? 0) + 1)
  }

  const segments: ApptSegment[] = []
  for (const r of all) {
    if (textOf(r.person) !== personText) continue
    segments.push({
      id: String(r.id),
      item_id: String(r.item_id),
      office: textOf(r.office),
      institution: textOf(r.institution),
      when: String(r.when ?? ''),
      status: String(r.status ?? ''),
      ordinal: ordinalOf(String(r.item_id)),
    })
  }
  segments.sort((a, b) => a.ordinal - b.ordinal)

  const people = [...personCounts.entries()]
    .filter(([, c]) => c >= 2)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  return { segments, people }
}

/* ------------------------------------------------------------------ */
/* P3.4 rel 关系图                                                    */
/* ------------------------------------------------------------------ */

export interface RelNode {
  name: string
  category: number
}
export interface RelLink {
  source: string
  target: string
  type: string
  directed: boolean
}
export interface RelGraph {
  nodes: RelNode[]
  links: RelLink[]
  categories: string[]
}

/**
 * 以 seed 人物集合为起点做 BFS（无向遍历找邻域，保留有向信息用于渲染），
 * 截到 maxHops 跳。返回子图节点 / 边 / 关系类型（作为 ECharts category 着色）。
 */
export function buildRelSubgraph(
  all: LayerRecord[],
  seeds: string[],
  maxHops = 2,
): RelGraph {
  const edges: { a: string; b: string; type: string; directed: boolean }[] = []
  for (const r of all) {
    const a = textOf(r.person_a)
    const b = textOf(r.person_b)
    if (!a || !b || a === b) continue
    edges.push({
      a,
      b,
      type: String(r.type ?? '其他'),
      directed: String(r.direction) === '单向',
    })
  }

  // 邻接表（去重边）
  const adj = new Map<string, Set<string>>()
  const addAdj = (x: string, y: string) => {
    if (!adj.has(x)) adj.set(x, new Set())
    adj.get(x)!.add(y)
  }
  for (const e of edges) {
    addAdj(e.a, e.b)
    addAdj(e.b, e.a)
  }

  // BFS 收集 maxHops 内的节点
  const frontier = new Set(seeds.filter(Boolean))
  const kept = new Set(frontier)
  let cur = frontier
  for (let hop = 0; hop < maxHops; hop++) {
    const next = new Set<string>()
    for (const n of cur) {
      for (const m of adj.get(n) ?? []) {
        if (!kept.has(m)) {
          kept.add(m)
          next.add(m)
        }
      }
    }
    cur = next
    if (!cur.size) break
  }

  const keptEdges = edges.filter((e) => kept.has(e.a) && kept.has(e.b))
  const categories = [...new Set(keptEdges.map((e) => e.type))].sort()

  // 节点类别：取第一条关联边的类型
  const nodeCat = new Map<string, number>()
  for (const e of keptEdges) {
    if (!nodeCat.has(e.a)) nodeCat.set(e.a, Math.max(0, categories.indexOf(e.type)))
    if (!nodeCat.has(e.b)) nodeCat.set(e.b, Math.max(0, categories.indexOf(e.type)))
  }

  const nodes: RelNode[] = [...kept].map((name) => ({
    name,
    category: nodeCat.get(name) ?? -1,
  }))
  const links: RelLink[] = keptEdges.map((e) => ({
    source: e.a,
    target: e.b,
    type: e.type,
    directed: e.directed,
  }))

  return { nodes, links, categories }
}

/* ------------------------------------------------------------------ */
/* P3.5 nam 题名表                                                    */
/* ------------------------------------------------------------------ */

export interface RosterRow {
  seq: number | string
  person: string
  courtesy: string
  hometown: string
  office: string
}

/** 把 record.entries 规范成四元组行；无 entries 时返回空数组（组件改显 evidence）。 */
export function rosterRows(rec: LayerRecord): RosterRow[] {
  const raw = (rec as Record<string, unknown>).entries
  if (!Array.isArray(raw)) return []
  return raw.map((e) => {
    const o = (e ?? {}) as Record<string, unknown>
    return {
      seq: (o.seq as number | string) ?? '',
      person: textOf(o.person),
      courtesy: textOf(o.courtesy_name),
      hometown: textOf(o.hometown),
      office: textOf(o.office),
    }
  })
}

/* ------------------------------------------------------------------ */
/* P3.6 trl 对照                                                      */
/* ------------------------------------------------------------------ */

export type ParallelLayout = 'horizontal' | 'vertical'

export interface TrlPair {
  original: string
  translation: string
  style: string
  note: string
}

export function trlPair(rec: LayerRecord): TrlPair {
  return {
    original: String((rec as Record<string, unknown>).original ?? ''),
    translation: textOf((rec as Record<string, unknown>).translation),
    style: String((rec as Record<string, unknown>).style ?? ''),
    note: String((rec as Record<string, unknown>).note ?? ''),
  }
}
