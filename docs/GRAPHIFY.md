# Knowledge graph

ContentLens keeps a local knowledge graph of its own code and documentation.
The consolidator extracts code structurally through Graphify's AST pass and
never calls a language model, so updating the graph costs no tokens.

## Units

`.graphify.json` maps unit IDs to directories. This repository is a single
product: `pnpm-workspace.yaml` carries settings and overrides but declares no
`packages`, and `package.json` is the only manifest. The map therefore holds
one unit, `rootmeta`, pointing at the repository root, and every tracked file
belongs to it.

Reconcile this map whenever the topology changes. Adding a real workspace
package means adding its unit.

## Commands

```bash
pnpm graph:update                  # update the AST and publish
pnpm graph:update --check          # inspect the published graph, no writes
pnpm graph:update --background     # schedule in the background, as hooks do
pnpm graph:update --workers 1      # single extraction process
```

`pnpm` forwards these arguments as they are; a `--` separator would reach the
script literally and fail. Without pnpm, call the launcher directly with
`sh scripts/graphify-run.sh --update-code`.

`--check` exits 0 when the graph matches the working tree and 2 otherwise,
printing the counters and the pending files as JSON.

`--check` reports `up_to_date` and `coverage_complete` separately. The first
says the snapshot matches the sources; the second says every inventoried file
has entities. A structural run can leave `coverage_complete` false, and that is
not a failure.

Do not run `graphify update .` here. It rewrites the consolidated graph with
unit-level IDs and manifests, which belong to `scripts/graphify-update.py`.

## Semantic coverage

Documents, images and configuration files carry no AST symbols, so their
entities come from a semantic pass that an agent session runs by hand. The hooks
never run it: they preserve the existing semantic layer and leave new or changed
files in `pending_extraction`.

The batch goes through an explicit file, validated before publication:

```bash
sh scripts/graphify-run.sh --update-code --semantic-input graphify-out/semantic-input.json
```

Each entry carries the MD5 of the original captured before reading it, plus the
nodes and edges actually extracted. The updater rejects a batch whose source
changed meanwhile, whose IDs collide with the AST layer, or whose edges point at
missing endpoints, and a rejected batch leaves `current` untouched. The flag is
refused in background runs.

Results already produced under the same extraction prompt are reused from the
official semantic cache instead of being extracted again.

## Output and snapshots

Artifacts live in `graphify-out/`, which Git ignores. Each run writes a
complete snapshot under `graphify-out/runs/<id>/`; the `current` symlink moves
only after the run succeeds and its sources are re-checked, so a failure leaves
the previous graph in place.

A snapshot of this repository takes about 25 MB, so every publication prunes
the older ones. The three most recent runs are kept, plus the one `current`
points at even when it is older, and the matching backups in
`/tmp/claude-backups` follow the same retention. Everything goes to the trash,
never a permanent delete, and a missing `trash` binary leaves every snapshot in
place and reports `prune_skipped`.

Each run reports what it pruned in `trashed_snapshots`,
`trashed_export_contexts` and `trashed_backups`. Change the retention through
`KEEP_SNAPSHOTS` in `scripts/graphify-update.py`.

Read `GRAPH_REPORT.md` for the summary, `coverage.json` for per-file state,
and `diagnostics.json` for the gaps.

## Coverage

The inventory covers tracked and unignored local files. Representation in the
graph does not prove complete extraction: it means the file has at least one
entity.

After the semantic pass, 817 of 818 inventoried files are represented and
nothing is pending. The exception is `pnpm-lock.yaml`, recorded as
`no_semantic_entities` because a generated lockfile carries no entity worth
extracting. `coverage_complete` stays false for that one file.

File classification uses `graphify.detect.classify_file` rather than a local
extension list, so shebangs, manifests and compound extensions are handled the
same way the tool handles them.

## Git hooks

`.lefthook.yml` schedules a background update on `post-commit`, `post-merge`
and `post-checkout`. The checkout hook ignores file checkouts and a checkout
that leaves HEAD unchanged. Git never waits for extraction: the hooks only
schedule, and the run continues detached with its output in
`graphify-out/auto-update.log`.

Set `GRAPHIFY_SKIP_HOOK=1` to opt out of a scheduled run. Secondary worktrees
skip automatically, before creating output or taking the lock.

In a fresh clone, `pnpm install` runs `wxt prepare`; install the hooks with
`pnpm exec lefthook install`.

A lock in the Git common directory serializes publications. A second run while
one is active exits with a message instead of competing.

## Requirements

The launcher resolves `uv tool dir` and runs the Python from the global
`graphifyy` installation. It never downloads or upgrades: a missing
installation fails with instructions, so hooks cannot pull packages.

Install it once with `uv tool install graphifyy`. The setup was validated with
graphifyy 0.9.55 on macOS. That number records what was tested and is not
pinned in any command.

`scripts/graphify-update.py` uses `fcntl`, symlinks and atomic rename, so it
targets POSIX. Windows needs WSL.

## Cost

The structural update calls no model, so its cost is local CPU and disk. Tokens
an agent spends reading the graph or configuring it are separate from
extraction. No measurement of semantic extraction cost is recorded here.
