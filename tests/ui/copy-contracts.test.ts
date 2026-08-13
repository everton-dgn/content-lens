import { describe, expect, it, vi } from 'vitest'

import { MODEL_TASK_VALUES } from '@/ai/models/contracts'
import { PROVIDER_CONNECTION_CODE_VALUES } from '@/ai/providers/contracts'
import { PLATFORM_VALUES } from '@/core/content/contracts'
import { PLATFORM_SURFACE_VALUES } from '@/core/content/surfaces'
import { getDataPanelCopy } from '@/ui/data/copy'
import { getFeedPanelCopy } from '@/ui/feeds/copy'
import { getHomePanelCopy } from '@/ui/home/copy'
import { getNativeFeedbackCopy } from '@/ui/native-feedback/copy'
import { getReviewPanelCopy } from '@/ui/review/copy'
import { getRuleWorkbenchCopy } from '@/ui/rules/copy'
import {
  getPermissionStateLabel,
  getPlatformLabel,
  getPlatformSurfaceLabel,
  getProviderConnectionTitle,
  getProviderExecutionLabel,
  getProviderStatusLabel,
  getSettingsPanelCopy,
  getTaskLabel
} from '@/ui/settings/copy'

vi.mock('@/i18n/runtime', () => ({
  t: (key: string, substitutions?: string | string[]) =>
    substitutions === undefined
      ? key
      : `${key}:${Array.isArray(substitutions) ? substitutions.join('|') : substitutions}`
}))

describe('visible copy contracts', () => {
  it('materializes every panel copy surface', () => {
    expect(getDataPanelCopy().title).toBe('dataTitle')
    expect(getFeedPanelCopy().title).toBe('feedsTitle')
    expect(getHomePanelCopy().title).toBe('homeTitle')
    expect(getRuleWorkbenchCopy().listTitle).toBe('rulesListTitle')
  })

  it('labels every native feedback state and preserves unknown states', () => {
    const copy = getNativeFeedbackCopy()
    const states = [
      'pending-review',
      'submitting',
      'submitted',
      'rejected',
      'unavailable',
      'uncertain',
      'cancelled',
      'cooldown'
    ]

    for (const state of states) {
      expect(copy.stateLabel(state)).toMatch(/^nativeFeedbackState/)
      expect(copy.stateMessage(state)).toMatch(/^nativeFeedbackMessage/)
    }
    expect(copy.stateLabel('future-state')).toBe('future-state')
    expect(copy.stateMessage('future-state')).toBe('future-state')
  })

  it('formats similarity review counts, scores and relation types', () => {
    const copy = getReviewPanelCopy()
    expect(copy.clustersLabel(3)).toBe('reviewClustersLabel:3')
    expect(copy.hideSimilarDescription(4, 2, 1)).toBe(
      'reviewHideSimilarDescription:4|2|1'
    )
    expect(copy.graphEdgesLabel(5)).toBe('reviewGraphEdgesLabel:5')
    expect(copy.graphNodesLabel(6)).toBe('reviewGraphNodesLabel:6')
    expect(copy.relationsLabel(7)).toBe('reviewRelationsLabel:7')
    expect(copy.scoreLabel(0.834)).toBe('reviewScoreLabel:83%')

    const relations = [
      'exact-duplicate',
      'near-duplicate',
      'related-distinct',
      'semantically-similar',
      'story-update'
    ]
    for (const relation of relations) {
      expect(copy.relationLabel(relation)).toMatch(/^reviewRelation/)
    }
    expect(copy.relationLabel('future-relation')).toBe('future-relation')
  })

  it('formats every settings state, count and recovery message', () => {
    const copy = getSettingsPanelCopy()
    expect(copy.fallbackPositionLabel(2)).toBe(
      'settingsFallbackPositionLabel:2'
    )
    expect(copy.syncConflictBulkReviewBody(4)).toBe(
      'settingsSyncConflictBulkReviewBody:4'
    )
    expect(copy.syncRecoveryRevisionLabel(9)).toBe(
      'settingsSyncRecoveryRevisionLabel:9'
    )
    expect(copy.syncRecoveryDiffLabel(1, 2, 3)).toBe(
      'settingsSyncRecoveryDiffLabel:1|2|3'
    )
    expect(copy.syncRemoteDeleteReviewBody('backup.json')).toBe(
      'settingsSyncRemoteDeleteReviewBody:backup.json'
    )
    expect(copy.hoursLabel(24)).toBe('settingsHoursLabel:24')
    expect(copy.catalogRefreshedBody(8)).toBe('settingsCatalogRefreshedBody:8')
    expect(copy.providerModelCount(12)).toBe('settingsProviderModelCount:12')
    expect(copy.generalProviderCount(2)).toBe('settingsGeneralProviderCount:2')
    expect(copy.generalProviderCount(1)).toBe(
      'settingsGeneralProviderCountSingular'
    )
    expect(copy.generalModelCount(1)).toBe('settingsGeneralModelCountSingular')
    expect(copy.generalModelCount(2)).toBe('settingsGeneralModelCount:2')

    for (const state of [
      'disconnected',
      'connecting',
      'idle',
      'pulling',
      'merging',
      'pushing',
      'conflict',
      'degraded',
      'future-state'
    ]) {
      expect(copy.syncStateLabel(state)).toMatch(/^settingsSyncState/)
    }
  })

  it('maps every typed settings enum to localized copy', () => {
    for (const platform of PLATFORM_VALUES) {
      expect(getPlatformLabel(platform)).toMatch(/^settingsPlatform/)
    }
    for (const task of MODEL_TASK_VALUES) {
      expect(getTaskLabel(task)).toMatch(/^settingsTask/)
    }
    for (const surface of PLATFORM_SURFACE_VALUES) {
      expect(getPlatformSurfaceLabel(surface)).toMatch(/^settingsSurface/)
    }
    for (const code of PROVIDER_CONNECTION_CODE_VALUES) {
      expect(getProviderConnectionTitle(code)).toMatch(
        /^settingsConnection.*Title$/
      )
    }

    for (const status of [
      'unconfigured',
      'locked',
      'ready',
      'degraded',
      'rate-limited',
      'unauthorized',
      'revoked'
    ] as const) {
      expect(getProviderStatusLabel(status)).toMatch(/^settingsStatus/)
    }
    for (const execution of ['local', 'cloud', 'browser'] as const) {
      expect(getProviderExecutionLabel(execution)).toMatch(/^settingsExecution/)
    }
    for (const state of [
      'not-requested',
      'granted',
      'denied',
      'revoked',
      'unavailable'
    ] as const) {
      expect(getPermissionStateLabel(state)).toMatch(/^settingsPermission/)
    }
  })
})
