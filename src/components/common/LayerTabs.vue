<script setup lang="ts">
/**
 * 层导航 tab（P2.1）
 * 全部由 book.config.json 推导：reserved 层显示「待补建」而不是消失或白屏。
 */
import type { NavTab } from '@/core/layerSchema'

defineProps<{
  tabs: NavTab[]
  current: string
}>()

const emit = defineEmits<{ select: [id: string] }>()
</script>

<template>
  <nav class="tabs">
    <button
      v-for="t in tabs"
      :key="t.id"
      class="tab"
      :class="{ on: current === t.id, pending: t.pending }"
      :disabled="t.pending"
      :title="t.pending ? '该要素视图已注册，数据尚未补建' : t.label"
      @click="emit('select', t.id)"
    >
      {{ t.label }}
      <em v-if="t.pending">待补建</em>
    </button>
  </nav>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

/* 竹简：金黄简身，顶圆底方，编绳处压赭线 */
.tab {
  font: inherit;
  font-size: 13px;
  padding: 4px 11px;
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  background: linear-gradient(180deg, var(--gold-tint) 0%, var(--paper-deep) 100%);
  cursor: pointer;
  color: var(--ink-soft);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  position: relative;
}

.tab:hover:not(:disabled) {
  color: var(--cinnabar-deep);
}

/* 选中简：纸面 + 朱砂字 + 上沿一道印线 */
.tab.on {
  background: var(--paper);
  color: var(--cinnabar-deep);
  font-weight: 500;
  box-shadow: inset 0 2px 0 var(--cinnabar);
}

.tab.pending {
  opacity: 0.55;
  cursor: not-allowed;
}

.tab em {
  font-style: normal;
  font-size: 11px;
  color: var(--warn-text);
}
</style>
