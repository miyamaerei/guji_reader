/**
 * 路由（设计文档 §6.1）
 * 部署形态为 http 静态站，采用 hash 路由：静态托管无需服务端 rewrite 配置。
 */
import { createRouter, createWebHashHistory } from 'vue-router'
import BookshelfView from '@/views/BookshelfView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'bookshelf', component: BookshelfView },
    {
      path: '/reader/:book',
      name: 'reader',
      component: () => import('@/views/ReaderView.vue'),
    },
    {
      path: '/list/:book',
      name: 'list',
      component: () => import('@/views/ListView.vue'),
    },
    {
      path: '/detail/:book/:kind/:id',
      name: 'detail',
      component: () => import('@/views/DetailView.vue'),
    },
    {
      path: '/search/:book',
      name: 'search',
      component: () => import('@/views/SearchView.vue'),
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

export default router
