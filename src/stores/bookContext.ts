/**
 * 全局书上下文（P0.4）
 *
 * 切书是重动作：目录、层 tab、配色、筛选、面包屑、目录树状态全部重置。
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import { loadBookConfig, loadBookMeta, loadManifest } from '@/core/bookRegistry'
import { navTabs, resolveLayers, type NavTab, type ResolvedLayer } from '@/core/layerSchema'
import type { BookConfig, BookMeta, BookSummary, LayerId, VolProfile } from '@/core/types'
import { deriveVolProfile } from '@/core/vol'
import { useCrumbsStore } from './crumbs'
import { useTocStore } from './toc'

export const useBookStore = defineStore('book', () => {
  const manifest = ref<BookSummary[]>([])
  const currentBookId = ref<string>('')
  const config = shallowRef<BookConfig | null>(null)
  const meta = shallowRef<BookMeta | null>(null)

  const loading = ref(false)
  const error = ref('')

  /** 当前层 tab（item / ent / event / 各专用层 / join） */
  const currentLayer = ref<LayerId>('item')
  const filter = ref('')

  const layers = computed<ResolvedLayer[]>(() =>
    config.value ? resolveLayers(config.value) : [],
  )
  const tabs = computed<NavTab[]>(() => (config.value ? navTabs(config.value) : []))
  const primaryColor = computed(() => config.value?.colors.primary ?? '#5F5E5A')
  const groupSize = computed(() => config.value?.structure.groupSize ?? 5)

  /**
   * 卷阅读模式（P3.7）。仅当配置声明 volProfile.enabled 且 meta 已加载时派生；
   * 无源标注时退化为单一「全卷」模式；新官 enabled:false → 始终为 null，前端自动隐藏。
   */
  const volProfile = computed<VolProfile | null>(() => {
    if (!config.value?.volProfile?.enabled || !meta.value) return null
    return deriveVolProfile(meta.value)
  })

  /** 切 tab 重置筛选（沿用旧版 bwState 语义） */
  watch(currentLayer, () => {
    filter.value = ''
  })

  async function init(): Promise<void> {
    if (manifest.value.length) return
    manifest.value = (await loadManifest()).books
  }

  async function setBook(bookId: string, opts: { layer?: LayerId } = {}): Promise<void> {
    if (currentBookId.value === bookId && config.value) {
      if (opts.layer) currentLayer.value = opts.layer
      return
    }
    loading.value = true
    error.value = ''
    try {
      const [cfg, mt] = await Promise.all([loadBookConfig(bookId), loadBookMeta(bookId)])
      // —— 切书即重置全部派生状态 ——
      currentBookId.value = bookId
      config.value = cfg
      meta.value = mt
      currentLayer.value = opts.layer ?? 'item'
      filter.value = ''
      const toc = useTocStore()
      toc.reset()
      toc.groupSize = cfg.structure.groupSize
      useCrumbsStore().reset()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  function setLayer(layer: LayerId): void {
    currentLayer.value = layer
  }

  return {
    manifest,
    currentBookId,
    config,
    meta,
    loading,
    error,
    currentLayer,
    filter,
    layers,
    tabs,
    primaryColor,
    groupSize,
    volProfile,
    init,
    setBook,
    setLayer,
  }
})
