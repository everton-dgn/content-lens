# Visual classification dataset manifest

## Status

The frozen held-out visual corpus is not present in the repository. Visual
preflight, minimization, routing, consent, provider schemas and runtime tests
exist, but the capability is not approved for default enablement.

Synthetic image bytes and provider fixtures under `tests/` prove engineering
contracts only. They are not release quality evidence.

## Required inventory

Before promotion, the held-out partition must contain:

- At least 600 visual items.
- At least 150 positive examples for signals that can reduce or hide.
- At least 150 hard counterexamples for those signals.
- Protected exceptions across every enabled platform and surface.
- Paired text-only and text-plus-vision inputs with the same content identity.
- Separate language slices for visible text or OCR in `pt_BR`, `en` and `es`.

Training, calibration and held-out identities must be disjoint. Re-encoded,
cropped or resized copies of one source image must remain in the same
partition.

## Manifest fields

```yaml
dataset_id: string
version: string
frozen_at: ISO-8601 timestamp
license: SPDX identifier or reviewed custom license reference
source_provenance: reviewed source records
schema_version: string
label_taxonomy_version: string
media_preprocessing_version: string
deduplication_method_version: string
partitions:
  training: { count: number, sha256: string }
  calibration: { count: number, sha256: string }
  held_out: { count: number, sha256: string }
held_out_counts:
  total: number
  positive: number
  counterexample: number
  protected_exception: number
paired_text_manifest_sha256: string
review:
  labeler_count: number
  disagreement_policy: string
  adjudication_record: string
```

Raw private feeds, account identifiers, cookies, credentials and unlicensed
media are prohibited.

Held-out media is produced for the corpus and committed to the repository, per
[ADR 0017](../adr/0017-model-and-dataset-licensing.md). Collected media is
admissible only under CC0-1.0, CC-BY-4.0 or ODC-BY-1.0, which platform
thumbnails and post images almost never carry, so the corpus is expected to be
synthetic. Synthetic media records the guide it was produced from in place of a
license. A manifest does not reference assets kept outside the repository:
an evaluation nobody else can rerun is not evidence.

## Release gates

- Paired recall improves by at least five percentage points on eligible items
  unresolved by text.
- Hide precision is at least 95%.
- False positives on protected exceptions are at most 2%.
- Accepted structured output validity is 100%.
- Stale content and page-instance applications remain at zero.
- Export, sync, feedback and diagnostics contain zero raw image, base64, pixel,
  tensor, full media URL or provider response.
- Latency, memory, queue and main-thread budgets pass on each reference device.

No metric is currently claimed.

## Relevant contracts and tests

- [Classification contract](../04-classification.md)
- `tests/contract/vision-classifier.test.ts`
- `tests/runtime/visual-stage.test.ts`
- `tests/security/visual-input.test.ts`
- `tests/contract/provider-adapters.test.ts`
