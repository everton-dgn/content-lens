import { z } from 'zod'

import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  platformSchema,
  surfaceSchema
} from '@/core/content/contracts'

export const ASSISTANCE_DRAFT_SCHEMA_VERSION = 'rule-draft-proposal@1'
export const ASSISTANCE_EXPLANATION_SCHEMA_VERSION = 'assistance-explanation@1'
export const MAX_ASSISTANCE_INPUT_BYTES = 16 * 1024
export const MAX_ASSISTANCE_EXAMPLES = 20
export const MAX_ASSISTANCE_SCOPE_ENTRIES = 8

export const DRAFT_FIELD_VALUES = [
  'rule.effect',
  'rule.scope.platforms',
  'rule.scope.surfaces',
  'rule.description',
  'rule.examples',
  'rule.exclusions',
  'rule.threshold'
] as const

export const DRAFT_WARNING_VALUES = [
  'scope-expansion',
  'effect-escalation',
  'protected-exception'
] as const

const boundedString = (maximum: number) => nonEmptyStringSchema.max(maximum)
const safeReferenceSchema = boundedString(256).refine(
  value => !value.includes('?') && !value.includes('#'),
  { message: 'Reference must not contain query or fragment data' }
)
const draftFieldSchema = z.enum(DRAFT_FIELD_VALUES)

export const draftFieldRefSchema = z.strictObject({
  field: draftFieldSchema
})

export const inferredDraftFieldSchema = z.strictObject({
  field: draftFieldSchema,
  confidence: z.number().finite().min(0).max(1),
  evidenceCodes: z.array(safeReferenceSchema).max(16)
})

const assistanceScopeSchema = z
  .strictObject({
    platforms: z.array(platformSchema).max(MAX_ASSISTANCE_SCOPE_ENTRIES),
    surfaces: z.array(surfaceSchema).max(MAX_ASSISTANCE_SCOPE_ENTRIES)
  })
  .superRefine((scope, context) => {
    if (
      new Set(scope.platforms).size !== scope.platforms.length ||
      new Set(scope.surfaces).size !== scope.surfaces.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Scope entries must be unique'
      })
    }
    if (
      scope.platforms.length + scope.surfaces.length >
      MAX_ASSISTANCE_SCOPE_ENTRIES
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Combined assistance scope is too large'
      })
    }
    if (
      scope.platforms.length > 0 &&
      scope.surfaces.some(
        surface =>
          !scope.platforms.includes(
            surface.slice(0, surface.indexOf(':')) as z.infer<
              typeof platformSchema
            >
          )
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Surface does not belong to a selected platform',
        path: ['surfaces']
      })
    }
  })

export const assistanceDraftRuleSchema = z.strictObject({
  effect: z.enum(['promote', 'allow', 'reduce', 'block']),
  scope: assistanceScopeSchema,
  description: boundedString(8_192),
  examples: z.array(boundedString(4_096)).max(MAX_ASSISTANCE_EXAMPLES),
  exclusions: z.array(boundedString(4_096)).max(MAX_ASSISTANCE_EXAMPLES),
  threshold: z.number().finite().min(0).max(1)
})

export const assistanceProvenanceSchema = z.strictObject({
  providerConfigId: boundedString(256),
  modelId: boundedString(256),
  modelVersion: boundedString(128),
  routeVersion: boundedString(128),
  promptVersion: boundedString(128),
  outputSchemaVersion: boundedString(128),
  capabilityVersion: boundedString(128),
  executionKind: z.enum(['local', 'browser', 'cloud']),
  generatedAt: isoTimestampSchema,
  inputFingerprint: boundedString(256),
  profileRevision: z.int().nonnegative(),
  platform: platformSchema,
  surface: surfaceSchema,
  contentId: boundedString(256).optional()
})

function duplicateFieldIssues(
  groups: ReadonlyArray<ReadonlyArray<{ field: string }>>,
  context: z.RefinementCtx
) {
  const fields = groups.flatMap(group => group.map(entry => entry.field))
  if (new Set(fields).size !== fields.length) {
    context.addIssue({
      code: 'custom',
      message: 'Draft field groups must not overlap'
    })
  }
}

export const ruleDraftModelOutputSchema = z
  .strictObject({
    schemaVersion: z.literal(ASSISTANCE_DRAFT_SCHEMA_VERSION),
    rule: assistanceDraftRuleSchema,
    inferredFields: z
      .array(inferredDraftFieldSchema)
      .max(DRAFT_FIELD_VALUES.length),
    ambiguousFields: z
      .array(draftFieldRefSchema)
      .max(DRAFT_FIELD_VALUES.length),
    missingFields: z.array(draftFieldRefSchema).max(DRAFT_FIELD_VALUES.length)
  })
  .superRefine((output, context) => {
    duplicateFieldIssues(
      [output.inferredFields, output.ambiguousFields, output.missingFields],
      context
    )
  })

export const ruleDraftProposalSchema = z
  .strictObject({
    schemaVersion: z.literal(ASSISTANCE_DRAFT_SCHEMA_VERSION),
    draftId: boundedString(256),
    baseRevision: z.int().nonnegative(),
    origin: z.enum(['natural-language', 'item-action', 'correction', 'batch']),
    rule: assistanceDraftRuleSchema,
    contextFields: z.array(draftFieldRefSchema).max(DRAFT_FIELD_VALUES.length),
    inferredFields: z
      .array(inferredDraftFieldSchema)
      .max(DRAFT_FIELD_VALUES.length),
    ambiguousFields: z
      .array(draftFieldRefSchema)
      .max(DRAFT_FIELD_VALUES.length),
    missingFields: z.array(draftFieldRefSchema).max(DRAFT_FIELD_VALUES.length),
    warnings: z
      .array(z.enum(DRAFT_WARNING_VALUES))
      .max(DRAFT_WARNING_VALUES.length),
    provenance: assistanceProvenanceSchema
  })
  .superRefine((proposal, context) => {
    duplicateFieldIssues(
      [
        proposal.contextFields,
        proposal.inferredFields,
        proposal.ambiguousFields,
        proposal.missingFields
      ],
      context
    )
    if (proposal.baseRevision !== proposal.provenance.profileRevision) {
      context.addIssue({
        code: 'custom',
        message: 'Draft revision must match trusted provenance',
        path: ['baseRevision']
      })
    }
    if (
      proposal.provenance.surface.slice(
        0,
        proposal.provenance.surface.indexOf(':')
      ) !== proposal.provenance.platform
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Provenance surface does not belong to its platform',
        path: ['provenance', 'surface']
      })
    }
  })

export const assistanceSignalSourceSchema = z.strictObject({
  sourceKind: z.enum([
    'deterministic-rule',
    'adapter-observation',
    'text-model',
    'vision-model',
    'embedding',
    'content-graph',
    'user-feedback'
  ]),
  sourceRef: safeReferenceSchema,
  evidenceCodes: z.array(safeReferenceSchema).max(16)
})

export const assistanceExplanationModelOutputSchema = z.strictObject({
  schemaVersion: z.literal(ASSISTANCE_EXPLANATION_SCHEMA_VERSION),
  summary: boundedString(2_048),
  signalSources: z.array(assistanceSignalSourceSchema).max(32),
  appliedRuleRefs: z.array(safeReferenceSchema).max(32),
  limitations: z.array(boundedString(1_024)).max(16)
})

export const assistanceExplanationSchema =
  assistanceExplanationModelOutputSchema.extend({
    explanationId: boundedString(256),
    baseRevision: z.int().nonnegative(),
    provenance: assistanceProvenanceSchema
  })

export type DraftField = z.infer<typeof draftFieldSchema>
export type DraftFieldRef = z.infer<typeof draftFieldRefSchema>
export type InferredDraftField = z.infer<typeof inferredDraftFieldSchema>
export type AssistanceDraftRule = z.infer<typeof assistanceDraftRuleSchema>
export type RuleDraftModelOutput = z.infer<typeof ruleDraftModelOutputSchema>
export type RuleDraftProposal = z.infer<typeof ruleDraftProposalSchema>
export type AssistanceProvenance = z.infer<typeof assistanceProvenanceSchema>
export type AssistanceExplanationModelOutput = z.infer<
  typeof assistanceExplanationModelOutputSchema
>
export type AssistanceExplanation = z.infer<typeof assistanceExplanationSchema>

export type AssistanceRuntimeProvenance = Omit<
  AssistanceProvenance,
  'inputFingerprint' | 'profileRevision' | 'platform' | 'surface' | 'contentId'
>
