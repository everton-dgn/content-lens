import {
  DATA_CATEGORY_VALUES,
  type DataCategory
} from '@/ai/providers/contracts'
import {
  type MinimizedImage,
  type ReadyVisualInput,
  type VisualBinding,
  type VisualClassificationInput,
  visualClassificationInputSchema
} from '@/ai/vision/contracts'
import type { ContentItem } from '@/core/content/contracts'
import type { ClassificationSignals } from '@/core/decisions/signals'
import { fingerprintPortableValue } from '@/core/operations/fingerprint'
import type { SemanticRule } from '@/core/rules/contracts/rule'

type VisualAbstention = NonNullable<ClassificationSignals['abstention']>

const encoder = new TextEncoder()

function bytes(value: unknown) {
  return encoder.encode(JSON.stringify(value)).byteLength
}

function normalizedLanguage(value: string | undefined) {
  const normalized = value?.trim().replace('-', '_').toLowerCase()
  if (normalized === 'pt' || normalized === 'pt_br') {
    return 'pt_BR'
  }
  if (normalized === 'en' || normalized?.startsWith('en_')) {
    return 'en'
  }
  if (normalized === 'es' || normalized?.startsWith('es_')) {
    return 'es'
  }
  return 'unknown'
}

function fitBody(candidate: VisualClassificationInput, maxTextBytes: number) {
  if (!candidate.body || bytes(candidate) <= maxTextBytes) {
    return
  }
  const characters = [...candidate.body]
  let low = 0
  let high = characters.length
  let best = 0
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    candidate.body = characters.slice(0, middle).join('')
    if (bytes(candidate) <= maxTextBytes) {
      best = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  if (best === 0) {
    delete candidate.body
  } else {
    candidate.body = characters.slice(0, best).join('')
  }
}

function categoriesFor(input: {
  title?: string
  body?: string
  semanticRules: readonly SemanticRule[]
}) {
  const categories = new Set<DataCategory>(['image'])
  if (input.title !== undefined) {
    categories.add('title')
  }
  if (input.body !== undefined) {
    categories.add('body')
  }
  if (input.semanticRules.length > 0) {
    categories.add('rule')
    if (input.semanticRules.some(rule => rule.examples.length > 0)) {
      categories.add('examples')
    }
    if (input.semanticRules.some(rule => rule.exclusions.length > 0)) {
      categories.add('exclusions')
    }
  }
  return DATA_CATEGORY_VALUES.filter(category => categories.has(category))
}

export function visualDataCategories(input: {
  item: ContentItem
  semanticRules: readonly SemanticRule[]
}) {
  return categoriesFor({
    title: input.item.title?.trim() || undefined,
    body: input.item.body?.trim() || undefined,
    semanticRules: input.semanticRules
  })
}

export async function prepareVisualInput(input: {
  item: ContentItem
  pageInstanceId: string
  profileRevision: number
  semanticRules: readonly SemanticRule[]
  image: MinimizedImage
  maxInputBytes: number
  candidateTopicIds: readonly string[]
  candidateArchetypeIds: readonly string[]
  candidateEvidenceCodes: readonly string[]
}): Promise<
  | { state: 'ready'; prepared: ReadyVisualInput }
  | { state: 'abstained'; abstention: VisualAbstention }
> {
  const binding: VisualBinding = {
    contentId: input.item.id,
    pageInstanceId: input.pageInstanceId,
    platform: input.item.platform,
    surface: input.item.surface,
    profileRevision: input.profileRevision
  }
  const candidate: VisualClassificationInput = {
    ...(input.item.title?.trim() ? { title: input.item.title.trim() } : {}),
    ...(input.item.body?.trim() ? { body: input.item.body.trim() } : {}),
    language: normalizedLanguage(input.item.language),
    semanticRules: input.semanticRules.map(rule => ({
      ruleId: rule.id,
      description: rule.description,
      examples: [...rule.examples],
      exclusions: [...rule.exclusions]
    })),
    candidateTopicIds: [...new Set(input.candidateTopicIds)],
    candidateArchetypeIds: [...new Set(input.candidateArchetypeIds)],
    candidateEvidenceCodes: [...new Set(input.candidateEvidenceCodes)],
    media: {
      kind: input.item.media[0]?.kind ?? 'image',
      mimeType: input.image.mimeType,
      width: input.image.width,
      height: input.image.height,
      fingerprint: input.image.fingerprint
    }
  }
  const maxTextBytes = input.maxInputBytes - input.image.bytes.byteLength
  if (maxTextBytes <= 0) {
    return {
      state: 'abstained',
      abstention: { code: 'resource-limit', detailCode: 'visual-input-bytes' }
    }
  }
  fitBody(candidate, maxTextBytes)
  if (bytes(candidate) > maxTextBytes) {
    return {
      state: 'abstained',
      abstention: { code: 'resource-limit', detailCode: 'visual-input-bytes' }
    }
  }
  const parsed = visualClassificationInputSchema.safeParse(candidate)
  if (!parsed.success) {
    return {
      state: 'abstained',
      abstention: { code: 'unsupported-input', detailCode: 'visual-input' }
    }
  }
  const dataCategories = categoriesFor({
    title: parsed.data.title,
    body: parsed.data.body,
    semanticRules: input.semanticRules
  })
  const inputFingerprint = await fingerprintPortableValue({
    binding,
    input: parsed.data,
    imageFingerprint: input.image.fingerprint
  })
  return {
    state: 'ready',
    prepared: {
      binding,
      input: parsed.data,
      image: input.image,
      inputBytes: bytes(parsed.data) + input.image.bytes.byteLength,
      inputFingerprint,
      dataCategories
    }
  }
}
