# Threat model

## Scope

This model covers the browser extension, supported platform pages, local profile data, optional models and future sync providers. Third-party platform infrastructure is outside project control.

## Assets

- User rules and sensitive preferences.
- Stable author and channel block lists.
- Feedback examples and local observation history.
- Provider and model credentials.
- Extension permissions.
- Profile integrity and availability.
- Model, dataset and extension-package integrity.
- User trust in hide, allow and native-feedback decisions.
- Integrity of reviewable drafts and operation status.

## Actors

- Honest user.
- Malicious page content author.
- Compromised or hostile platform page script.
- Malicious imported profile or shared rule pack.
- Compromised dependency, action, model or provider SDK.
- Attacker with local browser-profile access.
- Provider account attacker.
- Well-intentioned contributor who introduces an unsafe contract.

## Trust boundaries

```text
Platform page
  | untrusted DOM, text and media
  v
Content script
  | validated narrow messages
  v
Extension service worker and local core
  | explicit provider or model request
  +--> local model artifact
  +--> optional cloud model
  `--> optional sync provider

Side panel
  | explicit user action
  v
Rules, feedback and native platform actions
```

## Threats and required controls

### Page-to-extension command forgery

Threat: page content or script attempts privileged profile mutation.

Controls:

- No page-context access to extension APIs or secrets.
- Sender and schema validation.
- Allowlisted message types.
- Payload and rate limits.
- User gesture requirement for destructive profile or native platform actions.

### Prompt injection

Threat: feed text instructs a model to change policy or reveal data.

Controls:

- Treat feed content as delimited data.
- Structured output validation.
- No model access to tools or extension APIs.
- Policy engine owns final action.
- Cloud request fields follow explicit consent.

### Assistance overreach

Threat: a model-generated draft silently broadens scope, creates a durable rule or makes an external platform action appear user-approved.

Controls:

- Assistance returns drafts through a validated non-authoritative schema.
- Inferred fields and affected scope are visible before save.
- Storage and adapter APIs are inaccessible to the model boundary.
- Durable mutation requires a distinct user-confirmed operation.
- Platform expansion, effect escalation and native feedback receive separate review.
- Manual completion remains available after model failure.

### Stale virtualized-node decision

Threat: an asynchronous result hides a different item after DOM reuse.

Controls:

- Bind request to platform content ID and page-instance token.
- Verify identity immediately before rendering.
- Reject stale results.
- Zero-tolerance regression test.

### Credential extraction

Threat: XSS, malicious dependency or page bridge reads a provider token.

Controls:

- No credential in page context, content scripts, export, logs, diagnostics,
  evidence or sync.
- Provider, model and consent records are separate from the dedicated
  credential store and portable profile.
- Session values stay in privileged memory and disappear with context
  recreation.
- Persistent opt-in stores only an authenticated encrypted envelope bound to
  provider ID and normalized origin.
- Rehydration restores envelopes as locked and never restores a previously
  unlocked plaintext value.
- Provider-state replacement uses one IndexedDB transaction; a failed write
  leaves the active runtime unchanged.
- No claim that extension storage is a secure vault.
- Minimize token lifetime and permission.
- Keep network execution fail-closed until permission, credential, connection
  test and exact consent are current.
- Provider connection tests use a fixed synthetic payload and recheck exact
  origin permission before vault access. Their durable record contains only a
  finite code, outcome, latency and timestamp.
- Provider-state bootstrap returns one redacted unavailable code on unreadable
  state. It does not erase the snapshot or disable the deterministic decision
  listener.
- Disconnect and revoke workflow.

### Remote profile corruption

Threat: malformed or concurrent remote state deletes or changes rules.

Controls:

- Strict schema and size validation.
- Local snapshot before apply.
- Optimistic provider version check.
- No timestamp-only auto-merge.
- Conflict quarantine.
- Integrity protection for encrypted envelopes.

### Supply-chain compromise

Threat: dependency, action, model or dataset is replaced or malicious.

Controls:

- Immutable pins and checksums.
- License and provenance review.
- Minimal dependencies and permissions.
- SBOM and release integrity checks.
- Model manifest and digest verification.

### Resource exhaustion

Threat: feed churn triggers unbounded work, storage or model memory.

Controls:

- Deduplication, queues, cancellation and limits.
- Deterministic path first.
- Bounded cache and history.
- Performance gates and capability fallback.

### RSS hostname rebinding

Threat: a feed hostname resolves to a public address during validation and to
a private or loopback address when the browser opens the real connection.

Controls:

- Network acquisition is disabled in all supported browsers.
- The service worker returns a finite unavailable state without calling
  `fetch`.
- The interface disables feed network actions and explains the limitation.
- Local parsing and portable subscription data remain separate from network
  authority.

### Operation-status confusion

Threat: optimistic UI, a worker restart or partial failure makes an unsaved change appear complete, duplicates an action or causes the user to retry destructively.

Controls:

- Acknowledged, pending and durably committed states are distinct.
- Mutation operations use idempotency IDs.
- Partial success identifies completed and failed targets.
- Retry reuses preserved input and targets only unfinished work.
- Repeated equivalent errors are deduplicated.
- Recovery records exclude sensitive content.

### Unsafe native platform feedback

Threat: an incorrect classifier submits likes or negative signals at scale.

Controls:

- Automated likes prohibited.
- Native feedback requires explicit review.
- Local rule remains authoritative.
- Submission status is separate from local decision.

## Residual risks

- An attacker with full local browser-profile access may read unencrypted local preferences.
- Platform DOM changes can break extraction.
- Model classification remains probabilistic.
- RSS and Atom subscriptions cannot refresh from the network.
- Provider security and availability remain external dependencies.
- Browser extension storage alone cannot guarantee secret confidentiality.
- A compromised privileged extension context can read a credential while it is
  unlocked or present in memory.

## Review triggers

Update this model before:

- Adding a host permission.
- Adding provider authentication.
- Loading remote models or code.
- Enabling cloud inference.
- Shipping encrypted sync.
- Accepting dynamic third-party plugins.
- Automating native platform actions.
- Allowing AI assistance to propose durable rule changes.
