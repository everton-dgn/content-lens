import type { ModelCatalog } from '@/ai/models/catalog'
import type { ModelDescriptor } from '@/ai/models/contracts'
import type { ProviderDescriptor } from '@/ai/providers/contracts'
import type { ProviderRegistry } from '@/ai/providers/registry'
import type { DecisionWorkBinding } from '@/application/decision-pipeline/contracts'
import { isoTimestampSchema } from '@/core/content/contracts'
import { fingerprintPortableValue } from '@/core/operations/fingerprint'

export const SETTINGS_CAPABILITY_SNAPSHOT_SCHEMA_VERSION = 1

export type SettingsProviderCapability = Pick<
  ProviderDescriptor,
  | 'providerConfigId'
  | 'displayName'
  | 'kind'
  | 'execution'
  | 'endpointOrigin'
  | 'credentialMode'
  | 'policyUrl'
  | 'policyReviewedAt'
  | 'status'
  | 'updatedAt'
> & {
  credentialState: 'not-required' | 'configured' | 'missing'
}

export type SettingsCapabilitySnapshot = {
  schemaVersion: typeof SETTINGS_CAPABILITY_SNAPSHOT_SCHEMA_VERSION
  profileRevision: number
  capabilityVersion: string
  publishedAt: string
  providers: SettingsProviderCapability[]
  models: ModelDescriptor[]
}

export type SettingsCapabilitySnapshotInput = {
  profileRevision: number
  publishedAt: string
  providers: ProviderRegistry
  catalog: ModelCatalog
}

function providerCapability(
  provider: ProviderDescriptor
): SettingsProviderCapability {
  const {
    providerConfigId,
    displayName,
    kind,
    execution,
    endpointOrigin,
    credentialMode,
    policyUrl,
    policyReviewedAt,
    status,
    updatedAt
  } = provider
  return {
    providerConfigId,
    displayName,
    kind,
    execution,
    endpointOrigin,
    credentialMode,
    credentialState:
      credentialMode === 'none'
        ? 'not-required'
        : provider.credentialRef
          ? 'configured'
          : 'missing',
    policyUrl,
    policyReviewedAt,
    status,
    updatedAt
  }
}

export async function createSettingsCapabilitySnapshot(
  input: SettingsCapabilitySnapshotInput
): Promise<SettingsCapabilitySnapshot> {
  if (
    !Number.isSafeInteger(input.profileRevision) ||
    input.profileRevision < 0
  ) {
    throw new TypeError('Profile revision must be a non-negative integer')
  }
  const publishedAt = isoTimestampSchema.parse(input.publishedAt)
  const providers = input.providers.list().map(providerCapability)
  const models = input.catalog.list()
  const capabilityVersion = `settings-capabilities@${await fingerprintPortableValue(
    {
      profileRevision: input.profileRevision,
      providers,
      models
    }
  )}`
  return {
    schemaVersion: SETTINGS_CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
    profileRevision: input.profileRevision,
    capabilityVersion,
    publishedAt,
    providers,
    models
  }
}

export type SettingsCapabilityPublication =
  | {
      state: 'published' | 'unchanged'
      snapshot: SettingsCapabilitySnapshot
    }
  | {
      state: 'ignored'
      reason: 'stale-profile-revision' | 'stale-capability-snapshot'
    }

export class SettingsCapabilitySnapshotStore {
  #current: SettingsCapabilitySnapshot | undefined

  publish(input: SettingsCapabilitySnapshot): SettingsCapabilityPublication {
    const snapshot = structuredClone(input)
    const current = this.#current
    if (current && snapshot.profileRevision < current.profileRevision) {
      return { state: 'ignored', reason: 'stale-profile-revision' }
    }
    if (
      current &&
      snapshot.profileRevision === current.profileRevision &&
      snapshot.capabilityVersion === current.capabilityVersion
    ) {
      return {
        state: 'unchanged',
        snapshot: structuredClone(current)
      }
    }
    if (
      current &&
      snapshot.profileRevision === current.profileRevision &&
      snapshot.publishedAt <= current.publishedAt
    ) {
      return { state: 'ignored', reason: 'stale-capability-snapshot' }
    }
    this.#current = snapshot
    return {
      state: 'published',
      snapshot: structuredClone(snapshot)
    }
  }

  current(): SettingsCapabilitySnapshot | undefined {
    return this.#current ? structuredClone(this.#current) : undefined
  }

  matches(
    binding: Pick<DecisionWorkBinding, 'profileRevision' | 'capabilityVersion'>
  ) {
    return (
      this.#current?.profileRevision === binding.profileRevision &&
      this.#current.capabilityVersion === binding.capabilityVersion
    )
  }
}
