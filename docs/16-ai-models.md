# AI models

## Strategy

ContentLens uses the smallest adequate mechanism for each decision:

1. Deterministic rules.
2. Text embeddings and lightweight classifiers.
3. Visual embeddings or classifiers.
4. A small local language model for ambiguous semantic cases.
5. An optional cloud VLM or LLM after explicit configuration.

A large language model is not called for every feed item.

Content classification and user assistance are separate tasks. A model accepted for one task is not automatically accepted for the other.

## User assistance

The implemented assistance boundary may:

- Turn a user instruction and current item context into an editable rule draft.
- Suggest examples, exclusions or narrower scope.
- Convert technical evidence into a short user-safe explanation.
- Group repeated explicit corrections into a reviewable proposal.

The assistance model does not persist rules, choose an irreversible action, expand to another platform or submit native feedback. Its output passes a task-specific schema and policy validator before display.

Required draft metadata includes:

- Fields inferred from current context.
- Fields inferred by the model.
- Missing or ambiguous fields.
- Capability and model version.
- Evidence references safe for display.

If assistance times out or becomes unavailable, the editor retains current context and remains manually usable.

## Text

Text classification maps titles and post bodies to:

- Topic probabilities.
- Archetype probabilities.
- Quality signals.
- Semantic rule matches.
- Evidence labels.

The current classification boundary accepts only bounded textual fields. It
rejects image bytes, image URLs, data URLs, tensors, DOM, cookies, account
identifiers, credentials, unrelated rules and unrelated profile data before a
provider request is built.

The fixed task instructions and untrusted feed data occupy separate fields.
Provider output is parsed with a strict schema and cannot contain an extension
action, storage command, tool call or platform mutation. Unknown fields reject
the complete item output.

The implementation supports routed local, browser and cloud adapters. Browser
execution uses a document bridge because the Prompt API is unavailable in
service workers. It never passes through the network-provider transport. The
router does not replace an unavailable browser document with cloud unless the
user configured and authorized that exact fallback.

## Vision

CLIP-like or SigLIP-like embeddings can compare thumbnails with labeled examples. A lightweight classifier may estimate visual clickbait features.

Vision is requested only when:

- The adapter exposes an image.
- Text and deterministic rules did not resolve the item.
- The user's active preferences use visual signals.

## Embeddings

Embeddings support:

- Semantic rules.
- Positive and negative examples.
- Topic and archetype centroids.
- Similar-content actions.
- Duplicate and novelty analysis.
- Content graph edges.

Model upgrades require migration or recomputation because vectors from different embedding spaces are not directly comparable.

Each representation records provider, model, modality, dimension,
preprocessing, normalization and version space. Retrieval filters by that full
space plus retention, platform, surface and language. Cloud embedding uses only
an accepted route with specific consent and minimized title and body text. A
failed cloud route cannot try another cloud provider silently; it may continue
only through an already accepted browser or local route. Exact matching remains
available when no probabilistic route can run.

## Language and vision models

A local LLM or VLM can resolve nuanced cases and return structured labels. It should not return the final action directly. The policy engine combines model output with explicit rules and thresholds.

Provider output is deliberately untrusted and contains no runtime provenance:

```ts
type ClassificationModelOutput = {
  schemaVersion: "classification-model-output@1";
  topics: Array<{ id: string; score: number }>;
  archetypes: Array<{ id: string; score: number }>;
  quality: Partial<Record<QualitySignal, number>>;
  semanticMatches: Array<{
    ruleId: string;
    score: number;
    evidenceRefs: string[];
  }>;
  evidence: Array<{
    id: string;
    label: string;
    sourceKind: EvidenceSourceKind;
    sourceRef?: string;
    score?: number;
  }>;
  confidence?: number;
  abstention?: ClassificationAbstention;
};
```

After validation, the privileged runtime creates canonical
`ClassificationSignals` with trusted provider, model, classifier, schema,
prompt, preprocessing and policy versions. Only the policy engine converts
those signals into `show`, `reduce` or `hide`.

Deterministic reveal, allow, identity and exact rules run first. A resolved item
causes zero model calls. Timeout, cancellation, invalid output, unsupported
input, unsupported language, resource limits, cost limits and provider
unavailability abstain and preserve the visible baseline.

## Browser-provided AI

Browser AI APIs may reduce installation cost but vary by browser, hardware, language and release channel. They can be an optional model provider after feature detection. They are not a mandatory architectural dependency.

Chrome receives a built-in `gemini-nano` catalog entry for text
classification, visual classification, rule drafting and explanation. The
extension document checks `LanguageModel.availability()` with the same
modalities and languages used to create a session, supplies the task JSON
Schema through `responseConstraint` and destroys the session after each bounded
request.

The service worker communicates with that document through the versioned
`contentlens.browser-ai.v1` port. Requests are bounded, cancellable and accept
at most one already minimized image. If the side panel document is closed, the
route reports `document-unavailable`. A model download requires a user gesture;
passive feed processing cannot trigger it.

The current browser catalog declares only `en` and `es`. `pt_BR` and unknown
language inputs are rejected before session creation because the current Prompt
API documentation does not list Portuguese support. Firefox receives no
built-in browser model entry. Local and explicitly authorized cloud routes
remain available on both browsers.

## Cloud providers

Cloud inference can improve ambiguous classification, but introduces cost, latency and privacy concerns.

Rules:

- No provider key in the extension bundle.
- User-supplied credentials follow the accepted session-only,
  passphrase-wrapped or external-vault boundary in
  [ADR-0010](adr/0010-credential-handling.md). A provider may impose a stricter
  provider-specific flow.
- Requests contain the minimum required fields.
- Every cloud route requires an exact, revocable consent receipt.
- Images require separate consent.
- A local fallback remains available.
- Provider errors fail open.
- Cloud pricing metadata must include currency, a `per-1m-tokens` unit, input
  and output prices, verification time, table version and HTTPS source.
- Missing, stale or currency-incompatible pricing blocks automatic cloud
  classification. Absence is never interpreted as zero cost.
- The default cloud monetary budget is disabled with a zero limit.

An optional user-owned proxy may be supported, but ContentLens does not require a hosted backend.

The packaged provider catalog contains browser built-in AI, OpenAI, Anthropic,
Gemini, Ollama, OpenAI-compatible, custom and user-owned proxy templates. A new
network descriptor starts `unconfigured`; selecting a template does not grant
network access or activate a route. The browser built-in descriptor has no
network adapter, credential or host-permission request.

The connection sequence is:

1. Normalize and validate the provider origin.
2. Request only that origin after a named user gesture.
3. Require an unlocked credential when the adapter authenticates.
4. Require acknowledgement that the synthetic request may consume quota.
5. Send a fixed payload with no real feed, profile or rule content.
6. Validate authentication, transport and the packaged output schema.
7. Persist only a finite result code, outcome, latency and timestamp.

A successful connection marks the provider `ready`, but inference still needs
an eligible model route and an exact consent receipt. A failed write does not
change the live provider state. Native browser fetch errors do not reliably
distinguish every DNS, TLS and host failure; the default unknown network failure
uses the host-unreachable code, while a browser-specific transport may supply a
typed TLS code. Raw network error text is never persisted or displayed.

## Prompt-injection resistance

Feed content is untrusted data. Prompts:

- Delimit content from instructions.
- Request a fixed structured schema.
- Reject tool calls and arbitrary actions.
- Do not give model output access to extension APIs.
- Validate every returned field and numeric range.

The provider schema does not expose trusted provenance fields. A model cannot
claim a provider identity, model version, classifier version or policy version.
Evidence source references reject query strings and fragments so request data
cannot be reflected into stored evidence URLs.

## Cache and route lifecycle

Only validated canonical signals are cached. Raw provider responses are never
stored. The cache key binds provider and capability fingerprints, task, content
fingerprint, profile revision, language, platform, surface, route, model,
prompt, output schema, preprocessing and policy versions. A credential value or
credential identity never enters the key.

Route selection and fallback remain explicit. An unavailable route cannot
activate cloud implicitly. `invalid-output` is not retried on the same route;
only a separately configured fallback that passes permission, consent, pricing,
budget and capability checks may run.

## Model registry

```ts
type ModelDescriptor = {
  id: string;
  version: string;
  task: "text" | "vision" | "embedding" | "language" | "vision-language";
  execution: "local" | "browser" | "cloud";
  languages: string[];
  inputLimit: number;
  estimatedMemoryMb?: number;
  pricing?: {
    currency: string;
    unit: "per-1m-tokens";
    inputPerMillion: number;
    outputPerMillion: number;
    verifiedAt: string;
    version: string;
    sourceUrl: string;
  };
  privacy: ModelPrivacyDescriptor;
};
```

## Selection

The selection policy considers:

- Active signals required by the profile.
- Device capability.
- Language.
- Latency budget.
- Privacy mode.
- User cost limit.
- Model availability.
- Task authorization, because classification and assistance have separate acceptance gates.

## Evaluation gate

A model is not a default until it passes:

- Personal-topic precision and recall.
- False-positive rate on allowed exceptions.
- Separate Portuguese, English and Spanish slices.
- Latency and memory budgets on target hardware.
- Visual clickbait counterexamples.
- Stable structured output.
- Offline behavior.

The frozen held-out text corpus required for promotion does not exist yet.
Synthetic contract fixtures are not release evaluation data. The required
inventory is at least 750 items, with at least 200 each in `pt_BR`, `en` and
`es`, plus at least 150 protected exceptions distributed across the three
languages. Until that corpus and its quantitative reports exist, text
classification stays implemented but not approved for default enablement. See
[the text dataset manifest](datasets/text-manifest.md).

An assistance model also passes:

- Draft-schema validity.
- Scope-preservation tests.
- Unsafe-action refusal tests.
- Exception quality and over-broad-rule tests.
- User correction effort against the manual baseline.
- Prompt-injection fixtures that attempt to save, broaden or submit an action.

Assistance is accepted only when it reduces median task effort without increasing unintended durable changes or false user confidence.

The nonvisual assistance implementation exists, including strict draft and
explanation schemas, trusted runtime provenance, local draft policy, dry-run,
stale revision and card checks, explicit fallback, task-specific consent,
batch evidence threshold and dismissal suppression. Its visual editor and
moderated usability evidence remain blocked by the visual approval gate. See
[the assistance evaluation manifest](datasets/assistance-manifest.md).

Visual model promotion remains blocked for the same reason as text promotion:
the required frozen corpus and quantitative report do not exist. See
[the visual dataset manifest](datasets/visual-manifest.md).
