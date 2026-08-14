# ContentLens

> Filter the noise. Keep the signal.

ContentLens is a local-first browser extension that filters algorithmic feeds
with explicit, explainable rules. The deterministic path works without an
account, backend or model provider.

YouTube, LinkedIn, X, Reddit and Hacker News adapters share one
platform-independent decision core. Each platform stays inactive until you
enable it and grant access to its exact host. RSS parsing and portable
subscription data remain available, while network acquisition is disabled for
security.

## Problem

Modern feeds optimize engagement, not usefulness. Users receive clickbait, repeated topics, rage bait, empty motivational content, automated posts, intrusive advertising and channels or authors they never want to see again.

Native controls such as Not interested or Do not recommend are probabilistic signals. They are not reliable blocking mechanisms and do not provide transparent, portable rules.

ContentLens adds a user-controlled curation layer above each platform.

## How it works

Every item follows a layered pipeline:

```text
Content extraction
  -> deterministic rules
  -> accepted optional classifiers when enabled
  -> decision policy
  -> explainable decision
  -> explicit feedback
```

Known blocks and allow rules resolve immediately. Model-backed capabilities are reserved for semantic, visual and similarity judgments after they meet evaluation, performance and privacy gates. Hidden items remain reversible and show the reasons behind the decision.

## Core principles

- Local-first operation
- Explicit user control
- Deterministic blocking for known channels, authors and terms
- AI only where semantic or visual judgment is necessary
- Explainable decisions and reversible hiding
- No mandatory backend
- Optional user-owned synchronization
- Cross-platform content archetypes
- Privacy by default

## Capabilities

Deterministic, available without an account, a network request or a model:

- Block channels and authors permanently
- Block or reduce specific terms in titles
- Reversible hiding with a placeholder, reveal and one-action undo
- Show why a card or post was hidden
- Correct false positives and false negatives
- Export and import a versioned local profile, in plaintext or encrypted

Optional and disabled by default. Each one is implemented and stays off until
its own quality, privacy and performance gate passes:

- Semantic topic rules and text archetype classification
- Thumbnail and preview-image signals, including clickbait counterexamples
- Similarity, exact deduplication and a bounded content graph
- Editable AI-assisted rule drafts, without authority to save on your behalf
- Reviewed native platform feedback after a local action
- User-owned synchronization through a provider you choose

Removing every optional capability leaves the deterministic path unchanged.

## Quick start

ContentLens requires Node.js 24.x and pnpm 11.17.0.

```sh
npm install --global pnpm@11.17.0
pnpm install --frozen-lockfile
pnpm dev
```

Use `pnpm dev:firefox` for Firefox. See [Getting started](docs/getting-started.md)
for loading the unpacked extension and completing the first rule.

## Using the extension

1. Open ContentLens from the browser toolbar.
2. Use **Settings** to enable a platform and the surfaces you want inspected.
3. Use **Rules** to add deterministic allow or block rules.
4. Use **Review** to inspect decisions and correct a result.
5. Use **Settings** to export, import or encrypt the local portable profile.

Hidden content uses a reversible placeholder and includes the reason behind the
decision. Provider-backed classification and synchronization remain optional
and require explicit endpoint, permission and consent configuration.

## Platforms

### YouTube

Filter videos by channel, topic, title, thumbnail, content archetype and personal relevance.

### LinkedIn

Filter AI-generated filler, moral lessons, humblebrag, corporate fanfiction, engagement bait, promotional posts, course advertising and repetitive low-value content.

### X

Filter rage bait, engagement farming, political noise, recycled AI threads, crypto spam, guru content, unverified claims and repeated news without original analysis.

### Reddit

Filter repetitive questions, flame wars, political noise, low-effort memes and rage while prioritizing technical discussions, experiments, benchmarks, RFCs and issue analysis.

### Hacker News

Prioritize primary sources, technical depth, novelty and evidence while reducing duplicated news, summaries without added value and promotional content.

### RSS and Atom

Local fixtures, parsing, stored entries and portable subscription contracts are
supported. Network acquisition is disabled because browser `fetch` cannot bind
its connection to an address approved by a separate DNS check.

## Development

Build both browser packages from the locked dependency graph:

```sh
pnpm install --frozen-lockfile
pnpm build:chrome
pnpm build:firefox
```

Run the complete local gate before review:

```sh
pnpm ci:local
pnpm test:browser
```

The generated files stay under `.output/` and are ignored by Git. See
[Development](docs/development.md) for command ownership, repository layout and
the validation matrix.

## Contributing now

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a proposal or pull request.
Changes to behavior require a focused regression test. Changes to architecture,
permissions, persisted data or trust boundaries require the matching contract
and ADR review.

## Documentation

- [Documentation index](docs/README.md)
- [Getting started](docs/getting-started.md)
- [Development guide](docs/development.md)
- [Dependency policy](docs/dependency-policy.md)
- [Performance budgets](docs/performance.md)
- [Vision](docs/01-vision.md)
- [Product scope](docs/02-product-scope.md)
- [Architecture](docs/architecture.md)
- [Content model](docs/03-content-model.md)
- [Classification model](docs/04-classification.md)
- [Platform adapters](docs/06-platforms.md)
- [Synchronization](docs/09-sync.md)
- [Privacy and security](docs/10-privacy.md)
- [Privacy policy](docs/privacy-policy.md)
- [Architecture decisions](docs/decisions.md)
- [Threat model](docs/threat-model.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Governance](GOVERNANCE.md)
- [Manifesto](MANIFESTO.md)

## Status

No public browser-store release exists yet. The repository builds Chrome MV3
and Firefox MV2 packages and validates its deterministic baseline locally.
Optional model-backed capabilities remain disabled until their own privacy,
quality and performance contracts pass. RSS network acquisition remains
disabled until the browser connection can be bound to the validated address.
