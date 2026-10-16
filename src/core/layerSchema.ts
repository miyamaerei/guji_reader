/**
 * 要素（层）schema 解析（P0.3）
 *
 * 三级启用判定（设计文档 §5.2）：
 *  public   —— 公共要素，所有书必配：条目底座 / 实体（事件为柔性层，见下）
 *  declared —— book.config.json 声明即启用（水东 appt/reg/lit/rel/nam/trl；新官 rule/proc/struct）
 *  reserved —— 视图组件已注册、数据缺失，列表显示「待补建」（新官 TRL/APPT；水东 proc v2；
 *              联邦 8 书中无事件层的政书类——吕公实政录 ent/rule/struct、政学录 evt/reg/rule/struct）
 *
 * 前端不写死要素清单：导航 tab、筛选维度、详情块全部由此解析生成。
 */
import type {
  BookConfig,
  DetailBlock,
  FieldDecl,
  LayerDecl,
  LayerId,
  ListViewMode,
} from './types'

/**
 * 公共必配层（数据层）：所有书必须真正建层。
 * 早期归入的 event 已降级为柔性层（政书类文本如《吕公实政录》《政学录》无事件层是正常交付事实）。
 */
export const PUBLIC_LAYER_IDS: LayerId[] = ['ent']

/**
 * 柔性公共层：有数据则正常启用；数据缺失时不报错，
 * 由 UI 合成 reserved 占位（列表显示「待补建」），避免「配置写错 → 页面白屏」的强校验误伤合法书。
 */
export const FLEXIBLE_PUBLIC_LAYER_IDS: LayerId[] = ['event']

/** 内建 tab：不属于任何「层文件」，但参与导航 */
export const BUILTIN_TAB_IDS = ['item', 'join'] as const

export type LayerStatus = 'public' | 'declared' | 'reserved'

export interface ResolvedLayer {
  decl: LayerDecl
  status: LayerStatus
  /** 列表形态，缺省按 reserved/declared 推导 */
  listView: ListViewMode
  detailBlocks: DetailBlock[]
}

export interface NavTab {
  id: string
  label: string
  /** 内建 tab（item/join）没有对应层文件 */
  builtin: boolean
  layerId?: LayerId
  status: LayerStatus | 'builtin'
  /** reserved 层显示「待补建」 */
  pending: boolean
}

const DEFAULT_LIST_VIEW: Record<LayerId, ListViewMode> = {
  ent: 'table',
  event: 'card',
  rule: 'tree',
  proc: 'card',
  struct: 'card',
  appt: 'table',
  reg: 'card',
  lit: 'card',
  rel: 'card',
  nam: 'card',
  trl: 'card',
}

const DEFAULT_DETAIL_BLOCKS: Record<LayerId, DetailBlock[]> = {
  ent: ['table'],
  event: ['table'],
  rule: ['slots', 'table'],
  proc: ['flow', 'table'],
  struct: ['tabs', 'table'],
  appt: ['table', 'timeline'],
  reg: ['table'],
  lit: ['table'],
  rel: ['graph', 'table'],
  nam: ['roster', 'table'],
  trl: ['parallel', 'note'],
}

function defaultLabel(id: LayerId): string {
  const map: Record<string, string> = {
    item: '条目',
    ent: '实体',
    event: '事件',
    join: '跨层索引',
    rule: '规则',
    proc: '流程',
    struct: '结构化五维',
    appt: '职官任职',
    reg: '典章制度',
    lit: '文献资产',
    rel: '人物关系',
    nam: '名录谱牒',
    trl: '古今翻译',
  }
  return map[id] ?? id
}

export function isPublicLayer(id: LayerId): boolean {
  return PUBLIC_LAYER_IDS.includes(id)
}

/**
 * 在**副本**上补齐柔性公共层的 reserved 占位声明（不改原 config）。
 * 例如《吕公实政录》layers 为 ent/rule/struct，合成 `{ id: 'event', reserved: true }`，
 * 使导航出现「事件（待补建）」tab 而非缺失。
 */
export function withFlexibleLayers(config: BookConfig): BookConfig {
  const missing = FLEXIBLE_PUBLIC_LAYER_IDS.filter(
    (fid) => !config.layers.some((l) => l.id === fid),
  )
  if (missing.length === 0) return config
  return {
    ...config,
    layers: [
      ...config.layers,
      ...missing.map((fid) => ({
        id: fid,
        label: defaultLabel(fid),
        required: false,
        reserved: true,
      })),
    ],
  }
}

export function resolveLayer(config: BookConfig, id: LayerId): ResolvedLayer | null {
  const cfg = withFlexibleLayers(config)
  const decl = cfg.layers.find((l) => l.id === id)
  if (!decl) return null
  const status: LayerStatus = isPublicLayer(id)
    ? 'public'
    : decl.reserved
      ? 'reserved'
      : 'declared'
  return {
    decl,
    status,
    listView: decl.views?.list ?? DEFAULT_LIST_VIEW[id] ?? 'card',
    detailBlocks: decl.views?.detail ?? DEFAULT_DETAIL_BLOCKS[id] ?? ['table'],
  }
}

export function resolveLayers(config: BookConfig): ResolvedLayer[] {
  return withFlexibleLayers(config).layers
    .map((l) => resolveLayer(config, l.id))
    .filter((l): l is ResolvedLayer => l !== null)
}

/** 导航 tab：内建（条目 / 跨层索引）+ 声明层，全部由配置推导 */
export function navTabs(config: BookConfig): NavTab[] {
  const tabs: NavTab[] = [
    { id: 'item', label: defaultLabel('item'), builtin: true, status: 'builtin', pending: false },
  ]
  for (const l of resolveLayers(config)) {
    tabs.push({
      id: l.decl.id,
      label: l.decl.label || defaultLabel(l.decl.id),
      builtin: false,
      layerId: l.decl.id,
      status: l.status,
      pending: l.status === 'reserved',
    })
  }
  tabs.push({
    id: 'join',
    label: defaultLabel('join'),
    builtin: true,
    status: 'builtin',
    pending: false,
  })
  return tabs
}

export function getField(decl: LayerDecl, key: string): FieldDecl | undefined {
  return decl.fields?.[key]
}

/** 层的筛选依据字段：优先配置，其次 groupBy，最后 undefined（不筛选） */
export function filterField(decl: LayerDecl): string | undefined {
  return decl.filterBy ?? decl.groupBy
}

export function entityTypeColor(config: BookConfig, type: string): string | undefined {
  return config.colors.entityTypes?.[type]
}

/** 目录条目行尾的层命中 tag，由 join 动态生成，不写死 R/P/E/S/T */
export function layerTags(config: BookConfig): { id: LayerId; tag: string; label: string }[] {
  return resolveLayers(config)
    .filter((l) => l.status !== 'reserved')
    .map((l) => ({
      id: l.decl.id,
      tag: l.decl.tag ?? l.decl.id.slice(0, 2).toUpperCase(),
      label: l.decl.label || defaultLabel(l.decl.id),
    }))
}

/**
 * 配置校验：返回错误列表，空数组表示通过。
 * 打包器与运行时共用，避免「配置写错 → 页面白屏」。
 */
export function validateBookConfig(config: BookConfig): string[] {
  const errors: string[] = []
  if (!config.bookId) errors.push('缺少 bookId')
  if (!config.title) errors.push('缺少 title')
  if (!config.structure?.tree?.length) errors.push('structure.tree 不能为空')
  if (!config.layers?.length) errors.push('layers 不能为空')

  const seen = new Set<LayerId>()
  for (const l of config.layers ?? []) {
    if (!l.id) {
      errors.push('存在无 id 的层声明')
      continue
    }
    if (seen.has(l.id)) errors.push(`层 id 重复：${l.id}`)
    seen.add(l.id)
    if (l.fields) {
      for (const [key, f] of Object.entries(l.fields)) {
        if (f.key && f.key !== key) errors.push(`${l.id}.${key} 的 key 与字段名不一致`)
        if (f.type === 'enum' && (!f.enum || f.enum.length === 0)) {
          errors.push(`${l.id}.${key} 声明为 enum 但值域为空`)
        }
      }
    }
  }
  for (const id of PUBLIC_LAYER_IDS) {
    if (!seen.has(id)) errors.push(`公共必配层缺失：${id}`)
  }
  if (config.join?.primary && !seen.has(config.join.primary)) {
    errors.push(`join.primary 指向未声明的层：${config.join.primary}`)
  }
  return errors
}
