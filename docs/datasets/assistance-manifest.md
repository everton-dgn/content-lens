# AI assistance evaluation manifest

## Status

Strict assistance schemas, prompt boundaries, local draft policy, routed
execution, pure preview, stale checks, batch threshold and proposal suppression
are implemented. The visual editor and moderated crossover evidence are not
complete, so assistance is not approved as a default user flow.

Automated fixtures prove authority and failure contracts. They do not prove
that people understand scope, warnings or confirmation.

## Required automated evidence

- Valid draft and explanation fixtures for every supported provider adapter.
- Complete rejection of action fields, unknown fields and incompatible schema
  versions.
- Zero durable mutation for malformed output, prompt injection, timeout,
  cancellation, refusal, filtering and truncation.
- Scope expansion, effect escalation and protected-exception warnings.
- Stale profile revision and stale content identity rejection.
- Preview with representative matches and protected exceptions.
- Three-correction minimum for batch proposals.
- 30-day dismissal cooldown and third-dismissal suppression.
- Diagnostic export with zero intent, prompt, response, example, exclusion or
  credential.

## Moderated crossover evidence

At least eight first-time participants complete matched manual and assisted
tasks. The frozen report records:

```yaml
study_id: string
version: string
frozen_at: ISO-8601 timestamp
participant_count: number
task_manifest_sha256: string
counterbalance_method: string
manual:
  median_decisions: number
  median_time_ms: number
assisted:
  median_decisions: number
  median_time_ms: number
completed_without_help: number
mistaken_confirmations: number
immediate_undos: number
corrections: number
deviations: string
```

The assisted flow must reduce median decisions by at least 25%, regress median
time by no more than 10% and allow at least seven participants to complete
without help. Mistaken confirmation, immediate undo and correction rates must
not exceed the manual baseline.

No usability metric is currently claimed.

## Relevant contracts and tests

- [ADR 0011](../adr/0011-reviewable-ai-assistance.md)
- `tests/contract/assistance.test.ts`
- `tests/contract/assistance-provider-adapters.test.ts`
- `tests/security/assistance-prompt-injection.test.ts`
- `tests/runtime/assistance-preview.test.ts`
- `tests/runtime/routed-assistance.test.ts`
- `tests/runtime/assistance-suppression.test.ts`
- `tests/contract/browser-ai.test.ts`
- `tests/runtime/browser-ai-bridge.test.ts`
