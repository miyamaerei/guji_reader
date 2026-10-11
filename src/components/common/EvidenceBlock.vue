<script setup lang="ts">
/**
 * 书证三件套（契约硬约束：任何层记录必带 original / source / confidence）
 *
 * confidence 为 null 表示源数据未提供——打包期不臆造数值，这里显示「—」。
 */
import { computed, ref } from 'vue'

const props = defineProps<{
  original?: string
  source?: string
  confidence?: number | null
  /** 折叠阈值：超过则默认收起 */
  foldAt?: number
}>()

const folded = ref(true)
const long = computed(() => (props.original?.length ?? 0) > (props.foldAt ?? 120))
const show = computed(() => !long.value || !folded.value)
const pct = computed(() =>
  props.confidence === null || props.confidence === undefined
    ? null
    : Math.round(props.confidence * 100),
)
</script>

<template>
  <div class="evidence">
    <div class="meta">
      <span class="k">书证</span>
      <span v-if="source" class="src">{{ source }}</span>
      <span class="conf" :class="{ none: pct === null }">
        置信度 {{ pct === null ? '—' : `${pct}%` }}
      </span>
      <button v-if="long" class="fold" @click="folded = !folded">
        {{ folded ? '展开' : '收起' }}
      </button>
    </div>
    <p v-if="show" class="orig">{{ original || '（无）' }}</p>
  </div>
</template>

<style scoped>
.evidence {
  border-left: 2px solid var(--border);
  padding: 4px 0 4px 8px;
  margin-top: 6px;
}

.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-soft);
}

.k {
  color: var(--text);
}

.src {
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: 3px;
}

.conf.none {
  opacity: 0.6;
}

.fold {
  font: inherit;
  font-size: 12px;
  border: none;
  background: none;
  color: var(--book-primary);
  cursor: pointer;
  padding: 0;
}

.orig {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.9;
  color: #44443f;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
