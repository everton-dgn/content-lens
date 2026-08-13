import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBrowserVisualMediaPorts } from '@/ai/vision/media-runtime'

const allowedOrigin = 'https://www.youtube.com'
const reference = {
  kind: 'thumbnail' as const,
  url: `${allowedOrigin}/image.png`
}
const signal = new AbortController().signal
const sourceBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

function response(input: {
  ok?: boolean
  redirected?: boolean
  type?: ResponseType
  url?: string
  contentType?: string | null
  bytes?: Uint8Array
}) {
  const blob = new Blob([Uint8Array.from(input.bytes ?? sourceBytes).buffer], {
    type: input.contentType ?? 'image/png'
  })
  return {
    ok: input.ok ?? true,
    redirected: input.redirected ?? false,
    type: input.type ?? 'basic',
    url: input.url ?? reference.url,
    headers: new Headers(
      input.contentType === null
        ? undefined
        : { 'content-type': input.contentType ?? 'image/png' }
    ),
    blob: vi.fn(async () => blob)
  } as unknown as Response
}

function bitmap(width = 640, height = 360) {
  return {
    width,
    height,
    close: vi.fn()
  } as unknown as ImageBitmap
}

function ports(fetchImpl: typeof fetch = vi.fn()) {
  return createBrowserVisualMediaPorts({
    allowedOrigins: () => [allowedOrigin],
    hasPermission: vi.fn(async () => true),
    fetchImpl
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('browser visual media runtime', () => {
  it('exposes origin and permission ports without widening them', async () => {
    const hasPermission = vi.fn(async () => false)
    const media = createBrowserVisualMediaPorts({
      allowedOrigins: () => [allowedOrigin],
      hasPermission,
      fetchImpl: vi.fn()
    })

    expect(media.allowedOrigins('youtube')).toEqual([allowedOrigin])
    await expect(media.hasPermission(allowedOrigin)).resolves.toBe(false)
    expect(hasPermission).toHaveBeenCalledWith(allowedOrigin)
  })

  it('rejects an unapproved source before fetch', async () => {
    const fetchImpl = vi.fn()
    const media = ports(fetchImpl)

    await expect(
      media.resolve(
        { ...reference, url: 'https://unapproved.example/image.png' },
        { allowedOrigins: [allowedOrigin], signal }
      )
    ).rejects.toThrow('media-origin-rejected')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    { ok: false, redirected: false, type: 'basic' as const },
    { ok: true, redirected: true, type: 'basic' as const },
    { ok: true, redirected: false, type: 'opaqueredirect' as const }
  ])('rejects an unsafe fetch response %#', async unsafe => {
    const close = vi.fn()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ ...bitmap(), close }))
    )
    const media = ports(
      vi.fn(async () => response({ ...unsafe, url: reference.url }))
    )

    await expect(
      media.resolve(reference, {
        allowedOrigins: [allowedOrigin],
        signal
      })
    ).rejects.toThrow('media-fetch-rejected')
    expect(close).not.toHaveBeenCalled()
  })

  it('rejects a response URL that crosses the approved origin', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap())
    )
    const media = ports(
      vi.fn(async () =>
        response({ url: 'https://redirected.example/image.png' })
      )
    )

    await expect(
      media.resolve(reference, {
        allowedOrigins: [allowedOrigin],
        signal
      })
    ).rejects.toThrow('media-origin-rejected')
  })

  it.each([
    { responseUrl: reference.url, contentType: 'image/png' },
    { responseUrl: '', contentType: null }
  ])('resolves bounded media and closes the bitmap %#', async fixture => {
    const close = vi.fn()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ ...bitmap(320, 180), close }))
    )
    const fetchImpl = vi.fn(async () =>
      response({
        url: fixture.responseUrl,
        contentType: fixture.contentType
      })
    )
    const media = ports(fetchImpl)

    await expect(
      media.resolve(reference, {
        allowedOrigins: [allowedOrigin],
        signal
      })
    ).resolves.toEqual({
      bytes: sourceBytes,
      declaredMimeType: fixture.contentType ?? 'application/octet-stream',
      width: 320,
      height: 180
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL(reference.url),
      expect.objectContaining({
        credentials: 'omit',
        method: 'GET',
        redirect: 'manual',
        referrerPolicy: 'no-referrer',
        signal
      })
    )
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects minimization before decode when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      ports().minimize(
        {
          bytes: sourceBytes,
          mimeType: 'image/png',
          width: 320,
          height: 180,
          fingerprint: 'sha256:source'
        },
        {
          acceptedMimeTypes: ['image/png'],
          maxEdge: 128,
          maxBytes: 1024,
          signal: controller.signal
        }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects minimization when no output MIME is accepted', async () => {
    await expect(
      ports().minimize(
        {
          bytes: sourceBytes,
          mimeType: 'image/png',
          width: 320,
          height: 180,
          fingerprint: 'sha256:source'
        },
        {
          acceptedMimeTypes: [],
          maxEdge: 128,
          maxBytes: 1024,
          signal
        }
      )
    ).rejects.toThrow('media-mime-unavailable')
  })

  it.each([
    {
      acceptedMimeTypes: ['image/png'] as const,
      context: { drawImage: vi.fn() },
      outputBytes: sourceBytes,
      expectedMime: 'image/png',
      expectedQuality: undefined
    },
    {
      acceptedMimeTypes: ['image/webp'] as const,
      context: { drawImage: vi.fn() },
      outputBytes: sourceBytes,
      expectedMime: 'image/webp',
      expectedQuality: 0.85
    }
  ])('minimizes and fingerprints an accepted image %#', async fixture => {
    const close = vi.fn()
    const convertToBlob = vi.fn(
      async () =>
        new Blob([Uint8Array.from(fixture.outputBytes).buffer], {
          type: fixture.expectedMime
        })
    )
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ ...bitmap(640, 360), close }))
    )
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(
          readonly width: number,
          readonly height: number
        ) {}
        getContext() {
          return fixture.context
        }
        convertToBlob = convertToBlob
      }
    )
    const media = ports()

    const result = await media.minimize(
      {
        bytes: sourceBytes,
        mimeType: 'image/png',
        width: 640,
        height: 360,
        fingerprint: 'sha256:source'
      },
      {
        acceptedMimeTypes: fixture.acceptedMimeTypes,
        maxEdge: 320,
        maxBytes: 1024,
        signal
      }
    )

    expect(result).toMatchObject({
      bytes: sourceBytes,
      mimeType: fixture.expectedMime,
      width: 320,
      height: 180,
      fingerprint: expect.stringMatching(/^sha256:/)
    })
    expect(fixture.context.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      320,
      180
    )
    expect(convertToBlob).toHaveBeenCalledWith({
      type: fixture.expectedMime,
      quality: fixture.expectedQuality
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it.each([
    {
      context: null,
      outputBytes: sourceBytes,
      expected: 'media-canvas-unavailable'
    },
    {
      context: { drawImage: vi.fn() },
      outputBytes: new Uint8Array(1025),
      expected: 'media-output-too-large'
    }
  ])('closes the bitmap when minimization fails %#', async fixture => {
    const close = vi.fn()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ ...bitmap(), close }))
    )
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return fixture.context
        }
        async convertToBlob() {
          return new Blob([Uint8Array.from(fixture.outputBytes).buffer], {
            type: 'image/png'
          })
        }
      }
    )

    await expect(
      ports().minimize(
        {
          bytes: sourceBytes,
          mimeType: 'image/png',
          width: 32,
          height: 64,
          fingerprint: 'sha256:source'
        },
        {
          acceptedMimeTypes: ['image/png'],
          maxEdge: 128,
          maxBytes: 1024,
          signal
        }
      )
    ).rejects.toThrow(fixture.expected)
    expect(close).toHaveBeenCalledOnce()
  })
})
