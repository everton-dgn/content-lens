import type { DiagnosticCode, DiagnosticEvent } from '@/diagnostics/contracts'

type DiagnosticDefinition = Pick<
  DiagnosticEvent,
  | 'capability'
  | 'component'
  | 'phase'
  | 'recovery'
  | 'reportable'
  | 'scopeClass'
  | 'severity'
>

export const diagnosticCatalog = {
  'storage-unavailable': {
    severity: 'error',
    recovery: 'retryable',
    reportable: true,
    component: 'sidepanel',
    capability: 'local-profile',
    phase: 'load',
    scopeClass: 'storage'
  },
  'invalid-profile': {
    severity: 'critical',
    recovery: 'action-required',
    reportable: true,
    component: 'recovery',
    capability: 'local-profile',
    phase: 'load',
    scopeClass: 'storage'
  },
  'rule-save-failed': {
    severity: 'error',
    recovery: 'retryable',
    reportable: true,
    component: 'rule-management',
    capability: 'deterministic-rules',
    phase: 'save',
    scopeClass: 'storage'
  },
  'rule-remove-failed': {
    severity: 'error',
    recovery: 'retryable',
    reportable: true,
    component: 'rule-management',
    capability: 'deterministic-rules',
    phase: 'remove',
    scopeClass: 'storage'
  },
  'import-invalid': {
    severity: 'warning',
    recovery: 'action-required',
    reportable: false,
    component: 'profile-import',
    capability: 'profile-portability',
    phase: 'dry-run',
    scopeClass: 'storage'
  },
  'import-failed': {
    severity: 'error',
    recovery: 'retryable',
    reportable: true,
    component: 'profile-import',
    capability: 'profile-portability',
    phase: 'commit',
    scopeClass: 'storage'
  },
  'operation-response-uncertain': {
    severity: 'info',
    recovery: 'retryable',
    reportable: true,
    component: 'sidepanel',
    capability: 'local-profile',
    phase: 'commit',
    scopeClass: 'storage'
  },
  'recovery-restore-failed': {
    severity: 'error',
    recovery: 'retryable',
    reportable: true,
    component: 'recovery',
    capability: 'recovery',
    phase: 'restore',
    scopeClass: 'storage'
  },
  'local-reset-failed': {
    severity: 'error',
    recovery: 'action-required',
    reportable: true,
    component: 'recovery',
    capability: 'local-profile',
    phase: 'remove',
    scopeClass: 'storage'
  },
  'unexpected-ui-error': {
    severity: 'error',
    recovery: 'retryable',
    reportable: true,
    component: 'sidepanel',
    capability: 'local-profile',
    phase: 'load',
    scopeClass: 'global'
  },
  'assistance-provider-failed': {
    severity: 'warning',
    recovery: 'retryable',
    reportable: true,
    component: 'assistance',
    capability: 'ai-assistance',
    phase: 'generate',
    scopeClass: 'provider'
  },
  'assistance-refused': {
    severity: 'info',
    recovery: 'unsupported',
    reportable: false,
    component: 'assistance',
    capability: 'ai-assistance',
    phase: 'generate',
    scopeClass: 'provider'
  },
  'assistance-content-filtered': {
    severity: 'info',
    recovery: 'unsupported',
    reportable: false,
    component: 'assistance',
    capability: 'ai-assistance',
    phase: 'generate',
    scopeClass: 'provider'
  },
  'assistance-truncated': {
    severity: 'warning',
    recovery: 'retryable',
    reportable: true,
    component: 'assistance',
    capability: 'ai-assistance',
    phase: 'generate',
    scopeClass: 'provider'
  },
  'assistance-schema-rejected': {
    severity: 'warning',
    recovery: 'retryable',
    reportable: true,
    component: 'assistance',
    capability: 'ai-assistance',
    phase: 'validate',
    scopeClass: 'provider'
  },
  'assistance-draft-policy-rejected': {
    severity: 'warning',
    recovery: 'action-required',
    reportable: false,
    component: 'assistance',
    capability: 'ai-assistance',
    phase: 'validate',
    scopeClass: 'provider'
  },
  'assistance-stale': {
    severity: 'info',
    recovery: 'action-required',
    reportable: false,
    component: 'assistance',
    capability: 'ai-assistance',
    phase: 'preview',
    scopeClass: 'provider'
  },
  'assistance-cancelled': {
    severity: 'info',
    recovery: 'automatic',
    reportable: false,
    component: 'assistance',
    capability: 'ai-assistance',
    phase: 'generate',
    scopeClass: 'provider'
  },
  'assistance-dismissed': {
    severity: 'info',
    recovery: 'automatic',
    reportable: false,
    component: 'assistance',
    capability: 'ai-assistance',
    phase: 'dismiss',
    scopeClass: 'provider'
  },
  'similarity-route-unavailable': {
    severity: 'info',
    recovery: 'automatic',
    reportable: false,
    component: 'similarity',
    capability: 'similarity',
    phase: 'query',
    scopeClass: 'provider'
  },
  'similarity-index-corrupt': {
    severity: 'warning',
    recovery: 'automatic',
    reportable: true,
    component: 'similarity',
    capability: 'similarity',
    phase: 'quarantine',
    scopeClass: 'storage'
  },
  'similarity-version-mismatch': {
    severity: 'warning',
    recovery: 'automatic',
    reportable: true,
    component: 'similarity',
    capability: 'similarity',
    phase: 'rebuild',
    scopeClass: 'storage'
  },
  'similarity-evicted': {
    severity: 'info',
    recovery: 'automatic',
    reportable: false,
    component: 'similarity',
    capability: 'similarity',
    phase: 'evict',
    scopeClass: 'storage'
  },
  'similarity-abstained': {
    severity: 'info',
    recovery: 'automatic',
    reportable: false,
    component: 'similarity',
    capability: 'similarity',
    phase: 'query',
    scopeClass: 'storage'
  },
  'graph-conflict': {
    severity: 'warning',
    recovery: 'action-required',
    reportable: false,
    component: 'content-graph',
    capability: 'content-graph',
    phase: 'validate',
    scopeClass: 'storage'
  },
  'graph-rebuild-required': {
    severity: 'info',
    recovery: 'automatic',
    reportable: false,
    component: 'content-graph',
    capability: 'content-graph',
    phase: 'rebuild',
    scopeClass: 'storage'
  },
  'graph-corrupt': {
    severity: 'warning',
    recovery: 'automatic',
    reportable: true,
    component: 'content-graph',
    capability: 'content-graph',
    phase: 'quarantine',
    scopeClass: 'storage'
  },
  'native-feedback-unavailable': {
    severity: 'info',
    recovery: 'unsupported',
    reportable: false,
    component: 'native-feedback',
    capability: 'native-feedback',
    phase: 'review',
    scopeClass: 'adapter'
  },
  'native-feedback-review-changed': {
    severity: 'warning',
    recovery: 'action-required',
    reportable: false,
    component: 'native-feedback',
    capability: 'native-feedback',
    phase: 'revalidate',
    scopeClass: 'surface'
  },
  'native-feedback-uncertain': {
    severity: 'warning',
    recovery: 'action-required',
    reportable: true,
    component: 'native-feedback',
    capability: 'native-feedback',
    phase: 'verify',
    scopeClass: 'surface'
  },
  'native-feedback-circuit-open': {
    severity: 'warning',
    recovery: 'action-required',
    reportable: true,
    component: 'native-feedback',
    capability: 'native-feedback',
    phase: 'circuit',
    scopeClass: 'adapter'
  },
  'native-feedback-cooldown': {
    severity: 'info',
    recovery: 'action-required',
    reportable: false,
    component: 'native-feedback',
    capability: 'native-feedback',
    phase: 'activate',
    scopeClass: 'surface'
  }
} as const satisfies Record<DiagnosticCode, DiagnosticDefinition>
