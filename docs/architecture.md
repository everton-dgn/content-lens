# System architecture

## Overview

ContentLens is a local-first browser extension with a platform-independent core and replaceable adapters.

```text
Platform page
  |
  v
Feed adapter
  | normalized ContentItem
  v
Decision engine
  |-- deterministic rules
  |-- optional accepted text classifier
  |-- optional accepted vision classifier
  |-- optional accepted similarity capability
  `-- score policy
  |
  v
Explainable Decision
  |
  +--> adapter rendering
  +--> feedback system
  +--> reviewable assistance drafts
  +--> local storage
  `--> experimental sync boundary
```

## Runtime components

### Content scripts

- Observe platform pages.
- Extract candidate metadata through a platform adapter.
- Apply hide, reduce, promote and explanation UI.
- Inject feedback actions.
- Send normalized classification requests to the service worker.

Content scripts should contain little policy because they run in an untrusted, frequently changing page environment.

### Extension service worker

- Coordinates classification.
- Loads rules and profile revisions.
- Deduplicates requests.
- Tracks idempotent user operations through acknowledged, durable and failed states.
- Owns cache access and, only after acceptance, experimental sync scheduling.
- Routes model work to an appropriate execution context.

Manifest V3 service workers are not assumed to remain alive. Durable work is checkpointed, and each handler can recover from restart.

### Local model execution

Model execution may require an extension page, offscreen document or worker that can load WebGPU or WebAssembly resources. The exact runtime is deferred until a prototype confirms browser support and lifecycle behavior.

The core classifier talks to model adapters, not a specific runtime.

### Side panel and settings

- Edit rules and exclusions.
- Review hidden items and uncertain decisions.
- Manage blocked and allowed identities.
- Inspect metrics.
- Resume unfinished drafts and recovery actions.
- Inspect redacted local diagnostics and capability state.
- Configure models, privacy and synchronization.
- Import and export profiles.

### IndexedDB

IndexedDB is the primary durable store. It holds the profile, rules, feedback and local caches. Synchronization never becomes the only copy required for normal operation.

## Conceptual module boundaries

The following tree names responsibilities. It does not select a repository layout, package manager or publishable package structure.

```text
modules/
  core/
    content/
    rules/
    decisions/
    feedback/
    graph/
  adapters/
    youtube/
    linkedin/
    x/
    reddit/
    hacker-news/
    rss/
  ai/
    text/
    vision/
    embeddings/
  storage/
    indexed-db/
  sync/
    file/
    github/
    google-drive/
    onedrive/
    supabase/
    webdav/
  extension/
    service-worker/
    content-script/
    side-panel/
    options/
  ui/
  testing/
```

This is a conceptual boundary, not a commitment to publish every module separately.

## Request flow

1. An adapter observes a new or recycled card.
2. It extracts a normalized `ContentItem`.
3. The content script requests a decision using item and page-instance IDs.
4. The service worker resolves absolute rules and cache.
5. Unresolved items enter enabled classifier queues only when those capabilities are accepted.
6. The decision engine evaluates available signals and fails open when an optional capability is unavailable.
7. The adapter renders the result only if the page instance still represents the same item.
8. A user action receives an operation ID and immediate truthful acknowledgement.
9. User feedback or a reviewed assistance draft updates local state in one idempotent transaction and invalidates affected decisions.
10. The UI reports durable success, partial success or a recoverable failure without discarding input.
11. An experimental sync provider receives durable profile changes only after its conflict and credential gates are accepted.

The page-instance check prevents a late result from hiding the wrong card after a virtualized feed reuses a DOM node.

## Precedence

1. Session reveal.
2. Explicit allow rule, including identity allow and exact allow.
3. Explicit block rule.
4. Exact block rule.
5. Semantic rule.
6. Learned preference.
7. Default show behavior.

Platform-native recommendations and feedback do not override local rules. An exact allow is evaluated at step 2, so an applicable identity or exact block cannot hide explicitly allowed content.

## Performance

- Batch classification requests.
- Apply deterministic rules synchronously from an in-memory index.
- Cache by content fingerprint, profile revision and classifier version.
- Defer image downloads until text and rules remain unresolved.
- Bound concurrent model work.
- Cancel or ignore work for cards that leave the viewport.
- Avoid layout shifts when replacing cards.

Concrete device classes, fixtures and limits are defined in [Performance budgets](performance.md).

## Failure isolation

- A broken platform selector affects one adapter.
- A missing model leaves deterministic filtering available.
- A sync failure leaves local state intact.
- A corrupt remote profile is quarantined before merge.
- A UI failure does not submit native platform actions.
- A failed durable write cannot leave the UI claiming an active saved rule.
- A repeated event or worker restart cannot apply the same operation twice.
- A diagnostic failure cannot block user-facing recovery.

## Intelligent-assistance boundary

AI assistance receives bounded context and returns validated drafts, explanations or suggestions. It cannot call adapter, storage, sync or native-feedback APIs. The user-action service owns confirmation and durable mutation.

Assistance remains optional. When unavailable, the same task can continue with deterministic defaults and manual editing. Draft generation and content classification have separate capability flags, budgets and evaluation evidence.

## Operational state

Longer operations use explicit state transitions:

```text
created -> acknowledged -> running -> committed
                 |           |           |
                 v           v           v
              cancelled   failed      compensated
```

An operation records its ID, type, current state, target scope and safe retry metadata. Sensitive content is excluded from diagnostic summaries. Terminal records are retained only for the bounded period required for deduplication, recovery and user-visible history.

## Security boundaries

The page is untrusted. Extracted text and images are data, not instructions. Page scripts must not access extension secrets, profile storage or provider credentials.

Content scripts use a narrow message schema. The service worker validates sender, message type, payload size and platform namespace before reading or mutating profile state.

Cloud model prompts and provider writes require explicit configuration. Secrets are never bundled in the extension. The complete boundary inventory and abuse cases are maintained in the [threat model](threat-model.md).

## Architectural risks

### Platform DOM churn

The highest implementation risk is reliable card identity in virtualized, experiment-heavy feeds. Adapter fixtures and live smoke tests are release gates.

### Model cost and latency

Visual and language inference on every card can overwhelm the device. The layered pipeline and cache are required behavior.

### False positives

Hiding useful content damages trust. Low-confidence behavior defaults to show, reduce or review.

### Browser lifecycle

Manifest V3 can stop the service worker. Work queues and state transitions must tolerate interruption.

### Sync conflict

Whole-profile last-write-wins and timestamp-only entity merge can lose edits or resurrect deleted rules. Automatic merge remains prohibited until [ADR-0009](adr/0009-sync-conflict-model.md) is accepted.
