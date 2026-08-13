import type {
  AdapterBrowserName,
  AdapterCapabilityMap,
  AdapterExtractableField,
  AdapterRelationKind,
  AdapterVisualAction,
  ContentTrait
} from '@/adapters/contracts/capabilities'
import type { Platform } from '@/core/content/contracts'
import type { PlatformSurface } from '@/core/content/surfaces'

export const ADAPTER_CONTRACT_VERSION = '1.0.0'

export type AdapterRouteMatch =
  | {
      state: 'supported'
      surface: PlatformSurface
    }
  | {
      state: 'degraded'
      surface: PlatformSurface
      code: string
    }
  | {
      state: 'unsupported'
      code: string
    }

export type AdapterPermissionRequirement = {
  kind: 'host'
  origin: string
  optional: boolean
}

export type AdapterBrowserEvidence = {
  browser: AdapterBrowserName
  minimumVersion: string
}

export type AdapterContext = {
  pageInstanceId: string
  platform: Platform
  surface: PlatformSurface
}

export type FeedAdapter = {
  disconnect(): void
  restoreAll(): number
}

export type AdapterDescriptor = {
  platform: Platform
  contractVersion: string
  origins: readonly string[]
  surfaces: readonly PlatformSurface[]
  relations: readonly AdapterRelationKind[]
  traits: readonly ContentTrait[]
  extractableFields: readonly AdapterExtractableField[]
  visualActions: readonly AdapterVisualAction[]
  permissionRequirements: readonly AdapterPermissionRequirement[]
  testedBrowsers: readonly AdapterBrowserEvidence[]
  lastLiveSmokeAt: string | null
  capabilities: AdapterCapabilityMap
  spaEvents: readonly string[]
  matchLocation(url: URL): AdapterRouteMatch
  create(document: Document, context: AdapterContext): FeedAdapter
}

export type AdapterRegistryMatch =
  | {
      state: 'supported'
      platform: Platform
      surface: PlatformSurface
      descriptor: AdapterDescriptor
    }
  | {
      state: 'degraded'
      platform: Platform
      surface: PlatformSurface
      code: string
      descriptor: AdapterDescriptor
    }
  | {
      state: 'unsupported'
      code: 'origin-not-registered'
    }
  | {
      state: 'unsupported'
      code: string
      platform: Platform
    }
