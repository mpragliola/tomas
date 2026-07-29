import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // GitHub Pages serves a project site from /<repo>/, so the built asset URLs cannot be
  // absolute. The deploy workflow sets this; locally it stays '/' and dev is unaffected.
  base: process.env.BASE_PATH || '/',
  publicDir: 'public',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
  optimizeDeps: {
    include: ['fft.js', 'plotly.js', 'wavesurfer.js'],
  },
  resolve: {
    alias: {
      'buffer/': 'buffer',
    },
  },
  define: {
    global: 'globalThis',
  },
})
