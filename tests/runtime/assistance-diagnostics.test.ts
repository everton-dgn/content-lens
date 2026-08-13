import { describe, expect, it } from 'vitest'

import { assistanceDiagnosticCode } from '@/application/assistance/diagnostics'

describe('assistance diagnostics', () => {
  it.each([
    ['provider-unavailable', 'assistance-provider-failed'],
    ['timeout', 'assistance-provider-failed'],
    ['refused', 'assistance-refused'],
    ['content-filtered', 'assistance-content-filtered'],
    ['truncated', 'assistance-truncated'],
    ['invalid-output', 'assistance-schema-rejected'],
    ['draft-policy', 'assistance-draft-policy-rejected'],
    ['stale', 'assistance-stale'],
    ['cancelled', 'assistance-cancelled'],
    ['dismissed', 'assistance-dismissed']
  ] as const)('maps %s to %s', (input, expected) => {
    expect(assistanceDiagnosticCode(input)).toBe(expected)
  })
})
