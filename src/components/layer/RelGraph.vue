<script setup lang="ts">
/**
 * 人物关系图（P3.4）
 *
 * 以当前关系的两个人物为中心做邻域子图（BFS 2 跳）；单向关系画箭头、按关系类型着色。
 * 点节点 → 以该人物为中心重聚焦；「显示全部」展开全书 126 条关系。节点过多时靠聚焦子图降噪。
 */
import { computed, onMounted, ref } from 'vue'
import type { EChartsOption } from 'echarts'
import { useChart } from '@/composables/useChart'
import { buildRelSubgraph, textOf } from '@/core/layerBlocks'
import type { LayerRecord } from '@/core/types'

const props = defineProps<{ record: LayerRecord; all: LayerRecord[] | null }>()

/** 关系簇色板（「宣纸墨卷」：赭金/朱砂/青黛/木轴循环，纸面可辨） */
const PALETTE = [
  '#9c2b23',
  '#3f5a6b',
  '#b08d4f',
  '#6b4a2b',
  '#7c1f18',
  '#8a6a35',
  '#5a5245',
  '#c9a86a',
  '#4a6b5a',
  '#6d8899',
  '#a85c2e',
  '#8c7a9e',
]

const seedA = textOf(props.record.person_a)
const seedB = textOf(props.record.person_b)
const focus = ref('')
const showAll = ref(false)

const allNames = computed(() => {
  const s = new Set<string>()
  for (const r of props.all ?? []) {
    const a = textOf(r.person_a)
    const b = textOf(r.person_b)
    if (a) s.add(a)
    if (b) s.add(b)
  }
  return [...s]
})

const graph = computed(() => {
  const seeds = showAll.value
    ? allNames.value
    : focus.value
      ? [focus.value]
      : [seedA, seedB].filter(Boolean)
  return buildRelSubgraph(props.all ?? [], seeds, showAll.value ? 99 : 2)
})

const typeColor = computed(() => {
  const m: Record<string, string> = {}
  graph.value.categories.forEach((c, i) => (m[c] = PALETTE[i % PALETTE.length]))
  return m
})

const el = ref<HTMLElement | null>(null)

const option = computed<EChartsOption>(() => {
  const g = graph.value
  return {
    tooltip: {
      formatter: (p: unknown) => {
        const pp = p as { dataType?: string; name?: string; data?: { type?: string; directed?: boolean } }
        if (pp.dataType === 'edge') return `${pp.data?.type ?? ''}${pp.data?.directed ? '（单向）' : '（双向）'}`
        return pp.name ?? ''
      },
    },
    legend: g.categories.length
      ? { data: g.categories, top: 0, type: 'scroll', textStyle: { fontSize: 11 } }
      : undefined,
    series: [
      {
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        top: g.categories.length ? 28 : 8,
        force: { repulsion: 120, edgeLength: 90, gravity: 0.08 },
        label: { show: true, fontSize: 11, color: '#2e2a23' },
        emphasis: { focus: 'adjacency', label: { fontSize: 12 } },
        categories: g.categories.map((c) => ({ name: c })),
        data: g.nodes.map((n) => ({
          name: n.name,
          category: n.category,
          itemStyle: { color: n.category >= 0 ? PALETTE[n.category % PALETTE.length] : '#9a8c72' },
        })),
        links: g.links.map((l) => ({
          source: l.source,
          target: l.target,
          type: l.type,
          directed: l.directed,
          symbol: l.directed ? ['none', 'arrow'] : ['none', 'none'],
          lineStyle: {
            color: typeColor.value[l.type] ?? '#a08a5c',
            width: 1.4,
            curveness: 0.08,
          },
        })),
      },
    ],
  }
})

const { chart } = useChart(el, option)

onMounted(() => {
  chart.value?.on('click', (p: unknown) => {
    const pp = p as { dataType?: string; name?: string }
    if (pp.dataType === 'node' && pp.name) {
      focus.value = pp.name
      showAll.value = false
    }
  })
})
</script>

<template>
  <div class="rel-graph">
    <div class="bar">
      <button class="mini" :class="{ on: showAll }" @click="showAll = !showAll">
        {{ showAll ? '聚焦子图' : '显示全部 126 条' }}
      </button>
      <button
        v-if="focus || showAll"
        class="mini"
        @click="(focus = ''), (showAll = false)"
      >
        回到本关系
      </button>
      <span class="ctx">中心：{{ focus || `${seedA} ↔ ${seedB}` }}</span>
    </div>
    <div ref="el" class="chart"></div>
    <p v-if="!graph.nodes.length" class="muted">无关系数据可绘制。</p>
  </div>
</template>

<style scoped>
.rel-graph {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bar {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.mini {
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border);
  background: var(--paper);
  border-radius: 2px;
  padding: 1px 8px;
  cursor: pointer;
}
.mini.on {
  border-color: var(--cinnabar);
  color: var(--cinnabar-deep);
  background: var(--cinnabar-tint);
}
.ctx {
  font-size: 12px;
  color: var(--ink-faint);
}
.chart {
  width: 100%;
  height: 280px;
}
.muted {
  font-size: 12px;
  color: var(--ink-faint);
  margin: 0;
}
</style>
