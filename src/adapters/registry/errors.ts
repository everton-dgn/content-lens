export type AdapterRegistryErrorCode =
  | 'duplicate-platform'
  | 'duplicate-origin'
  | 'duplicate-surface'
  | 'duplicate-relation'
  | 'duplicate-trait'
  | 'duplicate-extractable-field'
  | 'duplicate-visual-action'
  | 'duplicate-permission'
  | 'duplicate-browser'
  | 'duplicate-spa-event'
  | 'incompatible-contract-version'
  | 'invalid-origin'
  | 'invalid-platform'
  | 'invalid-surface'
  | 'surface-platform-mismatch'
  | 'invalid-relation'
  | 'invalid-trait'
  | 'invalid-extractable-field'
  | 'invalid-visual-action'
  | 'invalid-permission'
  | 'invalid-browser'
  | 'invalid-live-smoke-date'
  | 'missing-capability'
  | 'unknown-capability'
  | 'invalid-capability-state'
  | 'invalid-diagnostic-code'
  | 'invalid-spa-event'
  | 'invalid-route-match'
  | 'undeclared-route-surface'

export class AdapterRegistryError extends Error {
  readonly code: AdapterRegistryErrorCode
  readonly detail: string

  constructor(code: AdapterRegistryErrorCode, detail: string) {
    super(`${code}: ${detail}`)
    this.name = 'AdapterRegistryError'
    this.code = code
    this.detail = detail
  }
}
