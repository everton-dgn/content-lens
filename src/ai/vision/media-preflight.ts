import type {
  MinimizedImage,
  ResolvedMedia,
  VisualMimeType
} from '@/ai/vision/contracts'
import {
  MAX_VISUAL_DECODED_PIXELS,
  MAX_VISUAL_ENCODED_BYTES,
  MAX_VISUAL_IMAGE_COUNT,
  VISUAL_MIME_TYPE_VALUES
} from '@/ai/vision/contracts'
import type { ContentItem, MediaReference } from '@/core/content/contracts'
import type { ClassificationSignals } from '@/core/decisions/signals'

type VisualAbstention = NonNullable<ClassificationSignals['abstention']>

type MediaSelection =
  | { state: 'selected'; media: MediaReference }
  | { state: 'abstained'; abstention: VisualAbstention }

type MediaPreflight =
  | { state: 'ready'; media: MinimizedImage }
  | { state: 'abstained'; abstention: VisualAbstention }

function abstained(
  code: VisualAbstention['code'],
  detailCode: string
): { state: 'abstained'; abstention: VisualAbstention } {
  return { state: 'abstained', abstention: { code, detailCode } }
}

export function selectVisualMedia(item: ContentItem): MediaSelection {
  if (item.media.length !== MAX_VISUAL_IMAGE_COUNT) {
    return abstained(
      'unsupported-media',
      item.media.length === 0 ? 'image-missing' : 'image-count'
    )
  }
  const media = item.media[0]
  if (!media) {
    return abstained('unsupported-media', 'image-missing')
  }
  return { state: 'selected', media }
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((byte, index) => bytes[index] === byte)
}

export function sniffVisualMimeType(
  bytes: Uint8Array
): VisualMimeType | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12 &&
    new TextDecoder('ascii').decode(bytes.slice(0, 4)) === 'RIFF' &&
    new TextDecoder('ascii').decode(bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return undefined
}

function normalizedDeclaredMime(value: string): VisualMimeType | undefined {
  const mime = value.toLowerCase().split(';', 1)[0]?.trim()
  return VISUAL_MIME_TYPE_VALUES.find(candidate => candidate === mime)
}

export async function preflightResolvedMedia(
  media: ResolvedMedia,
  options: {
    acceptedMimeTypes: readonly string[]
    maxInputBytes: number
    hash(bytes: Uint8Array): Promise<string>
  }
): Promise<MediaPreflight> {
  const byteLimit = Math.min(
    MAX_VISUAL_ENCODED_BYTES,
    Math.max(0, options.maxInputBytes)
  )
  if (media.bytes.byteLength === 0) {
    return abstained('unsupported-media', 'empty-image')
  }
  if (media.bytes.byteLength > byteLimit) {
    return abstained('resource-limit', 'encoded-bytes')
  }
  if (
    !Number.isSafeInteger(media.width) ||
    !Number.isSafeInteger(media.height) ||
    media.width <= 0 ||
    media.height <= 0
  ) {
    return abstained('unsupported-media', 'invalid-dimensions')
  }
  if (
    media.width > MAX_VISUAL_DECODED_PIXELS / media.height ||
    media.width * media.height > MAX_VISUAL_DECODED_PIXELS
  ) {
    return abstained('resource-limit', 'decoded-pixels')
  }

  const actualMime = sniffVisualMimeType(media.bytes)
  const declaredMime = normalizedDeclaredMime(media.declaredMimeType)
  if (!actualMime || !declaredMime || actualMime !== declaredMime) {
    return abstained('unsupported-media', 'mime-mismatch')
  }
  if (!options.acceptedMimeTypes.includes(actualMime)) {
    return abstained('unsupported-media', 'mime-unsupported')
  }

  return {
    state: 'ready',
    media: {
      bytes: media.bytes,
      mimeType: actualMime,
      width: media.width,
      height: media.height,
      fingerprint: await options.hash(media.bytes)
    }
  }
}
