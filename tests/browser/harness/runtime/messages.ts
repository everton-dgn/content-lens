import type { WorkerBenchmarkResult } from './benchmark'
import type { ExtensionCapabilityEvidence } from './runtime-capabilities'

export interface RuntimeOperationMessage {
  effectId: string
  mode: 'commit' | 'commit-then-hang'
  operationId: string
  type: 'phase0-runtime-operation'
}

export interface RuntimeCapabilityMessage {
  type: 'phase0-runtime-capabilities'
}

export interface RuntimeBenchmarkMessage {
  candidateIds: string[]
  type: 'phase0-runtime-benchmark'
}

export interface RuntimeCommitObservedMessage {
  operationId: string
  type: 'phase0-runtime-commit-observed'
}

export type RuntimeRequestMessage =
  | RuntimeOperationMessage
  | RuntimeCapabilityMessage
  | RuntimeBenchmarkMessage

export type RuntimeResponse =
  | Awaited<
      ReturnType<typeof import('./indexeddb-journal').commitIndexedDbOperation>
    >
  | ExtensionCapabilityEvidence
  | WorkerBenchmarkResult

export const isRuntimeRequest = (
  message: unknown
): message is RuntimeRequestMessage => {
  if (!message || typeof message !== 'object' || !('type' in message)) {
    return false
  }

  return (
    message.type === 'phase0-runtime-operation' ||
    message.type === 'phase0-runtime-capabilities' ||
    message.type === 'phase0-runtime-benchmark'
  )
}
