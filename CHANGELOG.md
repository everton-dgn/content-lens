# Changelog

Significant user-facing and contributor-facing changes are recorded here.

## Unreleased

## 1.0.1 - 2026-08-14

### Fixed

- parallelize delivery pipeline
- rebuild before download

## 1.0.0 - 2026-08-13

### Added

- Deterministic rule engine with stable precedence, exact term matching and
  durable channel and author identity.
- Platform adapters for YouTube, LinkedIn, X, Reddit and Hacker News behind one
  versioned registry, with per-origin optional permissions requested only after
  explicit enablement. RSS parsing and portable subscription contracts remain
  local, with network acquisition disabled.
- Reversible rendering on every adapter: hidden items keep a placeholder and
  restore the original node, focus and attributes on reveal, undo or disable.
- Dynamic surface observation that survives infinite scroll and recycled nodes,
  with fingerprint-based identity and no stale decision applied to a reused
  card.
- IndexedDB profile at schema 1.3 with versioned migrations, preflight checks,
  recovery snapshots and an atomic operation journal.
- Portable profile export and import in validated plaintext JSON and AES-256-GCM
  envelopes derived with PBKDF2-HMAC-SHA-256 at 600,000 iterations.
- Experimental provider-neutral synchronization with conditional HTTP transport,
  exact compare-and-swap, three-way merge and explicit conflict review that
  never merges on timestamp alone.
- Provider registry with a write-only credential vault, exact-origin request
  boundary, explicit consent, connection test and redacted diagnostics.
- Model catalog and deterministic routing with per-provider budgets, circuit
  breaker, eligibility checks, versioned cache and local fallback.
- Text classification across local, browser-provided and cloud routes behind a
  strict output schema, UTF-8 byte budgets and fail-open handling.
- Visual classification with one-image selection, signature validation, encoded
  and decoded size limits and metadata-free re-encoding.
- Similarity, exact deduplication and a bounded typed content graph with
  evidence-backed relations, eviction and atomic generation replacement.
- Reviewable AI assistance for rule drafts and read-only explanations, without
  authority to mutate durable state.
- Reviewed native platform feedback with a per-platform capability map, gesture
  requirement, identity revalidation, uncertainty handling and circuit breaker.
- Local diagnostics with closed codes, bounded counts, sanitized export and one
  recovery action per terminal failure.
- Side panel and options page built on the Signal Gate design system: token
  registry, closed state contract, 21 components and a machine-checked token
  boundary.
- Localized interface in `en`, `pt_BR` and `es` with parity-checked message
  catalogs.
- Release tooling: deterministic three-package build, checksums, SPDX 2.3 SBOM,
  in-toto and SLSA v1 provenance, release manifest with version domains, and
  independent verification before publication.
- Packaged Chrome MV3 and Firefox MV2 journeys covering first run, rule editor,
  preview, save, undo, diagnostics export review, 200% zoom, reduced motion,
  keyboard focus and axe checks without serious or critical findings.

### Changed

- Automated stable-only Semantic Versioning, normal-merge version pull requests,
  annotated tags and verified GitHub Releases after successful `main` CI.
- Updated the interface to Ember Gate 0.5.0, with dark-first charcoal surfaces,
  red primary actions, rounded task cards and one shared bottom navigation
  across the side panel.
- Added a shadcn composition layer with Radix primitives, Lucide icons and a
  Tailwind v4 semantic theme map while preserving the browser-native i18n
  contract for `en`, `pt_BR` and `es`.
- Set a 12 CSS px minimum for visible interface text and separated uppercase
  metadata from regular-weight values with a quieter neutral tone.
- Generalized the YouTube-only adapter into the shared multiplatform contract,
  with the platform-to-origin map as a single source consumed by the registry,
  content script and message guard.
- Replaced the previous extension-dashboard composition with the Signal Gate
  visual language after independent read-only review.
- Split the options page by route so configuration, feeds and data load on
  demand.
- Retired the phase-0 feasibility code after relocating its load-bearing
  packaged harness into the test tree.

### Security

- Pinned secret scanning in continuous integration with redacted findings.
- Disabled RSS and Atom network acquisition in every supported browser because
  a separate DNS check cannot bind the approved address to the connection later
  opened by `fetch`. Local parsing and portable subscription data remain
  available.
- Kept provider credentials outside portable profiles, diagnostics, exports and
  release artifacts.
- Enforced a regressive per-file JavaScript size limit on every packaged build
  and inside the release packaging step.

### Documentation

- Product vision, architecture, usage and development documentation.
- Product contracts and acceptance criteria.
- Open-source governance, contribution, security, support and release policies.
- Documentation validation and GitHub contribution templates.
- Reviewable AI assistance, runtime stability, diagnostics, migration,
  compatibility and release contracts.
- Architecture decisions for non-authoritative AI drafts, truthful idempotent
  operations, local similarity, content graph and reviewed native feedback.
- Store copy, permission justifications and verifiable privacy claims.
