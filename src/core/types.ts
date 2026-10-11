/**
 * 数据契约类型定义（P0.2 冻结）
 *
 * 硬约束（来自设计文档 §2.1 / §2.3）：
 *  1. iid = `章号-序号`（如 `01-001`），全书唯一、可排序，是所有层对齐的锚点。
 *  2. 任何层记录必须携带「书证三件套」：original / source / confidence。
 *  3. 实体 span 用原文偏移 s/e 定位，渲染时着色与点击绑定；
 *     打包期必须断言 `text.slice(s, e) === span.text`，否则正文着色全错。
 *  4. 前端不写死任何书的字段：导航 / 筛选 / 详情块全部由 book.config.json 推导。
 */

/* ------------------------------------------------------------------ */
/* 书证三件套                                                          */
/* ------------------------------------------------------------------ */

export interface Evidence {
  /** 出处原文片段 */
  original: string
  /** 来源说明（如「原文片段」「记译文本」） */
  source: string
  /**
   * 置信度 0–1。源数据未提供时为 null（打包期统计在 meta.build.imputed），
   * 不臆造数值——UI 显示为「—」。
   */
  confidence: number | null
}

/* ------------------------------------------------------------------ */
/* book.config.json                                                    */
/* ------------------------------------------------------------------ */

export type LayerId = string

export type FieldType =
  | 'text'
  | 'number'
  | 'enum'
  | 'ent-ref'
  | 'item-ref'
  | 'original'
  | 'link'

export interface FieldDecl {
  key: string
  label: string
  type: FieldType
  /** type === 'enum' 时的值域 */
  enum?: string[]
  /** type === 'ent-ref' | 'item-ref' 时指向的层 id */
  refLayer?: LayerId
  /** 详情块中的呈现方式；hide 表示列表不展示 */
  view?: 'chip' | 'block' | 'hide'
}

export type ListViewMode = 'table' | 'card' | 'tree'
export type DetailBlock =
  | 'table'
  | 'timeline'
  | 'graph'
  | 'flow'
  | 'roster'
  | 'parallel'
  | 'note'
  | 'slots'
  | 'tabs'

export interface LayerDecl {
  /** 层 id，对应 data/layers/<id>.json */
  id: LayerId
  label: string
  /** 公共要素必配（ent / event） */
  required: boolean
  /** 目录条目行尾徽标缩写，如 EN / AP / RG */
  tag?: string
  /** 字段声明，驱动列表列与详情块 */
  fields?: Record<string, FieldDecl>
  views?: {
    list: ListViewMode
    detail: DetailBlock[]
  }
  /** 筛选形态：树用于有层级的值域（规则基类、卷模式），chips 用于扁平枚举 */
  filter?: 'chips' | 'tree' | 'none'
  /** chips / tree 依据的字段名 */
  filterBy?: string
  /**
   * tree 筛选的构建方式：
   *  · prefix —— 值域是 `礼制>朝仪` 这种**层级**，父节点 = 前缀匹配的子孙
   *  · tags   —— 值域是 `禁止型+程序型` 这种**多标签**，一个值同属多个父节点
   *              （新官规则层 6 基类 × 37 组合必须用这个，用 prefix 会漏计）
   * 缺省时按值域里出现的分隔符自动判定。
   */
  filterTree?: 'prefix' | 'tags'
  /** tags 模式的分隔符，默认 '+' */
  filterSep?: string
  /** 列表分组依据的字段名 */
  groupBy?: string
  /**
   * 拓展要素：视图组件已注册但数据缺失。
   * 列表页显示「待补建」而不是白屏（设计文档 §5.2 三级判定）。
   */
  reserved?: boolean
}

export interface BookStructure {
  /** 目录层级，如 ['volume','chapter','item'] 或 ['volume','item'] */
  tree: string[]
  /** 懒加载分块粒度 */
  chunkBy: 'volume' | 'chapter'
  /** 每组的条目数（旧版 GROUPS=5） */
  groupSize: number
}

export interface BookColors {
  primary: string
  entityTypes?: Record<string, string>
}

export interface BookConfig {
  bookId: string
  title: string
  subtitle?: string
  genre?: string
  structure: BookStructure
  colors: BookColors
  layers: LayerDecl[]
  /** 跨层索引：参与贯通的列与主键层 */
  join: {
    layers: string[]
    primary: string
  }
  /** 卷阅读模式（VOL），无标注的书 enabled=false */
  volProfile?: {
    enabled: boolean
    source: string
  }
}

/* ------------------------------------------------------------------ */
/* data 包                                                             */
/* ------------------------------------------------------------------ */

export interface VolumeInfo {
  id: string
  label: string
  itemCount: number
  /** 卷阅读模式 key，无标注时缺省 */
  mode?: string
}

export interface VolMode {
  key: string
  label: string
  volumeCount: number
  itemCount: number
}

export interface VolProfile {
  modes: VolMode[]
  /** volume id -> mode key */
  byVolume: Record<string, string>
}

export interface BookMeta {
  bookId: string
  title: string
  /** 各层计数，与打包校验脚本的守恒口径一致 */
  stats: Record<string, number>
  volumes: VolumeInfo[]
  vol_modes?: VolProfile
}

export interface ChapterNode {
  key: string
  label: string
  count: number
  children?: ChapterNode[]
}

/**
 * 实体在原文中的定位 span（标注实例 / mention）
 *
 * 打包期不变量：`text.slice(s, e) === span.text` 恒成立。
 * 源标注为异体字形时（季聦/季聪、戸/户）text 取原文实际切片，原词形存 surface。
 */
export interface EntitySpan {
  /** mention 唯一 id（源 ENT-NNN 是实体主键，可跨条目复现，不能作主键） */
  id: string
  /** 实体主键 id，指向 entities.json */
  eid?: string
  text: string
  type: string
  /** 原文起始偏移（含） */
  s: number
  /** 原文结束偏移（不含） */
  e: number
  normalized?: string
  /** 源标注词形，仅当与原文字形不一致（异体字）时存在 */
  surface?: string
  confidence?: number | null
}

export interface ItemRecord {
  /** `章号-序号`，全书唯一主键 */
  iid: string
  /** 数值化序号：parseInt(iid.slice(3))，统一比较口径（旧版数字/字符串不一致的教训） */
  ordinal: number
  volume: string
  /** 三层目录的书（如《新官轨范》卷→章→条）才有 */
  chapter?: string
  /** 原文 */
  text: string
  /** 归一化原文，供检索 */
  norm?: string
  /** 译文（trl 层单独存全文时此处可缺省） */
  translation?: string
  spans: EntitySpan[]
}

/** 每卷一个 chunk，进卷才加载 */
export interface ItemChunk {
  volume: string
  items: ItemRecord[]
}

/** 层记录：id + 所属条目 + 书证三件套 + 层特有字段 */
export interface LayerRecord extends Evidence {
  id: string
  item_id: string
  [key: string]: unknown
}

export interface LayerFile {
  layer: LayerId
  count: number
  records: LayerRecord[]
}

export interface EntityEntry {
  eid: string
  normalized: string
  type: string
  surfaces: string[]
  count: number
  first_source?: string
  /** 出现条目 iid 列表，供反查 */
  items?: string[]
  /**
   * 跨书全局实体 id（v2 专用，本次不实现，字段保留以便平滑升级）
   */
  gid?: string | null
}

export type EntityTable = Record<string, EntityEntry>

export interface JoinRow {
  item_id: string
  volume: string
  source: string
  layer_count: number
  /** layerId -> 该条目命中的层内 id 列表 */
  ids: Record<LayerId, string[]>
}

export interface JoinFile {
  columns: LayerId[]
  rows: JoinRow[]
}

export interface EnumValue {
  value: string
  count: number
}

/** layerId -> field -> 值域（含计数，供 chips / tree 渲染） */
export type EnumFile = Record<LayerId, Record<string, EnumValue[]>>

/* ------------------------------------------------------------------ */
/* 书架清单                                                            */
/* ------------------------------------------------------------------ */

export interface BookSummary {
  bookId: string
  title: string
  subtitle?: string
  genre?: string
  layerCount: number
  stats?: Record<string, number>
}

export interface BooksManifest {
  books: BookSummary[]
}

/* ------------------------------------------------------------------ */
/* 检索索引（构建期生成）                                              */
/* ------------------------------------------------------------------ */

export interface SearchDoc {
  iid: string
  volume: string
  /** 原文摘要 */
  text: string
  /** 译文摘要 */
  translation?: string
  /** 各层字段拼成的检索域 */
  fields: string
}

export interface SearchIndexFile {
  bookId: string
  docs: SearchDoc[]
}
