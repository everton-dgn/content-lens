import type { ContentItem, Platform } from '@/core/content/contracts'
import {
  comparePortableStrings,
  fingerprintPortableValue
} from '@/core/operations/fingerprint'

export const EXACT_FINGERPRINT_VERSION = 'exact-content-v1'

const ignoredParameters: Record<Platform, ReadonlySet<string>> = {
  youtube: new Set(['feature', 'si', 't', 'start', 'index', 'list']),
  linkedin: new Set(['trk', 'trackingId']),
  x: new Set(['s', 't']),
  reddit: new Set(['share_id', 'context', 'ref', 'ref_source']),
  'hacker-news': new Set(),
  rss: new Set()
}

function nonIdentityParameter(platform: Platform, key: string) {
  return ignoredParameters[platform].has(key) || key.startsWith('utm_')
}

export function canonicalSimilarityUrl(
  platform: Platform,
  rawUrl: string | undefined
) {
  if (!rawUrl) {
    return undefined
  }
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return undefined
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    return undefined
  }
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (nonIdentityParameter(platform, key)) {
      url.searchParams.delete(key)
    }
  }
  url.searchParams.sort()
  return `${platform}:${url.toString()}`
}

export function stableSimilarityIdentity(item: ContentItem) {
  return item.identity.status === 'stable'
    ? `${item.platform}:${item.identity.platformContentId}`
    : undefined
}

function normalizeExactText(value: string | undefined) {
  return value?.normalize('NFC').replace(/\r\n?/g, '\n').trim() ?? null
}

export async function exactContentFingerprint(item: ContentItem) {
  return fingerprintPortableValue({
    version: EXACT_FINGERPRINT_VERSION,
    title: normalizeExactText(item.title),
    body: normalizeExactText(item.body),
    media: item.media
      .map(media => ({ kind: media.kind, fingerprint: media.fingerprint }))
      .filter(media => media.fingerprint)
      .sort((left, right) =>
        comparePortableStrings(
          `${left.kind}:${left.fingerprint}`,
          `${right.kind}:${right.fingerprint}`
        )
      )
  })
}

export type ExactMatchEvidence = {
  matched: boolean
  evidenceCodes: Array<
    'stable-platform-id' | 'canonical-url' | 'exact-content-fingerprint'
  >
  leftFingerprint: string
  rightFingerprint: string
}

export async function compareExactContent(
  left: ContentItem,
  right: ContentItem
): Promise<ExactMatchEvidence> {
  const evidenceCodes: ExactMatchEvidence['evidenceCodes'] = []
  const leftIdentity = stableSimilarityIdentity(left)
  const rightIdentity = stableSimilarityIdentity(right)
  if (leftIdentity && leftIdentity === rightIdentity) {
    evidenceCodes.push('stable-platform-id')
  }
  const leftCanonical = canonicalSimilarityUrl(left.platform, left.canonicalUrl)
  const rightCanonical = canonicalSimilarityUrl(
    right.platform,
    right.canonicalUrl
  )
  if (leftCanonical && leftCanonical === rightCanonical) {
    evidenceCodes.push('canonical-url')
  }
  const [leftFingerprint, rightFingerprint] = await Promise.all([
    exactContentFingerprint(left),
    exactContentFingerprint(right)
  ])
  const hasFingerprintEvidence = (item: ContentItem) =>
    Boolean(
      normalizeExactText(item.title) ||
        normalizeExactText(item.body) ||
        item.media.some(media => media.fingerprint)
    )
  if (
    hasFingerprintEvidence(left) &&
    hasFingerprintEvidence(right) &&
    leftFingerprint === rightFingerprint
  ) {
    evidenceCodes.push('exact-content-fingerprint')
  }
  return {
    matched: evidenceCodes.length > 0,
    evidenceCodes,
    leftFingerprint,
    rightFingerprint
  }
}
