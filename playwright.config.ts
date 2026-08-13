import { defineConfig, devices } from '@playwright/test'

const runningInCi = Boolean(process.env.CI)

export default defineConfig({
  testDir: './tests/browser',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: runningInCi,
  retries: runningInCi ? 2 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }]
  ],
  use: {
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium-extension',
      grep: /packaged Chrome/,
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium'
      }
    },
    {
      name: 'firefox-extension',
      grep: /packaged Firefox/,
      use: {
        ...devices['Desktop Firefox'],
        browserName: 'firefox'
      }
    }
  ]
})
