<script setup lang="ts">
/**
 * 层记录详情（P2.7 + P3/P4 专用块）
 * 字段顺序与呈现方式全部由 book.config.json 的 fields 决定；专用块
 * （timeline / graph / roster / parallel / slots / flow / tabs / note）
 * 按 decl.views.detail 分发。
 * 七个专用组件用 defineAsyncComponent 懒加载，ECharts 仅在打开对应层时才进包。
 */
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import FieldValue from '@/components/common/FieldValue.vue'
import EvidenceBlock from '@/components/common/EvidenceBlock.vue'
import { useBookStore } from '@/stores/bookContext'
import { useLayerStore } from '@/stores/layers'
import type { DetailBlock, LayerId, LayerRecord } from '@/core/types'

const ApptTimeline = defineAsyncComponent(() => import('@/components/layer/ApptTimeline.vue'))
const RelGraph = defineAsyncComponent(() => import('@/components/layer/RelGraph.vue'))
const NamRoster = defineAsyncComponent(() => import('@/components/layer/NamRoster.vue'))
const TrlParallel = defineAsyncComponent(() => import('@/components/layer/TrlParallel.vue'))
const RuleSlots = defineAsyncComponent(() => import('@/components/layer/RuleSlots.vue'))
const ProcFlow = defineAsyncComponent(() => import('@/components/layer/ProcFlow.vue'))
const StructTabs = defineAsyncComponent(() => import('@/components/layer/StructTabs.vue'))

const props = defineProps<{ layer: LayerId; id: string }>()
const emit = defineEmits<{ jump: [iid: string]; ref: [layer: LayerId, value: string] }>()

const book = useBookStore()
const layers = useLayerStore()
const rec = ref<LayerRecord | null>(null)
const loading = ref(false)
const error = ref('')

watch(
  () => [props.layer, props.id, book.currentBookId],
  async () => {
    loading.value = true
    error.value = ''
    rec.value = null
    try {
      await layers.load(book.currentBookId, props.layer)
      rec.value = layers.recordById(book.currentBookId, props.layer, props.id) ?? null
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

const decl = computed(() => book.config?.layers.find((l) => l.id === props.layer))
const fields = computed(() => decl.value?.fields ?? {})

/** 专用块分发：decl.views.detail 决定渲染哪些块（P3/P4） */
const blocks = computed<DetailBlock[]>(() => decl.value?.views?.detail ?? ['table'])
/** 仅在块列表含 table 时渲染通用字段表，避免与 parallel 等块重复 */
const showTable = computed(() => blocks.value.includes('table'))
/** timeline / graph 需要同层全部记录做聚合 */
const allRecs = computed<LayerRecord[] | null>(() =>
  layers.recordsOf(book.currentBookId, props.layer),
)
const noteText = computed(() => {
  if (!blocks.value.includes('note') || !rec.value) return ''
  const v = (rec.value as Record<string, unknown>).note
  return typeof v === 'string' ? v : ''
})
</script>

<template>
  <div class="rec-detail">
    <p v-if="loading" class="muted">加载中…</p>
    <p v-else-if="error" class="muted err">{{ error }}</p>
    <p v-else-if="!rec" class="muted">未找到记录 {{ layer }} / {{ id }}</p>
    <template v-else>
      <div class="title">
        <span class="lab">{{ decl?.label ?? layer }}</span>
        <span class="mono">{{ rec.id }}</span>
      </div>
      <button class="jump" @click="emit('jump', String(rec.item_id))">
        所属条目 {{ rec.item_id }}
      </button>
      <dl v-if="showTable" class="fields">
        <template v-for="(f, k) in fields" :key="k">
          <dt v-if="f.view !== 'hide'">{{ f.label }}</dt>
          <dd v-if="f.view !== 'hide'">
            <FieldValue
              :value="rec[k]"
              :field="f"
              :colors="book.config?.colors.entityTypes"
              @ref="emit('ref', $event, String(rec[k] ?? ''))"
            />
          </dd>
        </template>
      </dl>

      <div v-for="b in blocks" :key="b" class="blk">
        <ApptTimeline
          v-if="b === 'timeline' && rec"
          :record="rec"
          :all="allRecs"
          @jump="emit('jump', $event)"
        />
        <RelGraph v-else-if="b === 'graph' && rec" :record="rec" :all="allRecs" />
        <NamRoster v-else-if="b === 'roster' && rec" :record="rec" />
        <TrlParallel v-else-if="b === 'parallel' && rec" :record="rec" />
        <RuleSlots v-else-if="b === 'slots' && rec" :record="rec" />
        <ProcFlow v-else-if="b === 'flow' && rec" :record="rec" :all="allRecs" />
        <StructTabs v-else-if="b === 'tabs' && rec" :record="rec" :all="allRecs" />
      </div>

      <p v-if="noteText" class="note-block">
        <span class="lab">注释</span>{{ noteText }}
      </p>
      <EvidenceBlock
        :original="rec.original"
        :source="rec.source"
        :confidence="rec.confidence"
        :fold-at="200"
      />
    </template>
  </div>
</template>

<style scoped>
.rec-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.title {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.lab {
  font-size: 15px;
  font-weight: 500;
}

.mono {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: var(--text-soft);
}

.jump {
  align-self: flex-start;
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  color: var(--book-primary);
}

.fields {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 4px 8px;
  margin: 0;
  font-size: 13px;
}

.fields dt {
  color: var(--text-soft);
}

.fields dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.err {
  color: #a32d2d;
}

.blk {
  margin-top: 10px;
}

.note-block {
  margin: 10px 0 0;
  padding: 6px 8px;
  background: var(--bg-soft);
  border-radius: 4px;
  font-size: 12.5px;
  line-height: 1.8;
}

.note-block .lab {
  font-size: 11px;
  color: var(--text-soft);
  margin-right: 6px;
}
</style>
