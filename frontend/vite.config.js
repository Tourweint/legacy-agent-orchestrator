import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 开发期：5173 独立进程（第 11 章 §二）；/api 代理到编排引擎 8090（避免跨源配置分散）
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8090',
    },
  },
})
