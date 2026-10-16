<script setup lang="ts">
/**
 * 结构化五维（P4.3）
 *
 * 677 条记录分属五个维度：角色 157 / 防弊 197 / 时限 138 / 文簿 98 / 文书 87。
 * 五维不是「同一张表的五个切面」——字段**严格按维度划分**：
 *   文簿 → 用途/保管/登记项/频率/查验/防弊要点（6 个字段全有）
 *   时限 → 只有频率
 *   文书 → 只有防弊要点
 *   角色、防弊 → 只有名称与分析
 * 所以不能套一份通用字段表（那样四维里三维全是空行），
 * 而是按维度动态决定展示哪些行，且只渲染有值的行。
 *
 * 另一个视角是「一条规则牵出哪些要素」：struct 记录都带 derived_rule，
 * 所以同一规则派生出的角色/时限/文簿会并排显示——这是五维设计的意图，
 * 单看某一条记录会丢掉这层关系。
 */
import { computed, ref } from 'vue'
import { siblingsOfRule, structRows, summarizeDims } from '@/core/xinguanBlocks'
import type { LayerRecord } from '@/core/types'

const props = defineProps<{ record: LayerRecord; all: LayerRecord[] | null }>()
const emit = defineEmits<{ jump: [iid: string] }>()

const dims = computed(() => summarizeDims(props.all ?? []))
const rows = computed(() => structRows(props.record))

/** 当前记录所属维度在 tab 上的序号 */
const ownDim = computed(() => String(props.record.dimension ?? ''))

/** 同一规则派生的其他维度记录 */
const siblings = computed(() => siblingsOfRule(props.all ?? [], String(props.record.derived_rule ?? '')))

/** 默认聚焦本条所属维度，否则第一个维度 */
const focus = ref('')
const shown = computed(() => {
  const d = focus.value || ownDim.value
  return d || dims.value[0]?.dimension || ''
})

function tabCount(d: string): number {
  return dims.value.find((x) => x.dimension === d)?.count ?? 0
}
</script>

<template>
  <div class="struct-tabs">
    <div class="tabs">
      <button
        v-for="d in dims"
        :key="d.dimension"
        class="tab"
        :class="{ on: shown === d.dimension }"
        :title="`${d.dimension}：${d.count} 条，本维展示 ${d.fields.length} 个字段`"
        @click="focus = d.dimension"
      >
        {{ d.dimension }}<span class="n">{{ tabCount(d.dimension) }}</span>
      </button>
    </div>

    <div class="pane">
      <div class="pane-head">
        <span class="cap">{{ shown }}维度</span>
        <span class="sub">
          {{ record.name }}
          <template v-if="record.item_id">
            · 条目
            <button class="lnk" @click="emit('jump', String(record.item_id))">
              {{ record.item_id }}
            </button>
          </template>
        </span>
      </div>

      <p v-if="!rows.length" class="muted">
        该维度无附加字段（角色 / 防弊两维只有名称与分析，分析见下方原文）。
      </p>
      <dl v-else class="rows">
        <template v-for="r in rows" :key="r.key">
          <dt>{{ r.label }}</dt>
          <dd>{{ r.value }}</dd>
        </template>
      </dl>

      <p v-if="record.analysis" class="ana">{{ record.analysis }}</p>

      <div v-if="siblings.length > 1" class="sib">
        <span class="lbl">同一规则（{{ record.derived_rule }}）派生 {{ siblings.length }} 项：</span>
        <button v-for="s in siblings" :key="String(s.id)" class="chip" @click="focus = String(s.dimension)">
          <b>{{ s.dimension }}</b> {{ s.name }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.struct-tabs {
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: 0 0 0 1px var(--border);
}
/* 维度 tab 条：竹简帘 */
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  background: linear-gradient(180deg, var(--gold-tint), var(--paper-deep));
  border-bottom: 1px solid var(--border-strong);
}
.tab {
  font: inherit;
  font-size: 12px;
  border: none;
  border-right: 1px solid var(--border);
  background: transparent;
  padding: 5px 10px;
  cursor: pointer;
  color: var(--ink-soft);
  display: flex;
  align-items: center;
  gap: 4px;
}
.tab:hover {
  background: var(--paper);
}
.tab.on {
  background: var(--paper);
  color: var(--cinnabar-deep);
  font-weight: 600;
  box-shadow: inset 0 -2px 0 var(--cinnabar);
}
/* 计数小印 */
.n {
  font-size: 10px;
  background: var(--border);
  border-radius: 2px;
  padding: 0 5px;
  line-height: 1.6;
  color: #f8efdc;
}
.tab.on .n {
  background: var(--cinnabar);
  color: #f8efdc;
}
.pane {
  padding: 8px 10px;
}
.pane-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.cap {
  font-size: 13px;
  font-weight: 600;
  font-family: 'KaiTi', 'STKaiti', 'Kaiti SC', '楷体', serif;
  letter-spacing: 1px;
}
.sub {
  font-size: 12px;
  color: var(--ink-faint);
}
.lnk {
  font: inherit;
  font-size: 12px;
  border: none;
  background: none;
  padding: 0;
  color: var(--cinnabar);
  cursor: pointer;
  border-bottom: 1px dashed currentColor;
}
.rows {
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr);
  gap: 4px 8px;
  margin: 0;
  font-size: 13px;
}
.rows dt {
  color: var(--ink-faint);
  font-size: 12px;
}
.rows dd {
  margin: 0;
  min-width: 0;
  line-height: 1.8;
  overflow-wrap: anywhere;
  word-break: break-word;
}
/* 判词：朱笔批注条 */
.ana {
  margin: 6px 0 0;
  padding: 5px 10px;
  background: var(--cinnabar-tint);
  border-left: 3px solid var(--cinnabar);
  border-radius: 0 2px 2px 0;
  font-size: 12.5px;
  line-height: 1.85;
}
.muted {
  margin: 0;
  font-size: 12px;
  color: var(--ink-faint);
}
.sib {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px dashed var(--border);
}
.lbl {
  font-size: 11px;
  color: var(--ink-faint);
}
.chip {
  font: inherit;
  font-size: 11px;
  border: 1px solid var(--border);
  background: var(--paper);
  border-radius: 2px;
  padding: 1px 7px;
  cursor: pointer;
  color: var(--ink);
}
.chip b {
  color: var(--cinnabar-deep);
  font-weight: 600;
  margin-right: 2px;
}
</style>