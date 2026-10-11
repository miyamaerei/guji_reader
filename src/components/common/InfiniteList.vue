<script setup lang="ts" generic="T">
/**
 * 无限滚动列表（P2 的渲染保护，P5 再换真虚拟滚动）
 *
 * 水东 ent 层 2253 条、join 1192 行——一次性铺开会卡死。
 * 这里按页渲染 + 触底追加，保证首屏只画 100 行。
 * 与 P5 的虚拟滚动是同一接口，届时只换实现不改调用方。
 */
import { computed, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ items: T[]; pageSize?: number }>(), { pageSize: 100 })

const limit = ref(props.pageSize)
const sentinel = ref<HTMLElement | null>(null)

const shown = computed(() => props.items.slice(0, limit.value))
const hasMore = computed(() => limit.value < props.items.length)

watch(
  () => props.items,
  () => {
    limit.value = props.pageSize
  },
)

onMounted(() => {
  const el = sentinel.value
  if (!el || typeof IntersectionObserver === 'undefined') return
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting) && hasMore.value) {
        limit.value += props.pageSize
      }
    },
    { rootMargin: '200px' },
  )
  io.observe(el)
})
</script>

<template>
  <div class="infinite">
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
