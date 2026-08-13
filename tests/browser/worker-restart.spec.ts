import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  type BrowserContext,
  chromium,
  expect,
  firefox,
  type Page,
  test
} from '@playwright/test'

const fixtureUrl = 'https://www.youtube.com/worker-restart'
const firefoxExtensionId = '{74780624-e313-43b5-8558-799bbf9b95d3}'

interface FirefoxRemote {
  disconnect(): void
  installTemporaryAddon(
    addonPath: string,
    openDevTools: boolean
  ): Promise<{ addon: { id: string } }>
  reloadAddon(addonId: string): Promise<void>
}

interface FirefoxRemoteModule {
  connectWithMaxRetries(options: {
    maxRetries: number
    port: number
    retryInterval: number
  }): Promise<FirefoxRemote>
  findFreeTcpPort(): Promise<number>
}

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

const loadFirefoxRemote = async (): Promise<FirefoxRemoteModule> => {
  const projectRequire = createRequire(import.meta.url)
  const requireFromWxt = createRequire(projectRequire.resolve('wxt'))
  const webExtEntry = requireFromWxt.resolve('web-ext-run')
  const remoteModule = resolve(dirname(webExtEntry), 'lib/firefox/remote.js')

  return (await import(pathToFileURL(remoteModule).href)) as FirefoxRemoteModule
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
  expectedBrowser: 'chrome' | 'firefox'
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

  test('replays once after a packaged Firefox extension-context restart', async ({
    browserName
  }, testInfo) => {
    expect(browserName).toBe('firefox')

    const extensionPath = resolve('.output/runtime-feasibility/firefox-mv2')
    const firefoxRemote = await loadFirefoxRemote()
    const debuggerPort = await firefoxRemote.findFreeTcpPort()
    const context = await firefox.launchPersistentContext(
      testInfo.outputPath('firefox-profile'),
      {
        args: ['-start-debugger-server', String(debuggerPort)],
        firefoxUserPrefs: {
          'devtools.debugger.prompt-connection': false,
          'devtools.debugger.remote-enabled': true,
          'xpinstall.signatures.required': false
        },
        headless: true
      }
    )
    const remote = await firefoxRemote.connectWithMaxRetries({
      maxRetries: 100,
      port: debuggerPort,
      retryInterval: 50
    })

    try {
      const installed = await remote.installTemporaryAddon(extensionPath, false)
      expect(installed.addon.id).toBe(firefoxExtensionId)
      await installFixtureRoute(context)
      let page = await openFixture(context, 'firefox')
      const operationId = 'firefox-restart-operation'

      await dispatchOperation(page, operationId, 'commit-then-hang')
      await expect(page.locator('html')).toHaveAttribute(
        'data-contentlens-runtime-committed',
        operationId
      )
      await remote.reloadAddon(firefoxExtensionId)
      await page.close()
      page = await openFixture(context, 'firefox')

      await dispatchOperation(page, operationId, 'commit')
      expect(await readOperationResult(page)).toMatchObject({
        effectCount: 1,
        operationId,
        replayed: true,
        state: 'committed'
      })
      await assertCapabilities(page)
    } finally {
      remote.disconnect()
      await context.close()
    }
  })
})
