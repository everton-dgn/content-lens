# Hacker News fixture dataset

## Purpose and scope

These local fixtures support front page, new, best, ask, show, jobs and item-page
surfaces declared by the shared platform contract. They back the adapter
contract suite and the deterministic
identity, failure-open and reversible-rendering checks. They are not training
or classifier evaluation data, and they must never be reported as release
quality evidence.

The fixtures cover:

- stable item identity taken from the item link, never from the title;
- job posts distinguished from ordinary submissions;
- item pages whose comment tree stays outside candidate identity.

## Provenance and permitted use

Every title, display name, platform ID and markup combination is synthetic and
was authored for this repository. No page was captured, no authenticated
session was used and no personal browsing history, account identifier, cookie,
credential or provider response is present.

| Field | Value |
| --- | --- |
| Source kind | Synthetic |
| Consent basis | Not applicable to synthetic data |
| License | CC0-1.0 |
| Language | English |
| Permitted use | Adapter contracts and deterministic rendering checks |
| Retention | Repository lifetime, versioned with the contract |
| Redaction | Not required because the content is fully synthetic |

Each markup file has a sibling manifest recording schema and fixture versions,
surface, page-instance seed and the exact expected candidates. Ground truth
uses explicit stable and ephemeral identity variants; it never derives an
identifier from a display name.

## Inventory

| File | SHA-256 |
| --- | --- |
| `ask.fixture.json` | `48d3db6e85e77a1a8f9877b186c45b9c517c9499344aaebb77a902df54850a01` |
| `ask.html` | `b98eb6554baa1a406a59d1452849b864af2f65c540c171c3c25c216e4a75371f` |
| `best.fixture.json` | `f8e0ed42105a466b9687958d9db826f7485b6b4266fd19f1540ab426f48b3540` |
| `best.html` | `60281d83a245abb8b55113d737c900d995fadc903d3b498f8c61988f8efbbc7b` |
| `front-page.fixture.json` | `7ee379edff87912cb017d47307cb81837a9981abae6d63a0ae96eb3859ff74e6` |
| `front-page.html` | `729bf75176a968e0f78e74498eec2fe427154a4b379a8da062c5563bdfb099a1` |
| `item.fixture.json` | `9383c0c09290a80ec6f06c871af298ae59167ecf64140a618c9370e2c0182e18` |
| `item.html` | `43d5c306b6b4d4a0a516e8c947271c8e7c59c3a2d9d80dbb68345d0046b6f5fd` |
| `jobs.fixture.json` | `c1ad467b803b0ba877dc714810de9b1d12531298d9fa1de5e20ac85484a1dac6` |
| `jobs.html` | `ad1c215265f53cf0bfe0b4649c179eb9a44c21daa05d484fbb770c49c3a5c4d6` |
| `new.fixture.json` | `de074b1841a9b39bad8ffdce21609ee03fbba0a52f47c668793f274689f6968e` |
| `new.html` | `394ef35a30219103b8956ade4685931d5e07520e9af25af8fb4bdf4a4b955d86` |
| `show.fixture.json` | `6e17a190c40c8a7ab3f455751ed3d9174585ab3ab780085ee230f76788826caf` |
| `show.html` | `3baa0bbd9ba3993ad650c50f1f0a2afc354a754a779ed5a2f97c52b6b3d778ef` |

Checksums cover the fixture corpus only. Editing a fixture requires
incrementing its `fixtureVersion`, updating its checksum here and reviewing the
ground truth independently from the adapter change.

## Contract

`tests/contract/hacker-news-adapter.test.ts` consumes this corpus and asserts:

- a capability declaration for every supported surface;
- exact stable identity extraction, with explicit ephemeral identity and
  disabled durable actions when an identifier is absent;
- an unchanged visible DOM when extraction capability is reduced;
- rejection of any surface outside the canonical taxonomy.

## Maintenance rules

- Keep fixtures local and independent of network access.
- Prefer a new fixture version over replacing evidence silently.
- Add an explicit expected case for every supported markup variant.
- Keep raw personal or authenticated markup outside the repository.
- Run `pnpm guard:public` after every fixture change.
- Require complete identity agreement for supported cases and fail open for
  every missing or invalid identity case.
