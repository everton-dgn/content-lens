# ADR 0006: Capability maturity

Status: Accepted

## Context

The conceptual pipeline included text, vision, embeddings and content graph, while the MVP required only deterministic filtering and optional text classification. Contributors could interpret every conceptual stage as mandatory.

## Considered options

1. Implement the complete conceptual pipeline before release.
2. Remove future capabilities from architecture documents.
3. Define explicit maturity and capability levels.

## Decision

ContentLens labels capabilities as Proposed, Accepted, Experimental, Deprecated or Removed.

The execution path advertises independent levels:

1. Deterministic.
2. Text.
3. Vision.
4. Similarity.
5. Graph.
6. Cloud.

Deterministic capability is the baseline. Optional levels require their own accepted spec, evidence and availability check.

User assistance is an independent capability facet rather than another decision-pipeline level. A runtime may support local text classification without rule-drafting assistance, or assistance without visual classification. Each task advertises separate availability, model version, privacy mode and acceptance evidence.

## Tradeoffs

- Documentation must maintain maturity state.
- Implementations need capability negotiation.
- Future ideas remain visible without becoming hidden requirements.
- Unsupported devices retain useful deterministic behavior.

## Consequences

- README distinguishes planned from MVP capability.
- The graph and provider sync are excluded from stable v1 gates.
- A failed optional capability fails open.
- Product contracts cannot depend on an unaccepted optional level as if it were baseline.
- UI actions remain manually complete when assistance is unavailable.

## Revisit trigger

Revisit when two optional levels become universal across every supported browser and device.
