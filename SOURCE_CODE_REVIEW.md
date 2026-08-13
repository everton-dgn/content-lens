# Firefox source-code review guide

## Candidate identity

The source archive and Firefox package are generated together from the annotated
tag recorded in `release-manifest.json`. Compare their SHA-256 values with
`checksums.sha256` before starting a review.

## Reproducible environment

- Node.js: read `.node-version`.
- pnpm: read `packageManager` in `package.json`.
- WXT: read the exact version in `package.json` and `pnpm-lock.yaml`.
- Operating system: Linux or macOS with `zip` and `unzip` available.

## Build commands

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm exec wxt zip -b firefox
```

The resulting `.output/content-lens-<version>-firefox.zip` must match the digest
in the release manifest. The build performs no network access after the locked
dependency installation and downloads no model artifact.

## Source layout

- `src/entrypoints/`: extension entrypoints.
- `src/adapters/`: platform DOM adapters.
- `src/application/` and `src/core/`: use cases and deterministic contracts.
- `src/storage/`: IndexedDB, migrations, portability and sync state.
- `src/ui/`: shared UI and design-system components.
- `src/config/manifest.ts`: reviewed browser permissions and metadata.

Generated bundles are absent from the sources ZIP. WXT creates them from the
TypeScript and CSS files during the command above. No minifier configuration,
obfuscator, remote executable code or post-build patch is used.

## Permission and data-flow review

Compare the packaged `manifest.json` with `docs/security/permissions-matrix.md`
and `docs/adr/0014-browser-manifest-permissions.md`. Optional provider and RSS
access is requested only after an explicit user action. Provider credentials are
stored separately from portable profiles and are never included in diagnostics,
exports or release artifacts.
