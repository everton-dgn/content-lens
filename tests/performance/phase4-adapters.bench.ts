import { performance } from 'node:perf_hooks'

import { describe, expect, it } from 'vitest'

import { observeHackerNewsCandidates } from '@/adapters/hacker-news'
import {
  MAX_RSS_ENTRIES_PER_RESPONSE,
  MAX_RSS_RESPONSE_BYTES,
  parseRssFeed
} from '@/adapters/rss'

import { budgetRegime, effectiveBudgetMs } from './budget'

const sampleCount = 30
const hackerNewsBudgetMs = 50
const rssBudgetMs = 500
const observedAt = '2026-07-31T00:00:00.000Z'

function percentile(samples: readonly number[], value: number) {
  const sorted = [...samples].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(sorted.length * value) - 1)
  return sorted[index] ?? 0
}

function summarize(samples: readonly number[]) {
  return {
    medianMs: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    worstMs: Math.max(...samples)
  }
}

const hackerNewsFixture = `<body><table><tbody>${Array.from(
  { length: 100 },
  (_, index) => `
    <tr class="athing" data-id="${31_000 + index}">
      <td class="title"><span class="titleline"><a href="https://articles.example/${index}">Story ${index}</a></span></td>
    </tr>
    <tr><td class="subtext"><span class="score">${index} points</span><a class="hnuser">author${index}</a><span class="age">1 hour ago</span><a href="item?id=${31_000 + index}">${index} comments</a></td></tr>`
).join('')}</tbody></table></body>`

function rssMaximumFixture() {
  const entries = Array.from(
    { length: MAX_RSS_ENTRIES_PER_RESPONSE },
    (_, index) =>
      `<item><guid>entry-${index}</guid><title>Entry ${index}</title><description>Body ${index}</description></item>`
  ).join('')
  const prefix = `<?xml version="1.0" encoding="UTF-8"?><rss><channel><description>`
  const middle = `</description>${entries}`
  const suffix = '</channel></rss>'
  const fixedBytes = new TextEncoder().encode(prefix + middle + suffix).length
  const xml = `${prefix}${'x'.repeat(MAX_RSS_RESPONSE_BYTES - fixedBytes)}${middle}${suffix}`
  expect(new TextEncoder().encode(xml)).toHaveLength(MAX_RSS_RESPONSE_BYTES)
  return xml
}

function measureHackerNews(html: string) {
  document.documentElement.innerHTML = html
  let candidates = 0
  const startedAt = performance.now()
  const observation = observeHackerNewsCandidates(document, {
    pageInstanceId: 'page:performance',
    surface: 'front-page',
    onCandidate: () => {
      candidates += 1
    }
  })
  const durationMs = performance.now() - startedAt
  observation.disconnect()
  expect(candidates).toBe(100)
  return durationMs
}

async function measureRss(xml: string) {
  const startedAt = performance.now()
  const result = await parseRssFeed({
    feedId: 'feed:performance',
    finalUrl: 'https://feeds.example/performance.xml',
    observedAt,
    xml
  })
  const durationMs = performance.now() - startedAt
  expect(result.entries).toHaveLength(MAX_RSS_ENTRIES_PER_RESPONSE)
  return durationMs
}

describe('phase 4 adapter performance', () => {
  it('extracts 100 Hacker News stories within the Standard-device gate', () => {
    const coldSamples = Array.from({ length: sampleCount }, () =>
      measureHackerNews(hackerNewsFixture)
    )
    for (let warmup = 0; warmup < 5; warmup += 1) {
      measureHackerNews(hackerNewsFixture)
    }
    const warmSamples = Array.from({ length: sampleCount }, () =>
      measureHackerNews(hackerNewsFixture)
    )
    const result = {
      schemaVersion: 1,
      adapter: 'hacker-news',
      candidates: 100,
      sampleCount,
      budgetMs: hackerNewsBudgetMs,
      regime: budgetRegime(),
      cold: summarize(coldSamples),
      warm: summarize(warmSamples)
    }
    console.log(`[phase4-adapter-benchmark] ${JSON.stringify(result)}`)

    expect(result.cold.p95Ms).toBeLessThanOrEqual(
      effectiveBudgetMs(hackerNewsBudgetMs)
    )
    expect(result.warm.p95Ms).toBeLessThanOrEqual(
      effectiveBudgetMs(hackerNewsBudgetMs)
    )
  })

  it('parses a 2 MiB RSS response with 500 entries within the worker gate', async () => {
    const xml = rssMaximumFixture()
    const coldSamples: number[] = []
    for (let sample = 0; sample < sampleCount; sample += 1) {
      coldSamples.push(await measureRss(xml))
    }
    for (let warmup = 0; warmup < 5; warmup += 1) {
      await measureRss(xml)
    }
    const warmSamples: number[] = []
    for (let sample = 0; sample < sampleCount; sample += 1) {
      warmSamples.push(await measureRss(xml))
    }
    const result = {
      schemaVersion: 1,
      adapter: 'rss',
      bytes: MAX_RSS_RESPONSE_BYTES,
      entries: MAX_RSS_ENTRIES_PER_RESPONSE,
      sampleCount,
      budgetMs: rssBudgetMs,
      regime: budgetRegime(),
      cold: summarize(coldSamples),
      warm: summarize(warmSamples)
    }
    console.log(`[phase4-adapter-benchmark] ${JSON.stringify(result)}`)

    expect(result.cold.p95Ms).toBeLessThanOrEqual(
      effectiveBudgetMs(rssBudgetMs)
    )
    expect(result.warm.p95Ms).toBeLessThanOrEqual(
      effectiveBudgetMs(rssBudgetMs)
    )
  })
})
