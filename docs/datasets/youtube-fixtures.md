# YouTube fixture dataset

## Purpose and scope

Dataset version 2 contains three local HTML fixtures for the accepted YouTube
Home, search and related-video surfaces. They support the Phase 0 adapter
contract, packaged-browser feasibility tests and deterministic performance
measurements. They are not training or classifier evaluation data.

The fixtures cover:

- platform-like markup variants for Home, search and related videos;
- the current `yt-lockup-view-model` related-video variant found by the
  sanitized live smoke;
- stable video and channel identities;
- a stable video whose channel ID is not exposed;
- a related-video candidate whose video ID is not exposed;
- explicit-search and passive-recommendation policy scopes;
- page-instance IDs bound to the fixture candidate identity.

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
| Permitted use | Adapter contracts and browser feasibility |
| Retention | Repository lifetime, versioned with the contract |
| Redaction | Not required because the content is fully synthetic |

Each HTML file has a sibling `*.fixture.json` manifest. The manifest records
schema and fixture versions, source, license, surface, page-instance seed and
the exact expected candidates. Ground truth uses explicit stable and ephemeral
identity variants; it never derives an ID from a display name.

## Version 2 inventory

| File | Surface | Cases | SHA-256 |
| --- | --- | ---: | --- |
| `home.html` | Home | 2 | `31f3ca44ae50584004533704d23730839052eaec33831bda41e2f78e63d6a94d` |
| `home.fixture.json` | Home ground truth | 2 | `135e58439f9670b4eecc1da2c043de4a2946a3f32fefa18e9213cf2593b65526` |
| `search.html` | Search | 2 | `db73d802ae3be35c551a634f199a23e18f1058ec7cd469daedbbe720e7df5fe6` |
| `search.fixture.json` | Search ground truth | 2 | `b69aeab26e4ac2fe0745d979c2d8be61bfb586e959c1cfd37c0aaefc729f1d03` |
| `related.html` | Related videos | 3 | `bdb93bf6056f7cc3bc0dfc3014fc21048cddf0db4ca31869cc1a79b4fb9f220a` |
| `related.fixture.json` | Related-video ground truth | 3 | `a43bacd2ebc3c36713e347053479ae5eedcfcb2d80d42e02c7e54f37b2dfb145` |

Checksums cover the fixture corpus only. Editing a fixture requires incrementing
its `fixtureVersion`, updating its checksum here and reviewing the ground truth
independently from the adapter change.

## RED contract

`tests/contract/youtube-adapter.test.ts` defines the production-facing
extraction boundary expected from the isolated Phase 0 prototype:

- a capability declaration for `home`, `search` and `recommendations`;
- exact stable video and channel identity extraction;
- explicit ephemeral identity and disabled durable actions when an ID is
  absent;
- an unchanged visible DOM when extraction capability is reduced;
- `explicit-search` policy scope only for the search fixture;
- candidate page-instance IDs that include the current page and DOM identity.

Task 2.1 intentionally started without an adapter implementation. A dedicated
RED runner executed the contract with a JSON reporter and accepted only marked
assertion failures caused by the missing adapter. That runner was retired; the
current RED convention is `it.fails`, documented in `CONTRIBUTING.md`.

The runner rejected zero tests, an unexpectedly green contract, suite startup
errors and any run containing an unmarked failure. Task 2.2 made the adapter
contract pass (today covered by `pnpm test:unit`, which includes
`tests/contract`) and removed the temporary contract exclusion from the
normal unit project. For a future RED cycle, the failing assertion lives in
the normal suite inside `it.fails` and turns green by removing `.fails` once
the implementation lands.

## Maintenance rules

- Keep fixtures local and independent of network access.
- Prefer a new fixture version over replacing evidence silently.
- Add an explicit expected case for every supported markup variant.
- Keep raw personal or authenticated markup outside the repository.
- Run `pnpm guard:public` after every fixture change.
- Require 100% identity agreement for supported cases and fail open for every
  missing or invalid identity case.
