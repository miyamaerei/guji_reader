<script setup lang="ts">
/**
 * 全书检索（P7 联邦数据库形态）
 *
 * 检索从「前端线性扫描 search-index.json」升级为后端 SQLite 实时查询
 * （/api/search：多词 AND，可书内可跨书联邦；/api/assoc：联邦实体合并关联）。
 *
 * 点击结果跳回阅读器并带上 sq= 参数——阅读器据此在面包屑里挂一条「搜索结果」，
 * 否则用户点进去就回不来了（旧版最常被抱怨的一点）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { excerpt, segmentSnippet } from '@/core/search'
import { api, type FedAssocResult, type FedSearchDoc } from '@/core/api'
import { useBookStore } from '@/stores/bookContext'
import { useCrumbsStore } from '@/stores/crumbs'

const route = useRoute()
const router = useRouter()
const book = useBookStore()
const crumbs = useCrumbsStore()

const bookId = computed(() => String(route.params.book ?? ''))
const q = ref(String(route.query.q ?? ''))
/** 联邦跨书检索开关 */
const federated = ref(false)
const hits = ref<FedSearchDoc[]>([])
const elapsed = ref(0)
const loading = ref(false)
const loaded = ref(false)
const total = ref(0)
const err = ref('')

const assoc = ref<FedAssocResult | null>(null)
const assocLoading = ref(false)
const assocElapsed = ref(0)
const assocErr = ref('')

let debounceTimer: ReturnType<typeof setTimeout> | null = null

const terms = computed(() =>
  q.value
    .trim()
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean),
)

async function run(): Promise<void> {
  if (!terms.value.length) {
    hits.value = []
    total.value = 0
    elapsed.value = 0
    return
  }
  loading.value = true
  err.value = ''
  try {
    const r = await api.search(terms.value, federated.value ? undefined : bookId.value)
    hits.value = r.docs
    total.value = r.total
    elapsed.value = r.elapsed
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e)
    hits.value = []
  } finally {
    loading.value = false
    loaded.value = true
  }
}

async function runAssoc(): Promise<void> {
  const kw = q.value.trim()
  if (!kw) {
    assoc.value = null
    return
  }
  assocLoading.value = true
  assocErr.value = ''
  try {
    const r = await api.assoc(kw)
    assoc.value = r
    assocElapsed.value = r.elapsed
  } catch (e) {
    assocErr.value = e instanceof Error ? e.message : String(e)
    assoc.value = null
  } finally {
    assocLoading.value = false
  }
}

function debouncedRun(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void run()
    void runAssoc()
  }, 200)
}

const singleChar = computed(() => terms.value.length === 1 && terms.value[0]!.length === 1)

/** 联邦开关 tooltip：书数由 manifest 动态推出（书架新增书无需改文案） */
const fedTitle = computed(() =>
  book.manifest.length ? `在全部 ${book.manifest.length} 书中跨书检索` : '联邦跨书检索',
)

onMounted(async () => {
  await book.init()
  if (book.currentBookId !== bookId.value) await book.setBook(bookId.value)
  crumbs.push({ label: `${book.config?.title ?? bookId.value} · 检索`, to: `/search/${bookId.value}` })
  // 联邦横切只从「书架/阅读器内跳转」进入
  loaded.value = true
  await run()
  await runAssoc()
})

watch(q, debouncedRun)
watch(federated, () => void run())
watch(
  () => route.query.q,
  (v) => {
    const s = String(v ?? '')
    if (s !== q.value) q.value = s
  },
)

function clearQuery(): void {
  q.value = ''
}

const WHERE_LABEL: Record<string, string> = { text: '原文', translation: '译文' }

function open(doc: FedSearchDoc): void {
  router.push(`/reader/${doc.bookId}?iid=${doc.iid}&sq=${encodeURIComponent(q.value)}`)
}

/** 命中片段：原文优先，缺省用译文；由 excerpt 生成 highlight ranges（以首个词定位） */
const results = computed(() =>
  hits.value.map((h) => {
    const source = h.text || h.translation || ''
    const ex = excerpt(source, terms.value[0] ?? '')
    return {
      ...h,
      snippet: ex.snippet,
      segs: segmentSnippet(ex.snippet, ex.ranges),
    }
  }),
)

function openRef(ref: { book_id: string; item_id: string }): void {
  router.push(`/reader/${ref.book_id}?iid=${ref.item_id}&sq=${encodeURIComponent(q.value)}`)
}

const METHOD_LABEL: Record<string, string> = {
  surface_alias: '词形别名',
  identity: '同实体',
  exact: '精确',
  fuzzy: '模糊',
}
</script>

<template>
  <div class="page search">
    <header class="head">
      <strong>{{ federated ? '联邦跨书检索' : `${book.config?.title ?? bookId} · 检索` }}</strong>
      <span class="muted">{{ total }} 条命中</span>
      <span class="spacer" />
      <a class="mini" :href="federated ? '#/' : `#/reader/${bookId}`">{{
        federated ? '回书架' : '回阅读器'
      }}</a>
    </header>

    <div class="panel">
      <div class="kw-wrap">
        <input
          v-model="q"
          class="kw"
          data-search-input
          placeholder="输入关键词，空格分隔多个词（AND）"
        />
        <button v-if="q" class="clear" type="button" aria-label="清除" @click="clearQuery">×</button>
      </div>
      <p class="muted stat">
        <label class="fed-toggle" :title="fedTitle">
          <input v-model="federated" type="checkbox" />
          联邦跨书检索
        </label>
        <template v-if="terms.length">
          命中 {{ hits.length }} 条<span> · 耗时 {{ elapsed }}ms</span>
        </template>
        <span v-if="singleChar" class="hint">（单字检索，结果可能较多）</span>
      </p>
    </div>

    <div class="panel results">
      <p v-if="err" class="muted err">{{ err }}</p>
      <p v-else-if="loading" class="muted">检索中…</p>
      <p v-else-if="!terms.length" class="muted">输入关键词开始检索。</p>
      <p v-else-if="!hits.length" class="muted">没有命中。</p>
      <ol v-else class="list">
        <li v-for="h in results" :key="`${h.bookId}:${h.iid}`">
          <button class="iid" @click="open(h)">{{ h.iid }}</button>
          <span v-if="federated" class="bchip">{{ h.book }}</span>
          <span class="where">
            <span v-for="w in h.where" :key="w" class="wtag">{{ WHERE_LABEL[w] }}</span>
          </span>
          <p class="snip">
            <template v-for="(s, i) in h.segs" :key="i">
              <mark v-if="s.hit">{{ s.text }}</mark>
              <span v-else>{{ s.text }}</span>
            </template>
          </p>
        </li>
      </ol>
    </div>

    <div class="panel assoc">
      <header class="assoc-head">
        <strong>联邦实体关联</strong>
        <span class="muted" v-if="assoc">canonical 合并 {{ assoc.groups.length }} 组 · 引用 {{ assoc.refs.length }} 条 · {{ assocElapsed }}ms</span>
        <span class="muted" v-else-if="assocLoading">正在合并…</span>
      </header>
      <p v-if="assocErr" class="muted err">{{ assocErr }}</p>
      <template v-else-if="assoc">
        <p v-if="!assoc.groups.length && !assoc.refs.length" class="muted">
          无同名实体合并组（可在联邦线用 <code>assoc identity_bridge</code> 复查）。共 {{ assoc.total }} 条。
        </p>
        <ol v-if="assoc.groups.length" class="glist">
          <li v-for="g in assoc.groups" :key="g.canonical_id">
            <span class="g-label">
              {{ g.repr_label }}
              <span v-if="g.status && g.status !== 'ok'" class="g-status">{{ g.status }}</span>
            </span>
            <span class="bchip" v-for="bk in g.books" :key="bk" :title="`覆盖书 ${bk}`">{{ bk }}</span>
            <span class="muted"> {{ g.member_count }} 个成员</span>
            <ul class="mlist">
              <li v-for="m in g.members.slice(0, 12)" :key="m.uid">
                <span class="muid">{{ m.uid }}</span>
                <span class="m-label">{{ m.label }}</span>
                <span class="wtag">{{ METHOD_LABEL[m.method] ?? m.method }}</span>
                <span v-if="m.confidence != null" class="muted conf">{{ (m.confidence * 100).toFixed(0) }}%</span>
              </li>
            </ul>
          </li>
        </ol>
        <ol v-if="assoc.refs.length" class="rlist">
          <li v-for="(r, i) in assoc.refs" :key="i">
            <button class="iid" @click="openRef(r)">{{ r.book_id }}:{{ r.item_id }}</button>
            <span class="wtag">{{ r.field || r.layer_key }}</span>
            <span class="rtarget">{{ r.target_text }}</span>
            <span v-if="r.target_ambiguous" class="g-status">歧义</span>
          </li>
        </ol>
      </template>
    </div>
  </div>
</template>

<style scoped>
.search {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.head h2 {
  font-family: 'KaiTi', 'STKaiti', 'Kaiti SC', '楷体', serif;
  letter-spacing: 2px;
}

.spacer {
  flex: 1;
}

.mini {
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 3px 9px;
  color: var(--ink-soft);
  background: var(--paper);
  cursor: pointer;
  font-family: inherit;
}

.mini:hover {
  border-color: var(--cinnabar);
  color: var(--cinnabar-deep);
}

.panel {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0) 30%),
    var(--paper);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 12px;
  box-shadow: 0 0 0 1px var(--border), 0 1px 5px rgba(94, 72, 38, 0.1);
}

.fed-toggle {
  margin-right: 10px;
  font-size: 13px;
  color: var(--ink-soft);
  cursor: pointer;
  user-select: none;
}

.fed-toggle input {
  margin-right: 4px;
  vertical-align: -1px;
  accent-color: var(--cinnabar);
}

.kw {
  width: 100%;
  padding: 6px 30px 6px 10px;
  border: 1px solid var(--border);
  border-radius: 2px;
  font: inherit;
  font-size: 14px;
  outline: none;
  background: var(--paper);
  color: var(--ink);
}

.kw:focus {
  border-color: var(--ochre);
  box-shadow: 0 0 0 2px var(--gold-tint);
}

.kw-wrap {
  position: relative;
}

.clear {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  border: none;
  background: var(--border-strong);
  color: #f8efdc;
  border-radius: 2px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
}

.clear:hover {
  background: var(--cinnabar);
}

.stat {
  margin: 6px 0 0;
}

.hint {
  margin-left: 6px;
  font-size: 12px;
  color: var(--ink-faint);
}

.err {
  color: var(--err);
}

.results {
  flex: 1;
  min-height: 120px;
  max-height: 46vh;
  overflow: auto;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.list li {
  border-bottom: 1px dashed var(--border);
  padding-bottom: 8px;
}

.iid {
  font: inherit;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  border: none;
  background: none;
  color: var(--cinnabar);
  cursor: pointer;
  padding: 0;
}

/* 命中书别签：朱砂边 */
.bchip {
  display: inline-block;
  margin-left: 8px;
  font-size: 11px;
  color: var(--cinnabar-deep);
  border: 1px solid var(--cinnabar);
  background: var(--cinnabar-tint);
  opacity: 0.95;
  border-radius: 2px;
  padding: 0 5px;
  vertical-align: 1px;
}

.where {
  margin-left: 8px;
}

.wtag {
  font-size: 11px;
  color: var(--ink-soft);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0 4px;
  margin-right: 4px;
}

.snip {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.95;
  color: #4a4234;
}

/* ---- 联邦实体关联 ---- */
.assoc {
  max-height: 40vh;
  overflow: auto;
}

.assoc-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
}

.glist,
.rlist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.glist > li,
.rlist > li {
  border-left: 2px solid var(--ochre);
  padding: 4px 10px;
}

.g-label {
  font-weight: 600;
  font-family: 'KaiTi', 'STKaiti', 'Kaiti SC', '楷体', serif;
  letter-spacing: 1px;
}

/* canonical 组状态签：赭金 */
.g-status {
  display: inline-block;
  margin-left: 6px;
  font-size: 10px;
  color: var(--warn-text);
  border: 1px solid var(--warn-border);
  background: var(--warn-bg);
  border-radius: 2px;
  padding: 0 4px;
  vertical-align: 1px;
}

.mlist {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.muid {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: var(--ink-faint);
  margin-right: 6px;
}

.m-label {
  margin-right: 6px;
}

.conf {
  margin-left: 4px;
}

.rtarget {
  margin-left: 6px;
}

/* 命中高亮：仿朱笔圈点 —— 朱砂底 + 下划线 */
mark {
  background: var(--cinnabar-tint);
  color: var(--cinnabar-deep);
  padding: 0 1px;
  border-radius: 2px;
  box-shadow: inset 0 -2px 0 var(--cinnabar);
}
</style>