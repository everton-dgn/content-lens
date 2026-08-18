export function requireAmoIdentifier(value: unknown): string

export function decideStoreStatus(input: {
  store: string
  version: string
  response: unknown
}): {
  decision: 'eligible' | 'already-present' | 'blocked'
}

export function queryStoreStatus(input: {
  store: 'chrome' | 'amo'
  version: string
  dryResponse?: string
  env?: Record<string, string | undefined>
}): Promise<{
  decision: 'eligible' | 'already-present' | 'blocked'
}>
