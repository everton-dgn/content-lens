import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

process.env.NODE_ENV = 'test'

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url))
}

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    clearMocks: true,
    coverage: {
      exclude: [
        '.output/**',
        '.wxt/**',
        'tests/**',
        '**/*.config.ts',
        '**/*.d.ts',
        'src/entrypoints/**',
        'src/i18n/generate-message-keys.ts',
        'src/i18n/message-keys.generated.ts'
      ],
      include: ['src/**/*.{ts,tsx}'],
      provider: 'v8',
      thresholds: {
        branches: 84,
        functions: 90,
        lines: 90,
        statements: 90
      }
    },
    projects: [
      {
        extends: true,
        test: {
          environment: 'happy-dom',
          exclude: [
            'src/**/*.i18n.test.{ts,tsx}',
            'src/**/*.a11y.test.{ts,tsx}',
            'tests/a11y/**/*.test.{ts,tsx}',
            'tests/browser/**/*.test.{ts,tsx}',
            'tests/i18n/**/*.test.{ts,tsx}',
            'tests/migrations/**/*.test.{ts,tsx}',
            'tests/soak/**/*.test.{ts,tsx}'
          ],
          include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
          name: 'unit'
        }
      },
      {
        resolve: { alias },
        test: {
          environment: 'node',
          include: ['tests/migrations/**/*.test.{ts,tsx}'],
          name: 'migrations',
          testTimeout: 120_000
        }
      },
      {
        extends: true,
        test: {
          environment: 'happy-dom',
          include: [
            'src/**/*.i18n.test.{ts,tsx}',
            'tests/i18n/**/*.test.{ts,tsx}'
          ],
          name: 'i18n'
        }
      },
      {
        extends: true,
        test: {
          environment: 'happy-dom',
          include: [
            'src/**/*.a11y.test.{ts,tsx}',
            'tests/a11y/**/*.test.{ts,tsx}'
          ],
          name: 'a11y'
        }
      }
    ],
    restoreMocks: true
  }
})
