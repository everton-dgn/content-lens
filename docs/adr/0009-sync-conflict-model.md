# ADR 0009: Sync conflict model

Status: Accepted

## Context

The initial sync concept used entity timestamps and device ID as a deterministic tie-breaker. Device clocks can differ, and silent last-write-wins can delete rules or recreate removed intent.

## Problem

ContentLens needs provider-neutral conflict handling that preserves user intent and remains understandable.

## Considered options

1. Timestamp last-write-wins.
2. Three-way merge with known base.
3. Per-entity version vectors.
4. Operation log or specialized CRDT.
5. Manual conflict resolution for every concurrent entity.

## Decision

Use a durable known base, deterministic three-way merge and provider CAS:

- Timestamp-only automatic merge is prohibited.
- Every remote write uses the exact strong version token read with the remote
  snapshot.
- Independent changes and identical concurrent changes merge automatically.
- Concurrent changes to the same stable entity create a durable conflict
  draft and perform no push.
- Manual resolution supports local, remote and schema-validated custom values.
- Deletion is represented by a generation-bound tombstone. A generation
  mismatch creates an explicit rebase conflict.
- The known base advances only after the local candidate and matching remote
  digest are confirmed.

## Evaluation criteria

- Zero silent loss or resurrection in concurrent tests.
- Provider portability.
- Metadata and storage cost.
- Offline behavior.
- Migration complexity.
- User comprehension and recovery.

## Consequences

- Network sync remains disabled by default and experimental.
- Portable profile revision is not treated as a distributed clock.
- A provider without proven CAS cannot be connected.
- Tombstone compaction remains blocked until the installation can prove that
  every non-revoked known device confirmed the current generation.

## Revisit trigger

Revisit if provider evidence shows that strong ETag CAS is insufficient or if
the device-generation registry changes the compaction model.
