# Internal APIs

These interfaces define boundaries, not a stable public SDK. Changes follow architecture decisions until the first implementation stabilizes them.

## Adapter

```ts
interface FeedAdapter {
  readonly platform: Platform;
  capabilities(): AdapterCapabilities;
  observe(emit: CandidateHandler): Promise<ObservationHandle>;
  extract(candidate: PlatformCandidate): Promise<ContentItem>;
  renderDecision(
    candidate: PlatformCandidate,
    decision: Decision,
  ): Promise<void>;
  injectActions(
    candidate: PlatformCandidate,
    actions: ContentAction[],
  ): Promise<void>;
  restore(candidate: PlatformCandidate): Promise<void>;
}
```

## Rules

```ts
interface RuleEngine {
  evaluate(item: ContentItem, profile: RuleProfile): RuleEvaluation;
  index(rules: Rule[]): Promise<void>;
  invalidate(ruleIds: string[]): Promise<void>;
}

type RuleEvaluation =
  | { resolved: true; decision: Decision; matchedRules: Rule[] }
  | { resolved: false; evidence: Evidence[] };
```

## Classifier

```ts
interface Classifier {
  readonly id: string;
  readonly version: string;
  supports(item: ContentItem): boolean;
  classify(
    item: ContentItem,
    context: ClassificationContext,
  ): Promise<ClassificationResult>;
}

type ClassificationResult = {
  schemaVersion: string;
  topics: TopicScore[];
  archetypes: ArchetypeScore[];
  quality: Partial<QualityScores>;
  semanticMatches: SemanticRuleMatch[];
  evidence: Evidence[];
  confidence?: number;
  abstention?: ClassificationAbstention;
  provenance: ClassificationProvenance;
};
```

Provider adapters do not return `ClassificationResult` directly. They return a
strict `ClassificationModelOutput` without provenance or action fields. The
privileged classifier validates that untrusted output and creates
`ClassificationProvenance` from the selected route. The policy engine is the
only boundary that can choose a final action.

## Decision engine

```ts
interface DecisionEngine {
  decide(
    item: ContentItem,
    signals: ClassificationResult[],
    profile: DecisionProfile,
  ): Decision;
}
```

The decision engine is pure for a fixed set of inputs. Persistence and queue management live outside it.

## Feedback

```ts
interface FeedbackService {
  record(
    operationId: string,
    input: FeedbackInput,
  ): Promise<OperationResult<FeedbackResult>>;
  undo(
    operationId: string,
    feedbackId: string,
  ): Promise<OperationResult<void>>;
  buildRule(input: RuleDraftInput): Promise<RuleDraft>;
  applyCorrection(
    operationId: string,
    input: CorrectionInput,
  ): Promise<OperationResult<InvalidationPlan>>;
}
```

Repeated calls with the same `operationId` are idempotent within the accepted retention window. A pending acknowledgement is distinct from a committed durable result.

## User operations

```ts
type OperationResult<T> =
  | { state: "committed"; value: T; revision?: number }
  | { state: "partial"; value: T; failures: OperationFailure[] }
  | { state: "cancelled"; committedEffects: OperationEffect[] }
  | { state: "unavailable"; capability: string; fallback: string }
  | { state: "failed"; error: UserSafeError; retryable: boolean };

interface UserOperationService {
  status(operationId: string): Promise<OperationStatus>;
  retry(operationId: string): Promise<OperationResult<unknown>>;
  compensate(operationId: string): Promise<OperationResult<void>>;
}
```

The UI derives pending, success, partial-success, cancelled, unavailable and failed states from this boundary. Raw storage, model and provider exceptions do not cross into user-facing components.

## Intelligent assistance

The implemented boundary separates model output, routed execution, preview and
durable save:

```ts
interface AssistanceService {
  generateDraft(input: {
    request: AssistanceDraftRequest;
    runtime: AssistanceRuntimeProvenance;
    signal?: AbortSignal;
  }): Promise<DraftGenerationResult>;
  explain(input: {
    request: AssistanceExplanationRequest;
    runtime: AssistanceRuntimeProvenance;
    signal?: AbortSignal;
  }): Promise<ExplanationResult>;
}

interface RoutedAssistanceService {
  generateDraft(input: RoutedDraftRequest): Promise<RoutedDraftResult>;
  explain(input: RoutedExplanationRequest): Promise<RoutedExplanationResult>;
}

interface ProposalSuppressionService {
  status(input: ProposalFingerprint): Promise<SuppressionStatus>;
  dismiss(input: ProposalFingerprint): Promise<SuppressionRecord>;
  reactivate(input: ProposalFingerprint): Promise<SuppressionRecord>;
}
```

Model output contains proposed fields only. Draft identity, profile revision,
provider, model, route, prompt, schema and capability provenance are attached
locally. Outputs are validated, editable and non-authoritative. The service
cannot persist rules, call platform adapters or submit native platform actions.
`previewAssistedRuleDraft` performs a pure dry-run. A separate
`RuleManagementService.save` call with the expected profile revision is the
only durable confirmation path.

## Storage

```ts
interface ProfileRepository {
  read(): Promise<Profile>;
  transact<T>(
    expectedRevision: number,
    mutation: (profile: Profile) => T,
  ): Promise<{ value: T; revision: number }>;
  export(): Promise<ProfileEnvelope>;
  import(profile: ProfileEnvelope): Promise<ImportResult>;
}
```

## Runtime health and diagnostics

```ts
interface RuntimeHealthService {
  capabilities(): Promise<CapabilitySnapshot>;
  health(): Promise<HealthSnapshot>;
  recover(input: RecoveryRequest): Promise<RecoveryResult>;
}

interface DiagnosticsService {
  summarize(filter?: DiagnosticsFilter): Promise<RedactedDiagnosticSummary>;
  export(input: DiagnosticExportRequest): Promise<DiagnosticExport>;
  clear(): Promise<void>;
}
```

Diagnostics are local, bounded and redacted. Export requires a preview and explicit user action. Health checks cannot mutate profile state except through a named recovery operation.

## Synchronization

These interfaces are provisional experiment boundaries. They remain absent
from the production path until ADR 0009 and the synchronization contract are accepted and the
selected provider resolves OQ-007. Credential records for model providers
already follow ADR 0010, but they do not authorize sync.

```ts
interface SyncProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  pull(version?: string): Promise<RemoteProfile | null>;
  push(
    profile: EncryptedOrPlainProfile,
    expectedVersion?: string,
  ): Promise<PushResult>;
  getStatus(): Promise<SyncStatus>;
}
```

No merge interface is accepted. ADR 0009 must define conflict inputs, outputs and metadata before such an API enters the architecture.

## Model provider

```ts
interface ModelProvider {
  readonly mode: "local" | "browser" | "cloud";
  availability(): Promise<ModelAvailability>;
  text(
    input: TextModelInput,
    signal: AbortSignal,
  ): Promise<ClassificationModelOutput>;
  image?(input: ImageModelInput): Promise<ImageModelOutput>;
  embed?(input: EmbeddingInput): Promise<Float32Array>;
}
```

Cloud providers receive only fields allowed by current consent settings.
Text providers receive zero image data. Browser mode uses the
`contentlens.browser-ai.v1` document port and the browser Prompt API. The route
is unavailable while no trusted extension document is connected.

Cloud model descriptors may include verified pricing:

```ts
type ModelPricing = {
  currency: string;
  unit: "per-1m-tokens";
  inputPerMillion: number;
  outputPerMillion: number;
  verifiedAt: string;
  version: string;
  sourceUrl: string;
};
```

Automatic cloud classification requires current pricing in the budget currency
and an explicitly enabled nonzero monetary budget. The runtime reserves a
conservative upper bound before the request. Missing or stale pricing is an
unavailable route, not a zero-cost route.

## Provider configuration and connection

Provider descriptors contain configuration and redacted operational state.
Credential values remain behind `CredentialVault` and are referenced only by
opaque `credentialRef` values.

```ts
type ProviderConnectionResult = {
  outcome: "success" | "failure" | "cancelled";
  code: ProviderConnectionCode;
  checkedAt: string;
  latencyMs: number;
  providerStatus: ProviderDescriptor["status"];
};

interface ProviderManagementService {
  testConnection(
    providerConfigId: string,
    input: {
      modelId: string;
      userInitiated: boolean;
      quotaAcknowledged: boolean;
      checkedAt: string;
      signal?: AbortSignal;
    },
  ): Promise<{
    provider: ProviderDescriptor;
    result: ProviderConnectionResult;
  }>;
}
```

The connection path accepts providers that are still locked or unconfigured so
it can test them. The production inference path remains `ready` only. A
connection test uses a fixed synthetic prompt, checks the exact host permission
before vault access and validates the adapter response schema. Its durable
record excludes the endpoint, model ID, prompt, response, headers and
credential.

`background.main()` stays synchronous as required by the installed WXT
contract. It starts provider rehydration as a captured promise while the
deterministic message listener uses the same `ContentLensDatabase`. An
unreadable provider snapshot produces `provider-state-unreadable` and does not
disable deterministic decisions.

## Versioning

- Stored entities use schema versions.
- Classifier results record model and classifier versions.
- Adapter capability changes are feature-detected.
- Unknown profile fields survive round trips when safe.
- Public plugin contracts will use semantic versioning after stabilization.
