import { describe, expect, it } from 'vitest'

import {
  consentKeyEquals,
  consentReceiptSchema,
  normalizeConsentKey,
  normalizeEndpointOrigin,
  providerDescriptorSchema
} from '@/ai/providers/contracts'
import { ProviderRegistry } from '@/ai/providers/registry'
import type { ConsentKey } from '@/security/credentials/contracts'

const now = '2026-07-31T00:00:00.000Z'

function provider() {
  return {
    schemaVersion: 1,
    providerConfigId: 'provider:fixture',
    displayName: 'Fixture provider',
    kind: 'openai-compatible' as const,
    execution: 'cloud' as const,
    endpointOrigin: 'https://provider.example',
    credentialMode: 'session-only' as const,
    credentialRef: 'credential:fixture',
    policyUrl: 'https://provider.example/privacy',
    policyReviewedAt: now,
    createdAt: now,
    updatedAt: now,
    status: 'ready' as const
  }
}

describe('provider and consent contracts', () => {
  it('normalizes allowed endpoints and rejects unsafe origins', () => {
    const loopback = ['http://', '127', '.0.0.1:11434'].join('')
    const privateNetwork = ['http://', '192', '.168.1.50:11434'].join('')
    const userInfo = ['https', '://user', '@provider.example'].join('')
    const query = ['https://provider.example', '?tenant=1'].join('')

    expect(
      normalizeEndpointOrigin('https://provider.example:443/', 'cloud')
    ).toBe('https://provider.example')
    expect(normalizeEndpointOrigin(loopback, 'local')).toBe(loopback)
    expect(() => normalizeEndpointOrigin(privateNetwork, 'local')).toThrow(
      /endpoint/i
    )
    expect(() => normalizeEndpointOrigin(userInfo, 'cloud')).toThrow(
      /endpoint/i
    )
    expect(() => normalizeEndpointOrigin(query, 'cloud')).toThrow(/endpoint/i)
  })

  it('validates a secret-free provider descriptor', () => {
    expect(providerDescriptorSchema.parse(provider())).toEqual(provider())
    expect(
      providerDescriptorSchema.safeParse({
        ...provider(),
        [['api', 'Key'].join('')]: ['must', 'be', 'rejected'].join('-')
      }).success
    ).toBe(false)
  })

  it('uses all seven consent key fields with canonical categories', () => {
    const key = normalizeConsentKey({
      providerConfigId: 'provider:fixture',
      endpointOrigin: 'https://provider.example',
      task: 'classification-vision',
      platform: 'reddit',
      categories: ['image', 'title', 'image'],
      includeImages: true,
      consentSchemaVersion: 1
    })
    const receipt = consentReceiptSchema.parse({
      key,
      providerKind: 'openai-compatible',
      policyUrl: 'https://provider.example/privacy',
      policyReviewedAt: now,
      estimatedFrequency: 'per visible item',
      declaredRetention: 'none',
      consentedAt: now
    })

    expect(receipt.key.categories).toEqual(['title', 'image'])
    expect(consentKeyEquals(receipt.key, { ...receipt.key })).toBe(true)
    expect(
      consentKeyEquals(receipt.key, {
        ...receipt.key,
        includeImages: false
      })
    ).toBe(false)
    expect(
      consentKeyEquals(receipt.key, {
        ...receipt.key,
        platform: 'youtube'
      })
    ).toBe(false)

    const changedFields: ConsentKey[] = [
      { ...receipt.key, providerConfigId: 'provider:other' },
      { ...receipt.key, endpointOrigin: 'https://other-provider.example' },
      { ...receipt.key, task: 'classification-text' },
      { ...receipt.key, platform: 'youtube' },
      { ...receipt.key, categories: ['title'] },
      { ...receipt.key, includeImages: false },
      {
        ...receipt.key,
        consentSchemaVersion: 2
      } as unknown as ConsentKey
    ]
    expect(
      changedFields.map(candidate => consentKeyEquals(receipt.key, candidate))
    ).toEqual([false, false, false, false, false, false, false])
  })

  it('locks changed endpoints without transferring credential state', () => {
    const registry = new ProviderRegistry([provider()])
    const rebound = registry.rebindEndpoint(
      'provider:fixture',
      'https://other-provider.example',
      now
    )

    expect(rebound).toMatchObject({
      endpointOrigin: 'https://other-provider.example',
      status: 'locked',
      credentialRef: null
    })
    expect(registry.get('provider:fixture')).toEqual(rebound)
    expect(provider()).toMatchObject({
      endpointOrigin: 'https://provider.example',
      credentialRef: 'credential:fixture'
    })
  })
})
