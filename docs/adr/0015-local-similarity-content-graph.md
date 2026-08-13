# ADR 0015: Local similarity and content graph

Status: Accepted

## Context

Stable platform IDs, canonical URLs and exact fingerprints detect deterministic
duplicates. Reposts, paraphrases and story updates require probabilistic
evidence, while a content graph can explain source, topic and repetition
relationships. Treating every similar pair as interchangeable would hide new
facts, protected items and candidate primary sources.

## Decision

ContentLens uses two isolated local layers:

1. Exact comparison runs first and remains available without a model.
2. An optional bounded vector index retrieves candidates only inside one
   declared representation version space.

Relations use the explicit types `exact-duplicate`, `near-duplicate`,
`semantically-similar`, `story-update` and `related-distinct`. They carry
threshold, evidence codes, versions, confidence and expiration. Relations are
signals. A separately accepted policy performs any `reduce`, `hide` or
`review` action after deterministic precedence.

The graph stores typed local nodes and evidence-backed edges. Provenance cycles
become conflicts. Low-confidence inference stays advisory. A rebuild writes an
isolated generation and activates it only after validation.

Vectors, relations, clusters, graph generations, checkpoints and batch actions
use version 5 derived IndexedDB stores. They are bounded to 10,000 similarity
items, 15,000 graph nodes, 100,000 graph edges and a combined 100 MiB. They are
excluded from profile export, synchronization, portable recovery and shared
rule packs.

`Hide similar` requires a scope review. Its local expiring policy preserves the
cluster representative, story updates and protected exceptions. Separating a
false grouping stores one relation fingerprint and evidence version; it does
not delete rules, feedback or independent relationships.

## Consequences

- Model removal, corruption and version mismatch can discard the probabilistic
  layer while retaining exact behavior and user intent.
- Cloud embeddings require an accepted route, specific consent, minimized text
  and budgets. A failed cloud route can continue only through an already
  accepted browser or local route.
- Display names do not create cross-platform identity.
- Candidate primary source and derived-from edges remain reviewable hypotheses.
- Public promotion still requires a frozen licensed held-out corpus. Synthetic
  contract fixtures cannot satisfy that gate.

## Validation

- Exact-before-embedding and route-consent contract tests.
- Typed relation, cluster representative and protected-precedence tests.
- Corruption, eviction, cancellation and checkpoint-resume tests.
- IndexedDB round-trip, exclusion, migration and isolated cleanup tests.
- Keyboard-operable review, correction and batch-confirmation tests.
- A deterministic 10,000-observation benchmark on the reference environment.
