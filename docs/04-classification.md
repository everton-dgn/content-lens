# Classification pipeline

## Design goals

- Resolve known user intent before inference.
- Spend expensive computation only on unresolved items.
- Keep text, vision and platform extraction replaceable.
- Produce inspectable evidence for every action.
- Favor reversible reduction over hiding when confidence is low.
- Avoid false positives in educational, historical and technical exceptions.

## Pipeline

```text
Platform card
  -> normalized ContentItem
  -> all applicable explicit allow rules
  -> identity and exact block rules
  -> cached decision
  -> optional accepted text classification
  -> optional accepted visual classification
  -> optional accepted similarity capabilities
  -> quality and relevance aggregation
  -> policy decision
  -> UI action
  -> feedback
```

The deterministic path is the release baseline. Each optional stage stays disabled until its capability contract passes evaluation, privacy, compatibility and performance gates. [ADR-0006](adr/0006-capability-maturity.md) defines these maturity levels.

## Stage 1: extraction

The platform adapter extracts stable identity, text, media references and surface context. Missing fields remain absent. The adapter must not invent metadata from visual appearance.

## Stage 2: deterministic rules

Rules are checked in this order:

1. Explicit item reveal for the current session.
2. Absolute allow rule, including identity allow and exact allow.
3. Absolute identity block.
4. Exact content block.
5. Cached decision valid for current rule and classifier versions.

A stable channel block should resolve without running any classifier. An exact allow is resolved at step 2 and cannot be overridden by an identity or exact block in the same scope.

## Stage 3: text classification

This stage is proposed and model-independent. No model is part of the default release until its evaluation and promotion gates pass.

Text inputs may include title, body, author or channel name and available context. The classifier returns:

- Topic scores.
- Archetype scores.
- Quality scores.
- Evidence labels.
- Model confidence.

Semantic rules contain descriptions, positive examples and exclusions. Exclusions are evaluated as first-class evidence instead of post-processing notes.

## Stage 4: visual classification

This stage is optional and deferred beyond the deterministic baseline.

Visual analysis is used when an image can materially change the decision. YouTube thumbnails are the first use case.

Signals may include:

- Exaggerated facial expression.
- Open-mouth surprise.
- Arrows, circles and visual callouts.
- Dense uppercase text.
- Excessive saturation.
- Artificial before-and-after composition.
- Sensational layout patterns.

No individual feature equals clickbait. A `clickbaitVisualScore` combines multiple signals with title, channel history and the user's preference weight.

## Stage 5: embeddings and graph

This stage is experimental. Storage schemas may reserve compatibility boundaries, but implementations must not require embeddings or a graph when the capability is disabled.

Embeddings compare the item with:

- Semantic rule examples.
- Explicitly approved examples.
- Explicitly rejected examples.
- Topic and archetype centroids.
- Recently observed content for novelty and duplication.

The content graph can identify repeated coverage, derivative posts and candidate primary sources. This stage should be local and optional in the earliest MVP.

## Stage 6: score aggregation

The aggregator converts independent signals into a personal relevance score. An initial model can use configurable weights:

```text
positive =
  technical_depth
  + originality
  + novelty
  + evidence
  + preferred_topic
  + trusted_source

negative =
  blocked_topic
  + unwanted_archetype
  + clickbait
  + duplication
  + noise

final_score = calibrated(positive - negative)
```

The product may display scores on a `0..100` scale, while internal values remain normalized.

## Stage 7: decision policy

An example policy:

| Condition | Action |
| --- | --- |
| Explicit allow | Show |
| Absolute block | Hide |
| Score at or above promote threshold | Promote |
| Score between show thresholds | Show |
| Mild negative score or uncertainty | Reduce |
| Strong negative score with sufficient confidence | Hide |
| High-impact decision with low confidence | Review |

Thresholds belong to the user profile and may vary by surface. Search results should usually have a higher hide threshold than passive recommendations because explicit search expresses intent.

## Explanation contract

A decision explanation includes:

- Action.
- Final score and confidence.
- Matched explicit rules.
- Top positive and negative signals.
- Model and rule version.
- Available correction actions.

Example:

```text
Content hidden
Reasons:
- Blocked topic: professional football, 0.96
- Visual clickbait, 0.84
- Low personal relevance, 0.91

[Show] [Always allow] [Correct classification]
```

## Caching

Cache keys include:

- Platform content ID.
- Relevant content fingerprint.
- Rule profile revision.
- Classifier version.
- Model version.

Media, transcripts and per-item embeddings remain local and can be evicted. Durable user corrections survive cache eviction.

## Failure behavior

- Adapter failure: leave content visible and record a local diagnostic.
- Model unavailable: apply deterministic rules and show unresolved content.
- Low confidence: reduce or review instead of hiding.
- Provider error: fall back to the local pipeline.
- Stale cached model output: recompute before a destructive-looking hide.

## Calibration

Any model-backed release uses the versioned protocols in the [dataset manifests](datasets/text-manifest.md). Thresholds are adjusted against false-positive cost, not raw accuracy alone. A hidden useful item is generally more harmful than a visible noisy item.
