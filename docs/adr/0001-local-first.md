# ADR 0001: Local-first operation

Status: Accepted

## Context

ContentLens processes browsing preferences and content metadata that may reveal sensitive interests. A mandatory hosted service would add operating cost, latency, account friction and a central data store.

## Considered options

1. ContentLens-hosted backend as the source of truth.
2. Browser local storage as the source of truth with optional sync.
3. Cloud-provider storage as the source of truth.

## Decision

IndexedDB is the primary durable store. Core filtering works offline and without an account. Synchronization is optional and cannot be required for normal operation.

## Tradeoffs

- Local schema migrations and backup need careful design.
- Device loss can lose unsynchronized data.
- Local models are constrained by browser resources.
- Privacy, latency and operating cost improve.

## Consequences

- Every feature has an offline behavior.
- Sync providers merge into local state.
- Provider failure never removes local filtering.
- Remote telemetry is absent by default.

## Revisit trigger

Revisit only if a required product capability cannot operate locally and the user benefit justifies a separate opt-in service.
