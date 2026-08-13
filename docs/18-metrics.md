# Metrics

## Product question

ContentLens succeeds when a person's feed contains less unwanted noise and more useful material without hiding valuable exceptions.

Metrics are local by default and visible to the user.

## Classification quality

### Precision

Of the items ContentLens hides or reduces for a reason, how many match the user's later judgment?

### Recall

Of the unwanted items the user identifies, how many did ContentLens catch?

### False-positive rate

The share of useful items incorrectly reduced or hidden. This is the primary trust metric.

### False-negative rate

The share of unwanted items that remained visible.

### Calibration

Items classified with 80% confidence should be correct near 80% of the time. Poor calibration makes thresholds misleading.

Metrics should be reported by:

- Platform.
- Surface.
- Rule.
- Topic.
- Archetype.
- Model and version.

## Feed outcomes

### Noise reduction

The share of observed items hidden or reduced that the user does not later reverse.

### Useful discovery

Promoted items the user explicitly marks useful or chooses to keep seeing.

### Novelty

The share of promoted items that are not duplicates or close restatements of recently observed content.

### Source quality

The share of promoted news and technical content linked to primary sources.

### Time saved

An estimate based on hidden-item count and a user-adjustable average inspection time. The assumption is displayed with the metric.

## Trust and control

- Reveal rate for hidden items.
- Correction rate.
- Undo rate after rule creation.
- Rules disabled shortly after creation.
- Decisions without an adequate explanation.
- Sync conflicts requiring manual resolution.
- Assisted drafts edited before save.
- Smart suggestions accepted, dismissed and suppressed after repeated dismissal.
- Operations that report success before durable completion.

A high hidden-item count is not inherently successful. It may indicate an overly aggressive profile.

## Ease of use

- Time and decisions from first open to first useful action.
- Completion rate for hide, reveal, source block, source allow and undo.
- Common actions completed without opening the full menu.
- Semantic rules saved without re-entering known platform, surface, source or item data.
- Recoverable failures resolved without losing draft input.
- Modal or panel transitions per task.
- Users who can explain the scope of an assisted draft before saving it.

The v0.1 usability gate uses a fixed script with at least eight first-time participants. At least seven complete the first deterministic rule and preview without assistance in at most two minutes and three decisions. The script records participant criteria, task start and stop rules, facilitator intervention and every failure.

## Reliability and recovery

- Successful durable operations by operation type.
- Partial batch failure rate.
- Automatic retry attempts and exhausted retries.
- Duplicate user-visible error suppression.
- Draft recovery after restart or storage failure.
- Worker-restart recovery without duplicate feedback.
- Migration rollback success.
- Adapter disablement caused by capability or contract failure.

Reliability metrics separate attempted, acknowledged and durably completed operations. An optimistic UI acknowledgement is not counted as success until persistence confirms it.

## Performance

- Direct-action acknowledgement latency.
- Deterministic decision latency.
- Text and vision inference latency percentiles.
- Queue wait and cancellation latency.
- Queue depth.
- Cache hit rate.
- Main-thread blocking.
- Memory use.
- Storage growth.

## Adapter health

- Candidate extraction success.
- Missing stable identity rate.
- Duplicate candidate rate.
- Stale result rejection.
- Rendering restore success.
- Selector failure by surface.

## Evaluation protocol

1. Label a representative evaluation set before tuning.
2. Separate training examples from held-out evaluation.
3. Evaluate topics, archetypes and exceptions independently.
4. Tune thresholds against false-positive cost.
5. Record model, rule and dataset versions.
6. Repeat after model or archetype changes.

## Local dashboard

The side panel can show:

```text
This week
Items observed                     1,240
Hidden                               312
Reduced                              104
Promoted                              67
Revealed after hiding                  6
Confirmed false positives              3
Confirmed false negatives              9
Estimated inspection time saved     38 min
```

No remote telemetry is required to calculate these values.

Reveal, correction and undo metrics are observational and self-selected. They do not estimate population false-positive or false-negative rates. Quality claims use a frozen evaluation dataset under the applicable dataset manifest.

## Open-source project metrics

Project maintainers may publish results from opt-in, redacted benchmark datasets:

- Adapter compatibility.
- Model resource use.
- Archetype accuracy.
- Language coverage.

Personal profile contents must never be included in public benchmarks without explicit, case-specific consent.
