# ADR 0013: Extension toolchain and repository layout

Status: Accepted

## Context

The feasibility contract requires the repository to record the implementation
language, package manager and build tool before production code is merged.
OQ-001 also blocked the repository layout because
the existing architecture tree described responsibilities without selecting a
physical project structure.

The first public release targets Chrome/Chromium and Firefox from one local-first
codebase. The repository must keep the deterministic core independent from
browser APIs, isolate platform DOM integration and avoid importing server,
monorepo or proprietary application assumptions.

## Problem

The project needs a reproducible browser-extension toolchain that:

- builds Chrome and Firefox artifacts from the same source;
- supports React, strict TypeScript and browser-specific manifests;
- keeps entrypoints thin and internal modules separated by responsibility;
- lets contributors install and validate the project with one package manager;
- exposes dependency and build inputs to review.

## Considered options

1. Use WXT and Vite in a standalone pnpm project with React and TypeScript.
2. Assemble browser manifests, entrypoint discovery and packaging directly on
   Vite plugins.
3. Adopt a server-oriented application scaffold or a monorepo structure.

Option 1 keeps browser-specific generation in a framework whose declared peers
include Vite 8 and TypeScript 7. Option 2 would require project-owned code for
cross-browser manifests, packaging and generated extension types. Option 3
would retain server and workspace boundaries that the extension does not use.

## Evidence

The official [WXT installation guide](https://wxt.dev/guide/installation.html)
supports pnpm bootstrap. Its
[frontend-framework guide](https://wxt.dev/guide/essentials/frontend-frameworks)
documents React through WXT modules or Vite plugins, and its
[migration guide](https://wxt.dev/guide/resources/migrate) defines the
entrypoint, public asset and manifest boundaries used here.

Package metadata was read from the npm registry on 2026-07-29. A clean probe
used Node 24.18.0 and pnpm 11.17.0 with this exact core set:

| Component | Selected version |
| --- | --- |
| React and React DOM | 19.2.8 |
| TypeScript | 7.0.2 |
| Vite | 8.1.5 |
| WXT | 0.21.1 |
| `@wxt-dev/module-react` | 1.2.2 |

The probe completed:

```text
corepack pnpm install --ignore-scripts
corepack pnpm run prepare:wxt
corepack pnpm run typecheck
corepack pnpm run build:chrome
corepack pnpm run build:firefox
corepack pnpm install --frozen-lockfile --ignore-scripts
```

WXT generated types, TypeScript passed with strict checks, and WXT built Chrome
MV3 and Firefox MV2 artifacts with Vite 8.1.5. TypeScript 6 was the research
baseline, but 7.0.2 was the stable registry version at implementation time. The
selected WXT version accepts TypeScript 5.4 or newer, and the probe used no
compiler option removed by TypeScript 7.

WXT 0.21.2 was not selected because it had not passed the configured minimum
release-age window. It can enter through a reviewed dependency update after
that gate passes.

The probe also found one upstream peer warning in Vite's optional WASM fallback:

```text
vite@8.1.5
  -> rolldown@1.1.5
  -> @rolldown/binding-wasm32-wasi@1.1.5
  -> @napi-rs/wasm-runtime@1.2.0
```

The WASM runtime requests 2.x alpha releases of `@emnapi/core` and
`@emnapi/runtime`, while the binding pins version 1.11.1. Native Chrome and
Firefox builds passed without that
fallback. This exact chain is the only bootstrap peer exception. Any other peer
issue blocks installation. The exception expires when the upstream versions
align or when a supported build environment requires the WASM fallback.

## Decision

ContentLens uses one standalone project at the repository root:

- Node 24.x is the development and CI runtime line.
- pnpm 11 is the only package manager; `packageManager` and the committed
  lockfile pin exact resolutions.
- React 19 renders extension pages.
- TypeScript 7 runs in strict mode with bundler module resolution.
- WXT 0.21 and Vite 8 generate, bundle and package the extension.
- `@wxt-dev/module-react` is the React integration boundary.
- Biome, Vitest, Playwright and Lefthook provide formatting, automated tests,
  packaged-browser tests and local hooks.
- Tailwind CSS 4 is the styling baseline.

WXT uses `srcDir: "src"`. The physical layout is:

```text
src/
  entrypoints/
  config/
  application/
  core/
  adapters/
  storage/
  ai/
  ui/
  i18n/
public/
  _locales/
tests/
experiments/
scripts/
  ci/
  release/
docs/
```

`src/entrypoints/` owns browser entrypoints and delegates policy to internal
modules. `src/core/` cannot import extension APIs or platform DOM adapters.
`experiments/` contains disposable feasibility code and is excluded from public
extension artifacts. No internal directory is a publishable package in v1.

Server-oriented application configuration, server-component runtimes,
bundler-specific plugins and unrelated packages are outside this toolchain.

## Dependency policy

- Direct dependencies use exact versions. The lockfile is the complete
  transitive source of truth.
- Node and pnpm versions are machine-readable and checked before install.
- A package release must be at least 24 hours old. An exception records the
  package, reason, reviewer and expiry.
- Install scripts are disabled during the initial resolution. Any required
  script is reviewed and allowlisted before CI enables it.
- Every new dependency records its requirement, owner, license, release
  activity, transitive cost, runtime or bundle cost and security history.
- Runtime dependencies are preferred only when a platform API or existing
  dependency cannot meet the requirement.
- Dependency updates arrive through reviewable pull requests and repeat frozen
  install, typecheck, tests and both browser builds.
- Executable remote code and unverified model downloads remain prohibited by
  [ADR 0008](0008-supply-chain-integrity.md).

## Tradeoffs

- WXT reduces project-owned manifest and packaging code but becomes a build
  dependency that needs cross-browser verification.
- Exact versions and a minimum release age slow routine upgrades.
- A standalone layout keeps ownership clear now but defers reusable package
  boundaries until evidence justifies them.
- The optional Rolldown WASM peer exception requires a narrow, temporary policy
  entry during bootstrap.

## Consequences

- OQ-001 is resolved.
- Task 1.2 creates the machine-readable versions, lockfile and dependency-policy
  record from this decision.
- Chrome and Firefox builds remain separate validation gates over one source
  tree.
- Browser minimum versions stay unresolved until OQ-002 capability probes;
  this ADR makes no browser support claim.
- Changing the package manager, build framework, Node major, root layout or
  internal module boundaries requires an ADR amendment.

## Validation

Task 1.2 must repeat the frozen install and both builds from a clean checkout,
record the optional WASM peer exception, and prove that no server-only or
monorepo-only dependency entered the graph. Task 1.3 then validates packaged
manifest and panel behavior in both browsers.

Revisit this decision if WXT cannot preserve required Chrome/Firefox parity, a
supported CI platform needs the WASM fallback, or a toolchain update changes
the selected engine or peer contracts.
