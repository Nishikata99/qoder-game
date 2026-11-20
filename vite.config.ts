import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base: './' 是静态部署的硬性要求：Qoder Sites / 任何子路径托管下，
// 资源都必须能以相对路径解析，否则会 404。
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    // 双入口：主游戏 index.html + 蔓延子游戏 moyan.html
    rollupOptions: {
      input: {
        main: 'index.html',
        moyan: 'moyan.html',
      },
      output: {
        // three 体量大且几乎不随业务代码变化，单独成块可让浏览器长期复用缓存
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules/gsap')) return 'gsap'
          if (id.includes('node_modules/react')) return 'react'
          return undefined
        },
      },
    },
  },
})
