# Synchronization

Status: implemented experimental capability, disabled by default.

## Architecture

ContentLens always operates from local IndexedDB. Manual portability and
network synchronization share one filtered `SyncEnvelope`, validation,
three-way merge and recovery model. Network access begins only after the user
selects a configured provider, grants the exact host permission and accepts
the readable-data disclosure.

```text
IndexedDB profile
  <-> known base + three-way merge + journal
  <-> SyncProvider
  <-> storage selected by the user
```

The product can therefore remain free to operate without maintaining a ContentLens backend.

## Synchronized data

- Rules and exclusions.
- Blocked, allowed and prioritized identities.
- Thresholds and platform settings.
- Portable provider descriptors without credentials.
- Manual model catalog entries and model bindings.
- Schema, generation, tombstones and canonical digest.

## Local-only data

- Complete observation history.
- Thumbnail or media bytes.
- Transcripts.
- Per-item embeddings.
- Large decision cache.
- Page diagnostics.
- Provider access tokens.
- Consent receipts, journals and recovery snapshots.

## Profile format

Network operations transport a separate versioned `SyncEnvelope`. The digest
covers a canonical representation without the digest field. Provider version
tokens remain local transport metadata. A recursive allowlist and sensitive
field guard reject credential, token, cookie, vault and passphrase fields.
Imported providers are locked until a local credential and new consent exist.

## Provider interface

```ts
interface SyncProvider {
  connect(input?: { signal?: AbortSignal }): Promise<SyncProviderStatus>;
  disconnect(input?: { revoke?: boolean }): Promise<void>;
  read(input?: { signal?: AbortSignal }): Promise<SyncProviderRead>;
  initialize(envelope: SyncEnvelope, input?: SignalInput): Promise<SyncProviderCommit>;
  compareAndSwap(input: CasInput): Promise<SyncProviderCommit>;
  confirm(input: ConfirmationInput): Promise<SyncProviderConfirmation>;
  getStatus(): SyncProviderStatus;
}
```

The current generic conditional HTTP adapter requires HTTPS, except loopback
development, a strong ETag, `If-None-Match: *` for initialization and exact
`If-Match` for update or deletion. Redirects are handled manually and blocked,
credentials are omitted and authorization never crosses the declared origin.
Responses are capped at 10 MiB before JSON validation.

## Provider configuration

The experimental adapter reuses a user-configured non-browser provider origin,
credential binding and host permission. The user supplies an exact endpoint
path, remote object name, retention statement and revocation statement. This
generic transport is suitable only when that endpoint documents conditional
writes with strong ETags. Public presets remain blocked on provider-specific
authentication, policy and browser-store review.

### Manual local file portability

Manual JSON export and import are accepted portability features, not a network provider. Where supported, the File System Access API may update a user-selected file only after a separate permission and lifecycle review.

A user can place an exported file in a synchronized folder without granting ContentLens direct access to that cloud account. Automatic file writes require a separate permission and lifecycle review.

## Conflict resolution

The engine captures immutable base, local and remote snapshots. One-sided and
identical changes merge automatically. Concurrent changes to the same stable
entity create a durable conflict draft and perform no push. The user can select
the local value, remote value or a custom JSON value per conflict. Bulk local
or remote selection shows the conflict count and requires confirmation. The
result passes schema and digest validation before an exact-token CAS push.

Wall-clock timestamps and device IDs never choose a winner. A CAS mismatch
causes a fresh read and merge, with at most three attempts. Authentication,
permission, schema and token errors stop without retry. Temporary 429 and 503
responses use bounded full-jitter backoff and honor `Retry-After`.

## Encryption

Manual portability supports plaintext JSON and an encrypted envelope.

```text
passphrase
  -> PBKDF2-HMAC-SHA-256, 600,000 iterations
  -> encryption key
  -> authenticated encryption
  -> profile.enc
```

The encrypted format uses a random 16-byte salt, random 12-byte IV and
AES-256-GCM authenticated metadata. Its key domain is separate from the
credential vault. The passphrase and derived key are never persisted.

The passphrase and derived key never leave the device. Losing the passphrase means encrypted remote data cannot be recovered.

## Sync lifecycle

1. Persist local changes without advancing the known base.
2. Acquire the per-profile lock and capture base and local snapshots.
3. Read and validate the remote envelope and strong version token.
4. Persist the journal and recovery snapshot before committing a merged local
   candidate.
5. Push only with the exact token read for that remote snapshot.
6. Re-read and confirm the digest and token.
7. Advance the known base and finish the journal only after confirmation.

The service worker resumes incomplete nonterminal journals after restart.
Disconnect aborts the active request and rejects the one coalesced pending
intent. Restoring a recovery snapshot creates a new local revision, creates a
reverse snapshot, pauses synchronization and never pushes automatically.
Remote deletion is a separate exact-target confirmation and preserves all
local configuration.

## Current release limits

- Plaintext network sync requires explicit readable-data confirmation. The
  encrypted format is available for manual portability; encrypted network
  transport has no released provider preset.
- Tombstone compaction is implemented as a guarded core operation but remains
  unavailable in settings until all non-revoked known devices can prove the
  current generation.
- Generic conditional HTTP is experimental. A named public provider needs its
  own authentication, retention, revocation, CORS and browser-store evidence.
- Rollback quarantine metadata needs a monotonic remote revision contract from
  a concrete provider. Digest divergence alone is a valid concurrent edit and
  cannot safely be labeled rollback.
