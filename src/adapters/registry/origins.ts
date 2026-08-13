import { AdapterRegistryError } from '@/adapters/registry/errors'
import { normalizeAdapterOrigin } from '@/adapters/registry/validation'
import type { Platform } from '@/core/content/contracts'

export type AdapterOriginOwnership = {
  origin: string
  platform: Platform
}

export class AdapterOriginMap {
  readonly #byOrigin = new Map<string, Platform>()

  constructor(ownerships: readonly AdapterOriginOwnership[]) {
    for (const ownership of ownerships) {
      const origin = normalizeAdapterOrigin(ownership.origin)
      if (this.#byOrigin.has(origin)) {
        throw new AdapterRegistryError('duplicate-origin', origin)
      }
      this.#byOrigin.set(origin, ownership.platform)
    }
  }

  platformFor(value: string | URL | undefined): Platform | undefined {
    if (!value) {
      return undefined
    }
    try {
      const url = typeof value === 'string' ? new URL(value) : value
      if (url.protocol !== 'https:') {
        return undefined
      }
      return this.#byOrigin.get(url.origin)
    } catch {
      return undefined
    }
  }

  entries(): readonly AdapterOriginOwnership[] {
    return [...this.#byOrigin].map(([origin, platform]) => ({
      origin,
      platform
    }))
  }
}
