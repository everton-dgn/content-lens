# ADR 0002: Layered classification

Status: Accepted

Amended by: [ADR 0006](0006-capability-maturity.md)

## Context

Some decisions are exact, such as a blocked channel. Others require semantic or visual judgment. Running a large model for every item wastes resources and can overrule explicit intent.

## Considered options

1. One general model makes every decision.
2. Keywords and block lists only.
3. Deterministic rules followed by progressively more expensive classifiers.

## Decision

ContentLens uses a layered pipeline. Only the deterministic layer is mandatory; later layers are independently gated by ADR 0006:

1. Allow and block rules.
2. Exact rules and cache.
3. Text classification.
4. Visual classification when needed.
5. Embeddings and content graph.
6. Policy aggregation.

## Tradeoffs

- The pipeline has more components and versioning.
- Explanations can identify the responsible layer.
- Known decisions are fast and stable.
- Expensive inference is reduced.

## Consequences

- Classifiers produce signals instead of final actions.
- The policy engine owns thresholds and precedence.
- Model unavailability leaves deterministic filtering functional.
- Cache keys include profile and classifier versions.

## Revisit trigger

Revisit if measured complexity exceeds its latency and accuracy benefits.
