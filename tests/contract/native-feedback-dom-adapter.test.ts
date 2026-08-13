import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createNativeDomAdapter,
  type NativeDomBinding,
  supportedFixtureCapability
} from '@/application/native-feedback/dom-adapter'
import type {
  NativeFeedbackAttempt,
  NativeFeedbackCapability
} from '@/core/feedback/native-contracts'

const at = '2026-07-31T12:00:00.000Z'
const capability: NativeFeedbackCapability = supportedFixtureCapability({
  platform: 'youtube',
  surface: 'youtube:home',
  actionType: 'youtube:not-interested',
  adapterVersion: 'youtube-test@1',
  addendumVersion: 'youtube-native-test@1',
  code: 'fixture-supported',
  actionLabelPatterns: ['Not interested'],
  targetIdentity: 'video ID',
  positiveEvidence: 'visible confirmation',
  timeoutMs: 2_000,
  cooldownMs: 86_400_000,
  reversibility: { kind: 'irreversible' },
  selectors: ['[data-video-id]', '[role=menuitem]'],
  fixtureVersion: 'fixture@1',
  lastLiveSmokeAt: at
})

const attempt: NativeFeedbackAttempt = {
  attemptId: 'attempt:dom',
  operationId: 'operation:dom',
  platform: 'youtube',
  surface: 'youtube:home',
  platformContentId: 'video:1',
  pageInstanceId: 'page:1',
  actionType: 'youtube:not-interested',
  targetFingerprint: 'target:1',
  adapterVersion: capability.adapterVersion,
  addendumVersion: capability.addendumVersion,
  state: 'pending-review',
  review: {
    platform: 'youtube',
    surface: 'youtube:home',
    platformContentId: 'video:1',
    pageInstanceId: 'page:1',
    actionType: 'youtube:not-interested',
    actionLabel: 'Not interested',
    scope: 'this video',
    consequence: 'fewer recommendations',
    reversibility: { kind: 'irreversible' },
    targetFingerprint: 'target:1',
    reviewedAt: at
  },
  createdAt: at,
  updatedAt: at
}

const mounted: Element[] = []

const binding = (
  overrides: Partial<NativeDomBinding> = {}
): NativeDomBinding => {
  const target = document.createElement('article')
  const control = document.createElement('button')
  target.append(control)
  document.body.append(target)
  mounted.push(target)
  return {
    target,
    control,
    platformContentId: 'video:1',
    pageInstanceId: 'page:1',
    surface: 'youtube:home',
    actionLabel: 'Not interested',
    targetFingerprint: 'target:1',
    verifyPositiveEvidence: vi.fn(async () => ({
      state: 'verified' as const,
      method: 'visible-confirmation',
      at
    })),
    ...overrides
  }
}

afterEach(() => {
  for (const element of mounted.splice(0)) element.remove()
})

describe('native feedback DOM adapter', () => {
  it.each([
    [undefined, 'node-detached'],
    [{ platformContentId: 'video:2' }, 'identity-changed'],
    [{ pageInstanceId: 'page:2' }, 'page-instance-changed'],
    [{ surface: 'youtube:search' }, 'surface-changed'],
    [{ actionLabel: 'Hide' }, 'label-changed']
  ] as const)('rejects stale binding %#', async (overrides, code) => {
    const resolved = overrides === undefined ? undefined : binding(overrides)
    const adapter = createNativeDomAdapter({
      capability: () => capability,
      resolve: () => resolved,
      clock: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(22)
    })
    await expect(adapter.revalidate(attempt)).resolves.toEqual({
      state: 'invalid',
      code,
      elapsedMs: 12
    })
  })

  it.each([
    [
      'hidden',
      (control: HTMLButtonElement): void => {
        control.hidden = true
      },
      'control-hidden'
    ],
    [
      'aria-hidden',
      (control: HTMLButtonElement) =>
        control.setAttribute('aria-hidden', 'true'),
      'control-hidden'
    ],
    [
      'aria-disabled',
      (control: HTMLButtonElement) =>
        control.setAttribute('aria-disabled', 'true'),
      'control-hidden'
    ],
    [
      'disabled',
      (control: HTMLButtonElement): void => {
        control.disabled = true
      },
      'control-disabled'
    ],
    [
      'display',
      (control: HTMLButtonElement): void => {
        control.style.display = 'none'
      },
      'control-hidden'
    ],
    [
      'visibility',
      (control: HTMLButtonElement): void => {
        control.style.visibility = 'hidden'
      },
      'control-hidden'
    ]
  ] as const)('rejects a %s control', async (_name, mutate, code) => {
    const resolved = binding()
    mutate(resolved.control as HTMLButtonElement)
    const adapter = createNativeDomAdapter({
      capability: () => capability,
      resolve: () => resolved,
      clock: () => 5
    })
    await expect(adapter.revalidate(attempt)).resolves.toMatchObject({
      state: 'invalid',
      code
    })
  })

  it('returns a complete live revalidation', async () => {
    const resolved = binding()
    const adapter = createNativeDomAdapter({
      capability: () => capability,
      resolve: () => resolved,
      clock: () => 4
    })
    await expect(adapter.revalidate(attempt)).resolves.toEqual({
      state: 'valid',
      platform: 'youtube',
      surface: 'youtube:home',
      platformContentId: 'video:1',
      pageInstanceId: 'page:1',
      actionType: 'youtube:not-interested',
      actionLabel: 'Not interested',
      targetFingerprint: 'target:1',
      visible: true,
      enabled: true,
      nodeConnected: true,
      elapsedMs: 0
    })
  })

  it.each([
    [
      'verified',
      { state: 'verified', method: 'toast', at },
      { state: 'verified', verificationMethod: 'toast', evidenceAt: at }
    ],
    [
      'missing',
      { state: 'missing' },
      { state: 'uncertain', code: 'positive-evidence-missing' }
    ],
    [
      'interrupted',
      { state: 'interrupted' },
      { state: 'uncertain', code: 'verification-interrupted' }
    ]
  ] as const)(
    'maps %s positive evidence',
    async (_name, evidence, expected) => {
      const resolved = binding({
        verifyPositiveEvidence: vi.fn(async () => evidence)
      })
      const click = vi.spyOn(resolved.control, 'click')
      const adapter = createNativeDomAdapter({
        capability: () => capability,
        resolve: () => resolved
      })
      await expect(adapter.activate(attempt)).resolves.toEqual(expected)
      expect(click).toHaveBeenCalledOnce()
      expect(resolved.verifyPositiveEvidence).toHaveBeenCalledWith(2_000)
      await expect(adapter.activate(attempt)).resolves.toEqual({
        state: 'uncertain',
        code: 'attempt-already-activated'
      })
    }
  )

  it('does not click a lost control and maps verification exceptions', async () => {
    const lost = binding()
    lost.control.remove()
    const missingAdapter = createNativeDomAdapter({
      capability: () => capability,
      resolve: () => lost
    })
    await expect(missingAdapter.activate(attempt)).resolves.toEqual({
      state: 'uncertain',
      code: 'control-lost-before-activation'
    })

    const resolved = binding({
      verifyPositiveEvidence: vi.fn(async () => {
        throw new Error('interrupted')
      })
    })
    const adapter = createNativeDomAdapter({
      capability: () => capability,
      resolve: () => resolved
    })
    await expect(
      adapter.activate({ ...attempt, attemptId: 'attempt:throw' })
    ).resolves.toEqual({
      state: 'uncertain',
      code: 'verification-interrupted'
    })
  })
})
