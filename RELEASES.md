# Release policy

## Current state

Public versions and GitHub Releases are stable only. Every successful push `CI`
run on `main` starts `.github/workflows/auto-release.yml`. The workflow
calculates whether the commit history requires a version. When it does, the bot
opens a version pull request, merges it with the normal merge method, creates an
annotated tag, verifies the release artifacts and publishes the stable GitHub
Release. No maintainer command, version merge or tag creation is part of this
path.

The repository must allow GitHub Actions to create pull requests. Workflow
permissions default to read, with the release workflow granting only its
job-specific write permissions. The protected `main` ruleset must accept normal
merge commits and must not require an approval for the bot-owned version pull
request.

If an earlier run stopped after merging a version, the next run drains pending
merges and incomplete tagged releases from oldest to newest. After publishing
each recovered release, the bot dispatches the complete `CI` workflow on
protected `main`; only that bot-owned continuation is accepted. The annotated
tag targets the version commit after its normal merge has been verified. A
concurrent `main` advance therefore stays outside that release and enters the
next Semantic Versioning calculation.

Browser-store submission runs after the stable GitHub Release when the
repository variable `STORE_PUBLISHING_ENABLED` is `true`. The same protected
workflow remains manually dispatchable for recovery. It downloads the exact
release assets, verifies them and freezes them for the store jobs without
rebuilding. Chrome authentication uses a short-lived Google token issued from
the protected `main` GitHub OIDC identity; AMO credentials stay in its protected
environment.

## Versioning

ContentLens uses Semantic Versioning for public releases:

- The unpublished `0.0.0` sentinel becomes `1.0.0` on the first release.
- `1.y.z` and later: breaking public-contract changes require a major version.
- `feat` commits produce a minor version.
- `fix`, `perf`, `revert` and dependency-update commits produce a patch version.
- A `!`, `BREAKING CHANGE` footer or `BREAKING-CHANGE` footer produces a major
  version.
- A valid breaking footer produces a major version even when the subject is not
  a Conventional Commit, preventing an explicitly declared breaking change from
  being silently ignored.
- Breaking footers must appear in the final footer block, with their description
  on the same line. Examples inside fenced code blocks do not affect versioning.
- Other commits without a release-worthy Conventional Commit type do not create
  a version.

All published versions use exact `X.Y.Z` SemVer. Prerelease suffixes are
unsupported.

Persisted profile schemas and plugin API versions are independent from the product version and follow [Compatibility](docs/compatibility.md).

## Changelog generation

The top-level `## Unreleased` section is the changelog source for the next
stable version. When it contains curated notes, the automation moves that body
unchanged under the new version heading. Generated commit summaries are not
combined with curated notes, which prevents duplicate entries.

When `## Unreleased` is empty, release-worthy commit summaries generate these
sections in order:

1. `Added` for `feat` commits.
2. `Changed` for breaking changes.
3. `Fixed` for `fix`, `perf`, `revert` and dependency-update commits.

Empty generated sections are omitted. Types and scopes are removed from the
entries, unsafe Markdown references are escaped and entries retain the
newest-first order returned by the release commit range. Curated notes may also
use sections such as `Security`, `Documentation`, `Deprecated` and `Removed`.
The generated and curated paths both leave `## Unreleased` empty and terminate
`CHANGELOG.md` with exactly one newline.

## Release outputs

- `dev`: an internal local or CI package used to exercise packaging controls.
- `stable`: the only public version and GitHub Release output.

An internal `dev` package cannot be promoted. The stable workflow rebuilds from
the exact tagged commit and runs every release gate.

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

1. The source commit passes the complete `CI` workflow on `main`.
2. The trusted automation checks out the CI source only after verifying its
   exact workflow run and reachability from protected `main`.
3. The bot changes only `package.json` and `CHANGELOG.md` in the version commit.
4. The version pull request is integrated with a normal merge commit.
5. Product contracts and acceptance criteria are current.
6. Security and privacy review is complete.
7. Adapter live smoke tests pass.
8. Classification and performance gates pass for enabled capabilities.
9. Storage migrations have forward, failure and backup tests.
10. Permissions match documented capabilities.
11. Changelog and compatibility matrix are updated.
12. The annotated stable tag points to the version commit reachable through the
    verified normal merge, and artifacts are built from that exact commit.
13. Checksums, SBOM, provenance and the independent rebuild all verify.
14. Fresh install, update, failed migration and rollback-compatibility tests pass.
15. User-visible error, recovery and diagnostics-redaction tests pass.
16. Every enabled optional capability has an Accepted spec and tested fallback.

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

The automatic stable release workflow generates checksums, an SPDX 2.3 SBOM
and in-toto/SLSA v1 provenance for exactly three packages. GitHub artifact
attestations use the protected workflow OIDC identity and are verified again in
a separate job before the GitHub Release is published. Chrome Web Store and AMO
then sign their own store packages.

Missing attestations, a digest mismatch, a dirty checkout, an unannotated tag or
a package rebuilt after verification blocks publication. Local `dev` builds are
never accepted as signed rollback artifacts.
