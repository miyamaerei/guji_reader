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
      <!-- 节标题为主（来自联邦库 spine 表）；iid 退为辅助标记 -->
      <span v-if="item.title" class="stitle" :title="item.iid">{{ item.title }}</span>
      <span v-else class="iid">{{ item.iid }}</span>
      <span v-for="t in tags" :key="t.text" class="ltag" :title="t.title ?? ''">{{ t.text }}</span>
      <span class="spacer" />
      <!-- 有节标题时才另标 iid，避免与标题争主位 -->
      <span v-if="item.title" class="iid">{{ item.iid }}</span>
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
/* 册页：纸 card + 双线框；选中态左缘压朱砂（仿书口） */
.card {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0) 30%),
    var(--paper);
  border: 1px solid var(--border-strong);
  border-left: 3px solid transparent;
  border-radius: var(--radius);
  padding: 12px 14px;
  cursor: pointer;
  scroll-margin-top: 12px;
  box-shadow: 0 0 0 1px var(--border), 0 1px 3px rgba(94, 72, 38, 0.08);
}

.card.active {
  border-left-color: var(--cinnabar);
  box-shadow: 0 0 0 1px var(--ochre), 0 2px 8px rgba(94, 72, 38, 0.16);
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
  color: var(--ink-faint);
}

/* 节标题：条目头位主标题（spine.title） */
.stitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
}

/* 层徽标：竹笺 */
.ltag {
  font-size: 10px;
  padding: 0 5px;
  border-radius: 2px;
  background: var(--gold-tint);
  border: 1px solid var(--border);
  color: var(--ink-soft);
}

.spacer {
  flex: 1;
}

.mini {
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border);
  background: var(--paper);
  border-radius: 2px;
  padding: 1px 8px;
  cursor: pointer;
  color: var(--ink-soft);
}

.mini:hover {
  border-color: var(--cinnabar);
  color: var(--cinnabar-deep);
}

/* 原文：仿刻本正文 */
.body {
  font-size: 15px;
  line-height: 1.95;
  letter-spacing: 0.02em;
}

/* 译文：青黛淡底注疏区 */
.trans {
  margin: 8px 0 0;
  padding: 8px 10px;
  border-left: 2px solid var(--indigo);
  border-radius: 0 2px 2px 0;
  background: var(--indigo-tint);
  font-size: 13px;
  line-height: 1.9;
  color: #3c4a52;
  white-space: pre-wrap;
}
</style>
