<script setup lang="ts">
/**
 * 书架（P2.2 → 联邦模式）
 * 卡片内容全部来自联邦 API /api/books（书目元信息出自 kb.sqlite 的 book_meta 表），
 * 不写死任何一本书；副标题缺失时由统计派生兜底。
 */
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBookStore } from '@/stores/bookContext'

const book = useBookStore()
const router = useRouter()

onMounted(() => book.init())

const books = computed(() => book.manifest)

/** 统计项里挑几个有意义的展示，顺序固定避免每次渲染抖动 */
const STAT_KEYS = ['items', 'volumes', 'entities', 'mentions', 'event']

function statsOf(s: Record<string, number> | undefined) {
  if (!s) return []
  return STAT_KEYS.filter((k) => s[k] !== undefined).map((k) => ({ k, v: s[k] }))
}

const STAT_LABEL: Record<string, string> = {
  items: '条目',
  volumes: '卷',
  entities: '实体',
  mentions: '标注',
  event: '事件',
}

async function open(bookId: string): Promise<void> {
  await book.setBook(bookId)
  router.push(`/reader/${bookId}`)
}
</script>

<template>
  <div class="page shelf">
    <h2 class="kai">
      <span class="seal seal-sm" aria-hidden="true">架</span>
      书架
      <span class="muted count">共 {{ books.length }} 部</span>
    </h2>
    <p v-if="book.error" class="muted err">{{ book.error }}</p>
    <p v-else-if="!books.length" class="muted">暂无可用书籍（联邦库未返回书目，检查 API 服务是否运行：npm run dev:fed）</p>

    <div class="grid">
      <article v-for="b in books" :key="b.bookId" class="card" @click="open(b.bookId)">
        <div class="spine" aria-hidden="true" />
        <div class="title kai">{{ b.title }}</div>
        <div class="muted sub">{{ b.subtitle }}</div>
        <div v-if="b.genre" class="genre">{{ b.genre }}</div>
        <div class="badges">
          <span class="tag">{{ b.layerCount }} 层</span>
          <span v-for="s in statsOf(b.stats)" :key="s.k" class="tag">
            {{ STAT_LABEL[s.k] ?? s.k }} {{ s.v }}
          </span>
        </div>
        <div class="acts">
          <a class="go" :href="`#/reader/${b.bookId}`" @click.stop>阅读</a>
          <a class="go ghost" :href="`#/list/${b.bookId}`" @click.stop>总览</a>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
/* 页题：题签式（印章 + 楷体 + 计数） */
.shelf h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 14px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.shelf h2 .count {
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 1px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}

/* 册页：纸 card + 赭石双线框 + 顶部书脊丝带 */
.card {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0) 45%),
    var(--paper);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 14px 14px 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
  box-shadow:
    0 0 0 1px var(--border),
    0 1px 4px rgba(94, 72, 38, 0.1);
  transition: box-shadow 0.15s, transform 0.15s;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow:
    0 0 0 1px var(--ochre),
    0 6px 14px rgba(94, 72, 38, 0.18);
}

/* 书脊：仿线装书脊的丝带，压在卡片上沿 */
.spine {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: var(--radius) var(--radius) 0 0;
  background: linear-gradient(90deg, var(--cinnabar) 0%, var(--gold) 55%, var(--ochre) 100%);
  opacity: 0.85;
}

.title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 1px;
}

.sub {
  font-size: 12px;
}

/* 体裁：竖排题签贴在右侧 */
.genre {
  position: absolute;
  top: 12px;
  right: 10px;
  font-size: 11px;
  color: var(--cinnabar-deep);
  background: var(--cinnabar-tint);
  border: 1px solid var(--cinnabar);
  border-radius: 2px;
  padding: 4px 2px;
  writing-mode: vertical-rl;
  letter-spacing: 2px;
  line-height: 1.2;
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 2px;
}

.acts {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.go {
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 2px 12px;
  color: var(--ink-soft);
  background: var(--paper);
}

.go:hover {
  border-color: var(--cinnabar);
  color: var(--cinnabar-deep);
  background: var(--cinnabar-tint);
}

.go.ghost {
  color: var(--ink-faint);
}

.err {
  color: var(--err);
}
</style>
