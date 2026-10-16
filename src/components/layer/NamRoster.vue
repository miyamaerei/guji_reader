<script setup lang="ts">
/**
 * 题名表（P3.5）
 *
 * 把 record.entries（结构化的四元组数组）渲染成分组表头 + 表格：
 * 表头用名录名 + 范围（如「都察院·左都御史」），表体四列 姓名/字/籍贯/官职。
 * entries 为空（如某卷通检无可数组化条目）时改显 evidence 说明，不白屏。
 */
import { computed } from 'vue'
import { rosterRows, textOf } from '@/core/layerBlocks'
import type { LayerRecord } from '@/core/types'

const props = defineProps<{ record: LayerRecord }>()

const rows = computed(() => rosterRows(props.record))
const header = computed(() => {
  const name = textOf((props.record as Record<string, unknown>).name)
  const range = textOf((props.record as Record<string, unknown>).range)
  return [name, range].filter(Boolean).join('　·　')
})
const evidence = computed(() => textOf((props.record as Record<string, unknown>).evidence))
</script>

<template>
  <div class="nam-roster">
    <div v-if="header" class="grp">{{ header }}</div>
    <table v-if="rows.length" class="roster">
      <thead>
        <tr>
          <th class="seq">#</th>
          <th>姓名</th>
          <th>字</th>
          <th>籍贯</th>
          <th>官职</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.seq">
          <td class="seq">{{ r.seq }}</td>
          <td class="nm">{{ r.person }}</td>
          <td>{{ r.courtesy }}</td>
          <td>{{ r.hometown }}</td>
          <td>{{ r.office }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="muted">
      {{ evidence || '本题名表无结构化条目。' }}
    </p>
  </div>
</template>

<style scoped>
.nam-roster {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 门类题签：淡金底 + 朱砂左界 */
.grp {
  font-size: 13px;
  font-weight: 600;
  padding: 4px 8px;
  background: var(--gold-tint);
  border-left: 3px solid var(--cinnabar);
  border-radius: 0 2px 2px 0;
}

.roster {
  border-collapse: collapse;
  font-size: 12.5px;
  width: 100%;
}

.roster th,
.roster td {
  border: 1px solid var(--border);
  padding: 3px 7px;
  text-align: left;
}

.roster thead th {
  background: var(--gold-tint);
  font-weight: 600;
  color: var(--cinnabar-deep);
}

.seq {
  width: 30px;
  text-align: center;
  color: var(--ink-faint);
}

.nm {
  font-weight: 600;
}

.muted {
  font-size: 12px;
  color: var(--ink-faint);
  line-height: 1.7;
  margin: 0;
}
</style>
