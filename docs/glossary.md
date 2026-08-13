# Glossary

## Normative language

- `MUST`: required for contract compliance.
- `MUST NOT`: prohibited by the contract.
- `SHOULD`: expected unless a documented reason justifies an exception.
- `SHOULD NOT`: discouraged unless a documented reason justifies it.
- `MAY`: optional capability.

## Product terms

### Adapter

A platform-specific boundary that observes feed candidates, extracts a normalized content item and renders a decision. An adapter does not own policy.

### Archetype

A cross-platform pattern describing form or quality, such as clickbait, benchmark or corporate fanfiction.

### Candidate

A platform element observed by an adapter before normalized extraction and classification.

### Classifier

A component that produces structured topic, archetype, quality or similarity signals. A classifier does not directly hide content.

### Content item

The normalized, platform-independent representation of a video, post, comment or feed entry.

### Decision

The policy result for a content item: `show`, `promote`, `reduce`, `hide` or `review`.

### User action

One deliberate activation of a control, shortcut or confirmed batch. Opening progressive disclosure and confirming a durable draft are separate user actions.

### User decision

One choice that changes task direction, scope, effect, consent or durable state. Reading information, waiting and navigating within already chosen scope do not count as decisions.

### Interaction

Any user input handled by ContentLens, including an action, text entry, selection or navigation. Usability evidence reports actions, decisions and interactions separately.

### Reveal

Restore a hidden or reduced item for the current page session without changing the durable rule or recording a learning signal.

The user-facing control may use the shorter label "Show". Normative contracts use "reveal" for this session-only behavior and "show" for the decision-engine result.

### Deterministic rule

An exact user rule that resolves without probabilistic inference, such as blocking a stable channel ID.

### Evidence

User-safe information that supports a decision. Evidence excludes hidden model reasoning.

### Explicit feedback

A deliberate user action such as reveal, block, allow or correct. Only an action whose label states a durable effect becomes a learning signal. Reveal remains session-only and is not treated as durable preference evidence.

### Fail open

Leave content visible when extraction, classification or policy cannot produce a safe decision.

### Personal relevance

A score relative to one profile. It is not a universal content-quality judgment.

### Preference

A soft weight that promotes or reduces content without creating an absolute rule.

### Profile

The user's durable rules, settings, examples and schema metadata. Disposable caches are not part of the portable profile.

### Provider

An optional integration for model execution or profile synchronization. Providers are outside the trusted local core.

### Rule conflict

Two explicit rules that produce incompatible effects for the same item and scope.

### Surface

A platform context such as Home, search, recommendations, replies or a subreddit feed.

### Topic

Subject matter such as software engineering or professional football. Topic and archetype are independent.

## Maturity terms

### Proposed

Documented for review. It cannot be treated as an implementation contract.

### Accepted

Approved as a current contract or decision.

### Experimental

Allowed only behind explicit activation and excluded from stable guarantees.

### Deprecated

Still supported for a documented transition period.

### Removed

No longer supported.
