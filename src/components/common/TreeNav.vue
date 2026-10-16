<script setup lang="ts">
/**
 * 统一树组件（P2.3）
 *
 * 目录树 / 筛选树 / 卷模式树共用：差异只在传入的 nodes，渲染与交互完全一致。
 * 搜索框内建——搜到结果时自动展开命中路径（flattenTree 处理），
 * 不要求用户先展开三层再找。
 */
import { computed } from 'vue'
import { flattenTree, type TreeNode } from '@/core/tree'

const props = withDefaults(
  defineProps<{
    nodes: TreeNode[]
    open: Set<string>
    /** 当前条目（目录树）/ 当前选中值（筛选树） */
    current?: string | null
    query?: string
    searchable?: boolean
    placeholder?: string
    /** 行数上限，超出折叠提示（防止 1192 条一次性铺开） */
    maxRows?: number
    /** 点击非叶子节点是否也触发 select（筛选树需要） */
    selectBranch?: boolean
    emptyText?: string
  }>(),
  {
    current: null,
    query: '',
    searchable: true,
    placeholder: '搜索…',
    maxRows: 400,
    selectBranch: false,
    emptyText: '无匹配项',
  },
)

const emit = defineEmits<{
  toggle: [key: string]
  select: [node: TreeNode]
  'update:query': [value: string]
}>()

const rows = computed(() => flattenTree(props.nodes, props.open, props.query))
const shown = computed(() => rows.value.slice(0, props.maxRows))
const truncated = computed(() => rows.value.length > shown.value.length)

function onRowClick(row: { node: TreeNode; hasChildren: boolean }) {
  if (row.hasChildren) {
    emit('toggle', row.node.key)
    if (props.selectBranch) emit('select', row.node)
  } else {
    emit('select', row.node)
  }
}

/**
 * 高亮判定：
 *  · 目录树 —— current 是 iid，与叶子 key 相同
 *  · 筛选树 —— current 是筛选值；分支节点 key 即等于该值；
 *    叶子节点 key 为「标签+值」（同一组合值会挂在多个标签下，key 必须唯一），
 *    所以额外用 payload.value 比对，且只对叶子比对，避免父节点跟着亮
 */
function isCurrent(row: { node: TreeNode; hasChildren: boolean }): boolean {
  if (row.node.key === props.current) return true
  return !row.hasChildren && String(row.node.payload?.value ?? '') === String(props.current ?? '')
}
</script>

<template>
  <div class="tree">
    <input
      v-if="searchable"
      class="tree-search"
      :value="query"
      :placeholder="placeholder"
      @input="emit('update:query', ($event.target as HTMLInputElement).value)"
    />
    <div class="tree-body">
      <div
        v-for="row in shown"
        :key="row.node.key"
        class="tree-row"
        :class="{
          cur: isCurrent(row),
          open: row.open,
          leaf: !row.hasChildren,
          disabled: row.node.disabled,
        }"
        :style="{ paddingLeft: `${row.depth * 14 + 6}px` }"
        @click="onRowClick(row)"
      >
        <span v-if="row.hasChildren" class="caret">{{ row.open ? '▾' : '▸' }}</span>
        <span v-else class="caret caret-empty">·</span>
        <span class="label" :title="row.node.label">{{ row.node.label }}</span>
        <span
          v-for="t in row.node.tags ?? []"
          :key="t.text"
          class="tree-tag"
          :class="t.tone === 'layer' ? 'tone-layer' : 'tone-muted'"
          :title="t.title ?? ''"
          >{{ t.text }}</span
        >
        <span class="spacer" />
        <span v-if="row.node.count !== undefined" class="count">{{ row.node.count }}</span>
      </div>
      <p v-if="!shown.length" class="tree-empty">{{ emptyText }}</p>
      <p v-else-if="truncated" class="tree-empty">
        …另有 {{ rows.length - shown.length }} 行未显示，请用搜索缩小范围
      </p>
    </div>
  </div>
</template>

<style scoped>
.tree {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

.tree-search {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 2px;
  font: inherit;
  font-size: 13px;
  outline: none;
  background: var(--paper);
  color: var(--ink);
}

.tree-search:focus {
  border-color: var(--ochre);
  box-shadow: 0 0 0 2px var(--gold-tint);
}

.tree-body {
  overflow: auto;
  flex: 1;
  min-height: 0;
}

/* 竹简行：卷=竹（金黄），条=纸签；现行朱砂印底 */
.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: 2px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.6;
  white-space: nowrap;
}

.tree-row:hover {
  background: var(--gold-tint);
}

.tree-row.cur {
  background: var(--cinnabar-tint);
  color: var(--cinnabar-deep);
  font-weight: 500;
  box-shadow: inset 2px 0 0 var(--cinnabar);
}

.tree-row.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.caret {
  width: 12px;
  flex: 0 0 12px;
  color: var(--ochre);
  font-size: 10px;
  text-align: center;
}

.caret-empty {
  opacity: 0.35;
}

.label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-tag {
  flex: 0 0 auto;
  font-size: 10px;
  padding: 0 3px;
  border-radius: 2px;
  line-height: 1.5;
}

.tone-layer {
  background: var(--gold-tint);
  color: var(--warn-text);
  border: 1px solid var(--border);
}

.tone-muted {
  color: var(--ink-faint);
}

.spacer {
  flex: 1;
}

.count {
  flex: 0 0 auto;
  color: var(--ink-faint);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.tree-empty {
  margin: 8px 6px;
  font-size: 12px;
  color: var(--ink-faint);
}
</style>
