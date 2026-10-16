<script setup lang="ts">
/**
 * 扁平枚举筛选（P2.3）
 * 计数来自 enums.json，与筛选后的结果数同源——不在此处二次估算。
 */
import type { EnumValue } from '@/core/types'

const props = defineProps<{
  items: EnumValue[]
  modelValue: string
  /** 全部按钮的文案 */
  allLabel?: string
  /** 总数（全部） */
  total?: number
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

function pick(v: string) {
  emit('update:modelValue', props.modelValue === v ? '' : v)
}
</script>

<template>
  <div class="chips">
    <button class="chip" :class="{ on: !modelValue }" @click="pick('')">
      {{ allLabel ?? '全部'
      }}<em v-if="total !== undefined">{{ total }}</em>
    </button>
    <button
      v-for="it in items"
      :key="it.value"
      class="chip"
      :class="{ on: modelValue === it.value }"
      @click="pick(it.value)"
    >
      {{ it.value }}<em>{{ it.count }}</em>
    </button>
  </div>
</template>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* 筛选签：方笺（古印弃圆角胶囊），选中 = 朱砂白文 */
.chip {
  font: inherit;
  font-size: 12px;
  padding: 2px 9px;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--paper);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ink-soft);
}

.chip:hover {
  border-color: var(--cinnabar);
  color: var(--cinnabar-deep);
}

.chip.on {
  background: var(--cinnabar);
  border-color: var(--cinnabar-deep);
  color: #f8efdc;
}

.chip em {
  font-style: normal;
  opacity: 0.65;
  font-variant-numeric: tabular-nums;
}
</style>
