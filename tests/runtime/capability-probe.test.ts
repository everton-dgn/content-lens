import { describe, expect, it } from 'vitest'

import {
  type CapabilityProbeContext,
  deriveRuntimeState,
  probeCapability
} from '../browser/harness/runtime/capability-probe'

const capabilityContext: CapabilityProbeContext = {
  browserEnvironment: 'synthetic-browser',
  checkedAt: '2026-07-29T00:00:00.000Z',
  productVersion: '0.0.0'
}

const capability = (
  overrides: Partial<Parameters<typeof probeCapability>[0]> = {}
): Parameters<typeof probeCapability>[0] => ({
  fallback: 'Keep deterministic content visible.',
  id: 'synthetic-capability',
  invalidatedBy: ['browser-update', 'api-failure'],
  required: false,
  run: () => ({ status: 'available' }),
  ...overrides
})

describe('Phase 0 capability probes', () => {
  it('distinguishes supported, limited, blocked, unsupported and unknown', async () => {
    const results = await Promise.all([
      probeCapability(capability(), capabilityContext),
      probeCapability(
        capability({
          id: 'limited',
          run: () => ({ status: 'limited', reason: 'safe-subset-only' })
        }),
        capabilityContext
      ),
      probeCapability(
        capability({
          id: 'blocked',
          permission: () => false
        }),
        capabilityContext
      ),
      probeCapability(
        capability({
          id: 'unsupported',
          run: () => ({ status: 'absent', reason: 'api-absent' })
        }),
        capabilityContext
      ),
      probeCapability(
        capability({
          id: 'unknown',
          run: () => {
            throw new Error('synthetic probe failure')
          }
        }),
        capabilityContext
      )
    ])

    expect(results.map(({ state }) => state)).toEqual([
      'supported',
      'limited',
      'blocked',
      'unsupported',
      'unknown'
    ])
    expect(new Set(results.map(({ cacheKey }) => cacheKey)).size).toBe(5)
  })

  it('treats timeout and invalid gates as unknown', async () => {
    const [timeout, hangingPermission, hangingConsent, invalidGate] =
      await Promise.all([
        probeCapability(
          capability({
            id: 'timeout',
            run: () => new Promise(() => undefined),
            timeoutMs: 5
          }),
          capabilityContext
        ),
        probeCapability(
          capability({
            id: 'hanging-permission',
            permission: () => new Promise(() => undefined),
            timeoutMs: 5
          }),
          capabilityContext
        ),
        probeCapability(
          capability({
            consent: () => new Promise(() => undefined),
            id: 'hanging-consent',
            timeoutMs: 5
          }),
          capabilityContext
        ),
        probeCapability(
          capability({
            consent: () => {
              throw new Error('invalid consent state')
            },
            id: 'invalid-gate'
          }),
          capabilityContext
        )
      ])

    expect(timeout).toMatchObject({
      reason: 'probe-timed-out',
      state: 'unknown'
    })
    expect(hangingPermission).toMatchObject({
      reason: 'probe-timed-out',
      state: 'unknown'
    })
    expect(hangingConsent).toMatchObject({
      reason: 'probe-timed-out',
      state: 'unknown'
    })
    expect(invalidGate).toMatchObject({
      reason: 'gate-threw',
      state: 'unknown'
    })
  })

  it('re-evaluates a capability after revocation', async () => {
    let available = true
    const definition = capability({
      id: 'revocable',
      run: () =>
        available
          ? { status: 'available' }
          : { status: 'absent', reason: 'api-revoked' }
    })

    expect((await probeCapability(definition, capabilityContext)).state).toBe(
      'supported'
    )
    available = false
    expect((await probeCapability(definition, capabilityContext)).state).toBe(
      'unsupported'
    )
  })

  it('derives the ready, degraded and blocked states from required and optional probe evidence', async () => {
    const required = await probeCapability(
      capability({ id: 'required', required: true }),
      capabilityContext
    )
    const optionalMissing = await probeCapability(
      capability({
        id: 'optional',
        run: () => ({ status: 'absent', reason: 'api-absent' })
      }),
      capabilityContext
    )
    const requiredMissing = {
      ...required,
      reason: 'api-absent',
      state: 'unsupported'
    } as const

    expect(deriveRuntimeState([required])).toBe('ready')
    expect(deriveRuntimeState([required, optionalMissing])).toBe('degraded')
    expect(deriveRuntimeState([requiredMissing, optionalMissing])).toBe(
      'blocked'
    )
  })
})
