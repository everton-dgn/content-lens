import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  detectXTimelineSurface,
  normalizeXCandidate,
  observeXCandidates,
  type XCandidate,
  xAdapterCapabilities
} from '@/adapters/x'
import { contentItemSchema } from '@/core/content/contracts'

const fixtureNames = [
  'following',
  'for-you',
  'replies',
  'quoted-posts',
  'threads'
] as const
const observedAt = '2026-07-31T00:00:00.000Z'

type Fixture = {
  expectedCandidate: XCandidate
  fixtureVersion: number
  language: string
  license: string
  pageInstanceId: string
  schemaVersion: number
  source: { kind: 'synthetic' }
  synthetic: true
}

function requireCandidate(
  value: XCandidate | undefined,
  name: string
): XCandidate {
  if (!value) {
    throw new Error(`Missing ${name} candidate`)
  }
  return value
}

async function readFixture(name: (typeof fixtureNames)[number]) {
  const base = resolve('tests', 'fixtures', 'x', name)
  const [html, metadata] = await Promise.all([
    readFile(`${base}.html`, 'utf8'),
    readFile(`${base}.fixture.json`, 'utf8').then(
      value => JSON.parse(value) as Fixture
    )
  ])
  return { html, metadata }
}

describe('X adapter contract', () => {
  it('declares all five surfaces', () => {
    expect(xAdapterCapabilities).toEqual({
      fields: ['identity', 'author', 'body', 'media', 'relations', 'traits'],
      platform: 'x',
      surfaces: ['following', 'for-you', 'replies', 'quoted-posts', 'threads']
    })
  })

  it('extracts every surface and keeps relations distinct', async () => {
    for (const name of fixtureNames) {
      const fixture = await readFixture(name)
      document.documentElement.innerHTML = fixture.html
      for (const element of document.querySelectorAll(
        '[data-contentlens-surface]'
      )) {
        element.removeAttribute('data-contentlens-surface')
      }
      const candidates: XCandidate[] = []
      const observation = observeXCandidates(document, {
        pageInstanceId: fixture.metadata.pageInstanceId,
        onCandidate: candidate => candidates.push(candidate),
        surface: name
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
      expect(
        contentItemSchema.safeParse(
          normalizeXCandidate(requireCandidate(candidates[0], name), observedAt)
        ).success
      ).toBe(true)
    }
  })

  it('does not invent an author identity from the handle', async () => {
    const fixture = await readFixture('quoted-posts')
    document.documentElement.innerHTML = fixture.html
    const candidates: XCandidate[] = []
    const observation = observeXCandidates(document, {
      pageInstanceId: fixture.metadata.pageInstanceId,
      onCandidate: candidate => candidates.push(candidate),
      surface: 'quoted-posts'
    })
    observation.disconnect()

    const candidate = requireCandidate(candidates[0], 'quoted-posts')
    expect(candidate.authorIdentity).toEqual({
      status: 'ephemeral',
      reason: 'not-exposed'
    })
    expect(candidate.durableAuthorActions).toBe(false)
  })

  it('extracts a visible author and quote without inventing an author ID', () => {
    const article = document.createElement('article')
    article.id = 'live-shaped-x-card'
    article.setAttribute('data-testid', 'tweet')
    const author = document.createElement('div')
    author.setAttribute('data-testid', 'User-Name')
    const authorLink = document.createElement('a')
    authorLink.href = '/synthetic_author'
    const authorName = document.createElement('span')
    authorName.textContent = 'Synthetic Author'
    authorLink.append(authorName)
    author.append(authorLink)
    const canonicalLink = document.createElement('a')
    canonicalLink.href = '/synthetic_author/status/22001'
    const text = document.createElement('p')
    text.setAttribute('data-testid', 'tweetText')
    text.textContent = 'Visible synthetic post.'
    const quoteLink = document.createElement('a')
    quoteLink.href = '/quoted_author/status/21001'
    article.append(author, canonicalLink, text, quoteLink)
    document.body.replaceChildren(article)

    const candidates: XCandidate[] = []
    const observation = observeXCandidates(document, {
      onCandidate: candidate => candidates.push(candidate),
      pageInstanceId: 'page-x-live-shaped',
      surface: 'for-you'
    })
    observation.disconnect()

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      authorDisplayName: 'Synthetic Author',
      authorIdentity: { status: 'ephemeral', reason: 'not-exposed' },
      authorProfileUrl: 'https://x.com/synthetic_author',
      durableAuthorActions: false,
      identity: { status: 'stable', platformContentId: '22001' },
      relations: [{ kind: 'quote', targetId: '21001' }],
      surface: 'quoted-posts'
    })
  })

  it.each([
    ['For you', 'for-you'],
    ['Para você', 'for-you'],
    ['Para ti', 'for-you'],
    ['Following', 'following'],
    ['Seguindo', 'following'],
    ['Siguiendo', 'following']
  ] as const)('detects the active %s timeline', (label, expected) => {
    document.body.innerHTML = `<div role="tab" aria-selected="true">${label}</div>`

    expect(detectXTimelineSurface(document)).toBe(expected)
  })

  it('does not guess an unknown active timeline', () => {
    document.body.innerHTML =
      '<div role="tab" aria-selected="true">Unrecognized</div>'

    expect(detectXTimelineSurface(document)).toBeUndefined()
  })
})
