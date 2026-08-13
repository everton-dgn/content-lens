# Performance contract

Performance is a product and safety property because an extension runs inside long-lived, resource-sensitive browser sessions.

## Measurement rules

- Report browser version, operating system, CPU, memory and GPU capability.
- Run a warm and cold scenario.
- Measure at least 30 repetitions after setup.
- Report median, p95 and worst observed value.
- Separate worker time, model time and page main-thread work.
- Compare with the same fixture page without ContentLens.
- Store raw benchmark output as a CI or release artifact when code exists.

## Device classes

### Baseline

A device without a usable local model runtime. It receives deterministic filtering and must fail open for unavailable inference.

### Standard

The minimum supported device selected by the feasibility phase. Exact hardware and browser are frozen before semantic classification becomes default.

### Enhanced

A device that passes WebGPU and memory capability checks for optional local vision or language models.

## Provisional deterministic budgets

These gates apply before a model is selected:

| Measurement | Gate |
| --- | --- |
| Visual acknowledgement after a direct user action | p95 at or below 100 ms |
| Rule lookup after normalized extraction | p95 at or below 25 ms |
| Adapter render or restore work per card | p95 at or below 8 ms main-thread time |
| Extension-attributed long task | No task above 50 ms in the 20-card fixture |
| Initial deterministic pass over 20 cards | p95 at or below 100 ms excluding page load |
| Duplicate observation suppression | At least 99.9% in the virtualization stress fixture |
| Stale decision applied to a recycled node | Zero |
| Retry after a recoverable UI error | Reuses preserved input and requires one action |

These gates are executable. `pnpm benchmark` runs the assertions behind them
and the CI job fails when one regresses. Each run prints a structured record
with median, p95 and worst observed value, which satisfies the measurement
rules above.

The budgets belong to the Standard reference device in
[compatibility](compatibility.md#reference-environment). A shared CI runner is
not that machine, and enforcing the reference number there measures the runner
rather than the code: the Hacker News extraction that takes 13.5 ms p95 on the
reference host measured 55.9 ms on a GitHub runner against a 50 ms budget.

So each benchmark reports its regime. On the reference device the budget is
exact. Elsewhere it is multiplied by a factor of three, which turns CI into a
gross-regression guard: three times slower is a real problem on any hardware,
ordinary contention is not. Every record carries `"regime"`, so a passing CI
result is never mistaken for a passing reference-device result.

A release claim uses the reference-device run. CI only guards against a
regression landing unnoticed.

The feasibility phase may tighten these gates. Relaxing one requires evidence, spec updates and an ADR when user experience changes.

## Perceived-performance contract

Fast interaction includes response clarity as well as elapsed time:

- A direct action changes local visual state or acknowledges pending work within 100 ms.
- Work that exceeds the acknowledgement budget continues outside the page main thread when the selected browser permits it.
- A progress indicator is shown only when it communicates meaningful wait or control.
- Model and artifact downloads show total size, transferred size, pause, cancel and storage impact.
- Cancellation stops obsolete queued work and prevents late UI mutation.
- A background failure does not interrupt scrolling, move focus or replace a newer operation status.
- Equivalent repeated failures collapse into one current status.

Optimistic acknowledgement must distinguish pending from durable success. A save failure restores the prior durable state or retains an editable draft; it never leaves the UI claiming that an unsaved rule is active.

## Model budgets

No model latency or memory budget is accepted yet. Before a model becomes a default, its ADR MUST record:

- Reference device and browser.
- Download and installed size.
- Peak and steady-state memory.
- Cold and warm latency.
- Batch size.
- Accuracy and false-positive effect.
- Behavior when capability detection fails.

The feature MUST remain optional if the Standard device misses its accepted gate.

Model-backed user actions also declare:

- Time to first useful preview.
- Cancellation latency.
- Queue wait separately from inference time.
- Fallback time when the model becomes unavailable.
- Whether a draft can be completed manually while inference is pending.

## Storage budgets

v0.1 MUST:

- Keep disposable content history bounded by age and count.
- Expose cache size and clear controls.
- Avoid storing raw thumbnail bytes after classification.
- Measure database growth after 10,000 synthetic observations.

The storage spec freezes numeric limits after the feasibility benchmark.

## Network budgets

The MVP makes no required remote request beyond the platform page itself. Optional providers and model downloads declare size, frequency, retry and cancellation behavior before activation.

## Regression

A release fails when:

- Any hard gate regresses.
- p95 changes by more than 20% without an accepted explanation.
- Memory growth is unbounded.
- Disabled or unavailable capability blocks normal browsing.
- A direct action misses its acknowledgement budget on the reference fixture.
- Retry loses user-entered draft data.
- Background work repeatedly interrupts or duplicates user-visible status.
