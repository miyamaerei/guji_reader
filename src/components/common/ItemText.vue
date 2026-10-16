<script setup lang="ts">
/**
 * 正文渲染（P2.5 实体着色）
 *
 * 着色用打包期已断言过的 span 偏移：`text.slice(s, e) === span.text`。
 * 这里不再做校验（那是打包期与 dev 自检的职责），只负责切段与绑定点击。
 *
 * 未定位的实体（水东 53 条异体字差异过大）不会出现在 spans 里，
 * 因此正文不会出现「着色但词形对不上」的情况。
 */
import { computed } from 'vue'
import { buildSegments, type TextSegment } from '@/core/items'
import type { EntitySpan } from '@/core/types'

const props = withDefaults(
  defineProps<{
    text: string
    spans?: EntitySpan[]
    /** 类型 → 颜色，来自 book.config.json 的 colors.entityTypes */
    colors?: Record<string, string>
    /** 高亮的实体主键（从实体详情反查正文时用） */
    highlightEid?: string | null
    /** 原文是否加标点断句样式（无标点古文，按 span 分段即可） */
    dimmed?: boolean
  }>(),
  { spans: () => [], colors: () => ({}), highlightEid: null, dimmed: false },
)

const emit = defineEmits<{ pick: [span: EntitySpan] }>()

const segments = computed<TextSegment[]>(() => buildSegments(props.text, props.spans ?? []))

function colorOf(span: EntitySpan): string {
  return props.colors?.[span.type] ?? '#9c2b23'
}

function styleOf(seg: TextSegment) {
  if (!seg.span) return undefined
  const c = colorOf(seg.span)
  const on = props.highlightEid && seg.span.eid === props.highlightEid
  return {
    color: c,
    borderBottom: `1px solid ${c}`,
    background: on ? `${c}22` : 'transparent',
    fontWeight: on ? ('600' as const) : undefined,
  }
}
</script>

<template>
  <span class="item-text" :class="{ dimmed }">
    <template v-for="(seg, i) in segments" :key="i">
      <span
        v-if="seg.span"
        class="ent"
        :style="styleOf(seg)"
        :title="`${seg.span.type}｜${seg.span.normalized ?? seg.span.text}`"
        @click.stop="emit('pick', seg.span)"
        >{{ seg.text }}</span
      >
      <span v-else>{{ seg.text }}</span>
    </template>
  </span>
</template>

<style scoped>
.item-text {
  line-height: 2;
  letter-spacing: 0.02em;
  word-break: break-word;
}

.item-text.dimmed {
  color: var(--text-soft);
}

.ent {
  cursor: pointer;
  border-radius: 2px;
  padding: 0 1px;
  transition: background 0.12s;
}

.ent:hover {
  background: color-mix(in srgb, currentColor 14%, transparent);
}
</style>
