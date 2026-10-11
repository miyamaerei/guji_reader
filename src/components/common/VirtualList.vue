<script setup lang="ts" generic="T">
/**
 * 虚拟滚动列表（P5.2）
 *
 * 替换 P2 的 `InfiniteList`：分页追加是只增不减——滚到底部时 2253 行全留在
 * DOM 里，节点数无上限；每追加一批还要全量重排，长列表必然卡顿。
 * 这里只保留视口内的行（±overscan），DOM 规模与总量无关。
 *
 * 行高策略：古籍条目行高不固定（正文长短、书证折叠都影响），故用
 * 「测量缓存 + 均值兜底」——渲染后量真实高度写回缓存，未量过的按均值估算。
 * 纯逻辑（窗口计算）在 core/virtual.ts，有单测保护。
 *
 * 用法与 InfiniteList 兼容（items + 默认插槽），故调用方无需改。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { averageHeight, computeWindow } from '@/core/virtual'

const props = withDefaults(defineProps<{ items: T[]; estimateH?: number }>(), { estimateH: 32 })

/** 行高缓存：只在渲染过的行上有值 */
const heights = ref(new Map<number, number>())
const scrollTop = ref(0)
const viewportH = ref(600)
/** 是否已量过任何一行；没量过之前一律用 estimateH，避免首帧跳变 */
const measured = ref(false)

const win = computed(() =>
  computeWindow({
    scrollTop: scrollTop.value,
    viewportH: viewportH.value,
    total: props.items.length,
    heights: heights.value,
    avgH: measured.value ? averageHeight(heights.value, props.estimateH) : props.estimateH,
  }),
)

/** 视口内的行（含 overscan），带原始下标供测量用 */
const slice = computed(() => {
  const { start, end } = win.value
  const out: { item: T; index: number }[] = []
  for (let i = start; i < end; i++) out.push({ item: props.items[i], index: i })
  return out
})

/** 行间补白：把估算高度与实测高度的差补上，避免滚动条比例失真 */
function spacerBefore(index: number): number {
  const { heights: hs } = { heights: heights.value }
  let acc = 0
  const avg = measured.value ? averageHeight(hs, props.estimateH) : props.estimateH
  for (let i = 0; i < index; i++) acc += hs.get(i) ?? avg
  return acc
}

let scroller: HTMLElement | null = null
let raf = 0

function onScroll(): void {
  // 滚动事件高频，用 rAF 合帧避免重复计算
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    if (scroller) scrollTop.value = scroller.scrollTop
  })
}

/** 渲染后量真实行高写回缓存（仅量视口内的行，成本可控） */
function measure(): void {
  if (!scroller) return
  const rows = scroller.querySelectorAll<HTMLElement>('[data-vrow]')
  if (!rows.length) return
  let changed = false
  const next = new Map(heights.value)
  for (const el of rows) {
    const idx = Number(el.dataset.vrow)
    const h = el.offsetHeight
    // 偏差超过 0.5px 才更新，避免测量抖动引发重排循环
    if (h > 0 && Math.abs((next.get(idx) ?? 0) - h) > 0.5) {
      next.set(idx, h)
      changed = true
    }
  }
  if (changed) {
    heights.value = next
    measured.value = true
  }
}

/** 把某行滚进视口（外部调用，如「定位到第 N 条」） */
function scrollToIndex(index: number): void {
  if (!scroller) return
  const avg = measured.value ? averageHeight(heights.value, props.estimateH) : props.estimateH
  let off = 0
  for (let i = 0; i < index; i++) off += heights.value.get(i) ?? avg
  scroller.scrollTop = off
}

defineExpose({ scrollToIndex })

/** 条目集变化：高度缓存与滚动位置全部失效 */
watch(
  () => props.items,
  () => {
    heights.value = new Map()
    measured.value = false
    scrollTop.value = 0
    if (scroller) scroller.scrollTop = 0
  },
)

let ro: ResizeObserver | null = null

onMounted(() => {
  scroller = (scroller?.parentElement as HTMLElement) ?? null
  if (!scroller) return
  viewportH.value = scroller.clientHeight || 600
  scroller.addEventListener('scroll', onScroll, { passive: true })
  ro = new ResizeObserver(() => {
    viewportH.value = scroller?.clientHeight || 600
  })
  ro.observe(scroller)
  measure()
})

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
  scroller?.removeEventListener('scroll', onScroll)
  ro?.disconnect()
  ro = null
  scroller = null
})
</script>

<template>
  <!--
    外层占满父容器高度并自己滚动；内层用一个撑高的容器制造滚动条。
    这与 <table> 语义冲突，所以本组件用于列表/卡片场景；
    表格场景请用 InfiniteList（表格行不宜脱离 tbody 单独定位）。
  -->
  <div class="vlist-wrap">
    <div class="vlist" :style="{ height: `${win.totalHeight}px` }">
      <div
        v-for="row in slice"
        :key="row.index"
        data-vrow
        class="vrow"
        :style="{ transform: `translateY(${spacerBefore(row.index)}px)` }"
      >
        <slot :item="row.item" :index="row.index" />
      </div>
    </div>
    <p class="vstat muted">
      第 {{ win.start + 1 }}–{{ win.end }} 行 / 共 {{ items.length }} 条（仅渲染视口内
      {{ slice.length }} 行）
    </p>
  </div>
</template>

<style scoped>
.vlist-wrap {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.vlist {
  position: relative;
  width: 100%;
}
.vrow {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  will-change: transform;
}
.vstat {
  padding: 6px 0 2px;
  text-align: center;
  font-size: 11px;
  flex-shrink: 0;
}
.muted {
  color: var(--text-soft);
}
</style>