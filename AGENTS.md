# ContentLens agent rules

## Sources of truth

- Read `docs/architecture.md` and `docs/conventions.md` before changing module
  boundaries or shared contracts.
- Use `CONTRIBUTING.md` to classify changes and determine when an ADR, threat
  model update or proposal is required.
- Treat accepted ADRs and delivery contracts as the baseline. Proposed and
  open documents do not authorize release behavior.

## Architecture boundaries

- Keep `src/core/` independent of platform DOM, WXT and concrete persistence
  implementations.
- Keep platform extraction and rendering inside `src/adapters/` and fail open
  when page metadata or selectors are unavailable.
- Use `src/application/` to orchestrate core contracts through explicit ports.
  Durable success must follow the acknowledged operation lifecycle.
- Keep WXT entrypoints and browser lifecycle composition in `src/entrypoints/`
  and `src/extension/`.
- Keep credentials inside `src/security/` boundaries. Never expose provider
  secrets to content scripts, logs, diagnostics or portable exports.

## Implementation and dependencies

- Use pnpm only. Versions are exact and the package manager version comes from
  `package.json`.
- Update `docs/dependency-policy.md` with ownership, cost, license and removal
  conditions before adding a dependency.
- Use the `@/` alias across areas. Relative imports are appropriate inside one
  local module.
- Prefer named exports for shared APIs. An `index.ts` may define an intentional
  public facade; do not create broad re-export surfaces without consumers.
- Keep generated message keys generated. Use `pnpm i18n:generate` instead of
  editing generated output.
- Add or update the narrowest test that proves each observable behavior change.

## UI and design system

- Read `docs/design-system/README.md` and
  `docs/design-system/ai-generation.md` before changing UI.
- Reuse named exports from `src/ui/components/`.
- Use semantic CSS tokens outside `src/ui/styles/tokens/primitives.css`.
- Do not add inline styles, raw visual values or feature-specific component
  overrides.
- Use only the operational and view states in
  `src/ui/styles/tokens/contract.ts`.
- Add equivalent `en`, `pt_BR` and `es` messages for visible copy.
- Validate UI with `pnpm design-system:check`, `pnpm test:unit`,
  `pnpm test:a11y` and the narrow side-panel browser journey.

## Validation

- Run the narrowest affected test first, then `pnpm typecheck`.
- Run `pnpm docs:check` for documentation changes.
- Run `pnpm deps:check` when dependencies, imports, external binaries or
  entrypoints change.
- Run `pnpm ci:local` for cross-cutting, dependency, release or architecture
  changes.
- Review `git diff` and preserve unrelated working-tree changes before handing
  work back.
