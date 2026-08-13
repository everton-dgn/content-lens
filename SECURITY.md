# Security policy

## Supported versions

ContentLens has not published a production release. No version currently receives security support.

This table will be updated before the first release:

| Version | Supported |
| --- | --- |
| Unreleased planning documents | Documentation fixes only |

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository:

<https://github.com/everton-dgn/content-lens/security/advisories/new>

If that channel is unavailable, contact the repository owner through the GitHub profile and request a private channel without disclosing vulnerability details publicly.

Do not open a public issue for:

- Credential exposure.
- Extension privilege escalation.
- Cross-context message forgery.
- Remote profile corruption or unauthorized access.
- Prompt injection that reaches privileged actions.
- Model or dependency supply-chain compromise.
- Privacy leaks involving browsing or preference data.

## What to include

- Affected document, component or proposed version.
- Reproduction steps or proof of concept.
- Expected and observed impact.
- Required permissions and attacker position.
- Suggested mitigation, if known.
- Whether details have been shared elsewhere.

Do not include real credentials, personal browsing data or third-party private information.

## Response targets

These are project targets, not a guarantee:

| Stage | Target |
| --- | --- |
| Acknowledge report | 3 business days |
| Initial severity assessment | 7 business days |
| Remediation plan or status update | 14 business days |

Complex issues may require more time. The reporter receives a status update when a target cannot be met.

## Disclosure

The maintainer coordinates disclosure after a fix or documented mitigation exists. Credit is offered unless the reporter requests anonymity.

## Safe-harbor intent

Good-faith research that avoids privacy violations, service disruption, data destruction and unauthorized persistence will be treated as helpful security work. This statement does not authorize testing against third-party platforms or accounts.

## Security design

Project trust boundaries and required controls are documented in:

- [Threat model](docs/threat-model.md)
- [Privacy and security](docs/10-privacy.md)
- [Supply-chain policy](docs/supply-chain.md)
- [Credential handling open decision](docs/adr/0010-credential-handling.md)
- [Reviewable AI assistance](docs/adr/0011-reviewable-ai-assistance.md)
- [Truthful idempotent operations](docs/adr/0012-truthful-idempotent-operations.md)
