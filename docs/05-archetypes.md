# Content archetypes

An archetype captures how a piece of content is framed. It is separate from topic. A post about software can be a benchmark, tutorial, advertisement or empty AI-generated thread.

Every archetype definition contains:

- A stable ID and human label.
- A definition.
- Positive examples.
- Counterexamples.
- Textual and visual criteria.
- Platform-specific notes.
- Default policy, if any.

Default policies are suggestions. User preference always controls the final effect.

## Negative or commonly reduced archetypes

### Clickbait

Content framed with withheld information, manufactured urgency or exaggerated visuals that are disproportionate to the underlying value.

Signals:

- "You won't believe" or equivalent promise.
- Excessive capitalization or punctuation.
- Thumbnail expressions, arrows and circles combined with a sensational title.
- Important context intentionally omitted to force a click.

Counterexample: a surprising research result whose title states the concrete finding.

### Rage bait

Content optimized to provoke anger, tribal conflict or pile-ons.

Signals:

- Deliberate misrepresentation.
- Repeated culture-war framing.
- Personal attack presented as analysis.
- Calls for hostile engagement.

Counterexample: evidence-based criticism of a harmful decision.

### Engagement bait

Content whose main purpose is collecting reactions rather than conveying information.

Signals:

- Generic "Agree?", "Thoughts?" or "Wrong answers only".
- Polls without a meaningful question.
- Empty requests to comment for access.

Counterexample: a focused technical question containing enough context to answer.

### AI filler

Generated or heavily templated material with little original information.

Signals:

- Recycled lists and generic prompt advice.
- Repetitive structure without sources.
- Confident summary without evidence or new analysis.
- Many words carrying little information.

AI assistance alone is not a reason to filter. Original analysis created with AI tools can still be valuable.

### Corporate fanfiction

Fabricated or unverifiable workplace stories used to deliver a moral lesson, build a personal brand or advertise a service.

Signals:

- Implausibly polished dialogue.
- Predictable "what this taught me" ending.
- Humblebrag disguised as vulnerability.
- No checkable detail.

Counterexample: a postmortem with concrete facts, impact and lessons.

### Coach and empty self-help

Generic motivational claims, guru positioning and unrealistic formulas for success.

Signals:

- Universal advice detached from context.
- Income or career promises without evidence.
- Manufactured authority.
- Funnel to a course or paid community.

Counterexample: a specific mentoring technique supported by experience and limitations.

### Disguised advertising

Promotional content presented as neutral advice, news or personal reflection.

Signals:

- Product or course pitch concealed until the end.
- Affiliate incentives not disclosed.
- Comparison built around one seller.

Counterexample: a transparent product announcement or technical release note.

### Spam and content farming

High-volume, duplicated or low-effort content produced to capture impressions, search traffic or referrals.

Counterexample: a recurring digest that adds consistent editorial selection.

## Positive or commonly promoted archetypes

### Tutorial

Teaches a concrete task with prerequisites, steps, working examples and limitations.

### Paper

Primary research or a close reading that identifies method, evidence and uncertainty.

### Benchmark

Compares systems using disclosed methodology, data and reproducible conditions.

### Engineering analysis

Explains design, tradeoffs, failure modes or implementation evidence.

### Postmortem

Describes an incident with timeline, impact, causes, recovery and prevention.

### Documentation

Authoritative reference material for a system, interface or standard.

### Primary source

Original release, research, statement, dataset or event record rather than a derivative summary.

### Open-source work

Repository, issue, pull request, release or technical discussion containing inspectable artifacts.

## Topic examples

The following are topics rather than archetypes:

- Professional football.
- Devotional religion.
- Academic religion.
- Esotericism and astrology.
- Politics.
- Artificial intelligence.
- Software engineering.
- Frontend development.
- Science.

Keeping topic and archetype separate allows rules such as:

- Hide professional football commentary.
- Allow academic analysis of sports.
- Promote technical benchmarks about AI.
- Reduce generic AI filler.

## Maintenance

Archetype definitions are versioned. Changes that broaden a negative archetype require regression examples because they can increase false positives across every adapter.
