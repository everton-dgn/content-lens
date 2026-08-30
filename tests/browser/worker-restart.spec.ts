import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  type BrowserContext,
  chromium,
  expect,
  type Page,
  test
} from '@playwright/test'

const fixtureUrl = 'https://www.youtube.com/worker-restart'

interface OperationResult {
  effectCount: number
  operationId: string
  replayed: boolean
  state: 'committed'
}

interface CapabilityResult {
  durationMs: number
  results: Array<{
    id: string
    required: boolean
    state: string
  }>
  runtimeState: string
}

const installFixtureRoute = async (context: BrowserContext): Promise<void> => {
  const fixture = await readFile(
    resolve('tests/fixtures/runtime/fixture.html'),
    'utf8'
  )
  await context.route(fixtureUrl, route =>
    route.fulfill({
      body: fixture,
      contentType: 'text/html; charset=utf-8',
      status: 200
    })
  )
}

const openFixture = async (
  context: BrowserContext,
  expectedBrowser: 'chrome'
): Promise<Page> => {
  const page = await context.newPage()
  await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('html')).toHaveAttribute(
    'data-contentlens-runtime-ready',
    expectedBrowser
  )
  return page
}

const dispatchOperation = async (
  page: Page,
  operationId: string,
  mode: 'commit' | 'commit-then-hang'
): Promise<void> => {
  await page.locator('html').evaluate(
    (root, command) => {
      root.dataset.contentlensOperationId = command.operationId
      root.dataset.contentlensOperationMode = command.mode
      root.removeAttribute('data-contentlens-runtime-result')
      root.dispatchEvent(
        new Event('contentlens:runtime:operate', { bubbles: true })
      )
    },
    { mode, operationId }
  )
}

const readOperationResult = async (page: Page): Promise<OperationResult> =>
  expect
    .poll(async () => {
      const serialized = await page
        .locator('html')
        .getAttribute('data-contentlens-runtime-result')
      if (!serialized) {
        return null
      }
      const parsed = JSON.parse(serialized) as Partial<OperationResult>
      return parsed.state === 'committed' ? parsed : null
    })
    .not.toBeNull()
    .then(async () => {
      const serialized = await page
        .locator('html')
        .getAttribute('data-contentlens-runtime-result')
      return JSON.parse(serialized ?? '{}') as OperationResult
    })

const assertCapabilities = async (page: Page): Promise<void> => {
  await page.locator('html').dispatchEvent('contentlens:runtime:probe')
  const capabilities = await expect
    .poll(async () => {
      const serialized = await page
        .locator('html')
        .getAttribute('data-contentlens-runtime-result')
      if (!serialized) {
        return null
      }
      const parsed = JSON.parse(serialized) as Partial<CapabilityResult>
      return Array.isArray(parsed.results) ? (parsed as CapabilityResult) : null
    })
    .not.toBeNull()
    .then(async () => {
      const serialized = await page
        .locator('html')
        .getAttribute('data-contentlens-runtime-result')
      return JSON.parse(serialized ?? '{}') as CapabilityResult
    })

  expect(capabilities.durationMs).toBeLessThan(1_000)
  expect(capabilities.runtimeState).toMatch(/^(ready|degraded)$/u)
  expect(
    capabilities.results
      .filter(({ required }) => required)
      .map(({ state }) => state)
  ).toEqual(['supported', 'supported'])
}

test.describe('worker-restart', () => {
  test('replays once after a packaged Chrome service-worker restart', async ({
    browserName
  }, testInfo) => {
    expect(browserName).toBe('chromium')

    const extensionPath = resolve('.output/runtime-feasibility/chrome-mv3')
    const context = await chromium.launchPersistentContext(
      testInfo.outputPath('chromium-profile'),
      {
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`
        ],
        channel: 'chromium',
        headless: true
      }
    )

    try {
      await installFixtureRoute(context)
      const page = await openFixture(context, 'chrome')
      let [worker] = context.serviceWorkers()
      worker ??= await context.waitForEvent('serviceworker')

      const operationId = 'chrome-restart-operation'
      await dispatchOperation(page, operationId, 'commit-then-hang')
      await expect(page.locator('html')).toHaveAttribute(
        'data-contentlens-runtime-committed',
        operationId
      )

      const browser = context.browser()
      expect(browser).not.toBeNull()
      const cdp = await browser?.newBrowserCDPSession()
      expect(cdp).toBeDefined()
      if (!cdp) {
        throw new Error('Chrome DevTools Protocol session was not created.')
      }
      const { targetInfos } = await cdp.send('Target.getTargets')
      const workerTarget = targetInfos.find(
        ({ type, url }) => type === 'service_worker' && url === worker.url()
      )
      expect(workerTarget).toBeDefined()
      await cdp.send('Target.closeTarget', {
        targetId: workerTarget?.targetId ?? ''
      })

      await dispatchOperation(page, operationId, 'commit')
      expect(await readOperationResult(page)).toMatchObject({
        effectCount: 1,
        operationId,
        replayed: true,
        state: 'committed'
      })
      await assertCapabilities(page)
    } finally {
      await context.close()
    }
  })
})
