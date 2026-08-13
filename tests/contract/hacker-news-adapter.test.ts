import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  type HackerNewsCandidate,
  type HackerNewsSurface,
  hackerNewsAdapterCapabilities,
  normalizeHackerNewsCandidate,
  observeHackerNewsCandidates
} from '@/adapters/hacker-news'
import { contentItemSchema } from '@/core/content/contracts'

const listFixtures = [
  ['front-page', 'front-page'],
  ['new', 'new'],
  ['best', 'best'],
  ['ask', 'ask'],
  ['show', 'show'],
  ['jobs', 'jobs']
] as const

type Fixture = {
  expectedCandidate?: Partial<HackerNewsCandidate>
  expectedCandidateCount?: number
  fixtureVersion: number
  language: string
  license: string
  sha256: string
  pageInstanceId: string
  schemaVersion: number
  source: { kind: 'synthetic' }
  synthetic: true
}

async function readFixture(name: string) {
  const base = resolve('tests', 'fixtures', 'hacker-news', name)
  const [html, metadata] = await Promise.all([
    readFile(`${base}.html`, 'utf8'),
    readFile(`${base}.fixture.json`, 'utf8').then(
      value => JSON.parse(value) as Fixture
    )
  ])
  expect(createHash('sha256').update(html).digest('hex')).toBe(metadata.sha256)
  expect(metadata).toMatchObject({
    language: 'en',
    license: 'CC0-1.0',
    source: { kind: 'synthetic' },
    synthetic: true
  })
  return { html, metadata }
}

describe('Hacker News adapter contract', () => {
  it('declares six list surfaces and one detail surface', () => {
    expect(hackerNewsAdapterCapabilities).toEqual({
      fields: ['identity', 'title', 'author', 'context'],
      nativeFeedback: 'unavailable',
      platform: 'hacker-news',
      surfaces: ['front-page', 'new', 'best', 'ask', 'show', 'jobs', 'item']
    })
  })

  it.each(listFixtures)(
    'extracts the %s list fixture',
    async (name, surface) => {
      const fixture = await readFixture(name)
      document.documentElement.innerHTML = fixture.html
      const candidates: HackerNewsCandidate[] = []
      const observation = observeHackerNewsCandidates(document, {
        pageInstanceId: fixture.metadata.pageInstanceId,
        surface,
        onCandidate: candidate => candidates.push(candidate)
      })
      observation.disconnect()

      expect(candidates).toHaveLength(1)
      const candidate = candidates[0]
      if (!candidate) {
        throw new Error(`Missing ${name} candidate`)
      }
      expect(candidate).toMatchObject(fixture.metadata.expectedCandidate ?? {})
      expect(
        contentItemSchema.safeParse(
          normalizeHackerNewsCandidate(candidate, '2026-07-31T00:00:00.000Z')
        ).success
      ).toBe(true)
    }
  )

  it('keeps the item detail and comments outside automatic decisions', async () => {
    const fixture = await readFixture('item')
    document.documentElement.innerHTML = fixture.html
    const candidates: HackerNewsCandidate[] = []
    const observation = observeHackerNewsCandidates(document, {
      pageInstanceId: fixture.metadata.pageInstanceId,
      surface: 'item' satisfies HackerNewsSurface,
      onCandidate: candidate => candidates.push(candidate)
    })
    observation.disconnect()

    expect(candidates).toHaveLength(
      fixture.metadata.expectedCandidateCount ?? 0
    )
    expect(document.getElementById('hn-item-detail')?.hidden).toBe(false)
    expect(document.getElementById('hn-comments')?.hidden).toBe(false)
  })
})
