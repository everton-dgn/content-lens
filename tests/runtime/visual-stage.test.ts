import { describe, expect, it, vi } from 'vitest'

import {
  CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION,
  type ClassificationModelOutput
} from '@/ai/classification/model-output'
import { ModelCatalog } from '@/ai/models/catalog'
import { ConsentRepository } from '@/ai/providers/consent'
import { normalizeConsentKey } from '@/ai/providers/contracts'
import { ProviderRegistry } from '@/ai/providers/registry'
import { VisualModelFailure } from '@/ai/vision/classifier'
import { createRoutedVisualStage } from '@/application/decision-pipeline/visual-stage'
import type { ContentItem } from '@/core/content/contracts'
import { createDefaultSettings } from '@/core/settings'
import { CredentialVault } from '@/security/credentials/vault'

const at = '2026-07-31T09:30:00.000Z'
const providerConfigId = 'provider:vision'
const endpointOrigin = 'https://vision.example'

const item: ContentItem = {
  id: 'youtube:video:visual-stage',
  platform: 'youtube',
  identity: {
    status: 'stable',
    platformContentId: 'visual-stage'
  },
  surface: 'youtube:home',
  title: 'Visual stage fixture',
  body: 'A bounded text companion.',
  media: [
    {
      kind: 'thumbnail',
      url: 'https://www.youtube.com/thumbnail.png?private=tracking'
    }
  ],
  observedAt: at,
  language: 'en',
  context: {}
}

const modelOutput: ClassificationModelOutput = {
  schemaVersion: CLASSIFICATION_MODEL_OUTPUT_SCHEMA_VERSION,
  topics: [],
  archetypes: [
    {
      archetypeId: 'visual-clickbait',
      score: 0.9,
      evidenceRefs: []
    }
  ],
  quality: { clickbait: 0.9 },
  semanticRuleMatches: [],
  evidence: [],
  confidence: 0.91,
  abstention: null
}

function runtime(input: {
  execution?: 'local' | 'cloud'
  task?: 'classification-text' | 'classification-vision'
  consent?: boolean
  maxInputBytes?: number
}) {
  const execution = input.execution ?? 'local'
  const task = input.task ?? 'classification-vision'
  const provider = {
    schemaVersion: 1 as const,
    providerConfigId,
    displayName: 'Vision fixture',
    kind: 'openai-compatible' as const,
    execution,
    endpointOrigin:
      execution === 'local' ? 'http://127.0.0.1:11434' : endpointOrigin,
    credentialMode: 'none' as const,
    credentialRef: null,
    policyUrl: execution === 'cloud' ? `${endpointOrigin}/privacy` : null,
    policyReviewedAt: execution === 'cloud' ? at : null,
    createdAt: at,
    updatedAt: at,
    status: 'ready' as const
  }
  const consents =
    execution === 'cloud' && input.consent
      ? new ConsentRepository([
          {
            key: normalizeConsentKey({
              providerConfigId,
              endpointOrigin,
              task: 'classification-vision',
              platform: 'youtube',
              categories: ['title', 'body', 'image'],
              includeImages: true,
              consentSchemaVersion: 1
            }),
            providerKind: 'openai-compatible',
            policyUrl: `${endpointOrigin}/privacy`,
            policyReviewedAt: at,
            estimatedFrequency: 'Per unresolved visible item',
            declaredRetention: 'Provider policy',
            consentedAt: at
          }
        ])
      : new ConsentRepository()

  return {
    providers: new ProviderRegistry([provider]),
    catalog: new ModelCatalog([
      {
        providerConfigId,
        modelId: 'vision-model',
        displayName: 'Vision model',
        declaredVersion: 'vision-model@1',
        executionKind: execution,
        catalogSource: 'user',
        lastCheckedAt: at,
        status: 'available',
        ...(execution === 'cloud'
          ? {
              pricing: {
                currency: 'USD',
                unit: 'per-1m-tokens',
                inputPrice: 1,
                outputPrice: 2,
                verifiedAt: at,
                version: 'price@1',
                sourceUrl: `${endpointOrigin}/pricing`
              }
            }
          : {}),
        capabilities: [
          {
            task,
            modalities:
              task === 'classification-vision'
                ? (['text', 'image'] as const)
                : (['text'] as const),
            languages: ['en'],
            imageMimeTypes:
              task === 'classification-vision' ? ['image/png'] : [],
            maxInputBytes: input.maxInputBytes ?? 5 * 1024 * 1024,
            maxOutputBytes: 16_384,
            structuredOutput: true,
            evidence: 'probe-verified',
            source: 'user',
            verifiedAt: at
          }
        ]
      }
    ]),
    consents,
    vault: new CredentialVault()
  }
}

function settings(
  fallbacks: Array<{ providerConfigId: string; modelId: string }> = []
) {
  const value = createDefaultSettings()
  value.routing.globalRoutes['classification-vision'] = {
    state: 'route',
    primary: { providerConfigId, modelId: 'vision-model' },
    fallbacks,
    allowCloudFallback: false,
    allowHigherCostFallback: false
  }
  return value
}

function mediaPorts() {
  return {
    allowedOrigins: vi.fn(() => ['https://www.youtube.com']),
    hasPermission: vi.fn(async () => true),
    resolve: vi.fn(async () => ({
      bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      declaredMimeType: 'image/png',
      width: 640,
      height: 360
    })),
    minimize: vi.fn(async media => ({
      ...media,
      width: 640,
      height: 360,
      fingerprint: 'sha256:minimized'
    }))
  }
}

const input = {
  item,
  semanticRules: [],
  profileRevision: 3,
  pageInstanceId: 'page:visual-stage',
  settings: settings(),
  signal: new AbortController().signal
}

describe('routed visual stage', () => {
  it('fails open for cancellation, unreadable provider state and a missing provider', async () => {
    const aborted = new AbortController()
    aborted.abort()
    const unavailable = createRoutedVisualStage({
      runtime: Promise.resolve(undefined),
      permissions: { has: vi.fn(async () => true) },
      media: mediaPorts()
    })
    await expect(
      unavailable.classify({ ...input, signal: aborted.signal })
    ).resolves.toMatchObject({
      state: 'abstained',
      abstention: { code: 'cancelled' }
    })
    await expect(unavailable.classify(input)).resolves.toMatchObject({
      state: 'abstained',
      abstention: {
        code: 'provider-unavailable',
        detailCode: 'provider-state-unreadable'
      }
    })

    const missing = runtime({})
    missing.providers.remove(providerConfigId)
    const missingProvider = createRoutedVisualStage({
      runtime: missing,
      permissions: { has: vi.fn(async () => true) },
      media: mediaPorts()
    })
    await expect(missingProvider.classify(input)).resolves.toMatchObject({
      state: 'abstained',
      abstention: { detailCode: 'provider-not-found' }
    })
  })

  it('performs zero media access when the visual route is disabled', async () => {
    const media = mediaPorts()
    const disabled = createDefaultSettings()
    const stage = createRoutedVisualStage({
      runtime: Promise.resolve(runtime({})),
      permissions: { has: vi.fn(async () => true) },
      media,
      createModelPort: vi.fn(),
      now: () => new Date(at)
    })

    await expect(
      stage.classify({ ...input, settings: disabled })
    ).resolves.toEqual({
      state: 'abstained',
      abstention: {
        code: 'provider-unavailable',
        detailCode: 'route-disabled'
      }
    })
    expect(media.allowedOrigins).not.toHaveBeenCalled()
    expect(media.resolve).not.toHaveBeenCalled()
    expect(media.minimize).not.toHaveBeenCalled()
  })

  it('performs zero media access for a text-only model', async () => {
    const media = mediaPorts()
    const stage = createRoutedVisualStage({
      runtime: Promise.resolve(runtime({ task: 'classification-text' })),
      permissions: { has: vi.fn(async () => true) },
      media,
      createModelPort: vi.fn(),
      now: () => new Date(at)
    })

    await expect(stage.classify(input)).resolves.toEqual({
      state: 'abstained',
      abstention: {
        code: 'unsupported-media',
        detailCode: 'unsupported-modality'
      }
    })
    expect(media.resolve).not.toHaveBeenCalled()
    expect(media.minimize).not.toHaveBeenCalled()
  })

  it('checks exact image consent before resolving cloud media', async () => {
    const media = mediaPorts()
    const stage = createRoutedVisualStage({
      runtime: Promise.resolve(runtime({ execution: 'cloud', consent: false })),
      permissions: { has: vi.fn(async () => true) },
      media,
      createModelPort: vi.fn(),
      now: () => new Date(at)
    })

    await expect(stage.classify(input)).resolves.toEqual({
      state: 'abstained',
      abstention: {
        code: 'provider-unavailable',
        detailCode: 'consent-missing'
      }
    })
    expect(media.resolve).not.toHaveBeenCalled()
  })

  it('minimizes one allowlisted image and returns validated visual signals', async () => {
    const media = mediaPorts()
    const classify = vi.fn(async () => modelOutput)
    const stage = createRoutedVisualStage({
      runtime: Promise.resolve(runtime({})),
      permissions: { has: vi.fn(async () => true) },
      media,
      createModelPort: vi.fn(() => ({ classify })),
      now: () => new Date(at),
      hash: vi
        .fn()
        .mockResolvedValueOnce('sha256:resolved')
        .mockResolvedValueOnce('sha256:minimized')
    })

    const result = await stage.classify(input)

    expect(result).toMatchObject({
      state: 'signals',
      signals: {
        provenance: {
          sourceKind: 'vision-model',
          inputFingerprint: expect.any(String),
          scope: { task: 'classification-vision' }
        }
      }
    })
    expect(media.resolve).toHaveBeenCalledOnce()
    expect(media.resolve).toHaveBeenCalledWith(
      item.media[0],
      expect.objectContaining({
        allowedOrigins: ['https://www.youtube.com'],
        signal: input.signal
      })
    )
    expect(media.minimize).toHaveBeenCalledOnce()
    expect(classify).toHaveBeenCalledWith(
      expect.objectContaining({
        image: expect.objectContaining({
          mimeType: 'image/png',
          fingerprint: 'sha256:minimized'
        })
      })
    )
    expect(JSON.stringify(classify.mock.calls[0])).not.toContain('private')
    expect(JSON.stringify(classify.mock.calls[0])).not.toContain('tracking')
  })

  it('fails open before fetch when the exposed media origin is not allowlisted', async () => {
    const media = mediaPorts()
    media.allowedOrigins.mockReturnValue(['https://safe.example'])
    const stage = createRoutedVisualStage({
      runtime: Promise.resolve(runtime({})),
      permissions: { has: vi.fn(async () => true) },
      media,
      createModelPort: vi.fn(),
      now: () => new Date(at)
    })

    await expect(stage.classify(input)).resolves.toEqual({
      state: 'abstained',
      abstention: {
        code: 'unsupported-media',
        detailCode: 'media-origin'
      }
    })
    expect(media.resolve).not.toHaveBeenCalled()
  })

  it('rejects malformed media URLs and missing media host permission before fetch', async () => {
    const firstMedia = item.media[0]
    if (!firstMedia) throw new Error('Visual fixture media is missing')
    const malformed = createRoutedVisualStage({
      runtime: runtime({}),
      permissions: { has: vi.fn(async () => true) },
      media: mediaPorts()
    })
    await expect(
      malformed.classify({
        ...input,
        item: {
          ...item,
          media: [{ ...firstMedia, url: 'not-a-url' }]
        }
      })
    ).resolves.toMatchObject({
      state: 'abstained',
      abstention: { detailCode: 'media-url' }
    })

    const media = mediaPorts()
    media.hasPermission.mockResolvedValue(false)
    const denied = createRoutedVisualStage({
      runtime: runtime({}),
      permissions: { has: vi.fn(async () => true) },
      media
    })
    await expect(denied.classify(input)).resolves.toMatchObject({
      state: 'abstained',
      abstention: { detailCode: 'media-permission-missing' }
    })
    expect(media.resolve).not.toHaveBeenCalled()
  })

  it('contains media resolver and minimizer failures, including cancellation', async () => {
    for (const scenario of [
      { phase: 'resolve', aborted: false, detailCode: 'media-resolve' },
      { phase: 'minimize', aborted: false, detailCode: 'media-minimize' },
      { phase: 'resolve', aborted: true, detailCode: undefined },
      { phase: 'minimize', aborted: true, detailCode: undefined }
    ] as const) {
      const controller = new AbortController()
      const media = mediaPorts()
      if (scenario.phase === 'resolve') {
        media.resolve.mockImplementation(async () => {
          if (scenario.aborted) controller.abort()
          throw new Error('media failure')
        })
      } else {
        media.minimize.mockImplementation(async () => {
          if (scenario.aborted) controller.abort()
          throw new Error('media failure')
        })
      }
      const stage = createRoutedVisualStage({
        runtime: runtime({}),
        permissions: { has: vi.fn(async () => true) },
        media,
        hash: vi.fn(async () => 'sha256:fixture')
      })
      await expect(
        stage.classify({ ...input, signal: controller.signal })
      ).resolves.toMatchObject({
        state: 'abstained',
        abstention: scenario.aborted
          ? { code: 'cancelled' }
          : { code: 'unsupported-media', detailCode: scenario.detailCode }
      })
    }
  })

  it('rejects a minimized image that still exceeds the safe edge', async () => {
    const media = mediaPorts()
    media.minimize.mockResolvedValue({
      bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      mimeType: 'image/png',
      width: 1_025,
      height: 640,
      fingerprint: 'sha256:oversized'
    })
    const stage = createRoutedVisualStage({
      runtime: runtime({}),
      permissions: { has: vi.fn(async () => true) },
      media,
      hash: vi.fn(async () => 'sha256:fixture')
    })
    await expect(stage.classify(input)).resolves.toMatchObject({
      state: 'abstained',
      abstention: { code: 'resource-limit', detailCode: 'minimized-edge' }
    })
  })

  it('reuses only compatible cached signals and tolerates cache failures', async () => {
    const cached = new Map<string, unknown>()
    const cache = {
      read: vi.fn(async (id: string) => cached.get(id)),
      write: vi.fn(async (entry: { id: string; value: unknown }) => {
        cached.set(entry.id, entry.value)
      })
    }
    const classify = vi.fn(async () => modelOutput)
    const stage = createRoutedVisualStage({
      runtime: runtime({}),
      permissions: { has: vi.fn(async () => true) },
      media: mediaPorts(),
      createModelPort: vi.fn(() => ({ classify })),
      cache,
      candidates: () => ({
        topicIds: [],
        archetypeIds: ['visual-clickbait'],
        evidenceCodes: []
      }),
      hash: vi.fn(async bytes => `sha256:${bytes.byteLength}`),
      now: () => new Date(at)
    })

    await expect(stage.classify(input)).resolves.toMatchObject({
      state: 'signals'
    })
    await expect(stage.classify(input)).resolves.toMatchObject({
      state: 'signals'
    })
    expect(classify).toHaveBeenCalledOnce()
    expect(cache.write).toHaveBeenCalledOnce()

    cache.read.mockRejectedValueOnce(new Error('cache unavailable'))
    cache.write.mockRejectedValueOnce(new Error('cache unavailable'))
    await expect(stage.classify(input)).resolves.toMatchObject({
      state: 'signals'
    })
    expect(classify).toHaveBeenCalledTimes(2)
  })

  it('maps model failures to fail-open abstentions', async () => {
    for (const code of [
      'provider-unavailable',
      'timeout',
      'cost-limit',
      'unsupported-input',
      'invalid-output'
    ] as const) {
      const stage = createRoutedVisualStage({
        runtime: runtime({}),
        permissions: { has: vi.fn(async () => true) },
        media: mediaPorts(),
        createModelPort: vi.fn(() => ({
          classify: vi.fn(async () => {
            throw new VisualModelFailure(code)
          })
        })),
        hash: vi.fn(async () => 'sha256:fixture'),
        now: () => new Date(at)
      })
      await expect(stage.classify(input)).resolves.toMatchObject({
        state: 'abstained',
        abstention: { code }
      })
    }
  })

  it('abstains before media access when the content has no image', async () => {
    const media = mediaPorts()
    const stage = createRoutedVisualStage({
      runtime: runtime({}),
      permissions: { has: vi.fn(async () => true) },
      media
    })

    await expect(
      stage.classify({
        ...input,
        item: { ...item, media: [] }
      })
    ).resolves.toMatchObject({
      state: 'abstained',
      abstention: { code: 'unsupported-media', detailCode: 'image-missing' }
    })
    expect(media.resolve).not.toHaveBeenCalled()
  })

  it('contains invalid media at both preflight boundaries', async () => {
    const unresolved = mediaPorts()
    unresolved.resolve.mockResolvedValue({
      bytes: new Uint8Array(),
      declaredMimeType: 'image/png',
      width: 640,
      height: 360
    })
    const first = createRoutedVisualStage({
      runtime: runtime({}),
      permissions: { has: vi.fn(async () => true) },
      media: unresolved,
      hash: vi.fn(async () => 'sha256:unused')
    })
    await expect(first.classify(input)).resolves.toMatchObject({
      state: 'abstained',
      abstention: { detailCode: 'empty-image' }
    })
    expect(unresolved.minimize).not.toHaveBeenCalled()

    const invalidMinimized = mediaPorts()
    invalidMinimized.minimize.mockResolvedValue({
      bytes: new Uint8Array(),
      mimeType: 'image/png',
      width: 640,
      height: 360,
      fingerprint: 'sha256:empty'
    })
    const final = createRoutedVisualStage({
      runtime: runtime({}),
      permissions: { has: vi.fn(async () => true) },
      media: invalidMinimized,
      hash: vi.fn(async () => 'sha256:fixture')
    })
    await expect(final.classify(input)).resolves.toMatchObject({
      state: 'abstained',
      abstention: { detailCode: 'empty-image' }
    })
  })

  it('abstains when image bytes leave no bounded room for visual input', async () => {
    const stage = createRoutedVisualStage({
      runtime: runtime({ maxInputBytes: 8 }),
      permissions: { has: vi.fn(async () => true) },
      media: mediaPorts(),
      hash: vi.fn(async () => 'sha256:fixture')
    })

    await expect(stage.classify(input)).resolves.toMatchObject({
      state: 'abstained',
      abstention: {
        code: 'resource-limit',
        detailCode: 'visual-input-bytes'
      }
    })
  })

  it('advances from a temporary primary failure to an explicit fallback', async () => {
    const environment = runtime({})
    const primary = environment.catalog.get({
      providerConfigId,
      modelId: 'vision-model'
    })
    if (!primary) {
      throw new Error('Primary visual model is missing')
    }
    environment.catalog.upsertUser({
      ...primary,
      modelId: 'vision-fallback',
      displayName: 'Vision fallback',
      declaredVersion: 'vision-fallback@1'
    })
    const createModelPort = vi.fn(({ modelId }: { modelId: string }) => ({
      classify: vi.fn(async () => {
        if (modelId === 'vision-model') {
          throw new VisualModelFailure('timeout')
        }
        return modelOutput
      })
    }))
    const stage = createRoutedVisualStage({
      runtime: environment,
      permissions: { has: vi.fn(async () => true) },
      media: mediaPorts(),
      createModelPort,
      hash: vi.fn(async () => 'sha256:fixture'),
      now: () => new Date(at)
    })

    await expect(
      stage.classify({
        ...input,
        settings: settings([{ providerConfigId, modelId: 'vision-fallback' }])
      })
    ).resolves.toMatchObject({ state: 'signals' })
    expect(createModelPort).toHaveBeenCalledTimes(2)
  })

  it('fails open when an explicit fallback loses its provider binding', async () => {
    const environment = runtime({})
    const primary = environment.catalog.get({
      providerConfigId,
      modelId: 'vision-model'
    })
    if (!primary) {
      throw new Error('Primary visual model is missing')
    }
    environment.catalog.upsertUser({
      ...primary,
      providerConfigId: 'provider:missing-vision',
      modelId: 'vision-missing',
      displayName: 'Missing visual fallback'
    })
    const stage = createRoutedVisualStage({
      runtime: environment,
      permissions: { has: vi.fn(async () => true) },
      media: mediaPorts(),
      createModelPort: vi.fn(() => ({
        classify: vi.fn(async () => {
          throw new VisualModelFailure('timeout')
        })
      })),
      hash: vi.fn(async () => 'sha256:fixture'),
      now: () => new Date(at)
    })

    await expect(
      stage.classify({
        ...input,
        settings: settings([
          {
            providerConfigId: 'provider:missing-vision',
            modelId: 'vision-missing'
          }
        ])
      })
    ).resolves.toMatchObject({
      state: 'abstained',
      abstention: { detailCode: 'fallback-not-configured' }
    })
  })
})
