# ADR 0007: Separate version domains

Status: Accepted

## Context

Product releases, portable profiles, adapter contracts, models and future plugin APIs evolve at different rates. One shared version would create unnecessary breaking changes or hide real incompatibility.

## Considered options

1. One version for every artifact and contract.
2. Independent undocumented versions.
3. Documented version domains with compatibility rules.

## Decision

ContentLens versions product releases, profile schema, adapter contract, plugin API, classifier, model and archetype definitions independently.

Public product releases use Semantic Versioning. Persisted and extension contracts follow [Compatibility](../compatibility.md).

## Tradeoffs

- Release metadata contains several versions.
- Compatibility testing is more explicit.
- Model and adapter fixes do not force unrelated profile changes.
- Breaking persisted-data changes cannot hide inside a product patch.

## Consequences

- Decisions and cache records identify relevant version domains.
- Migrations name the profile schema transition.
- Release notes list affected domains.
- A breaking change increments the domain it breaks.

## Revisit trigger

Revisit if independent versioning creates more user confusion than compatibility value after stable releases exist.
