/**
 * 层数据懒加载与索引（P2.6 / P2.7 的基础设施）
 *
 * ⚠️ 为什么必须懒加载：水东 ent 层单文件 2.5MB（每条记录都带书证全文）。
 * 「条目详情全层表」如果要同时展开 8 层，一次就是 12MB。
 * 所以：join.json 先给出「每层命中几条」的骨架，用户点开哪层才加载哪层。
 *
 * 索引（byId / byItem）在首次加载后建立并缓存，避免每次点击都 O(n) 扫一遍。
 */
import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { dataProvider } from '@/core/dataProvider'
import type {
  EntityTable,
  JoinFile,
  LayerFile,
  LayerId,
  LayerRecord,
  SearchIndexFile,
} from '@/core/types'

interface LayerCache {
  file: LayerFile
  byId: Map<string, LayerRecord>
  byItem: Map<string, LayerRecord[]>
}

/**
 * ent 层加载：先试精简索引，没有就回落全量。
 *
 * 回落是必需的：索引是 P5.1 才有的产物，旧数据包（已发布的静态站）里没有
 * 这个文件，直接 404 会让整个实体层不可用。
 * 指定了 itemId 时直接取该条目的 ent 记录（含书证）——精简索引是全书的，
 * 详情场景宁可多一次请求也要拿到书证（走查 2026-10-13 A5）。
 */
async function loadEntLayer(bookId: string, opts: { itemId?: string; full?: boolean } = {}): Promise<LayerFile> {
  if (opts.itemId) {
    return dataProvider.layer(bookId, 'ent', { itemId: opts.itemId, full: opts.full ?? true })
  }
  try {
    const idx = await dataProvider.entIndex(bookId)
    // full=true 说明索引已含书证，直接当全量用
    return { layer: 'ent', count: idx.count, records: idx.records } as LayerFile
  } catch {
    return dataProvider.layer(bookId, 'ent', opts)
  }
}

/**
 * 缓存键：条目维度的载荷（itemId）单独一份，避免污染全书层缓存——
 * 联邦模式下带 itemId 的响应只含该条记录，与全量不可互替。
 */
const key = (bookId: string, layer: LayerId, itemId?: string) =>
  `${bookId}/${layer}${itemId ? `#${itemId}` : ''}`

/** 分页缓存键：按（书/层/筛选字段/值）分桶，切换筛选不互相污染 */
const pageKey = (bookId: string, layer: LayerId, field: string, value: string) =>
  `${bookId}/${layer}#${field}=${value}`

/** 服务端分页一页的记录数（与 API limit 上限 500 留余量） */
export const LAYER_PAGE_SIZE = 200

interface PageState {
  records: LayerRecord[]
  /** 该筛选口径的全层总数；-1 = 首页未回 */
  total: number
  /** 已取到的条数（下一页的 offset） */
  offset: number
  loading: boolean
  failed: boolean
}

export const useLayerStore = defineStore('layers', () => {
  const loading = ref<Set<string>>(new Set())
  /** 已加载的层，shallowRef 避免 Vue 深度代理 2 万条记录 */
  const caches = shallowRef<Map<string, LayerCache>>(new Map())
  const entityTables = shallowRef<Map<string, EntityTable>>(new Map())
  const joins = shallowRef<Map<string, JoinFile>>(new Map())
  const indexes = shallowRef<Map<string, SearchIndexFile>>(new Map())
  /** 加载失败的层，UI 显示「数据缺失」而不是反复重试 */
  const failed = ref<Set<string>>(new Set())
  /** 总览页服务端分页状态（键见 pageKey），shallowRef + 整 Map 替换触发响应 */
  const pages = shallowRef<Map<string, PageState>>(new Map())

  function pageOf(bookId: string, layer: LayerId, field: string, value: string): PageState | null {
    return pages.value.get(pageKey(bookId, layer, field, value)) ?? null
  }

  function setPage(k: string, p: PageState): void {
    const next = new Map(pages.value)
    next.set(k, p)
    pages.value = next
  }

  /**
   * 取下一页（append）或重置取首页（reset）。
   * 并发/取满/在途失败时直接返回：触底事件是连发的，必须幂等。
   */
  async function loadPage(
    bookId: string,
    layer: LayerId,
    opts: { field?: string; value?: string; reset?: boolean } = {},
  ): Promise<void> {
    const field = opts.field ?? ''
    const value = opts.value ?? ''
    const k = pageKey(bookId, layer, field, value)
    const cur = pages.value.get(k)
    if (cur?.loading) return
    if (!opts.reset && cur && cur.total >= 0 && cur.offset >= cur.total) return
    const offset = !cur || opts.reset ? 0 : cur.offset
    if (!cur || opts.reset) setPage(k, { records: [], total: -1, offset: 0, loading: true, failed: false })
    else setPage(k, { ...cur, loading: true, failed: false })
    try {
      const res = await dataProvider.layerPage(bookId, layer, {
        offset,
        limit: LAYER_PAGE_SIZE,
        ...(field ? { field, value } : {}),
      })
      const now = pages.value.get(k)
      if (!now) return
      setPage(k, {
        records: offset === 0 ? res.records : [...now.records, ...res.records],
        total: res.count,
        offset: offset + res.records.length,
        loading: false,
        failed: false,
      })
    } catch {
      const now = pages.value.get(k)
      if (now) setPage(k, { ...now, loading: false, failed: true })
    }
  }

  function peek(bookId: string, layer: LayerId, itemId?: string): LayerCache | undefined {
    return caches.value.get(key(bookId, layer, itemId))
  }

  async function load(
    bookId: string,
    layer: LayerId,
    opts: { itemId?: string; full?: boolean } = {},
  ): Promise<LayerCache | null> {
    const k = key(bookId, layer, opts.itemId)
    const hit = caches.value.get(k)
    if (hit) return hit
    if (failed.value.has(k)) return null
    loading.value.add(k)
    try {
      // ent 层优先读精简索引（P5.1）：书证全文占 83% 体积而列表用不到，
      // 旧数据包没有索引文件时回落到全量，保证向后兼容。
      const file =
        layer === 'ent'
          ? await loadEntLayer(bookId, opts)
          : await dataProvider.layer(bookId, layer, opts)
      const byId = new Map<string, LayerRecord>()
      const byItem = new Map<string, LayerRecord[]>()
      for (const r of file.records) {
        byId.set(r.id, r)
        const iid = r.item_id
        if (iid) {
          const list = byItem.get(iid)
          if (list) list.push(r)
          else byItem.set(iid, [r])
        }
      }
      const cache: LayerCache = { file, byId, byItem }
      const next = new Map(caches.value)
      next.set(k, cache)
      caches.value = next
      return cache
    } catch {
      failed.value.add(k)
      return null
    } finally {
      loading.value.delete(k)
    }
  }

  function recordsOf(bookId: string, layer: LayerId): LayerRecord[] | null {
    return peek(bookId, layer)?.file.records ?? null
  }

  /** 加载失败后重试：清掉失败标记再重新拉取（UI 的「数据缺失·重试」按钮用） */
  async function retry(bookId: string, layer: LayerId): Promise<LayerCache | null> {
    failed.value.delete(key(bookId, layer))
    return load(bookId, layer)
  }

  function recordById(bookId: string, layer: LayerId, id: string): LayerRecord | undefined {
    return peek(bookId, layer)?.byId.get(id)
  }

  /** 某条目在某层的全部记录（已按文件顺序）；条目维度缓存优先，回落全量缓存 */
  function recordsByItem(bookId: string, layer: LayerId, iid: string): LayerRecord[] {
    return (
      peek(bookId, layer, iid)?.byItem.get(iid) ??
      peek(bookId, layer)?.byItem.get(iid) ??
      []
    )
  }

  async function ensureLoaded(bookId: string, layer: LayerId): Promise<boolean> {
    if (peek(bookId, layer)) return true
    return (await load(bookId, layer)) !== null
  }

  async function entities(bookId: string): Promise<EntityTable> {
    const hit = entityTables.value.get(bookId)
    if (hit) return hit
    const table = await dataProvider.entities(bookId)
    const next = new Map(entityTables.value)
    next.set(bookId, table)
    entityTables.value = next
    return table
  }

  async function join(bookId: string): Promise<JoinFile> {
    const hit = joins.value.get(bookId)
    if (hit) return hit
    const file = await dataProvider.join(bookId)
    const next = new Map(joins.value)
    next.set(bookId, file)
    joins.value = next
    return file
  }

  async function searchIndex(bookId: string): Promise<SearchIndexFile> {
    const hit = indexes.value.get(bookId)
    if (hit) return hit
    const file = await dataProvider.searchIndex(bookId)
    const next = new Map(indexes.value)
    next.set(bookId, file)
    indexes.value = next
    return file
  }

  /** join 行（条目 → 各层命中 id 列表），供目录徽标与条目详情骨架 */
  function joinRow(bookId: string, iid: string) {
    return joins.value.get(bookId)?.rows.find((r) => r.item_id === iid)
  }

  return {
    loading,
    failed,
    caches,
    entityTables,
    joins,
    pages,
    peek,
    load,
    ensureLoaded,
    retry,
    recordsOf,
    recordById,
    recordsByItem,
    pageOf,
    loadPage,
    entities,
    join,
    searchIndex,
    joinRow,
  }
})
