# Implementation conventions

These conventions turn the accepted architecture and delivery contracts into
day-to-day implementation rules. They describe the current repository and do
not create new product behavior.

## Module ownership

| Area | Owns | Must not own |
| --- | --- | --- |
| `src/core/` | Deterministic domain contracts, rules, decisions and operation state | Platform DOM, WXT entrypoints or concrete persistence |
| `src/adapters/` | Platform extraction, normalization, routes and reversible rendering | Durable credentials or cross-platform policy |
| `src/application/` | Use cases, orchestration, ports and truthful operation lifecycles | Platform selectors or UI styling |
| `src/storage/` | IndexedDB records, migrations and storage implementations | Product policy or platform rendering |
| `src/sync/` | Portable state, conflict handling and provider boundaries | The only copy required for normal operation |
| `src/security/` | Credential envelopes, vault boundaries and redaction contracts | Content-script access to secrets |
| `src/extension/` | Browser lifecycle and runtime composition | Domain decisions that belong in core or application services |
| `src/ui/` | Shared components and product views | Raw visual values outside the token contract |

The page environment is untrusted. Adapters treat extracted markup and media as
data, and content scripts remain unable to read provider credentials or profile
storage directly.

## Imports and public surfaces

- Use `@/` imports between repository areas.
- Use relative imports for files that form one local module.
- Prefer named exports for shared contracts and components.
- Keep `index.ts` files as intentional public facades. Export only symbols with
  current consumers or a documented external contract.
- Avoid moving a symbol into a generic shared area until more than one area
  needs it.

## Runtime behavior

- Optional capabilities fail open and preserve the deterministic baseline.
- A pending acknowledgement never claims durable success.
- Service-worker handlers recover from restart through persisted state and
  idempotent operations.
- Adapter rendering verifies item and page-instance identity before applying a
  late result to recycled DOM.
- Portable data, diagnostics and logs exclude credentials and raw private
  browsing content.

## Tests

- Pure domain behavior belongs in unit tests close to the implementation or in
  the matching test layer.
- Cross-implementation behavior belongs in shared contract suites.
- Browser behavior uses packaged Chrome and Firefox journeys against local
  fixtures.
- A regression test proves the failed input, state or lifecycle branch. Do not
  weaken an existing assertion to make a change pass.
- Test fixtures contain no credentials, personal browsing history or private
  URLs.

## Dependencies and generated files

- pnpm is the only package manager, and dependencies use exact versions.
- Every new dependency is admitted through `docs/dependency-policy.md` before
  its first import or executable use.
- Generated i18n keys and release evidence are updated through their owning
  scripts rather than edited by hand.
- Entry points, scripts and configuration files stay represented in the Knip
  graph so dependency and cycle results cover the intended build and test
  surfaces.
- Repository-wide Knip passes keep configuration hints as errors. Do not add
  `--no-config-hints` without replacing that stale-configuration protection.

## Validation by change type

| Change | Minimum validation |
| --- | --- |
| Documentation | `pnpm docs:check` |
| Core or application behavior | Narrow test, `pnpm test:unit`, `pnpm typecheck` |
| Adapter or browser lifecycle | Narrow contract test, relevant packaged browser journey, `pnpm typecheck` |
| UI or visible copy | Design-system check, unit and accessibility tests, narrow side-panel journey |
| Dependency, entrypoint or import graph | `pnpm deps:check`, `pnpm typecheck`, relevant tests |
| Release or supply chain | Relevant workflow contract tests and `pnpm ci:local` |

Run the narrowest command first. Expand validation when the change crosses more
than one boundary or changes a release gate.
