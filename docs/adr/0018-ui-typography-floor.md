# ADR 0018: UI typography floor

Status: Accepted

## Context

The side panel uses a compact type scale because its narrow viewport must hold
navigation, status and configuration content. The smallest token previously
resolved to 10.5 CSS px. It appeared in metadata, badges, navigation labels,
helper copy and the footer, which made those roles harder to read and allowed
browser-default `small` sizing to reduce inherited text further.

Uppercase metadata also used bold weight, wide tracking and nearly the same
tone as its value. The label and value therefore competed for attention instead
of forming a clear term-and-value pair.

## Considered options

1. Increase only the summary-card labels.
2. Raise the smallest shared token and enforce it across extension-owned UI.
3. Replace the native system font with a custom family designed for small text.

Option 1 leaves the same readability problem elsewhere. Option 3 adds font
loading, packaging and licensing costs while the problem comes from size,
weight, tracking and color. Option 2 fixes every existing consumer through the
current token contract and prevents regression.

## Decision

`CL-UI-001`: all visible extension-owned text renders at 12 CSS px or larger.
Every font-size primitive must resolve to at least 12 CSS px at the canonical
16 CSS px root. Semantic elements such as `small` use the smallest registered
font-size token instead of the browser default.

Uppercase metadata uses semibold weight, subtle neutral text and restrained
tracking. Its associated value uses the primary text color and regular weight.
Red remains reserved for the current destination, direct actions and active
rule boundaries.

The design-system guard rejects font-size primitives below the floor. A browser
test checks computed sizes across every primary view and settings destination.

## Consequences

Compact labels and status text occupy slightly more space. Narrow layouts must
wrap rather than reduce text, clip content or introduce horizontal scrolling.
Visual baselines change in both themes and every supported side-panel width.

The native UI font stack remains unchanged. Future components must express
hierarchy through tokens, weight, color and spacing without adding smaller type.

## Validation

- `pnpm design-system:check`
- `pnpm test:unit`
- `pnpm test:a11y`
- `pnpm test:visual`
- `pnpm test:browser v01`
