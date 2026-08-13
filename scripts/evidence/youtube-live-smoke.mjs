import { spawnSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { chromium } from '@playwright/test'

const extensionPath = resolve('.output/chrome-mv3')
const trashPreflight = spawnSync('trash', ['--help'], {
  encoding: 'utf8',
  stdio: 'pipe'
})
if (trashPreflight.error) {
  throw new Error(
    'The trash command is required before creating a temporary browser profile',
    { cause: trashPreflight.error }
  )
}
const profilePath = await mkdtemp(join(tmpdir(), 'contentlens-live-smoke-'))
const surfaces = [
  {
    name: 'home',
    path: '/',
    selector: 'ytd-rich-item-renderer'
  },
  {
    name: 'search',
    path: '/results',
    query: ['search_query', 'software testing'],
    selector: 'ytd-video-renderer'
  },
  {
    name: 'recommendations',
    path: '/watch',
    query: ['v', 'dQw4w9WgXcQ'],
    selector: 'ytd-compact-video-renderer, yt-lockup-view-model'
  }
]

let context
let evidence
let executionError

try {
  context = await chromium.launchPersistentContext(profilePath, {
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ],
    channel: 'chromium',
    headless: true
  })
  const page = await context.newPage()
  const results = []

  for (const surface of surfaces) {
    const url = new URL(surface.path, 'https://www.youtube.com')
    if (surface.query) {
      url.searchParams.set(surface.query[0], surface.query[1])
    }
    await page.goto(url.href, {
      timeout: 45_000,
      waitUntil: 'domcontentloaded'
    })
    await page
      .waitForFunction(
        () =>
          document.documentElement.dataset.contentlensRuntimeReady ===
            'chrome' ||
          document.querySelector('[data-contentlens-actions]') !== null,
        undefined,
        { timeout: 15_000 }
      )
      .catch(() => undefined)
    await page.waitForTimeout(3_000)

    const aggregate = await page.evaluate(selector => {
      const candidates = [...document.querySelectorAll(selector)]
      const stableVideoIdentities = candidates.filter(candidate => {
        const href = candidate
          .querySelector('a[href*="/watch"]')
          ?.getAttribute('href')
        if (!href) {
          return false
        }
        try {
          return /^[A-Za-z0-9_-]{6,64}$/u.test(
            new URL(href, 'https://www.youtube.com').searchParams.get('v') ?? ''
          )
        } catch {
          return false
        }
      }).length
      const interactive = [...document.querySelectorAll('a, button')].filter(
        element =>
          element instanceof HTMLElement &&
          !element.hasAttribute('disabled') &&
          element.getClientRects().length > 0
      ).length
      const observedCandidateTags = Object.entries(
        [...document.querySelectorAll('*')].reduce((counts, element) => {
          const tag = element.localName
          if (
            (tag.startsWith('ytd-') || tag.startsWith('yt-')) &&
            (tag.endsWith('-renderer') || tag.endsWith('-view-model'))
          ) {
            counts[tag] = (counts[tag] ?? 0) + 1
          }
          return counts
        }, {})
      )
        .sort((left, right) => right[1] - left[1])
        .slice(0, 12)
        .map(([tag, count]) => ({ tag, count }))
      const lockups = [...document.querySelectorAll('yt-lockup-view-model')]
      const lockupSelectorSupport = {
        candidates: lockups.length,
        videoLinks: lockups.filter(candidate =>
          candidate.querySelector('a[href*="/watch"]')
        ).length,
        channelIdLinks: lockups.filter(candidate =>
          candidate.querySelector('a[href^="/channel/"]')
        ).length,
        handleLinks: lockups.filter(candidate =>
          candidate.querySelector('a[href^="/@"]')
        ).length,
        titleClass: lockups.filter(candidate =>
          candidate.querySelector('.yt-lockup-metadata-view-model__title')
        ).length,
        heading: lockups.filter(candidate => candidate.querySelector('h3'))
          .length
      }

      return {
        runtimeReady:
          document.documentElement.dataset.contentlensRuntimeReady ===
            'chrome' ||
          document.querySelector('[data-contentlens-actions]') !== null,
        candidates: candidates.length,
        controls: document.querySelectorAll('[data-contentlens-actions]')
          .length,
        placeholders: document.querySelectorAll(
          '[data-contentlens-placeholder]'
        ).length,
        stableVideoIdentities,
        visibleInteractiveElements: interactive,
        observedCandidateTags,
        lockupSelectorSupport
      }
    }, surface.selector)

    results.push({
      surface: surface.name,
      ...aggregate
    })
  }

  const passed = results.every(
    result =>
      result.runtimeReady &&
      result.candidates > 0 &&
      result.controls > 0 &&
      result.stableVideoIdentities > 0 &&
      result.visibleInteractiveElements > 0 &&
      result.placeholders === 0
  )
  evidence = {
    schemaVersion: 1,
    testedAt: new Date().toISOString(),
    browser: {
      name: 'Chromium',
      version: context.browser()?.version() ?? 'unknown',
      manifest: 'MV3'
    },
    authentication: 'none',
    nativeFeedbackSubmitted: false,
    storesRawContent: false,
    status: passed ? 'passed' : 'limited',
    surfaces: results
  }
} catch (error) {
  executionError = error
}

const cleanupErrors = []
try {
  await context?.close()
} catch (error) {
  cleanupErrors.push(error)
}
const trashed = spawnSync('trash', [profilePath], {
  encoding: 'utf8',
  stdio: 'pipe'
})
if (trashed.error || trashed.status !== 0) {
  cleanupErrors.push(
    new Error('Temporary live-smoke browser profile was not trashed', {
      cause: trashed.error
    })
  )
}

const failures = [...(executionError ? [executionError] : []), ...cleanupErrors]
if (failures.length === 1) {
  throw failures[0]
}
if (failures.length > 1) {
  throw new AggregateError(failures, 'Live smoke and cleanup both failed')
}
console.log(JSON.stringify(evidence, null, 2))
