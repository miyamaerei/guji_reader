<script setup lang="ts">
/**
 * 层总览（P2.2 / P2.7）
 *
 * 三个内建视图 + 各书声明的层，全部由 book.config.json 推导：
 *  · 条目 → 卷列表（点卷进阅读器，不在这里铺 1192 条正文）
 *  · 跨层索引 → 贯通表（layer_count 列，来自 join.json）
 *  · 各层 → chips / 树筛选 + 表格或卡片
 *
 * 筛选计数直接取 enums.json，与筛选后的实际条数同源（tree.ts 的单测锁死了这条语义）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChipFilter from '@/components/common/ChipFilter.vue'
import EvidenceBlock from '@/components/common/EvidenceBlock.vue'
import FieldValue from '@/components/common/FieldValue.vue'
import InfiniteList from '@/components/common/InfiniteList.vue'
import VirtualList from '@/components/common/VirtualList.vue'
import LayerTabs from '@/components/common/LayerTabs.vue'
import TreeNav from '@/components/common/TreeNav.vue'
import { buildHierarchy, buildTagHierarchy, valueHasTag, type TreeNode } from '@/core/tree'
import { dataProvider } from '@/core/dataProvider'
import { useBookStore } from '@/stores/bookContext'
import { useCrumbsStore } from '@/stores/crumbs'
import { useLayerStore } from '@/stores/layers'
import type { EnumFile, JoinRow, LayerId, LayerRecord } from '@/core/types'

const route = useRoute()
const router = useRouter()
const book = useBookStore()
const crumbs = useCrumbsStore()
const layers = useLayerStore()

const bookId = computed(() => String(route.params.book ?? ''))
const enums = ref<EnumFile>({})
const joinRows = ref<JoinRow[]>([])
const filter = ref('')
/** tags 模式下的标签筛选（与 filter 互斥） */
const filterTag = ref('')
const openKeys = ref<Set<string>>(new Set())

const decl = computed(() => book.config?.layers.find((l) => l.id === book.currentLayer) ?? null)
const isBuiltin = computed(() => ['item', 'join'].includes(book.currentLayer))

/** 卷阅读模式（P3.7）：派生出的模式树；新官 enabled:false 时为 null，前端自动隐藏 */
const volProfile = computed(() => book.volProfile)
const selectedMode = ref('')
const visibleVolumes = computed(() => {
  const vols = book.meta?.volumes ?? []
  if (!volProfile.value || !selectedMode.value) return vols
  const byVolume = volProfile.value.byVolume
  return vols.filter((v) => byVolume[v.id] === selectedMode.value)
})

const records = computed<LayerRecord[]>(() => {
  if (isBuiltin.value) return []
  return layers.recordsOf(bookId.value, book.currentLayer) ?? []
})

const enumValues = computed(() => {
  if (!decl.value) return []
  const by = decl.value.filterBy ?? ''
  return enums.value[book.currentLayer]?.[by] ?? []
})

/** 树形筛选的构建方式：配置优先，否则按值域里出现的分隔符自动判定 */
const treeMode = computed<'prefix' | 'tags'>(() => {
  if (decl.value?.filterTree) return decl.value.filterTree
  return enumValues.value.some((e) => String(e.value).includes('+')) ? 'tags' : 'prefix'
})
const tagSep = computed(() => decl.value?.filterSep ?? '+')

const tagTree = computed(() =>
  buildTagHierarchy(
    enumValues.value.map((e) => ({ value: e.value, count: e.count })),
    tagSep.value,
  ),
)

/** 树形筛选（如规则基类）：父节点计数 = 子孙累计 */
const filterTreeNodes = computed<TreeNode[]>(() =>
  treeMode.value === 'tags'
    ? tagTree.value.nodes
    : buildHierarchy(enumValues.value.map((e) => ({ value: e.value, count: e.count }))),
)

/** 筛选后的记录：计数与结果数同源，不做二次估算 */
const filtered = computed<LayerRecord[]>(() => {
  const by = decl.value?.filterBy ?? ''
  if (!by) return records.value
  if (filterTag.value) {
    // tags 模式：点基类节点 → 命中含该标签的全部组合
    return records.value.filter((r) => valueHasTag(String(r[by] ?? ''), filterTag.value, tagSep.value))
  }
  if (filter.value) return records.value.filter((r) => String(r[by] ?? '') === filter.value)
  return records.value
})

const filterLabel = computed(() => filterTag.value || filter.value || '（全部）')

async function ensureBook(): Promise<void> {
  if (!bookId.value) return
  if (book.currentBookId !== bookId.value) {
    await book.setBook(bookId.value, { layer: String(route.query.layer ?? 'item') })
    crumbs.push({
      label: `${book.config?.title ?? bookId.value} · 总览`,
      to: `/list/${bookId.value}`,
    })
  }
  enums.value = await dataProvider.enums(bookId.value)
}

async function ensureLayer(id: LayerId): Promise<void> {
  if (isBuiltin.value) return
  await layers.load(bookId.value, id)
}

onMounted(async () => {
  await book.init()
  await ensureBook()
  const jf = await layers.join(bookId.value)
  joinRows.value = jf.rows
  await ensureLayer(book.currentLayer)
})

watch(bookId, ensureBook)
watch(
  () => book.currentLayer,
  async (id) => {
    filter.value = ''
    filterTag.value = ''
    if (joinRows.value.length === 0 && bookId.value) {
      const jf = await layers.join(bookId.value)
      joinRows.value = jf.rows
    }
    await ensureLayer(id)
  },
)

function openItem(iid: string): void {
  router.push(`/reader/${bookId.value}?iid=${iid}`)
}

function onLayerSelect(id: string): void {
  book.setLayer(id)
}

const sortedJoinRows = computed(() =>
  [...joinRows.value].sort((a, b) => b.layer_count - a.layer_count),
)

function toggleFilterKey(k: string): void {
  const n = new Set(openKeys.value)
  if (n.has(k)) n.delete(k)
  else n.add(k)
  openKeys.value = n
}

/** 分支节点 = 标签（包含语义），叶子节点 = 具体值（等值语义） */
function onFilterPick(node: TreeNode): void {
  const value = String(node.payload?.value ?? node.key)
  if (node.payload?.tag) {
    filterTag.value = filterTag.value === value ? '' : value
    filter.value = ''
  } else {
    filter.value = filter.value === value ? '' : value
    filterTag.value = ''
  }
}

/** 当前被选中的筛选节点 key（用于树高亮） */
const filterCurrent = computed(() => (filterTag.value || filter.value) ?? '')

function titleOf(rec: LayerRecord): string {
  const f = decl.value?.fields ?? {}
  for (const k of Object.keys(f)) {
    const v = rec[k]
    if (typeof v === 'string' && v) return v
  }
  return rec.id
}

/** 当前层的加载/失败态（来自 layers store，避免把「加载中」误显示成「空」） */
const layerKey = computed(() => `${bookId.value}/${book.currentLayer}`)
const layerLoading = computed(() => layers.loading.has(layerKey.value))
const layerFailed = computed(() => layers.failed.has(layerKey.value))

async function retryLayer(): Promise<void> {
  if (isBuiltin.value) return
  await layers.retry(bookId.value, book.currentLayer)
}
</script>

<template>
  <div class="page list-view">
    <header class="head">
      <strong>{{ book.config?.title }} · 总览</strong>
      <span class="spacer" />
      <a class="mini" :href="`#/reader/${bookId}`">回阅读器</a>
    </header>

    <LayerTabs :tabs="book.tabs" :current="book.currentLayer" @select="onLayerSelect" />

    <!-- 条目：卷列表 -->
    <section v-if="book.currentLayer === 'item'" class="panel">
      <p class="muted">共 {{ book.meta?.volumes.length }} 卷，点卷进入阅读器（正文不在此处铺开）。</p>

      <!-- 卷阅读模式（P3.7）：模式 → 卷 过滤；无源标注时退化为单一「全卷」 -->
      <div v-if="volProfile" class="volmodes">
        <span class="lbl">卷模式：</span>
        <button
          v-for="m in volProfile.modes"
          :key="m.key"
          class="vchip"
          :class="{ on: selectedMode === m.key }"
          @click="selectedMode = selectedMode === m.key ? '' : m.key"
        >
          {{ m.label }}（{{ m.volumeCount }} 卷）
        </button>
        <button v-if="selectedMode" class="vchip clear" @click="selectedMode = ''">清除</button>
      </div>

      <div class="cards">
        <a
          v-for="v in visibleVolumes"
          :key="v.id"
          class="vcard"
          :href="`#/reader/${bookId}?vol=${v.id}`"
        >
          <span class="vl">{{ v.label }}</span>
          <span class="muted">{{ v.itemCount }} 条</span>
        </a>
      </div>
      <p v-if="volProfile && selectedMode" class="muted note">
        已选模式「{{ volProfile.modes.find((m) => m.key === selectedMode)?.label }}」，
        列出 {{ visibleVolumes.length }} 卷、{{ visibleVolumes.reduce((s, v) => s + v.itemCount, 0) }} 条。
      </p>
    </section>

    <!-- 跨层索引 -->
    <section v-else-if="book.currentLayer === 'join'" class="panel">
      <p class="muted">共 {{ joinRows.length }} 条，按贯通层数降序。</p>
      <table class="tbl">
        <thead>
          <tr>
            <th>条目</th>
            <th>卷</th>
            <th>贯通</th>
            <th v-for="c in (book.config?.join.layers ?? [])" :key="c">{{ c }}</th>
          </tr>
        </thead>
        <tbody>
          <InfiniteList :items="sortedJoinRows">
            <template #default="{ item }">
              <tr>
                <td><button class="link" @click="openItem(item.item_id)">{{ item.item_id }}</button></td>
                <td>{{ item.volume }}</td>
                <td class="num">{{ item.layer_count }}</td>
                <td v-for="c in (book.config?.join.layers ?? [])" :key="c" class="num">
                  {{ item.ids?.[c]?.length || '' }}
                </td>
              </tr>
            </template>
          </InfiniteList>
        </tbody>
      </table>
    </section>

    <!-- 各层 -->
    <section v-else class="panel layers">
      <div class="filter-row">
        <ChipFilter
          v-if="decl?.filter === 'chips'"
          v-model="filter"
          :items="enumValues"
          :total="records.length"
        />
      </div>

      <div class="split" v-if="decl?.filter === 'tree'">
        <div class="ftree">
          <TreeNav
            :nodes="filterTreeNodes"
            :open="openKeys"
            :current="filterCurrent"
            :searchable="false"
            select-branch
            @toggle="toggleFilterKey"
            @select="onFilterPick"
          />
        </div>
        <div class="fmain">
          <p class="muted">
            当前筛选：<b>{{ filterLabel }}</b> ｜ 命中 {{ filtered.length }} 条 / 共
            {{ records.length }} 条
          </p>
          <p v-if="treeMode === 'tags'" class="muted note">
            该值域是「A+B」组合（如「禁止型+程序型」），一个组合同时归入多个基类，
            所以各基类命中数之和 {{ tagTree.total + tagTree.overlap }} 大于总数
            {{ tagTree.total }}——这是组合被重复计入，不是算错。
          </p>
        </div>
      </div>

      <p v-if="layerLoading && !records.length" class="muted">层数据加载中…</p>
      <p v-else-if="layerFailed && !records.length" class="muted">
        层数据缺失，<button class="link" @click="retryLayer">点此重试</button>
      </p>
      <p v-else-if="!records.length" class="muted">层数据尚未加载。</p>
      <p v-else-if="filtered.length === 0" class="muted empty-filter">
        未匹配到任何记录（当前筛选：<b>{{ filterLabel }}</b>）
      </p>
      <p v-else class="muted">
        共 {{ records.length }} 条<span v-if="filter || filterTag">，筛选后 {{ filtered.length }} 条</span>
      </p>

      <table v-if="decl?.views?.list === 'table'" class="tbl">
        <thead>
          <tr>
            <th>编号</th>
            <th v-for="(f, k) in decl?.fields ?? {}" :key="k">{{ f.label }}</th>
            <th>条目</th>
          </tr>
        </thead>
        <tbody>
          <InfiniteList :items="filtered">
            <template #default="{ item }">
              <tr>
                <td class="mono">{{ item.id }}</td>
                <td v-for="(f, k) in decl?.fields ?? {}" :key="k">
                  <FieldValue :value="item[k]" :field="f" :colors="book.config?.colors.entityTypes" />
                </td>
                <td><button class="link" @click="openItem(String(item.item_id))">{{ item.item_id }}</button></td>
              </tr>
            </template>
          </InfiniteList>
        </tbody>
      </table>

      <!--
        卡片流走虚拟滚动（P5.2）：ent 2253 / trl 1192 / struct 677 条，
        分页追加会让 DOM 无上限增长。这里只渲染视口内的行。

        上面的 <table> 仍用 InfiniteList —— 表格行不能脱离 <tbody> 单独绝对定位，
        否则破坏表格语义（分页追加在表格里至少是合法的）。
      -->
      <div v-else class="cards vcards">
        <VirtualList :items="filtered" :estimate-h="150">
          <template #default="{ item }">
            <article class="rec">
              <div class="rec-head">
                <span class="mono">{{ item.id }}</span>
                <strong>{{ titleOf(item) }}</strong>
                <span class="spacer" />
                <button class="link" @click="openItem(String(item.item_id))">{{ item.item_id }}</button>
              </div>
              <dl class="fields">
                <template v-for="(f, k) in decl?.fields ?? {}" :key="k">
                  <dt v-if="f.view !== 'hide'">{{ f.label }}</dt>
                  <dd v-if="f.view !== 'hide'">
                    <FieldValue :value="item[k]" :field="f" :colors="book.config?.colors.entityTypes" />
                  </dd>
                </template>
              </dl>
              <EvidenceBlock :original="item.original" :source="item.source" :confidence="item.confidence" />
            </article>
          </template>
        </VirtualList>
      </div>
    </section>
  </div>
</template>

<style scoped>
.list-view {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.spacer {
  flex: 1;
}

.mini {
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 8px;
  color: var(--text-soft);
}

.mini:hover {
  border-color: var(--book-primary);
  color: var(--book-primary);
}

.panel {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
}

.filter-row {
  margin-bottom: 10px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.vcard {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  background: #fff;
  font-size: 13px;
}

.vcard:hover {
  border-color: var(--book-primary);
}

.volmodes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-bottom: 10px;
}

.volmodes .lbl {
  font-size: 13px;
  color: var(--text-soft);
}

.vchip {
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
  border-radius: 12px;
  padding: 1px 10px;
  cursor: pointer;
  color: var(--text-soft);
}

.vchip.on {
  border-color: var(--book-primary);
  color: var(--book-primary);
  background: #fff;
}

.vchip.clear {
  background: #fff;
}

.rec {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
}

.rec-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.mono {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: var(--text-soft);
}

.fields {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 2px 8px;
  margin: 6px 0 0;
  font-size: 13px;
}

.fields dt {
  color: var(--text-soft);
}

.fields dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin-top: 10px;
}

.tbl th,
.tbl td {
  border-bottom: 1px solid var(--border);
  padding: 4px 8px;
  text-align: left;
  vertical-align: top;
}

.tbl th {
  color: var(--text-soft);
  font-weight: 500;
  background: var(--bg-soft);
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.link {
  font: inherit;
  border: none;
  background: none;
  color: var(--book-primary);
  cursor: pointer;
  padding: 0;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}

.split {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 12px;
}

/*
 * 虚拟滚动容器（P5.2）：必须有确定的高度与独立滚动，
 * 否则内部算出的 totalHeight 无处生效，退化成整页滚动。
 * 高度给 vh 单位是为了随视口自适应，又不至于让长列表失去滚动条意义。
 */
.vcards {
  height: min(70vh, 720px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 4px;
}

.ftree {
  max-height: 420px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px;
}

.note {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-soft);
}

.empty-filter {
  margin: 16px 0 0;
  padding: 18px;
  text-align: center;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  background: var(--bg-soft);
}

@media (max-width: 820px) {
  .split {
    grid-template-columns: 1fr;
  }

  .ftree {
    max-height: 240px;
  }
}
</style>
