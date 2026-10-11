<script setup lang="ts">
/**
 * 原文‖译文对照（P3.6）
 *
 * 左原文 / 右译文（可切上下对照），专名括注原样保留（数据里已是「（今释）」形）。
 * 注释性翻译独立成块；style 以 chip 呈现。译文开关（正文是否随原文显示）由阅读器顶栏控制，
 * 不在此组件内。
 */
import { computed, ref } from 'vue'
import { trlPair, type ParallelLayout } from '@/core/layerBlocks'
import type { LayerRecord } from '@/core/types'

const props = defineProps<{ record: LayerRecord }>()
const pair = computed(() => trlPair(props.record))
const layout = ref<ParallelLayout>('horizontal')
</script>

<template>
  <div class="trl-par">
    <div class="bar">
      <span v-if="pair.style" class="chip">{{ pair.style }}</span>
      <span class="sp" />
      <button class="mini" :class="{ on: layout === 'horizontal' }" @click="layout = 'horizontal'">
        左右
      </button>
      <button class="mini" :class="{ on: layout === 'vertical' }" @click="layout = 'vertical'">
        上下
      </button>
    </div>
    <div class="pair" :class="layout">
      <div class="col orig">
        <div class="lab">原文</div>
        <p class="txt">{{ pair.original }}</p>
      </div>
      <div class="col tr">
        <div class="lab">译文</div>
        <p class="txt">{{ pair.translation }}</p>
      </div>
    </div>
    <div v-if="pair.note" class="note">
      <div class="lab">注释</div>
      <p class="txt">{{ pair.note }}</p>
    </div>
  </div>
</template>

<style scoped>
.trl-par {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sp {
  flex: 1;
}
.chip {
  font-size: 12px;
  padding: 0 8px;
  border-radius: 10px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
}
.mini {
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
  border-radius: 4px;
  padding: 1px 8px;
  cursor: pointer;
}
.mini.on {
  border-color: var(--book-primary);
  color: var(--book-primary);
  background: #fff;
}
.pair {
  display: grid;
  gap: 8px;
}
.pair.horizontal {
  grid-template-columns: 1fr 1fr;
}
.pair.vertical {
  grid-template-columns: 1fr;
}
.col {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 8px;
  background: var(--bg);
}
.col.orig {
  background: #fbf7ef;
}
.col.tr {
  background: #f1f6fb;
}
.lab {
  font-size: 11px;
  color: var(--text-soft);
  margin-bottom: 3px;
}
.txt {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.9;
  white-space: pre-wrap;
  word-break: break-word;
}
.note {
  border-top: 1px dashed var(--border);
  padding-top: 6px;
}
</style>
