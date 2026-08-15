/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Sign-in and sync both live behind /api, which nginx proxies in
    // production. Mirror that in dev so the app can authenticate against a
    // locally running sync backend (override the target with SYNC_ORIGIN).
    proxy: {
      '/api': {
        target: process.env.SYNC_ORIGIN ?? 'http://127.0.0.1:8081',
        changeOrigin: false,
      },
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // backend/ is a separate npm project (own deps, own `npm test`).
    exclude: ['**/node_modules/**', 'backend/**'],
  },
})
