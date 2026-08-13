# Governance

## Project phase

ContentLens is maintainer-led while it establishes its first implementation and contributor community.

## Roles

### Project lead

The repository owner, [@everton-dgn](https://github.com/everton-dgn), is the initial project lead and final decision-maker.

### Maintainer

A maintainer may triage issues, review pull requests, manage releases and participate in security response. New maintainers are added after sustained, trustworthy contribution and explicit approval by the project lead.

### Contributor

Anyone who reports a problem, improves documentation, reviews a proposal or submits a pull request under the project policies.

## Decision process

### Routine changes

Editorial fixes and changes inside an accepted spec use normal pull-request review.

### Product and contract changes

Observable behavior changes require:

1. A problem statement.
2. Updated requirements and acceptance criteria.
3. Traceability updates.
4. Maintainer approval.

### Architecture changes

Cross-cutting, persisted-data, trust-boundary or public-contract changes require an ADR. The ADR records alternatives, tradeoffs, consequences and a revisit trigger.

### Emergency security changes

The project lead may merge a minimal confidential fix before public discussion. The decision and affected contract are documented after coordinated disclosure.

## Decision authority

The project seeks technical consensus through evidence and documented tradeoffs. When consensus is unavailable, the project lead decides and records the rationale in the issue, spec or ADR.

There is no contributor vote while the project has one maintainer. This policy should be revisited when three active maintainers exist.

## Merge policy

- Every pull request requires an explicit maintainer merge decision.
- While the project has one maintainer, the project lead may self-merge only after required checks pass and the pull request records its scope, evidence and unresolved risk.
- When another active maintainer is available, at least one maintainer other than the author must approve.
- Required checks must pass.
- Security-sensitive changes require explicit security review.
- Integration uses normal merge commits and preserves commit ancestry.
- Squash integration is disabled by policy.

The solo-maintainer exception ends when a second active maintainer can review the change. Branch protection must then require one approving review from someone other than the last contributor.

Security review is recorded in the pull request and covers affected trust boundaries, permissions, data flows, threat-model changes and validation evidence. During the solo-maintainer phase, the project lead records this review explicitly; the public release gates still apply.

Emergency security changes follow the confidential process above.

## Release authority

Only maintainers publish releases. The release process follows [RELEASES.md](RELEASES.md).

## Inactive maintainers

A maintainer who is inactive for six months may be moved to emeritus status after private contact and a public governance note. Repository access is reviewed separately as a security control.

## Policy changes

Governance changes require a public pull request and a minimum seven-day review period, except for urgent security corrections.
