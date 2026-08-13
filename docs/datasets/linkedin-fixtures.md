# LinkedIn fixture dataset

## Purpose and scope

These local fixtures support feed, repost, promoted-post and comment-preview
surfaces declared by the shared platform contract. They back the adapter
contract suite and the deterministic
identity, failure-open and reversible-rendering checks. They are not training
or classifier evaluation data, and they must never be reported as release
quality evidence.

The fixtures cover:

- author identity separated from display name;
- promoted posts marked by their own surface, never inferred from copy;
- repost chains that preserve the original author identity.

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
| `comment-preview.fixture.json` | `ccdb0fc5887ab5f6b0134506480570fa1e740caa96093913fea24a9eb1b7c5b3` |
| `comment-preview.html` | `cfed400920530821526ab2606d925da693f66f366c814671d8e7d002ad2554e8` |
| `feed.fixture.json` | `60afc55ed62ef53627b5566d401fba7c3b617c6362f0c4741df1f26428cf6392` |
| `feed.html` | `2978f71dff0cac042f74286e2baf10618129ce3152c03ad9e9908261d0dd0a8e` |
| `promoted.fixture.json` | `2539d05a0188628d9e14e77b2dd4cc2334aff21d0eb4ed96119c782999f15019` |
| `promoted.html` | `04a548f6a35b91f0bf7c39e3a773ec6a1a2d280a559d088887cd22e80c38a554` |
| `repost.fixture.json` | `c4c5975ec5a1de12483a7a0bf7a3c16cadb2df3c43520d2f8ec5423a5d8acebd` |
| `repost.html` | `34a37b9ca67270f34d03a675ceeab14ea319600b5a9d34434fd8c3fb9bfc3b3a` |

Checksums cover the fixture corpus only. Editing a fixture requires
incrementing its `fixtureVersion`, updating its checksum here and reviewing the
ground truth independently from the adapter change.

## Contract

`tests/contract/linkedin-adapter.test.ts` consumes this corpus and asserts:

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
