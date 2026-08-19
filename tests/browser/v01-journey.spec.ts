import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { dirname, extname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import AxeBuilder from '@axe-core/playwright'
import {
  chromium,
  expect,
  firefox,
  type Locator,
  type Page,
  type TestInfo,
  test
} from '@playwright/test'

import {
  browserBuiltInModel,
  browserBuiltInProvider
} from '@/ai/browser/catalog'
import {
  createProviderFromTemplate,
  listProviderTemplates
} from '@/ai/providers/templates'
import type {
  SettingsRequestMessage,
  SettingsRuntimeSnapshot
} from '@/application/settings/runtime-contracts'
import { firefoxExtensionId } from '@/config/manifest'
import { createDefaultSettings } from '@/core/settings'
import { disconnectedSyncConnection } from '@/sync/connection'

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

type LocaleCatalog = Record<string, { message: string }>
type FirefoxHarnessInput = {
  catalog: LocaleCatalog
  settingsSnapshot: SettingsRuntimeSnapshot
}
const loopbackHost = ['127', '0', '0', '1'].join('.')
const loopbackOrigin = ['http:', '', loopbackHost].join('/')

const loadFirefoxRemote = async (): Promise<FirefoxRemoteModule> => {
  const projectRequire = createRequire(import.meta.url)
  const requireFromWxt = createRequire(projectRequire.resolve('wxt'))
  const webExtEntry = requireFromWxt.resolve('web-ext-run')
  const remoteModule = resolve(dirname(webExtEntry), 'lib/firefox/remote.js')

  return (await import(pathToFileURL(remoteModule).href)) as FirefoxRemoteModule
}

const servePackagedPanel = async (outputDirectory: string) => {
  const root = resolve(outputDirectory)
  const server = createServer(async (request, response) => {
    try {
      const requestedPath = decodeURIComponent(
        new URL(request.url ?? '/', loopbackOrigin).pathname
      )
      const filePath = resolve(
        root,
        requestedPath === '/' ? 'sidepanel.html' : requestedPath.slice(1)
      )
      if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
        response.writeHead(403).end()
        return
      }
      const contentType =
        extname(filePath) === '.css'
          ? 'text/css; charset=utf-8'
          : extname(filePath) === '.js'
            ? 'text/javascript; charset=utf-8'
            : 'text/html; charset=utf-8'
      const contents = await readFile(filePath)
      response.writeHead(200, { 'content-type': contentType })
      response.end(contents)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, loopbackHost, resolveListen)
  })
  const address = server.address() as AddressInfo

  return {
    baseUrl: `${loopbackOrigin}:${address.port}`,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close(error => {
          if (error) {
            rejectClose(error)
          } else {
            resolveClose()
          }
        })
      })
  }
}

const installFirefoxI18nHarness = async (
  page: Page,
  input: FirefoxHarnessInput
) => {
  await page.addInitScript(
    ({ catalog, settingsSnapshot }: FirefoxHarnessInput) => {
      const event = {
        addListener: () => undefined,
        removeListener: () => undefined
      }
      const i18n = {
        getMessage: (key: string) => catalog[key]?.message ?? '',
        getUILanguage: () => 'en-US'
      }
      Object.defineProperty(globalThis, 'browser', {
        configurable: true,
        value: {
          i18n,
          runtime: {
            connect: ({ name }: { name?: string } = {}) => ({
              name: name ?? '',
              onDisconnect: event,
              onMessage: event,
              postMessage: () => undefined
            }),
            id: 'contentlens-firefox-packaged-test',
            sendMessage: (message: SettingsRequestMessage) => {
              if (
                message.namespace === 'contentlens.runtime.v1' &&
                message.version === 1 &&
                message.type === 'settings.snapshot'
              ) {
                return Promise.resolve({
                  state: 'acknowledged',
                  requestId: message.requestId,
                  settings: {
                    kind: 'snapshot',
                    value: settingsSnapshot
                  }
                })
              }
              return Promise.resolve({
                state: 'rejected',
                requestId: message.requestId,
                code: 'unsupported-firefox-test-message'
              })
            }
          }
        }
      })
    },
    input
  )
}

const createFirefoxSettingsSnapshot = (): SettingsRuntimeSnapshot => ({
  state: 'ready',
  settings: {
    state: 'ready',
    revision: 0,
    settings: createDefaultSettings(),
    capabilitySnapshot: {} as never,
    source: 'default',
    issues: []
  },
  providers: {
    providers: [
      browserBuiltInProvider(),
      createProviderFromTemplate({
        templateId: 'openai',
        providerConfigId: 'provider:firefox-openai-fixture',
        displayName: 'OpenAI packaged fixture',
        at: '2026-07-31T00:00:00.000Z'
      })
    ],
    models: [browserBuiltInModel()],
    credentials: [],
    consents: []
  },
  templates: listProviderTemplates(),
  sync: disconnectedSyncConnection(),
  syncConflict: null,
  syncRecoveries: []
})

const assertNoSeriousAxeViolations = async (
  page: Page,
  testInfo: TestInfo,
  state: string
) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const violations = results.violations.filter(
    ({ impact }) => impact === 'serious' || impact === 'critical'
  )

  await testInfo.attach(`axe-${state}`, {
    body: Buffer.from(JSON.stringify(violations, null, 2)),
    contentType: 'application/json'
  })
  expect(violations, `serious or critical axe violations in ${state}`).toEqual(
    []
  )
}

const assertResponsiveZoom = async (page: Page, actionName: string) => {
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await expect(page.getByRole('button', { name: actionName })).toBeVisible()
  await expect(page.locator('[data-slot="status-rail"]')).toBeVisible()
  const overflow = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth
    const offenders = [...document.body.querySelectorAll('*')]
      .map(element => {
        const bounds = element.getBoundingClientRect()
        return {
          className: element.getAttribute('class') ?? '',
          right: Math.round(bounds.right),
          tag: element.tagName.toLowerCase(),
          text: element.textContent?.trim().slice(0, 80) ?? '',
          width: Math.round(bounds.width)
        }
      })
      .filter(
        ({ right, width }) =>
          right > viewportWidth + 1 || width > viewportWidth + 1
      )
      .slice(0, 10)
    return {
      offenders,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth
    }
  })
  expect(
    overflow.scrollWidth,
    `horizontal overflow at 200%: ${JSON.stringify(overflow.offenders)}`
  ).toBeLessThanOrEqual(overflow.viewportWidth)
  await page.evaluate(() => {
    document.documentElement.style.removeProperty('font-size')
  })
}

const captureSidepanel = async (
  page: Page,
  testInfo: TestInfo,
  filename: string
) => {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    document.scrollingElement?.scrollTo({ left: 0, top: 0 })
  })
  await expect
    .poll(() => page.evaluate(() => document.scrollingElement?.scrollTop ?? 0))
    .toBe(0)
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(filename)
  })
}

const assertOnePrimaryAction = async (page: Page) => {
  await expect(
    page.locator(
      '[data-slot="button"][data-variant="primary"]:visible, [data-slot="button"][data-variant="danger"]:visible'
    )
  ).toHaveCount(1)
}

const assertBadgeUsesBalancedChrome = async (badge: Locator) => {
  const chrome = await badge.evaluate(element => {
    const styles = getComputedStyle(element)
    return {
      borderLeftWidth: styles.borderLeftWidth,
      borderTopWidth: styles.borderTopWidth,
      borderRadius: Number.parseFloat(styles.borderStartStartRadius)
    }
  })

  expect(chrome.borderLeftWidth).toBe(chrome.borderTopWidth)
  expect(chrome.borderRadius).toBeGreaterThan(0)
}

const assertCompactStateSignal = async (page: Page) => {
  const geometry = await page
    .locator('.cl-state-panel__signal')
    .evaluate(signal => {
      const signalBounds = signal.getBoundingClientRect()
      const iconBounds = signal.querySelector('svg')?.getBoundingClientRect()
      const styles = getComputedStyle(signal)
      return {
        borderLeftWidth: styles.borderLeftWidth,
        borderTopWidth: styles.borderTopWidth,
        iconWidth: iconBounds?.width ?? 0,
        signalWidth: signalBounds.width
      }
    })

  expect(geometry.borderLeftWidth).toBe(geometry.borderTopWidth)
  expect(geometry.iconWidth).toBeLessThan(geometry.signalWidth)
}

const assertCapabilitiesStackWithoutOverlap = async (page: Page) => {
  const rows = await page
    .locator('.data-capability')
    .evaluateAll(capabilities =>
      capabilities.map(capability => {
        const badgeBounds = capability
          .querySelector('[data-slot="badge"]')
          ?.getBoundingClientRect()
        const copyBounds = capability
          .querySelector('div')
          ?.getBoundingClientRect()
        return Boolean(
          badgeBounds && copyBounds && badgeBounds.bottom <= copyBounds.top
        )
      })
    )

  expect(rows).toEqual([true, true, true])
}

const assertSyncHeadingStacksStatus = async (page: Page) => {
  const layout = await page
    .locator('[data-slot="sync-settings"] .settings-section-heading')
    .evaluate(heading => {
      const headingBounds = heading.getBoundingClientRect()
      const copyBounds = heading
        .querySelector(':scope > div')
        ?.getBoundingClientRect()
      const badgeBounds = heading
        .querySelector(':scope > [data-slot="badge"]')
        ?.getBoundingClientRect()
      return {
        badgeAboveCopy: Boolean(
          badgeBounds && copyBounds && badgeBounds.bottom <= copyBounds.top
        ),
        copyUsesFullWidth: Boolean(
          copyBounds && copyBounds.width >= headingBounds.width - 1
        )
      }
    })

  expect(layout).toEqual({
    badgeAboveCopy: true,
    copyUsesFullWidth: true
  })
}

const assertPageTitleHierarchy = async (
  title: Locator,
  sectionTitle: Locator
) => {
  const [pageTitleSize, sectionTitleSize] = await Promise.all([
    title.evaluate(element =>
      Number.parseFloat(getComputedStyle(element).fontSize)
    ),
    sectionTitle.evaluate(element =>
      Number.parseFloat(getComputedStyle(element).fontSize)
    )
  ])

  expect(pageTitleSize).toBeGreaterThanOrEqual(20)
  expect(pageTitleSize).toBeGreaterThan(sectionTitleSize)
}

const assertActivePrimaryNavigationIsQuiet = async (page: Page) => {
  const activeChrome = await page
    .locator('.cl-section-nav[data-variant="primary"] [aria-current="page"]')
    .evaluate(element => {
      const styles = getComputedStyle(element)
      return {
        backgroundColor: styles.backgroundColor,
        borderTopWidth: Number.parseFloat(styles.borderTopWidth)
      }
    })

  expect(activeChrome.borderTopWidth).toBe(0)
  expect(activeChrome.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
}

const statePanelGeometry = async (page: Page, width: number) => {
  await page.setViewportSize({ height: 900, width })
  return page.locator('[data-slot="state-panel"]').evaluate(element => {
    const styles = getComputedStyle(element)
    return {
      gap: Number.parseFloat(styles.rowGap),
      paddingInlineStart: Number.parseFloat(styles.paddingInlineStart)
    }
  })
}

const assertCanonicalStatePanelGeometry = async (page: Page) => {
  const narrow = await statePanelGeometry(page, 320)
  const compact = await statePanelGeometry(page, 360)
  const medium = await statePanelGeometry(page, 390)

  expect(narrow.paddingInlineStart).toBe(16)
  expect(compact.paddingInlineStart).toBe(16)
  expect(medium.paddingInlineStart).toBe(16)
  expect(narrow.gap).toBe(compact.gap)
  expect(compact.gap).toBe(medium.gap)
  await page.setViewportSize({ height: 900, width: 360 })
}

const assertBackActionGeometry = async (
  page: Page,
  headingSelector: string
) => {
  const geometry = await page
    .locator('[data-slot="back-action"]')
    .evaluate((action, selector) => {
      const actionBounds = action.getBoundingClientRect()
      const shellHeaderBounds = document
        .querySelector('.cl-shell__header')
        ?.getBoundingClientRect()
      const iconBounds = action.querySelector('svg')?.getBoundingClientRect()
      const headingBounds = action.parentElement
        ?.querySelector(selector)
        ?.getBoundingClientRect()
      return {
        blockSize: actionBounds.height,
        inlineOffset:
          iconBounds && headingBounds
            ? Math.abs(iconBounds.left - headingBounds.left)
            : Number.POSITIVE_INFINITY,
        topOffset: shellHeaderBounds
          ? actionBounds.top - shellHeaderBounds.bottom
          : Number.POSITIVE_INFINITY,
        trailingOffset: headingBounds
          ? headingBounds.top - actionBounds.bottom
          : Number.POSITIVE_INFINITY
      }
    }, headingSelector)

  expect(geometry.blockSize).toBeGreaterThanOrEqual(44)
  expect(geometry.inlineOffset).toBeLessThanOrEqual(1)
  expect(geometry.topOffset).toBe(12)
  expect(geometry.trailingOffset).toBe(20)
  expect(geometry.topOffset).toBeLessThan(geometry.trailingOffset)
}

const assertWideRailProximity = async (page: Page) => {
  await page.setViewportSize({ height: 900, width: 480 })
  const distance = await page.evaluate(() => {
    const marker = document
      .querySelector('.cl-status-rail__marker')
      ?.getBoundingClientRect()
    const label = document
      .querySelector('.cl-status-rail__label')
      ?.getBoundingClientRect()
    return marker && label ? Math.round(label.top - marker.bottom) : null
  })
  expect(distance).not.toBeNull()
  expect(distance ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(80)
  await page.setViewportSize({ height: 900, width: 360 })
}

const runV01Journey = async (
  page: Page,
  testInfo: TestInfo,
  pageErrors: Error[]
) => {
  await expect(page.locator('[data-slot="sidepanel-shell"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'ContentLens' })).toBeVisible()
  await expect(
    page.getByText('Local engine ready', { exact: true })
  ).toBeVisible()
  await assertOnePrimaryAction(page)
  await assertNoSeriousAxeViolations(page, testInfo, 'empty')
  await captureSidepanel(page, testInfo, 'v01-empty.png')
  await assertResponsiveZoom(page, 'Create or review rules')
  await assertWideRailProximity(page)

  await page.getByRole('button', { name: 'Home', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Your local overview' })
  ).toBeVisible()
  await assertNoSeriousAxeViolations(page, testInfo, 'home')
  await captureSidepanel(page, testInfo, 'v02-home.png')
  await page.evaluate(() => {
    document.documentElement.classList.remove('light')
    document.documentElement.classList.add('dark')
    document.documentElement.dataset.theme = 'dark'
  })
  await assertNoSeriousAxeViolations(page, testInfo, 'home-dark')
  await captureSidepanel(page, testInfo, 'v02-home-dark.png')
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
    document.documentElement.dataset.theme = 'light'
  })
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Nothing needs review' })
  ).toBeVisible()
  await assertNoSeriousAxeViolations(page, testInfo, 'review-empty')
  await captureSidepanel(page, testInfo, 'v02-review-empty.png')
  await page.getByRole('button', { name: 'Rules', exact: true }).click()
  await assertCompactStateSignal(page)
  await assertCanonicalStatePanelGeometry(page)
  await assertPageTitleHierarchy(
    page.locator('.cl-state-panel__title'),
    page.locator('.panel-privacy h3')
  )
  await assertActivePrimaryNavigationIsQuiet(page)
  await expect(
    page.locator('[data-slot="state-panel"] > [data-slot="surface"]')
  ).toHaveAttribute('data-elevation', 'flat')
  const rulesDataAction = page.getByRole('button', {
    name: 'Data and health',
    exact: true
  })
  await expect(rulesDataAction).toHaveAttribute('data-variant', 'secondary')
  await expect(rulesDataAction.locator('svg')).toHaveCount(1)
  await captureSidepanel(page, testInfo, 'v03-rules-empty.png')
  await page.evaluate(() => {
    document.documentElement.classList.remove('light')
    document.documentElement.classList.add('dark')
    document.documentElement.dataset.theme = 'dark'
  })
  await captureSidepanel(page, testInfo, 'v03-rules-empty-dark.png')
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
    document.documentElement.dataset.theme = 'light'
  })

  await page.getByRole('button', { name: 'Create your first rule' }).click()
  await page.getByLabel('Phrase in the title').fill('transfer gossip')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Preview rule' })).toBeFocused()
  await assertNoSeriousAxeViolations(page, testInfo, 'editor')
  await captureSidepanel(page, testInfo, 'v02-rule-editor.png')
  await page.getByRole('button', { name: 'Preview rule' }).click()

  await expect(
    page.getByRole('heading', { name: 'Inspect the effect before saving' })
  ).toBeVisible()
  await expect(
    page.getByText('Matching example', { exact: true })
  ).toBeVisible()
  await expect(
    page.getByText('Protected exception', { exact: true })
  ).toBeVisible()
  await assertOnePrimaryAction(page)
  await assertNoSeriousAxeViolations(page, testInfo, 'preview')
  await captureSidepanel(page, testInfo, 'v01-preview.png')
  await assertResponsiveZoom(page, 'Save rule')
  await page.getByRole('button', { name: 'Save rule' }).click()

  await expect(page.getByText('Rule saved', { exact: true })).toBeVisible()
  await expect(page.getByText('transfer gossip', { exact: true })).toBeVisible()
  await assertNoSeriousAxeViolations(page, testInfo, 'saved')
  await page.getByRole('button', { name: 'Undo saved rule' }).click()
  await expect(page.getByText('Rule undone', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Create your first rule' })
  ).toBeVisible()

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const sidepanelSettingsNavigation = page.getByRole('navigation', {
    name: 'Settings'
  })
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true })
  ).toBeVisible()
  await assertPageTitleHierarchy(
    page.locator('.settings-heading h2'),
    page.locator('.settings-form h3').first()
  )
  await expect(sidepanelSettingsNavigation.getByRole('button')).toHaveCount(6)
  await expect(sidepanelSettingsNavigation).toHaveAttribute(
    'data-variant',
    'compact'
  )
  await assertNoSeriousAxeViolations(
    page,
    testInfo,
    'sidepanel-settings-general'
  )
  await captureSidepanel(page, testInfo, 'v03-sidepanel-settings-general.png')

  await page.setViewportSize({ height: 900, width: 320 })
  const settingsOverflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }))
  expect(settingsOverflow.scrollWidth).toBeLessThanOrEqual(
    settingsOverflow.clientWidth
  )
  await page.setViewportSize({ height: 900, width: 360 })
  const sidepanelContent = page.locator('.cl-shell__content')

  await sidepanelSettingsNavigation
    .getByRole('button', { name: 'AI and providers' })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Providers and credentials' })
  ).toBeVisible()
  await captureSidepanel(page, testInfo, 'v03-sidepanel-settings-providers.png')
  await page
    .getByRole('navigation', { name: 'AI and provider settings' })
    .getByRole('button', { name: 'Models' })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Model catalog' })
  ).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.scrollingElement?.scrollTop ?? 0))
    .toBe(0)
  await expect
    .poll(() => sidepanelContent.evaluate(element => element.scrollTop))
    .toBe(0)
  await captureSidepanel(page, testInfo, 'v03-sidepanel-settings-models.png')

  await sidepanelContent.evaluate(element => {
    element.scrollTo({ top: element.scrollHeight })
  })
  await sidepanelSettingsNavigation
    .getByRole('button', { name: 'Platforms' })
    .evaluate(button => (button as HTMLElement).click())
  await expect(
    sidepanelSettingsNavigation.getByRole('button', { name: 'Platforms' })
  ).toHaveAttribute('aria-current', 'page')
  await expect
    .poll(() => sidepanelContent.evaluate(element => element.scrollTop))
    .toBe(0)
  await captureSidepanel(page, testInfo, 'v03-sidepanel-settings-platforms.png')

  await sidepanelSettingsNavigation
    .getByRole('button', { name: 'Privacy and data' })
    .click()
  await page.setViewportSize({ height: 900, width: 390 })
  await assertBadgeUsesBalancedChrome(
    page.getByText('Disconnected', { exact: true })
  )
  await assertSyncHeadingStacksStatus(page)
  await captureSidepanel(page, testInfo, 'v03-sidepanel-settings-privacy.png')
  await page.setViewportSize({ height: 900, width: 360 })
  await sidepanelSettingsNavigation
    .getByRole('button', { name: 'Diagnostics' })
    .click()
  await captureSidepanel(
    page,
    testInfo,
    'v03-sidepanel-settings-diagnostics.png'
  )
  await sidepanelSettingsNavigation
    .getByRole('button', { name: 'Interface' })
    .click()
  await captureSidepanel(page, testInfo, 'v03-sidepanel-settings-interface.png')
  await sidepanelSettingsNavigation
    .getByRole('button', { name: 'General' })
    .click()
  await page.getByRole('button', { name: 'Manage feeds' }).click()
  await expect(
    page.getByRole('heading', { name: 'RSS and Atom feeds' })
  ).toBeVisible()
  await expect(
    page.getByText('RSS feed downloads are disabled', { exact: true })
  ).toBeVisible()
  await expect(page.getByLabel('RSS or Atom URL')).toHaveCount(0)
  await expect(page.getByLabel('Check interval in minutes')).toHaveCount(0)
  await assertNoSeriousAxeViolations(page, testInfo, 'rss-feeds')
  await captureSidepanel(page, testInfo, 'v01-rss-feeds.png')
  await page.evaluate(() => {
    document.documentElement.classList.remove('light')
    document.documentElement.classList.add('dark')
    document.documentElement.dataset.theme = 'dark'
  })
  await captureSidepanel(page, testInfo, 'v03-rss-feeds-dark.png')
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
    document.documentElement.dataset.theme = 'light'
  })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.setViewportSize({ height: 900, width: 390 })
  await page.getByRole('button', { name: 'Data and health' }).click()
  await expect(
    page.getByRole('heading', { name: 'Data and health' })
  ).toBeVisible()
  const dataBackAction = page.getByRole('button', {
    name: 'Back to settings'
  })
  await expect(dataBackAction.locator('svg')).toHaveCount(1)
  await expect(dataBackAction).toHaveAttribute('data-variant', 'quiet')
  await expect(dataBackAction).toHaveAttribute('data-slot', 'back-action')
  await assertBackActionGeometry(page, '.rule-workbench__heading')
  await assertPageTitleHierarchy(
    page.locator('.data-panel__header h2'),
    page.locator('.data-panel h3').first()
  )
  await expect(
    page.getByText('Deterministic rules', { exact: true })
  ).toBeVisible()
  await expect(page.getByText('Optional', { exact: true })).toBeVisible()
  await assertCapabilitiesStackWithoutOverlap(page)
  for (const badge of await page.locator('.data-capability .cl-badge').all()) {
    await assertBadgeUsesBalancedChrome(badge)
  }
  await expect(
    page.getByText('Choose JSON file', { exact: true })
  ).toBeVisible()
  await expect(
    page.getByText('No file selected', { exact: true })
  ).toBeVisible()
  await assertNoSeriousAxeViolations(page, testInfo, 'data-health')
  await captureSidepanel(page, testInfo, 'v02-data-health.png')
  await page.evaluate(() => {
    document.documentElement.classList.remove('light')
    document.documentElement.classList.add('dark')
    document.documentElement.dataset.theme = 'dark'
  })
  await captureSidepanel(page, testInfo, 'v03-data-health-dark.png')
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
    document.documentElement.dataset.theme = 'light'
  })
  await page.setViewportSize({ height: 900, width: 360 })
  await page.getByRole('button', { name: 'Review sanitized export' }).click()
  await expect(
    page.getByRole('button', { name: 'Confirm sanitized export' })
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await assertOnePrimaryAction(page)
  await assertNoSeriousAxeViolations(page, testInfo, 'data-export-review')
  await captureSidepanel(page, testInfo, 'v01-data-export-review.png')
  await assertResponsiveZoom(page, 'Confirm sanitized export')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(
    page.getByRole('button', { name: 'Review sanitized export' })
  ).toBeFocused()
  await page.getByRole('button', { name: 'Clear diagnostics' }).click()
  await expect(
    page.getByText('Clear local diagnostics?', { exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Confirm clear' })
  ).not.toBeFocused()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await assertOnePrimaryAction(page)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(
    page.getByRole('button', { name: 'Clear diagnostics' })
  ).toBeFocused()
  await page.getByRole('button', { name: 'Review local data reset' }).click()
  await expect(
    page.getByRole('button', {
      name: 'Delete all local ContentLens data'
    })
  ).not.toBeFocused()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await assertOnePrimaryAction(page)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(
    page.getByRole('button', { name: 'Review local data reset' })
  ).toBeFocused()

  expect(pageErrors).toEqual([])
}
test.describe('v0.1 packaged sidepanel journey', () => {
  test('runs the v0.1 journey in packaged Chrome', async ({
    browserName
  }, testInfo) => {
    test.setTimeout(120_000)
    expect(browserName).toBe('chromium')
    const extensionPath = resolve('.output/chrome-mv3')
    const context = await chromium.launchPersistentContext(
      testInfo.outputPath('chromium-profile'),
      {
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`
        ],
        channel: 'chromium',
        headless: true,
        reducedMotion: 'reduce',
        viewport: { height: 900, width: 360 }
      }
    )

    try {
      let [serviceWorker] = context.serviceWorkers()
      serviceWorker ??= await context.waitForEvent('serviceworker')
      const extensionId = serviceWorker.url().split('/')[2]
      const page = await context.newPage()
      const pageErrors: Error[] = []
      page.on('pageerror', error => pageErrors.push(error))
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
        waitUntil: 'domcontentloaded'
      })
      await runV01Journey(page, testInfo, pageErrors)
    } finally {
      await context.close()
    }
  })

  test('installs packaged Firefox and runs its exact panel bundle', async ({
    browserName
  }, testInfo) => {
    test.setTimeout(120_000)
    expect(browserName).toBe('firefox')
    const extensionPath = resolve('.output/firefox-mv2')
    const manifest = JSON.parse(
      await readFile(resolve(extensionPath, 'manifest.json'), 'utf8')
    ) as { browser_specific_settings?: { gecko?: { id?: string } } }
    expect(manifest.browser_specific_settings?.gecko?.id).toBe(
      firefoxExtensionId
    )

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
        headless: true,
        reducedMotion: 'reduce',
        viewport: { height: 900, width: 360 }
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
      const server = await servePackagedPanel(extensionPath)
      const page = await context.newPage()
      const pageErrors: Error[] = []
      page.on('pageerror', error => pageErrors.push(error))
      const catalog = JSON.parse(
        await readFile(
          resolve(extensionPath, '_locales/en/messages.json'),
          'utf8'
        )
      ) as LocaleCatalog
      await installFirefoxI18nHarness(page, {
        catalog,
        settingsSnapshot: createFirefoxSettingsSnapshot()
      })
      try {
        await page.goto(`${server.baseUrl}/sidepanel.html`, {
          waitUntil: 'domcontentloaded'
        })
        await runV01Journey(page, testInfo, pageErrors)
      } finally {
        await server.close()
      }
    } finally {
      remote.disconnect()
      await context.close()
    }
  })
})
