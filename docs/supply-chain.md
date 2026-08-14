# Supply-chain policy

## Scope

This policy covers source dependencies, GitHub Actions, extension packages, models, datasets and optional provider SDKs.

## Dependencies

- Add a dependency only when a documented requirement cannot be met safely with existing code or platform APIs.
- Record license, maintainer, release activity, transitive dependency count and known security history.
- Commit the selected package manager lockfile.
- Use exact resolved versions in the lockfile.
- Reject install scripts unless reviewed and justified.
- Keep runtime dependencies smaller than development dependencies where practical.
- Dependabot or an equivalent tool proposes updates; updates still require review and tests.

## GitHub Actions

- Pin third-party actions to a full commit SHA.
- Add a version comment beside the SHA.
- Grant minimum workflow permissions.
- Avoid pull-request workflows that expose secrets to untrusted code.
- Review action source and release provenance before first use.

## Models

The extension bundles and downloads no model weights. Every model runs through
the browser built-in API or a provider the user configured, so redistribution
obligations stay with whoever installed the model. Selecting a downloadable
artifact requires a new ADR, per
[ADR 0017](adr/0017-model-and-dataset-licensing.md).

A model the browser manages has no digest, version or redistribution term under
project control and therefore takes no artifact manifest. The catalog records
the boundary instead: `execution: "browser"` and no policy URL.

Where the project does select an artifact, only Apache-2.0, MIT and BSD weights
are acceptable, by SPDX identifier. Source-available or custom terms require
their own ADR recording each obligation, including attribution, field-of-use
limits and downstream training restrictions.

Every model artifact MUST have a manifest containing:

- Upstream source.
- Exact version or immutable digest.
- License and redistribution terms.
- File checksum.
- Intended task and supported languages.
- Input and output contract.
- Size and resource measurements.
- Evaluation result.
- Known limitations.

Runtime download MUST verify the expected digest before loading a model.

## Datasets

Every dataset records source, consent basis, license, permitted use, retention and redaction. Personal browsing data is never committed.

Held-out corpora contain only synthetic material or material under a license
that permits public redistribution: CC0-1.0, CC-BY-4.0 or ODC-BY-1.0. Every
corpus is committed to the repository so a third party can rerun an evaluation
and reach the same number. Each source carries a reviewed record of the
platform terms it was collected under.

A source whose terms forbid redistribution is not collected. Where such a
source is the only way to represent an archetype, the archetype is covered by
synthetic material written for it, labeled as synthetic and reported
separately.

## Build artifacts

Before public release:

- Builds run from a clean tagged commit.
- Artifact checksums are published.
- An SBOM is generated.
- Build provenance identifies source and workflow.
- A reproducibility check compares two independent builds where the toolchain permits.

The implementation uses `.github/workflows/auto-release.yml` after a successful
`main` CI run to calculate a stable version, normal-merge the bot version pull
request, create the annotated tag, build the Chrome, Firefox and sources ZIPs,
attest their digests and SBOM with GitHub OIDC, and compare an independent
rebuild byte for byte. A separate verification job recalculates every digest
before publishing the stable GitHub Release. `.github/workflows/publish-extension.yml`
downloads the permanent assets from that exact stable GitHub Release, verifies
the complete set, freezes it inside the submission run and submits each
browser-specific package from a protected store environment without rebuilding.

Recovery loads the release orchestrator from protected `main`, verifies the
exact source CI run, and then checks out that source. Pending version merges are
tagged from oldest to newest, and existing tags with incomplete GitHub Releases
are repaired before another version is calculated. Each annotated tag targets
the version commit already reachable through its verified normal merge, so a
concurrent `main` advance is released only after its own version calculation.
The bot starts a full continuation CI on `main` after each recovered
publication, so recovery never requires a manual merge or tag.

The local packaging command refuses a dirty checkout by default. Its
`--allow-dirty` option is restricted to unsupported `dev` experiments and does
not satisfy a release gate.

## Secrets

CI secrets are unavailable to untrusted pull-request code. Logs, artifacts and caches MUST NOT contain credentials, private profile data or provider tokens.

## Incident response

A compromised dependency, action, model or dataset triggers:

1. Disable affected capability or release.
2. Revoke exposed credentials.
3. Preserve evidence without publishing secrets.
4. Identify affected versions.
5. Publish remediation and integrity guidance.
6. Add a regression control.
