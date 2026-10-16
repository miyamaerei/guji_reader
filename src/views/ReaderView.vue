<script setup lang="ts">
/**
 * 三栏阅读器（P2.5）
 *
 * 左：目录树（卷 → 组 → 条，徽标来自 join）
 * 中：正文流（覆盖式卡片铺满，实体着色，滚动续接下一卷）
 * 右：详情（条目全层表 / 实体 / 层记录）
 *
 * 卷级懒加载是天然形态：数据放 public/data，进哪卷 fetch 哪卷的 items/<NN>.json。
 * 「滚动续接」在触底时补下一卷，用户感知不到卷边界。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DetailPanel, { type Selection } from '@/components/reader/DetailPanel.vue'
import ItemStream from '@/components/reader/ItemStream.vue'
import TocPanel from '@/components/reader/TocPanel.vue'
import { dataProvider } from '@/core/dataProvider'
import { assertSpans } from '@/core/items'
import { buildIidVolumeMap } from '@/core/toc'
import { useBookStore } from '@/stores/bookContext'
import { useCrumbsStore } from '@/stores/crumbs'
import { useLayerStore } from '@/stores/layers'
import { useTocStore } from '@/stores/toc'
import { useUiStore } from '@/stores/ui'
import type { ChapterNode, EntitySpan, ItemRecord } from '@/core/types'

const route = useRoute()
const router = useRouter()
const book = useBookStore()
const crumbs = useCrumbsStore()
const layers = useLayerStore()
const toc = useTocStore()
const ui = useUiStore()

const bookId = computed(() => String(route.params.book ?? ''))

const chapters = ref<ChapterNode[]>([])
/** 已加载的卷（按 meta 顺序） */
const loadedVols = ref<string[]>([])
const chunkMap = ref<Map<string, ItemRecord[]>>(new Map())
const loading = ref(false)
const loadError = ref('')
/** 最近一次加载失败的卷，供「重试」按钮重跑（P2.9） */
const lastFailedVol = ref('')
const kw = ref('')
const spanIssues = ref(0)

const selection = ref<Selection | null>(null)
const highlightEid = ref<string | null>(null)
const scrollTo = ref<string | null>(null)
/** 移动端抽屉：none / toc / detail（窄屏下目录与详情改为 overlay） */
const mobilePanel = ref<'none' | 'toc' | 'detail'>('none')

const volumes = computed(() => book.meta?.volumes ?? [])
const hasMore = computed(() => loadedVols.value.length < volumes.value.length)
const items = computed<ItemRecord[]>(() =>
  loadedVols.value.flatMap((v) => chunkMap.value.get(v) ?? []),
)
const activeIid = computed(() => {
  const s = selection.value
  return s?.kind === 'item' ? s.iid : toc.focusItem
})
const colors = computed(() => book.config?.colors.entityTypes ?? {})

/** iid → 卷，口径见 core/toc.ts 的 buildIidVolumeMap（严禁用 iid 前缀猜） */
const iidVolume = computed(() => buildIidVolumeMap(chapters.value))

function volumeOf(iid: string): string {
  return iidVolume.value.get(iid) ?? iid.slice(0, 2)
}

async function ensureBook(): Promise<void> {
  if (!bookId.value) return
  if (book.currentBookId !== bookId.value) {
    await book.setBook(bookId.value)
    crumbs.push({ label: book.config?.title ?? bookId.value, to: `/reader/${bookId.value}` })
    chapters.value = await dataProvider.chapters(bookId.value)
  } else if (!chapters.value.length) {
    chapters.value = await dataProvider.chapters(bookId.value)
  }
}

function insertVolume(vol: string, list: ItemRecord[]): void {
  const next = new Map(chunkMap.value)
  next.set(vol, list)
  chunkMap.value = next
  const order = volumes.value.map((v) => v.id)
  loadedVols.value = [...new Set([...loadedVols.value, vol])].sort(
    (a, b) => order.indexOf(a) - order.indexOf(b),
  )
  spanIssues.value += assertSpans(list).length
}

async function loadVolume(vol: string): Promise<void> {
  if (loadedVols.value.includes(vol)) return
  loading.value = true
  try {
    const chunk = await dataProvider.itemChunk(bookId.value, vol)
    insertVolume(vol, chunk.items)
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
    lastFailedVol.value = vol
  } finally {
    loading.value = false
  }
}

/** 卷加载失败后的重试：重跑最近失败的卷（首卷或续接卷都适用） */
function retryLast(): void {
  if (!lastFailedVol.value) return
  const vol = lastFailedVol.value
  loadError.value = ''
  void loadVolume(vol)
}

/** 跳到某条目：卷未加载则先加载，并把正文流重置到该卷（避免中间夹着别的卷） */
async function jumpTo(iid: string): Promise<void> {
  const vol = volumeOf(iid)
  if (!loadedVols.value.includes(vol)) {
    loadedVols.value = []
    chunkMap.value = new Map()
    await loadVolume(vol)
  }
  toc.selectItem(iid)
  scrollTo.value = iid
  selection.value = { kind: 'item', iid }
}

function onSelect(iid: string): void {
  selection.value = { kind: 'item', iid }
  toc.selectItem(iid)
  scrollTo.value = iid
}

function onPick(span: EntitySpan): void {
  highlightEid.value = span.eid ?? null
  if (span.eid) selection.value = { kind: 'entity', eid: span.eid }
  else selection.value = { kind: 'layer', layer: 'ent', id: span.id }
}

function onFocus(iid: string | null): void {
  toc.setFocus(iid)
}

function onReachEnd(): void {
  // ⚠️ 首卷尚未加载时列表是空的，触底哨兵本来就在视口里，
  // 此时若放行续接，会把「卷首」当成下一卷塞进来（已踩过）。
  if (!loadedVols.value.length) return
  const order = volumes.value.map((v) => v.id)
  const loaded = loadedVols.value
  const lastIdx = loaded.length ? order.indexOf(loaded[loaded.length - 1]) : -1
  const next = order[lastIdx + 1]
  if (next) void loadVolume(next)
}

/**
 * 进入阅读器 / 切换书籍后的首屏加载：?iid 定位、?vol 指定卷、否则首卷。
 *
 * onMounted 与 watch(bookId) 共用——曾经只有 onMounted 加载首卷，同路由
 * 参数变化（reader/sdr → reader/wzz）时组件不重新 mount，watcher 只重置了
 * chunkMap 却不加载，页面停在「已加载 0/N 卷 · 0 条」的空白态（走查 2026-10-13）。
 */
async function enterInitialVolume(): Promise<void> {
  const wantVol = String(route.query.vol ?? '')
  const wantIid = String(route.query.iid ?? '')
  if (wantIid) {
    await jumpTo(wantIid)
    return
  }
  const first = volumes.value.find((v) => v.id === wantVol) ?? volumes.value[0]
  if (first) {
    await loadVolume(first.id)
    // 目录跟着展开到起始卷：?vol=06 却停在卷一，用户会以为没生效
    toc.openOnly(first.id)
  }
}

/** 层字段里的实体引用：按名称反查主键 */
async function onRef(layer: string, value: string): Promise<void> {
  if (layer !== 'ent' || !value) return
  const table = await layers.entities(bookId.value)
  const hit = Object.values(table).find((e) => e.normalized === value || e.surfaces?.includes(value))
  if (hit) {
    highlightEid.value = hit.eid
    selection.value = { kind: 'entity', eid: hit.eid }
  }
}

function onOpenRecord(layer: string, id: string): void {
  selection.value = { kind: 'layer', layer, id }
}

function submitSearch(): void {
  const q = kw.value.trim()
  if (!q) return
  router.push(`/search/${bookId.value}?q=${encodeURIComponent(q)}`)
}

/** Esc 关闭右栏详情（移动端也顺手收起抽屉） */
function onReaderKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (selection.value) selection.value = null
    if (mobilePanel.value !== 'none') mobilePanel.value = 'none'
  }
}

onMounted(async () => {
  await book.init()
  await ensureBook()
  await layers.join(bookId.value)
  window.addEventListener('keydown', onReaderKeydown)
  // 深链：?vol=NN 指定起始卷；?iid=xx 直接定位到条目
  await enterInitialVolume()
  // 搜索结果回跳：面包屑里带上「搜索结果」
  const sq = String(route.query.sq ?? '')
  if (sq) {
    crumbs.push({
      label: `搜索「${sq}」`,
      to: `/search/${bookId.value}?q=${encodeURIComponent(sq)}`,
    })
  }
})

watch(bookId, async () => {
  loadedVols.value = []
  chunkMap.value = new Map()
  selection.value = null
  spanIssues.value = 0
  // 旧书 chapters 必须清掉：iidVolume 由它推导，残留会让 jumpTo 定位错卷
  chapters.value = []
  await ensureBook()
  // 切书后同样要走首屏加载（iid/vol 的 watch 只在查询串变化时触发，
  // 单纯换书时只有本 watcher 在跑）
  await enterInitialVolume()
})

watch(
  () => route.query.iid,
  async (v) => {
    if (v) await jumpTo(String(v))
  },
)

/**
 * 深链 ?vol=NN 切换起始卷。
 *
 * 漏了这个 watch 的后果：?vol 只在 onMounted 读一次，所以在阅读器页内改
 * hash（浏览器前进后退、或程序化 location.hash = ...）不会换卷——URL 变了但
 * 内容没变，用户会以为没生效。?iid 一直有 watch，?vol 当时漏了。
 */
watch(
  () => route.query.vol,
  async (v, old) => {
    const next = String(v ?? '')
    if (!next || next === old) return
    // 目标卷已加载则无需重载，只滚动定位；未加载才走 loadVolume
    const first = volumes.value.find((x) => x.id === next)
    if (!first) return
    if (!chunkMap.value.has(next)) await loadVolume(next)
    toc.openOnly(next)
  },
)

onBeforeUnmount(() => window.removeEventListener('keydown', onReaderKeydown))
</script>

<template>
  <div class="reader">
    <div v-if="book.loading && !book.config" class="muted pad">加载中…</div>
    <div v-else-if="book.error" class="muted pad err">{{ book.error }}</div>
    <template v-else>
      <header class="bar">
        <strong class="t">{{ book.config?.title }}</strong>
        <span class="muted">{{ book.config?.subtitle }}</span>
        <span class="spacer" />
        <span class="muted prog">
          已加载 {{ loadedVols.length }}/{{ volumes.length }} 卷 · {{ items.length }} 条
        </span>
        <span v-if="spanIssues" class="badge-warn" title="span 偏移与词形不一致，着色可能错位">
          span {{ spanIssues }}
        </span>
        <button v-if="loadError" class="badge-warn btn" type="button" :title="loadError" @click="retryLast">
          卷加载失败·重试
        </button>
        <input
          v-model="kw"
          class="kw"
          data-search-input
          placeholder="全书检索…"
          @keydown.enter="submitSearch"
        />
        <button
          class="mini"
          type="button"
          :class="{ on: ui.showTranslation }"
          :title="ui.showTranslation ? '隐藏正文译文' : '正文随原文显示译文'"
          @click="ui.showTranslation = !ui.showTranslation"
        >
          译文{{ ui.showTranslation ? '·开' : '' }}
        </button>
        <a class="mini" :href="`#/list/${bookId}`">总览</a>
        <button class="mbtn" type="button" @click="mobilePanel = 'toc'">目录</button>
        <button class="mbtn" type="button" @click="mobilePanel = 'detail'">详情</button>
      </header>

      <div class="grid">
        <div class="col-toc" :class="{ 'mobile-open': mobilePanel === 'toc' }">
          <TocPanel :book-id="bookId" :chapters="chapters" @select="jumpTo($event)" />
        </div>
        <!-- 中栏 = 卷轴：上轴头 + 纸身（ItemStream）+ 下轴头 -->
        <div class="col-body">
          <div class="roller" aria-hidden="true" />
          <ItemStream
            :items="items"
            :colors="colors"
            :active-iid="activeIid"
            :highlight-eid="highlightEid"
            :scroll-to="scrollTo"
            :loading="loading"
            :has-more="hasMore"
            :force-show-trans="ui.showTranslation"
            @select="onSelect"
            @pick="onPick"
            @focus="onFocus"
            @reach-end="onReachEnd"
            @scrolled="scrollTo = null"
          />
          <div class="roller" aria-hidden="true" />
        </div>
        <div class="col-detail" :class="{ 'mobile-open': mobilePanel === 'detail' }">
          <DetailPanel
            :selection="selection"
            :book-id="bookId"
            @close="selection = null"
            @jump="jumpTo($event)"
            @open-record="onOpenRecord"
            @ref="onRef"
          />
        </div>
      </div>
      <div v-if="mobilePanel !== 'none'" class="scrim" @click="mobilePanel = 'none'" />
    </template>
  </div>
</template>

<style scoped>
/* 根节点：app-main 定高后 flex 填充（height:100% 在不定高父级上会退化成
 * auto 被内容撑爆；flex:1 + min-height:0 是定高链的标准写法） */
.reader {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* 阅读器顶栏：纸笺 + 双线界栏 */
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-strong);
  box-shadow: 0 1px 0 var(--paper-edge);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0) 60%),
    var(--paper-deep);
}

.t {
  font-size: 15px;
  font-family: 'KaiTi', 'STKaiti', 'Kaiti SC', '楷体', serif;
  letter-spacing: 1px;
}

.spacer {
  flex: 1;
}

.prog {
  font-size: 12px;
}

/* 朱砂淡底警示签（span 异常/重试） */
.badge-warn {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 2px;
  background: var(--warn-bg);
  color: var(--warn-text);
  border: 1px solid var(--warn-border);
}

.badge-warn.btn {
  font: inherit;
  cursor: pointer;
}

.badge-warn.btn:hover {
  background: #eed9a8;
}

/* 移动端目录/详情切换按钮：桌面隐藏 */
.mbtn {
  display: none;
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 3px 8px;
  background: var(--paper);
  color: var(--ink-soft);
  cursor: pointer;
}

.mbtn:hover {
  border-color: var(--cinnabar);
  color: var(--cinnabar-deep);
}

/* 列容器：桌面为普通网格单元；移动端改为抽屉 */
.col-toc,
.col-detail {
  min-height: 0;
}

/* 中栏卷轴：上轴/纸身/下轴 三段flex */
.col-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.col-toc > *,
.col-detail > * {
  height: 100%;
  min-height: 0;
}

.kw {
  width: 180px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 2px;
  font: inherit;
  font-size: 13px;
  outline: none;
  background: var(--paper);
  color: var(--ink);
}

.kw:focus {
  border-color: var(--ochre);
  box-shadow: 0 0 0 2px var(--gold-tint);
}

.mini {
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 3px 8px;
  color: var(--ink-soft);
  background: var(--paper);
  cursor: pointer;
  font-family: inherit;
}

.mini:hover {
  border-color: var(--cinnabar);
  color: var(--cinnabar-deep);
  background: var(--cinnabar-tint);
}

.mini.on {
  border-color: var(--cinnabar);
  color: var(--cinnabar-deep);
  background: var(--cinnabar-tint);
}

.grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr) 380px;
}

.pad {
  padding: 20px;
}

.err {
  color: #a32d2d;
}

@media (max-width: 1100px) {
  .grid {
    grid-template-columns: 240px minmax(0, 1fr) 320px;
  }
}

@media (max-width: 820px) {
  .mbtn {
    display: inline-flex;
  }

  .grid {
    grid-template-columns: minmax(0, 1fr);
  }

  /* 目录/详情在窄屏变为侧滑抽屉 */
  .col-toc,
  .col-detail {
    position: fixed;
    top: 0;
    bottom: 0;
    width: min(86%, 380px);
    z-index: 40;
    background: var(--bg);
    transition: transform 0.2s ease;
    box-shadow: 0 0 16px rgba(0, 0, 0, 0.18);
  }

  .col-toc {
    left: 0;
    transform: translateX(-105%);
  }

  .col-detail {
    right: 0;
    transform: translateX(105%);
  }

  .col-toc.mobile-open,
  .col-detail.mobile-open {
    transform: translateX(0);
  }

  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.32);
    z-index: 35;
  }
}
</style>
