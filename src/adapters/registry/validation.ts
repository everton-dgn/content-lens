import {
  ADAPTER_BROWSER_NAMES,
  ADAPTER_CAPABILITY_IDS,
  ADAPTER_CAPABILITY_STATES,
  ADAPTER_CONTRACT_VERSION,
  ADAPTER_EXTRACTABLE_FIELDS,
  ADAPTER_RELATION_KINDS,
  ADAPTER_VISUAL_ACTIONS,
  type AdapterDescriptor,
  CONTENT_TRAITS
} from '@/adapters/contracts'
import { AdapterRegistryError } from '@/adapters/registry/errors'
import { PLATFORM_VALUES } from '@/core/content/contracts'
import { PLATFORM_SURFACE_VALUES } from '@/core/content/surfaces'

const diagnosticCodePattern = /^[a-z][a-z0-9-]{1,63}$/
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function assertUnique(
  values: readonly string[],
  code:
    | 'duplicate-surface'
    | 'duplicate-relation'
    | 'duplicate-trait'
    | 'duplicate-extractable-field'
    | 'duplicate-visual-action'
    | 'duplicate-permission'
    | 'duplicate-browser'
    | 'duplicate-spa-event'
) {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) {
      throw new AdapterRegistryError(code, value)
    }
    seen.add(value)
  }
}

export function isSafeDiagnosticCode(value: string): boolean {
  return diagnosticCodePattern.test(value)
}

export function normalizeAdapterOrigin(value: string): string {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.origin !== value ||
      url.pathname !== '/' ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      throw new AdapterRegistryError('invalid-origin', value)
    }
    return url.origin
  } catch (error) {
    if (error instanceof AdapterRegistryError) {
      throw error
    }
    throw new AdapterRegistryError('invalid-origin', value)
  }
}

export function validateAdapterDescriptor(descriptor: AdapterDescriptor): void {
  if (!PLATFORM_VALUES.includes(descriptor.platform)) {
    throw new AdapterRegistryError('invalid-platform', descriptor.platform)
  }
  if (
    !versionPattern.test(descriptor.contractVersion) ||
    descriptor.contractVersion !== ADAPTER_CONTRACT_VERSION
  ) {
    throw new AdapterRegistryError(
      'incompatible-contract-version',
      descriptor.contractVersion
    )
  }
  if (descriptor.origins.length === 0) {
    throw new AdapterRegistryError('invalid-origin', 'missing')
  }
  const origins = descriptor.origins.map(normalizeAdapterOrigin)
  assertUnique(origins, 'duplicate-permission')

  if (descriptor.surfaces.length === 0) {
    throw new AdapterRegistryError('invalid-surface', 'missing')
  }
  assertUnique(descriptor.surfaces, 'duplicate-surface')
  for (const surface of descriptor.surfaces) {
    if (!PLATFORM_SURFACE_VALUES.includes(surface)) {
      throw new AdapterRegistryError('invalid-surface', surface)
    }
    if (!surface.startsWith(`${descriptor.platform}:`)) {
      throw new AdapterRegistryError('surface-platform-mismatch', surface)
    }
  }

  assertUnique(descriptor.relations, 'duplicate-relation')
  for (const relation of descriptor.relations) {
    if (!ADAPTER_RELATION_KINDS.includes(relation)) {
      throw new AdapterRegistryError('invalid-relation', relation)
    }
  }
  assertUnique(descriptor.traits, 'duplicate-trait')
  for (const trait of descriptor.traits) {
    if (!CONTENT_TRAITS.includes(trait)) {
      throw new AdapterRegistryError('invalid-trait', trait)
    }
  }
  assertUnique(descriptor.extractableFields, 'duplicate-extractable-field')
  for (const field of descriptor.extractableFields) {
    if (!ADAPTER_EXTRACTABLE_FIELDS.includes(field)) {
      throw new AdapterRegistryError('invalid-extractable-field', field)
    }
  }
  assertUnique(descriptor.visualActions, 'duplicate-visual-action')
  for (const action of descriptor.visualActions) {
    if (!ADAPTER_VISUAL_ACTIONS.includes(action)) {
      throw new AdapterRegistryError('invalid-visual-action', action)
    }
  }

  const permissionKeys = descriptor.permissionRequirements.map(
    ({ kind, origin }) => `${kind}:${origin}`
  )
  assertUnique(permissionKeys, 'duplicate-permission')
  for (const requirement of descriptor.permissionRequirements) {
    const origin = normalizeAdapterOrigin(requirement.origin)
    if (
      requirement.kind !== 'host' ||
      typeof requirement.optional !== 'boolean' ||
      !origins.includes(origin)
    ) {
      throw new AdapterRegistryError(
        'invalid-permission',
        `${requirement.kind}:${requirement.origin}`
      )
    }
  }

  assertUnique(
    descriptor.testedBrowsers.map(({ browser }) => browser),
    'duplicate-browser'
  )
  for (const evidence of descriptor.testedBrowsers) {
    if (
      !ADAPTER_BROWSER_NAMES.includes(evidence.browser) ||
      evidence.minimumVersion.trim() === ''
    ) {
      throw new AdapterRegistryError('invalid-browser', evidence.browser)
    }
  }
  if (
    descriptor.lastLiveSmokeAt !== null &&
    Number.isNaN(Date.parse(descriptor.lastLiveSmokeAt))
  ) {
    throw new AdapterRegistryError(
      'invalid-live-smoke-date',
      descriptor.lastLiveSmokeAt
    )
  }

  const capabilityKeys = Object.keys(descriptor.capabilities)
  for (const capability of ADAPTER_CAPABILITY_IDS) {
    if (!(capability in descriptor.capabilities)) {
      throw new AdapterRegistryError('missing-capability', capability)
    }
  }
  for (const capability of capabilityKeys) {
    if (
      !ADAPTER_CAPABILITY_IDS.includes(
        capability as (typeof ADAPTER_CAPABILITY_IDS)[number]
      )
    ) {
      throw new AdapterRegistryError('unknown-capability', capability)
    }
    const status =
      descriptor.capabilities[
        capability as (typeof ADAPTER_CAPABILITY_IDS)[number]
      ]
    if (!ADAPTER_CAPABILITY_STATES.includes(status.state)) {
      throw new AdapterRegistryError('invalid-capability-state', status.state)
    }
    if (!isSafeDiagnosticCode(status.code)) {
      throw new AdapterRegistryError('invalid-diagnostic-code', status.code)
    }
  }

  assertUnique(descriptor.spaEvents, 'duplicate-spa-event')
  for (const eventName of descriptor.spaEvents) {
    if (!isSafeDiagnosticCode(eventName)) {
      throw new AdapterRegistryError('invalid-spa-event', eventName)
    }
  }
}
