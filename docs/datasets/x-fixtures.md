# X fixture dataset

## Purpose and scope

These local fixtures support the following, for you, replies, quoted posts and
thread surfaces declared by the shared platform contract. They back the adapter
contract suite and the deterministic
identity, failure-open and reversible-rendering checks. They are not training
or classifier evaluation data, and they must never be reported as release
quality evidence.

The fixtures cover:

- quoted posts that keep both identities distinct;
- thread context bound to the root post;
- reply candidates that never inherit the parent decision.

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
| `following.fixture.json` | `1ab0b8aed4556e9a9f0f6624f6715db6a5d8ae086321d10ef1480c2534dbc0bb` |
| `following.html` | `aab15cdc353c22a1cc573b763e0fc0d0be434d598a16371ee10a611a9362d927` |
| `for-you.fixture.json` | `e2a2c7986e49180f0c30e186071bab38e9f9eac68d3e68333e234a35deddca98` |
| `for-you.html` | `4dea5239b056c6a3c69c8629f68fef38775f9fc8dba8d948fd6a6687cfa763f7` |
| `quoted-posts.fixture.json` | `2380b4ede1836d71c3773258eedc1a14e8845efa0c5bcab239c008371e0fc8a7` |
| `quoted-posts.html` | `6845d73dd57e93bdba5455e0845e5e261e40f64fc9ba57b6b9238d26fee9f7d6` |
| `replies.fixture.json` | `180db71f2a5e5706dc3577737508337a6cca62a3a1a442b2c20a05bfa4d3a045` |
| `replies.html` | `24e87c23a74e9cde6b0c00125c90fd5cfb4eaa0a0814d28082bff44694325fb7` |
| `threads.fixture.json` | `72ad36c7e3381de57a5f1e3e6127dcc9c5333de2cb81e5699ee49ddd0326c895` |
| `threads.html` | `d37a406dabfc1634316c24ee4d0ea6641b88d9dad9a05d6ea490ea322af386e7` |

Checksums cover the fixture corpus only. Editing a fixture requires
incrementing its `fixtureVersion`, updating its checksum here and reviewing the
ground truth independently from the adapter change.

## Contract

`tests/contract/x-adapter.test.ts` consumes this corpus and asserts:

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
