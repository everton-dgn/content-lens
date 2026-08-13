# Product scope

## Core capabilities

Capabilities have independent maturity. Deterministic rules, reversible decisions, local persistence and profile portability form the accepted baseline. Model-backed classification, visual analysis, similarity, graph features and network synchronization remain gated by their product contracts and architecture decisions.

### Rules

- Block a channel, author, exact term or individual item.
- Always allow a channel, author or matching content.
- Create semantic topic rules with examples and exclusions.
- Reduce or promote content based on subjective preferences.
- Scope a rule by platform and surface.
- Search, edit, disable, export and import rules.

### Classification

- Classify text by topic and cross-platform archetype.
- Analyze thumbnails and other preview images when a platform exposes them.
- Estimate technical depth, originality, novelty, evidence, clickbait, noise and personal relevance.
- Compare content with positive and negative examples.
- Explain scores and evidence.

### Decisions

ContentLens supports four main decisions:

| Decision | Meaning |
| --- | --- |
| Show | Render normally. |
| Promote | Increase visual priority for highly relevant content. |
| Reduce | De-emphasize uncertain or mildly unwanted content. |
| Hide | Replace the item with an explainable, reversible placeholder. |

An optional `review` state can queue uncertain high-impact decisions without hiding them.

### User actions

- Show this item.
- Hide for now.
- Show less for now.
- Show less of this type.
- Hide similar content.
- Always show content like this.
- Block this channel or author.
- Prioritize this channel or author.
- Block this topic.
- Correct the classification.
- Optionally send a native "not interested" signal after confirmation.

### Intelligent assistance

When its capability spec is accepted, ContentLens may use AI to reduce configuration work:

- Turn a short instruction and the current item into an editable rule draft.
- Infer platform, surface, source and examples already present in context.
- Propose exceptions and narrower scopes for review.
- Explain which evidence matched a rule.
- Group repeated consistent corrections into a dismissible suggestion.

Assistance never saves a durable rule, broadens its scope or submits a platform action without the required user review. Deterministic controls remain complete when every model is unavailable.

### Experience baseline

- A new installation works locally without an account, provider or model download.
- Common unambiguous actions complete in one interaction and offer undo.
- Advanced controls use progressive disclosure.
- Recoverable failures preserve drafts and completed local work.
- Pending model or network work does not block the platform.
- The first useful action requires at most three user decisions.

## Rule levels

### Absolute rules

Stable identity and exact-match decisions. They bypass AI and take precedence over learned preferences.

Examples:

- Never show channel `UC123`.
- Always allow a trusted author.
- Never show an exact term on Home and recommendations.

### Semantic rules

Natural-language descriptions that require contextual judgment.

Example:

> Hide professional football, matches, championships and transfer commentary. Allow academic history, statistical examples and software related to the sport.

### Preferences

Soft positive or negative weights for patterns where a hard rule would cause unacceptable false positives.

Examples:

- Reduce exaggerated facial expressions.
- Reduce manufactured outrage.
- Promote primary sources.
- Promote technical depth.

## Platform scope

| Platform | Planned surfaces | Main signals |
| --- | --- | --- |
| YouTube | Home, search, related videos, subscriptions, Shorts | Title, channel ID, thumbnail, duration, section |
| LinkedIn | Feed, reposts, promoted posts | Text, author ID, media, repost metadata |
| X | Following and For You timelines, replies, quoted posts | Text, author ID, thread context, links |
| Reddit | Home, Popular, All, subreddit feeds, comments | Title, body, subreddit, author, flair |
| Hacker News | Front page, new, best, item pages | Title, domain, author, thread metadata |
| RSS | Feed entries | Title, body, author, source, publication date |

YouTube is the first implementation target. Later adapters reuse the core model and classification pipeline.

## YouTube scope

- Detect cards in dynamic and virtualized lists.
- Use stable channel IDs instead of display names when available.
- Filter Home, search, recommendations, subscriptions, Shorts, channel pages, playlists and infinite-scroll results.
- Allow surface-specific policies, such as blocking a channel in recommendations while leaving explicit search results visible.
- Keep local blocking as the source of truth.
- Treat native "Not interested" and "Do not recommend channel" actions as optional secondary signals.
- Never automate likes.

## LinkedIn scope

Reduce:

- AI-generated filler.
- Fabricated moral stories.
- Humblebrag and corporate fanfiction.
- Empty motivational content.
- Engagement bait and useless polls.
- Course advertising, excessive self-promotion and recruiting spam.
- Reposts without added analysis.
- Long posts with little information.

Promote:

- Engineering, architecture and open source.
- Papers, benchmarks and postmortems.
- Technical case studies and original analysis.

## X scope

Reduce:

- Rage bait, engagement farming and empty threads.
- Copied news without a source.
- Recycled AI threads and generic prompt content.
- Political and culture-war noise according to user preference.
- Crypto spam, pump-and-dump content and giveaways.
- Guru content and unrealistic income claims.

Promote:

- Papers, benchmarks, releases and primary announcements.
- Open-source engineering.
- Researchers and original technical analysis.

## Reddit scope

Reduce:

- Low-effort memes.
- Flame wars and repetitive political fights.
- Repeated questions and rage posts.

Promote:

- Technical discussions.
- RFCs, issue analysis and experiments.
- Benchmarks and detailed project reports.

## MVP

The first usable release is a Manifest V3 browser extension with:

- A YouTube adapter for Home, search and related videos.
- Deterministic channel, term and allow rules.
- Reversible hidden-item placeholders with reasons.
- Explicit correction actions.
- A zero-configuration local first run with measurable interaction budgets.
- IndexedDB persistence.
- JSON import and export.
- No mandatory account, backend or cloud inference.

Text classification, thumbnail analysis and similarity may join a later release only after their evaluation, privacy, compatibility and performance gates pass.

## Deferred work

- Additional platform adapters.
- Automatic native platform feedback.
- Full transcript analysis.
- Network synchronization and cross-device conflict resolution.
- Shared public rule packs.
- Full-browser and email filtering.
