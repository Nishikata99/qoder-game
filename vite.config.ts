import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// base: './' 是静态部署的硬性要求：Qoder Sites / 任何子路径托管下，
// 模型、贴图、音效都必须能以相对路径解析，否则会 404。
export default defineConfig({
  base: './',
  plugins: [tailwindcss()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
})
