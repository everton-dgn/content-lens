import { describe, expect, it, vi } from 'vitest'

import {
  MAX_VISUAL_DECODED_PIXELS,
  MAX_VISUAL_ENCODED_BYTES
} from '@/ai/vision/contracts'
import {
  preflightResolvedMedia,
  selectVisualMedia,
  sniffVisualMimeType
} from '@/ai/vision/media-preflight'
import type { ContentItem } from '@/core/content/contracts'

const exposedMedia = {
  kind: 'thumbnail' as const,
  url: 'https://www.youtube.com/thumbnail.png?tracking=secret'
}

const item: ContentItem = {
  id: 'youtube:video:visual-input',
  platform: 'youtube',
  identity: {
    status: 'stable',
    platformContentId: 'visual-input'
  },
  surface: 'youtube:home',
  media: [exposedMedia],
  observedAt: '2026-07-31T09:00:00.000Z',
  context: {}
}

const pngHeader = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

describe('visual media security boundary', () => {
  it('selects only the media reference already exposed by the item', () => {
    expect(selectVisualMedia(item)).toEqual({
      state: 'selected',
      media: item.media[0]
    })
    expect(selectVisualMedia({ ...item, media: [] })).toEqual({
      state: 'abstained',
      abstention: { code: 'unsupported-media', detailCode: 'image-missing' }
    })
    expect(
      selectVisualMedia({
        ...item,
        media: [...item.media, { ...exposedMedia, kind: 'image' }]
      })
    ).toEqual({
      state: 'abstained',
      abstention: { code: 'unsupported-media', detailCode: 'image-count' }
    })
  })

  it('sniffs PNG, JPEG and WebP signatures without trusting declarations', () => {
    expect(sniffVisualMimeType(pngHeader)).toBe('image/png')
    expect(sniffVisualMimeType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(
      'image/jpeg'
    )
    expect(
      sniffVisualMimeType(new TextEncoder().encode('RIFFsizeWEBPpayload'))
    ).toBe('image/webp')
    expect(sniffVisualMimeType(new Uint8Array([1, 2, 3]))).toBeUndefined()
  })

  it.each([
    {
      name: 'empty content',
      input: {
        bytes: new Uint8Array(),
        declaredMimeType: 'image/png',
        width: 320,
        height: 180
      },
      code: 'unsupported-media',
      detailCode: 'empty-image'
    },
    {
      name: 'zero configured budget',
      input: {
        bytes: pngHeader,
        declaredMimeType: 'image/png',
        width: 320,
        height: 180
      },
      maxInputBytes: -1,
      code: 'resource-limit',
      detailCode: 'encoded-bytes'
    },
    {
      name: 'unsafe width',
      input: {
        bytes: pngHeader,
        declaredMimeType: 'image/png',
        width: Number.POSITIVE_INFINITY,
        height: 180
      },
      code: 'unsupported-media',
      detailCode: 'invalid-dimensions'
    },
    {
      name: 'zero height',
      input: {
        bytes: pngHeader,
        declaredMimeType: 'image/png',
        width: 320,
        height: 0
      },
      code: 'unsupported-media',
      detailCode: 'invalid-dimensions'
    },
    {
      name: 'unsupported declared MIME',
      input: {
        bytes: pngHeader,
        declaredMimeType: 'image/gif',
        width: 320,
        height: 180
      },
      code: 'unsupported-media',
      detailCode: 'mime-mismatch'
    }
  ])(
    'rejects $name before hashing',
    async ({ input, maxInputBytes, code, detailCode }) => {
      const hash = vi.fn(async () => 'unused')
      await expect(
        preflightResolvedMedia(input, {
          acceptedMimeTypes: ['image/png'],
          maxInputBytes: maxInputBytes ?? MAX_VISUAL_ENCODED_BYTES,
          hash
        })
      ).resolves.toEqual({
        state: 'abstained',
        abstention: { code, detailCode }
      })
      expect(hash).not.toHaveBeenCalled()
    }
  )

  it('normalizes MIME parameters and rejects formats outside route capability', async () => {
    await expect(
      preflightResolvedMedia(
        {
          bytes: pngHeader,
          declaredMimeType: ' IMAGE/PNG ; charset=binary ',
          width: 320,
          height: 180
        },
        {
          acceptedMimeTypes: ['image/jpeg'],
          maxInputBytes: MAX_VISUAL_ENCODED_BYTES,
          hash: vi.fn(async () => 'unused')
        }
      )
    ).resolves.toEqual({
      state: 'abstained',
      abstention: { code: 'unsupported-media', detailCode: 'mime-unsupported' }
    })
  })

  it('rejects a declared MIME that does not match the encoded bytes', async () => {
    const hash = vi.fn()
    const result = await preflightResolvedMedia(
      {
        bytes: pngHeader,
        declaredMimeType: 'image/jpeg',
        width: 320,
        height: 180
      },
      {
        acceptedMimeTypes: ['image/png', 'image/jpeg'],
        maxInputBytes: MAX_VISUAL_ENCODED_BYTES,
        hash
      }
    )

    expect(result).toEqual({
      state: 'abstained',
      abstention: {
        code: 'unsupported-media',
        detailCode: 'mime-mismatch'
      }
    })
    expect(hash).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'encoded byte limit',
      input: {
        bytes: new Uint8Array(MAX_VISUAL_ENCODED_BYTES + 1),
        declaredMimeType: 'image/png',
        width: 320,
        height: 180
      },
      detailCode: 'encoded-bytes'
    },
    {
      name: 'decoded pixel limit',
      input: {
        bytes: pngHeader,
        declaredMimeType: 'image/png',
        width: MAX_VISUAL_DECODED_PIXELS,
        height: 2
      },
      detailCode: 'decoded-pixels'
    }
  ])('rejects media above the $name', async ({ input, detailCode }) => {
    await expect(
      preflightResolvedMedia(input, {
        acceptedMimeTypes: ['image/png'],
        maxInputBytes: MAX_VISUAL_ENCODED_BYTES,
        hash: vi.fn(async () => 'unused')
      })
    ).resolves.toEqual({
      state: 'abstained',
      abstention: { code: 'resource-limit', detailCode }
    })
  })

  it('returns a fingerprinted media object without retaining its source URL', async () => {
    const result = await preflightResolvedMedia(
      {
        bytes: pngHeader,
        declaredMimeType: 'image/png',
        width: 320,
        height: 180
      },
      {
        acceptedMimeTypes: ['image/png'],
        maxInputBytes: MAX_VISUAL_ENCODED_BYTES,
        hash: vi.fn(async () => 'sha256:png')
      }
    )

    expect(result).toEqual({
      state: 'ready',
      media: {
        bytes: pngHeader,
        mimeType: 'image/png',
        width: 320,
        height: 180,
        fingerprint: 'sha256:png'
      }
    })
    expect(JSON.stringify(result)).not.toContain('youtube.com')
    expect(JSON.stringify(result)).not.toContain('tracking')
  })
})
