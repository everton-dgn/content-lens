import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { chromium, expect, test } from '@playwright/test'

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
})
