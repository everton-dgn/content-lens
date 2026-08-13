import { SyncProviderError } from '@/sync/providers/contracts'

export const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1_000

export function parseRetryAfter(
  value: string | null,
  nowMs: number
): number | undefined {
  if (value === null) {
    return undefined
  }
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1_000, MAX_RETRY_AFTER_MS)
  }
  const dateMs = Date.parse(trimmed)
  if (!Number.isFinite(dateMs)) {
    return undefined
  }
  return Math.min(Math.max(0, dateMs - nowMs), MAX_RETRY_AFTER_MS)
}

export function retryDelay(input: {
  attempt: number
  random: () => number
  retryAfterMs?: number
  baseMs?: number
  maxMs?: number
}) {
  if (input.attempt < 1) {
    throw new RangeError('Retry attempt must be positive')
  }
  const baseMs = input.baseMs ?? 500
  const maxMs = input.maxMs ?? 30_000
  const ceiling = Math.min(maxMs, baseMs * 2 ** (input.attempt - 1))
  const jitter = Math.floor(Math.max(0, Math.min(1, input.random())) * ceiling)
  return Math.max(jitter, input.retryAfterMs ?? 0)
}

export async function retryUnavailable<T>(input: {
  operation: (attempt: number) => Promise<T>
  sleep: (delayMs: number) => Promise<void>
  random?: () => number
  maxAttempts?: number
}): Promise<T> {
  const maxAttempts = input.maxAttempts ?? 3
  const random = input.random ?? Math.random
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await input.operation(attempt)
    } catch (error) {
      if (
        !(error instanceof SyncProviderError) ||
        !error.retryable ||
        attempt === maxAttempts
      ) {
        throw error
      }
      await input.sleep(
        retryDelay({ attempt, random, retryAfterMs: error.retryAfterMs })
      )
    }
  }
  throw new Error('Unreachable retry state')
}
