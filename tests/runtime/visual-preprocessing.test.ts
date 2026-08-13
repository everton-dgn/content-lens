import { describe, expect, it } from 'vitest'

import {
  prepareVisualInput,
  visualDataCategories
} from '@/ai/vision/preprocessing'
import type { ContentItem } from '@/core/content/contracts'
import type { SemanticRule } from '@/core/rules/contracts/rule'

const at = '2026-07-31T12:00:00.000Z'

function item(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: 'youtube:video:visual-preprocessing',
    platform: 'youtube',
    identity: {
      status: 'stable',
      platformContentId: 'visual-preprocessing'
    },
    surface: 'youtube:home',
    title: '  A useful title  ',
    body: 'A detailed body',
    language: 'pt-BR',
    media: [
      {
        kind: 'thumbnail',
        url: 'https://i.ytimg.com/vi/visual-preprocessing/hqdefault.jpg'
      }
    ],
    observedAt: at,
    context: {},
    ...overrides
  }
}

function semanticRule(overrides: Partial<SemanticRule> = {}): SemanticRule {
  return {
    id: 'rule:visual',
    enabled: true,
    kind: 'semantic',
    effect: 'reduce',
    scope: {},
    description: 'Reduce low-signal thumbnails',
    examples: ['Sensational thumbnail'],
    exclusions: ['Documentary analysis'],
    threshold: 0.8,
    createdAt: at,
    updatedAt: at,
    ...overrides
  }
}

const image = {
  bytes: new Uint8Array([1, 2, 3, 4]),
  mimeType: 'image/jpeg' as const,
  width: 320,
  height: 180,
  fingerprint: 'sha256:image'
}

describe('visual input preprocessing', () => {
  it('reports only the categories that will cross the selected model boundary', () => {
    expect(
      visualDataCategories({ item: item(), semanticRules: [semanticRule()] })
    ).toEqual(['title', 'body', 'rule', 'examples', 'exclusions', 'image'])
    expect(
      visualDataCategories({
        item: item({ title: ' ', body: ' ' }),
        semanticRules: []
      })
    ).toEqual(['image'])
  })

  it.each([
    ['pt', 'pt_BR'],
    ['pt_BR', 'pt_BR'],
    ['en-US', 'en'],
    ['es-MX', 'es'],
    ['de', 'unknown'],
    [undefined, 'unknown']
  ] as const)('normalizes language %s to %s', async (language, expected) => {
    const result = await prepareVisualInput({
      item: item({ language }),
      pageInstanceId: 'page:visual',
      profileRevision: 7,
      semanticRules: [semanticRule()],
      image,
      maxInputBytes: 64 * 1024,
      candidateTopicIds: ['topic:news', 'topic:news'],
      candidateArchetypeIds: ['archetype:clickbait', 'archetype:clickbait'],
      candidateEvidenceCodes: ['visual-match', 'visual-match']
    })

    expect(result.state).toBe('ready')
    if (result.state !== 'ready') throw new Error('Expected ready visual input')
    expect(result.prepared.binding).toEqual({
      contentId: 'youtube:video:visual-preprocessing',
      pageInstanceId: 'page:visual',
      platform: 'youtube',
      surface: 'youtube:home',
      profileRevision: 7
    })
    expect(result.prepared.input.language).toBe(expected)
    expect(result.prepared.input.candidateTopicIds).toEqual(['topic:news'])
    expect(result.prepared.input.candidateArchetypeIds).toEqual([
      'archetype:clickbait'
    ])
    expect(result.prepared.input.candidateEvidenceCodes).toEqual([
      'visual-match'
    ])
    expect(result.prepared.inputFingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('trims the body until text and image fit the route byte budget', async () => {
    const result = await prepareVisualInput({
      item: item({ body: 'body '.repeat(2_000) }),
      pageInstanceId: 'page:visual',
      profileRevision: 1,
      semanticRules: [],
      image,
      maxInputBytes: 900,
      candidateTopicIds: [],
      candidateArchetypeIds: [],
      candidateEvidenceCodes: []
    })

    expect(result.state).toBe('ready')
    if (result.state !== 'ready')
      throw new Error('Expected fitted visual input')
    expect(result.prepared.input.body?.length).toBeLessThan(10_000)
    expect(result.prepared.inputBytes).toBeLessThanOrEqual(900)
  })

  it('abstains when the image consumes the budget or fixed metadata cannot fit', async () => {
    const common = {
      item: item(),
      pageInstanceId: 'page:visual',
      profileRevision: 1,
      semanticRules: [] as SemanticRule[],
      image,
      candidateTopicIds: [] as string[],
      candidateArchetypeIds: [] as string[],
      candidateEvidenceCodes: [] as string[]
    }
    await expect(
      prepareVisualInput({ ...common, maxInputBytes: image.bytes.byteLength })
    ).resolves.toEqual({
      state: 'abstained',
      abstention: { code: 'resource-limit', detailCode: 'visual-input-bytes' }
    })
    await expect(
      prepareVisualInput({
        ...common,
        maxInputBytes: image.bytes.byteLength + 1
      })
    ).resolves.toEqual({
      state: 'abstained',
      abstention: { code: 'resource-limit', detailCode: 'visual-input-bytes' }
    })
  })

  it('rejects schema-invalid image metadata after fitting', async () => {
    await expect(
      prepareVisualInput({
        item: item(),
        pageInstanceId: 'page:visual',
        profileRevision: 1,
        semanticRules: [],
        image: { ...image, width: 2_000 },
        maxInputBytes: 64 * 1024,
        candidateTopicIds: [],
        candidateArchetypeIds: [],
        candidateEvidenceCodes: []
      })
    ).resolves.toEqual({
      state: 'abstained',
      abstention: { code: 'unsupported-input', detailCode: 'visual-input' }
    })
  })
})
