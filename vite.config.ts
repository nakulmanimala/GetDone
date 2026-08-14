/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // backend/ is a separate npm project (own deps, own `npm test`).
    exclude: ['**/node_modules/**', 'backend/**'],
  },
})
