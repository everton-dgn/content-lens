import {
  MAX_RSS_ENTRIES_PER_RESPONSE,
  MAX_RSS_RESPONSE_BYTES,
  type ParsedRssFeed,
  type RssFeedFormat
} from '@/adapters/rss/types'
import {
  type ContentIdentity,
  type ContentItem,
  MAX_CONTENT_BODY_LENGTH,
  MAX_CONTENT_TITLE_LENGTH,
  type MediaReference
} from '@/core/content/contracts'

export class RssParseError extends Error {
  constructor(
    readonly code:
      | 'active-xml-forbidden'
      | 'document-too-large'
      | 'invalid-xml'
      | 'unsupported-feed'
  ) {
    super(code)
    this.name = 'RssParseError'
  }
}

const blockedHtmlElements = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'svg'
]

const normalizedText = (value: string): string =>
  value.replace(/\s+/gu, ' ').trim()

const truncateUnicode = (
  value: string,
  maximumCodeUnits: number
): { text: string; truncated: boolean } => {
  if (value.length <= maximumCodeUnits) {
    return { text: value, truncated: false }
  }
  let text = ''
  for (const codePoint of value) {
    if (text.length + codePoint.length > maximumCodeUnits) {
      break
    }
    text += codePoint
  }
  return { text, truncated: true }
}

const sanitizeHtmlText = (value: string): string => {
  const document = new DOMParser().parseFromString(value, 'text/html')
  for (const selector of blockedHtmlElements) {
    for (const element of document.querySelectorAll(selector)) {
      element.remove()
    }
  }
  return normalizedText(document.body.textContent ?? '')
}

const directChildren = (parent: Element, localName: string): Element[] =>
  [...parent.children].filter(
    child => child.localName.toLowerCase() === localName.toLowerCase()
  )

const firstDirectChild = (
  parent: Element,
  ...localNames: string[]
): Element | undefined =>
  [...parent.children].find(child =>
    localNames.some(
      localName => child.localName.toLowerCase() === localName.toLowerCase()
    )
  )

const textFrom = (parent: Element, ...localNames: string[]): string =>
  firstDirectChild(parent, ...localNames)?.textContent?.trim() ?? ''

const validCanonicalUrl = (value: string, baseUrl: URL): string | undefined => {
  if (!value) {
    return undefined
  }
  try {
    const url = new URL(value, baseUrl)
    if (!['http:', 'https:'].includes(url.protocol)) {
      return undefined
    }
    url.hash = ''
    return url.href
  } catch {
    return undefined
  }
}

const atomLink = (entry: Element): string => {
  const links = directChildren(entry, 'link')
  return (
    links
      .find(link => {
        const rel = link.getAttribute('rel')
        return !rel || rel === 'alternate'
      })
      ?.getAttribute('href') ?? ''
  )
}

const rssMedia = (entry: Element, baseUrl: URL): MediaReference[] => {
  for (const descendant of entry.getElementsByTagName('*')) {
    if (descendant.localName.toLowerCase() !== 'thumbnail') {
      continue
    }
    const value = descendant.getAttribute('url') ?? ''
    const url = validCanonicalUrl(value, baseUrl)
    if (!url?.startsWith('https://')) {
      return []
    }
    const width = Number(descendant.getAttribute('width'))
    const height = Number(descendant.getAttribute('height'))
    if (
      !Number.isInteger(width) ||
      width <= 0 ||
      !Number.isInteger(height) ||
      height <= 0
    ) {
      return []
    }
    return [
      {
        kind: 'thumbnail',
        url,
        width,
        height
      }
    ]
  }
  return []
}

const fingerprint = async (value: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  )
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

const isoDate = (value: string): string | undefined => {
  if (!value) {
    return undefined
  }
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString()
}

type EntryFields = {
  body: string
  canonicalUrl?: string
  identifier?: string
  identityKind?: 'atom-id' | 'canonical-url' | 'rss-guid'
  media: MediaReference[]
  publishedAt?: string
  title: string
}

const fieldsFrom = (
  entry: Element,
  format: RssFeedFormat,
  baseUrl: URL
): EntryFields => {
  const title = sanitizeHtmlText(textFrom(entry, 'title'))
  const body = sanitizeHtmlText(
    textFrom(entry, 'content', 'encoded', 'summary', 'description')
  )
  const rawLink = format === 'atom' ? atomLink(entry) : textFrom(entry, 'link')
  const canonicalUrl = validCanonicalUrl(rawLink, baseUrl)
  const atomId = format === 'atom' ? textFrom(entry, 'id') : ''
  const guid = format !== 'atom' ? textFrom(entry, 'guid') : ''
  const identifier = atomId || guid || canonicalUrl
  const identityKind = atomId
    ? ('atom-id' as const)
    : guid
      ? ('rss-guid' as const)
      : canonicalUrl
        ? ('canonical-url' as const)
        : undefined
  const publishedAt = isoDate(
    textFrom(entry, 'published', 'updated', 'pubDate', 'date')
  )
  return {
    body,
    ...(canonicalUrl ? { canonicalUrl } : {}),
    ...(identifier ? { identifier } : {}),
    ...(identityKind ? { identityKind } : {}),
    media: rssMedia(entry, baseUrl),
    ...(publishedAt ? { publishedAt } : {}),
    title
  }
}

const parseDocument = (
  xml: string
): { document: Document; format: RssFeedFormat; root: Element } => {
  const withoutDeclaration = xml.replace(/^\s*<\?xml[^?]*\?>/iu, '')
  if (
    /<!DOCTYPE|<!ENTITY|<\?(?!xml)|<xi:include\b|http:\/\/www\.w3\.org\/2001\/XInclude/iu.test(
      withoutDeclaration
    )
  ) {
    throw new RssParseError('active-xml-forbidden')
  }
  const parserInput = xml.replace(
    /<!\[CDATA\[([\s\S]*?)\]\]>/gu,
    (_match, content: string) =>
      content
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
  )
  const document = new DOMParser().parseFromString(
    parserInput,
    'application/xml'
  )
  if (document.querySelector('parsererror')) {
    throw new RssParseError('invalid-xml')
  }
  const root = document.documentElement
  const localName = root.localName.toLowerCase()
  if (localName === 'rss') {
    return { document, format: 'rss', root }
  }
  if (localName === 'feed') {
    return { document, format: 'atom', root }
  }
  if (localName === 'rdf') {
    return { document, format: 'rdf', root }
  }
  throw new RssParseError('unsupported-feed')
}

export async function parseRssFeed(options: {
  feedId: string
  finalUrl: string
  observedAt: string
  xml: string
}): Promise<ParsedRssFeed> {
  if (
    new TextEncoder().encode(options.xml).byteLength > MAX_RSS_RESPONSE_BYTES
  ) {
    throw new RssParseError('document-too-large')
  }
  const { format, root } = parseDocument(options.xml)
  const baseUrl = new URL(options.finalUrl)
  const entryParent =
    format === 'rss' ? firstDirectChild(root, 'channel') : root
  const entryElements = entryParent
    ? directChildren(entryParent, format === 'atom' ? 'entry' : 'item')
    : []
  const selectedEntries = entryElements.slice(0, MAX_RSS_ENTRIES_PER_RESPONSE)
  const entries: ContentItem[] = []

  for (const [index, entry] of selectedEntries.entries()) {
    const fields = fieldsFrom(entry, format, baseUrl)
    const stableFingerprint =
      fields.identifier && fields.identityKind
        ? await fingerprint(
            `${options.feedId}\u0000${fields.identityKind}\u0000${fields.identifier}`
          )
        : undefined
    const pageInstanceId = `${options.feedId}:${index}`
    const identity: ContentIdentity = stableFingerprint
      ? { status: 'stable', platformContentId: stableFingerprint }
      : { status: 'ephemeral', pageInstanceId, reason: 'not-exposed' }
    const boundedTitle = truncateUnicode(fields.title, MAX_CONTENT_TITLE_LENGTH)
    const boundedBody = truncateUnicode(fields.body, MAX_CONTENT_BODY_LENGTH)
    entries.push({
      id: stableFingerprint
        ? `rss:entry:${stableFingerprint}`
        : `rss:page:${pageInstanceId}`,
      platform: 'rss',
      identity,
      ...(fields.canonicalUrl ? { canonicalUrl: fields.canonicalUrl } : {}),
      surface: 'rss:feed-entry',
      ...(boundedTitle.text ? { title: boundedTitle.text } : {}),
      ...(boundedBody.text ? { body: boundedBody.text } : {}),
      media: fields.media,
      ...(fields.publishedAt ? { publishedAt: fields.publishedAt } : {}),
      observedAt: options.observedAt,
      context: {
        feedId: options.feedId,
        identityKind: fields.identityKind ?? 'ephemeral',
        titleTruncated: boundedTitle.truncated,
        bodyTruncated: boundedBody.truncated
      }
    })
  }

  return {
    entries,
    format,
    truncated: entryElements.length > selectedEntries.length
  }
}
