import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, resolve, sep } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

const loopbackHost = ['127', '0', '0', '1'].join('.')
const loopbackOrigin = ['http:', '', loopbackHost].join('/')
const repositoryRoot = resolve(import.meta.dirname, '..', '..')

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml']
])

const serveRepository = async () => {
  const server = createServer(async (request, response) => {
    try {
      const requestedPath = decodeURIComponent(
        new URL(request.url ?? '/', loopbackOrigin).pathname
      )
      const extensionAsset = [
        '/_locales/',
        '/assets/',
        '/chunks/',
        '/icon/'
      ].some(prefix => requestedPath.startsWith(prefix))
      const filePath = resolve(
        repositoryRoot,
        extensionAsset
          ? `.output/chrome-mv3${requestedPath}`
          : requestedPath.slice(1)
      )
      if (!filePath.startsWith(`${repositoryRoot}${sep}`)) {
        response.writeHead(403).end()
        return
      }
      const contents = await readFile(filePath)
      response.writeHead(200, {
        'content-type':
          contentTypes.get(extname(filePath)) ?? 'text/html; charset=utf-8'
      })
      response.end(contents)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise<void>((listening, failed) => {
    server.once('error', failed)
    server.listen(0, loopbackHost, listening)
  })
  const address = server.address() as AddressInfo

  return {
    baseUrl: `${loopbackOrigin}:${address.port}`,
    close: () =>
      new Promise<void>((closed, failed) => {
        server.close(error => (error ? failed(error) : closed()))
      })
  }
}

const openPanel = async (
  page: Page,
  baseUrl: string,
  theme: 'light' | 'dark'
) => {
  await page.emulateMedia({
    colorScheme: theme,
    reducedMotion: 'reduce'
  })
  await page.goto(`${baseUrl}/tests/browser/fixtures/sidepanel-preview.html`, {
    waitUntil: 'networkidle'
  })
  await page.waitForSelector('[data-slot="shell"], .cl-shell', {
    timeout: 15_000
  })
  // The status rail animates its marker; reduced motion leaves a static cue.
  await page.waitForTimeout(250)
}

const viewports = [
  { name: 'narrow', width: 320, height: 900 },
  { name: 'compact', width: 360, height: 900 },
  { name: 'medium', width: 390, height: 900 },
  { name: 'wide', width: 480, height: 900 }
] as const

const themes = ['light', 'dark'] as const

test.describe('sidepanel visual contract', () => {
  for (const viewport of viewports) {
    for (const theme of themes) {
      test(`renders the panel at ${viewport.name} in ${theme}`, async ({
        page
      }) => {
        const server = await serveRepository()
        try {
          await page.setViewportSize({
            width: viewport.width,
            height: viewport.height
          })
          await openPanel(page, server.baseUrl, theme)

          await expect(page).toHaveScreenshot(
            `panel-${viewport.name}-${theme}.png`,
            {
              fullPage: true,
              maxDiffPixelRatio: 0.01,
              animations: 'disabled'
            }
          )

          await page.locator('button[data-value="settings"]').click()
          await expect(
            page.locator('nav[data-variant="compact"]')
          ).toBeVisible()
          await expect(page).toHaveScreenshot(
            `settings-${viewport.name}-${theme}.png`,
            {
              fullPage: true,
              maxDiffPixelRatio: 0.01,
              animations: 'disabled'
            }
          )
        } finally {
          await server.close()
        }
      })
    }
  }

  test('centers the topbar identity on its light surface', async ({ page }) => {
    const server = await serveRepository()
    try {
      await page.setViewportSize({ width: 360, height: 900 })
      await openPanel(page, server.baseUrl, 'light')

      const geometry = await page.evaluate(() => {
        const header = document.querySelector('.cl-shell__header')
        const brand = document.querySelector('.cl-brand')
        const mark = document.querySelector('.cl-brand__mark')
        const name = document.querySelector('.cl-brand__name')
        const status = document.querySelector('.cl-status-rail')
        if (!header || !brand || !mark || !name || !status) {
          return null
        }

        const center = (element: Element) => {
          const bounds = element.getBoundingClientRect()
          return bounds.top + bounds.height / 2
        }

        return {
          background: getComputedStyle(header).backgroundColor,
          brandStatusDelta: Math.abs(center(brand) - center(status)),
          markNameDelta: Math.abs(center(mark) - center(name))
        }
      })

      expect(geometry).not.toBeNull()
      expect(geometry?.background).toBe('rgb(255, 255, 255)')
      expect(geometry?.brandStatusDelta).toBeLessThanOrEqual(1)
      expect(geometry?.markNameDelta).toBeLessThanOrEqual(1)
    } finally {
      await server.close()
    }
  })

  test('keeps light cards white with a readable summary hierarchy', async ({
    page
  }) => {
    const server = await serveRepository()
    try {
      await page.setViewportSize({ width: 360, height: 900 })
      await openPanel(page, server.baseUrl, 'light')

      const homePalette = await page.evaluate(() => ({
        surfaceBackgrounds: Array.from(
          document.querySelectorAll('.cl-surface'),
          element => getComputedStyle(element).backgroundColor
        ),
        text: getComputedStyle(document.body).color
      }))
      expect(new Set(homePalette.surfaceBackgrounds)).toEqual(
        new Set(['rgb(255, 255, 255)'])
      )
      expect(homePalette.text).toBe('rgb(49, 65, 88)')

      await page.locator('button[data-value="settings"]').click()
      const navigationPalette = await page
        .locator('nav[data-variant="compact"]')
        .evaluate(navigation => ({
          active: getComputedStyle(
            navigation.querySelector('[aria-current="page"]') as Element
          ).backgroundColor,
          inactive: Array.from(
            navigation.querySelectorAll('button:not([aria-current="page"])'),
            element => getComputedStyle(element).backgroundColor
          )
        }))
      const summaryHierarchy = await page
        .locator('.settings-summary')
        .evaluate(summary => {
          const heading = summary.querySelector('h3')
          const description = summary.querySelector('p')
          const list = summary.querySelector('[data-layout="summary"]')
          const label = summary.querySelector('dt')
          const value = summary.querySelector('dd')
          const listWidth = list?.getBoundingClientRect().width ?? 0
          const rowWidths = list
            ? Array.from(
                list.children,
                row => row.getBoundingClientRect().width
              )
            : []

          return {
            descriptionSize: description
              ? Number.parseFloat(getComputedStyle(description).fontSize)
              : 0,
            headingSize: heading
              ? Number.parseFloat(getComputedStyle(heading).fontSize)
              : 0,
            labelColor: label ? getComputedStyle(label).color : '',
            labelSize: label
              ? Number.parseFloat(getComputedStyle(label).fontSize)
              : 0,
            labelWeight: label ? getComputedStyle(label).fontWeight : '',
            rowsUseFullWidth: rowWidths.every(
              width => Math.abs(width - listWidth) <= 1
            ),
            surfaceBackgrounds: Array.from(
              document.querySelectorAll('.cl-surface'),
              element => getComputedStyle(element).backgroundColor
            ),
            valueColor: value ? getComputedStyle(value).color : '',
            valueSize: value
              ? Number.parseFloat(getComputedStyle(value).fontSize)
              : 0,
            valueWeight: value ? getComputedStyle(value).fontWeight : ''
          }
        })

      expect(summaryHierarchy.headingSize).toBeGreaterThan(
        summaryHierarchy.descriptionSize
      )
      expect(summaryHierarchy.labelColor).toBe('rgb(95, 110, 128)')
      expect(summaryHierarchy.labelSize).toBe(12)
      expect(summaryHierarchy.labelWeight).toBe('650')
      expect(summaryHierarchy.rowsUseFullWidth).toBe(true)
      expect(summaryHierarchy.valueColor).toBe('rgb(49, 65, 88)')
      expect(summaryHierarchy.valueSize).toBe(14)
      expect(summaryHierarchy.valueWeight).toBe('400')
      expect(new Set(navigationPalette.inactive)).toEqual(
        new Set(['rgb(255, 255, 255)'])
      )
      expect(navigationPalette.active).not.toBe('rgb(255, 255, 255)')
      expect(new Set(summaryHierarchy.surfaceBackgrounds)).toEqual(
        new Set(['rgb(255, 255, 255)'])
      )
    } finally {
      await server.close()
    }
  })

  test('keeps every visible text role at or above 12 pixels', async ({
    page
  }) => {
    const server = await serveRepository()
    try {
      await page.setViewportSize({ width: 360, height: 900 })
      await openPanel(page, server.baseUrl, 'light')

      const violations: Array<{
        route: string
        element: string
        fontSize: number
        text: string
      }> = []
      const inspectRoute = async (route: string) => {
        const current = await page.evaluate(() =>
          Array.from(document.body.querySelectorAll('*')).flatMap(element => {
            const style = getComputedStyle(element)
            const hasOwnText = Array.from(element.childNodes).some(
              node =>
                node.nodeType === Node.TEXT_NODE &&
                (node.textContent?.trim().length ?? 0) > 0
            )
            if (
              !hasOwnText ||
              style.display === 'none' ||
              style.visibility === 'hidden' ||
              Number.parseFloat(style.opacity) === 0 ||
              element.getClientRects().length === 0
            ) {
              return []
            }
            const fontSize = Number.parseFloat(style.fontSize)
            return fontSize < 12
              ? [
                  {
                    element: element.tagName.toLowerCase(),
                    fontSize,
                    text: element.textContent?.trim().slice(0, 80) ?? ''
                  }
                ]
              : []
          })
        )
        violations.push(...current.map(violation => ({ ...violation, route })))
      }

      for (const route of ['home', 'rules', 'review', 'settings']) {
        const destination = page.locator(`button[data-value="${route}"]`)
        await destination.click()
        await expect(destination).toHaveAttribute('aria-current', 'page')
        await inspectRoute(route)
      }

      for (const route of [
        'general',
        'ai',
        'platforms',
        'privacy-data',
        'diagnostics',
        'interface'
      ]) {
        const destination = page.locator(
          `nav[data-variant="compact"] button[data-value="${route}"]`
        )
        await destination.click()
        await expect(destination).toHaveAttribute('aria-current', 'page')
        await inspectRoute(`settings/${route}`)
      }

      expect(violations).toEqual([])
    } finally {
      await server.close()
    }
  })

  test('keeps the panel free of horizontal overflow at 320 pixels', async ({
    page
  }) => {
    const server = await serveRepository()
    try {
      await page.setViewportSize({ width: 320, height: 900 })
      await openPanel(page, server.baseUrl, 'light')

      const geometry = await page.evaluate(() => {
        const brandName = document.querySelector('.cl-brand__name')
        const statLabels = Array.from(
          document.querySelectorAll('.home-stat-grid span')
        )
        return {
          brandIsClipped: brandName
            ? brandName.scrollWidth > brandName.clientWidth
            : true,
          overflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
          statWrapping: statLabels.map(
            label => getComputedStyle(label).overflowWrap
          )
        }
      })
      expect(geometry.overflow, 'the panel must not scroll horizontally').toBe(
        false
      )
      expect(
        geometry.brandIsClipped,
        'the product name must remain visible'
      ).toBe(false)
      expect(new Set(geometry.statWrapping)).toEqual(new Set(['normal']))
    } finally {
      await server.close()
    }
  })

  test('keeps compact navigation hover and switch geometry visible', async ({
    page
  }) => {
    const server = await serveRepository()
    try {
      await page.setViewportSize({ width: 320, height: 640 })
      await openPanel(page, server.baseUrl, 'light')
      await page.locator('button[data-value="settings"]').click()

      const inactiveNavigation = page
        .locator(
          'nav[data-variant="compact"] button:not([aria-current="page"])'
        )
        .first()
      const backgroundBefore = await inactiveNavigation.evaluate(
        element => getComputedStyle(element).backgroundColor
      )
      await inactiveNavigation.hover()
      const backgroundAfter = await inactiveNavigation.evaluate(
        element => getComputedStyle(element).backgroundColor
      )
      expect(backgroundAfter).not.toBe(backgroundBefore)

      await page.locator('button[data-value="interface"]').click()
      const switchControl = page.locator('[role="switch"]')
      await switchControl.click()
      const geometry = await switchControl.evaluate(element => {
        const control = element.getBoundingClientRect()
        const thumb = element
          .querySelector('.cl-switch-field__thumb')
          ?.getBoundingClientRect()
        return thumb
          ? {
              controlLeft: control.left,
              controlRight: control.right,
              thumbLeft: thumb.left,
              thumbRight: thumb.right
            }
          : null
      })
      expect(geometry).not.toBeNull()
      expect(geometry?.thumbLeft).toBeGreaterThanOrEqual(
        geometry?.controlLeft ?? Number.POSITIVE_INFINITY
      )
      expect(geometry?.thumbRight).toBeLessThanOrEqual(
        geometry?.controlRight ?? Number.NEGATIVE_INFINITY
      )
    } finally {
      await server.close()
    }
  })

  test('reaches the full settings content through the internal scroll area', async ({
    page
  }) => {
    const server = await serveRepository()
    try {
      await page.setViewportSize({ width: 320, height: 640 })
      await openPanel(page, server.baseUrl, 'light')
      await page.locator('button[data-value="settings"]').click()
      await page.locator('button[data-value="privacy-data"]').click()

      const content = page.locator('.cl-shell__content')
      const before = await content.evaluate(element => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop
      }))
      expect(before.scrollHeight).toBeGreaterThan(before.clientHeight)
      expect(before.scrollTop).toBe(0)

      await content.evaluate(element => {
        element.scrollTop = element.scrollHeight
      })
      await expect
        .poll(() => content.evaluate(element => element.scrollTop))
        .toBeGreaterThan(0)
      const after = await content.evaluate(element => ({
        bottom: element.scrollTop + element.clientHeight,
        scrollHeight: element.scrollHeight
      }))
      expect(after.bottom).toBeGreaterThanOrEqual(after.scrollHeight - 1)
      expect(await page.evaluate(() => window.scrollY)).toBe(0)
    } finally {
      await server.close()
    }
  })

  test('keeps a shell without navigation internally scrollable', async ({
    page
  }) => {
    const server = await serveRepository()
    try {
      await page.setViewportSize({ width: 320, height: 320 })
      await openPanel(page, server.baseUrl, 'light')
      const content = page.locator('.cl-shell__content')
      await page.locator('.cl-shell').evaluate(shell => {
        shell.classList.remove('cl-shell--with-navigation')
        shell.querySelector('.cl-shell__navigation')?.remove()
        const panel = shell.querySelector('.cl-shell__content')
        if (panel) {
          panel.replaceChildren(
            ...Array.from({ length: 40 }, (_, index) => {
              const row = document.createElement('p')
              row.textContent = `Loading detail ${index + 1}`
              return row
            })
          )
        }
      })

      const before = await content.evaluate(element => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight
      }))
      expect(before.scrollHeight).toBeGreaterThan(before.clientHeight)
      await content.evaluate(element => {
        element.scrollTop = element.scrollHeight
      })
      await expect
        .poll(() => content.evaluate(element => element.scrollTop))
        .toBeGreaterThan(0)
      expect(await page.evaluate(() => window.scrollY)).toBe(0)
    } finally {
      await server.close()
    }
  })
})
