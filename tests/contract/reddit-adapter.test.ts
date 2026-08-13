import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  normalizeRedditCandidate,
  observeRedditCandidates,
  type RedditCandidate,
  redditAdapterCapabilities
} from '@/adapters/reddit'
import { contentItemSchema } from '@/core/content/contracts'

const fixtureNames = [
  'home',
  'popular',
  'all',
  'subreddit',
  'search',
  'comments'
] as const

type Fixture = {
  expectedCandidate: Partial<RedditCandidate>
  fixtureVersion: number
  language: string
  license: string
  pageInstanceId: string
  schemaVersion: number
  source: { kind: 'synthetic' }
  synthetic: true
}

async function readFixture(name: (typeof fixtureNames)[number]) {
  const base = resolve('tests', 'fixtures', 'reddit', name)
  const [html, metadata] = await Promise.all([
    readFile(`${base}.html`, 'utf8'),
    readFile(`${base}.fixture.json`, 'utf8').then(
      value => JSON.parse(value) as Fixture
    )
  ])
  return { html, metadata }
}

describe('Reddit adapter contract', () => {
  it('declares the six post and comment surfaces', () => {
    expect(redditAdapterCapabilities.surfaces).toEqual([
      'home',
      'popular',
      'all',
      'subreddit',
      'search',
      'comments'
    ])
  })

  it('extracts every surface and emits schema-valid content', async () => {
    for (const name of fixtureNames) {
      const fixture = await readFixture(name)
      document.documentElement.innerHTML = fixture.html
      for (const element of document.querySelectorAll(
        '[data-contentlens-surface]'
      )) {
        element.removeAttribute('data-contentlens-surface')
      }
      const candidates: RedditCandidate[] = []
      const observation = observeRedditCandidates(document, {
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
      expect(candidates).toHaveLength(1)
      const candidate = candidates[0]
      if (!candidate) {
        throw new Error(`Missing ${name} candidate`)
      }
      expect(candidate).toMatchObject(fixture.metadata.expectedCandidate)
      expect(
        contentItemSchema.safeParse(
          normalizeRedditCandidate(candidate, '2026-07-31T00:00:00.000Z')
        ).success
      ).toBe(true)
    }
  })

  it('keeps comments as a separate surface and does not hide descendants', async () => {
    const fixture = await readFixture('comments')
    document.documentElement.innerHTML = fixture.html
    const candidates: RedditCandidate[] = []
    const observation = observeRedditCandidates(document, {
      pageInstanceId: fixture.metadata.pageInstanceId,
      onCandidate: candidate => candidates.push(candidate),
      surface: 'comments'
    })
    observation.disconnect()

    expect(candidates[0]).toMatchObject({
      surface: 'comments',
      relations: [
        { kind: 'reply', targetId: 't1_parent1' },
        { kind: 'thread-root', targetId: 't3_root01' }
      ]
    })
    expect(document.getElementById('reddit-comment-card')?.hidden).toBe(false)
  })

  it('does not observe the page post as a comment candidate', () => {
    const post = document.createElement('shreddit-post')
    post.id = 't3_root01'
    post.setAttribute('post-title', 'Synthetic root post')
    const comment = document.createElement('shreddit-comment')
    comment.id = 'synthetic-comment-node'
    comment.setAttribute('postid', 't3_root01')
    comment.setAttribute('thingid', 't1_child01')
    const body = document.createElement('p')
    body.slot = 'comment'
    body.textContent = 'Synthetic child comment.'
    comment.append(body)
    document.body.replaceChildren(post, comment)

    const candidates: RedditCandidate[] = []
    const observation = observeRedditCandidates(document, {
      onCandidate: candidate => candidates.push(candidate),
      pageInstanceId: 'page-reddit-comment-isolation',
      surface: 'comments'
    })
    observation.disconnect()

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      identity: { status: 'stable', platformContentId: 't1_child01' },
      surface: 'comments'
    })
  })
})
