# ADR 0011: Reviewable AI assistance

Status: Accepted

## Context

AI can reduce the effort of expressing a preference, creating examples and understanding why content matched. It can also infer an overly broad scope, respond to prompt injection or make an uncertain proposal look final.

ContentLens needs one boundary that permits useful assistance without giving a model authority over durable preferences or platform actions.

## Considered options

1. Let the model create and apply rules directly.
2. Restrict AI to feed classification.
3. Let AI produce validated, editable drafts and explanations.
4. Require a conversational assistant for every preference change.

## Decision

AI assistance may return rule drafts, explanations and suggestions through a validated non-authoritative schema.

- The model cannot call storage, adapter, sync or native-feedback APIs.
- Known context is prefilled and distinguished from model inference.
- The affected effect, scope, examples and exclusions remain editable.
- A durable mutation requires a separate user-confirmed operation.
- Effect escalation, platform expansion and external actions receive explicit review.
- Manual completion remains available when assistance is unavailable.
- Classification and assistance have separate capability, model and evaluation gates.

The assistance capability remains behind its promotion gate. This ADR accepts the architectural boundary, not a model or default activation.

## Tradeoffs

- Review adds one step before a generated draft becomes active.
- The application needs draft validation, provenance labels and manual fallback.
- The boundary permits models and runtimes to change without granting them additional authority.
- Users can express nuanced rules with less repetitive input.

## Consequences

- Model output never becomes durable user intent by itself.
- Prompt injection cannot directly mutate profile or platform state.
- A generated draft is local sensitive data and follows privacy and retention controls.
- UX and evaluation evidence must measure both effort reduction and unintended scope changes.

## Validation

- Scope-preservation and effect-escalation tests.
- Prompt-injection fixtures that request saving or external action.
- Usability comparison against manual rule creation.
- Manual completion after timeout, cancellation and malformed output.

## Revisit trigger

Revisit only if a future capability requires bounded autonomous operation with a distinct threat model, spec, consent model and recovery contract.
