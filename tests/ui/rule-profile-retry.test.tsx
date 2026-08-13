import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLocalProfile } from '@/application/profile/local-profile'
import type { Rule } from '@/core/rules/contracts/rule'
import type { DiagnosticService } from '@/diagnostics/service'
import type { ContentLensDatabase } from '@/storage/indexed-db/database'
import {
  type RuleMutationOutcome,
  useRuleProfile
} from '@/ui/rules/useRuleProfile'

const serviceMocks = vi.hoisted(() => ({
  remove: vi.fn(),
  save: vi.fn()
}))

vi.mock('@/application/rule-management/service', () => ({
  RuleManagementService: class {
    remove = serviceMocks.remove
    save = serviceMocks.save
  }
}))

const at = '2026-07-30T03:30:00.000Z'
const rule: Rule = {
  id: 'rule:exact:retry',
  enabled: true,
  scope: {
    platforms: ['youtube'],
    surfaces: ['youtube:home']
  },
  createdAt: at,
  updatedAt: at,
  kind: 'exact',
  effect: 'block',
  field: 'title',
  value: 'retry this rule',
  caseSensitive: false
}

const mountedRoots: Array<{
  container: HTMLDivElement
  root: ReturnType<typeof createRoot>
}> = []

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean
    }
  ).IS_REACT_ACT_ENVIRONMENT = true
  serviceMocks.remove.mockReset()
  serviceMocks.save.mockReset()
})

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop()
    if (mounted) {
      await act(async () => {
        mounted.root.unmount()
      })
      mounted.container.remove()
    }
  }
})

async function renderProfileHook(
  database: ContentLensDatabase,
  diagnostics: DiagnosticService,
  randomId: () => string,
  expectedStatus: 'ready' | 'error' = 'ready'
) {
  let hook: ReturnType<typeof useRuleProfile> | undefined
  const now = () => new Date(at)
  const Probe = () => {
    hook = useRuleProfile({
      database,
      diagnostics,
      now,
      randomId
    })
    return null
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mountedRoots.push({ container, root })
  await act(async () => {
    root.render(<Probe />)
    await Promise.resolve()
    await Promise.resolve()
  })
  await vi.waitFor(() => {
    expect(hook?.state.status).toBe(expectedStatus)
  })
  if (!hook) {
    throw new Error('Rule profile hook did not render.')
  }
  return () => {
    if (!hook) {
      throw new Error('Rule profile hook is unavailable.')
    }
    return hook
  }
}

describe('rule profile retry identity', () => {
  it('creates the first local profile and reports unreadable or unavailable storage', async () => {
    const createdDatabase = {
      readActiveProfile: vi.fn(async () => undefined),
      saveProfile: vi.fn(async () => ({ state: 'stored' }))
    } as unknown as ContentLensDatabase
    const diagnostics = {
      record: vi.fn(async () => undefined)
    } as unknown as DiagnosticService
    const created = await renderProfileHook(
      createdDatabase,
      diagnostics,
      () => 'created-profile'
    )
    expect(created().state).toMatchObject({
      status: 'ready',
      profile: { profileId: 'profile:created-profile' }
    })
    expect(createdDatabase.saveProfile).toHaveBeenCalledOnce()

    const invalidDatabase = {
      readActiveProfile: vi.fn(async () => ({ malformed: true }))
    } as unknown as ContentLensDatabase
    const invalid = await renderProfileHook(
      invalidDatabase,
      diagnostics,
      () => 'unused',
      'error'
    )
    expect(invalid().state).toMatchObject({ status: 'error' })
    expect(diagnostics.record).toHaveBeenCalledWith(
      'invalid-profile',
      expect.objectContaining({ scopeKey: 'profile' })
    )

    const unavailableDatabase = {
      readActiveProfile: vi.fn(async () => {
        throw new Error('indexed-db unavailable')
      })
    } as unknown as ContentLensDatabase
    const unavailable = await renderProfileHook(
      unavailableDatabase,
      diagnostics,
      () => 'unused',
      'error'
    )
    expect(unavailable().state).toEqual({
      status: 'error',
      code: 'storage-unavailable'
    })
    expect(diagnostics.record).toHaveBeenCalledWith(
      'storage-unavailable',
      expect.objectContaining({ scopeKey: 'indexed-db' })
    )
  })

  it('records definitive save and remove failures and clears their intents', async () => {
    const initial = {
      ...createLocalProfile({ at, profileId: 'profile:definitive-failure' }),
      rules: [rule]
    }
    const database = {
      readActiveProfile: vi.fn(async () => initial)
    } as unknown as ContentLensDatabase
    const diagnostics = {
      record: vi.fn(async () => undefined)
    } as unknown as DiagnosticService
    const randomId = vi
      .fn()
      .mockReturnValueOnce('save-failed')
      .mockReturnValueOnce('save-retry')
      .mockReturnValueOnce('remove-failed')
      .mockReturnValueOnce('remove-retry')
    serviceMocks.save.mockResolvedValue({
      state: 'failed',
      error: { code: 'rule-invalid' }
    })
    serviceMocks.remove.mockResolvedValue({
      state: 'failed',
      error: { code: 'rule-not-found' }
    })
    const current = await renderProfileHook(database, diagnostics, randomId)

    await act(async () => {
      expect(await current().saveRule(rule)).toEqual({
        ok: false,
        state: 'failed',
        code: 'rule-invalid'
      })
      expect(await current().saveRule(rule)).toMatchObject({ state: 'failed' })
      expect(await current().removeRule(rule.id)).toEqual({
        ok: false,
        state: 'failed',
        code: 'rule-not-found'
      })
      expect(await current().removeRule(rule.id)).toMatchObject({
        state: 'failed'
      })
    })
    expect(randomId).toHaveBeenCalledTimes(4)
    expect(diagnostics.record).toHaveBeenCalledWith(
      'rule-save-failed',
      expect.objectContaining({ scopeKey: 'rules' })
    )
    expect(diagnostics.record).toHaveBeenCalledWith(
      'rule-remove-failed',
      expect.objectContaining({ scopeKey: 'rules' })
    )
  })

  it('reuses the complete save command across uncertain results', async () => {
    const initial = createLocalProfile({
      at,
      profileId: 'profile:save-retry'
    })
    const committed = {
      ...initial,
      revision: 1,
      rules: [rule]
    }
    const database = {
      readActiveProfile: vi
        .fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValue(committed)
    } as unknown as ContentLensDatabase
    const diagnostics = {
      record: vi.fn(async () => undefined)
    } as unknown as DiagnosticService
    const randomId = vi.fn(() => 'save-intent')
    serviceMocks.save
      .mockRejectedValueOnce(new Error('response lost after commit'))
      .mockResolvedValueOnce({
        state: 'pending',
        operationId: 'operation:rule:save:save-intent'
      })
      .mockResolvedValueOnce({
        state: 'committed',
        revision: 1,
        value: { ruleId: rule.id }
      })
    const current = await renderProfileHook(database, diagnostics, randomId)
    let first: RuleMutationOutcome | undefined
    let second: RuleMutationOutcome | undefined
    let third: RuleMutationOutcome | undefined

    await act(async () => {
      first = await current().saveRule(rule)
    })
    await act(async () => {
      second = await current().saveRule(rule)
    })
    await act(async () => {
      third = await current().saveRule(rule)
    })

    expect(first).toEqual({ ok: false, state: 'pending' })
    expect(second).toEqual({ ok: false, state: 'pending' })
    expect(third).toEqual({ ok: true })
    expect(randomId).toHaveBeenCalledOnce()
    expect(serviceMocks.save).toHaveBeenCalledTimes(3)
    expect(serviceMocks.save.mock.calls[1]?.[0]).toEqual(
      serviceMocks.save.mock.calls[0]?.[0]
    )
    expect(serviceMocks.save.mock.calls[2]?.[0]).toEqual(
      serviceMocks.save.mock.calls[0]?.[0]
    )
    expect(serviceMocks.save.mock.calls[0]?.[0]).toMatchObject({
      at,
      expectedRevision: 0,
      operationId: 'operation:rule:save:save-intent',
      rule: { id: rule.id, updatedAt: at }
    })
    expect(diagnostics.record).toHaveBeenCalledTimes(1)
    expect(diagnostics.record).toHaveBeenCalledWith(
      'operation-response-uncertain',
      {
        occurredAt: at,
        scopeKey: 'rules'
      }
    )
  })

  it('reuses the complete remove command across uncertain results', async () => {
    const initial = {
      ...createLocalProfile({
        at,
        profileId: 'profile:remove-retry'
      }),
      rules: [rule]
    }
    const committed = {
      ...initial,
      revision: 1,
      rules: []
    }
    const database = {
      readActiveProfile: vi
        .fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValue(committed)
    } as unknown as ContentLensDatabase
    const diagnostics = {
      record: vi.fn(async () => undefined)
    } as unknown as DiagnosticService
    const randomId = vi.fn(() => 'remove-intent')
    serviceMocks.remove
      .mockRejectedValueOnce(new Error('response lost after commit'))
      .mockResolvedValueOnce({
        state: 'pending',
        operationId: 'operation:rule:remove:remove-intent'
      })
      .mockResolvedValueOnce({
        state: 'committed',
        revision: 1,
        value: { ruleId: rule.id }
      })
    const current = await renderProfileHook(database, diagnostics, randomId)

    await act(async () => {
      expect(await current().removeRule(rule.id)).toEqual({
        ok: false,
        state: 'pending'
      })
    })
    await act(async () => {
      expect(await current().removeRule(rule.id)).toEqual({
        ok: false,
        state: 'pending'
      })
    })
    await act(async () => {
      expect(await current().removeRule(rule.id)).toEqual({ ok: true })
    })

    expect(randomId).toHaveBeenCalledOnce()
    expect(serviceMocks.remove).toHaveBeenCalledTimes(3)
    expect(serviceMocks.remove.mock.calls[1]?.[0]).toEqual(
      serviceMocks.remove.mock.calls[0]?.[0]
    )
    expect(serviceMocks.remove.mock.calls[2]?.[0]).toEqual(
      serviceMocks.remove.mock.calls[0]?.[0]
    )
    expect(serviceMocks.remove.mock.calls[0]?.[0]).toEqual({
      at,
      expectedRevision: 0,
      operationId: 'operation:rule:remove:remove-intent',
      ruleId: rule.id
    })
    expect(diagnostics.record).toHaveBeenCalledTimes(1)
    expect(diagnostics.record).toHaveBeenCalledWith(
      'operation-response-uncertain',
      {
        occurredAt: at,
        scopeKey: 'rules'
      }
    )
  })
})
