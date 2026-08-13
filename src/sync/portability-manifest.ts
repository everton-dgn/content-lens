import { z } from 'zod'

import type { SyncEntityType, SyncEnvelope } from '@/sync/contracts'

export const PORTABLE_CATEGORY_VALUES = [
  'portableProviders',
  'modelCatalog',
  'modelBindings',
  'rules',
  'exclusions',
  'identities',
  'platformPreferences'
] as const satisfies readonly SyncEntityType[]

export const PORTABLE_EXCLUDED_CATEGORY_VALUES = [
  'cache',
  'consentReceipts',
  'contentHistory',
  'credentials',
  'diagnostics',
  'embeddings',
  'journal',
  'media',
  'recoverySnapshots',
  'remoteTokens',
  'thumbnails',
  'transcripts'
] as const

const portableCount = z.int().nonnegative()
const portableCountsSchema = z.strictObject({
  portableProviders: portableCount,
  modelCatalog: portableCount,
  modelBindings: portableCount,
  rules: portableCount,
  exclusions: portableCount,
  identities: portableCount,
  platformPreferences: portableCount
})

export const portabilityManifestSchema = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  categories: z
    .array(z.enum(PORTABLE_CATEGORY_VALUES))
    .length(PORTABLE_CATEGORY_VALUES.length),
  counts: portableCountsSchema,
  excludedCategories: z
    .array(z.enum(PORTABLE_EXCLUDED_CATEGORY_VALUES))
    .length(PORTABLE_EXCLUDED_CATEGORY_VALUES.length),
  digest: z.string().regex(/^[a-f0-9]{64}$/)
})

export type PortabilityManifest = z.infer<typeof portabilityManifestSchema>

export function createPortabilityManifest(
  envelope: SyncEnvelope,
  createdAt: string
): PortabilityManifest {
  return portabilityManifestSchema.parse({
    createdAt,
    categories: [...PORTABLE_CATEGORY_VALUES],
    counts: Object.fromEntries(
      PORTABLE_CATEGORY_VALUES.map(category => [
        category,
        envelope.profile[category].length
      ])
    ),
    excludedCategories: [...PORTABLE_EXCLUDED_CATEGORY_VALUES],
    digest: envelope.digest
  })
}

export function portabilityManifestMatches(
  manifest: PortabilityManifest,
  envelope: SyncEnvelope
) {
  const expected = createPortabilityManifest(envelope, manifest.createdAt)
  return JSON.stringify(manifest) === JSON.stringify(expected)
}
