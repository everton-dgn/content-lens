import { defineConfig, devices } from '@playwright/test'

const runningInCi = Boolean(process.env.CI)

export default defineConfig({
  testDir: './tests/visual',
  outputDir: './test-results/visual',
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
  fullyParallel: false,
  forbidOnly: runningInCi,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    screenshot: 'only-on-failure'
  }
})
