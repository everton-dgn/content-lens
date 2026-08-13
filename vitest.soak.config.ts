import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    clearMocks: true,
    environment: 'happy-dom',
    include: ['tests/soak/**/*.test.{ts,tsx}'],
    passWithNoTests: false,
    restoreMocks: true,
    testTimeout: 30_000
  }
})
