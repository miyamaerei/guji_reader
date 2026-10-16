/**
 * 联邦数据库 API 客户端（P7 联邦形态）
 *
 * 数据源从 public/data/<bookId>/*.json 静态包切换为后端只读 SQLite 服务
 * （server/sqlite-api.mjs，node:http + node:sqlite，零第三方依赖）。
 *
 * 路径约定：`${BASE_URL}api/…` —— 开发态由 vite 代理转发到 8787，
 * 生产态由 API 服务同进程托管 dist 静态文件（/api 由服务自己接管）。
 * 查询参数均由 URLSearchParams/encodeURIComponent 编码，保证中文安全。
 */
import type {
  BookConfig,
  BookMeta,
  BooksManifest,
  ChapterNode,
  EntityTable,
  EnumFile,
  ItemChunk,
  JoinFile,
  LayerFile,
  LayerId,
  SearchIndexFile,
} from './types'
import type { EntIndexFile } from './entIndex'

const API_ROOT = `${import.meta.env.BASE_URL}api/`

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_ROOT}${path}`)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || `API 请求失败 (${res.status})：${path}`)
  }
  return (await res.json()) as T
}

/* ---------------- 联邦检索 / 关联的结果类型 ---------------- */

export interface FedBookSummary {
  bookId: string
  title: string
  name: string
  volumes: number
  items: number
  layers: number
  entities: number
  mentions: number
  event?: number
  /** 书目元信息（kb.sqlite 的 book_meta 表），老库未灌种子时缺省 */
  subtitle?: string
  genre?: string
}

export interface FedBooksManifest {
  count: number
  books: FedBookSummary[]
}

export interface FedSearchDoc {
  bookId: string
  book: string
  iid: string
  volume: string
  /** 命中域：text=原文 / translation=译文 */
  where: string[]
  /** 原文摘要（截断 600） */
  text: string
  translation?: string
}

export interface FedSearchResult {
  total: number
  elapsed: number
  docs: FedSearchDoc[]
}

export interface FedAssocMember {
  uid: string
  bookId: string
  label: string
  method: string
  confidence: number
}

export interface FedAssocGroup {
  canonical_id: string
  repr_label: string
  status: string
  member_count: number
  /** 覆盖的书短码 */
  books: string[]
  members: FedAssocMember[]
}

export interface FedAssocRef {
  book_id: string
  item_id: string
  volume: string
  layer_key: string
  field: string
  target_text: string
  target_uid: string | null
  target_ambiguous: number
}

export interface FedAssocResult {
  total: number
  elapsed: number
  groups: FedAssocGroup[]
  refs: FedAssocRef[]
}

export const api = {
  /** 书架：后端统计归一化为 BooksManifest 形态（subtitle/layerCount/stats） */
  async books(): Promise<BooksManifest> {
    const r = await fetchJson<FedBooksManifest>('books')
    return {
      books: r.books.map((b) => ({
        bookId: b.bookId,
        title: b.title,
        // 副标题/体裁以后端为准（book_meta 元信息，如「明·叶盛 · 典章制度与朝野见闻杂记」）；
        // 后端未提供（老库未灌种子）时回落统计派生
        subtitle: b.subtitle?.trim() || `联邦库 · ${b.volumes} 卷 · ${b.items} 条`,
        genre: b.genre?.trim() || '数据库查询',
        layerCount: b.layers,
        stats: {
          items: b.items,
          volumes: b.volumes,
          entities: b.entities,
          mentions: b.mentions,
          ...(b.event != null ? { event: b.event } : {}),
        },
      })),
    }
  },

  config: (bookId: string) => fetchJson<BookConfig>(`books/${bookId}/config`),
  meta: (bookId: string) => fetchJson<BookMeta>(`books/${bookId}/meta`),
  chapters: async (bookId: string) =>
    (await fetchJson<{ bookId: string; chapters: ChapterNode[] }>(`books/${bookId}/chapters`)).chapters,
  /** 卷级 chunk：进卷才加载 */
  itemChunk: (bookId: string, volume: string) =>
    fetchJson<ItemChunk>(`books/${bookId}/items?volume=${encodeURIComponent(volume)}`),
  /** 层数据。itemId 给详情反查；full=1 时才回传 original（书证全文） */
  layer: (bookId: string, layerId: LayerId, opts: { itemId?: string; full?: boolean } = {}) => {
    const q = new URLSearchParams()
    if (opts.itemId) q.set('item_id', opts.itemId)
    if (opts.full) q.set('full', '1')
    const s = q.toString()
    return fetchJson<LayerFile>(`books/${bookId}/layers/${layerId}${s ? `?${s}` : ''}`)
  },
  /**
   * 层记录分页（总览页）：limit 启用，count 恒为该筛选口径总数；
   * field/value 把 filterBy 筛选下推到服务端（否则分页页内筛选凑不满一页）。
   */
  layerPage: (
    bookId: string,
    layerId: LayerId,
    page: { offset: number; limit: number; field?: string; value?: string },
  ) => {
    const q = new URLSearchParams({ offset: String(page.offset), limit: String(page.limit) })
    if (page.field) {
      q.set('field', page.field)
      q.set('value', page.value ?? '')
    }
    return fetchJson<LayerFile>(`books/${bookId}/layers/${layerId}?${q.toString()}`)
  },
  /** ent 层精简索引（剔除 original 书证，详情需书证时走 layer + itemId + full） */
  entIndex: (bookId: string) => fetchJson<EntIndexFile>(`books/${bookId}/ent-index`),
  entities: (bookId: string) => fetchJson<EntityTable>(`books/${bookId}/entities`),
  join: (bookId: string) => fetchJson<JoinFile>(`books/${bookId}/join`),
  enums: (bookId: string) => fetchJson<EnumFile>(`books/${bookId}/enums`),
  searchIndex: (bookId: string) => fetchJson<SearchIndexFile>(`books/${bookId}/search-index`),

  /** 远程检索：多词 AND；不传 bookId 即跨书联邦检索（默认返回全部书命中） */
  search: (terms: string[], bookId?: string) => {
    const q = new URLSearchParams()
    for (const t of terms) q.append('q', t)
    if (bookId) q.set('book', bookId)
    return fetchJson<FedSearchResult>(`search?${q.toString()}`)
  },

  /** 联邦实体关联：canonical 合并组 + record_refs 引用 */
  assoc: (q: string) => fetchJson<FedAssocResult>(`assoc?q=${encodeURIComponent(q)}`),
}