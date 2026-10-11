<script setup lang="ts">
/**
 * 流程图与状态机（P4.2）
 *
 * proc 层的 steps 是真流程链：step.next 指向下一个 step_id 或字面量 'END'，
 * 所以图不用猜——直接按 next 建有向边，用 ECharts graph 的箭头表达方向。
 * 'END' 收成共享终点节点，这样「流程在哪收口」在图上可见（纯列表看不出来）。
 *
 * 为什么用 graph + 显式坐标而不是 cartesian 折线：
 * 流程图的本分是**有向**。cartesian lines 画不出箭头，方向只能靠连线顺序暗示；
 * graph 的 symbolSize/edgeSymbol 天然表达有向，且节点 tooltip 能带出
 * 执行者与条件（列表给不了的上下文）。
 *
 * 补充两块纯列表给不了的信息：
 *  · 状态机标签 states（仅 96/274 条有值）
 *  · 同 event_type 的流程族可切换（对比同一政务类型的不同规范流程）
 */
import { computed, onMounted, ref } from 'vue'
import type { EChartsOption } from 'echarts'
import { useChart } from '@/composables/useChart'
import { buildProcGraph } from '@/core/xinguanBlocks'
import type { LayerRecord } from '@/core/types'

const props = defineProps<{ record: LayerRecord; all: LayerRecord[] | null }>()
const emit = defineEmits<{ jump: [iid: string] }>()

/** 起始 / 中间 / 收口 三类节点配色 */
const CATS = ['#0f6e56', '#185fa5', '#a32d2d']

const graph = computed(() => buildProcGraph(props.record))

/** 同 event_type 的其他流程（不含自身） */
const relatives = computed(() => {
  const t = String(props.record.event_type ?? '')
  if (!t) return []
  return (props.all ?? []).filter(
    (r) => String(r.event_type ?? '') === t && String(r.id) !== String(props.record.id),
  )
})

const el = ref<HTMLElement | null>(null)

const option = computed<EChartsOption>(() => {
  const g = graph.value
  const real = g.nodes.filter((n) => n.id !== 'END')
  // 横向均匀排布：x 按步骤序号，y 固定中线（链条本身是线性的）
  const width = Math.max(560, real.length * 130)
  return {
    tooltip: {
      formatter: (p: unknown) => {
        const d = (p as { data?: { detail?: { label: string; action: string; agent: string; condition: string } } })
          .data
        const s = d?.detail
        if (!s) return String((p as { name?: string }).name ?? '')
        return (
          `<b>${s.label}</b>` +
          (s.action ? `<br/>动作：${s.action}` : '') +
          (s.agent ? `<br/>执行：${s.agent}` : '') +
          (s.condition ? `<br/>条件：${s.condition}` : '')
        )
      },
    },
    series: [
      {
        type: 'graph',
        layout: 'none',
        roam: false,
        width,
        height: 120,
        categories: [
          { name: '起始', itemStyle: { color: CATS[0] } },
          { name: '中间步骤', itemStyle: { color: CATS[1] } },
          { name: '收口', itemStyle: { color: CATS[2] } },
        ],
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: 7,
        edgeLabel: { show: false },
        label: {
          show: true,
          position: 'bottom',
          distance: 6,
          fontSize: 11,
          color: '#5f5e5a',
          formatter: (p: { name?: string }) => p.name ?? '',
        },
        lineStyle: { color: '#8f8d85', width: 1.4, curveness: 0 },
        data: g.nodes.map((n, i) => ({
          id: n.id,
          name: n.label,
          category: n.kind,
          symbolSize: n.id === 'END' ? 34 : 46,
          x: (i * width) / Math.max(1, g.nodes.length - 1),
          y: 60,
          detail: { label: n.label, action: n.state, agent: n.agent, condition: n.condition },
          iid: String(props.record.item_id ?? ''),
        })),
        links: g.links.map((l) => ({ source: l.source, target: l.target })),
      },
    ],
  }
})

const { chart } = useChart(el, option)

onMounted(() => {
  chart.value?.on('click', () => emit('jump', String(props.record.item_id ?? '')))
})
</script>

<template>
  <div class="proc-flow">
    <div class="head">
      <span class="cap">流程链</span>
      <span class="meta">
        {{ graph.nodes.filter((n) => n.id !== 'END').length }} 步
        <template v-if="graph.states.length"> · 状态机 {{ graph.states.length }} 态</template>
      </span>
      <span class="legend">
        <i class="dot s0" />起始<i class="dot s1" />步骤<i class="dot s2" />收口
      </span>
    </div>

    <p v-if="!graph.nodes.length" class="muted">该记录无步骤数据。</p>
    <div v-else ref="el" class="chart"></div>

    <div v-if="graph.states.length" class="states">
      <span class="lbl">状态机：</span>
      <span v-for="(s, i) in graph.states" :key="i" class="st">{{ s }}</span>
    </div>

    <p v-if="graph.dangling.length" class="warn">
      ⚠ 有 {{ graph.dangling.length }} 处 next 指向不存在的步骤（{{ graph.dangling.join('、') }}），已跳过。
    </p>
    <p v-if="graph.cyclic" class="warn">⚠ 步骤链检出环，图中按原始指针绘制，可能存在往复。</p>

    <div v-if="relatives.length" class="family">
      <span class="lbl">同「{{ record.event_type }}」其他流程：</span>
      <button
        v-for="r in relatives.slice(0, 8)"
        :key="String(r.id)"
        class="chip"
        @click="emit('jump', String(r.item_id))"
      >
        {{ r.title || r.id }}
      </button>
      <span v-if="relatives.length > 8" class="lbl">…共 {{ relatives.length }} 条</span>
    </div>
  </div>
</template>

<style scoped>
.proc-flow {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 10px;
  background: var(--bg-soft);
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.cap {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-soft);
}
.meta {
  font-size: 11px;
  color: var(--text-soft);
}
.legend {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--text-soft);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  margin-left: 5px;
}
.s0 { background: #0f6e56; }
.s1 { background: #185fa5; }
.s2 { background: #a32d2d; }

.chart {
  width: 100%;
  height: 120px;
  overflow-x: auto;
  overflow-y: hidden;
}
.states {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  margin-top: 6px;
}
.lbl {
  font-size: 12px;
  color: var(--text-soft);
}
.st {
  font-size: 11px;
  padding: 0 6px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: #fff;
}
.chip {
  font: inherit;
  font-size: 11px;
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 10px;
  padding: 1px 7px;
  cursor: pointer;
  color: var(--book-primary);
}
.family {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--border);
}
.warn {
  margin: 4px 0 0;
  font-size: 11px;
  color: #854f0b;
}
.muted {
  font-size: 12px;
  color: var(--text-soft);
  margin: 0;
}
</style>