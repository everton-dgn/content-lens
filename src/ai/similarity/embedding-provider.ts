import { z } from 'zod'

import type { ModelRef } from '@/ai/models/contracts'
import type { ContentItem, Platform } from '@/core/content/contracts'
import {
  MAX_EMBEDDING_DIMENSIONS,
  type RepresentationManifest,
  representationManifestSchema
} from '@/core/similarity/contracts'

export const MAX_EMBEDDING_INPUT_BYTES = 32 * 1024

const embeddingOutputSchema = z.strictObject({
  vector: z.array(z.number().finite()).min(1).max(MAX_EMBEDDING_DIMENSIONS),
  manifest: representationManifestSchema
})

export type EmbeddingExecutionKind = 'local' | 'browser' | 'cloud'

export interface EmbeddingPort {
  readonly model: ModelRef
  readonly execution: EmbeddingExecutionKind
  readonly manifest: RepresentationManifest
  embed(input: {
    text: string
    language: string | null
    signal?: AbortSignal
  }): Promise<unknown>
}

export type EmbeddingAttempt = {
  port: EmbeddingPort
  accepted: boolean
  consented: boolean
  budgetAvailable: boolean
}

export type EmbeddingRouteResult =
  | {
      state: 'embedded'
      vector: number[]
      manifest: RepresentationManifest
      model: ModelRef
      execution: EmbeddingExecutionKind
    }
  | {
      state: 'unavailable'
      code:
        | 'route-unavailable'
        | 'input-too-large'
        | 'cancelled'
        | 'provider-failed'
    }

function minimizedText(item: ContentItem) {
  return [item.title?.trim(), item.body?.trim()].filter(Boolean).join('\n\n')
}

function vectorBytes(vector: readonly number[]) {
  return vector.length * Float32Array.BYTES_PER_ELEMENT
}

export async function executeEmbeddingRoute(input: {
  item: ContentItem
  attempts: readonly EmbeddingAttempt[]
  signal?: AbortSignal
  maximumInputBytes?: number
}): Promise<EmbeddingRouteResult> {
  const text = minimizedText(input.item)
  const maximumInputBytes = input.maximumInputBytes ?? MAX_EMBEDDING_INPUT_BYTES
  if (new TextEncoder().encode(text).byteLength > maximumInputBytes) {
    return { state: 'unavailable', code: 'input-too-large' }
  }
  if (input.signal?.aborted) {
    return { state: 'unavailable', code: 'cancelled' }
  }
  let attempted = false
  let cloudFailed = false
  for (const attempt of input.attempts) {
    if (
      !attempt.accepted ||
      !attempt.budgetAvailable ||
      (attempt.port.execution === 'cloud' && !attempt.consented)
    ) {
      continue
    }
    if (cloudFailed && attempt.port.execution === 'cloud') {
      continue
    }
    attempted = true
    try {
      const output = embeddingOutputSchema.safeParse(
        await attempt.port.embed({
          text,
          language: input.item.language ?? null,
          ...(input.signal ? { signal: input.signal } : {})
        })
      )
      if (
        !output.success ||
        output.data.manifest.versionSpace !==
          attempt.port.manifest.versionSpace ||
        output.data.vector.length !== attempt.port.manifest.dimension ||
        vectorBytes(output.data.vector) > MAX_EMBEDDING_INPUT_BYTES
      ) {
        if (attempt.port.execution === 'cloud') {
          cloudFailed = true
        }
        continue
      }
      const magnitude = Math.sqrt(
        output.data.vector.reduce((sum, value) => sum + value * value, 0)
      )
      if (!Number.isFinite(magnitude) || magnitude === 0) {
        if (attempt.port.execution === 'cloud') {
          cloudFailed = true
        }
        continue
      }
      const vector =
        output.data.manifest.normalization === 'l2'
          ? output.data.vector.map(value => value / magnitude)
          : output.data.vector
      return {
        state: 'embedded',
        vector,
        manifest: output.data.manifest,
        model: structuredClone(attempt.port.model),
        execution: attempt.port.execution
      }
    } catch {
      if (input.signal?.aborted) {
        return { state: 'unavailable', code: 'cancelled' }
      }
      if (attempt.port.execution === 'cloud') {
        cloudFailed = true
      }
    }
  }
  return {
    state: 'unavailable',
    code: attempted ? 'provider-failed' : 'route-unavailable'
  }
}

export function embeddingRoutePlatform(item: ContentItem): Platform {
  return item.platform
}
