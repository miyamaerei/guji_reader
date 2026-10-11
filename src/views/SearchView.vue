<script setup lang="ts">
/**
 * 全书检索（P2.8）
 *
 * 索引在打包期生成（search-index.json），运行期线性扫描 + 多词 AND。
 * 点击结果跳回阅读器并带上 sq= 参数——阅读器据此在面包屑里挂一条「搜索结果」，
 * 否则用户点进去就回不来了（旧版最常被抱怨的一点）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { searchDocs, segmentSnippet, type SearchHit } from '@/core/search'
import { useBookStore } from '@/stores/bookContext'
import { useCrumbsStore } from '@/stores/crumbs'
import { useLayerStore } from '@/stores/layers'
import type { SearchDoc } from '@/core/types'

const route = useRoute()
const router = useRouter()
const book = useBookStore()
const crumbs = useCrumbsStore()
const layers = useLayerStore()

const bookId = computed(() => String(route.params.book ?? ''))
const q = ref(String(route.query.q ?? ''))
const hits = ref<SearchHit[]>([])
const elapsed = ref(0)
const loaded = ref(false)
const total = ref(0)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

async function run(): Promise<void> {
  if (!loaded.value) return
  const t0 = performance.now()
  hits.value = searchDocs(index.value.docs, q.value, 200)
  elapsed.value = Math.round(performance.now() - t0)
}

/** 输入去抖：避免每次按键都全文扫描 1192 条索引（单字也搜，只做轻提示） */
function debouncedRun(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void run()
  }, 200)
}

const singleChar = computed(() => q.value.trim().length === 1)

const index = ref<{ bookId: string; docs: SearchDoc[] }>({ bookId: '', docs: [] })

onMounted(async () => {
  await book.init()
  if (book.currentBookId !== bookId.value) await book.setBook(bookId.value)
  crumbs.push({ label: `${book.config?.title ?? bookId.value} · 检索`, to: `/search/${bookId.value}` })
  index.value = await layers.searchIndex(bookId.value)
  total.value = index.value.docs.length
  loaded.value = true
  await run()
})

watch(q, debouncedRun)
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

const WHERE_LABEL: Record<string, string> = { text: '原文', translation: '译文', fields: '层字段' }

function open(iid: string): void {
  router.push(`/reader/${bookId.value}?iid=${iid}&sq=${encodeURIComponent(q.value)}`)
}

const results = computed(() =>
  hits.value.map((h) => ({ ...h, segs: segmentSnippet(h.snippet, h.ranges) })),
)
</script>

<template>
  <div class="page search">
    <header class="head">
      <strong>{{ book.config?.title }} · 检索</strong>
      <span class="muted">{{ total }} 条索引</span>
      <span class="spacer" />
      <a class="mini" :href="`#/reader/${bookId}`">回阅读器</a>
    </header>

    <div class="panel">
      <div class="kw-wrap">
        <input v-model="q" class="kw" data-search-input placeholder="输入关键词，空格分隔多个词（AND）" />
        <button v-if="q" class="clear" type="button" aria-label="清除" @click="clearQuery">×</button>
      </div>
      <p class="muted stat">
        命中 {{ hits.length }} 条<span v-if="q.trim()"> · 耗时 {{ elapsed }}ms</span>
        <span v-if="singleChar" class="hint">（单字检索，结果可能较多）</span>
      </p>
    </div>

    <div class="panel results">
      <p v-if="!loaded" class="muted">索引加载中…</p>
      <p v-else-if="!q.trim()" class="muted">输入关键词开始检索。</p>
      <p v-else-if="!hits.length" class="muted">没有命中。</p>
      <ol v-else class="list">
        <li v-for="h in results" :key="h.iid">
          <button class="iid" @click="open(h.iid)">{{ h.iid }}</button>
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
  </div>
</template>

<style scoped>
.search {
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
  padding: 12px;
}

.kw {
  width: 100%;
  padding: 6px 30px 6px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font: inherit;
  font-size: 14px;
  outline: none;
}

.kw:focus {
  border-color: var(--book-primary);
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
  background: var(--border);
  color: #fff;
  border-radius: 50%;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
}

.clear:hover {
  background: var(--text-soft);
}

.stat {
  margin: 6px 0 0;
}

.hint {
  margin-left: 6px;
  font-size: 12px;
  color: var(--text-soft);
}

.results {
  flex: 1;
  min-height: 0;
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
  color: var(--book-primary);
  cursor: pointer;
  padding: 0;
}

.where {
  margin-left: 8px;
}

.wtag {
  font-size: 11px;
  color: var(--text-soft);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0 4px;
  margin-right: 4px;
}

.snip {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.9;
  color: #44443f;
}

mark {
  background: #ffe9b8;
  color: inherit;
  padding: 0 1px;
  border-radius: 2px;
}
</style>
