import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import { createLocalProfile } from '@/application/profile/local-profile'
import { RuleManagementService } from '@/application/rule-management/service'
import { ContentLensDatabase } from '@/storage/indexed-db/database'
import {
  exactRuleFromDraft,
  initialRuleFlowState,
  previewExactRule,
  ruleFlowReducer,
  starterRuleDraft
} from '@/ui/rules/model'

const at = '2026-07-30T01:00:00.000Z'

describe('first rule flow', () => {
  it('reaches a reviewed save in three user decisions', () => {
    const profile = createLocalProfile({
      at,
      profileId: 'profile:rule-flow'
    })
    const draft = { ...starterRuleDraft(), value: 'transfer gossip' }
    const rule = exactRuleFromDraft(draft, {
      at,
      id: 'rule:exact:first'
    })
    const preview = previewExactRule(profile.rules, rule, profile.revision, at)

    const editor = ruleFlowReducer(initialRuleFlowState, { type: 'start' })
    const updated = ruleFlowReducer(editor, { type: 'update', draft })
    const reviewed = ruleFlowReducer(updated, { type: 'preview', preview })
    const saved = ruleFlowReducer(reviewed, { type: 'saved', rule })

    expect(editor.screen).toBe('editor')
    expect(reviewed.screen).toBe('preview')
    expect(saved).toMatchObject({
      screen: 'list',
      decisionCount: 3,
      feedback: { kind: 'saved' }
    })
  })

  it.each(['block', 'allow'] as const)(
    'dry-runs an exact %s rule with a match and protected exception',
    effect => {
      const profile = createLocalProfile({
        at,
        profileId: `profile:${effect}`
      })
      const rule = exactRuleFromDraft(
        { effect, value: '  tactical analysis  ' },
        { at, id: `rule:exact:${effect}` }
      )
      const preview = previewExactRule(
        profile.rules,
        rule,
        profile.revision,
        at
      )

      expect(rule.value).toBe('tactical analysis')
      expect(preview.dryRun).toBe(true)
      expect(preview.outcomes).toEqual([
        {
          kind: 'match',
          before: 'show',
          after: effect === 'block' ? 'hide' : 'show',
          changed: true,
          matched: true,
          platform: 'youtube',
          surface: 'youtube:home',
          title: 'tactical analysis'
        },
        {
          kind: 'protected',
          before: 'show',
          after: 'show',
          changed: false,
          matched: false,
          platform: 'youtube',
          surface: 'youtube:home',
          title: 'Content outside this rule'
        }
      ])
    }
  )

  it('preserves the reviewed draft when save fails', () => {
    const profile = createLocalProfile({
      at,
      profileId: 'profile:failed-save'
    })
    const rule = exactRuleFromDraft(
      { effect: 'block', value: 'rumor' },
      { at, id: 'rule:exact:failed-save' }
    )
    const preview = previewExactRule(profile.rules, rule, profile.revision, at)
    const reviewed = ruleFlowReducer(
      ruleFlowReducer(initialRuleFlowState, { type: 'start' }),
      { type: 'preview', preview }
    )
    const failed = ruleFlowReducer(reviewed, { type: 'save-failed' })

    expect(failed).toMatchObject({
      screen: 'preview',
      failure: true,
      preview: { candidate: rule }
    })
  })
})

describe('persistent rule save and undo', () => {
  it('commits and removes the reviewed rule with monotonic revisions', async () => {
    const database = new ContentLensDatabase({
      factory: new IDBFactory(),
      databaseName: 'contentlens-ui-rule-flow'
    })
    const profile = createLocalProfile({
      at,
      profileId: 'profile:persistent-rule-flow'
    })
    await database.saveProfile(profile)
    const service = new RuleManagementService(database)
    const rule = exactRuleFromDraft(
      { effect: 'block', value: 'transfer gossip' },
      { at, id: 'rule:exact:persistent' }
    )

    const saved = await service.save({
      operationId: 'operation:ui:save',
      expectedRevision: 0,
      rule,
      at
    })
    const removeCommand = {
      operationId: 'operation:ui:undo',
      expectedRevision: 1,
      ruleId: rule.id,
      at: '2026-07-30T01:01:00.000Z'
    }
    const removed = await service.remove(removeCommand)
    const replayedRemove = await service.remove(removeCommand)

    expect(saved).toMatchObject({ state: 'committed', revision: 1 })
    expect(removed).toMatchObject({ state: 'committed', revision: 2 })
    expect(replayedRemove).toMatchObject({ state: 'committed', revision: 2 })
    expect(await database.exportProfile()).toMatchObject({
      revision: 2,
      rules: []
    })
  })
})
