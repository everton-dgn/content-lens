import type {
  AdapterDescriptor,
  AdapterRegistryMatch,
  AdapterRouteMatch
} from '@/adapters/contracts'
import { AdapterRegistryError } from '@/adapters/registry/errors'
import { AdapterOriginMap } from '@/adapters/registry/origins'
import {
  isSafeDiagnosticCode,
  validateAdapterDescriptor
} from '@/adapters/registry/validation'
import type { Platform } from '@/core/content/contracts'

export class AdapterRegistry {
  readonly #byPlatform = new Map<Platform, AdapterDescriptor>()
  readonly #origins: AdapterOriginMap

  constructor(descriptors: readonly AdapterDescriptor[]) {
    for (const descriptor of descriptors) {
      validateAdapterDescriptor(descriptor)
      if (this.#byPlatform.has(descriptor.platform)) {
        throw new AdapterRegistryError(
          'duplicate-platform',
          descriptor.platform
        )
      }
      this.#byPlatform.set(descriptor.platform, descriptor)
    }
    this.#origins = new AdapterOriginMap(
      descriptors.flatMap(descriptor =>
        descriptor.origins.map(origin => ({
          origin,
          platform: descriptor.platform
        }))
      )
    )
  }

  platforms(): readonly Platform[] {
    return [...this.#byPlatform.keys()]
  }

  get(platform: Platform): AdapterDescriptor | undefined {
    return this.#byPlatform.get(platform)
  }

  platformForOrigin(value: string | URL): Platform | undefined {
    return this.#origins.platformFor(value)
  }

  match(url: URL): AdapterRegistryMatch {
    const platform = this.platformForOrigin(url)
    if (!platform) {
      return {
        state: 'unsupported',
        code: 'origin-not-registered'
      }
    }
    const descriptor = this.#byPlatform.get(platform)
    if (!descriptor) {
      return {
        state: 'unsupported',
        code: 'origin-not-registered'
      }
    }
    const route = descriptor.matchLocation(new URL(url.href))
    return this.#normalizeMatch(descriptor, route)
  }

  #normalizeMatch(
    descriptor: AdapterDescriptor,
    route: AdapterRouteMatch
  ): AdapterRegistryMatch {
    if (route.state === 'unsupported') {
      if (!isSafeDiagnosticCode(route.code)) {
        throw new AdapterRegistryError('invalid-diagnostic-code', route.code)
      }
      return {
        state: 'unsupported',
        code: route.code,
        platform: descriptor.platform
      }
    }
    if (!descriptor.surfaces.includes(route.surface)) {
      throw new AdapterRegistryError('undeclared-route-surface', route.surface)
    }
    if (route.state === 'degraded') {
      if (!isSafeDiagnosticCode(route.code)) {
        throw new AdapterRegistryError('invalid-diagnostic-code', route.code)
      }
      return {
        state: 'degraded',
        platform: descriptor.platform,
        surface: route.surface,
        code: route.code,
        descriptor
      }
    }
    if (route.state === 'supported') {
      return {
        state: 'supported',
        platform: descriptor.platform,
        surface: route.surface,
        descriptor
      }
    }
    throw new AdapterRegistryError('invalid-route-match', 'unknown-state')
  }
}
