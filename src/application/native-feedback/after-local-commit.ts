import type { NativeFeedbackCoordinator } from '@/application/native-feedback/coordinator'
import type { NativeFeedbackAttempt } from '@/core/feedback/native-contracts'
import type { OperationResponse } from '@/core/operations/journal'

export async function offerNativeFeedbackAfterLocalCommit(
  localResult: OperationResponse<unknown>,
  coordinator: NativeFeedbackCoordinator,
  input: Omit<
    Parameters<NativeFeedbackCoordinator['offer']>[0],
    'localCommitState'
  >
): Promise<NativeFeedbackAttempt | undefined> {
  if (localResult.state !== 'committed') return undefined
  return coordinator.offer({ ...input, localCommitState: 'committed' })
}
