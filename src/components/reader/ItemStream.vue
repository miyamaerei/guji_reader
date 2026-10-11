<script setup lang="ts">
/**
 * 正文流（P2.5）
 *
 * 三件事，且三者互不干扰：
 *  1. 滚动续接：触底哨兵 → 请求下一卷 chunk（由父组件加载后追加）
 *  2. focusItem：滚动时算出「视口顶部是哪个条目」
 *  3. 定位滚动：外部（目录点击 / 搜索回跳）给 scrollTo，滚完立刻 emit 清空，
 *     不写回 focus，杜绝「滚动 → 高亮 → 又滚动」的回环抖动
 *
 * ⚠️ 第 2 点最初用 IntersectionObserver + 百分比 rootMargin 定义「顶部窄带」，
 * 实测在元素 root 上不可靠（正文停在 01-001，目录却高亮 01-004）。
 * 现在改为：条目位置在一次布局后缓存（进卷时算一次，不是每帧算），
 * 滚动时只做一次数组比较——确定、可推理，也不做逐帧 getBoundingClientRect。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ItemCard from './ItemCard.vue'
import type { EntitySpan, ItemRecord } from '@/core/types'
import type { TreeNodeTag } from '@/core/tree'

const props = withDefaults(
  defineProps<{
    items: ItemRecord[]
    colors?: Record<string, string>
    tagOf?: (iid: string) => TreeNodeTag[]
    activeIid?: string | null
    highlightEid?: string | null
    /** 待定位条目，滚完由父组件清空 */
    scrollTo?: string | null
    loading?: boolean
    hasMore?: boolean
    emptyText?: string
    /** 全局译文开关（P3.6）：透传给每条卡片 */
    forceShowTrans?: boolean
  }>(),
  {
    colors: () => ({}),
    activeIid: null,
    highlightEid: null,
    scrollTo: null,
    loading: false,
    hasMore: false,
    emptyText: '尚未加载任何条目',
    forceShowTrans: false,
  },
)

const emit = defineEmits<{
  select: [iid: string]
  pick: [span: EntitySpan]
  focus: [iid: string | null]
  reachEnd: []
  scrolled: []
}>()

const scroller = ref<HTMLElement | null>(null)
const sentinel = ref<HTMLElement | null>(null)

/** 条目 iid → 相对滚动容器内容顶部的位置（像素），按序排列 */
let tops: { iid: string; top: number }[] = []
let endObserver: IntersectionObserver | null = null
let rafId = 0

function tagsFor(iid: string): TreeNodeTag[] {
  return props.tagOf?.(iid) ?? []
}

/** 一次性测量所有卡片位置。只有条目集合变化时调用。 */
function measure(): void {
  const root = scroller.value
  if (!root) return
  const rootTop = root.getBoundingClientRect().top - root.scrollTop
  tops = []
  root.querySelectorAll<HTMLElement>('[data-iid]').forEach((el) => {
    const iid = el.dataset.iid
    if (iid) tops.push({ iid, top: el.getBoundingClientRect().top - rootTop })
  })
}

/** 视口顶部所指的条目：位置不超过「滚动量 + 余量」的最后一个 */
function currentIid(): string | null {
  const root = scroller.value
  if (!root || !tops.length) return null
  // 余量 24px：抵消 scroll-margin-top(12px) 与容器 padding(12px) 的偏差
  const probe = root.scrollTop + 24
  let hit: string | null = null
  for (const t of tops) {
    if (t.top <= probe) hit = t.iid
    else break
  }
  return hit ?? tops[0]?.iid ?? null
}

function onScroll(): void {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    emit('focus', currentIid())
  })
}

onMounted(() => {
  const root = scroller.value
  root?.addEventListener('scroll', onScroll, { passive: true })
  if (root && sentinel.value && typeof IntersectionObserver !== 'undefined') {
    endObserver = new IntersectionObserver(
      (entries) => {
        // items 为空时不放行：此时哨兵天然在视口内，会在首卷加载前误触发续接
        if (
          entries.some((e) => e.isIntersecting) &&
          props.hasMore &&
          !props.loading &&
          props.items.length
        ) {
          emit('reachEnd')
        }
      },
      { root, rootMargin: '300px' },
    )
    endObserver.observe(sentinel.value)
  }
  measure()
  emit('focus', currentIid())
})

onBeforeUnmount(() => {
  scroller.value?.removeEventListener('scroll', onScroll)
  endObserver?.disconnect()
  if (rafId) cancelAnimationFrame(rafId)
})

watch(
  () => props.items.length,
  async () => {
    await nextTick()
    measure()
    emit('focus', currentIid())
  },
)

watch(
  () => props.scrollTo,
  async (iid) => {
    if (!iid) return
    await nextTick()
    const el = scroller.value?.querySelector<HTMLElement>(`[data-iid="${iid}"]`)
    if (el) el.scrollIntoView({ block: 'start', behavior: 'auto' })
    measure()
    emit('focus', iid)
    emit('scrolled')
  },
)

function scrollTop(): void {
  if (scroller.value) scroller.value.scrollTop = 0
}

defineExpose({ scrollTop, measure })
</script>

<template>
  <div ref="scroller" class="stream">
    <p v-if="!items.length && !loading" class="empty">{{ emptyText }}</p>
    <ItemCard
      v-for="it in items"
      :key="it.iid"
      :item="it"
      :colors="colors"
      :tags="tagsFor(it.iid)"
      :active="it.iid === activeIid"
      :highlight-eid="highlightEid"
      :force-show-trans="forceShowTrans"
      @select="emit('select', $event)"
      @pick="emit('pick', $event)"
      @resize="
        async () => {
          await nextTick()
          measure()
        }
      "
    />
    <div ref="sentinel" class="sentinel">
      <span v-if="loading" class="muted">加载中…</span>
      <span v-else-if="hasMore" class="muted">继续下滚加载下一卷</span>
      <span v-else-if="items.length" class="muted">已到全书末尾</span>
    </div>
  </div>
</template>

<style scoped>
.stream {
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  background: var(--bg-soft);
}

.empty {
  margin: 24px;
  text-align: center;
  color: var(--text-soft);
}

.sentinel {
  padding: 14px 0 40px;
  text-align: center;
  font-size: 12px;
}
</style>
