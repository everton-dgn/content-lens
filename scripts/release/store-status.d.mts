export function decideStoreStatus(input: {
  store: string
  version: string
  response: unknown
}): {
  decision: 'eligible' | 'already-present' | 'blocked'
}
