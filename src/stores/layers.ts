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
 */
async function loadEntLayer(bookId: string): Promise<LayerFile> {
  try {
    const idx = await dataProvider.entIndex(bookId)
    // full=true 说明索引已含书证，直接当全量用
    return { layer: 'ent', count: idx.count, records: idx.records } as LayerFile
  } catch {
    return dataProvider.layer(bookId, 'ent')
  }
}

const key = (bookId: string, layer: LayerId) => `${bookId}/${layer}`

export const useLayerStore = defineStore('layers', () => {
  const loading = ref<Set<string>>(new Set())
  /** 已加载的层，shallowRef 避免 Vue 深度代理 2 万条记录 */
  const caches = shallowRef<Map<string, LayerCache>>(new Map())
  const entityTables = shallowRef<Map<string, EntityTable>>(new Map())
  const joins = shallowRef<Map<string, JoinFile>>(new Map())
  const indexes = shallowRef<Map<string, SearchIndexFile>>(new Map())
  /** 加载失败的层，UI 显示「数据缺失」而不是反复重试 */
  const failed = ref<Set<string>>(new Set())

  function peek(bookId: string, layer: LayerId): LayerCache | undefined {
    return caches.value.get(key(bookId, layer))
  }

  async function load(bookId: string, layer: LayerId): Promise<LayerCache | null> {
    const k = key(bookId, layer)
    const hit = caches.value.get(k)
    if (hit) return hit
    if (failed.value.has(k)) return null
    loading.value.add(k)
    try {
      // ent 层优先读精简索引（P5.1）：书证全文占 83% 体积而列表用不到，
      // 旧数据包没有索引文件时回落到全量，保证向后兼容。
      const file =
        layer === 'ent'
          ? await loadEntLayer(bookId)
          : await dataProvider.layer(bookId, layer)
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

  /** 某条目在某层的全部记录（已按文件顺序） */
  function recordsByItem(bookId: string, layer: LayerId, iid: string): LayerRecord[] {
    return peek(bookId, layer)?.byItem.get(iid) ?? []
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
    peek,
    load,
    ensureLoaded,
    retry,
    recordsOf,
    recordById,
    recordsByItem,
    entities,
    join,
    searchIndex,
    joinRow,
  }
})
