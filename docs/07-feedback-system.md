# Feedback system

## Principle

Explicit feedback is the strongest personal preference signal. Passive behavior is ambiguous and should be disabled by default or carry a much smaller weight.

Opening, watching or reading an item does not mean approval. A user may inspect content to verify or criticize it.

Feedback should take the shortest safe path. ContentLens reuses current item, source, platform and surface context, then asks only about ambiguity that can change the saved result.

## Actions and effects

| User action | Immediate effect | Durable effect |
| --- | --- | --- |
| Show | Reveal the item for the current session | None |
| Hide for now | Hide the current item for the current session | None |
| Mark useful | Reveal the item | Record an explicit positive correction |
| Show less for now | Reduce the current item for the current session | None |
| Show less of this type | Reduce the current item for the current session | Always open an editable scoped preference or rule draft |
| Hide similar | Hide the current item for the current session | Create an editable semantic-rule draft |
| Always allow | Reveal matching items | Create an allow rule |
| Block identity | Hide matching items | Create an absolute identity rule |
| Prioritize identity | Promote matching items | Create a positive identity rule |
| Correct classification | Apply corrected action | Save labeled topics and archetypes |

Temporary show, hide and reduce actions do not become durable learning signals. "Show less for now" is always temporary. "Show less of this type" always opens a draft and changes future behavior only after explicit save. Durable feedback uses a label that names its future effect, such as "Mark useful", "Always allow", "Block source" or "Correct this decision".

## Rule creation flow

When a user chooses "Hide similar content", the current item becomes a positive example and its platform and surface become the initial scope. ContentLens opens one editable draft:

```text
Hide similar content

Draft: professional football news and transfer commentary
Effect: reduce
Scope: YouTube Home
Example: current item
Exclusions: none yet

[Save] [Add an exclusion] [Change scope]
```

When an accepted AI-assistance capability is available, it may propose the description and likely exclusions. In deterministic mode, the description starts from available title, source and user-entered terms. In both modes:

- Inferred fields are labeled.
- No draft is saved automatically.
- The user can edit every field.
- ContentLens asks one focused question only when the draft has a material ambiguity.
- Broadening from the current surface, changing from reduce to hide or adding another platform requires explicit review.

The test area previews representative matches and exceptions before save. An advanced threshold appears only when the classifier provides a calibrated and user-understandable value.

## Suggestion policy

A suggestion can appear after repeated consistent corrections or when a current action closely matches an existing rule. It includes:

- The evidence set used.
- Estimated affected scope.
- A proposed rule change.
- Examples expected to change and remain unchanged.

Suggestions are dismissible and rate-limited. Repeated dismissal suppresses the same proposal until its evidence changes. Passive browsing alone cannot trigger a durable suggestion.

## Correction flow

A correction shows the original decision:

```text
Reduced because:
- Matches "professional football news"
- No allowed exception matched

What should change?
[Mark useful] [Wrong reason] [Too broad] [More]
```

"Mark useful" records an explicit positive correction and offers undo. "Wrong reason" opens the smallest reason selector needed to label the error. "Too broad" creates a required draft with the affected rule, proposed exclusion or narrower scope and sample impact. "More" exposes topic, archetype, action and rule-match details.

The corrected sample is stored locally with the minimum relevant text or content fingerprint. Raw media does not become durable profile data by default.

## Learning

The first implementation does not retrain a large model or adjust global thresholds automatically. Explicit confirmed feedback can update:

- Rule examples and exclusions.
- Per-source allow, block or promotion rules.
- Labeled correction examples.

When a learning capability passes its promotion gate, it may propose embedding-centroid, preference-weight or threshold changes. The proposal requires a named minimum-evidence gate, preview and operation-scoped undo. One correction cannot change a global threshold.

## Review queue

The queue groups cases that are uncertain or may be worth a separate action:

```text
23 items hidden today
8 candidates for "Not interested"
3 channels candidates for "Do not recommend"
```

The user reviews each action or a clearly scoped batch. ContentLens never silently converts model output into a platform endorsement. A batch separates local reversible actions from external platform actions.

## Feedback data quality

Feedback examples retain:

- Content fingerprint and stable platform ID when available.
- Decision shown to the user.
- User action.
- Topics and archetypes at correction time.
- Classifier and rule versions.
- Local event time when ordering is required.
- Installation-scoped event ID when deduplication is required.

Evaluation separates:

- False positive: useful content was reduced or hidden.
- False negative: unwanted content remained visible.
- Wrong reason: action was acceptable but explanation was incorrect.
- Rule conflict: multiple explicit rules disagreed.

## Undo and deletion

Every rule-creating action supports immediate undo. Undo applies the inverse effects recorded for that operation ID after checking current preconditions; it does not restore an entire prior profile revision or remove unrelated later changes. It invalidates affected decisions and reports any effect that could not be reversed safely.

Local deletion removes the selected feedback from the active profile and records only the minimum local metadata needed to prevent accidental replay. Synchronization-specific tombstones exist only when synchronization is enabled.

## Native platform signals

Native feedback can complement local rules. It has separate consent and status:

- Local block succeeded.
- Native signal pending user review.
- Native signal submitted.
- Native action unavailable.

The local decision does not depend on native platform success.

Native feedback integration remains behind its promotion gate. Until that gate passes, the queue can prepare a local recommendation but cannot submit a platform action.

## Failure handling

| Failure | Required outcome |
| --- | --- |
| Draft generation fails | Preserve current context and offer manual draft or retry |
| Durable save fails | Keep the draft, report that the rule is not active and retry without re-entry |
| Undo partially fails | Restore every safe item, identify the remainder and offer targeted recovery |
| Classifier unavailable | Keep deterministic item and source feedback available |
| Queue action expires after page change | Preserve local feedback and mark the external item unavailable |
| Repeated equivalent failure | Show one current notice and one recovery action |
