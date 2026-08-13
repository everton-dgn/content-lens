# Architecture decisions

Architecture decision records capture choices that affect several components or constrain future implementation.

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](adr/0001-local-first.md) | Accepted | Local IndexedDB is the primary store and no backend is mandatory. |
| [0002](adr/0002-layered-classification.md) | Accepted, amended by 0006 | Deterministic rules precede independently gated optional classifiers. |
| [0003](adr/0003-platform-adapters.md) | Accepted | Platform DOM integration is isolated behind feed adapters. |
| [0004](adr/0004-explicit-feedback.md) | Accepted | Explicit feedback outweighs passive behavior. |
| [0005](adr/0005-user-owned-sync.md) | Accepted, amended by 0009 and 0010 | Any future network sync stays optional, provider-neutral and user-owned; no provider or unsafe merge is preselected. |
| [0006](adr/0006-capability-maturity.md) | Accepted | Optional capabilities have explicit maturity and availability. |
| [0007](adr/0007-version-domains.md) | Accepted | Product and persisted contracts use separate version domains. |
| [0008](adr/0008-supply-chain-integrity.md) | Accepted | Dependencies, actions and models require immutable integrity evidence. |
| [0009](adr/0009-sync-conflict-model.md) | Accepted | Remote conflicts use explicit provider versions and quarantine instead of timestamp-only automatic merging. |
| [0010](adr/0010-credential-handling.md) | Accepted | Provider credentials use session-only, passphrase-wrapped or external-vault boundaries; future sync authentication remains provider-specific. |
| [0011](adr/0011-reviewable-ai-assistance.md) | Accepted | AI may create validated drafts and explanations but cannot mutate durable or platform state. |
| [0012](adr/0012-truthful-idempotent-operations.md) | Accepted | Asynchronous user mutations separate acknowledgement from idempotent durable completion. |
| [0013](adr/0013-extension-toolchain-layout.md) | Accepted | A standalone pnpm project uses React, TypeScript, WXT and Vite with reviewable dependency inputs. |
| [0014](adr/0014-browser-manifest-permissions.md) | Accepted, security amendment | Chrome MV3 and Firefox MV2 use tested browser floors, optional exact-origin grants and Firefox optional data-collection consent. RSS network acquisition is disabled. |
| [0015](adr/0015-local-similarity-content-graph.md) | Accepted | Similarity and content-graph capabilities stay local, bounded and separately gated. |
| [0016](adr/0016-reviewed-native-platform-feedback.md) | Accepted | Native platform feedback requires an explicit reviewed action and fails closed. |
| [0017](adr/0017-model-and-dataset-licensing.md) | Accepted | Every model and dataset requires verified licensing, provenance and redistribution terms. |
| [0018](adr/0018-ui-typography-floor.md) | Accepted | Extension-owned visible text has a token-enforced 12 CSS px minimum and neutral metadata hierarchy. |

## ADR template

Each future ADR includes:

- Context.
- Problem.
- Considered options.
- Decision.
- Tradeoffs.
- Consequences.
- Validation or revisit trigger.
