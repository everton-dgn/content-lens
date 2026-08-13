import {
  MAX_VISUAL_EDGE,
  type MinimizedImage,
  type ResolvedMedia,
  type VisualMimeType
} from '@/ai/vision/contracts'
import type { MediaReference, Platform } from '@/core/content/contracts'

export type VisualMediaPorts = {
  allowedOrigins(platform: Platform): readonly string[]
  hasPermission(origin: string): Promise<boolean>
  resolve(
    reference: MediaReference,
    input: {
      allowedOrigins: readonly string[]
      signal: AbortSignal
    }
  ): Promise<ResolvedMedia>
  minimize(
    media: MinimizedImage,
    input: {
      acceptedMimeTypes: readonly VisualMimeType[]
      maxEdge: number
      maxBytes: number
      signal: AbortSignal
    }
  ): Promise<MinimizedImage>
}

function allowedOrigin(url: URL, allowed: readonly string[]) {
  return allowed.includes(url.origin)
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer
  )
  return `sha256:${[...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')}`
}

export function createBrowserVisualMediaPorts(input: {
  allowedOrigins(platform: Platform): readonly string[]
  hasPermission(origin: string): Promise<boolean>
  fetchImpl?: typeof fetch
}): VisualMediaPorts {
  const fetchImpl = input.fetchImpl ?? fetch
  return {
    allowedOrigins: input.allowedOrigins,
    hasPermission: input.hasPermission,
    async resolve(reference, request) {
      const url = new URL(reference.url)
      if (!allowedOrigin(url, request.allowedOrigins)) {
        throw new Error('media-origin-rejected')
      }
      const response = await fetchImpl(url, {
        credentials: 'omit',
        method: 'GET',
        redirect: 'manual',
        referrerPolicy: 'no-referrer',
        signal: request.signal
      })
      if (
        !response.ok ||
        response.redirected ||
        response.type === 'opaqueredirect'
      ) {
        throw new Error('media-fetch-rejected')
      }
      const responseUrl = response.url ? new URL(response.url) : url
      if (!allowedOrigin(responseUrl, request.allowedOrigins)) {
        throw new Error('media-origin-rejected')
      }
      const declaredMimeType =
        response.headers.get('content-type') ?? 'application/octet-stream'
      const blob = await response.blob()
      const bitmap = await createImageBitmap(blob)
      try {
        return {
          bytes: new Uint8Array(await blob.arrayBuffer()),
          declaredMimeType,
          width: bitmap.width,
          height: bitmap.height
        }
      } finally {
        bitmap.close()
      }
    },
    async minimize(media, request) {
      if (request.signal.aborted) {
        throw new DOMException('Cancelled', 'AbortError')
      }
      const targetMime =
        request.acceptedMimeTypes.find(
          candidate => candidate === media.mimeType
        ) ?? request.acceptedMimeTypes[0]
      if (!targetMime) {
        throw new Error('media-mime-unavailable')
      }
      const scale = Math.min(
        1,
        request.maxEdge / media.width,
        request.maxEdge / media.height
      )
      const width = Math.max(1, Math.round(media.width * scale))
      const height = Math.max(1, Math.round(media.height * scale))
      const bitmap = await createImageBitmap(
        new Blob([Uint8Array.from(media.bytes).buffer], {
          type: media.mimeType
        })
      )
      try {
        const canvas = new OffscreenCanvas(width, height)
        const context = canvas.getContext('2d')
        if (!context) {
          throw new Error('media-canvas-unavailable')
        }
        context.drawImage(bitmap, 0, 0, width, height)
        const blob = await canvas.convertToBlob({
          type: targetMime,
          quality: targetMime === 'image/png' ? undefined : 0.85
        })
        const bytes = new Uint8Array(await blob.arrayBuffer())
        if (bytes.byteLength > request.maxBytes) {
          throw new Error('media-output-too-large')
        }
        return {
          bytes,
          mimeType: targetMime,
          width,
          height,
          fingerprint: await sha256(bytes)
        }
      } finally {
        bitmap.close()
      }
    }
  }
}

export const DEFAULT_VISUAL_MAX_EDGE = MAX_VISUAL_EDGE
