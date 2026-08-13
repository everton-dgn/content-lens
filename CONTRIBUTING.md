# Contributing to ContentLens

ContentLens is an active browser-extension codebase. Keep changes focused,
tested and consistent with the local-first architecture.

## Before opening work

1. Search existing issues and pull requests.
2. Read the [documentation index](docs/README.md),
   [development guide](docs/development.md) and [governance](GOVERNANCE.md).
3. Open a proposal issue before changing a public contract, architecture
   boundary, persisted data or privacy behavior.
4. Use the security process for vulnerabilities. Do not open a public issue with exploit details.

## Change classes

### Editorial

Grammar, links and clarifications that do not change behavior. A focused pull request is enough.

### Product contract

Changes to observable behavior, requirements or acceptance criteria. Update
the relevant product document and add a regression test.

### Architecture

Changes that affect several components, a public contract, persisted data, trust boundaries or long-term maintenance. Add or update an ADR.

### Security-sensitive

Authentication, credentials, permissions, remote data, model downloads, native platform actions and persisted user data require a threat-model update and security review.

## Documentation rules

- Write normative requirements with `MUST`, `SHOULD` and `MAY`.
- Give every implementable requirement a stable ID.
- Separate accepted decisions from proposals and open questions.
- Add measurable acceptance criteria.
- Avoid naming a library, model or provider until evidence supports the choice.
- Keep examples free of credentials, personal browsing data and copyrighted datasets.

## Tool-assisted contributions

AI and other generation tools may assist with a contribution, but the contributor remains responsible for every submitted change:

- Review generated material for correctness, security, privacy, licensing and fit with accepted contracts.
- Run the same validation required for manually authored work.
- Do not treat model output as technical evidence or an authoritative source.
- Do not send credentials, private browsing data, confidential code or non-public project material to a provider.
- Confirm that generated or transformed material can be submitted under the repository license and retains any required notices.
- Disclose tool assistance when a tool generated or materially transformed a requirement, acceptance criterion, dataset, fixture, security analysis, benchmark result or implementation submitted in the pull request. Routine formatting, spelling and editor completion do not require disclosure unless they affect provenance or licensing.

Do not add automated attribution trailers to commits.

## Local validation

Run:

```bash
pnpm install --frozen-lockfile
pnpm ci:local
pnpm exec wxt zip -b chrome
pnpm exec wxt zip -b firefox
pnpm guard:public -- \
  .output/*-chrome.zip \
  .output/*-firefox.zip \
  .output/*-sources.zip
pnpm test:browser panel-open-smoke
pnpm guard:public
git diff --check
```

Every command must pass before review. WXT's Firefox package includes the
minimal source archive required for store review. The public repository guard
scans tracked, staged and unignored workspace files. It also inspects extension,
source and review ZIPs when their paths are passed explicitly.

Secret scanning runs through Kingfisher, which is a standalone binary rather
than a workspace dependency. Install it once:

```bash
brew install kingfisher
```

The `pre-commit` hook scans staged content and skips with a notice when the
binary is missing, so the gate that blocks a merge is the pinned CI step. Scan
the whole working tree at any time:

```bash
pnpm scan:secrets
```

The scan runs detection only. Kingfisher validates a candidate credential
against the provider API by default, which sends the value off this machine, so
`scan:secrets` passes `--no-validate`. Confirm whether a specific finding is
still live with an explicit, deliberate command:

```bash
kingfisher scan . --git-history none
```

Pass a generated archive explicitly when it also needs inspection:

```bash
pnpm guard:public -- .output/content-lens.zip
```

Fixture HTML and media require a sibling `*.fixture.json` file with schema
version `1`, surface, license and provenance. Synthetic fixtures set
`source.kind` to `synthetic` and `synthetic` to `true`. Redistributable fixtures
use an allowlisted public HTTPS source without credentials, query or fragment.
Never commit personal browsing data, raw diagnostics, private URLs or
credentials as fixtures.

Benchmarks run through a single parameterized command. Without a filter it
runs every benchmark file; with a filter it runs only the matching file, and
an unknown filter fails the run instead of passing silently:

| Filter | What it measures |
| --- | --- |
| `phase4-adapters` | Hacker News observe and RSS parse budgets |
| `rule-index` | Rule lookup over 100,000 rules against the 25 ms p95 budget |
| `sync-merge` | Three-way merge of 10,000 independent entities |
| `similarity-index` | Insert, query and rebuild of 10,000 similarity vectors |
| `native-feedback` | Native feedback revalidation latency |

```bash
pnpm benchmark
pnpm benchmark rule-index
```

For a red-green cycle, write the failing assertion with `it.fails` from
Vitest instead of a separate runner. While the behavior is missing, the
failure is expected and the suite stays green; once the implementation
lands, the passing test fails the suite until `.fails` is removed, which
turns it into a normal green assertion. The trade-off: `it.fails`
inverts any failure and does not prove the failure came from the missing
behavior. Keep the discipline: wrap only the minimal RED assertion, put no
setup inside the block and expect a specific error or message.

## Git workflow

- Create a focused branch from `main`.
- Use Conventional Commits.
- Keep commits reviewable and free of generated attribution trailers.
- Do not rewrite shared history.
- Integration uses a normal merge commit. Squash integration is not used.
- Rebase requires explicit maintainer approval.

Examples:

```text
docs: define adapter acceptance criteria
docs(sync): clarify conflict safety gate
chore: add documentation validation
```

## Pull requests

A pull request must:

- Explain the problem and scope.
- List contracts and ADRs affected.
- Include validation evidence.
- Identify unresolved risks.
- Preserve unrelated work.
- Update the changelog or state why no entry is needed.

Draft pull requests are welcome for early alignment.

## Review expectations

Maintainers evaluate correctness, privacy impact, testability, scope and consistency with accepted ADRs. Review may request evidence rather than implementation preference.

Approval of a planning document does not automatically approve a dependency, provider or code implementation.

## Licensing

By submitting a contribution, you confirm that you have the right to provide it under the repository's MIT License. Content copied from another project must retain required notices and compatible licensing.
