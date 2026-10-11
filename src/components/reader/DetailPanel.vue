<script setup lang="ts">
/**
 * 右栏详情容器（P2.6 / P2.7）
 *
 * 三种选择态共用这一个面板：条目（全层表）/ 实体 / 层记录。
 * 选中态用一个可序列化的 selection 对象表达，因此能直接映射成路由
 * `/detail/:book/:kind/:id`——右栏与整页详情视图是同一套组件。
 */
import { computed } from 'vue'
import EntityDetail from './EntityDetail.vue'
import ItemDetail from './ItemDetail.vue'
import LayerRecordDetail from './LayerRecordDetail.vue'
import { detailHref } from '@/core/routes'
import type { LayerId } from '@/core/types'

export type Selection =
  | { kind: 'item'; iid: string }
  | { kind: 'entity'; eid: string }
  | { kind: 'layer'; layer: LayerId; id: string }

const props = defineProps<{ selection: Selection | null; bookId?: string }>()
const emit = defineEmits<{
  close: []
  jump: [iid: string]
  openRecord: [layer: LayerId, id: string]
  ref: [layer: LayerId, value: string]
}>()

const title = computed(() => {
  const s = props.selection
  if (!s) return '详情'
  if (s.kind === 'item') return `条目 ${s.iid}`
  if (s.kind === 'entity') return `实体 ${s.eid}`
  return `记录 ${s.id}`
})

/**
 * 与整页详情路由一一对应：`/detail/:book/:kind/:id`
 * bookId 必填——缺它会退回书架，绝不再产出「少了 book 段」的错误路径。
 * 层记录直接用层 id 当 kind，省掉一层解析。
 */
const routeOf = computed(() => {
  const s = props.selection
  if (!s) return ''
  if (s.kind === 'item') return detailHref(props.bookId ?? '', 'item', s.iid)
  if (s.kind === 'entity') return detailHref(props.bookId ?? '', 'entity', s.eid)
  return detailHref(props.bookId ?? '', s.layer, s.id)
})
</script>

<template>
  <aside class="panel-right">
    <div class="head">
      <strong>{{ title }}</strong>
      <span class="spacer" />
      <a v-if="selection" class="mini" :href="`#${routeOf}`">整页</a>
      <button v-if="selection" class="mini" @click="emit('close')">关闭</button>
    </div>
    <div class="body">
      <p v-if="!selection" class="muted hint">
        点正文着色词看实体详情，点条目卡片看该条目的全层记录。
      </p>
      <ItemDetail
        v-else-if="selection.kind === 'item'"
        :iid="selection.iid"
        @jump="emit('jump', $event)"
        @open-record="(l, id) => emit('openRecord', l, id)"
        @ref="(l, v) => emit('ref', l, v)"
      />
      <EntityDetail
        v-else-if="selection.kind === 'entity'"
        :eid="selection.eid"
        @jump="emit('jump', $event)"
      />
      <LayerRecordDetail
        v-else
        :layer="selection.layer"
        :id="selection.id"
        @jump="emit('jump', $event)"
        @ref="(l, v) => emit('ref', l, v)"
      />
    </div>
  </aside>
</template>

<style scoped>
.panel-right {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
  border-left: 1px solid var(--border);
}

.head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
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
  padding: 1px 6px;
  cursor: pointer;
  color: var(--text-soft);
  text-decoration: none;
}

.mini:hover {
  border-color: var(--book-primary);
  color: var(--book-primary);
}

.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px;
}

.hint {
  margin: 0;
}
</style>
