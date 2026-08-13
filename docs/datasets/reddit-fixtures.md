# Reddit fixture dataset

## Purpose and scope

These local fixtures support the home, popular, all, subreddit, search and
comments surfaces declared by the shared platform contract. They back the
adapter contract suite and the deterministic
identity, failure-open and reversible-rendering checks. They are not training
or classifier evaluation data, and they must never be reported as release
quality evidence.

The fixtures cover:

- subreddit identity separated from post identity;
- comment candidates behind the documented opt-in surface;
- crossposts that preserve the originating subreddit.

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
| `all.fixture.json` | `b6ae3bd1976c1f4d73ab22d791f0849afc49786b919da6245b19d12a15ea7546` |
| `all.html` | `a1f3d7cce664f444b8c9401fd1e7bf03cbe921d6188b46b79b99f491fc3f7de4` |
| `comments.fixture.json` | `ecabb6d791dcb52e65619a7fd808d207cf7f65ee8f80a6f1718e369378282672` |
| `comments.html` | `a44583d075d16707cc4dbe3908f0c09b80365e87be22c6128771586c588767c5` |
| `home.fixture.json` | `f3b662654010d2de4db8c9ef21a42cedc44f2c9d6afa16edf76ddf448334c3c8` |
| `home.html` | `71d149d91dc70d8dd13dff96c62c286cbaffedad955b84186bfe5d181f3ccbdd` |
| `popular.fixture.json` | `86d1ba583583dff7ad2e55a2c6547dc73f9fff8bd71e738965cf8f4a74c7a0b4` |
| `popular.html` | `62330c4eac53149210673f6c285316c9e99e8a77c8afe2233f66c0253ac619e0` |
| `search.fixture.json` | `3cef66bbee54255a3e72cce82b03c79119bd8ea0a507f91344ef0b1c8ce64ff2` |
| `search.html` | `7029cdc0056f825cd9dcec50f01ba108a1c7aa05aee19ea3062ac4b08e461b69` |
| `subreddit.fixture.json` | `42c873d540842cd631cd0795e0cb8e046d1f5c7e0bbdf1f3e6d51a9e29bf5634` |
| `subreddit.html` | `40876425f6196870e68ace6e0b0ed4fd37805bd24ba09cc5096342980feaa778` |

Checksums cover the fixture corpus only. Editing a fixture requires
incrementing its `fixtureVersion`, updating its checksum here and reviewing the
ground truth independently from the adapter change.

## Contract

`tests/contract/reddit-adapter.test.ts` consumes this corpus and asserts:

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
