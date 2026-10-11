<script setup lang="ts">
/**
 * 应用外壳（P2.1 / P2.9）
 *
 * 面包屑是全局的、跨视图的：从检索结果点进阅读器，再点进条目详情，
 * 一路都能原路返回。切书时 crumbs 由 bookContext 清空（不跨书残留）。
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useBookStore } from '@/stores/bookContext'
import { useCrumbsStore } from '@/stores/crumbs'

const book = useBookStore()
const crumbs = useCrumbsStore()
const route = useRoute()

/** 全局快捷键：按 / 聚焦当前页的搜索框（阅读器顶栏或检索页） */
function onKeydown(e: KeyboardEvent): void {
  if (e.key !== '/') return
  const t = e.target as HTMLElement | null
  const tag = t?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return
  const el = document.querySelector<HTMLInputElement>('[data-search-input]')
  if (el) {
    e.preventDefault()
    el.focus()
    el.select?.()
  }
}

onMounted(() => {
  book.init()
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

const theme = computed(() => ({ '--book-primary': book.primaryColor }))
const bookId = computed(() => String(route.params.book ?? ''))
</script>

<template>
  <div class="app-shell" :style="theme">
    <header class="app-bar">
      <RouterLink to="/" class="brand">多书知识阅读器</RouterLink>
      <span v-if="book.config" class="tag">{{ book.config.title }}</span>
      <div class="spacer" />
      <nav v-if="bookId" class="quick">
        <RouterLink :to="`/reader/${bookId}`">阅读</RouterLink>
        <RouterLink :to="`/list/${bookId}`">总览</RouterLink>
        <RouterLink :to="`/search/${bookId}`">检索</RouterLink>
      </nav>
      <nav class="crumbs">
        <RouterLink to="/">书架</RouterLink>
        <template v-for="c in crumbs.stack" :key="c.to">
          <span class="sep">/</span>
          <RouterLink :to="c.to">{{ c.label }}</RouterLink>
        </template>
      </nav>
    </header>
    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.quick {
  display: flex;
  gap: 10px;
  font-size: 13px;
  color: var(--text-soft);
  margin-right: 14px;
}

.quick a:hover {
  color: var(--book-primary);
}
</style>
