import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  MAX_RSS_ENTRIES_PER_RESPONSE,
  parseRssFeed,
  RssParseError,
  rssAdapterCapabilities
} from '@/adapters/rss'
import {
  contentItemSchema,
  MAX_CONTENT_BODY_LENGTH
} from '@/core/content/contracts'

const fixtureDirectory = resolve('tests', 'fixtures', 'rss')
const observedAt = '2026-07-31T10:00:00.000Z'

const parseFixture = async (
  name: 'atom.xml' | 'rdf.xml' | 'rss2.xml',
  feedId = 'feed:synthetic'
) =>
  parseRssFeed({
    feedId,
    finalUrl: 'https://feeds.example/source.xml',
    observedAt,
    xml: await readFile(resolve(fixtureDirectory, name), 'utf8')
  })

describe('RSS parser contract', () => {
  it('verifies fixture provenance, license and checksums', async () => {
    const metadata = JSON.parse(
      await readFile(resolve(fixtureDirectory, 'fixtures.json'), 'utf8')
    ) as {
      files: Record<string, { sha256: string }>
      license: string
      source: { kind: string }
      synthetic: boolean
    }

    expect(metadata).toMatchObject({
      license: 'CC0-1.0',
      source: { kind: 'synthetic' },
      synthetic: true
    })
    for (const [name, fixture] of Object.entries(metadata.files)) {
      const body = await readFile(resolve(fixtureDirectory, name))
      expect(createHash('sha256').update(body).digest('hex')).toBe(
        fixture.sha256
      )
    }
  })

  it('declares bounded RSS capabilities and no native feedback', () => {
    expect(rssAdapterCapabilities).toEqual({
      fields: ['identity', 'title', 'body', 'media', 'published-at', 'context'],
      nativeFeedback: 'unavailable',
      platform: 'rss',
      surfaces: ['feed-entry']
    })
  })

  it('parses RSS 2.0, sanitizes markup and preserves explicit media references', async () => {
    const result = await parseFixture('rss2.xml')

    expect(result.format).toBe('rss')
    expect(result.entries).toHaveLength(2)
    expect(result.entries[0]).toMatchObject({
      platform: 'rss',
      surface: 'rss:feed-entry',
      identity: { status: 'stable' },
      title: 'Synthetic RSS title',
      body: 'Useful body.',
      canonicalUrl: 'https://articles.example/rss-one',
      media: [
        {
          kind: 'thumbnail',
          url: 'https://media.example/rss-one.png',
          width: 640,
          height: 360
        }
      ],
      context: {
        feedId: 'feed:synthetic',
        identityKind: 'rss-guid'
      }
    })
    expect(result.entries[0]?.body).not.toContain('hostile')
    expect(result.entries[1]).toMatchObject({
      identity: {
        status: 'ephemeral',
        pageInstanceId: 'feed:synthetic:1',
        reason: 'not-exposed'
      },
      context: { identityKind: 'ephemeral' }
    })
    expect(
      result.entries.every(entry => contentItemSchema.safeParse(entry).success)
    ).toBe(true)
  })

  it('parses Atom and RDF and resolves a relative canonical link', async () => {
    const [atom, rdf] = await Promise.all([
      parseFixture('atom.xml'),
      parseFixture('rdf.xml')
    ])

    expect(atom).toMatchObject({
      format: 'atom',
      entries: [
        {
          canonicalUrl: 'https://feeds.example/atom-one',
          title: 'Synthetic Atom title',
          body: 'Atom summary.',
          context: { identityKind: 'atom-id' }
        }
      ]
    })
    expect(rdf).toMatchObject({
      format: 'rdf',
      entries: [
        {
          canonicalUrl: 'https://articles.example/rdf-one',
          title: 'Synthetic RDF title',
          context: { identityKind: 'canonical-url' }
        }
      ]
    })
  })

  it('scopes the stable fingerprint to feedId', async () => {
    const [first, repeated, anotherFeed] = await Promise.all([
      parseFixture('atom.xml', 'feed:one'),
      parseFixture('atom.xml', 'feed:one'),
      parseFixture('atom.xml', 'feed:two')
    ])

    expect(first.entries[0]?.id).toBe(repeated.entries[0]?.id)
    expect(first.entries[0]?.id).not.toBe(anotherFeed.entries[0]?.id)
  })

  it('drops published thumbnails unless HTTPS and both dimensions are valid', async () => {
    const parseMedia = (thumbnail: string) =>
      parseRssFeed({
        feedId: 'feed:media',
        finalUrl: 'https://feeds.example/media.xml',
        observedAt,
        xml: `<rss><channel><item><guid>media</guid>${thumbnail}</item></channel></rss>`
      })

    await expect(
      parseMedia(
        '<thumbnail url="https://media.example/image.png" width="640" />'
      )
    ).resolves.toMatchObject({ entries: [{ media: [] }] })
    await expect(
      parseMedia(
        '<thumbnail url="https://media.example/image.png" width="640" height="360" />'
      )
    ).resolves.toMatchObject({
      entries: [
        {
          media: [
            {
              kind: 'thumbnail',
              url: 'https://media.example/image.png',
              width: 640,
              height: 360
            }
          ]
        }
      ]
    })
  })

  it('bounds entries and truncates without splitting a surrogate pair', async () => {
    const entries = Array.from(
      { length: MAX_RSS_ENTRIES_PER_RESPONSE + 1 },
      (_, index) =>
        `<item><guid>item-${index}</guid><description>body</description></item>`
    ).join('')
    const result = await parseRssFeed({
      feedId: 'feed:bounded',
      finalUrl: 'https://feeds.example/bounded.xml',
      observedAt,
      xml: `<rss><channel>${entries}</channel></rss>`
    })

    expect(result.entries).toHaveLength(MAX_RSS_ENTRIES_PER_RESPONSE)
    expect(result.truncated).toBe(true)

    const longBody = `${'a'.repeat(MAX_CONTENT_BODY_LENGTH - 1)}😀tail`
    const bounded = await parseRssFeed({
      feedId: 'feed:unicode',
      finalUrl: 'https://feeds.example/unicode.xml',
      observedAt,
      xml: `<rss><channel><item><guid>unicode</guid><description>${longBody}</description></item></channel></rss>`
    })
    expect(bounded.entries[0]?.body?.endsWith('\ud83d')).toBe(false)
    expect(bounded.entries[0]?.context.bodyTruncated).toBe(true)
  })

  it.each([
    [
      '<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///private">]><rss><channel/></rss>',
      'active-xml-forbidden'
    ],
    [
      '<?xml version="1.0"?><rss><?process unsafe?><channel/></rss>',
      'active-xml-forbidden'
    ],
    [
      '<rss xmlns:xi="http://www.w3.org/2001/XInclude"><channel><xi:include href="local"/></channel></rss>',
      'active-xml-forbidden'
    ],
    ['<html><body>not a feed</body></html>', 'unsupported-feed']
  ])('rejects unsafe or unsupported XML', async (xml, code) => {
    await expect(
      parseRssFeed({
        feedId: 'feed:unsafe',
        finalUrl: 'https://feeds.example/unsafe.xml',
        observedAt,
        xml
      })
    ).rejects.toEqual(new RssParseError(code as 'active-xml-forbidden'))
  })
})
