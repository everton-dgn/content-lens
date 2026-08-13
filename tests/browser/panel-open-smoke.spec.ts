import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { chromium, expect, firefox, test } from '@playwright/test'

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

const readManifest = async (outputDirectory: string): Promise<unknown> =>
  JSON.parse(
    await readFile(resolve(outputDirectory, 'manifest.json'), 'utf8')
  ) as unknown

test.describe('panel-open-smoke', () => {
  test('configures and renders the packaged Chrome side panel', async ({
    browserName
  }, testInfo) => {
    expect(browserName).toBe('chromium')

    const extensionPath = resolve('.output/chrome-mv3')
    const manifest = (await readManifest(extensionPath)) as {
      action?: { default_title?: string }
      content_scripts?: Array<{ matches?: string[] }>
      default_locale?: string
      host_permissions?: string[]
      manifest_version?: number
      minimum_chrome_version?: string
      optional_host_permissions?: string[]
      permissions?: string[]
      side_panel?: { default_path?: string }
    }

    expect(manifest).toMatchObject({
      action: { default_title: '__MSG_actionOpen__' },
      default_locale: 'en',
      manifest_version: 3,
      minimum_chrome_version: '149',
      permissions: ['alarms', 'sidePanel', 'scripting'],
      side_panel: { default_path: 'sidepanel.html' }
    })
    expect(manifest.host_permissions ?? []).toEqual([])
    expect(manifest.optional_host_permissions ?? []).toEqual([
      'https://*/*',
      'http://*/*'
    ])
    expect(manifest.content_scripts ?? []).toEqual([])

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
      let [serviceWorker] = context.serviceWorkers()
      serviceWorker ??= await context.waitForEvent('serviceworker')

      await expect
        .poll(
          async () =>
            serviceWorker.evaluate(async () => {
              const chromeApi = (
                globalThis as typeof globalThis & {
                  chrome?: {
                    sidePanel?: {
                      getPanelBehavior: () => Promise<{
                        openPanelOnActionClick?: boolean
                      }>
                    }
                  }
                }
              ).chrome

              if (!chromeApi?.sidePanel?.getPanelBehavior) {
                return null
              }

              try {
                return await chromeApi.sidePanel.getPanelBehavior()
              } catch {
                return null
              }
            }),
          { timeout: 15_000 }
        )
        .toMatchObject({
          openPanelOnActionClick: true
        })

      const extensionId = serviceWorker.url().split('/')[2]
      expect(extensionId).toBeTruthy()

      const pageErrors: Error[] = []
      const page = await context.newPage()
      page.on('pageerror', error => pageErrors.push(error))
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)

      await expect(page.locator('[data-slot="sidepanel-shell"]')).toBeVisible()
      await expect(
        page.getByRole('heading', { name: 'ContentLens' })
      ).toBeVisible()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Manage feeds' }).click()
      await expect(
        page.getByRole('heading', { name: 'RSS and Atom feeds' })
      ).toBeVisible()
      await expect(
        page.getByText('RSS feed downloads are disabled', { exact: true })
      ).toBeVisible()
      await expect(page.getByLabel('RSS or Atom URL')).toHaveCount(0)
      await expect(page.getByLabel('Check interval in minutes')).toHaveCount(0)
      expect(pageErrors).toEqual([])
    } finally {
      await context.close()
    }
  })

  test('installs the packaged Firefox extension with the expected sidebar manifest and no Chrome sidePanel permission', async ({
    browserName
  }) => {
    expect(browserName).toBe('firefox')

    const extensionPath = resolve('.output/firefox-mv2')
    const manifest = (await readManifest(extensionPath)) as {
      browser_action?: { default_title?: string }
      browser_specific_settings?: {
        gecko?: {
          data_collection_permissions?: {
            optional?: string[]
            required?: string[]
          }
          id?: string
          strict_min_version?: string
        }
      }
      content_scripts?: Array<{ matches?: string[] }>
      host_permissions?: string[]
      manifest_version?: number
      optional_host_permissions?: string[]
      optional_permissions?: string[]
      permissions?: string[]
      sidebar_action?: {
        default_panel?: string
        open_at_install?: boolean
      }
    }

    expect(manifest.manifest_version).toBe(2)
    expect(manifest.sidebar_action).toMatchObject({
      default_panel: 'sidepanel.html',
      open_at_install: false
    })
    expect(manifest.browser_action?.default_title).toBe('__MSG_actionOpen__')
    expect(manifest.permissions ?? []).toEqual(['alarms', 'scripting'])
    expect(manifest.host_permissions ?? []).toEqual([])
    expect(manifest.optional_permissions ?? []).toEqual([
      'https://*/*',
      'http://*/*'
    ])
    expect(manifest.optional_host_permissions ?? []).toEqual([])
    expect(
      manifest.browser_specific_settings?.gecko?.data_collection_permissions
    ).toEqual({
      required: ['none'],
      optional: ['authenticationInfo', 'websiteContent']
    })
    expect(manifest.browser_specific_settings?.gecko?.id).toBe(
      '{b83fdbe3-ec9c-453e-8a61-72d4cfc6dd4e}'
    )
    expect(manifest.browser_specific_settings?.gecko?.strict_min_version).toBe(
      '151.0'
    )
    expect(manifest.content_scripts ?? []).toEqual([])

    const firefoxRemote = await loadFirefoxRemote()
    const debuggerPort = await firefoxRemote.findFreeTcpPort()
    const context = await firefox.launchPersistentContext('', {
      args: ['-start-debugger-server', String(debuggerPort)],
      firefoxUserPrefs: {
        'devtools.debugger.prompt-connection': false,
        'devtools.debugger.remote-enabled': true,
        'xpinstall.signatures.required': false
      },
      headless: true
    })
    const remote = await firefoxRemote.connectWithMaxRetries({
      maxRetries: 100,
      port: debuggerPort,
      retryInterval: 50
    })

    try {
      const installed = await remote.installTemporaryAddon(extensionPath, false)
      expect(installed.addon.id).toBe('{b83fdbe3-ec9c-453e-8a61-72d4cfc6dd4e}')
    } finally {
      remote.disconnect()
      await context.close()
    }
  })
})
