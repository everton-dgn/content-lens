# Development

## Repository layout

| Path | Responsibility |
| --- | --- |
| `src/core/` | Platform-independent content, rules and decision contracts |
| `src/application/` | Use cases and orchestration through explicit ports |
| `src/adapters/` | Platform extraction, normalization and reversible rendering |
| `src/extension/` | Browser lifecycle and service-worker composition |
| `src/entrypoints/` | WXT background, content-script and side-panel entrypoints |
| `src/storage/` | IndexedDB, migration and portability implementations |
| `src/security/` | Credential envelopes, vault boundaries and redaction |
| `src/ui/` | Shared components, views and semantic design tokens |
| `public/_locales/` | Browser message catalogs for English, Portuguese and Spanish |
| `tests/` | Contract, browser, accessibility, performance and security checks |

Read [Architecture](architecture.md) and
[Implementation conventions](conventions.md) before changing a module
boundary.

## Common commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the Chrome development extension |
| `pnpm dev:firefox` | Start the Firefox development extension |
| `pnpm typecheck` | Generate WXT types and run TypeScript |
| `pnpm lint` | Run Biome and project lint plugins |
| `pnpm test:unit` | Run unit and contract tests |
| `pnpm test:a11y` | Run extension-owned accessibility checks |
| `pnpm test:browser` | Build and run packaged browser journeys |
| `pnpm test:visual` | Compare supported side-panel and settings screenshots |
| `pnpm design-system:check` | Validate UI tokens, states and components |
| `pnpm docs:check` | Validate documentation links and structure |
| `pnpm deps:check` | Validate dependencies, entrypoints and import cycles |
| `pnpm scan:secrets` | Scan the working tree without remote validation |
| `pnpm ci:local` | Run the repository-wide local gate |

Run the narrowest affected test first. Use `pnpm ci:local` for changes that
cross module, release, dependency or security boundaries.

## Generated and local files

Do not edit `src/i18n/message-keys.generated.ts` directly. Change the three
catalogs under `public/_locales/` and run:

```sh
pnpm i18n:generate
```

Builds, coverage, Playwright reports, temporary benchmark reports and release
packages are ignored under `.output/`, `coverage/`, `playwright-report/`,
`test-results/`, `.artifacts/` and `.release/`. These outputs are local evidence
and must not be committed.

## UI changes

Reuse exports from `src/ui/components/`. Visual values outside primitive token
files must use semantic tokens. Visible copy requires equivalent `en`, `pt_BR`
and `es` messages.

Validate UI changes with:

```sh
pnpm design-system:check
pnpm test:unit
pnpm test:a11y
pnpm test:visual
pnpm test:browser
```

## Security and privacy

Treat page content, imported profiles, provider responses and feed documents as
untrusted input. Credentials remain inside `src/security/` and must not enter
content scripts, diagnostics, fixtures or portable exports.

Before publishing a source archive or browser package, run:

```sh
pnpm scan:secrets
pnpm guard:public
```

See [Security policy](../SECURITY.md), [Threat model](threat-model.md) and
[Privacy policy](privacy-policy.md) for reporting and trust boundaries.
