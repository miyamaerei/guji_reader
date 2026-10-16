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
 *
 * ⚠️ 2026-10-16 修复：onMounted 里 `scroller = scroller?.parentElement` 恒为
 * null（scroller 从未赋过值），滚动监听/测量/视口全部失效——卡片 tab 只渲染
 * 首窗口的行，滚动不再补渲染。现改为模板 ref 绑定自身外壳（.vlist-wrap 即
 * 滚动容器），并新增 resetKey（换数据集才重置；分页追加时不清滚动位置）
 * 与 reach-end（触底向父组件要下一页）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { averageHeight, computeWindow } from '@/core/virtual'

const props = withDefaults(
  defineProps<{ items: T[]; estimateH?: number; resetKey?: string }>(),
  { estimateH: 32, resetKey: '' },
)

const emit = defineEmits<{ (e: 'reach-end'): void }>()

/** 行高缓存：只在渲染过的行上有值 */
const heights = ref(new Map<number, number>())
const scrollTop = ref(0)
const viewportH = ref(600)
/** 是否已量过任何一行；没量过之前一律用 estimateH，避免首帧跳变 */
const measured = ref(false)
const wrapEl = ref<HTMLElement | null>(null)

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

function syncViewport(): void {
  if (!scroller) return
  scrollTop.value = scroller.scrollTop
  measure()
  // 触底（距真实内容底 300px 内）：向父组件要下一页。
  // 用 scrollHeight 而非估算总高——估算偏大时永远到不了「估算底」。
  if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 300)
    emit('reach-end')
}

let timer = 0
function onScroll(): void {
  // 滚动事件高频，节流合帧避免重复计算。
  // 曾用 requestAnimationFrame：隐藏标签页不产帧时 rAF 永不回调，
  // 挂起的 raf id 还会挡后续事件——整个组件假死；定时器无此耦合。
  if (timer) return
  timer = window.setTimeout(() => {
    timer = 0
    syncViewport()
  }, 16)
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

/**
 * 数据集切换（书/层/筛选）重置测量与滚动位。
 * 不能 watch items：分页追加也是 items 变化，一重置滚动位就弹回顶部。
 */
watch(
  () => props.resetKey,
  () => {
    heights.value = new Map()
    measured.value = false
    scrollTop.value = 0
    if (scroller) scroller.scrollTop = 0
  },
)

let ro: ResizeObserver | null = null

onMounted(() => {
  scroller = wrapEl.value
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
  if (timer) clearTimeout(timer)
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
  <div ref="wrapEl" class="vlist-wrap">
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
  /* 自身即滚动容器（模板 ref 绑定；曾经的 parentElement 推导恒为 null）。
   * height:100% 吃满调用方的定高外壳（ListView .vcards），否则高度=内容高，
   * 视口测算等于总高 → 全量渲染，虚拟滚动失效 */
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
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