<script setup lang="ts">
/**
 * 按 FieldDecl 渲染字段值（P2.6/P2.7）
 *
 * 前端不认识任何具体字段：怎么显示由 book.config.json 的 type/view 决定。
 * ent-ref 渲染成可点击链接，点击后交给父组件决定跳实体详情还是正文定位。
 */
import { displayValue } from '@/core/format'
import type { FieldDecl } from '@/core/types'

const props = defineProps<{
  value: unknown
  field?: FieldDecl
  colors?: Record<string, string>
}>()

const emit = defineEmits<{ ref: [layer: string, value: string] }>()

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)
}

// 显示逻辑在 core/format.ts（displayValue / labelOf），有单测保护。
// 曾经放在这里，导致 proc.steps 渲染成「[object Object]」而测试覆盖不到。
const display = displayValue

function colorOf(v: string): string | undefined {
  return props.field?.type === 'enum' ? props.colors?.[v] : undefined
}

function clickable(): boolean {
  const t = props.field?.type
  return (t === 'ent-ref' || t === 'item-ref') && !!props.field?.refLayer
}

function onClick() {
  const f = props.field
  if (!f?.refLayer) return
  emit('ref', f.refLayer, display(props.value))
}
</script>

<template>
  <span v-if="isEmpty(value)" class="empty">—</span>
  <span
    v-else-if="clickable()"
    class="ref"
    @click.stop="onClick"
    :title="`跳转到 ${field?.refLayer}`"
    >{{ display(value) }}</span
  >
  <span v-else-if="field?.view === 'chip'" class="chip" :style="{ color: colorOf(display(value)) }">{{
    display(value)
  }}</span>
  <span v-else :class="{ block: field?.view === 'block' || field?.type === 'original' }">{{
    display(value)
  }}</span>
</template>

<style scoped>
.empty {
  color: var(--ink-faint);
}

/* ent-ref 链接：朱砂 + 虚线下沿（仿朱笔圈点） */
.ref {
  color: var(--cinnabar);
  cursor: pointer;
  border-bottom: 1px dashed currentColor;
}

.ref:hover {
  background: var(--cinnabar-tint);
}

/* 枚举 chip：方笺 */
.chip {
  display: inline-block;
  padding: 0 7px;
  border-radius: 2px;
  background: var(--gold-tint);
  border: 1px solid var(--border);
  font-size: 12px;
  line-height: 1.7;
}

.block {
  display: block;
  white-space: pre-wrap;
  line-height: 1.95;
}
</style>
