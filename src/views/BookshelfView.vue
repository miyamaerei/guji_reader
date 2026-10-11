<script setup lang="ts">
/**
 * 书架（P2.2）
 * 卡片内容全部来自 public/data/index.json + 各书 meta，不写死任何一本书。
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
    <h2>书架</h2>
    <p v-if="book.error" class="muted err">{{ book.error }}</p>
    <p v-else-if="!books.length" class="muted">暂无可用书籍（数据包尚未生成，先跑 npm run pack）</p>

    <div class="grid">
      <article v-for="b in books" :key="b.bookId" class="card" @click="open(b.bookId)">
        <div class="title">{{ b.title }}</div>
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
.shelf h2 {
  font-size: 16px;
  font-weight: 500;
  margin: 0 0 12px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-top: 3px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card:hover {
  border-color: var(--border);
  border-top-color: var(--book-primary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.title {
  font-size: 15px;
  font-weight: 500;
}

.sub {
  font-size: 12px;
}

.genre {
  font-size: 12px;
  color: var(--text-soft);
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
  border-radius: 4px;
  padding: 2px 10px;
  color: var(--text);
}

.go:hover {
  border-color: var(--book-primary);
  color: var(--book-primary);
}

.go.ghost {
  color: var(--text-soft);
}

.err {
  color: #a32d2d;
}
</style>
