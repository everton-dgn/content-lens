# Platform adapters

## Maturity

The current stable runtime ships adapters for YouTube, LinkedIn, X, Reddit and
Hacker News. Each adapter stays inactive until the user enables its platform
and grants its exact origin. Supported surfaces follow the shared registry in
`src/core/content/surfaces.ts`; platform extraction, selectors and rendering
remain isolated inside each adapter package.

RSS ships as a local content-source adapter. Parsing and portable subscription
data are available, while browser network acquisition remains disabled.

## Boundary

Platform adapters own DOM observation, extraction and rendering integration. They do not own classification policy, profile storage or model selection.

```ts
interface FeedAdapter {
  readonly platform: Platform;

  observe(
    emit: (candidate: PlatformCandidate) => void,
  ): Promise<ObservationHandle>;

  extract(candidate: PlatformCandidate): Promise<ContentItem>;
  renderDecision(candidate: PlatformCandidate, decision: Decision): Promise<void>;
  injectActions(candidate: PlatformCandidate, actions: ContentAction[]): Promise<void>;
  restore(candidate: PlatformCandidate): Promise<void>;
}
```

An adapter capability declaration describes supported surfaces, fields and actions. Core behavior must tolerate missing capabilities. Extraction returns the stable or ephemeral identity variant defined in [Content model](03-content-model.md); a missing platform ID is represented, not invented.

## Adapter rules

- Observe dynamically inserted and recycled cards.
- Deduplicate candidates without assuming DOM nodes are permanent.
- Prefer stable platform IDs.
- Avoid blocking the page's main thread.
- Keep selectors and extraction heuristics inside the adapter package.
- Fail open when extraction is uncertain.
- Restore original content when a user reveals it or disables ContentLens.
- Avoid submitting platform feedback without an explicit user action.

## YouTube

### Surfaces

- Home.
- Search results.
- Related videos.
- Subscriptions.
- Shorts.
- Channel pages.
- Playlists.
- End screens when accessible.
- Infinite-scroll results.

### Extraction

- Video ID.
- Channel ID and display name.
- Title.
- Thumbnail URL.
- Duration.
- Surface and section.
- Available description or badges.

Channel ID is the durable block identity. Display name is informational.

### UI integration

Each card receives ContentLens actions:

- Hide this video.
- Block this channel.
- Hide similar videos.
- Always allow this channel.
- Correct classification.

Hidden cards are replaced with a compact explanation. The original node remains recoverable.

### Native feedback

"Not interested" and "Do not recommend channel" may be offered as optional, confirmed secondary actions. Local rules remain authoritative. Automated likes are outside scope.

## LinkedIn

### Surfaces

- Main feed.
- Reposts.
- Promoted posts.
- Comment previews when feasible.

### Extraction

- Stable post identity.
- Author identity.
- Text and visible media.
- Repost relationship.
- Promotion marker.

### Main archetypes

- AI filler.
- Corporate fanfiction.
- Moral story.
- Humblebrag.
- Engagement bait.
- Disguised course advertising.
- Recruiting spam.
- Technical case study.
- Postmortem.

## X

### Surfaces

- Following timeline.
- For You timeline.
- Replies.
- Quoted posts.
- Threads.

### Extraction

- Post and author IDs.
- Text.
- Links and media.
- Reply, quote and thread context.
- Repost relationship.

### Main archetypes

- Rage bait.
- Engagement farming.
- Copied news without source.
- Recycled AI thread.
- Crypto spam.
- Guru content.
- Paper, benchmark or primary announcement.

Political content is a user-configured topic, not a fixed global block.

## Reddit

### Surfaces

- Home.
- Popular.
- All.
- Subreddit feeds.
- Search.
- Comments when enabled.

### Extraction

- Post ID.
- Subreddit.
- Author.
- Title and body.
- Flair.
- Link domain.
- Crosspost relationship.

The adapter should distinguish repeated questions, crossposts and links to primary technical artifacts.

## Hacker News

### Surfaces

- Front page.
- New.
- Best.
- Ask.
- Show.
- Jobs.
- Item pages.

The simpler markup makes deterministic extraction easier. Classification focuses on source quality, novelty, technical depth and repeated coverage. Comment filtering remains optional because conversational context is easy to damage.

## RSS

RSS acts as a local content-source adapter instead of a page DOM adapter. The
parser normalizes supplied feed documents and preserves source identity,
canonical URL and publication date. Stored subscriptions remain part of the
portable profile, but browser network acquisition is disabled because a DNS
check cannot be bound to the connection later opened by `fetch`. The extension
can pause, resume or remove stored subscriptions. Creation and editing are not
available while network acquisition remains disabled.

## Testing contract

Every adapter ships fixtures for each supported surface and tests:

- Identity extraction.
- Dynamic insertion.
- Node recycling.
- Duplicate suppression.
- Hide, restore and explanation rendering.
- Selector failure behavior.

Adapters are expected to break as platforms evolve. A break must remain isolated from the core classifier.
