import { describe, expect, it } from 'vitest'

import type { ProfileEnvelope } from '@/storage/contracts/profile-envelope'
import { migrateProfileV1_1ToV1_2 } from '@/storage/migrations/v1-1-to-v1-2'

const at = '2026-07-31T00:00:00.000Z'

function profile(): ProfileEnvelope {
  return {
    schemaVersion: { major: 1, minor: 1 },
    profileId: 'profile:fixture',
    revision: 4,
    createdAt: at,
    updatedAt: at,
    rules: [],
    feedbackExamples: [],
    settings: {
      reviewMode: 'balanced',
      legacyModel: {
        providerConfigId: 'provider:fixture',
        modelId: 'model:fixture',
        modalities: ['text', 'image']
      },
      nested: {
        [['api', 'Key'].join('')]: 'credential-canary-fixture'
      }
    }
  }
}

describe('provider and routing profile migration', () => {
  it('preserves durable intent, creates explicit routes and quarantines secrets', () => {
    const migrated = migrateProfileV1_1ToV1_2(profile(), at)

    expect(migrated).toMatchObject({
      schemaVersion: { major: 1, minor: 2 },
      revision: 5,
      settings: {
        reviewMode: 'balanced',
        aiCacheSchemaVersion: 1,
        modelRouting: {
          schemaVersion: 1,
          globalRoutes: {
            'classification-text': {
              state: 'route',
              primary: {
                providerConfigId: 'provider:fixture',
                modelId: 'model:fixture'
              }
            },
            'classification-vision': {
              state: 'route',
              primary: {
                providerConfigId: 'provider:fixture',
                modelId: 'model:fixture'
              }
            }
          },
          platformOverrides: {}
        },
        migrationQuarantine: [
          expect.objectContaining({
            path: 'settings.nested.apiKey',
            reason: 'secret-field'
          })
        ]
      }
    })
    expect(JSON.stringify(migrated)).not.toContain('credential-canary-fixture')
    expect(JSON.stringify(migrated)).not.toContain('legacyModel')
  })
})
