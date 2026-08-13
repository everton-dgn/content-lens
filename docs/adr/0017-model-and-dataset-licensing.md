# ADR 0017: Model and dataset licensing

Status: Accepted

## Context

The visual-classification and similarity contracts both block promotion on
OQ-011, which asks which license and redistribution terms apply to each shipped
model and dataset. The visual contract also carries the narrower question of
whether models should be optional downloads or packaged artifacts.

The question stayed open because it was framed as a consequence of model
selection: no model is selected, so no license applies. That framing blocks
work that does not depend on the selection. Corpus collection cannot start
without licensing terms, and the corpus is what OQ-003 needs before any model
can be chosen. Deciding the policy first breaks that cycle.

The extension ships no model weights today. The provider catalog covers the
browser built-in model, `ollama`, `openai`, `openai-compatible`, `anthropic`,
`gemini`, `custom` and `user-proxy` kinds. In every case the weights belong to
the browser or to a provider the user configured, and
[ADR 0010](0010-credential-handling.md) already governs how the extension talks
to them.

## Considered options

### How weights reach the user

1. Never bundle or download weights. Only the browser built-in model and
   providers the user configures.
2. Optional runtime download, verified against an expected digest before load.
3. Package weights inside the store artifact.

Option 1 matches what the codebase already does and keeps redistribution
obligations with whoever installed the model. Option 2 is already described in
[the supply-chain policy](../supply-chain.md) and stays available, but choosing
and pointing at an artifact still carries upstream attribution and
prohibited-use obligations even when the project never serves the bytes.
Option 3 inflates the store package and ties model updates to store review.

Model weights are not remotely hosted code for Chrome Web Store purposes, so
none of the three options is blocked by store policy. The inference runtime is
code and must be packaged; several ML libraries fetch their WASM backend from a
CDN by default, which is the pattern that gets rejected.

### Which model licenses are acceptable

1. Permissive only: Apache-2.0, MIT, BSD.
2. Permissive plus reviewed source-available terms.

Option 1 keeps the project's own MIT terms clean and covers the current
landscape: Gemma 4 moved to Apache-2.0 in April 2026, and Qwen has been
Apache-2.0 across generations. Option 2 would admit terms such as the Llama
community license, whose 700 million monthly-active-user ceiling counts across
a whole corporate group, requires visible "Built with Llama" attribution and
forbids distilling into models outside its family. Those obligations are
tractable but they belong in a decision of their own, not in a blanket
allowance.

### Which dataset licenses are acceptable

1. Synthetic and redistributable material only, committed to the repository.
2. Hybrid: redistributable items committed, the rest referenced by URL and
   checksum.
3. Only material the project can relicense.

Option 1 lets a third party rerun an evaluation and reach the same number,
which is what EVA-012 asks for when it requires model claims to link raw
aggregate results and evaluation code. Option 2 is more representative of real
content and breaks that guarantee as soon as a URL dies. Option 3 is the safest
and the slowest.

## Decision

**Weights.** The extension neither bundles nor downloads model weights. Every
model runs through the browser built-in API or a provider the user configured.
Adding a project-selected downloadable artifact requires a new ADR that records
the artifact manifest required by the supply-chain policy.

**Models managed by the browser are outside the artifact manifest
requirement.** The built-in model has no digest, version or redistribution term
under project control, so a manifest would record facts the project cannot
verify. What the catalog records instead is the boundary: `execution: "browser"`
and no policy URL, because no data leaves the device and there is no provider
policy for the user to review. A model the project selects and points at is a
different case and takes the full manifest.

**Model licenses.** Only Apache-2.0, MIT and BSD, by SPDX identifier. Any
source-available or custom term requires its own ADR recording each obligation
item by item, including attribution, field-of-use limits and downstream
training restrictions.

**Dataset licenses.** Held-out corpora contain only synthetic material or
material under a license that permits public redistribution: CC0-1.0, CC-BY-4.0
and ODC-BY-1.0. Every corpus is committed to the repository. Each source
carries a reviewed record of the platform terms it was collected under, in the
`license` and `source_provenance` fields the dataset manifests already define.

A source whose terms forbid redistribution is not collected. Where such a
source is the only way to represent an archetype, the archetype is covered by
synthetic material written for it, labeled as synthetic, and reported
separately.

**Visual media follows the same rule with no exception.** Platform thumbnails
and post images belong to whoever published them and almost never carry a
redistributable license, so the visual corpus is expected to be synthetic and
committed like every other partition. The visual manifest previously allowed a
reference to reviewed assets kept outside the repository; that allowance is
withdrawn, because an evaluation nobody else can rerun is not evidence.

## Consequences

Corpus collection can start, which unblocks OQ-003. Model selection is narrowed
to permissively licensed weights before any evaluation begins, so a model that
scores well under terms the project cannot accept is never a sunk cost.

The dataset rule costs representativeness. Synthetic protected exceptions are
written by whoever builds the corpus and can encode that person's assumptions
about which contexts are protected, which is the exact bias EVA-010 asks to
record rather than resolve. The evaluation reports synthetic and collected
slices separately so the gap stays visible.

The visual rule carries a sharper consequence. Its promotion gate requires a
pre-registered minimum incremental benefit over the text-only baseline, measured
on a frozen corpus. A number measured on synthetic thumbnails does not transfer
to real ones, so visual classification cannot promote on that evidence alone.
Promoting it needs either a genuinely redistributable media source or a
different evidence design, and that is a better place to be than promoting on a
corpus nobody outside the project can inspect.

The weights rule means the extension inherits whatever quality the browser or
the user's provider offers, and cannot ship a smaller model tuned for the task.
That is the cost of not redistributing anything.

## Evidence

- [Supply-chain policy](../supply-chain.md) for the model manifest, dataset
  record and runtime digest requirements.
- [Metrics](../18-metrics.md), including EVA-001 for the per-dataset record,
  EVA-002 for the ban on personal browsing data and EVA-012 for linked raw
  results.
- Dataset manifests for
  [text](../datasets/text-manifest.md),
  [visual](../datasets/visual-manifest.md) and
  [similarity](../datasets/similarity-manifest.md), which already require an
  SPDX identifier and reviewed source provenance. The
  [assistance manifest](../datasets/assistance-manifest.md) carries no licensing
  rule because it collects no third-party content: its evidence is a moderated
  crossover study.
- [The browser built-in catalog entry](../../src/ai/browser/catalog.ts) and its
  [language model boundary](../../src/ai/browser/language-model.ts) for the
  model the extension uses without distributing it.
- Chrome extension policy on remotely hosted code and models, at
  <https://developer.chrome.com/docs/extensions/ai> and
  <https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code>.
