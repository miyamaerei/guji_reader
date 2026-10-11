/**
 * 书注册表（P0.4）
 *
 * 只负责「按 bookId 取配置/元数据并缓存」，不持有响应式状态；
 * 响应式书上下文在 stores/bookContext.ts。
 */
import { dataProvider } from './dataProvider'
import { validateBookConfig } from './layerSchema'
import type { BookConfig, BookMeta, BooksManifest } from './types'

const configCache = new Map<string, BookConfig>()
const metaCache = new Map<string, BookMeta>()

let manifestCache: BooksManifest | null = null

export async function loadManifest(force = false): Promise<BooksManifest> {
  if (!manifestCache || force) {
    manifestCache = await dataProvider.manifest()
  }
  return manifestCache
}

export async function loadBookConfig(bookId: string, force = false): Promise<BookConfig> {
  if (!configCache.has(bookId) || force) {
    const config = await dataProvider.config(bookId)
    const errors = validateBookConfig(config)
    if (errors.length) {
      throw new Error(`《${config.title ?? bookId}》book.config.json 校验失败：${errors.join('；')}`)
    }
    configCache.set(bookId, config)
  }
  return configCache.get(bookId) as BookConfig
}

export async function loadBookMeta(bookId: string, force = false): Promise<BookMeta> {
  if (!metaCache.has(bookId) || force) {
    metaCache.set(bookId, await dataProvider.meta(bookId))
  }
  return metaCache.get(bookId) as BookMeta
}

export function peekBookConfig(bookId: string): BookConfig | undefined {
  return configCache.get(bookId)
}
