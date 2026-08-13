# Data contracts

## Principles

- Portable profile data is smaller than the local database.
- Every persisted contract has an explicit schema version.
- Unknown remote input is untrusted.
- Validation occurs before merge or migration.
- Durable user intent is never silently discarded.

## Profile envelope

```ts
type SchemaVersion = {
  major: number;
  minor: number;
};

type ProfileEnvelope = {
  schemaVersion: SchemaVersion;
  profileId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  rules: Rule[];
  feedbackExamples: FeedbackExample[];
  settings: PortableSettings;
  extensions?: Record<string, unknown>;
};
```

The envelope excludes credentials, raw media, transcripts, complete history, page diagnostics and disposable embeddings.

## Rule drafts

A rule draft is local, editable and non-authoritative:

```ts
type RuleDraft = {
  draftId: string;
  baseRevision: number;
  origin: "manual" | "item-action" | "assisted-suggestion";
  description: string;
  effect: "promote" | "allow" | "reduce" | "hide";
  scope: RuleScope;
  examples: RuleExample[];
  exclusions: RuleExample[];
  inferredFields: string[];
  capabilityVersion?: string;
};
```

Creating or updating a draft does not change active rules. Saving validates the draft against its `baseRevision`, displays any conflicting profile change and commits one new profile revision. A recoverable failure retains the complete draft.

Drafts are excluded from portable export by default. A future draft-export behavior requires an explicit schema field and privacy review.

## Operation records

Operations that can outlive one service-worker event use installation-local records:

```ts
type OperationRecord = {
  operationId: string;
  type: string;
  state:
    | "created"
    | "acknowledged"
    | "running"
    | "committed"
    | "cancelled"
    | "failed"
    | "compensated";
  targetFingerprint: string;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  retryable: boolean;
  errorCode?: string;
};
```

An operation ID is idempotent within its retention window. A retry reuses the original ID or records a causal link, so a worker restart cannot create duplicate feedback or rules. Operation records exclude raw content, rule text, credentials and provider payloads.

## Entity identity

- IDs are stable within one profile.
- Platform identities include the platform namespace.
- Display names are never durable identity keys.
- Deleted durable entities remain represented by a deletion record while import or future sync can encounter older copies.

## Validation

An importer MUST:

1. Enforce a maximum payload size.
2. Parse without executing data.
3. Validate field types, ranges and collection sizes.
4. Reject unknown required schema versions.
5. Quarantine invalid data.
6. Present a summary before replacing profile state.
7. Preserve a recoverable local snapshot.

## Revision semantics

`revision` is a local monotonic profile revision. It is not a distributed clock and MUST NOT be used alone to merge concurrent devices.

Timestamps are metadata for display and diagnostics. They MUST NOT silently resolve concurrent edits.

UI acknowledgement and durable profile revision are separate events. The interface reports success only after the transaction commits. A pending acknowledgement cannot be used as proof that a rule is active.

## Migration recovery snapshots

A migration recovery snapshot is local recovery evidence rather than part of the portable profile. At most one validated pre-migration snapshot is retained for seven days. It is excluded from normal export and synchronization, removed after a completed restore, and included in "delete all local ContentLens data".

## Import and export

- Export is deterministic for the same logical profile.
- Export redacts local-only fields.
- Import supports dry-run validation.
- Replace and merge are separate user choices.
- Merge is limited to a reviewed algorithm accepted by ADR.
- Until then, conflicting entities require explicit resolution.

## Limits

Concrete collection and payload limits are frozen by the storage feasibility spec. Limits MUST exist before accepting untrusted imported or remote profiles.

## Schema changes

- `major` increments when an older reader cannot safely preserve meaning.
- `minor` increments for backward-compatible additions that older readers may safely preserve or ignore.
- Both values are non-negative integers.

Every schema change includes:

- Before and after examples.
- Forward migration.
- Failure test.
- Compatibility classification.
- Rollback or recovery behavior.
- Changelog entry.
