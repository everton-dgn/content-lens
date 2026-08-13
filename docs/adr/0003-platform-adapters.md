# ADR 0003: Platform adapters

Status: Accepted

## Context

Feed markup changes frequently and uses dynamic insertion, experiments and virtualized lists. Classification concepts such as clickbait or technical depth apply across platforms.

## Considered options

1. One extension implementation per platform.
2. A shared core with platform-specific feed adapters.
3. A generic DOM scraper configured only by selectors.

## Decision

DOM observation, extraction and rendering are isolated behind `FeedAdapter`. The core consumes normalized `ContentItem` values and has no platform selectors.

## Tradeoffs

- Each adapter requires fixtures and maintenance.
- Normalization can omit platform-specific detail.
- Platform breakage is contained.
- Classifiers, rules, feedback and sync are reused.

## Consequences

- Adapters declare capabilities and supported surfaces.
- Missing data fails open.
- Virtualized-node identity checks are part of the contract.
- Platform-specific fields live in bounded context metadata or adapter state.

## Revisit trigger

Revisit if two mature adapters cannot express required behavior through the shared content model without excessive platform conditionals.
