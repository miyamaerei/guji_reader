import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// 部署形态：http 静态站（hash 路由 + 相对 base），可直接发布到任意静态托管
export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // 反向代理域名要放行，否则线上预览会报「Blocked request. This host is not allowed.」
    host: '0.0.0.0',
    allowedHosts: true,
  },
  preview: {
    // 部署沙箱注入 PORT；本地预览退回 4173
    port: Number(process.env.PORT) || 4173,
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
})
