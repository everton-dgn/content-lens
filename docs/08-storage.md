# Storage

## Principles

- Local storage is mandatory and authoritative.
- The extension works offline.
- Durable user intent is separated from disposable model cache.
- Synchronized data is a subset of the local database.
- Storage migrations are versioned and reversible where practical.

## IndexedDB stores

### `profile`

Singleton settings, thresholds, enabled platforms, classifier configuration and current profile revision.

### `rules`

Identity, exact, semantic and preference rules indexed by kind, platform, target identity and update time.

### `feedback`

Explicit actions and corrected labels. This is durable unless the user deletes it.

### `decisions`

Cached per-content decisions keyed by content fingerprint, profile revision and classifier version.

### `cache`

Disposable versioned entries for validated model signals and other
recomputable data. Model entries store canonical `ClassificationSignals`, not
raw provider responses. Their keys bind the content, profile, route,
capability, provider, model, task, prompt, schema, preprocessing and policy
versions. Credentials and credential identities are excluded.

Validated assistance drafts and explanations may use the same disposable
store. Their keys contain an input fingerprint plus provider, model, route,
prompt, schema, capability and profile versions. Raw intent, prompt and
provider response are not cache keys or cached values.

Dismissed proposal state uses `assistance-suppression:v1:<fingerprint>` entries.
The value contains only fingerprint, evidence version, dismissal count,
cooldown timestamps and reactivation state. It contains no intent, example,
exclusion or provider response. Each dismissal creates a 30-day cooldown.
Three dismissals suppress the same fingerprint until the evidence version
changes or the user explicitly reactivates it.

### `content`

Bounded metadata required for recent history, review and debugging. It is not a complete browsing history.

### `providers`

Versioned, non-secret `ProviderDescriptor` records keyed by
`providerConfigId`. A record may contain an opaque `credentialRef`, but never a
credential value.

### `models`

Provider, user and built-in model descriptors keyed by the compound
`providerConfigId` and `modelId` reference.

### `consents`

Local, revocable `ConsentReceipt` records keyed by the complete canonical
`ConsentKey`. Receipts contain policy and data-flow metadata, not credentials.

### `credentials`

Dedicated local credential records. `session-only` persists binding metadata
without the value. `passphrase-wrapped` persists only the versioned encrypted
envelope. `external-vault` persists the external reference and, when selected,
an encrypted proxy-token envelope. Session values, passphrases, derived keys
and unlocked plaintext are never written.

### `embeddings`

Optional local vectors, topic centroids and example references when an accepted similarity capability is enabled. Per-item embeddings are evictable.

### `graph`

Optional graph nodes and edges used by accepted similarity, duplication or primary-source capabilities.

### Sync metadata in `snapshots`

Experimental synchronization stores only local control metadata in the shared
snapshot store:

- random sync identity and generation;
- last confirmed known base;
- active local sync projection;
- provider and remote-object transport token;
- connection consent, schedule and finite runtime state;
- one durable conflict draft per sync profile;
- one restart journal per sync profile;
- validated recovery snapshots keyed by operation.

The remote envelope, journal and recovery snapshot are separate contracts.
Credentials, consent receipts, observed content, cache and diagnostic payloads
never enter the remote envelope. Browser extension storage remains outside the
credential trust boundary described by [ADR-0010](adr/0010-credential-handling.md).

## Lightweight browser storage

`chrome.storage.local` may contain non-sensitive bootstrap settings needed before IndexedDB opens. `chrome.storage.sync` is prohibited in the MVP because it is a browser-managed network data flow. Any future use is treated as a sync provider and requires the same privacy, consent and compatibility gates.

The current `session-only` provider implementation uses privileged in-memory
state. It intentionally returns to `locked` when that extension context is
recreated. Moving it to `storage.session` requires packaged-browser evidence
that access is restricted to trusted extension contexts in every supported
browser.

## Retention

| Data | Default retention |
| --- | --- |
| Rules and allow lists | Until user deletion |
| Explicit feedback | Until user deletion |
| Recent decision explanations | Bounded by age and count |
| Content metadata | Short local history |
| Thumbnails and media bytes | Temporary cache |
| Per-item embeddings | Evictable cache |
| Transcripts | Disabled or temporary |
| Sync conflicts | Until resolved plus bounded history |
| Sync recovery snapshots | At least seven days and until explicit deletion after confirmation |
| Validated migration recovery snapshot | At most one for seven days |
| Provider and model descriptors | Until provider removal or all-data deletion |
| Consent receipts | Until revocation, provider disconnect or all-data deletion |
| Wrapped credential envelope | Until replacement, disconnect or all-data deletion |
| Session credential value | Current privileged extension-context lifetime |
| Assistance draft and explanation cache | Disposable bounded cache |
| Assistance dismissal cooldown | 30 days per dismissal |
| Suppressed proposal fingerprint | Until evidence-version change, reactivation or cache deletion |

Retention controls are visible in settings.

## Migrations

Each database schema has a monotonically increasing version. A migration:

1. Validates the prior shape.
2. Writes new fields with explicit defaults.
3. Preserves unknown provider extensions.
4. Records completion.
5. Leaves a readable error if recovery fails.

Profile export runs against a stable versioned schema, not raw IndexedDB records.

Database version 3 adds `providers`, `models`, `consents` and `credentials` in
one IndexedDB upgrade transaction. Existing profile, rules, feedback and
recovery stores remain untouched. A close/reopen test verifies rehydration and
proves that session and previously unlocked plaintext do not survive.

Database version 4 adds `rssEntries` and `rssRuntime`. `rssEntries` stores one
bounded batch of at most 100 normalized entries per random `feedId`, which
also limits the global total to 10,000 for the 100-feed ceiling. `rssRuntime`
stores only scheduling state and finite diagnostic codes. Removing a feed
replaces both records with an empty entry batch and a `removed` tombstone;
rules scoped to the stable `feedId` remain separate.

Database version 5 adds disposable similarity and graph stores. Similarity
stores contain bounded vectors, typed relations, relation suppressions, durable
clusters, expiring reviewed batch actions, runtime state and rebuild
checkpoints. Graph stores contain bounded nodes, typed edges, one active
manifest and rebuild checkpoints. Their combined budget is 100 MiB. The
portable profile, synchronization envelopes and recovery exports do not read
these stores. Clearing derived intelligence preserves profile, rules, feedback
and recent normalized observations used to reconstruct exact matching.

Database version 6 adds `nativeFeedbackAttempts` and
`nativeFeedbackRuntime`. A pending review is retained for at most 24 hours.
Terminal attempts are retained for at most 30 days, with a total ceiling of
1,000 records. Disabling native feedback cancels pending reviews and preserves
terminal evidence. These stores stay outside profile export, synchronization
and provider state.

## Cache invalidation

Decisions are invalidated when any of these change:

- Content fingerprint.
- Profile revision.
- Relevant rule revision.
- Classifier or model version.
- Archetype definition version.

Model-signal cache entries also become incompatible when language, platform,
surface, task, route, provider fingerprint, capability fingerprint, prompt
contract, output schema, preprocessing or policy version changes. A cache read
must parse the complete canonical signal schema before use. An unavailable
cache or failed cache write cannot revoke a valid live classification result.

Disconnecting or removing a provider invalidates its configured route before a
cached provider result can be reused. Consent and permission checks still apply
to new requests; cache reuse never causes network access.

## Data deletion

The user can separately clear:

- Disposable caches.
- Recent content history.
- Feedback examples.
- Rules and profile.
- Provider connection state.
- Migration recovery snapshots, journals and quarantined evidence.
- All local ContentLens data.

Profile export and local deletion behavior follow [Data contracts](data-contracts.md).
Deleting the remote sync object is a separate confirmed operation and never
deletes the local profile. A normal disconnect preserves both local data and
the remote object.
