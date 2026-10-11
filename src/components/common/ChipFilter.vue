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

.chip {
  font: inherit;
  font-size: 12px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: inherit;
}

.chip:hover {
  border-color: var(--book-primary);
}

.chip.on {
  background: var(--book-primary);
  border-color: var(--book-primary);
  color: #fff;
}

.chip em {
  font-style: normal;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}
</style>
