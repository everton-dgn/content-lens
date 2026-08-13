import { z } from 'zod'

export const DIAGNOSTIC_SCHEMA_VERSION = 1
export const MAX_DIAGNOSTIC_RECORDS = 100
export const MAX_DIAGNOSTIC_BYTES = 256 * 1024
export const DIAGNOSTIC_RETENTION_DAYS = 7

export const diagnosticSeveritySchema = z.enum([
  'info',
  'warning',
  'error',
  'critical'
])
export const diagnosticRecoverySchema = z.enum([
  'automatic',
  'retryable',
  'action-required',
  'unsupported'
])
export const diagnosticComponentSchema = z.enum([
  'sidepanel',
  'rule-management',
  'profile-import',
  'recovery',
  'runtime',
  'assistance',
  'similarity',
  'content-graph',
  'native-feedback'
])
export const diagnosticCapabilitySchema = z.enum([
  'deterministic-rules',
  'local-profile',
  'profile-portability',
  'recovery',
  'ai-assistance',
  'similarity',
  'content-graph',
  'native-feedback'
])
export const diagnosticPhaseSchema = z.enum([
  'load',
  'save',
  'remove',
  'dry-run',
  'commit',
  'restore',
  'export',
  'generate',
  'validate',
  'preview',
  'dismiss',
  'query',
  'insert',
  'rebuild',
  'evict',
  'quarantine',
  'review',
  'revalidate',
  'activate',
  'verify',
  'circuit'
])
export const diagnosticScopeClassSchema = z.enum([
  'global',
  'platform',
  'surface',
  'adapter',
  'storage',
  'provider',
  'release'
])
export const diagnosticScopeKeySchema = z.enum([
  'youtube',
  'home',
  'search',
  'recommendations',
  'sidepanel',
  'indexed-db',
  'profile',
  'rules',
  'similarity-index',
  'content-graph'
])
export const diagnosticCodeSchema = z.enum([
  'storage-unavailable',
  'invalid-profile',
  'rule-save-failed',
  'rule-remove-failed',
  'import-invalid',
  'import-failed',
  'operation-response-uncertain',
  'recovery-restore-failed',
  'local-reset-failed',
  'unexpected-ui-error',
  'assistance-provider-failed',
  'assistance-refused',
  'assistance-content-filtered',
  'assistance-truncated',
  'assistance-schema-rejected',
  'assistance-draft-policy-rejected',
  'assistance-stale',
  'assistance-cancelled',
  'assistance-dismissed',
  'similarity-route-unavailable',
  'similarity-index-corrupt',
  'similarity-version-mismatch',
  'similarity-evicted',
  'similarity-abstained',
  'graph-conflict',
  'graph-rebuild-required',
  'graph-corrupt',
  'native-feedback-unavailable',
  'native-feedback-review-changed',
  'native-feedback-uncertain',
  'native-feedback-circuit-open',
  'native-feedback-cooldown'
])

export const derivedIntelligenceDiagnosticSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  similarity: z.strictObject({
    state: z.enum([
      'disabled',
      'exact-only',
      'ready',
      'rebuilding',
      'degraded'
    ]),
    itemCount: z.int().nonnegative().max(10_000),
    relationCount: z.int().nonnegative().max(100_000),
    byteLength: z
      .int()
      .nonnegative()
      .max(100 * 1024 * 1024),
    evictionCount: z.int().nonnegative(),
    abstentionCount: z.int().nonnegative(),
    queryP95Milliseconds: z.number().finite().nonnegative(),
    insertP95Milliseconds: z.number().finite().nonnegative(),
    versionSpace: z.string().min(1).max(128).nullable()
  }),
  graph: z.strictObject({
    state: z.enum(['ready', 'rebuilding', 'degraded', 'disabled']),
    nodeCount: z.int().nonnegative().max(15_000),
    edgeCount: z.int().nonnegative().max(100_000),
    conflictCount: z.int().nonnegative(),
    rebuildCount: z.int().nonnegative(),
    corruptionCount: z.int().nonnegative(),
    queryP95Milliseconds: z.number().finite().nonnegative(),
    schemaVersion: z.int().positive(),
    evidenceVersion: z.string().min(1).max(128)
  }),
  recordedAt: z.iso.datetime({ offset: true })
})

const versionDomainsSchema = z.strictObject({
  database: z.string().min(1),
  profile: z.string().min(1),
  rules: z.string().min(1)
})

export const diagnosticEventSchema = z.strictObject({
  schemaVersion: z.literal(DIAGNOSTIC_SCHEMA_VERSION),
  code: diagnosticCodeSchema,
  severity: diagnosticSeveritySchema,
  recovery: diagnosticRecoverySchema,
  reportable: z.boolean(),
  component: diagnosticComponentSchema,
  capability: diagnosticCapabilitySchema,
  phase: diagnosticPhaseSchema,
  scopeClass: diagnosticScopeClassSchema,
  scopeKey: diagnosticScopeKeySchema.optional(),
  occurredAt: z.iso.datetime({ offset: true }),
  correlationId: z.uuid(),
  productVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
  versionDomains: versionDomainsSchema
})

export const diagnosticAggregateSchema = diagnosticEventSchema.extend({
  signature: z.string().min(1),
  count: z.int().positive(),
  firstOccurredAt: z.iso.datetime({ offset: true }),
  lastOccurredAt: z.iso.datetime({ offset: true })
})

export const diagnosticExportSchema = z.strictObject({
  schemaVersion: z.literal(DIAGNOSTIC_SCHEMA_VERSION),
  exportedAt: z.iso.datetime({ offset: true }),
  records: z.array(diagnosticAggregateSchema)
})

export type DiagnosticCode = z.infer<typeof diagnosticCodeSchema>
export type DiagnosticEvent = z.infer<typeof diagnosticEventSchema>
export type DiagnosticAggregate = z.infer<typeof diagnosticAggregateSchema>
export type DiagnosticExport = z.infer<typeof diagnosticExportSchema>
export type DerivedIntelligenceDiagnosticSnapshot = z.infer<
  typeof derivedIntelligenceDiagnosticSnapshotSchema
>

export type DiagnosticFilters = {
  capability?: DiagnosticEvent['capability']
  code?: DiagnosticCode
  component?: DiagnosticEvent['component']
  severity?: DiagnosticEvent['severity']
  since?: string
}
