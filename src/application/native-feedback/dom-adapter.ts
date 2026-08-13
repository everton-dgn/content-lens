import type { NativeFeedbackAdapterPort } from '@/application/native-feedback/coordinator'
import type {
  NativeFeedbackActivation,
  NativeFeedbackAttempt,
  NativeFeedbackCapability,
  NativeFeedbackRevalidation
} from '@/core/feedback/native-contracts'

export type NativeDomBinding = {
  target: Element
  control: HTMLElement
  platformContentId: string
  pageInstanceId: string
  surface: string
  actionLabel: string
  targetFingerprint: string
  verifyPositiveEvidence(
    timeoutMs: number
  ): Promise<
    | { state: 'verified'; method: string; at: string }
    | { state: 'missing' | 'interrupted' }
  >
}

export type NativeDomResolver = (
  attempt: NativeFeedbackAttempt
) => NativeDomBinding | undefined

function visiblyInteractive(element: HTMLElement) {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  return (
    element.isConnected &&
    !element.hidden &&
    element.getAttribute('aria-hidden') !== 'true' &&
    element.getAttribute('aria-disabled') !== 'true' &&
    !('disabled' in element && Boolean(element.disabled)) &&
    style?.display !== 'none' &&
    style?.visibility !== 'hidden'
  )
}

export function createNativeDomAdapter(input: {
  capability: NativeFeedbackAdapterPort['capability']
  resolve: NativeDomResolver
  clock?: () => number
}): NativeFeedbackAdapterPort {
  const activated = new Set<string>()
  const clock = input.clock ?? performance.now.bind(performance)
  return {
    capability: input.capability,
    async revalidate(attempt): Promise<NativeFeedbackRevalidation> {
      const startedAt = clock()
      const binding = input.resolve(attempt)
      const elapsedMs = Math.max(0, clock() - startedAt)
      if (!binding)
        return { state: 'invalid', code: 'node-detached', elapsedMs }
      if (!binding.target.isConnected || !binding.control.isConnected) {
        return { state: 'invalid', code: 'node-detached', elapsedMs }
      }
      if (binding.platformContentId !== attempt.platformContentId) {
        return { state: 'invalid', code: 'identity-changed', elapsedMs }
      }
      if (binding.pageInstanceId !== attempt.pageInstanceId) {
        return { state: 'invalid', code: 'page-instance-changed', elapsedMs }
      }
      if (binding.surface !== attempt.surface) {
        return { state: 'invalid', code: 'surface-changed', elapsedMs }
      }
      if (binding.actionLabel !== attempt.review.actionLabel) {
        return { state: 'invalid', code: 'label-changed', elapsedMs }
      }
      if (!visiblyInteractive(binding.control)) {
        return {
          state: 'invalid',
          code:
            'disabled' in binding.control && binding.control.disabled
              ? 'control-disabled'
              : 'control-hidden',
          elapsedMs
        }
      }
      return {
        state: 'valid',
        platform: attempt.platform,
        surface: binding.surface,
        platformContentId: binding.platformContentId,
        pageInstanceId: binding.pageInstanceId,
        actionType: attempt.actionType,
        actionLabel: binding.actionLabel,
        targetFingerprint: binding.targetFingerprint,
        visible: true,
        enabled: true,
        nodeConnected: true,
        elapsedMs
      }
    },
    async activate(attempt): Promise<NativeFeedbackActivation> {
      if (activated.has(attempt.attemptId)) {
        return { state: 'uncertain', code: 'attempt-already-activated' }
      }
      const binding = input.resolve(attempt)
      if (!binding || !visiblyInteractive(binding.control)) {
        return { state: 'uncertain', code: 'control-lost-before-activation' }
      }
      activated.add(attempt.attemptId)
      binding.control.click()
      try {
        const evidence = await binding.verifyPositiveEvidence(
          input.capability(attempt).timeoutMs
        )
        return evidence.state === 'verified'
          ? {
              state: 'verified',
              verificationMethod: evidence.method,
              evidenceAt: evidence.at
            }
          : {
              state: 'uncertain',
              code:
                evidence.state === 'interrupted'
                  ? 'verification-interrupted'
                  : 'positive-evidence-missing'
            }
      } catch {
        return { state: 'uncertain', code: 'verification-interrupted' }
      }
    }
  }
}

export function supportedFixtureCapability(
  input: Omit<NativeFeedbackCapability, 'state' | 'lastLiveSmokeAt'> & {
    lastLiveSmokeAt: string
  }
): NativeFeedbackCapability {
  return { ...input, state: 'supported' }
}
