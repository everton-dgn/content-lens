# Content model

The core model normalizes platform-specific cards, posts and entries into a common representation. Adapters may retain raw references internally, but classifiers and rules consume only core types.

## Content item

```ts
type Platform =
  | "youtube"
  | "linkedin"
  | "x"
  | "reddit"
  | "hacker-news"
  | "rss";

type Surface =
  | "home"
  | "search"
  | "recommendations"
  | "subscriptions"
  | "shorts"
  | "feed"
  | "replies"
  | "comments"
  | "channel"
  | "subreddit"
  | "article";

type ContentIdentity =
  | {
      status: "stable";
      platformContentId: string;
    }
  | {
      status: "ephemeral";
      pageInstanceId: string;
      reason: "not-exposed" | "invalid";
    };

type ContentItem = {
  id: string;
  platform: Platform;
  identity: ContentIdentity;
  canonicalUrl?: string;
  surface: Surface;
  title?: string;
  body?: string;
  author?: Author;
  channel?: Channel;
  media: MediaReference[];
  publishedAt?: string;
  observedAt: string;
  language?: string;
  context: Record<string, string | number | boolean>;
};
```

`id` is namespaced by platform. For stable identity it is a durable cache key. For ephemeral identity it is scoped to the current page session and MUST NOT create a durable identity rule or reusable decision cache entry.

## Identity

```ts
type Author = {
  platform: Platform;
  authorId: string;
  displayName: string;
  profileUrl?: string;
};

type Channel = {
  platform: Platform;
  channelId: string;
  displayName: string;
  channelUrl?: string;
};
```

Stable platform IDs are preferred over display names because names can change. If an adapter cannot resolve a stable content or source ID, it returns an explicit ephemeral identity, disables durable identity actions and records the reason in user-safe evidence. It never invents an ID from display text.

## Media

```ts
type MediaReference = {
  kind: "thumbnail" | "image" | "video-preview";
  url: string;
  width?: number;
  height?: number;
  fingerprint?: string;
};
```

Media bytes are processed locally when possible. URLs and bytes are cache inputs, not durable synchronized profile data.

## Topics and archetypes

```ts
type TopicScore = {
  topicId: string;
  label: string;
  score: number;
  evidence: Evidence[];
};

type ArchetypeScore = {
  archetypeId: string;
  score: number;
  evidence: Evidence[];
};
```

A topic describes subject matter, such as professional football or software engineering. An archetype describes the form and quality pattern, such as clickbait, tutorial or benchmark. They are modeled separately because one topic may appear in several archetypes.

## Quality and relevance

```ts
type QualityScores = {
  technicalDepth?: number;
  originality?: number;
  novelty?: number;
  educationalValue?: number;
  evidence?: number;
  trustworthiness?: number;
  clickbait?: number;
  noise?: number;
  aiGenerated?: number;
  personalRelevance?: number;
};
```

Scores use the range `0..1`. Missing scores mean "not evaluated", not zero.

## Evidence

```ts
type Evidence = {
  source:
    | "deterministic-rule"
    | "text-model"
    | "vision-model"
    | "embedding"
    | "content-graph"
    | "user-feedback";
  label: string;
  score?: number;
  ruleId?: string;
  excerpt?: string;
};
```

Evidence is user-facing. It must be safe to display and must not depend on hidden chain-of-thought or provider-specific reasoning.

## Decision

```ts
type DecisionAction = "show" | "promote" | "reduce" | "hide" | "review";

type Decision = {
  contentId: string;
  action: DecisionAction;
  score: number;
  confidence: number;
  reasons: Evidence[];
  matchedRuleIds: string[];
  decidedAt: string;
  classifierVersion: string;
};
```

The decision retains classifier and rule versions so stale cached results can be invalidated.

## Rules

```ts
type RuleScope = {
  platforms?: Platform[];
  surfaces?: Surface[];
};

type BaseRule = {
  id: string;
  enabled: boolean;
  scope: RuleScope;
  createdAt: string;
  updatedAt: string;
};

type IdentityRule = BaseRule & {
  kind: "identity";
  effect: "block" | "allow" | "promote";
  platform: Platform;
  identityType: "author" | "channel";
  identityId: string;
  displayName?: string;
};

type ExactRule = BaseRule & {
  kind: "exact";
  effect: "block" | "allow";
  field: "title" | "body" | "domain";
  value: string;
  caseSensitive: boolean;
};

type SemanticRule = BaseRule & {
  kind: "semantic";
  effect: "block" | "reduce" | "allow" | "promote";
  description: string;
  examples: RuleExample[];
  exclusions: string[];
  threshold: number;
};

type PreferenceRule = BaseRule & {
  kind: "preference";
  target: "topic" | "archetype" | "quality";
  targetId: string;
  weight: number;
};

type Rule = IdentityRule | ExactRule | SemanticRule | PreferenceRule;
```

Absolute allow rules have the highest user-defined precedence. This includes both `IdentityRule` and `ExactRule` values whose effect is `allow`. Conflicting non-allow rules must be surfaced rather than silently resolved by creation order.

## Feedback

```ts
type FeedbackAction =
  | "show-item"
  | "hide-item"
  | "show-less"
  | "hide-similar"
  | "always-allow"
  | "block-identity"
  | "prioritize-identity"
  | "correct-classification";

type Feedback = {
  id: string;
  contentId: string;
  action: FeedbackAction;
  correction?: {
    topics?: string[];
    archetypes?: string[];
    desiredAction?: DecisionAction;
  };
  createdAt: string;
};
```

## Content graph

The graph connects topics, archetypes, sources and content embeddings.
It is an optional future capability, not a required store or decision input for the deterministic baseline.

```ts
type GraphNode = {
  id: string;
  kind: "content" | "topic" | "archetype" | "source";
  label: string;
  embeddingRef?: string;
};

type GraphEdge = {
  from: string;
  to: string;
  relation:
    | "about"
    | "instance-of"
    | "similar-to"
    | "duplicates"
    | "derived-from"
    | "published-by";
  weight: number;
};
```

Graph applications include finding similar content, hiding reposts of the same story, identifying primary sources and promoting genuinely novel items.

## Revision and future sync metadata

The accepted local profile uses a monotonic profile revision. Timestamps support display and diagnostics, but do not establish distributed ordering:

```ts
type RevisionMetadata = {
  id: string;
  profileRevision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};
```

Portable deletion records may be added to the versioned export format where required. Device identity, distributed revisions, automatic merge semantics and deletion retention remain open under [ADR-0009](adr/0009-sync-conflict-model.md). A timestamp or device ID must not silently decide a conflict.
