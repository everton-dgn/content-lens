export type ProbeRuntimeState = 'ready' | 'degraded' | 'blocked'

export type CapabilityState =
  | 'supported'
  | 'limited'
  | 'blocked'
  | 'unsupported'
  | 'unknown'

export interface CapabilityProbeContext {
  browserEnvironment: string
  checkedAt: string
  productVersion: string
}

export interface CapabilityProbeDefinition {
  consent?: () => boolean | Promise<boolean>
  fallback: string
  id: string
  invalidatedBy: readonly string[]
  permission?: () => boolean | Promise<boolean>
  required: boolean
  run: () => CapabilityProbeOutcome | Promise<CapabilityProbeOutcome>
  timeoutMs?: number
}

export type CapabilityProbeOutcome =
  | { status: 'available' }
  | { status: 'limited'; reason: string }
  | { status: 'absent'; reason: string }

export interface CapabilityProbeResult {
  browserEnvironment: string
  cacheKey: string
  checkedAt: string
  fallback: string
  id: string
  invalidatedBy: readonly string[]
  productVersion: string
  reason: string
  required: boolean
  state: CapabilityState
}

const timedOut = Symbol('capability-probe-timeout')

const withTimeout = async <Result>(
  run: () => Result | Promise<Result>,
  timeoutMs: number
): Promise<Result | typeof timedOut> => {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      Promise.resolve().then(run),
      new Promise<typeof timedOut>(resolve => {
        timer = setTimeout(() => resolve(timedOut), timeoutMs)
      })
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

type ProbeExecution =
  | { kind: 'blocked'; reason: string }
  | { kind: 'outcome'; outcome: CapabilityProbeOutcome }
  | { kind: 'unknown'; reason: string }

export const probeCapability = async (
  definition: CapabilityProbeDefinition,
  context: CapabilityProbeContext
): Promise<CapabilityProbeResult> => {
  const result = (
    state: CapabilityState,
    reason: string
  ): CapabilityProbeResult => ({
    ...context,
    cacheKey: [
      definition.id,
      context.productVersion,
      context.browserEnvironment
    ].join(':'),
    fallback: definition.fallback,
    id: definition.id,
    invalidatedBy: definition.invalidatedBy,
    reason,
    required: definition.required,
    state
  })

  const execution = await withTimeout<ProbeExecution>(async () => {
    try {
      if (definition.permission && !(await definition.permission())) {
        return { kind: 'blocked', reason: 'permission-denied' }
      }
      if (definition.consent && !(await definition.consent())) {
        return { kind: 'blocked', reason: 'consent-missing' }
      }
    } catch {
      return { kind: 'unknown', reason: 'gate-threw' }
    }

    try {
      return { kind: 'outcome', outcome: await definition.run() }
    } catch {
      return { kind: 'unknown', reason: 'probe-threw' }
    }
  }, definition.timeoutMs ?? 250)

  if (execution === timedOut) {
    return result('unknown', 'probe-timed-out')
  }
  if (execution.kind === 'blocked') {
    return result('blocked', execution.reason)
  }
  if (execution.kind === 'unknown') {
    return result('unknown', execution.reason)
  }

  const { outcome } = execution
  if (outcome.status === 'available') {
    return result('supported', 'probe-passed')
  }
  if (outcome.status === 'limited') {
    return result('limited', outcome.reason)
  }
  return result('unsupported', outcome.reason)
}

export const deriveRuntimeState = (
  results: readonly CapabilityProbeResult[]
): ProbeRuntimeState => {
  const required = results.filter(result => result.required)

  if (
    required.length === 0 ||
    required.some(result => result.state !== 'supported')
  ) {
    return 'blocked'
  }

  return results.some(
    result => !result.required && result.state !== 'supported'
  )
    ? 'degraded'
    : 'ready'
}
