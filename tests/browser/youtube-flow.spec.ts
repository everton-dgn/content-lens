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

import { firefoxExtensionId } from '@/config/manifest'

const youtubeOrigin = 'https://www.youtube.com/'
const fixtureUrl = (path: string, key?: string, value?: string) => {
  const url = new URL(path, youtubeOrigin)
  if (key && value) {
    url.searchParams.set(key, value)
  }
  return url.href
}
const fixtureUrls = {
  home: youtubeOrigin,
  recommendations: fixtureUrl('/watch', 'v', 'fixtureVideo'),
  search: fixtureUrl('/results', 'search_query', 'local')
} as const
const conflictProfilePath = resolve(
  'tests/fixtures/profiles/rule-conflict.json'
)

interface FirefoxRemote {
  disconnect(): void
  installTemporaryAddon(
    addonPath: string,
    openDevTools: boolean
  ): Promise<{ addon: { id: string } }>
}

interface FirefoxRemoteModule {
  connectWithMaxRetries(options: {
    maxRetries: number
    port: number
    retryInterval: number
  }): Promise<FirefoxRemote>
  findFreeTcpPort(): Promise<number>
}

const loadFirefoxRemote = async (): Promise<FirefoxRemoteModule> => {
  const projectRequire = createRequire(import.meta.url)
  const requireFromWxt = createRequire(projectRequire.resolve('wxt'))
  const webExtEntry = requireFromWxt.resolve('web-ext-run')
  const remoteModule = resolve(dirname(webExtEntry), 'lib/firefox/remote.js')
  return (await import(pathToFileURL(remoteModule).href)) as FirefoxRemoteModule
}

const installFixtureRoutes = async (
  context: BrowserContext
): Promise<{ search: string }> => {
  const [home, search, recommendations] = await Promise.all([
    readFile(resolve('tests/fixtures/youtube/packaged-home.html'), 'utf8'),
    readFile(resolve('tests/fixtures/youtube/search.html'), 'utf8'),
    readFile(resolve('tests/fixtures/youtube/related.html'), 'utf8')
  ])
  await context.route(/^https:\/\/www\.youtube\.com\//u, async route => {
    const pathname = new URL(route.request().url()).pathname
    const body =
      pathname === '/results'
        ? search
        : pathname === '/watch'
          ? recommendations
          : home
    await route.fulfill({
      body,
      contentType: 'text/html; charset=utf-8',
      status: 200
    })
  })
  return { search }
}

const waitForChromeYouTubeRegistration = async (
  context: BrowserContext
): Promise<void> => {
  let [serviceWorker] = context.serviceWorkers()
  serviceWorker ??= await context.waitForEvent('serviceworker')
  await expect
    .poll(() =>
      serviceWorker.evaluate(async () => {
        const extensionApi = (
          globalThis as typeof globalThis & {
            chrome: {
              scripting: {
                getRegisteredContentScripts(): Promise<Array<{ id: string }>>
              }
            }
          }
        ).chrome
        const registrations =
          await extensionApi.scripting.getRegisteredContentScripts()
        return registrations.map(({ id }) => id)
      })
    )
    .toContain('contentlens-platform-youtube-v1')
}

const assertProductionYoutubeFlow = async (
  context: BrowserContext,
  page: Page,
  expectedBrowser: 'chrome' | 'firefox',
  searchFixture: string
): Promise<void> => {
  await page.goto(fixtureUrls.home, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('html')).toHaveAttribute(
    'data-contentlens-runtime-ready',
    expectedBrowser
  )

  const card = page.locator('#render-card-hide')
  const originalOuterHtml = await card.evaluate(element => element.outerHTML)
  const originalHeight = await card.evaluate(
    element => element.getBoundingClientRect().height
  )
  const action = page.locator('#render-card-hide + [data-contentlens-actions]')
  await expect(action.getByRole('button')).toHaveAccessibleName(
    'Hide for this session'
  )
  await action.getByRole('button').focus()
  await expect(action.getByRole('button')).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(card).toBeHidden()
  const placeholder = page.locator(
    '#render-card-hide + [data-contentlens-placeholder]'
  )
  await expect(placeholder).toHaveCount(1)
  await expect(placeholder.getByRole('status')).toContainText(
    'Reason: hidden for this session'
  )
  expect((await placeholder.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(
    originalHeight
  )

  if (process.env.CONTENTLENS_MANUAL_A11Y === 'placeholder') {
    await page.pause()
  }

  const reveal = placeholder.getByRole('button', { name: 'Show' })
  await expect(reveal).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(card).toBeVisible()
  await expect(action.getByRole('button')).toBeFocused()
  expect(await card.evaluate(element => element.outerHTML)).toBe(
    originalOuterHtml
  )

  const staleCard = page.locator('#render-card-stale')
  await page
    .locator('#render-card-stale + [data-contentlens-actions]')
    .getByRole('button')
    .click()
  await expect(staleCard).toBeHidden()
  await staleCard.evaluate(element => {
    element
      .querySelector<HTMLAnchorElement>('#thumbnail')
      ?.setAttribute('href', '/watch?v=renderFresh04')
  })
  await expect(staleCard).toBeVisible()
  await expect(
    staleCard.locator('a[href="/watch?v=renderFresh04"]')
  ).toHaveCount(1)
  await expect(
    page.locator('#render-card-stale + [data-contentlens-placeholder]')
  ).toHaveCount(0)

  await action.getByRole('button').click()
  await expect(card).toBeHidden()
  await card.locator('#video-title-link').evaluate(title => {
    title.textContent = 'Updated title for the same stable video'
  })
  await expect(card).toBeHidden()
  await expect(placeholder).toHaveCount(1)
  await placeholder.getByRole('button', { name: 'Show' }).click()
  await action.getByRole('button').click()
  await expect(placeholder.getByRole('button', { name: 'Show' })).toBeFocused()

  await page.evaluate(() => {
    globalThis.dispatchEvent(
      new PageTransitionEvent('pagehide', { persisted: true })
    )
  })
  await expect(page.locator('[data-contentlens-actions]')).toHaveCount(0)
  await page.evaluate(() => {
    globalThis.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true })
    )
  })
  await expect(page.locator('[data-contentlens-actions]')).toHaveCount(2)
  await expect(placeholder).toHaveCount(1)
  await expect(placeholder.getByRole('button', { name: 'Show' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-contentlens-actions]')).toHaveCount(3)

  await page.evaluate(fixture => {
    const parsed = new DOMParser().parseFromString(fixture, 'text/html')
    history.pushState({}, '', '/results?search_query=spa')
    document.body.replaceChildren(...parsed.body.childNodes)
    document.dispatchEvent(new Event('yt-navigate-finish'))
  }, searchFixture)
  await expect(page.locator('html')).toHaveAttribute(
    'data-contentlens-runtime-ready',
    expectedBrowser
  )
  await expect(page.locator('[data-contentlens-actions]')).toHaveCount(2)

  await page.goto(fixtureUrls.search, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-contentlens-actions]')).toHaveCount(2)
  await page.goto(fixtureUrls.recommendations, {
    waitUntil: 'domcontentloaded'
  })
  await expect(page.locator('[data-contentlens-actions]')).toHaveCount(3)

  if (expectedBrowser === 'chrome') {
    let worker = context.serviceWorkers()[0]
    worker ??= await context.waitForEvent('serviceworker')
    const browser = context.browser()
    const cdp = await browser?.newBrowserCDPSession()
    if (!cdp) {
      throw new Error('Chrome DevTools Protocol session was not created')
    }
    const { targetInfos } = await cdp.send('Target.getTargets')
    const workerTarget = targetInfos.find(
      ({ type, url }) => type === 'service_worker' && url === worker.url()
    )
    if (!workerTarget) {
      throw new Error('Production service worker target was not found')
    }
    const closed = await cdp.send('Target.closeTarget', {
      targetId: workerTarget.targetId
    })
    expect(closed.success).toBe(true)
    await page.locator('#related-card-stable').evaluate(candidate => {
      candidate
        .querySelector<HTMLAnchorElement>('a[href*="/watch"]')
        ?.setAttribute('href', '/watch?v=afterRestart99')
    })
    await expect(
      page.locator(
        '#related-card-stable + [data-contentlens-actions][data-contentlens-decision="applied"]'
      )
    ).toHaveCount(1)
  }

  await page.evaluate(() => globalThis.dispatchEvent(new Event('pagehide')))
  await expect(page.locator('#related-card-stable')).toBeVisible()
  await expect(page.locator('[data-contentlens-placeholder]')).toHaveCount(0)
  await expect(page.locator('[data-contentlens-actions]')).toHaveCount(0)
}

test.describe('youtube-flow', () => {
  test('runs the production content flow in the packaged Chrome extension', async ({
    browserName
  }, testInfo) => {
    expect(browserName).toBe('chromium')
    const extensionPath = resolve('.output/adapter-e2e/chrome-mv3')
    const context = await chromium.launchPersistentContext(
      testInfo.outputPath('chromium-profile'),
      {
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`
        ],
        channel: 'chromium',
        headless: process.env.CONTENTLENS_MANUAL_A11Y !== 'placeholder'
      }
    )

    try {
      const fixtures = await installFixtureRoutes(context)
      await waitForChromeYouTubeRegistration(context)
      await assertProductionYoutubeFlow(
        context,
        await context.newPage(),
        'chrome',
        fixtures.search
      )
    } finally {
      await context.close()
    }
  })

  test('exposes a packaged Chrome rule conflict with a safe local action', async ({
    browserName
  }, testInfo) => {
    expect(browserName).toBe('chromium')
    const extensionPath = resolve('.output/adapter-e2e/chrome-mv3')
    const context = await chromium.launchPersistentContext(
      testInfo.outputPath('chromium-conflict-profile'),
      {
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`
        ],
        channel: 'chromium',
        headless: process.env.CONTENTLENS_MANUAL_A11Y !== 'conflict'
      }
    )

    try {
      await installFixtureRoutes(context)
      await waitForChromeYouTubeRegistration(context)
      let [serviceWorker] = context.serviceWorkers()
      serviceWorker ??= await context.waitForEvent('serviceworker')
      const extensionId = serviceWorker.url().split('/')[2]
      const panel = await context.newPage()
      await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
        waitUntil: 'domcontentloaded'
      })
      await panel.getByRole('button', { name: 'Settings', exact: true }).click()
      await panel.getByRole('button', { name: 'Data and health' }).click()
      await panel
        .locator('input[type="file"]')
        .setInputFiles(conflictProfilePath)
      await expect(
        panel.getByText('Reviewed replacement scope', { exact: true })
      ).toBeVisible()
      await panel.getByRole('button', { name: 'Review replacement' }).click()
      await panel.getByRole('button', { name: 'Replace local profile' }).click()
      await expect(
        panel.getByText('Complete pre-import snapshot', { exact: true })
      ).toBeVisible()

      const page = await context.newPage()
      await page.goto(fixtureUrls.home, { waitUntil: 'domcontentloaded' })
      const actions = page.locator(
        '#render-card-visible + [data-contentlens-actions]'
      )
      await expect(actions).toHaveAttribute(
        'data-contentlens-decision',
        'conflict'
      )
      await expect(actions.locator('[role=group]')).toHaveAttribute(
        'aria-busy',
        'false'
      )
      await expect(actions.locator('.decision-status')).toHaveText(
        'Conflicting local rules kept this item visible. Review the rules in ContentLens or hide it for this session.'
      )
      const announcer = page
        .locator('[data-contentlens-announcer]')
        .locator('[aria-live=polite]')
      await expect(announcer).toHaveCount(1)
      await expect(announcer).toHaveText(
        'Conflicting local rules kept this item visible. Review the rules in ContentLens or hide it for this session.'
      )
      await expect(actions.getByRole('button')).toHaveAccessibleName(
        'Hide for this session'
      )
      await expect(page.locator('#render-card-visible')).toBeVisible()

      if (process.env.CONTENTLENS_MANUAL_A11Y === 'conflict') {
        await page.pause()
      }
    } finally {
      await context.close()
    }
  })

  test('runs the production content flow in the packaged Firefox extension', async ({
    browserName
  }, testInfo) => {
    expect(browserName).toBe('firefox')
    const extensionPath = resolve('.output/adapter-e2e/firefox-mv2')
    const profilePath = testInfo.outputPath('firefox-profile')
    const firefoxRemote = await loadFirefoxRemote()
    const debuggerPort = await firefoxRemote.findFreeTcpPort()
    const context = await firefox.launchPersistentContext(profilePath, {
      args: ['-start-debugger-server', String(debuggerPort)],
      firefoxUserPrefs: {
        'devtools.debugger.prompt-connection': false,
        'devtools.debugger.remote-enabled': true,
        'xpinstall.signatures.required': false
      },
      headless: process.env.CONTENTLENS_MANUAL_A11Y !== 'placeholder'
    })
    const remote = await firefoxRemote.connectWithMaxRetries({
      maxRetries: 100,
      port: debuggerPort,
      retryInterval: 50
    })

    try {
      const installed = await remote.installTemporaryAddon(extensionPath, false)
      expect(installed.addon.id).toBe(firefoxExtensionId)
      const fixtures = await installFixtureRoutes(context)
      await assertProductionYoutubeFlow(
        context,
        await context.newPage(),
        'firefox',
        fixtures.search
      )
    } finally {
      remote.disconnect()
      await context.close()
    }
  })
})
