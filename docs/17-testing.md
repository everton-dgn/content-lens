# Testing

## Test layers

### Core unit tests

- Rule precedence.
- Scope matching.
- Score aggregation.
- Decision thresholds.
- Explanation generation.
- Merge behavior and tombstones.
- Schema validation and migrations.

The decision engine uses fixed inputs and produces deterministic outputs.

### Contract tests

Every adapter, classifier and sync provider runs against a shared contract suite.

Adapter contract:

- Normalizes stable identities.
- Fails open on missing metadata.
- Restores hidden content.
- Rejects stale page-instance results.

Classifier contract:

- Returns structured values within numeric ranges.
- Includes safe user-facing evidence.
- Handles unsupported language or media.
- Identifies model version.

Assistance contract:

- Rejects action fields, unknown fields and incompatible schema versions.
- Attaches provider, model, route and profile provenance locally.
- Preserves typed intent across cancellation and provider terminal states.
- Marks scope expansion, effect escalation and protected-exception removal.
- Keeps explanations read-only and outside the save path.

Browser AI contract:

- Uses the same declared modalities and languages for availability and session
  creation.
- Passes the task JSON Schema as `responseConstraint`.
- Requires a connected trusted extension document.
- Rejects unsupported language and oversized bridge messages.
- Cancels in-flight work and destroys each completed session.

Sync contract:

- Preserves unknown safe fields.
- Detects optimistic-concurrency conflicts.
- Rejects invalid remote profiles.
- Never loses local state on provider failure.

Similarity and graph contract:

- Runs exact identity and fingerprint comparison before embeddings.
- Isolates incompatible representation version spaces.
- Keeps near duplicates, story updates and related distinct content separate.
- Preserves representative, protected and update members in reviewed batches.
- Detects graph provenance cycles and suppresses low-confidence policy input.
- Cancels and resumes matching-version rebuild checkpoints.
- Excludes every vector and graph generation from portable data.

### Adapter fixture tests

Captured, redacted markup represents supported surfaces and known DOM variants. Tests cover:

- Initial cards.
- Infinite-scroll insertion.
- Virtualized node reuse.
- Missing channel or author ID.
- Sponsored and promoted content.
- Shorts, reposts, replies and crossposts as applicable.

Fixtures contain no authentication data or personal browsing history.

### Browser integration tests

A packaged extension is loaded into a supported browser and tested against local fixture pages:

- Content script to service worker messaging.
- IndexedDB persistence.
- Hide, reveal and undo.
- Side-panel rule editing.
- Model unavailability fallback.
- Import and export.
- Service-worker restart during a pending rule save.
- Draft preservation after a recoverable storage error.
- Deduplication of repeated equivalent errors.
- Partial batch success and targeted retry.

### Live smoke tests

Because platform DOM changes cannot be represented fully by fixtures, a small manual or isolated live suite checks:

- Adapter still finds expected surfaces.
- Stable identities are extracted.
- A decision applies to the intended card.
- Platform interaction remains usable.

Live tests do not submit native feedback.

## Classification datasets

### Personal seed set

Realistic labeled examples in Portuguese, English and Spanish:

- Unwanted professional football.
- Allowed technical or academic football contexts.
- Devotional religion and academic religion.
- Esotericism.
- Useful AI and software content.
- AI filler and generic prompt content.
- Clickbait thumbnails and visual counterexamples.
- LinkedIn corporate stories and technical postmortems.
- X rage bait and primary research announcements.
- Reddit low-effort and detailed technical discussions.

The release text-classification corpus requires at least 750 held-out items,
with at least 200 each in `pt_BR`, `en` and `es`, plus at least 150 protected
exceptions distributed across the three languages. Synthetic contract fixtures
do not count toward that inventory.

The visual release corpus requires at least 600 held-out items, including at
least 150 positive visual cases and 150 counterexamples. The paired report must
show at least five percentage points of recall improvement on eligible
text-unresolved items while preserving at least 95% hide precision and at most
2% false positives on protected exceptions.

The similarity release corpus requires at least 100 positive pairs and 100 hard
counterexamples for each relation type. The frozen report must prove 98% near
duplicate precision, at most 2% false merge on updates, source candidates and
protected exceptions, and at least five percentage points of paired novelty
improvement from the graph. See
[the similarity manifest](datasets/similarity-manifest.md). Synthetic contract
fixtures and the 10,000-observation benchmark do not count as quality evidence.

### Archetype set

Each archetype has positive examples, counterexamples and hard ambiguous cases.

### Regression set

Every confirmed false positive or false negative can become a redacted regression fixture after user approval.

## Metrics

Report:

- Precision and recall per rule or archetype.
- False-positive rate.
- False-negative rate.
- Calibration error.
- Latency percentiles.
- Memory use.
- Cache hit rate.
- Adapter extraction failure rate.

Aggregate accuracy alone is insufficient because classes and error costs differ.

## Interaction and usability tests

Automated interaction tests assert:

- One action for hide, show, undo, allow source and block source when scope is unambiguous.
- No more than one primary and two secondary card actions before expansion.
- Known platform, surface, source and item context is prefilled.
- An assisted draft does not create durable state before confirmation.
- A failed save preserves the complete draft and retries only the failed operation.
- Pending, success, partial-success, cancelled, unavailable and failed states expose the documented primary action.
- Repeated equivalent failures render one current notice.
- Status updates do not steal focus.

Before the first public release, a fixed moderated test with at least eight first-time participants records task completion, time, decisions, assistance required and scope comprehension. Test scripts, participant criteria, anonymized task-level results and deviations from the frozen interaction budget become release evidence.

The assistance crossover report must also show a 25% reduction in median
decisions against the manual flow, no more than 10% median time regression and
at least seven of eight participants completing without help.

## Fault-injection tests

Deterministic fault injection covers:

- Service-worker termination before and after durable commit.
- IndexedDB quota, transaction abort and unavailable storage.
- Adapter capability disappearing during an action.
- Model crash, timeout, malformed output and cancellation.
- Extension update during queued work.
- Migration failure before commit and during recovery.
- Browser restart with unfinished drafts and bounded retry state.

Every fault scenario asserts visible truthfulness: pending work is not reported as saved, local fallback remains usable and recovery does not duplicate the operation.

Native feedback adds adversarial fixtures for untrusted classifier, model,
timer, background and page-script inputs; 100 repeated clicks plus 100 replays;
recycled target, page instance and label changes; interruption before positive
evidence; three contract failures in ten minutes; and disable while review is
pending. Revalidation must stay at or below 100 ms p95 and each fixture task
below 50 ms. A live smoke never sends a real action without the separate human
gesture recorded by the protocol.

## Performance budgets

Budgets are established from Phase 0 measurements. Tests should cover:

- Time to apply deterministic block.
- Text-classification batch latency.
- Visual-classification latency.
- Main-thread work per observed card.
- Peak model memory.
- IndexedDB growth.

## Security tests

- Page content cannot invoke privileged messages.
- Message schemas reject unknown fields and oversized payloads.
- Classifier output is escaped before rendering.
- Tokens are absent from logs and exports.
- Malformed remote profiles are quarantined.
- Cloud requests match active consent fields.
- Sync encryption rejects altered ciphertext.

## Accessibility tests

- Keyboard-only card actions.
- Screen-reader labels for hidden reasons.
- Focus restoration.
- Contrast and reduced motion.

## Release gates

A release is blocked by:

- Known useful-content false-positive regression.
- Stale result applied to a recycled card.
- Profile data loss.
- Secret exposure.
- Adapter failure that hides content instead of failing open.
- Missing migration coverage.
- A common action exceeding its accepted interaction budget.
- A recoverable failure that loses a user draft.
- An operation shown as successful without durable confirmation.
