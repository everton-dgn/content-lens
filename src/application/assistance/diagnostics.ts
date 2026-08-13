import type { DiagnosticCode } from '@/diagnostics/contracts'

export function assistanceDiagnosticCode(
  code:
    | 'provider-unavailable'
    | 'timeout'
    | 'refused'
    | 'content-filtered'
    | 'truncated'
    | 'invalid-output'
    | 'draft-policy'
    | 'stale'
    | 'cancelled'
    | 'dismissed'
): DiagnosticCode {
  switch (code) {
    case 'refused':
      return 'assistance-refused'
    case 'content-filtered':
      return 'assistance-content-filtered'
    case 'truncated':
      return 'assistance-truncated'
    case 'invalid-output':
      return 'assistance-schema-rejected'
    case 'draft-policy':
      return 'assistance-draft-policy-rejected'
    case 'stale':
      return 'assistance-stale'
    case 'cancelled':
      return 'assistance-cancelled'
    case 'dismissed':
      return 'assistance-dismissed'
    case 'provider-unavailable':
    case 'timeout':
      return 'assistance-provider-failed'
  }
}
