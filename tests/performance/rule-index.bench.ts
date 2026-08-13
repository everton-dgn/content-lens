import { performance } from 'node:perf_hooks'

import { describe, expect, it } from 'vitest'

import type { ContentItem } from '@/core/content/contracts'
import type { IdentityRule } from '@/core/rules/contracts/rule'
import { buildRuleIndex, evaluateRules } from '@/core/rules/engine'

import { budgetRegime, effectiveBudgetMs } from './budget'

const RULE_COUNT = 100_000
const SAMPLE_COUNT = 30
const RULE_LOOKUP_P95_BUDGET_MS = 25
const timestamp = '2026-07-29T21:00:00.000Z'

function identityRule(index: number): IdentityRule {
  return {
    id: `identity:${index.toString().padStart(6, '0')}`,
    enabled: true,
    scope: {},
    createdAt: timestamp,
    updatedAt: timestamp,
    kind: 'identity',
    effect: 'block',
    platform: 'youtube',
    identityType: 'channel',
    identityId: `channel:${index}`
  }
}

function contentItem(channelIndex: number): ContentItem {
  return {
    id: `youtube:video:${channelIndex}`,
    platform: 'youtube',
    identity: {
      status: 'stable',
      platformContentId: `video:${channelIndex}`
    },
    surface: 'youtube:home',
    channel: {
      platform: 'youtube',
      channelId: `channel:${channelIndex}`,
      displayName: `Synthetic channel ${channelIndex}`
    },
    media: [],
    observedAt: timestamp,
    context: {}
  }
}

function percentile(samples: readonly number[], value: number) {
  const sorted = [...samples].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(sorted.length * value) - 1)
  return sorted[index] ?? 0
}

function summarize(samples: readonly number[]) {
  return {
    medianMs: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    worstMs: Math.max(...samples)
  }
}

function measureLookup(
  index: ReturnType<typeof buildRuleIndex>['index'],
  item: ContentItem
) {
  const startedAt = performance.now()
  const evaluation = evaluateRules({
    item,
    index,
    profileRevision: 1
  })
  const durationMs = performance.now() - startedAt

  expect(evaluation.decision.action).toBe('hide')
  return durationMs
}

describe('100,000-rule index performance', () => {
  it('keeps cold and warm p95 lookup within 25 ms', () => {
    const built = buildRuleIndex(
      Array.from({ length: RULE_COUNT }, (_, index) => identityRule(index))
    )

    expect(built.quarantined).toEqual([])
    expect(built.index.size).toBe(RULE_COUNT)

    const coldSamples = Array.from({ length: SAMPLE_COUNT }, (_, index) =>
      measureLookup(built.index, contentItem(index))
    )

    const warmItem = contentItem(RULE_COUNT - 1)
    for (let warmup = 0; warmup < 10; warmup += 1) {
      measureLookup(built.index, warmItem)
    }
    const warmSamples = Array.from({ length: SAMPLE_COUNT }, () =>
      measureLookup(built.index, warmItem)
    )

    const result = {
      schemaVersion: 1,
      ruleCount: RULE_COUNT,
      sampleCount: SAMPLE_COUNT,
      budgetMs: RULE_LOOKUP_P95_BUDGET_MS,
      regime: budgetRegime(),
      cold: summarize(coldSamples),
      warm: summarize(warmSamples)
    }
    console.log(`[rule-index-benchmark] ${JSON.stringify(result)}`)

    expect(result.cold.p95Ms).toBeLessThanOrEqual(
      effectiveBudgetMs(RULE_LOOKUP_P95_BUDGET_MS)
    )
    expect(result.warm.p95Ms).toBeLessThanOrEqual(
      effectiveBudgetMs(RULE_LOOKUP_P95_BUDGET_MS)
    )
  })
})
