/**
 * 数据加载（P0.2）
 *
 * 部署形态为 http 静态站（已确认不做 file:// 双击直开），因此数据放 public/data，
 * 运行期用 fetch 按需加载——这正是「卷级 chunk 懒加载」需要的形态。
 * 未来切库只需替换本文件的实现（设计文档 §7.5 DataProvider 抽象）。
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

const DATA_ROOT = `${import.meta.env.BASE_URL}data/`

const cache = new Map<string, unknown>()

async function fetchJson<T>(relPath: string, useCache = true): Promise<T> {
  if (useCache && cache.has(relPath)) return cache.get(relPath) as T
  const res = await fetch(`${DATA_ROOT}${relPath}`)
  if (!res.ok) {
    throw new Error(`数据加载失败 (${res.status})：${relPath}`)
  }
  const json = (await res.json()) as T
  if (useCache) cache.set(relPath, json)
  return json
}

export function bookPath(bookId: string, file: string): string {
  return `${bookId}/${file}`
}

export const dataProvider = {
  manifest: () => fetchJson<BooksManifest>('index.json'),
  config: (bookId: string) => fetchJson<BookConfig>(bookPath(bookId, 'book.config.json')),
  meta: (bookId: string) => fetchJson<BookMeta>(bookPath(bookId, 'meta.json')),
  chapters: (bookId: string) => fetchJson<ChapterNode[]>(bookPath(bookId, 'chapters.json')),
  /** 卷级 chunk：进卷才加载 */
  itemChunk: (bookId: string, volume: string) =>
    fetchJson<ItemChunk>(bookPath(bookId, `items/${volume}.json`)),
  layer: (bookId: string, layerId: LayerId) =>
    fetchJson<LayerFile>(bookPath(bookId, `layers/${layerId}.json`)),

  /**
   * ent 层精简索引（P5.1）。
   *
   * 实体列表只需 text/type/eid 做筛选展示，而 ent.json 里 `original`（书证全文）
   * 占 83% 体积——列表页不该替详情页买单。详情需要书证时再走 `layer()` 取全量。
   * 索引不存在（旧数据包）时回落到全量，保证向后兼容。
   */
  entIndex: (bookId: string) =>
    fetchJson<EntIndexFile>(bookPath(bookId, 'layers/ent-index.json')),
  entities: (bookId: string) => fetchJson<EntityTable>(bookPath(bookId, 'entities.json')),
  join: (bookId: string) => fetchJson<JoinFile>(bookPath(bookId, 'join.json')),
  enums: (bookId: string) => fetchJson<EnumFile>(bookPath(bookId, 'enums.json')),
  searchIndex: (bookId: string) =>
    fetchJson<SearchIndexFile>(bookPath(bookId, 'search-index.json')),
}

export function clearDataCache(): void {
  cache.clear()
}
