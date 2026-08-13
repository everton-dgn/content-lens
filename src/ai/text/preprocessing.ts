import {
  DATA_CATEGORY_VALUES,
  type DataCategory
} from '@/ai/providers/contracts'
import {
  MAX_TEXT_CONTEXT_ENTRIES,
  MAX_TEXT_RULES,
  TEXT_CLASSIFICATION_INPUT_SCHEMA_VERSION,
  type TextClassificationInput,
  type TextLanguage,
  textClassificationInputSchema
} from '@/ai/text/contracts'
import type { ContentItem } from '@/core/content/contracts'
import { fingerprintPortableValue } from '@/core/operations/fingerprint'
import type { SemanticRule } from '@/core/rules/contracts/rule'

const MIN_TEXT_INPUT_BYTES = 512
const MAX_TEXT_INPUT_BYTES = 1024 * 1024
export const TEXT_PREPROCESSING_VERSION = 'text-preprocessing@1'

type TextPreprocessingAbstention = {
  state: 'abstained'
  abstention: {
    code: 'insufficient-input' | 'resource-limit'
    detailCode?: string
  }
}

export type ReadyTextInput = {
  state: 'ready'
  input: TextClassificationInput
  inputBytes: number
  inputFingerprint: string
  dataCategories: readonly DataCategory[]
  binding: {
    contentId: string
    platform: ContentItem['platform']
    surface: ContentItem['surface']
  }
}

export type TextPreprocessingResult =
  | ReadyTextInput
  | TextPreprocessingAbstention

type MutableInput = TextClassificationInput

const encoder = new TextEncoder()

function byteLength(value: unknown) {
  return encoder.encode(JSON.stringify(value)).byteLength
}

function normalizeLanguage(value: string | undefined): TextLanguage {
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

function normalizedText(value: string | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function prefix(value: string, length: number) {
  return [...value].slice(0, length).join('')
}

function fitOptionalString(input: {
  value: string | undefined
  candidate: MutableInput
  maxInputBytes: number
  set(value: string): void
  clear(): void
}) {
  if (!input.value) {
    input.clear()
    return false
  }
  input.set(input.value)
  if (byteLength(input.candidate) <= input.maxInputBytes) {
    return false
  }

  const characters = [...input.value]
  let low = 0
  let high = characters.length
  let best = 0
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    input.set(prefix(input.value, middle))
    if (byteLength(input.candidate) <= input.maxInputBytes) {
      best = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  if (best === 0) {
    input.clear()
  } else {
    input.set(prefix(input.value, best))
  }
  return best < characters.length
}

function orderedCategories(categories: ReadonlySet<DataCategory>) {
  return DATA_CATEGORY_VALUES.filter(category => categories.has(category))
}

function abstain(
  code: TextPreprocessingAbstention['abstention']['code'],
  detailCode?: string
): TextPreprocessingAbstention {
  return {
    state: 'abstained',
    abstention: {
      code,
      ...(detailCode ? { detailCode } : {})
    }
  }
}

export async function preprocessTextInput(input: {
  item: ContentItem
  semanticRules: readonly SemanticRule[]
  allowedContextKeys: readonly string[]
  maxInputBytes: number
  mediaAccess?: () => unknown
}): Promise<TextPreprocessingResult> {
  if (
    !Number.isInteger(input.maxInputBytes) ||
    input.maxInputBytes < MIN_TEXT_INPUT_BYTES ||
    input.maxInputBytes > MAX_TEXT_INPUT_BYTES
  ) {
    return abstain('resource-limit', 'text-input-budget-invalid')
  }
  if (input.semanticRules.length > MAX_TEXT_RULES) {
    return abstain('resource-limit', 'semantic-rule-count-exceeded')
  }

  const title = normalizedText(input.item.title)
  const body = normalizedText(input.item.body)
  const sourceLabel = normalizedText(
    input.item.author?.displayName ?? input.item.channel?.displayName
  )
  const allowedKeys = new Set(
    input.allowedContextKeys.slice(0, MAX_TEXT_CONTEXT_ENTRIES)
  )
  const context = Object.fromEntries(
    Object.entries(input.item.context)
      .filter(([key]) => allowedKeys.has(key))
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  )
  if (!title && !body && !sourceLabel && Object.keys(context).length === 0) {
    return abstain('insufficient-input')
  }

  const safeRules = input.semanticRules.map(rule => ({
    ruleId: rule.id,
    description: rule.description,
    examples: [...rule.examples],
    exclusions: [...rule.exclusions]
  }))
  const language = normalizeLanguage(input.item.language)
  const fingerprintSource = {
    platform: input.item.platform,
    surface: input.item.surface,
    language,
    content: { title, body, sourceLabel, context },
    semanticRules: safeRules
  }
  const candidate: MutableInput = {
    schemaVersion: TEXT_CLASSIFICATION_INPUT_SCHEMA_VERSION,
    task: 'classification-text',
    platform: input.item.platform,
    surface: input.item.surface,
    language,
    content: { context: {} },
    semanticRules: safeRules.map(rule => ({
      ruleId: rule.ruleId,
      description: rule.description,
      examples: [],
      exclusions: []
    })),
    truncation: {
      title: false,
      body: false,
      sourceLabel: false,
      contextKeys: [],
      semanticRuleDetails: false
    }
  }

  if (byteLength(candidate) > input.maxInputBytes) {
    return abstain('resource-limit', 'semantic-rule-descriptions-too-large')
  }

  candidate.truncation.title = fitOptionalString({
    value: title,
    candidate,
    maxInputBytes: input.maxInputBytes,
    set: value => {
      candidate.content.title = value
    },
    clear: () => {
      delete candidate.content.title
    }
  })
  candidate.truncation.body = fitOptionalString({
    value: body,
    candidate,
    maxInputBytes: input.maxInputBytes,
    set: value => {
      candidate.content.body = value
    },
    clear: () => {
      delete candidate.content.body
    }
  })
  candidate.truncation.sourceLabel = fitOptionalString({
    value: sourceLabel,
    candidate,
    maxInputBytes: input.maxInputBytes,
    set: value => {
      candidate.content.sourceLabel = value
    },
    clear: () => {
      delete candidate.content.sourceLabel
    }
  })

  for (const [ruleIndex, rule] of safeRules.entries()) {
    const target = candidate.semanticRules[ruleIndex]
    if (!target) {
      return abstain('resource-limit', 'semantic-rule-binding-missing')
    }
    for (const detail of rule.examples) {
      target.examples.push(detail)
      if (byteLength(candidate) > input.maxInputBytes) {
        target.examples.pop()
        candidate.truncation.semanticRuleDetails = true
      }
    }
    for (const detail of rule.exclusions) {
      target.exclusions.push(detail)
      if (byteLength(candidate) > input.maxInputBytes) {
        target.exclusions.pop()
        candidate.truncation.semanticRuleDetails = true
      }
    }
  }

  for (const [key, value] of Object.entries(context)) {
    candidate.content.context[key] = value
    if (byteLength(candidate) > input.maxInputBytes) {
      delete candidate.content.context[key]
      candidate.truncation.contextKeys.push(key)
    }
  }

  if (byteLength(candidate) > input.maxInputBytes) {
    return abstain('resource-limit', 'text-input-cannot-fit')
  }
  const parsed = textClassificationInputSchema.safeParse(candidate)
  if (!parsed.success) {
    return abstain('resource-limit', 'text-input-invalid')
  }

  const categories = new Set<DataCategory>()
  if (parsed.data.content.title !== undefined) {
    categories.add('title')
  }
  if (parsed.data.content.body !== undefined) {
    categories.add('body')
  }
  if (parsed.data.content.sourceLabel !== undefined) {
    categories.add('author')
  }
  if (Object.keys(parsed.data.content.context).length > 0) {
    categories.add('context')
  }
  if (parsed.data.semanticRules.length > 0) {
    categories.add('rule')
    if (parsed.data.semanticRules.some(rule => rule.examples.length > 0)) {
      categories.add('examples')
    }
    if (parsed.data.semanticRules.some(rule => rule.exclusions.length > 0)) {
      categories.add('exclusions')
    }
  }

  return {
    state: 'ready',
    input: parsed.data,
    inputBytes: byteLength(parsed.data),
    inputFingerprint: await fingerprintPortableValue(fingerprintSource),
    dataCategories: orderedCategories(categories),
    binding: {
      contentId: input.item.id,
      platform: input.item.platform,
      surface: input.item.surface
    }
  }
}
