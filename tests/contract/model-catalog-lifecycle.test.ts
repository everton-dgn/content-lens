import { describe, expect, it } from 'vitest'

import { ModelCatalog } from '@/ai/models/catalog'
import {
  type ModelDescriptor,
  modelCapabilitySchema,
  modelDescriptorSchema
} from '@/ai/models/contracts'

const checkedAt = '2026-07-31T00:00:00.000Z'

function descriptor(
  modelId: string,
  options: {
    catalogSource?: ModelDescriptor['catalogSource']
    source?: ModelDescriptor['capabilities'][number]['source']
    status?: ModelDescriptor['status']
  } = {}
): ModelDescriptor {
  return modelDescriptorSchema.parse({
    providerConfigId: 'provider:catalog',
    modelId,
    displayName: modelId,
    declaredVersion: '2026-07',
    executionKind: 'cloud',
    catalogSource: options.catalogSource ?? 'provider',
    lastCheckedAt: checkedAt,
    status: options.status ?? 'available',
    capabilities: [
      {
        task: 'classification-text',
        modalities: ['text'],
        languages: ['pt', 'en', 'es'],
        imageMimeTypes: [],
        maxInputBytes: 64_000,
        maxOutputBytes: 8_000,
        structuredOutput: true,
        evidence: 'declared',
        source: options.source ?? 'provider',
        verifiedAt: null
      }
    ]
  })
}

describe('model catalog lifecycle', () => {
  it('rejects wildcard image MIME and vision without an image modality', () => {
    const base = descriptor('vision')

    expect(
      modelDescriptorSchema.safeParse({
        ...base,
        capabilities: [
          {
            ...base.capabilities[0],
            task: 'classification-vision',
            modalities: ['text', 'image'],
            imageMimeTypes: ['*/*']
          }
        ]
      }).success
    ).toBe(false)
    expect(
      modelDescriptorSchema.safeParse({
        ...base,
        capabilities: [
          {
            ...base.capabilities[0],
            task: 'classification-vision',
            modalities: ['text']
          }
        ]
      }).success
    ).toBe(false)
  })

  it('synchronizes provider discovery as declared and retains removed models as unavailable', () => {
    const catalog = new ModelCatalog()
    const discovered = catalog.synchronizeProviderModels(
      'provider:catalog',
      [
        {
          ...descriptor('remote'),
          capabilities: [
            {
              ...descriptor('remote').capabilities[0],
              evidence: 'benchmark-accepted',
              source: 'user',
              verifiedAt: checkedAt
            }
          ]
        }
      ],
      checkedAt
    )

    expect(discovered).toHaveLength(1)
    expect(discovered[0]).toMatchObject({
      catalogSource: 'provider',
      lastCheckedAt: checkedAt,
      status: 'available',
      capabilities: [
        {
          evidence: 'declared',
          source: 'provider',
          verifiedAt: null
        }
      ]
    })

    catalog.synchronizeProviderModels(
      'provider:catalog',
      [],
      '2026-07-31T01:00:00.000Z'
    )
    expect(
      catalog.get({
        providerConfigId: 'provider:catalog',
        modelId: 'remote'
      })
    ).toMatchObject({
      status: 'unavailable',
      lastCheckedAt: '2026-07-31T01:00:00.000Z'
    })
    expect(
      catalog.supports(
        {
          providerConfigId: 'provider:catalog',
          modelId: 'remote'
        },
        'classification-text'
      )
    ).toBe(false)
  })

  it('requires explicit route migration before changing a referenced manual model key', () => {
    const catalog = new ModelCatalog([
      descriptor('manual', {
        catalogSource: 'user',
        source: 'user'
      })
    ])
    const current = {
      providerConfigId: 'provider:catalog',
      modelId: 'manual'
    }

    expect(() =>
      catalog.updateManualModel(current, descriptor('renamed'), {
        referencedByActiveRoute: true
      })
    ).toThrow('model-route-migration-required')
    expect(catalog.get(current)).toBeDefined()
    expect(
      catalog.get({
        providerConfigId: 'provider:catalog',
        modelId: 'renamed'
      })
    ).toBeUndefined()
  })

  it('returns a task summary without model identifiers or provider secrets', () => {
    const catalog = new ModelCatalog([
      descriptor('available'),
      descriptor('unavailable', { status: 'unavailable' })
    ])

    const summary = catalog.summarizeTaskEligibility('classification-text')

    expect(summary).toEqual({
      task: 'classification-text',
      available: 1,
      unavailable: 1,
      invalid: 0,
      byExecutionKind: {
        local: 0,
        browser: 0,
        cloud: 1
      }
    })
    expect(JSON.stringify(summary)).not.toContain('provider:catalog')
    expect(JSON.stringify(summary)).not.toContain('available/')
  })

  it('rejects a duplicated reference and enforces the source on upserts', () => {
    expect(
      () => new ModelCatalog([descriptor('dup'), descriptor('dup')])
    ).toThrow('Duplicate model reference')

    const catalog = new ModelCatalog()
    expect(() =>
      catalog.upsertBuiltIn(
        descriptor('not-builtin', { catalogSource: 'user' })
      )
    ).toThrow('built-in-model-source-required')
    expect(() =>
      catalog.upsertUser(descriptor('not-user', { catalogSource: 'built-in' }))
    ).toThrow('user-model-source-required')
  })

  it('answers capability lookups without leaking internals', () => {
    const catalog = new ModelCatalog([descriptor('probe')])
    const reference = {
      providerConfigId: 'provider:catalog',
      modelId: 'probe'
    }

    expect(
      catalog.capability(
        { ...reference, modelId: 'missing' },
        'classification-text'
      )
    ).toBeUndefined()
    expect(
      catalog.capability(reference, 'classification-vision')
    ).toBeUndefined()
    const capability = catalog.capability(reference, 'classification-text')
    expect(capability).toBeDefined()
    if (!capability) {
      throw new Error('capability lookup should have matched')
    }
    const mutated = {
      ...capability,
      languages: [...capability.languages, 'fr']
    }
    expect(mutated.languages).toContain('fr')
    expect(
      modelCapabilitySchema.parse(
        catalog.capability(reference, 'classification-text')
      ).languages
    ).not.toContain('fr')
  })

  it('rejects synchronization that points at another provider or clobbers a user model', () => {
    const catalog = new ModelCatalog()

    expect(() =>
      catalog.synchronizeProviderModels(
        'provider:other',
        [descriptor('remote')],
        checkedAt
      )
    ).toThrow('model-provider-mismatch')

    catalog.upsertUser(descriptor('owned', { catalogSource: 'user' }))
    expect(() =>
      catalog.synchronizeProviderModels(
        'provider:catalog',
        [descriptor('owned')],
        checkedAt
      )
    ).toThrow('model-source-conflict')
  })

  it('rejects a rename that lands on an existing reference', () => {
    const catalog = new ModelCatalog([
      descriptor('manual', { catalogSource: 'user', source: 'user' }),
      descriptor('taken', { catalogSource: 'user', source: 'user' })
    ])

    expect(() =>
      catalog.updateManualModel(
        { providerConfigId: 'provider:catalog', modelId: 'manual' },
        descriptor('taken'),
        { referencedByActiveRoute: false }
      )
    ).toThrow('duplicate-model-reference')
  })
})
