import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './',
  server: { host: '0.0.0.0', port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})
