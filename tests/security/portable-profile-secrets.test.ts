import { describe, expect, it } from 'vitest'

import { parseProfileEnvelope } from '@/storage/contracts/profile-envelope'

const at = '2026-07-31T00:00:00.000Z'

function profile(settings: Record<string, unknown>) {
  return {
    schemaVersion: { major: 1, minor: 2 },
    profileId: 'profile:secret-boundary',
    revision: 1,
    createdAt: at,
    updatedAt: at,
    rules: [],
    feedbackExamples: [],
    settings
  }
}

describe('portable profile secret boundary', () => {
  it.each([
    ['api', 'Key'].join(''),
    'authorization',
    'credential',
    'password',
    'secret',
    'token'
  ])('rejects nested secret field %s', field => {
    expect(
      parseProfileEnvelope(
        profile({
          nested: {
            deeper: {
              [field]: 'credential-canary-fixture'
            }
          }
        })
      )
    ).toMatchObject({
      success: false,
      code: 'secret-field-forbidden'
    })
  })

  it('allows opaque non-secret provider references', () => {
    expect(
      parseProfileEnvelope(
        profile({
          providerConfigId: 'provider:fixture',
          credentialRef: 'credential:opaque-reference'
        })
      )
    ).toMatchObject({ success: true })
  })
})
