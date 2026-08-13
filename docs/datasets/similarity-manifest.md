# Similarity and content-graph evaluation manifest

## Status

Exact, relation, clustering, graph, policy, storage and resource contracts are
implemented. The repository contains deterministic engineering fixtures and a
10,000-observation performance corpus generated in memory. A frozen licensed
held-out quality corpus is not present, so probabilistic similarity and graph
policy are not approved for default enablement.

No product-quality precision, recall, false-merge or novelty-improvement metric
is currently claimed. The synthetic tests prove code contracts only.

## Required inventory

Before promotion, the frozen corpus must contain, for each of the five relation
types:

- At least 100 positive pairs.
- At least 100 hard counterexamples.
- Separate calibration and held-out identities.
- Story updates with material fact and time differences.
- Candidate source pairs with observed link evidence.
- Protected exceptions and sponsored representatives.
- Display-name collisions across platforms.
- Text-only, visual and multimodal slices for every enabled route.
- `pt_BR`, `en` and `es` slices large enough to report separately.

All copies, translations, crops, reposts and members of one story family must
remain in one partition to prevent leakage.

## Manifest fields

```yaml
dataset_id: string
version: string
frozen_at: ISO-8601 timestamp
license: SPDX identifier or reviewed custom license reference
source_provenance: reviewed source records
schema_version: string
relation_policy_version: string
graph_evidence_version: string
representation_spaces: string[]
partition_seed: string
partitions:
  calibration: { count: number, sha256: string }
  held_out: { count: number, sha256: string }
relation_counts:
  exact_duplicate: { positive: number, counterexample: number }
  near_duplicate: { positive: number, counterexample: number }
  semantically_similar: { positive: number, counterexample: number }
  story_update: { positive: number, counterexample: number }
  related_distinct: { positive: number, counterexample: number }
protected_exception_count: number
cross_platform_collision_count: number
review:
  labeler_count: number
  disagreement_policy: string
  adjudication_record: string
```

Raw private feeds, account identifiers, cookies, credentials, complete browsing
history and unlicensed content are prohibited.

The `license` field accepts CC0-1.0, CC-BY-4.0 or ODC-BY-1.0 for collected
material, per [ADR 0017](../adr/0017-model-and-dataset-licensing.md). Synthetic
items record the guide they were written from instead. Every partition is
committed to the repository, and a source whose terms forbid redistribution is
covered by synthetic material labeled as such and reported separately.

## Release gates

- Exact duplicate precision is 100% on deterministic identity fixtures.
- Near-duplicate held-out precision is at least 98%.
- False merge across updates, protected exceptions and source candidates is at
  most 2%.
- Candidate provenance precision is at least 90%, with at most 2% false
  candidates.
- The graph improves paired novelty precision by at least five percentage
  points over the exact-plus-similarity baseline.
- Every incompatible representation-space comparison remains rejected.
- Export, sync and diagnostics contain no vectors, raw content, raw media or
  graph dump.

## Engineering performance evidence

On 2026-07-31, `pnpm benchmark:similarity` (historical command; current
equivalent: `pnpm benchmark similarity-index`) processed 10,000 synthetic
records:

- Insert p95: 0.02 ms.
- Query p95: 25.95 ms.
- Rebuild: 173.19 ms.
- Additional heap: 15,699,312 bytes.
- Stored vector bytes: 640,000.

These timings cover the deterministic in-memory index on the current reference
environment. They do not establish relation quality.

## Relevant contracts and tests

- [ADR 0015](../adr/0015-local-similarity-content-graph.md)
- `tests/contract/similarity*.test.ts`
- `tests/contract/content-graph*.test.ts`
- `tests/storage/derived-intelligence-storage.test.ts`
- `tests/ui/similarity-review.test.tsx`
- `tests/performance/similarity-index.bench.ts`
