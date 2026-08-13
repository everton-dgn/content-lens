# ADR 0012: Truthful idempotent operations

Status: Accepted

## Context

Manifest V3 workers can stop between acknowledgement and durable commit. UI actions, retries and batch work can also fail partially. If the interface equates a click with success, it can claim that a rule is active when persistence failed or duplicate an action after restart.

## Considered options

1. Update the UI only after every operation completes.
2. Use optimistic UI without durable operation identity.
3. Separate acknowledgement from durable completion and make mutations idempotent.

## Decision

Every user mutation that can cross an asynchronous or restart boundary uses an idempotent operation ID and explicit state.

- UI acknowledgement is distinct from durable success.
- A committed result links to the resulting profile revision when applicable.
- Retry reuses the original operation or a recorded causal link.
- Partial success names completed and failed targets.
- Cancellation is a terminal state that records whether any effect committed before cancellation.
- Recovery retries only unfinished work.
- Repeated equivalent failures are deduplicated.
- Operation records are bounded, local and redacted.
- Local reversible operations prefer immediate undo; irreversible external actions require scoped confirmation.

## Tradeoffs

- Operation state and retention add implementation and test cost.
- Truthful pending and partial states make failure handling more complex.
- Worker restart, retry and batch behavior become deterministic and observable.
- The user keeps completed work and input instead of repeating a full task.

## Consequences

- A rule is shown as active only after its transaction commits.
- Retry cannot create duplicate feedback or durable rules within the idempotency window.
- Diagnostics can identify operation class and error code without retaining raw content.
- Storage, feedback, UI and runtime contracts share the same operation-state vocabulary.

## Validation

- Worker termination before and after commit.
- Duplicate request delivery and repeated retry.
- Storage abort, quota failure and partial batch completion.
- Compensation and undo after a committed local action.
- UI assertions for acknowledged, pending, committed, failed and partial states.

## Revisit trigger

Revisit when the selected storage runtime proves that a state can be removed or simplified without weakening restart safety, truthfulness or recovery.
