const gestureBrand = Symbol('contentlens.native-feedback.trusted-gesture')

export type TrustedUserGesture = {
  readonly attemptId: string
  readonly reviewFingerprint: string
  readonly occurredAt: string
  readonly [gestureBrand]: true
}

export function issueTrustedUserGesture(
  event: Pick<Event, 'isTrusted' | 'type'>,
  input: { attemptId: string; reviewFingerprint: string; occurredAt: string }
): TrustedUserGesture | undefined {
  if (!event.isTrusted || !['click', 'keydown'].includes(event.type)) {
    return undefined
  }
  return Object.freeze({ ...input, [gestureBrand]: true as const })
}

export function isTrustedUserGesture(
  value: unknown
): value is TrustedUserGesture {
  return (
    typeof value === 'object' &&
    value !== null &&
    gestureBrand in value &&
    (value as Record<symbol, unknown>)[gestureBrand] === true
  )
}
