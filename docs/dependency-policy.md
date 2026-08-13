# Dependency policy

ContentLens keeps its production dependency surface small because every runtime
package affects extension startup, reviewability, store submission and offline
operation. Package versions are exact in `package.json` and their complete
resolution graph is committed in `pnpm-lock.yaml`.

## Admission requirements

A dependency enters the repository only when its pull request records:

1. the product contract or accepted ADR that requires it;
2. the owning project area;
3. its runtime, artifact or development-only cost;
4. license and provenance checks;
5. maintenance state and replacement or removal conditions;
6. clean install, typecheck and relevant build or test evidence.

Dependencies must not fetch or execute remote application code at runtime.
Optional capabilities must remain removable from the deterministic baseline.

## Approved bootstrap set

| Package or group | Classification | Requirement | Owner | Bundle or artifact cost |
| --- | --- | --- | --- | --- |
| `react`, `react-dom` | Runtime | ADR 0013 and the UI contract | UI | The React runtime and renderer are included in extension pages that use them. |
| `wxt`, `vite` | Build | ADR 0013 | Extension platform | Development-only; generated manifests and bundled output are reviewed. |
| `web-ext` | Development | ADR 0013 and the Firefox development runner | Extension platform | MPL-2.0, maintained by Mozilla; development-only WXT peer used to build, run and test Firefox extensions. Version 10.5.0 reaches 313 unique transitive package versions in the installed graph, 150 new relative to the baseline, including `addons-linter` and `eslint`; the affected `brace-expansion` paths are pinned below. Excluded from extension artifacts and removable when the Firefox toolchain no longer requires it. |
| `@wxt-dev/module-react` | Build | ADR 0013 | Extension platform | Development-only integration between WXT and React. |
| `typescript`, `@types/*` | Build | ADR 0013 | Architecture | Type declarations and the compiler stay outside shipped bundles. |
| `tailwindcss` | Runtime source | ADR 0013 and the UI contract | UI | Imported by the production stylesheet and classified as a production dependency by the graph gate. The build emits CSS only; no Tailwind JavaScript reaches extension runtime. |
| `@tailwindcss/postcss`, `postcss` | Build | ADR 0013 and the UI contract | UI | Development-only processors; emitted CSS is measured with each UI gate. |
| `@vitejs/plugin-react` | Build and test | ADR 0013 | UI | Development-only JSX transform for Vitest and Vite. |
| `vitest`, `@vitest/coverage-v8`, `happy-dom` | Test | Testing and migration contracts | Quality | Test-only; excluded from extension artifacts. |
| `@playwright/test` | Test | Browser compatibility contract | Quality | Test-only browser binaries and reports; excluded from extension artifacts. |
| `@axe-core/playwright` | Test | Accessibility gate | Quality | MPL-2.0, maintained by Deque Systems and test-only. Its browser-injected scanner is excluded from extension artifacts and may be removed if Playwright gains equivalent WCAG impact reporting. |
| `@biomejs/biome` | Development | ADR 0013 | Quality | Local binary and configuration; excluded from extension artifacts. |
| `lefthook`, `@commitlint/*` | Development | ADR 0008 | Supply chain | Local hooks and commit validation; excluded from extension artifacts. |
| `zod` | Runtime | Central contracts and credential handling | Contracts | Schema validation for provider output, portable profiles, runtime messages and settings. Shipped inside the extension bundle and measured by the per-file bundle gate. |
| `radix-ui`, `lucide-react` | Runtime | UI component contract and the accepted Ember Gate redesign | UI | MIT and ISC packages maintained by WorkOS and Lucide contributors. Radix supplies accessible interaction primitives and Lucide supplies tree-shakeable interface icons. Both ship only in extension pages that import them, remain covered by the per-file bundle gate and may be removed if equivalent owned primitives replace every consumer. |
| `tailwind-variants` | Runtime | UI component contract and shadcn-compatible variants | UI | MIT package used by the shared Button to compose semantic Tailwind classes and typed variants. It ships only in extension UI chunks, remains covered by the bundle gate and may be removed when Button variants no longer require runtime class composition. |
| `tw-animate-css` | Runtime source | UI component contract and reduced-motion-safe shadcn state transitions | UI | MIT utility source imported by the production stylesheet and classified as a production dependency by the graph gate. The build emits owned CSS only; removable when equivalent transition utilities are maintained directly in the design system. |
| `@types/node` | Build | ADR 0013 | Architecture | Type declarations for build, release and evidence scripts. Excluded from extension artifacts. |
| `fake-indexeddb` | Test | Migration and sync contracts | Quality | In-memory IndexedDB used by storage, migration and sync tests. Excluded from extension artifacts. |
| `knip` | Development | Dependency reachability and import-cycle hygiene | Quality | ISC, maintained by the Knip project; development-only analysis of direct production dependencies, repository-wide unlisted or unresolved imports, external binary declarations and cycles. The required gate does not classify unused files or exports. Excluded from extension artifacts and removable when an equivalent graph gate replaces it. |

This table is the bootstrap allowlist. Later tasks may add a package only by
updating this table with the same evidence before the first import lands.

## Blocked inputs

The extension must not depend on:

- `next`, `next-intl` or `@next/third-parties`;
- `server-only` or `client-only`;
- `react-microsoft-clarity`;
- webpack-only loaders, plugins or configuration;
- remote scripts, remotely hosted executable modules or provider credentials.

These inputs belong to server-rendered or proprietary application boundaries
and have no accepted ContentLens requirement.

## Transitive security overrides

A published advisory against a transitive package is fixed with an exact pnpm
override or a reviewed package patch in `pnpm-workspace.yaml` rather than by
waiting for the direct dependency to release.

Each resolution records its advisory, the path that reaches it, the blast
radius and the removal condition.

| Package | Advisory | Reached through | Scope | Resolution |
| --- | --- | --- | --- | --- |
| `adm-zip` | GHSA-xcpc-8h2w-3j85, high, crafted ZIP input can trigger a 4 GB allocation | `web-ext` and `web-ext-run` to `firefox-profile` to `adm-zip` | Development only; Firefox profile creation | Exact override `0.6.0`, from 0.5.18 |
| `brace-expansion` | GHSA-mh99-v99m-4gvg and GHSA-rgw5-rvv9-x895, both high, unbounded expansion denial of service | `web-ext` to `multimatch` to `minimatch`; `web-ext` to `addons-linter` to `eslint` to `@eslint/config-array` to `minimatch`; and `wxt` to `web-ext-run` to `multimatch` to `minimatch` | Development only; Firefox tooling and add-on linting | Exact override `1.1.18`, from 1.1.16 |
| `fast-uri` | GHSA-7p8r-x3mc-p8w7, high, host confusion via a backslash authority introducer | `@commitlint/cli` to `@commitlint/config-validator` to `ajv` | Development only; commit message validation | Exact override `3.1.5`, from 3.1.4 |
| `image-size` | GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq, both high, infinite-loop denial of service in ICNS, HEIF and JXL parsing | `web-ext` to `addons-linter` to `image-size` | Development only; add-on icon validation | `patches/image-size-2.0.2.patch` rejects zero-length entries in the CommonJS and ESM entrypoints; remove when a published release contains equivalent guards |
| `js-yaml` | GHSA-5p4m-2wfm-xmqj, high, quadratic CPU consumption while resolving `!!omap` | `eslint` to `@eslint/eslintrc` to `js-yaml`; `@commitlint/cli` to `cosmiconfig` to `js-yaml` | Development only; lint and commit validation | Exact override `4.3.1`, from 4.3.0 |
| `nanoid` | GHSA-2v37-7h3g-55p8, high, infinite loop in custom generators when size is zero | `postcss` to `nanoid` | Build and test only; CSS processing | Exact override `3.3.17`, from 3.3.16 |
| `shell-quote` | GHSA-395f-4hp3-45gv, high, quadratic denial of service in `parse()` | `wxt` to `web-ext-run` to `fx-runner` to `shell-quote`; `web-ext` to `fx-runner` to `shell-quote` | Development only; Firefox runners | Exact override `1.9.0`, from 1.7.3 and 1.8.4 |
| `tmp` | GHSA-ph9p-34f9-6g65, high, path traversal through an unsanitized prefix or postfix | `wxt` to `web-ext-run` to `tmp` | Development only; temporary Firefox runner directories | Exact override `0.2.7`, from 0.2.5 |
| `uuid` | GHSA-w5hq-g745-h8pq, moderate, missing buffer bounds check in namespace-based UUID generation | `wxt` to `web-ext-run` to `node-notifier` to `uuid` | Development only; Firefox runner notifications | Exact override `11.1.1`, from 8.3.2 |

`postcss` needed no override: it is a direct development dependency and moved
from 8.5.22 to 8.5.23 for GHSA-fxqj-rqcc-2cmp, an arbitrary `.map` read through
an attacker-controlled `sourceMappingURL`. It processes CSS at build time and
ships nothing into the extension.

None of these packages reaches the shipped bundle. The evidence for each change
includes the sequence in the next section, both production builds and their
per-file size guards. The `image-size` patch also has denial-of-service
regressions for malformed and valid ICNS, HEIF and JXL inputs in both module
formats.

A resolution is removed as soon as the direct dependency ships an equivalent
fix, which `pnpm why <package>` and the focused regression confirm.

## Installation and updates

pnpm 11 is the only package manager. `pnpm-workspace.yaml` enforces exact saves,
Node engine compatibility and a 24-hour minimum release age. Lifecycle scripts
are denied unless their package is named in `allowBuilds`; each allowed script
requires review when its version changes.

WXT currently reaches `spawn-sync@1.0.15` through its Firefox development
runner. Its postinstall only installs a fallback for Node versions without
`child_process.spawnSync`. Node 24 provides that API, so the lifecycle is
explicitly denied while the package remains available to WXT's native path.

Dependency updates use this sequence:

```text
pnpm install
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm why next next-intl @next/third-parties react-microsoft-clarity server-only client-only
```

The optional Vite WASM peer chain documented in ADR 0013 is the only temporary
bootstrap peer exception. Any other unresolved peer issue blocks the update.

Generated lockfiles are never copied from another repository. Reviewers inspect
manifest changes, lockfile importer changes, lifecycle scripts, licenses,
integrity hashes and unexpected transitive packages.
