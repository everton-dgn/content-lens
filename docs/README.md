# ContentLens documentation

This directory contains the current product, architecture, security and
development contracts for ContentLens. Temporary plans, generated reports and
historical review evidence do not belong here.

## Start here

- [Getting started](getting-started.md)
- [Development](development.md)
- [System architecture](architecture.md)
- [Implementation conventions](conventions.md)
- [Security policy](../SECURITY.md)

## Product

1. [Vision](01-vision.md)
2. [Product scope](02-product-scope.md)
3. [Content model](03-content-model.md)
4. [Classification pipeline](04-classification.md)
5. [Content archetypes](05-archetypes.md)
6. [Platform adapters](06-platforms.md)
7. [Feedback system](07-feedback-system.md)

## Engineering

8. [Storage](08-storage.md)
9. [Synchronization](09-sync.md)
10. [Privacy and security](10-privacy.md)
11. [User interface](11-ui.md)
12. [Internal APIs](14-api.md)
13. [Plugin system](15-plugin-system.md)
14. [AI models](16-ai-models.md)
15. [Testing](17-testing.md)
16. [Metrics](18-metrics.md)

## Delivery contracts

- [Data contracts](data-contracts.md)
- [Compatibility policy](compatibility.md)
- [Performance budgets](performance.md)
- [Implementation conventions](conventions.md)
- [Dependency policy](dependency-policy.md)
- [Threat model](threat-model.md)
- [Supply-chain policy](supply-chain.md)
- [Glossary](glossary.md)
- [Privacy policy](privacy-policy.md), the store-facing statement
- [Store listing copy](store/listing.md) and [permission justifications](store/permission-justifications.md)

### Datasets and fixtures

Every fixture corpus declares its provenance, license and digests. No corpus
contains captured pages, credentials or personal browsing history.

- [YouTube fixtures](datasets/youtube-fixtures.md)
- [LinkedIn fixtures](datasets/linkedin-fixtures.md)
- [X fixtures](datasets/x-fixtures.md)
- [Reddit fixtures](datasets/reddit-fixtures.md)
- [Hacker News fixtures](datasets/hacker-news-fixtures.md)
- [RSS and Atom fixtures](datasets/rss-fixtures.md)

Quality corpora for the model-backed capabilities are not present in the
repository. Their required inventory and promotion gates live in the
[text](datasets/text-manifest.md), [visual](datasets/visual-manifest.md),
[similarity](datasets/similarity-manifest.md) and
[assistance](datasets/assistance-manifest.md) manifests.

## Architecture

- [System architecture](architecture.md)
- [Architecture decisions](decisions.md)
- [Project manifesto](../MANIFESTO.md)

## Open-source project policies

- [Contributing](../CONTRIBUTING.md)
- [Code of conduct](../CODE_OF_CONDUCT.md)
- [Security policy](../SECURITY.md)
- [Governance](../GOVERNANCE.md)
- [Support](../SUPPORT.md)
- [Release policy](../RELEASES.md)
- [Changelog](../CHANGELOG.md)

## Document policy

Architecture decisions declare their own status. Accepted documents define the
current baseline. Generated benchmark output belongs in `.artifacts/`, browser
and release output belongs in `.output/` or `.release/`, and all three paths are
ignored by Git.
