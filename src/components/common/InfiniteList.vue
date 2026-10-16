<script setup lang="ts" generic="T">
/**
 * 无限滚动列表（渲染分批：按页渲染 + 触底追加）
 *
 * 曾经的缺陷（走查 2026-10-16）：IntersectionObserver 只在「相交状态变化」时
 * 回调一次，limit += pageSize 插入新行后哨兵被推出视口（离开相交），
 * 之后必须再滚出去又滚回来才会触发——表现为筛选后卡在「已显示 200 / 2975」。
 * 修法：fill() 自续——只要哨兵仍在视口内就继续追加，直到它被推出或取完。
 * 可见性用 getBoundingClientRect 直接判定：真实滚动容器是 .page（定高链），
 * 不是 viewport，但 .page 本身恒在 viewport 内，rect 判定对任意祖先滚动都成立。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{ items: T[]; pageSize?: number; resetKey?: string }>(),
  { pageSize: 100, resetKey: '' },
)

const emit = defineEmits<{ (e: 'reach-end'): void }>()

const limit = ref(props.pageSize)
const rootEl = ref<HTMLElement | null>(null)
const sentinel = ref<HTMLElement | null>(null)

const shown = computed(() => props.items.slice(0, limit.value))
const hasMore = computed(() => limit.value < props.items.length)

/** 哨兵是否落在视口（含 200px 预加载边距）内 */
function sentinelVisible(): boolean {
  const el = sentinel.value
  if (!el) return false
  const r = el.getBoundingClientRect()
  const h = window.innerHeight || document.documentElement.clientHeight
  return r.bottom > -200 && r.top < h + 200
}

let filling = false
/** 自续填充：追加 → 等 DOM 落地 → 哨兵仍可见则继续 */
async function fill(): Promise<void> {
  if (filling) return
  filling = true
  try {
    while (hasMore.value && sentinelVisible()) {
      limit.value += props.pageSize
      await nextTick()
    }
    // 本地渲染已尽而哨兵仍在视口：向父组件要下一页（服务端分页场景）。
    // 父组件负责幂等（loading/取满即返回），这里只管喊。
    if (!hasMore.value && sentinelVisible()) emit('reach-end')
  } finally {
    filling = false
  }
}

/**
 * 数据集切换（resetKey 变）才回到首页渲染。
 * 不 watch items：分页追加也是 items 变化，重置会把用户弹回顶部。
 */
watch(
  () => props.resetKey,
  () => {
    limit.value = props.pageSize
    void fill()
  },
)

let io: IntersectionObserver | null = null
/**
 * 双触发：IO（带 200px 预加载）+ 捕获阶段 scroll 兜底。
 * IO 回调要等渲染帧，快速甩动可能冲过哨兵；scroll 兜底即时且 fill 幂等
 * （filling 互斥 + 纯 rect 判定），成本是一次 getBoundingClientRect。
 */
function onScrollFallback(): void {
  void fill()
}
onMounted(async () => {
  const el = sentinel.value
  if (el && typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void fill()
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
  }
  document.addEventListener('scroll', onScrollFallback, { capture: true, passive: true })
  await nextTick()
  void fill()
})

onBeforeUnmount(() => {
  io?.disconnect()
  document.removeEventListener('scroll', onScrollFallback, { capture: true })
})
</script>

<template>
  <div ref="rootEl" class="infinite">
    <slot v-for="(item, i) in shown" :key="i" :item="item" :index="i" />
    <div ref="sentinel" class="sentinel">
      <span v-if="hasMore" class="muted">已显示 {{ shown.length }} / {{ items.length }}，继续滚动加载…</span>
      <span v-else class="muted">共 {{ items.length }} 条</span>
    </div>
  </div>
</template>

<style scoped>
.infinite {
  display: contents;
}

.sentinel {
  padding: 10px 0;
  text-align: center;
  font-size: 12px;
}
</style>
