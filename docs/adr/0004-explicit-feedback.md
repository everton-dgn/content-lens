# ADR 0004: Explicit feedback first

Status: Accepted

## Context

Clicks, watch time and reading time are ambiguous. A user can inspect unwanted content for research, verification or criticism.

## Considered options

1. Learn automatically from passive behavior.
2. Learn only from explicit actions.
3. Weight explicit actions strongly and make passive signals optional and weak.

## Decision

Explicit actions are authoritative. Passive behavior is disabled by default and may become an opt-in weak signal later.

## Tradeoffs

- Personalization starts with less data.
- The user spends some effort correcting decisions.
- Preference changes are interpretable.
- Accidental reinforcement from investigative viewing is reduced.

## Consequences

- Card-level actions are a core UI requirement.
- Corrections are durable labeled examples.
- One action cannot make an unbounded global model change.
- Viewing never creates an allow or promotion rule.

## Revisit trigger

Revisit if opt-in passive signals can show measurable benefit without increasing false positives or reducing user understanding.
