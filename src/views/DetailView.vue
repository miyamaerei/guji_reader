<script setup lang="ts">
/**
 * 整页详情（P2.6 / P2.7）
 *
 * 与右栏详情面板是同一套组件、同一套 selection 语义：
 *   /detail/:book/item/:iid      条目全层表
 *   /detail/:book/entity/:eid    实体
 *   /detail/:book/<layerId>/:id  层记录
 */
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EntityDetail from '@/components/reader/EntityDetail.vue'
import ItemDetail from '@/components/reader/ItemDetail.vue'
import LayerRecordDetail from '@/components/reader/LayerRecordDetail.vue'
import { useBookStore } from '@/stores/bookContext'
import { useCrumbsStore } from '@/stores/crumbs'
import { useLayerStore } from '@/stores/layers'

const route = useRoute()
const router = useRouter()
const book = useBookStore()
const crumbs = useCrumbsStore()
const layers = useLayerStore()

const bookId = computed(() => String(route.params.book ?? ''))
const kind = computed(() => String(route.params.kind ?? ''))
const id = computed(() => String(route.params.id ?? ''))

/** kind 不是 item/entity 时，按层 id 处理（层 id 由 book.config.json 声明） */
const asLayer = computed(() => {
  if (kind.value === 'item' || kind.value === 'entity') return null
  return book.config?.layers.find((l) => l.id === kind.value) ?? null
})

const title = computed(() => {
  if (kind.value === 'item') return `条目 ${id.value}`
  if (kind.value === 'entity') return `实体 ${id.value}`
  return `${asLayer.value?.label ?? kind.value} ${id.value}`
})

async function ensureBook(): Promise<void> {
  if (!bookId.value) return
  if (book.currentBookId !== bookId.value) {
    await book.setBook(bookId.value)
    await layers.join(bookId.value)
    crumbs.push({ label: book.config?.title ?? bookId.value, to: `/reader/${bookId.value}` })
  }
}

onMounted(async () => {
  await book.init()
  await ensureBook()
})
watch(bookId, ensureBook)

function back(): void {
  router.push(`/reader/${bookId.value}`)
}

function openRecord(layer: string, id: string): void {
  router.push(`/detail/${bookId.value}/${layer}/${id}`)
}
</script>

<template>
  <div class="page detail-view">
    <header class="head">
      <button class="mini" @click="back">← 阅读器</button>
      <strong>{{ title }}</strong>
      <span class="muted">{{ book.config?.title }}</span>
    </header>
    <div class="panel">
      <ItemDetail
        v-if="kind === 'item'"
        :iid="id"
        @jump="router.push(`/reader/${bookId}?iid=${$event}`)"
        @open-record="openRecord"
        @ref="() => {}"
      />
      <EntityDetail
        v-else-if="kind === 'entity'"
        :eid="id"
        @jump="router.push(`/reader/${bookId}?iid=${$event}`)"
      />
      <LayerRecordDetail
        v-else
        :layer="kind"
        :id="id"
        @jump="router.push(`/reader/${bookId}?iid=${$event}`)"
        @ref="() => {}"
      />
    </div>
  </div>
</template>

<style scoped>
.detail-view {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mini {
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 8px;
  background: #fff;
  cursor: pointer;
  color: var(--text-soft);
}

.mini:hover {
  border-color: var(--book-primary);
  color: var(--book-primary);
}

.panel {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
}
</style>
