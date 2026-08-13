import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createLocalProfile } from '@/application/profile/local-profile'
import {
  type RemoveRuleCommand,
  RuleManagementService,
  type SaveRuleCommand
} from '@/application/rule-management/service'
import type { Rule } from '@/core/rules/contracts/rule'
import { DiagnosticService } from '@/diagnostics/service'
import {
  type ProfileEnvelope,
  parseProfileEnvelope
} from '@/storage/contracts/profile-envelope'
import { ContentLensDatabase } from '@/storage/indexed-db/database'

export type RuleProfileState =
  | { status: 'loading' }
  | { status: 'error'; code: string }
  | { status: 'ready'; profile: ProfileEnvelope }

export type RuleMutationOutcome =
  | { ok: true }
  | { ok: false; state: 'pending' }
  | { ok: false; state: 'failed'; code: string }

type RuleProfileDependencies = {
  database?: ContentLensDatabase
  diagnostics?: DiagnosticService
  now?: () => Date
  randomId?: () => string
}

const systemNow = () => new Date()
const systemRandomId = () => crypto.randomUUID()

export const useRuleProfile = (dependencies: RuleProfileDependencies = {}) => {
  const database = useMemo(
    () => dependencies.database ?? new ContentLensDatabase(),
    [dependencies.database]
  )
  const service = useMemo(() => new RuleManagementService(database), [database])
  const diagnostics = useMemo(
    () => dependencies.diagnostics ?? new DiagnosticService(),
    [dependencies.diagnostics]
  )
  const now = dependencies.now ?? systemNow
  const randomId = dependencies.randomId ?? systemRandomId
  const [state, setState] = useState<RuleProfileState>({ status: 'loading' })
  const [pending, setPending] = useState(false)
  const saveIntents = useRef(new WeakMap<Rule, SaveRuleCommand>())
  const removeIntents = useRef(new Map<string, RemoveRuleCommand>())

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      let raw = await database.readActiveProfile()
      if (raw === undefined) {
        const at = now().toISOString()
        const profile = createLocalProfile({
          at,
          profileId: `profile:${randomId()}`
        })
        await database.saveProfile(profile)
        raw = profile
      }
      const parsed = parseProfileEnvelope(raw)
      if (!parsed.success) {
        await diagnostics
          .record('invalid-profile', {
            occurredAt: now().toISOString(),
            scopeKey: 'profile'
          })
          .catch(() => undefined)
      }
      setState(
        parsed.success
          ? { status: 'ready', profile: parsed.data }
          : { status: 'error', code: parsed.code }
      )
    } catch {
      await diagnostics
        .record('storage-unavailable', {
          occurredAt: now().toISOString(),
          scopeKey: 'indexed-db'
        })
        .catch(() => undefined)
      setState({ status: 'error', code: 'storage-unavailable' })
    }
  }, [database, diagnostics, now, randomId])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = useCallback(async () => {
    const raw = await database.readActiveProfile()
    const parsed = parseProfileEnvelope(raw)
    if (!parsed.success) {
      setState({ status: 'error', code: parsed.code })
      return false
    }
    setState({ status: 'ready', profile: parsed.data })
    return true
  }, [database])

  const saveRule = useCallback(
    async (rule: Rule): Promise<RuleMutationOutcome> => {
      if (state.status !== 'ready') {
        return { ok: false, state: 'failed', code: 'profile-not-ready' }
      }
      setPending(true)
      let command = saveIntents.current.get(rule)
      if (!command) {
        const at = now().toISOString()
        command = {
          operationId: `operation:rule:save:${randomId()}`,
          expectedRevision: state.profile.revision,
          rule: { ...rule, updatedAt: at },
          at
        }
        saveIntents.current.set(rule, command)
      }
      try {
        const result = await service.save(command)
        const reconciled = await refresh().catch(() => false)
        if (result.state !== 'committed' && result.state !== 'pending') {
          await diagnostics
            .record('rule-save-failed', {
              occurredAt: command.at,
              scopeKey: 'rules'
            })
            .catch(() => undefined)
        }
        if (
          (result.state === 'committed' && reconciled) ||
          (result.state !== 'committed' && result.state !== 'pending')
        ) {
          saveIntents.current.delete(rule)
        }
        if (result.state === 'committed' && reconciled) {
          return { ok: true }
        }
        if (result.state === 'pending') {
          return { ok: false, state: 'pending' }
        }
        return {
          ok: false,
          state: 'failed',
          code:
            result.state === 'failed' ? result.error.code : 'rule-save-failed'
        }
      } catch {
        await refresh().catch(() => false)
        await diagnostics
          .record('operation-response-uncertain', {
            occurredAt: command.at,
            scopeKey: 'rules'
          })
          .catch(() => undefined)
        return { ok: false, state: 'pending' }
      } finally {
        setPending(false)
      }
    },
    [diagnostics, now, randomId, refresh, service, state]
  )

  const removeRule = useCallback(
    async (ruleId: string): Promise<RuleMutationOutcome> => {
      if (state.status !== 'ready') {
        return { ok: false, state: 'failed', code: 'profile-not-ready' }
      }
      setPending(true)
      let command = removeIntents.current.get(ruleId)
      if (!command) {
        const at = now().toISOString()
        command = {
          operationId: `operation:rule:remove:${randomId()}`,
          expectedRevision: state.profile.revision,
          ruleId,
          at
        }
        removeIntents.current.set(ruleId, command)
      }
      try {
        const result = await service.remove(command)
        const reconciled = await refresh().catch(() => false)
        if (result.state !== 'committed' && result.state !== 'pending') {
          await diagnostics
            .record('rule-remove-failed', {
              occurredAt: command.at,
              scopeKey: 'rules'
            })
            .catch(() => undefined)
        }
        if (
          (result.state === 'committed' && reconciled) ||
          (result.state !== 'committed' && result.state !== 'pending')
        ) {
          removeIntents.current.delete(ruleId)
        }
        if (result.state === 'committed' && reconciled) {
          return { ok: true }
        }
        if (result.state === 'pending') {
          return { ok: false, state: 'pending' }
        }
        return {
          ok: false,
          state: 'failed',
          code:
            result.state === 'failed' ? result.error.code : 'rule-remove-failed'
        }
      } catch {
        await refresh().catch(() => false)
        await diagnostics
          .record('operation-response-uncertain', {
            occurredAt: command.at,
            scopeKey: 'rules'
          })
          .catch(() => undefined)
        return { ok: false, state: 'pending' }
      } finally {
        setPending(false)
      }
    },
    [diagnostics, now, randomId, refresh, service, state]
  )

  return {
    database,
    diagnostics,
    load,
    pending,
    refresh,
    removeRule,
    saveRule,
    state
  }
}
