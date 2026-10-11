<script setup lang="ts">
/**
 * 实体详情（P2.6）
 *
 * 实体主键（ENT-NNN）≠ 标注实例（M-NNNNN）：同一个「礼部」在全书写到 4 次，
 * 详情页展示的是**主键**视角——归一词、全部词形、出现条目列表。
 * 正文里点某一个 mention 跳转过来时，右栏会同时高亮该 mention 所属的所有出现位置。
 *
 * 跨书关联区是 v2 的范围，这里按设计文档 §5.2 的三级判定留出「待补建」位，
 * 而不是假装已经有数据。
 */
import { computed, ref, watch } from 'vue'
import { useBookStore } from '@/stores/bookContext'
import { useLayerStore } from '@/stores/layers'
import type { EntityEntry } from '@/core/types'

const props = defineProps<{ eid: string }>()
const emit = defineEmits<{ jump: [iid: string] }>()

const book = useBookStore()
const layers = useLayerStore()

const entry = ref<EntityEntry | null>(null)
const mentions = ref<{ id: string; item_id: string; text: string }[]>([])
const loading = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const table = await layers.entities(book.currentBookId)
    entry.value = table[props.eid] ?? null
    // mention 明细在 ent 层，按需加载（水东 ent 层 2.5MB，不随首屏带）
    if (entry.value && (await layers.ensureLoaded(book.currentBookId, 'ent'))) {
      const all = layers.recordsOf(book.currentBookId, 'ent') ?? []
      mentions.value = all
        .filter((r) => r.eid === props.eid)
        .map((r) => ({ id: r.id, item_id: r.item_id, text: String(r.text ?? '') }))
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

watch(() => [props.eid, book.currentBookId], load, { immediate: true })

const typeLabel = computed(() => {
  const t = entry.value?.type ?? ''
  const f = book.config?.layers.find((l) => l.id === 'ent')?.fields?.type
  return f?.enum?.includes(t) ? t : t || '未分类'
})

const typeColor = computed(() => book.config?.colors.entityTypes?.[entry.value?.type ?? ''] ?? '')
</script>

<template>
  <div class="entity">
    <p v-if="loading" class="muted">加载中…</p>
    <p v-else-if="error" class="muted err">{{ error }}</p>
    <template v-else-if="entry">
      <div class="title">
        <span class="name">{{ entry.normalized }}</span>
        <span class="type" :style="{ color: typeColor, borderColor: typeColor }">{{
          typeLabel
        }}</span>
      </div>
      <div class="kv">
        <span class="k">主键</span><span class="v mono">{{ entry.eid }}</span>
        <span class="k">出现</span><span class="v">{{ entry.count }} 次 / {{ entry.items?.length ?? 0 }} 条</span>
        <span class="k">词形</span><span class="v">{{ entry.surfaces.join('、') || '—' }}</span>
      </div>

      <section v-if="mentions.length">
        <h4>正文出现位置（{{ mentions.length }}）</h4>
        <ul class="mentions">
          <li v-for="m in mentions" :key="m.id">
            <button class="link" @click="emit('jump', m.item_id)">{{ m.item_id }}</button>
            <span class="txt">{{ m.text }}</span>
          </li>
        </ul>
      </section>

      <section class="cross">
        <h4>跨书关联</h4>
        <p class="muted">
          v2 范围（全局实体注册表 + 候选加权匹配），本版不实现。字段 <code>gid</code> 已在契约中预留。
        </p>
      </section>
    </template>
    <p v-else class="muted">未找到实体 {{ eid }}</p>
  </div>
</template>

<style scoped>
.entity {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.name {
  font-size: 18px;
  font-weight: 500;
}

.type {
  font-size: 12px;
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.kv {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 4px 8px;
  font-size: 13px;
}

.k {
  color: var(--text-soft);
}

.mono {
  font-family: ui-monospace, monospace;
}

h4 {
  font-size: 13px;
  font-weight: 500;
  margin: 0 0 6px;
}

.mentions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 240px;
  overflow: auto;
}

.mentions li {
  display: flex;
  gap: 8px;
  font-size: 13px;
}

.link {
  font: inherit;
  border: none;
  background: none;
  color: var(--book-primary);
  cursor: pointer;
  padding: 0;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}

.txt {
  color: var(--text-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cross {
  border-top: 1px dashed var(--border);
  padding-top: 8px;
}

.err {
  color: #a32d2d;
}
</style>
