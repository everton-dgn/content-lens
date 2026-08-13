# Privacy and security

## Default data flow

By default, content metadata, rules, feedback, media analysis and embeddings stay on the device. No ContentLens account is required.

## Data that does not leave the device by default

- Observed titles and post text.
- Thumbnail and media bytes.
- Browsing and classification history.
- Transcripts.
- Per-item embeddings.
- Decision cache.
- Rules, profile and corrections when sync is disabled.

## Optional external data flows

### Sync provider

Network synchronization is experimental and disabled by default. After the
user selects a configured endpoint, grants its exact host permission and
accepts the disclosure, the provider receives only the filtered synchronized
profile subset described in [Synchronization](09-sync.md). The setup screen
shows the included categories, readable plaintext warning, provider retention
statement and revocation method before the first request.

### Cloud inference

Cloud models are optional. Before enabling one, ContentLens shows:

- Provider.
- Fields that may be sent.
- Whether images are included.
- Retention controls known to ContentLens.
- Estimated request frequency.
- How to disable and remove credentials.

Cloud inference must be scoped to unresolved items. A blocked channel never needs to be sent.

AI-assisted rule drafting is a separate task and consent surface from feed classification. A provider accepted for classification does not automatically receive rule text, examples, exclusions or preference history. The draft screen shows the exact categories required before any cloud-assisted request.

Browser-provided AI runs inside a trusted extension document and sends no
request through the network-provider transport. The browser may download its
managed model after an explicit user gesture. The extension treats a closed
side panel, missing API, unsupported language or unavailable model as an
unavailable local capability.

### Native platform feedback

Submitting "Not interested" or an equivalent action sends a signal to the platform. It requires an explicit action or a reviewed batch.

## Threat model summary

### Untrusted page

Platform DOM, text, links and images are untrusted. Page content cannot issue extension commands or override user rules.

Mitigations:

- Narrow content-script privileges.
- Schema validation at the service worker boundary.
- No secret access from page context.
- No HTML injection from classifier output.
- Bounded payloads and media sizes.

### Malicious content

Text or images may attempt prompt injection against a model. Classifiers receive fixed task instructions and structured output schemas. Extracted content is always delimited and treated as data.

Text classification accepts no image field and sends zero image bytes. Its
request contract excludes DOM, HTML, cookies, account identifiers, credentials,
full URLs, unrelated rules, unrelated profile data and browsing history.

Provider output is untrusted. It cannot supply final actions, extension API
handles, tool calls, storage commands or trusted provenance. The privileged
runtime validates the whole response, creates provenance from the selected
route and then passes canonical signals to the policy engine. Any unknown or
forbidden field rejects that item response and keeps unresolved content
visible.

Only validated canonical signals may enter the disposable model cache. Raw
provider responses, prompts, chain-of-thought, credentials and complete source
URLs are not stored.

Similarity vectors and the content graph stay in versioned local derived
stores. They contain IDs, fingerprints, vectors, typed relation or edge
evidence, bounded metadata and timestamps. They never enter the portable
profile, synchronization, recovery export or diagnostics. Clearing derived
intelligence removes vectors, relations, clusters, reviewed batch actions and
graph generations while preserving rules, feedback and the normalized recent
observations needed for exact reconstruction.

Native platform feedback uses only public controls already visible in the
current page session. Its DOM boundary cannot read cookies, account storage,
authorization headers, private APIs or complete URLs. Local diagnostics contain
only platform, surface, finite action type, adapter version, terminal state,
latency bucket, verification method and circuit state. Attempt IDs, operation
IDs, platform content IDs, page instance IDs, target fingerprints, text, DOM,
screenshot and platform payload are excluded.

Assistance prompts delimit intent, selected item text, examples, exclusions and
batch examples as untrusted data. The model receives no tool definitions.
Unknown fields and action fields reject the complete output. Diagnostics retain
finite state codes only; intent, description, examples, exclusions, prompt and
raw response are excluded.

### Credential theft

Provider credentials are never embedded in source or synchronized. Browser
extension storage is not assumed to be a secure vault. Requested scopes are
minimal, tokens are redacted from diagnostics and disconnect removes stored
provider state. Every provider must follow
[ADR-0010](adr/0010-credential-handling.md), pass secret scanning and prove its
permission, connection-test and exact-consent boundaries before release.

### Corrupt remote profile

Remote data may be malformed, stale or malicious.

Mitigations:

- Size limits.
- Strict schema and version validation.
- Authenticated encryption when enabled.
- Quarantine before merge.
- Local snapshot before applying a remote migration.

### Excessive inference

A hostile or rapidly changing page could trigger resource exhaustion.

Mitigations:

- Per-tab and global queues.
- Candidate deduplication.
- Rate and size limits.
- Cancellation for stale cards.
- Deterministic rules before model work.

## Sensitive preference data

Rules may reveal political, religious, professional or personal interests. Private repositories and cloud access controls reduce exposure but do not replace optional end-to-end encryption.

Assistance drafts and suggestion evidence are sensitive preference data. They remain local by default, are excluded from diagnostic export unless explicitly selected and are not retained by a cloud provider unless a provider-specific accepted policy states otherwise.

Migration and sync recovery snapshots are local-only and excluded from normal
profile export and synchronization. A sync restoration creates a new local
revision and pauses network sync. Deleting all local ContentLens data also
removes snapshots, journals and quarantined evidence.

## Permissions

The browser extension requests platform host permissions only for enabled
adapters where feasible. Provider host patterns are optional manifest
capabilities, not installation grants. Connection requests one exact normalized
origin after a named user action. Firefox also treats `authenticationInfo` and
`websiteContent` as optional data-collection categories. Refusal sends no
provider request and leaves the local baseline available.

## Secrets

- No model or provider secret is committed or bundled.
- A user-supplied Supabase `service_role` key is rejected.
- No GitHub token flow is accepted; candidate flows must prefer short-lived, minimally scoped credentials.
- OAuth flows must avoid embedding a reusable client secret in the extension.
- Secrets never appear in exported plain-text profiles.

## Telemetry

The initial product has no remote telemetry. Local metrics are visible to the user. Any future diagnostics upload must be opt-in, redact content and identifiers, and have a separate retention policy.

## Security review gates

Security review is required before:

- Publishing OAuth integrations.
- Shipping encrypted sync.
- Enabling cloud inference.
- Automating native platform feedback.
- Accepting shared rule packs or plugins from third parties.

The repository-wide trust boundaries and abuse cases are maintained in the [threat model](threat-model.md).
