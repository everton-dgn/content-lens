import {
  ASSISTANCE_DRAFT_SCHEMA_VERSION,
  ASSISTANCE_EXPLANATION_SCHEMA_VERSION,
  DRAFT_FIELD_VALUES,
  MAX_ASSISTANCE_EXAMPLES,
  MAX_ASSISTANCE_SCOPE_ENTRIES
} from '@/ai/assistance/contracts'
import { PLATFORM_VALUES } from '@/core/content/contracts'
import { PLATFORM_SURFACES } from '@/core/content/surfaces'

const nonEmptyString = (maxLength: number) => ({
  type: 'string',
  minLength: 1,
  maxLength
})
const fieldRef = {
  type: 'object',
  additionalProperties: false,
  required: ['field'],
  properties: {
    field: { type: 'string', enum: DRAFT_FIELD_VALUES }
  }
}

export const ASSISTANCE_DRAFT_MODEL_OUTPUT_JSON_SCHEMA = {
  $id: 'assistance_draft_model_output',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'rule',
    'inferredFields',
    'ambiguousFields',
    'missingFields'
  ],
  properties: {
    schemaVersion: {
      type: 'string',
      const: ASSISTANCE_DRAFT_SCHEMA_VERSION
    },
    rule: {
      type: 'object',
      additionalProperties: false,
      required: [
        'effect',
        'scope',
        'description',
        'examples',
        'exclusions',
        'threshold'
      ],
      properties: {
        effect: {
          type: 'string',
          enum: ['promote', 'allow', 'reduce', 'block']
        },
        scope: {
          type: 'object',
          additionalProperties: false,
          required: ['platforms', 'surfaces'],
          properties: {
            platforms: {
              type: 'array',
              maxItems: MAX_ASSISTANCE_SCOPE_ENTRIES,
              items: { type: 'string', enum: PLATFORM_VALUES }
            },
            surfaces: {
              type: 'array',
              maxItems: MAX_ASSISTANCE_SCOPE_ENTRIES,
              items: {
                type: 'string',
                enum: Object.entries(PLATFORM_SURFACES).flatMap(
                  ([platform, surfaces]) =>
                    surfaces.map(surface => `${platform}:${surface}`)
                )
              }
            }
          }
        },
        description: nonEmptyString(8_192),
        examples: {
          type: 'array',
          maxItems: MAX_ASSISTANCE_EXAMPLES,
          items: nonEmptyString(4_096)
        },
        exclusions: {
          type: 'array',
          maxItems: MAX_ASSISTANCE_EXAMPLES,
          items: nonEmptyString(4_096)
        },
        threshold: { type: 'number', minimum: 0, maximum: 1 }
      }
    },
    inferredFields: {
      type: 'array',
      maxItems: DRAFT_FIELD_VALUES.length,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'confidence', 'evidenceCodes'],
        properties: {
          field: { type: 'string', enum: DRAFT_FIELD_VALUES },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          evidenceCodes: {
            type: 'array',
            maxItems: 16,
            items: nonEmptyString(256)
          }
        }
      }
    },
    ambiguousFields: {
      type: 'array',
      maxItems: DRAFT_FIELD_VALUES.length,
      items: fieldRef
    },
    missingFields: {
      type: 'array',
      maxItems: DRAFT_FIELD_VALUES.length,
      items: fieldRef
    }
  }
} as const

export const ASSISTANCE_EXPLANATION_MODEL_OUTPUT_JSON_SCHEMA = {
  $id: 'assistance_explanation_model_output',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'summary',
    'signalSources',
    'appliedRuleRefs',
    'limitations'
  ],
  properties: {
    schemaVersion: {
      type: 'string',
      const: ASSISTANCE_EXPLANATION_SCHEMA_VERSION
    },
    summary: nonEmptyString(2_048),
    signalSources: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sourceKind', 'sourceRef', 'evidenceCodes'],
        properties: {
          sourceKind: {
            type: 'string',
            enum: [
              'deterministic-rule',
              'adapter-observation',
              'text-model',
              'vision-model',
              'embedding',
              'content-graph',
              'user-feedback'
            ]
          },
          sourceRef: nonEmptyString(256),
          evidenceCodes: {
            type: 'array',
            maxItems: 16,
            items: nonEmptyString(256)
          }
        }
      }
    },
    appliedRuleRefs: {
      type: 'array',
      maxItems: 32,
      items: nonEmptyString(256)
    },
    limitations: {
      type: 'array',
      maxItems: 16,
      items: nonEmptyString(1_024)
    }
  }
} as const
