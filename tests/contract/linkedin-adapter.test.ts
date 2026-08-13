import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  type LinkedInCandidate,
  linkedInAdapterCapabilities,
  normalizeLinkedInCandidate,
  observeLinkedInCandidates
} from '@/adapters/linkedin'
import { contentItemSchema } from '@/core/content/contracts'

const fixtureNames = ['feed', 'repost', 'promoted', 'comment-preview'] as const
const observedAt = '2026-07-31T00:00:00.000Z'

type Fixture = {
  expectedCandidate: LinkedInCandidate
  fixtureVersion: number
  language: string
  license: string
  pageInstanceId: string
  schemaVersion: number
  source: { kind: 'synthetic' }
  synthetic: true
}

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}`)
  }
  return value
}

async function readFixture(name: (typeof fixtureNames)[number]) {
  const base = resolve('tests', 'fixtures', 'linkedin', name)
  const [html, metadata] = await Promise.all([
    readFile(`${base}.html`, 'utf8'),
    readFile(`${base}.fixture.json`, 'utf8').then(
      value => JSON.parse(value) as Fixture
    )
  ])
  return { html, metadata, name }
}

describe('LinkedIn adapter contract', () => {
  it('declares all four surfaces and bounded extractable fields', () => {
    expect(linkedInAdapterCapabilities).toEqual({
      fields: ['identity', 'author', 'body', 'media', 'relations', 'traits'],
      platform: 'linkedin',
      surfaces: ['feed', 'reposts', 'promoted-posts', 'comment-preview']
    })
  })

  it('extracts and normalizes every synthetic surface exactly', async () => {
    for (const name of fixtureNames) {
      const fixture = await readFixture(name)
      document.documentElement.innerHTML = fixture.html
      const candidates: LinkedInCandidate[] = []
      const observation = observeLinkedInCandidates(document, {
        pageInstanceId: fixture.metadata.pageInstanceId,
        onCandidate: candidate => candidates.push(candidate),
        surface: 'feed'
      })
      observation.disconnect()

      expect(fixture.metadata).toMatchObject({
        fixtureVersion: 1,
        language: 'en',
        license: 'CC0-1.0',
        schemaVersion: 1,
        source: { kind: 'synthetic' },
        synthetic: true
      })
      expect(candidates).toEqual([fixture.metadata.expectedCandidate])
      const candidate = requireValue(candidates[0], `${name} candidate`)
      expect(
        contentItemSchema.safeParse(
          normalizeLinkedInCandidate(candidate, observedAt)
        ).success
      ).toBe(true)
    }
  })

  it('uses a new page instance for a recycled node and rejects stale work', async () => {
    const fixture = await readFixture('feed')
    document.documentElement.innerHTML = fixture.html
    const candidates: LinkedInCandidate[] = []
    const nodes: Element[] = []
    const observation = observeLinkedInCandidates(document, {
      pageInstanceId: fixture.metadata.pageInstanceId,
      onCandidate: (candidate, node) => {
        candidates.push(candidate)
        nodes.push(node)
      },
      surface: 'feed'
    })
    const node = requireValue(
      document.getElementById('linkedin-feed-card'),
      'feed card'
    )
    const first = requireValue(candidates[0], 'first candidate')

    node.setAttribute('data-urn', 'urn:li:activity:2001')
    requireValue(
      node.querySelector('[data-contentlens-text]'),
      'feed card text'
    ).textContent = 'Synthetic recycled content.'
    await new Promise(resolveMutation => setTimeout(resolveMutation, 0))

    const second = requireValue(candidates.at(-1), 'recycled candidate')
    expect(second.pageInstanceId).toBe(
      'page-linkedin-feed:linkedin-feed-card:1'
    )
    expect(second.identity).toEqual({
      status: 'stable',
      platformContentId: 'urn:li:activity:2001'
    })
    expect(observation.isCurrent(node, first.pageInstanceId)).toBe(false)
    expect(observation.isCurrent(node, second.pageInstanceId)).toBe(true)
    expect(nodes.every(candidateNode => candidateNode === node)).toBe(true)
    observation.disconnect()
  })

  it('fails open when a consumer throws', async () => {
    const fixture = await readFixture('feed')
    document.documentElement.innerHTML = fixture.html
    const errors: string[] = []
    const observation = observeLinkedInCandidates(document, {
      pageInstanceId: fixture.metadata.pageInstanceId,
      onCandidate: () => {
        throw new Error('synthetic consumer failure')
      },
      onError: ({ reason }) => errors.push(reason),
      surface: 'feed'
    })

    expect(errors).toEqual(['candidate-consumer-failed'])
    expect(document.getElementById('linkedin-feed-card')?.hidden).toBe(false)
    observation.disconnect()
  })
})
