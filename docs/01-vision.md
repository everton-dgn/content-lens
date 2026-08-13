# Vision

## Problem

Algorithmic feeds mix useful information with clickbait, repeated stories, unwanted topics, manufactured outrage, disguised advertising and low-effort generated content. Native controls influence recommendations but do not provide reliable blocking, portable rules or transparent explanations.

Keyword filters are too literal. They cannot reliably distinguish professional football news from software used to analyze a football match, devotional content from academic history, or an AI research paper from an empty "ten prompts" thread.

## Mission

ContentLens gives each person an inspectable, portable and local-first curation layer across content platforms. It should reduce noise, preserve useful exceptions and prioritize high-value information according to explicit personal intent.

## Product position

ContentLens is a personal content curator. It is broader than an ad blocker, a keyword blacklist or a YouTube-only extension.

The product has two complementary responsibilities:

1. Enforce deterministic decisions for known channels, authors, terms and allow rules.
2. Classify unseen content by topic, archetype, visual pattern, quality and personal relevance.

## Goals

- Hide content the user explicitly never wants to see.
- Reduce subjective patterns such as clickbait and engagement bait without turning them into absolute blocks.
- Promote technical, educational, original and evidence-based material.
- Explain every automated decision.
- Learn mainly from explicit corrections.
- Work offline and without a ContentLens-operated backend.
- Reuse preference concepts across platforms.
- Keep platform DOM changes isolated from classification logic.

## Non-goals

- Manipulate platform ranking systems at scale.
- Automatically like, dislike or endorse content.
- Guarantee that native platform recommendations will change.
- Treat viewing behavior as approval.
- Provide a universal definition of "good" content.
- Store complete browsing history, thumbnails or transcripts in synchronization providers.
- Make a cloud model or third-party account mandatory.
- Moderate content for other users or enforce a central policy.

## Primary users

- People who use feeds for learning or professional research.
- Technical users who want precise control over topics, authors and quality patterns.
- Users who want the same preferences on multiple devices without depending on a ContentLens service.
- People who need reversible filtering because false positives are costly.

## Core use cases

### Absolute channel or author block

A user blocks a stable platform identity. Matching items are hidden on the selected surfaces before any AI inference.

### Semantic topic rule

A user asks to hide professional football, devotional religion or esotericism while defining legitimate exceptions. A semantic classifier evaluates context instead of matching a single word.

### Quality preference

A user lowers the rank of exaggerated thumbnails, AI filler or corporate moral stories. One weak quality signal alone should not necessarily hide the item.

### Positive discovery

A user asks for more papers, benchmarks, postmortems, technical talks or primary sources. ContentLens highlights strong candidates and novel material.

### Correction

The user reveals a hidden item, sees the reasons, corrects the classification and optionally turns that correction into a rule or example.

## Product promise

A user should be able to understand what was filtered, change the decision immediately and move their durable profile to another device or provider.
