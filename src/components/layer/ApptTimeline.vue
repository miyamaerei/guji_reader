<script setup lang="ts">
/**
 * 任职时间线（P3.1）
 *
 * 以「当前记录的任职人物」为中心，聚合其在全书中多段任职，按条目时序（卷序）排成
 * 横向多段条，每段按状态着色，点击跳到对应条目。下方列出书中「有多段任职」的人物，
 * 点选即切换时间线主体。
 *
 * 说明：源数据的 `when` 多为「未明」或非数值纪年，无法做精确年代刻度，故时间轴用
 * 条目序号（卷序，大体 Chronological）作为次序依据，分段等宽；精确年份在 tooltip 里展示。
 */
import { computed, onMounted, ref } from 'vue'
import type { EChartsOption } from 'echarts'
import { useChart } from '@/composables/useChart'
import { buildApptTimeline, textOf, type ApptSegment } from '@/core/layerBlocks'
import type { LayerRecord } from '@/core/types'

const props = defineProps<{ record: LayerRecord; all: LayerRecord[] | null }>()
const emit = defineEmits<{ jump: [iid: string] }>()

const STATUS_COLORS: Record<string, string> = {
  现任: '#185fa5',
  致仕: '#0f6e56',
  升迁: '#534ab7',
  贬谪: '#a32d2d',
  罢黜: '#7b1fa2',
  兼领: '#0d9488',
  暂代: '#854f0b',
  追赠: '#9c6644',
  未明: '#888780',
}
function colorOf(status: string): string {
  return STATUS_COLORS[status] ?? '#888780'
}

const personText = textOf(props.record.person)
const focus = ref(personText)

const result = computed(() =>
  buildApptTimeline(props.all ?? [], focus.value || personText),
)
const segments = computed<ApptSegment[]>(() => result.value.segments)
const people = computed(() => result.value.people)

const el = ref<HTMLElement | null>(null)

const option = computed<EChartsOption>(() => {
  const segs = segments.value
  return {
    grid: { left: 8, right: 12, top: 28, bottom: 8, containLabel: true },
    tooltip: {
      formatter: (p: unknown) => {
        const d = (p as { data?: { appt?: ApptSegment } }).data
        if (!d?.appt) return ''
        const a = d.appt
        return `<b>${a.office || '（官职未明）'}</b><br/>状态：${a.status}<br/>时间：${a.when || '未明'}<br/>条目：${a.item_id}`
      },
    },
    xAxis: { type: 'value', show: false, max: segs.length || 1 },
    yAxis: {
      type: 'category',
      data: [focus.value || personText],
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontWeight: 600 as const },
    },
    series: segs.map((s) => ({
      type: 'bar',
      stack: 'appt',
      barWidth: 26,
      data: [
        {
          value: 1,
          itemStyle: { color: colorOf(s.status) },
          label: {
            show: true,
            position: 'inside',
            formatter: s.office ? s.office.slice(0, 6) : s.status,
            color: '#fff',
            fontSize: 10,
          },
          appt: s,
        },
      ],
    })),
  }
})

const { chart } = useChart(el, option)

onMounted(() => {
  chart.value?.on('click', (p: unknown) => {
    const a = (p as { data?: { appt?: ApptSegment } }).data?.appt
    if (a) emit('jump', a.item_id)
  })
})
</script>

<template>
  <div class="appt-tl">
    <div class="cap">
      <span class="name">{{ focus || personText }}</span> 的任职轨迹（共 {{ segments.length }} 段）
    </div>
    <div ref="el" class="chart"></div>
    <div v-if="people.length" class="people">
      <span class="lbl">多段任职人物：</span>
      <button
        v-for="p in people"
        :key="p.name"
        class="chip"
        :class="{ on: p.name === focus }"
        @click="focus = p.name"
      >
        {{ p.name }}（{{ p.count }}）
      </button>
    </div>
    <p v-if="!segments.length" class="muted">该人物无任职记录。</p>
  </div>
</template>

<style scoped>
.appt-tl {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cap {
  font-size: 13px;
  color: var(--text-soft);
}
.name {
  font-weight: 600;
  color: var(--text);
}
.chart {
  width: 100%;
  height: 56px;
}
.people {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.lbl {
  font-size: 12px;
  color: var(--text-soft);
}
.chip {
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
  border-radius: 10px;
  padding: 0 8px;
  cursor: pointer;
}
.chip.on {
  border-color: var(--book-primary);
  color: var(--book-primary);
  background: #fff;
}
.muted {
  font-size: 12px;
  color: var(--text-soft);
  margin: 4px 0 0;
}
</style>
