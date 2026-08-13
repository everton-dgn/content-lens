import {
  type SyncEntityType,
  type SyncEnvelope,
  syncEnvelopeSchema
} from '@/sync/contracts'

const collectionOrder: readonly SyncEntityType[] = [
  'portableProviders',
  'modelCatalog',
  'modelBindings',
  'rules',
  'exclusions',
  'identities',
  'platformPreferences'
]

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)])
    )
  }
  return value
}

async function sha256Hex(bytes: Uint8Array) {
  const input = new Uint8Array(bytes.byteLength)
  input.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')
}

export async function fingerprintSyncEntity(value: unknown) {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(stableValue(value))))
}

export function syncEntityId(
  entityType: SyncEntityType,
  value: Record<string, unknown>
) {
  if (entityType === 'portableProviders') {
    return String(value.providerConfigId)
  }
  if (entityType === 'modelCatalog') {
    return `${String(value.providerConfigId)}\u0000${String(value.modelId)}`
  }
  return String(value.id)
}

export function canonicalSyncPayload(envelope: Omit<SyncEnvelope, 'digest'>) {
  const profile = Object.fromEntries(
    collectionOrder.map(entityType => [
      entityType,
      [...envelope.profile[entityType]].sort((left, right) =>
        syncEntityId(
          entityType,
          left as unknown as Record<string, unknown>
        ).localeCompare(
          syncEntityId(entityType, right as unknown as Record<string, unknown>)
        )
      )
    ])
  )
  const tombstones = [...envelope.tombstones].sort((left, right) =>
    `${left.entityType}\u0000${left.entityId}`.localeCompare(
      `${right.entityType}\u0000${right.entityId}`
    )
  )
  return JSON.stringify(
    stableValue({
      ...envelope,
      profile,
      tombstones
    })
  )
}

export async function digestSyncEnvelope(
  envelope: Omit<SyncEnvelope, 'digest'>
) {
  const bytes = new TextEncoder().encode(canonicalSyncPayload(envelope))
  return sha256Hex(bytes)
}

export async function sealSyncEnvelope(
  envelope: Omit<SyncEnvelope, 'digest'>
): Promise<SyncEnvelope> {
  const sealed = { ...envelope, digest: await digestSyncEnvelope(envelope) }
  return syncEnvelopeSchema.parse(sealed)
}

export async function verifySyncEnvelope(input: unknown) {
  const parsed = syncEnvelopeSchema.safeParse(input)
  if (!parsed.success) {
    return { valid: false as const, code: 'invalid-envelope' as const }
  }
  const { digest, ...payload } = parsed.data
  const actual = await digestSyncEnvelope(payload)
  return actual === digest
    ? { valid: true as const, envelope: parsed.data }
    : { valid: false as const, code: 'digest-mismatch' as const }
}
