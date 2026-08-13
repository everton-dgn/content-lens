# Release policy

## Current state

No production release exists. A browser-store package requires every check in
this document, a clean `pnpm ci:local`, packaged browser journeys and explicit
maintainer approval.

## Versioning

ContentLens uses Semantic Versioning for public releases:

- `0.y.z`: contracts may change, with migration notes for persisted data.
- `1.y.z` and later: breaking public-contract changes require a major version.
- Patch releases contain compatible fixes.
- Minor releases add compatible capability.

Persisted profile schemas and plugin API versions are independent from the product version and follow [Compatibility](docs/compatibility.md).

## Release channels

- `dev`: local or CI artifacts without support.
- `alpha`: incomplete capability for technical evaluation.
- `beta`: feature-complete candidate with known limitations.
- `stable`: all release gates passed.

Channel transitions do not bypass gates.

## Required release artifacts

- Source tag.
- Changelog entry.
- Built extension package.
- Checksums.
- Software bill of materials.
- Build provenance linked to the immutable source tag.
- Release manifest covering product, profile, adapter, plugin, classifier, model and archetype versions.
- Model manifest with source, license, version and digest when models ship.
- Migration and rollback notes when persisted data changes.
- Exact browser, operating-system, capability and known-limitation matrix.

## Release checklist

1. All required CI checks pass.
2. Product contracts and acceptance criteria are current.
3. Security and privacy review is complete.
4. Adapter live smoke tests pass.
5. Classification and performance gates pass for enabled capabilities.
6. Storage migrations have forward, failure and backup tests.
7. Permissions match documented capabilities.
8. Changelog and compatibility matrix are updated.
9. Artifacts are built from the tagged commit.
10. A maintainer verifies checksums before publication.
11. Fresh install, update, failed migration and rollback-compatibility tests pass.
12. User-visible error, recovery and diagnostics-redaction tests pass.
13. Every enabled optional capability has an Accepted spec and tested fallback.
14. A maintainer explicitly approves channel promotion after reviewing the assembled evidence.

## Rollback

A release plan identifies:

- Last known-good version.
- Whether browser-store rollback is possible.
- Profile schema compatibility.
- Feature flags or kill switches for remote-risk capability.
- User recovery steps.
- Stop, hold, withdraw and resume criteria.
- Whether rollback can restore code only, data only, both or neither.

Migration must stop before irreversible transformation when backup or validation fails.

A browser store may prevent immediate rollback or redistribution of an older package. In that case, the project ships a verified compensating release and documents the affected schema and recovery limits. An unverified local artifact is never used as rollback.

## Staged rollout and incidents

Use staged rollout when the selected store supports it. Otherwise, document the smallest available exposure and a hold point before broader promotion.

Publication stops for:

- Profile data loss or failed recovery.
- Permission or data-flow expansion outside reviewed disclosure.
- Stale result applied to a recycled item.
- Failure-open regression.
- Artifact integrity or credential compromise.
- Accepted performance or accessibility gate regression.

An affected optional capability may be disabled in a reviewed package while deterministic behavior remains available. A kill-switch design cannot load remote executable code, broaden data flow or bypass package review.

## Deprecation

Stable public contracts receive a documented replacement and at least one minor-release migration window when practical. Security removal may be immediate.

## Signing and provenance

The release-candidate workflow generates checksums, an SPDX 2.3 SBOM and
in-toto/SLSA v1 provenance for exactly three packages. GitHub artifact
attestations use the protected workflow OIDC identity and are verified again in
a separate job before publication. Chrome Web Store and AMO then sign their own
store packages.

Missing attestations, a digest mismatch, a dirty checkout, an unannotated tag or
a package rebuilt after verification blocks publication. Local `dev` builds are
never accepted as signed rollback artifacts.
