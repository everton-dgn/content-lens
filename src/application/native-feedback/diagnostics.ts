import {
  type NativeFeedbackAttempt,
  type NativeFeedbackDiagnostic,
  nativeFeedbackDiagnosticSchema
} from '@/core/feedback/native-contracts'

export function createNativeFeedbackDiagnostic(
  attempt: NativeFeedbackAttempt,
  circuitState: 'closed' | 'open'
): NativeFeedbackDiagnostic {
  return nativeFeedbackDiagnosticSchema.parse({
    platform: attempt.platform,
    surface: attempt.surface,
    actionType: attempt.actionType,
    adapterVersion: attempt.adapterVersion,
    status: attempt.state,
    latencyBucket: attempt.latencyBucket ?? 'over-100ms',
    verificationMethod: attempt.verificationMethod ?? 'none',
    circuitState
  })
}
