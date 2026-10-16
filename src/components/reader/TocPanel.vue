<script setup lang="ts">
/**
 * 左栏目录树（P2.3 + P2.4）
 *
 * 树由 chapters.json + book.config.json 推导，分组节点在前端生成，
 * 因此改 groupSize 不需要重跑打包器。
 * 行尾徽标来自 join.json（该条目命中了哪些层），不是写死的 R/P/E/S/T。
 */
import { computed, ref, watch } from 'vue'
import TreeNav from '@/components/common/TreeNav.vue'
import { layerTags } from '@/core/layerSchema'
import { buildTocTree } from '@/core/toc'
import type { TreeNodeTag } from '@/core/tree'
import { useBookStore } from '@/stores/bookContext'
import { useLayerStore } from '@/stores/layers'
import { useTocStore } from '@/stores/toc'
import type { ChapterNode, JoinRow } from '@/core/types'

const props = defineProps<{ bookId: string; chapters: ChapterNode[] }>()
const emit = defineEmits<{ select: [iid: string] }>()

const book = useBookStore()
const toc = useTocStore()
const layers = useLayerStore()

const rowMap = ref<Map<string, JoinRow>>(new Map())
const ready = ref(false)

/**
 * join 行（目录徽标）按**路由 bookId** 取，不用 book.currentBookId——
 * 子组件 mounted 早于父级 ReaderView 的 setBook，读 currentBookId 会拿到 ''
 * （GET /api/books//join 404 + Vue mounted warn，每次进阅读器必现，走查 2026-10-13）。
 * 同时监听 bookId 变化：同路由换书时组件不重建，旧书的 join 行必须换掉。
 */
watch(
  () => props.bookId,
  async (id) => {
    if (!id) return
    ready.value = false
    try {
      const jf = await layers.join(id)
      rowMap.value = new Map(jf.rows.map((r) => [r.item_id, r]))
    } catch {
      rowMap.value = new Map()
    }
    ready.value = true
  },
  { immediate: true },
)

const tags = computed(() => (book.config ? layerTags(book.config) : []))

function tagOf(iid: string): TreeNodeTag[] {
  const row = rowMap.value.get(iid)
  if (!row) return []
  const out: TreeNodeTag[] = []
  for (const t of tags.value) {
    const n = row.ids?.[t.id]?.length ?? 0
    if (n) out.push({ text: t.tag, title: `${t.label} · ${n} 条`, tone: 'layer' })
  }
  return out
}

const built = computed(() => {
  if (!book.config) return null
  return buildTocTree(props.chapters, {
    tree: book.config.structure.tree,
    groupSize: book.config.structure.groupSize,
    tagOf: ready.value ? tagOf : undefined,
  })
})

watch(
  built,
  (b) => {
    if (!b || !book.config) return
    toc.setIndex(b.nodes, b.index, book.config.structure.groupSize)
    // 默认展开哪一卷由 ReaderView 决定（它才知道从哪卷开始读），这里不抢
  },
  { immediate: true },
)

const total = computed(() => props.chapters.reduce((s, c) => s + c.count, 0))

/** 当前聚焦卷所属的模式徽标（P3.7）：无 VOL 时 volProfile 为 null，不显示 */
const focusMode = computed(() => {
  if (!book.volProfile) return null
  const vol = (toc.focusItem || '').slice(0, 2)
  if (!vol) return null
  const key = book.volProfile.byVolume[vol]
  return book.volProfile.modes.find((m) => m.key === key) ?? null
})
</script>

<template>
  <aside class="toc">
    <div class="head">
      <strong>目录</strong>
      <span class="muted">{{ total }} 条</span>
      <span v-if="focusMode" class="vbadge" :title="`卷模式：${focusMode.label}`">{{ focusMode.label }}</span>
      <span class="spacer" />
      <button class="mini" @click="toc.expandAll(1)">展开卷</button>
      <button class="mini" @click="toc.collapseAll()">收起</button>
    </div>
    <TreeNav
      v-if="built"
      :nodes="built.nodes"
      :open="toc.openKeys"
      :current="toc.focusItem"
      :query="toc.searchTerm"
      placeholder="搜索条目编号或摘要…"
      @update:query="toc.searchTerm = $event"
      @toggle="toc.toggle($event)"
      @select="(n) => n.iid && emit('select', n.iid)"
    />
  </aside>
</template>

<style scoped>
/* 左栏：纸面 + 右缘双线（与卷轴纸身相接） */
.toc {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0) 30%),
    var(--paper);
  border-right: 1px solid var(--border-strong);
  box-shadow: 1px 0 0 var(--paper-edge);
}

.toc > :deep(.tree) {
  flex: 1;
  min-height: 0;
  padding: 6px;
}

.head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-strong);
  box-shadow: 0 1px 0 var(--paper-edge);
  font-size: 13px;
}

.head strong {
  font-family: 'KaiTi', 'STKaiti', 'Kaiti SC', '楷体', serif;
  letter-spacing: 2px;
}

.spacer {
  flex: 1;
}

/* 卷模式徽标：朱砂小印 */
.vbadge {
  font-size: 11px;
  padding: 0 7px;
  border-radius: 2px;
  background: var(--cinnabar);
  color: #f8efdc;
  line-height: 1.7;
  border: 1px solid var(--cinnabar-deep);
}

.mini {
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border);
  background: var(--paper);
  border-radius: 2px;
  padding: 1px 7px;
  cursor: pointer;
  color: var(--ink-soft);
}

.mini:hover {
  border-color: var(--cinnabar);
  color: var(--cinnabar-deep);
  background: var(--cinnabar-tint);
}
</style>
