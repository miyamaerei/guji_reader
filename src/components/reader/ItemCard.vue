<script setup lang="ts">
/**
 * 单条目卡片（P2.5）
 *
 * 覆盖式渲染：整个中栏由条目卡片顺序铺满，选中态给左侧色条而不是弹窗，
 * 这样滚动时上下文不丢失，右栏详情可常驻对照。
 */
import { computed, ref } from 'vue'
import ItemText from '@/components/common/ItemText.vue'
import type { EntitySpan, ItemRecord } from '@/core/types'
import type { TreeNodeTag } from '@/core/tree'

const props = withDefaults(
  defineProps<{
    item: ItemRecord
    colors?: Record<string, string>
    tags?: TreeNodeTag[]
    active?: boolean
    highlightEid?: string | null
    /** 全局译文开关：开启时所有带译文的条目强制显示译文（P3.6） */
    forceShowTrans?: boolean
  }>(),
  { colors: () => ({}), tags: () => [], active: false, highlightEid: null, forceShowTrans: false },
)

const emit = defineEmits<{
  select: [iid: string]
  pick: [span: EntitySpan]
  /** 展开/收起译文改变了自身高度，正文流需要重新测量条目位置 */
  resize: []
}>()

const showTrans = ref(false)
const hasTrans = computed(() => (props.item.translation ?? '').length > 0)
const transVisible = computed(() => (showTrans.value || props.forceShowTrans) && hasTrans.value)
</script>

<template>
  <article
    class="card"
    :class="{ active }"
    :data-iid="item.iid"
    @click="emit('select', item.iid)"
  >
    <header>
      <span class="iid">{{ item.iid }}</span>
      <span v-for="t in tags" :key="t.text" class="ltag" :title="t.title ?? ''">{{ t.text }}</span>
      <span class="spacer" />
      <button
        v-if="hasTrans && !forceShowTrans"
        class="mini"
        @click.stop="
          () => {
            showTrans = !showTrans
            emit('resize')
          }
        "
      >
        {{ showTrans ? '收起译文' : '译文' }}
      </button>
    </header>
    <div class="body">
      <ItemText
        :text="item.text"
        :spans="item.spans"
        :colors="colors"
        :highlight-eid="highlightEid"
        @pick="emit('pick', $event)"
      />
    </div>
    <p v-if="transVisible" class="trans">{{ item.translation }}</p>
  </article>
</template>

<style scoped>
.card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-left: 3px solid transparent;
  border-radius: var(--radius);
  padding: 12px 14px;
  cursor: pointer;
  scroll-margin-top: 12px;
}

.card.active {
  border-left-color: var(--book-primary);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06);
}

header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.iid {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: var(--text-soft);
}

.ltag {
  font-size: 10px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  color: var(--text-soft);
}

.spacer {
  flex: 1;
}

.mini {
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 4px;
  padding: 1px 7px;
  cursor: pointer;
  color: var(--text-soft);
}

.mini:hover {
  border-color: var(--book-primary);
  color: var(--book-primary);
}

.body {
  font-size: 15px;
}

.trans {
  margin: 8px 0 0;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
  font-size: 13px;
  line-height: 1.9;
  color: #4a4a45;
  white-space: pre-wrap;
}
</style>
