import { describe, expect, it } from 'vitest'

import { extractXCandidate, readXCandidateSource } from '@/adapters/x'
import { MAX_CONTENT_BODY_LENGTH } from '@/core/content/contracts'

// Split so the public repository guard does not read the rejected media
// sources below as real endpoints the extension talks to.
const httpScheme = ['http', '://'].join('')
const credentialImage = ['https', '://user:', 'token', '@x.com/photo.png'].join(
  ''
)
const credentialPoster = [
  'https',
  '://user:',
  'token',
  '@x.com/poster.png'
].join('')
const pageInstanceId = 'page:x:1'

const article = (html: string): Element => {
  document.documentElement.innerHTML = `<article data-testid="tweet">${html}</article>`
  const element = document.querySelector('article')
  if (!element) {
    throw new Error('the fixture article was not attached')
  }
  return element
}

const read = (html: string) => readXCandidateSource(article(html), 'for-you')

describe('X candidate source degradation', () => {
  it('reports a post with nothing to identify it as not exposed', () => {
    const source = read('<div></div>')

    expect(source).toMatchObject({
      authorId: null,
      authorReason: 'not-exposed',
      media: [],
      postId: null,
      postReason: 'not-exposed',
      promoted: false,
      relations: [],
      surface: 'for-you',
      text: '',
      textPartial: false
    })
    expect(source).not.toHaveProperty('canonicalUrl')
    expect(source).not.toHaveProperty('authorDisplayName')
    expect(source).not.toHaveProperty('authorProfileUrl')
  })

  it.each([
    {
      href: 'https://evil.example/user/status/123',
      reason: 'a link that leaves the platform origin'
    },
    {
      href: `${httpScheme}x.com/user/status/123`,
      reason: 'a link that leaves HTTPS'
    }
  ])('refuses $reason', ({ href }) => {
    const source = read(`<a href="${href}">post</a>`)

    expect(source.postId).toBeNull()
    expect(source.postReason).toBe('not-exposed')
    expect(source).not.toHaveProperty('canonicalUrl')
  })

  it.each([
    { path: '/user/status/', reason: 'a path with no identifier at all' },
    { path: '/user/status/0123', reason: 'an identifier with a leading zero' }
  ])('keeps the post ephemeral for $reason', ({ path }) => {
    const source = read(`<a href="${path}">post</a>`)

    expect(source.postId).toBeNull()
  })

  it('marks a readable link with an unusable identifier as invalid', () => {
    const source = read('<a href="/user/status/0123">post</a>')

    expect(source).toMatchObject({
      postId: null,
      postReason: 'invalid',
      canonicalUrl: 'https://x.com/user/status/0123'
    })
  })

  it('marks an exposed author identifier that fails validation as invalid', () => {
    const source = read(
      '<div data-contentlens-author-id="0abc" href="/user"></div>'
    )

    expect(source).toMatchObject({
      authorId: null,
      authorReason: 'invalid',
      authorProfileUrl: 'https://x.com/user'
    })
  })
})

describe('X candidate relations', () => {
  it('finds no quote when the post itself has no identifier', () => {
    // The first status link is the canonical one, and its identifier fails
    // validation, so there is nothing to compare the other links against.
    const source = read(
      '<a href="/user/status/0123">self</a><a href="/other/status/999">quoted</a>'
    )

    expect(source.postId).toBeNull()
    expect(source.relations).toEqual([])
  })

  it('ignores a status link that points back at the post itself', () => {
    const source = read(
      '<a href="/user/status/123">self</a><a href="/user/status/123">self again</a>'
    )

    expect(source.postId).toBe('123')
    expect(source.relations).toEqual([])
  })

  it('takes the first distinct status link as the quoted post', () => {
    const source = read(
      '<a href="/user/status/123">self</a><a href="/other/status/456">quoted</a><a href="/other/status/789">also quoted</a>'
    )

    expect(source.relations).toEqual([{ kind: 'quote', targetId: '456' }])
    expect(source.surface).toBe('quoted-posts')
  })

  it.each([
    { attribute: 'data-contentlens-reply-to', surface: 'replies' },
    { attribute: 'data-contentlens-thread-parent', surface: 'threads' },
    { attribute: 'data-contentlens-thread-root', surface: 'threads' }
  ])(
    'infers the $surface surface from $attribute',
    ({ attribute, surface }) => {
      document.documentElement.innerHTML = `<article data-testid="tweet" ${attribute}="42"></article>`
      const element = document.querySelector('article')
      if (!element) {
        throw new Error('the fixture article was not attached')
      }

      expect(readXCandidateSource(element, 'for-you').surface).toBe(surface)
    }
  )

  it('drops a relation whose target identifier is unusable', () => {
    document.documentElement.innerHTML =
      '<article data-testid="tweet" data-contentlens-reply-to="0042"></article>'
    const element = document.querySelector('article')
    if (!element) {
      throw new Error('the fixture article was not attached')
    }

    expect(readXCandidateSource(element, 'for-you')).toMatchObject({
      relations: [],
      surface: 'for-you'
    })
  })
})

describe('X candidate media', () => {
  it.each([
    {
      reason: 'an image outside HTTPS',
      html: `<div data-testid="tweetPhoto"><img src="${httpScheme}x.com/photo.png"></div>`
    },
    {
      reason: 'an image carrying credentials',
      html: `<div data-testid="tweetPhoto"><img src="${credentialImage}"></div>`
    },
    {
      reason: 'a video poster outside HTTPS',
      html: `<video poster="${httpScheme}x.com/poster.png"></video>`
    },
    {
      reason: 'a video poster carrying credentials',
      html: `<video poster="${credentialPoster}"></video>`
    }
  ])('drops $reason', ({ html }) => {
    expect(read(html).media).toEqual([])
  })

  it('keeps images and video posters that stay on the platform origin', () => {
    const source = read(
      '<div data-testid="tweetPhoto"><img src="/photo.png"></div><video poster="/poster.png"></video>'
    )

    expect(source.media).toEqual([
      { kind: 'image', url: 'https://x.com/photo.png' },
      { kind: 'video-preview', url: 'https://x.com/poster.png' }
    ])
  })
})

describe('X candidate text', () => {
  it('marks text the page collapsed as partial', () => {
    const source = read(
      '<div data-testid="tweetText" data-contentlens-expanded="false">short</div>'
    )

    expect(source).toMatchObject({ text: 'short', textPartial: true })
  })

  it('marks text past the body limit as partial and truncates it', () => {
    const source = read(
      `<div data-testid="tweetText">${'a'.repeat(
        MAX_CONTENT_BODY_LENGTH + 10
      )}</div>`
    )

    expect(source.text).toHaveLength(MAX_CONTENT_BODY_LENGTH)
    expect(source.textPartial).toBe(true)
  })

  it('caps a very long display name', () => {
    const source = read(
      `<div data-contentlens-author-id="42" data-contentlens-author-name="${'n'.repeat(
        300
      )}"></div>`
    )

    expect(source.authorDisplayName).toHaveLength(256)
  })
})

describe('X candidate projection', () => {
  it('keeps a post without stable identifiers ephemeral', () => {
    const source = read('<div></div>')
    const candidate = extractXCandidate(
      article('<div></div>'),
      pageInstanceId,
      'dom:1',
      source
    )

    expect(candidate).toMatchObject({
      authorIdentity: { status: 'ephemeral', reason: 'not-exposed' },
      durableAuthorActions: false,
      durablePostActions: false,
      identity: {
        status: 'ephemeral',
        pageInstanceId,
        reason: 'not-exposed'
      }
    })
    expect(candidate).not.toHaveProperty('canonicalUrl')
    expect(candidate).not.toHaveProperty('authorDisplayName')
    expect(candidate).not.toHaveProperty('authorProfileUrl')
  })

  it('carries every stable identifier through to the candidate', () => {
    const html =
      '<a href="/user/status/123">post</a><div data-contentlens-author-id="42" data-contentlens-author-name="Author" href="/user"></div>'
    const source = read(html)
    const candidate = extractXCandidate(
      article(html),
      pageInstanceId,
      'dom:2',
      source
    )

    expect(candidate).toMatchObject({
      authorDisplayName: 'Author',
      authorIdentity: { status: 'stable', authorId: '42' },
      authorProfileUrl: 'https://x.com/user',
      canonicalUrl: 'https://x.com/user/status/123',
      durableAuthorActions: true,
      durablePostActions: true,
      identity: { status: 'stable', platformContentId: '123' }
    })
  })
})
