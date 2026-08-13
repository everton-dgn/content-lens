# Text classification dataset manifest

## Status

The frozen held-out release corpus is not present in the repository. Text
classification contracts and runtime tests exist, but the capability is not
approved for default enablement.

Synthetic fixtures under `tests/` prove schema, security, routing, cancellation,
cache and fail-open behavior. They are engineering fixtures and must not be
reported as release quality evidence.

## Required inventory

Before promotion, the held-out partition must contain:

- At least 750 total items.
- At least 200 `pt_BR` items.
- At least 200 `en` items.
- At least 200 `es` items.
- At least 150 protected exceptions distributed across all three languages.
- Platform, surface, topic, archetype and model-version slices large enough to
  publish each required metric without merging away a failing subgroup.

Training, calibration and held-out item identities must be disjoint. Near
duplicates, reposts, translated copies and items from the same conversation
must stay in the same partition.

## Manifest fields

The release manifest must record:

```yaml
dataset_id: string
version: string
frozen_at: ISO-8601 timestamp
license: SPDX identifier or reviewed custom license reference
source_provenance: reviewed source records
schema_version: string
label_taxonomy_version: string
deduplication_method_version: string
partition_seed: string
partitions:
  training: { count: number, sha256: string }
  calibration: { count: number, sha256: string }
  held_out: { count: number, sha256: string }
language_counts:
  pt_BR: number
  en: number
  es: number
protected_exception_counts:
  pt_BR: number
  en: number
  es: number
review:
  labeler_count: number
  disagreement_policy: string
  adjudication_record: string
```

Every referenced artifact must have a reproducible SHA-256 digest. Raw private
feed exports, account identifiers, credentials, cookies, complete browsing
history and unlicensed content are prohibited.

The `license` field accepts CC0-1.0, CC-BY-4.0 or ODC-BY-1.0 for collected
material, per [ADR 0017](../adr/0017-model-and-dataset-licensing.md). Synthetic
items record the guide they were written from instead. Every partition is
committed to the repository, and a source whose terms forbid redistribution is
covered by synthetic material labeled as such and reported separately.

## Release gates

For every enabled language and route, the held-out report must prove:

- Hide precision of at least 95%.
- False-positive rate on protected exceptions of at most 2%.
- Recall of at least 70% for each blocked topic.
- Structured-output validity of 100%.
- Expected calibration error of at most 0.05 whenever numeric confidence is
  displayed or used for a hide threshold.
- Fail-open behavior for unsupported language, model removal, provider outage,
  timeout and cost limits.
- Median, p95, worst latency, queue wait, cold start, warm latency, peak memory
  and throughput on the named reference device.

No metric is currently claimed. Promotion remains blocked until the frozen
artifacts, license review, leakage report and quantitative evidence exist.

## Relevant contracts and tests

- [Classification contract](../04-classification.md)
- [Evaluation metrics](../18-metrics.md)
- `tests/contract/classifier.test.ts`
- `tests/contract/text-provider-port.test.ts`
- `tests/runtime/text-classification.test.ts`
- `tests/runtime/routed-text-stage.test.ts`
- `tests/runtime/decision-service.test.ts`
- `tests/security/text-classification.test.ts`
- `tests/storage/model-cache.test.ts`
