/**
 * 新官专用层视图的纯逻辑层（P4）
 *
 * 与 layerBlocks.ts 同思路：把可单测的数据处理从 Vue 组件里抽出来。
 * 三块的共性是「一个记录要在多个维度/槽位间切分」，所以核心都是
 * **只输出实际有值的项**——空槽位不占位（沿用 P2 铁律：
 * 显示的节点数 === 实际有值的项数）。
 *
 * 数据形态要点（已核对 layers/*.json）：
 *  · rule.type 是 `禁止型+程序型` 这种 '+' 多标签组合，最多 4 基类；
 *    modality 是英文数组 ['prohibit','procedure']，与 type 一一对应但顺序可能不同。
 *  · rule 的 10 个语义槽位填充极不均匀：obligation 256/273、permission 仅 24/273，
 *    所以「槽位树」必须按有值过滤，否则大半是空的。
 *  · proc.steps 是真流程链：step.next 指向下一个 step_id 或字面量 'END'。
 *  · struct 字段**严格按维度划分**（文簿 98 条才有 purpose/keeper/entry/check），
 *    不能假设所有维度共享同一组字段。
 */

import { textOf } from './layerBlocks'
import type { LayerRecord } from './types'

/* ------------------------------------------------------------------ */
/* P4.1 rule 槽位树                                                    */
/* ------------------------------------------------------------------ */

/** 基类 → 固定配色（与 book.config.json 的 entityTypes 区分开，语义不同） */
export const MODALITY_COLORS: Record<string, string> = {
  义务型: '#185fa5',
  程序型: '#0f6e56',
  禁止型: '#a32d2d',
  处罚型: '#993c1d',
  允许型: '#2b4c7e',
  时限型: '#854f0b',
}

/** 英文 modality → 中文基类（数据里两者并存，UI 统一说中文） */
export const MODALITY_ZH: Record<string, string> = {
  obligation: '义务型',
  procedure: '程序型',
  prohibit: '禁止型',
  penalty: '处罚型',
  allow: '允许型',
  deadline: '时限型',
}

export interface RuleSlot {
  /** 槽位字段名，对应 LayerRecord 的键 */
  key: string
  label: string
  value: string
}

export interface RuleSlotNode {
  key: string
  label: string
  value: string
  children: RuleSlotNode[]
}

export interface RuleSlotTree {
  /** 规则根节点（含类型组合芯片与模态） */
  root: RuleSlotNode
  /** 全部已填充槽位（扁平，供计数校验） */
  filled: RuleSlot[]
  /** 模态基类（去重，中文） */
  modalities: string[]
  /** 模态配色，key = 中文基类 */
  colors: Record<string, string>
}

/** 槽位声明顺序 = 语义上的因果链：条件 → 主体 → 行为 → 约束/后果 */
const SLOT_ORDER: { key: string; label: string }[] = [
  { key: 'condition', label: '条件' },
  { key: 'subject', label: '主体' },
  { key: 'obligation', label: '义务' },
  { key: 'prohibition', label: '禁止' },
  { key: 'permission', label: '允许' },
  { key: 'object', label: '对象' },
  { key: 'purpose', label: '目的' },
  { key: 'deadline', label: '时限' },
  { key: 'penalty', label: '处罚' },
  { key: 'prohibited_effect', label: '禁忌' },
]

/**
 * 把一条规则解析成槽位树。
 *
 * 结构：根节点（= 该条规则）下挂「行为簇」与「约束簇」两支：
 *  · 行为簇 = 义务/禁止/允许（modality 决定显隐，一条规则可同时有义务+禁止）
 *  · 约束簇 = 对象/目的/时限/处罚/禁忌
 * 条件与主体作为根的直接子节点（它们是行为的前提，不属行为/约束任一支）。
 *
 * 只输出有值的槽位——空槽位不进树，避免树上大半是「—」。
 */
export function buildRuleSlots(rec: LayerRecord): RuleSlotTree {
  const modalities = readModalities(rec)

  const root: RuleSlotNode = {
    key: String(rec.id ?? ''),
    label: '规则',
    value: String(rec.type ?? ''),
    children: [],
  }

  const filled: RuleSlot[] = []
  const take = (key: string, label: string): string => {
    const v = textOf((rec as Record<string, unknown>)[key]).trim()
    if (v) filled.push({ key, label, value: v })
    return v
  }

  // 前提：条件 / 主体（直接挂根）
  const condition = take('condition', '条件')
  if (condition) root.children.push({ key: 'condition', label: '条件', value: condition, children: [] })

  const subject = take('subject', '主体')
  if (subject) root.children.push({ key: 'subject', label: '主体', value: subject, children: [] })

  // 行为簇：仅列出该规则实际具备的模态
  const behaviorKeys =
    modalities.includes('禁止型') || modalities.includes('允许型')
      ? ['obligation', 'prohibition', 'permission']
      : ['obligation']
  const behavior: RuleSlotNode[] = []
  for (const key of behaviorKeys) {
    const v = take(key, SLOT_ORDER.find((s) => s.key === key)!.label)
    if (v) behavior.push({ key, label: SLOT_ORDER.find((s) => s.key === key)!.label, value: v, children: [] })
  }
  if (behavior.length) {
    root.children.push({ key: 'behavior', label: '行为', value: '', children: behavior })
  }

  // 约束簇：对象 / 目的 / 时限 / 处罚 / 禁忌
  const constraint: RuleSlotNode[] = []
  for (const key of ['object', 'purpose', 'deadline', 'penalty', 'prohibited_effect']) {
    const label = SLOT_ORDER.find((s) => s.key === key)!.label
    const v = take(key, label)
    if (v) constraint.push({ key, label, value: v, children: [] })
  }
  if (constraint.length) {
    root.children.push({ key: 'constraint', label: '约束', value: '', children: constraint })
  }

  const colors: Record<string, string> = {}
  for (const m of modalities) colors[m] = MODALITY_COLORS[m] ?? '#888780'

  return { root, filled, modalities, colors }
}

/**
 * 读模态基类。
 * 优先用中文 `type`（'+' 分隔，权威）；为空时退回英文 modality 数组映射。
 * 顺序按 MODALITY_COLORS 的声明顺序稳定输出，避免 '义务型+禁止型' 与
 * '禁止型+义务型' 两条语义相同的规则显示成不同顺序（数据里两种都有）。
 */
export function readModalities(rec: LayerRecord): string[] {
  const order = Object.keys(MODALITY_COLORS)
  const zh = String(rec.type ?? '')
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
  if (zh.length) return dedupeSorted(zh, order)
  // 英文回退路径同样要排序：源数据的 modality 数组顺序随抽取顺序变
  //（有的记录是 ['prohibit','procedure']，有的反过来），不排序会导致
  // 同一条规则因数据顺序不同显示成不同的芯片次序。
  const en = rec.modality
  const list = Array.isArray(en) ? en.map((x) => MODALITY_ZH[String(x)] ?? String(x)) : []
  return dedupeSorted(list, order)
}

function dedupeSorted(values: string[], order: string[]): string[] {
  const uniq = [...new Set(values)]
  return uniq.sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    // 未在配色表里的值排到末尾，保持彼此相对次序
    if (ia < 0 || ib < 0) return ia < 0 ? (ib < 0 ? 0 : 1) : -1
    return ia - ib
  })
}

/* ------------------------------------------------------------------ */
/* P4.2 proc 流程图                                                     */
/* ------------------------------------------------------------------ */

export interface ProcStep {
  step_id: string
  state: string
  action: string
  agent: string
  condition: string
  next: string
}

export interface ProcNode {
  id: string
  label: string
  /** 0 = 起始步骤，1 = 中间步骤，2 = 收口（next 指向 END） */
  kind: number
  state: string
  agent: string
  condition: string
}

export interface ProcLink {
  source: string
  target: string
  label: string
}

export interface ProcGraph {
  nodes: ProcNode[]
  links: ProcLink[]
  /** 下一步 id 不在 steps 里、也不是 END 的悬空引用（数据不一致时兜底） */
  dangling: string[]
  /** 是否检出环（步骤链回指自身或互相成环） */
  cyclic: boolean
  /** states 数组（状态机标签，仅 96/274 条有值） */
  states: string[]
}

/** 规范 steps 为 ProcStep[]（容忍脏数据：缺字段补空串，非数组返回空） */
export function readSteps(rec: LayerRecord): ProcStep[] {
  const raw = (rec as Record<string, unknown>).steps
  if (!Array.isArray(raw)) return []
  return raw.map((s, i) => {
    const o = (s ?? {}) as Record<string, unknown>
    return {
      step_id: String(o.step_id ?? `${String(rec.id)}-s${i + 1}`),
      state: textOf(o.state),
      action: textOf(o.action),
      agent: textOf(o.agent),
      condition: textOf(o.condition),
      next: textOf(o.next),
    }
  })
}

/**
 * 由 steps 的 `next` 指针建有向图。
 *
 * 数据里 next 有三种取值：下一个 step_id / 字面量 'END' / 空。
 * 'END' 收成一个共享终点节点（而不是丢弃），这样「流程到哪结束」在图上可见——
 * 这是状态机视图比纯列表多出来的信息。
 */
export function buildProcGraph(rec: LayerRecord): ProcGraph {
  const steps = readSteps(rec)
  const byId = new Map(steps.map((s) => [s.step_id, s]))

  const nodes: ProcNode[] = steps.map((s, i) => ({
    id: s.step_id,
    label: s.state || s.action.slice(0, 8) || `步骤${i + 1}`,
    kind: s.next === 'END' ? 2 : i === 0 ? 0 : 1,
    state: s.state,
    agent: s.agent,
    condition: s.condition,
  }))

  const links: ProcLink[] = []
  const dangling: string[] = []
  let needsEnd = false

  for (const s of steps) {
    if (!s.next) continue
    if (s.next === 'END') {
      needsEnd = true
      continue
    }
    if (byId.has(s.next)) links.push({ source: s.step_id, target: s.next, label: '' })
    else dangling.push(s.next)
  }

  if (needsEnd) {
    nodes.push({ id: 'END', label: '结束', kind: 2, state: '', agent: '', condition: '' })
    for (const s of steps) {
      if (s.next === 'END') links.push({ source: s.step_id, target: 'END', label: '' })
    }
  }

  return { nodes, links, dangling, cyclic: detectCycle(steps), states: readStates(rec) }
}

/** readStates：状态机标签，仅部分记录有值 */
export function readStates(rec: LayerRecord): string[] {
  const raw = (rec as Record<string, unknown>).states
  if (!Array.isArray(raw)) return []
  return raw.map((x) => textOf(x)).filter(Boolean)
}

/** DFS 三色标记检出环（步骤链不应成环，数据异常时兜底告警） */
function detectCycle(steps: ProcStep[]): boolean {
  const byId = new Map(steps.map((s) => [s.step_id, s]))
  const color = new Map<string, 0 | 1 | 2>()
  const visit = (id: string): boolean => {
    const c = color.get(id) ?? 0
    if (c === 1) return true
    if (c === 2) return false
    color.set(id, 1)
    const next = byId.get(id)?.next
    if (next && next !== 'END' && byId.has(next) && visit(next)) {
      color.set(id, 2)
      return true
    }
    color.set(id, 2)
    return false
  }
  for (const s of steps) {
    if (visit(s.step_id)) return true
  }
  return false
}

/* ------------------------------------------------------------------ */
/* P4.3 struct 五维                                                     */
/* ------------------------------------------------------------------ */

/**
 * 维度 → 该维度下有意义的字段（顺序即展示顺序）。
 *
 * ⚠️ 字段**严格按维度划分**（已核对 677 条）：
 *   文簿 98 条 → purpose/keeper/entry/frequency/check/anti_fraud 全有
 *   时限 138 条 → 只有 frequency
 *   文书 87 条 → 只有 anti_fraud
 *   角色 157 / 防弊 197 → 只有 name + analysis
 * 所以不能配置一份通用字段表——那样四维里三维都是空行。
 */
export const DIM_FIELDS: Record<string, { key: string; label: string }[]> = {
  文簿: [
    { key: 'purpose', label: '用途' },
    { key: 'keeper', label: '保管' },
    { key: 'entry', label: '登记项' },
    { key: 'frequency', label: '频率' },
    { key: 'check', label: '查验' },
    { key: 'anti_fraud', label: '防弊要点' },
  ],
  时限: [{ key: 'frequency', label: '频率' }],
  文书: [{ key: 'anti_fraud', label: '防弊要点' }],
  角色: [],
  防弊: [],
}

export interface StructDimInfo {
  dimension: string
  count: number
  /** 该维度实际展示的字段（有值的才留） */
  fields: { key: string; label: string }[]
}

/**
 * 汇总全层各维度：计数 + 该维度下「至少一条记录有值」的字段集。
 * 用实测填充率反推字段集，而不是照抄 config——config 是声明，数据才是事实。
 */
export function summarizeDims(all: LayerRecord[]): StructDimInfo[] {
  const groups = new Map<string, LayerRecord[]>()
  for (const r of all) {
    const d = String(r.dimension ?? '')
    if (!d) continue
    if (!groups.has(d)) groups.set(d, [])
    groups.get(d)!.push(r)
  }
  const out: StructDimInfo[] = []
  for (const [dimension, recs] of groups) {
    const declared = DIM_FIELDS[dimension] ?? []
    const fields = declared.filter((f) => recs.some((r) => textOf(r[f.key]).trim()))
    out.push({ dimension, count: recs.length, fields })
  }
  return out.sort((a, b) => b.count - a.count)
}

/** 取单条记录在某维度下有值的行（表格渲染用） */
export function structRows(rec: LayerRecord): { key: string; label: string; value: string }[] {
  const declared = DIM_FIELDS[String(rec.dimension ?? '')] ?? []
  return declared
    .map((f) => ({ ...f, value: textOf((rec as Record<string, unknown>)[f.key]).trim() }))
    .filter((r) => r.value)
}

/** 同一规则派生出的全部五维记录（跨维联动：一条规则牵出哪些角色/时限/文簿） */
export function siblingsOfRule(all: LayerRecord[], ruleId: string): LayerRecord[] {
  if (!ruleId) return []
  return all.filter((r) => String(r.derived_rule ?? '') === ruleId)
}