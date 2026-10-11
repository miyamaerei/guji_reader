<script setup lang="ts">
/**
 * 条目详情 · 全层表（P2.7）
 *
 * 骨架来自 join.json（每层命中几条），层内容按需加载：
 * 水东 8 层逐个展开才是 12MB，一次全拉会把首屏拖死。
 * 用户点开哪层才加载哪层——这是 P1 那句「层文件体积待优化」的止血方案。
 *
 * 字段怎么显示由 book.config.json 的 fields 决定，这里不认识任何具体字段名。
 */
import { computed, ref, watch } from 'vue'
import FieldValue from '@/components/common/FieldValue.vue'
import EvidenceBlock from '@/components/common/EvidenceBlock.vue'
import { useBookStore } from '@/stores/bookContext'
import { useLayerStore } from '@/stores/layers'
import type { JoinRow, LayerId, LayerRecord } from '@/core/types'

const props = defineProps<{ iid: string }>()
const emit = defineEmits<{
  jump: [iid: string]
  openRecord: [layer: LayerId, id: string]
  ref: [layer: LayerId, value: string]
}>()

const book = useBookStore()
const layers = useLayerStore()

const row = ref<JoinRow | null>(null)
/** 已展开的层 */
const expanded = ref<Set<LayerId>>(new Set())
const busy = ref<Set<LayerId>>(new Set())

watch(
  () => [props.iid, book.currentBookId],
  async () => {
    row.value = null
    expanded.value = new Set()
    const jf = await layers.join(book.currentBookId)
    row.value = jf.rows.find((r) => r.item_id === props.iid) ?? null
  },
  { immediate: true },
)

/** 参与全层表的层：声明过且有命中，或 reserved（显示待补建） */
const sections = computed(() => {
  const cfg = book.config
  if (!cfg) return []
  return cfg.layers
    .filter((l) => !l.reserved)
    .map((l) => ({
      id: l.id,
      label: l.label,
      count: row.value?.ids?.[l.id]?.length ?? 0,
      fields: l.fields,
    }))
    .filter((s) => s.count > 0)
})

async function toggle(layer: LayerId) {
  const next = new Set(expanded.value)
  if (next.has(layer)) {
    next.delete(layer)
    expanded.value = next
    return
  }
  next.add(layer)
  expanded.value = next
  if (!layers.peek(book.currentBookId, layer)) {
    busy.value = new Set([...busy.value, layer])
    await layers.load(book.currentBookId, layer)
    busy.value = new Set([...busy.value].filter((x) => x !== layer))
  }
}

function recordsOf(layer: LayerId): LayerRecord[] {
  return layers.recordsByItem(book.currentBookId, layer, props.iid)
}

function titleOf(rec: LayerRecord, layer: LayerId): string {
  const f = book.config?.layers.find((l) => l.id === layer)?.fields ?? {}
  for (const key of Object.keys(f)) {
    const v = rec[key]
    if (typeof v === 'string' && v) return v
  }
  return rec.id
}
</script>

<template>
  <div class="detail">
    <div class="title">
      <span class="iid">{{ iid }}</span>
      <span v-if="row" class="muted">{{ row.source }} ｜ 命中 {{ row.layer_count }} 层</span>
    </div>

    <p v-if="!row" class="muted">该条目没有跨层记录。</p>

    <section v-for="s in sections" :key="s.id" class="layer">
      <button class="head" @click="toggle(s.id)">
        <span class="caret">{{ expanded.has(s.id) ? '▾' : '▸' }}</span>
        <span class="label">{{ s.label }}</span>
        <span class="count">{{ s.count }}</span>
      </button>
      <div v-if="expanded.has(s.id)" class="records">
        <p v-if="busy.has(s.id)" class="muted">加载层数据…</p>
        <div v-for="rec in recordsOf(s.id)" :key="rec.id" class="rec">
          <div class="rec-head">
            <button class="rid" @click="emit('openRecord', s.id, rec.id)">{{ rec.id }}</button>
            <span class="rt">{{ titleOf(rec, s.id) }}</span>
          </div>
          <dl class="fields">
            <template v-for="(f, k) in s.fields ?? {}" :key="k">
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
          <EvidenceBlock :original="rec.original" :source="rec.source" :confidence="rec.confidence" />
        </div>
      </div>
    </section>

    <p class="muted tip">
      提示：点正文里的着色词可查看实体详情；点层记录编号可在整页视图中打开。
    </p>
  </div>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.title {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.iid {
  font-family: ui-monospace, monospace;
  font-size: 14px;
  font-weight: 500;
}

.layer {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--bg-soft);
  border: none;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  color: inherit;
}

.caret {
  width: 12px;
  color: var(--text-soft);
  font-size: 10px;
}

.label {
  flex: 1;
  text-align: left;
}

.count {
  color: var(--text-soft);
  font-variant-numeric: tabular-nums;
}

.records {
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rec {
  border-top: 1px dashed var(--border);
  padding-top: 6px;
}

.rec:first-child {
  border-top: none;
}

.rec-head {
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.rid {
  font: inherit;
  font-size: 12px;
  font-family: ui-monospace, monospace;
  border: none;
  background: none;
  color: var(--book-primary);
  cursor: pointer;
  padding: 0;
}

.rt {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fields {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 2px 8px;
  margin: 4px 0 0;
  font-size: 13px;
}

.fields dt {
  color: var(--text-soft);
}

.fields dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.tip {
  font-size: 12px;
}
</style>
