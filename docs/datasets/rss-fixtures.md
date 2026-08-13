# RSS and Atom fixture dataset

## Purpose and scope

These local fixtures support RSS 2.0, Atom and RDF feed-entry surfaces declared
by the shared platform contract. They back the adapter contract suite and the
deterministic
identity, failure-open and reversible-rendering checks. They are not training
or classifier evaluation data, and they must never be reported as release
quality evidence.

The fixtures cover:

- the three feed dialects the parser supports;
- entries whose GUID differs from the entry link;
- bounded entry counts that exercise the parser limits.

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
| `atom.xml` | `c91d4144b75ca750ed93717239a50f058f88733d33a2a5f4de7eb4ac404e4119` |
| `fixtures.json` | `beb7f422c4ee7fa52534033a7775f2c145c65db12152bcdf412733271118f97f` |
| `rdf.xml` | `c2400365fa6184e701f44dc0e99297edb1209f3d1316aee171c75bbd9ea3e574` |
| `rss2.xml` | `f0aaaff0f121d046e50e1f8108de4558e5768f14c6ec7120a1fd681f1a828d4c` |

Checksums cover the fixture corpus only. Editing a fixture requires
incrementing its `fixtureVersion`, updating its checksum here and reviewing the
ground truth independently from the adapter change.

## Contract

`tests/contract/rss-adapter.test.ts` consumes this corpus and asserts:

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
