import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      dts: false,
      resolvers: [ElementPlusResolver({ importStyle: 'css' })]
    }),
    Components({
      dts: false,
      resolvers: [ElementPlusResolver({ importStyle: 'css' })]
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return
          }
          if (id.includes('element-plus')) {
            return 'element-plus'
          }
          if (id.includes('@element-plus/icons-vue')) {
            return 'element-icons'
          }
          if (
            id.includes('\\vue\\')
            || id.includes('/vue/')
            || id.includes('pinia')
            || id.includes('vue-router')
          ) {
            return 'vue-vendor'
          }
          return 'vendor'
        }
      }
    }
  },
  server: {
    allowedHosts: ['.trycloudflare.com'],
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, '')
      }
    }
  }
})
