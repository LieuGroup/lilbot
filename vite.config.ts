import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `bun run dev` serves the UI with hot reload and forwards the socket to the LilBot server.
export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./web/src', import.meta.url)) } },
  build: { outDir: '../dist', emptyOutDir: true },
  server: { fs: { allow: ['..'] }, proxy: { '/ws': { target: 'ws://127.0.0.1:3370', ws: true }, '/api': 'http://127.0.0.1:3370' } }
})
