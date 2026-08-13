# ADR 0008: Supply-chain integrity

Status: Accepted

## Context

Browser extensions run with elevated page access. Dependencies, GitHub Actions and model artifacts can introduce code or data outside normal source review.

## Considered options

1. Follow ecosystem defaults without project-specific controls.
2. Avoid every third-party dependency and model.
3. Minimize third-party inputs and require immutable identity, license and provenance.

## Decision

ContentLens follows [Supply-chain policy](../supply-chain.md):

- Dependencies require documented justification and lockfile resolution.
- GitHub Actions use full commit SHA pins.
- Models use immutable digest, license and evaluation manifests.
- Public artifacts include checksums and, before release, SBOM and provenance.
- Dynamic third-party executable plugins remain unsupported.

## Tradeoffs

- Updates require more review work.
- Some integrations may be delayed.
- Compromise detection and rollback improve.
- Model distribution constraints become visible early.

## Consequences

- Supply-chain validation is a release gate.
- Dependency convenience is not sufficient justification.
- Models are release artifacts, not informal downloads.
- Workflow permissions stay minimal.

## Revisit trigger

Revisit specific controls when the selected build and publishing systems provide stronger native guarantees.
