<script setup lang="ts">
/**
 * 规则槽位树（P4.1）
 *
 * 把一条规范型规则拆成语义槽位树：条件 / 主体 / 行为（义务·禁止·允许）/ 约束
 * （对象·目的·时限·处罚·禁忌）。
 *
 * 为什么不用通用字段表（view: block）：规则的 10 个槽位填充极不均匀
 * （obligation 256/273，permission 仅 24/273），平铺成表格大半是「—」。
 * 槽位树只渲染有值的槽位，所以「看到的行数 === 实际有值的槽位数」。
 * 行为簇显隐由模态决定：数据里 type 是 `禁止型+程序型` 多标签组合，
 * 只有禁止模态的规则不该挂一个空的「义务」节点。
 */
import { computed } from 'vue'
import { buildRuleSlots } from '@/core/xinguanBlocks'
import type { LayerRecord } from '@/core/types'

const props = defineProps<{ record: LayerRecord }>()

const tree = computed(() => buildRuleSlots(props.record))
/** 行为簇只在模态含允许/禁止时才显示「义务」——义务型单模态必有 obligation */
const hasRichBehavior = computed(
  () => tree.value.modalities.includes('禁止型') || tree.value.modalities.includes('允许型'),
)
</script>

<template>
  <div class="rule-slots">
    <div class="head">
      <span class="cap">规范槽位</span>
      <span class="mods">
        <span
          v-for="m in tree.modalities"
          :key="m"
          class="mod"
          :style="{ background: tree.colors[m], borderColor: tree.colors[m] }"
          >{{ m }}</span
        >
      </span>
      <span class="cnt">{{ tree.filled.length }} 个槽位</span>
    </div>

    <p v-if="!tree.filled.length" class="muted">该规则未抽出任何槽位。</p>

    <ul v-else class="tree">
      <li v-for="n in tree.root.children" :key="n.key" class="node" :class="n.key">
        <span class="slot">{{ n.label }}</span>
        <span v-if="n.value" class="val">{{ n.value }}</span>
        <ul v-if="n.children.length" class="kids">
          <li v-for="c in n.children" :key="c.key" class="node leaf">
            <span class="slot">{{ c.label }}</span>
            <span class="val">{{ c.value }}</span>
          </li>
        </ul>
      </li>
    </ul>

    <p v-if="hasRichBehavior" class="tip">
      多模态规则：行为簇按 type 声明的模态显隐，未声明的模态不占位。
    </p>
  </div>
</template>

<style scoped>
.rule-slots {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 10px;
  background: var(--bg-soft);
}
.head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.cap {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-soft);
}
.mods {
  display: flex;
  gap: 3px;
}
.mod {
  font-size: 11px;
  line-height: 1.6;
  padding: 0 6px;
  border-radius: 9px;
  color: #fff;
  border: 1px solid transparent;
}
.cnt {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-soft);
}
.tree {
  list-style: none;
  margin: 0;
  padding: 0;
}
.node {
  padding: 3px 0;
  border-top: 1px dashed var(--border);
}
.node:first-child {
  border-top: none;
}
.slot {
  display: inline-block;
  min-width: 34px;
  margin-right: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--book-primary);
}
.val {
  font-size: 13px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.kids {
  list-style: none;
  margin: 2px 0 0 40px;
  padding: 0;
  border-left: 2px solid var(--border);
  padding-left: 8px;
}
.leaf .val {
  color: var(--text-soft);
}
.muted {
  font-size: 12px;
  color: var(--text-soft);
  margin: 2px 0 0;
}
.tip {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text-soft);
  opacity: 0.8;
}
</style>