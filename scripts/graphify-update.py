import argparse
import concurrent.futures
import copy
import fcntl
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from collections import Counter
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".crt"}
PRIVATE_NAMES = {"credentials.json", "secrets.json", "id_rsa", "id_ed25519", ".npmrc", ".netrc"}
ARTIFACTS = ("graph.json", "graph.html", "GRAPH_TREE.html", ".graphify_labels.json", ".graphify_analysis.json", "GRAPH_REPORT.md", "coverage.json", "diagnostics.json", "monorepo.json")
# Snapshots to keep besides the published one. Each run stores a full copy of
# the graph, so an unbounded runs/ directory grows by that size on every commit.
KEEP_SNAPSHOTS = 3


def discard(paths):
    """Move paths to the trash, never deleting them permanently.

    Returns the paths actually handed over. A missing `trash` binary leaves
    everything in place and is reported by the caller, because silently falling
    back to permanent removal would destroy recoverable snapshots.
    """
    targets = [path for path in paths if path.exists() or path.is_symlink()]
    if not targets:
        return []
    if not shutil.which("trash"):
        return None
    subprocess.run(["trash", *[str(path) for path in targets]], check=True)
    return targets


def update_commands():
    """The update and check commands as this project actually invokes them.

    The report has to quote something the reader can paste. A script runner is
    used only when the project declares the entry, and the launcher is the
    fallback for repositories without Node. Package managers are not equivalent
    here: npm and yarn need `--` before a flag reaches the script, while pnpm
    passes it straight through and would receive a literal `--`.
    """
    launcher = "sh scripts/graphify-run.sh --update-code"
    manifest = ROOT / "package.json"
    if not manifest.is_file():
        return launcher, launcher + " --check"
    try:
        scripts = read_json(manifest).get("scripts", {})
    except (ValueError, OSError):
        return launcher, launcher + " --check"
    if "graph:update" not in scripts:
        return launcher, launcher + " --check"
    if (ROOT / "pnpm-lock.yaml").is_file():
        return "pnpm graph:update", "pnpm graph:update --check"
    if (ROOT / "yarn.lock").is_file():
        return "yarn graph:update", "yarn graph:update -- --check"
    return "npm run graph:update", "npm run graph:update -- --check"


def prune_snapshots(keep=KEEP_SNAPSHOTS):
    """Trash old run snapshots and leftover export contexts.

    The snapshot `current` points at is always preserved, as are the most
    recent `keep` runs. Export contexts hold only a symlink used while
    rendering, so any left behind are removed once their run is gone.
    """
    out = ROOT / "graphify-out"
    runs = out / "runs"
    if not runs.is_dir():
        return {"trashed_snapshots": 0, "trashed_export_contexts": 0}
    current = out / "current"
    active = current.resolve() if current.is_symlink() else None
    snapshots = sorted(
        (path for path in runs.iterdir() if path.is_dir()),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    retained, expired = [], []
    for path in snapshots:
        if path.resolve() == active or len(retained) < keep:
            retained.append(path)
        else:
            expired.append(path)
    retained_names = {path.name for path in retained}
    contexts = [
        path
        for path in out.glob("export-context-*")
        if path.name[len("export-context-"):] not in retained_names
    ]
    handled = discard([*expired, *contexts])
    if handled is None:
        print("trash não encontrado; snapshots antigos preservados", flush=True)
        return {"trashed_snapshots": 0, "trashed_export_contexts": 0, "prune_skipped": "trash_missing"}
    return {"trashed_snapshots": len(expired), "trashed_export_contexts": len(contexts)}


def prune_backups(keep=KEEP_SNAPSHOTS, root=Path("/tmp/claude-backups")):
    """Trash publication backups older than the most recent `keep`.

    `publish` copies the replaced artifacts to /tmp/claude-backups before moving
    the pointer. Those copies are the rollback path for the runs still on disk,
    so the retention matches the snapshot retention.

    Setup backups written as `graphify-setup-*` get their own bucket, so a burst
    of publications cannot evict them. Backups from unrelated tasks use other
    names and are never touched here.
    """
    if not root.is_dir():
        return {"trashed_backups": 0}
    buckets = {"runs": [], "setup": []}
    for path in root.glob("graphify-*"):
        if path.is_dir():
            buckets["setup" if path.name.startswith("graphify-setup-") else "runs"].append(path)
    expired = []
    for paths in buckets.values():
        paths.sort(key=lambda path: path.stat().st_mtime, reverse=True)
        expired.extend(paths[keep:])
    handled = discard(expired)
    return {"trashed_backups": 0 if handled is None else len(expired)}


def sensitive(path):
    value = Path(path)
    return (
        value.suffix.lower() in PRIVATE_SUFFIXES
        or value.name in PRIVATE_NAMES
        or value.name.startswith(".env")
        or value.match("service_account*.json")
        or any(str(value).endswith(item) for item in (".ssh/config", ".aws/credentials", ".kube/config"))
    )


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def head_commit():
    result = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--verify", "--quiet", "HEAD"], capture_output=True, text=True, check=False)
    if result.returncode == 1:
        return None
    result.check_returncode()
    return result.stdout.strip()


def units():
    config = read_json(ROOT / ".graphify.json")
    configured = config.get("units")
    if not isinstance(configured, dict) or configured.get("rootmeta") != ".":
        raise ValueError(".graphify.json must define units with rootmeta set to .")
    result = {}
    for tag, directory in configured.items():
        if not isinstance(tag, str) or not tag or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789_-" for character in tag):
            raise ValueError("Unit names must use lowercase ASCII letters, digits, underscores or hyphens")
        if not isinstance(directory, str) or not directory or Path(directory).is_absolute() or ".." in Path(directory).parts:
            raise ValueError(f"Invalid unit directory: {tag}")
        path = ROOT / directory
        resolved = path.resolve()
        if not path.is_dir() or not resolved.is_relative_to(ROOT) or any(part.is_symlink() for part in (path, *path.parents) if part != ROOT and part.is_relative_to(ROOT)):
            raise ValueError(f"Unit directory must exist inside this checkout without symlinks: {tag}")
        relative = resolved.relative_to(ROOT).as_posix()
        if relative in result.values():
            raise ValueError("Duplicate unit directory")
        result[tag] = relative
    return result


def owner(path, mapping):
    for tag, directory in sorted(mapping.items(), key=lambda item: -len(item[1])):
        if directory != "." and path.startswith(directory + "/"):
            return tag
    return "rootmeta"


def inventory(mapping):
    paths = sorted(set(git("ls-files", "--cached", "--others", "--exclude-standard", "-z").decode().split("\0")) - {""})
    return {
        path: {"unit": owner(path, mapping), "status": "excluded_sensitive" if sensitive(path) else "inventory_only"}
        for path in paths if "graphify-out" not in Path(path).parts
    }


def resolve_source(value, directory):
    if not isinstance(value, str) or not value:
        return None
    path = Path(value)
    rooted = directory == "." or path.is_relative_to(Path(directory))
    candidates = [path] if path.is_absolute() else [ROOT / path if rooted else ROOT / directory / path]
    for candidate in candidates:
        if not candidate.is_relative_to(ROOT) or sensitive(candidate):
            continue
        if any(part.is_symlink() for part in (candidate, *candidate.parents) if part != ROOT and part.is_relative_to(ROOT)):
            continue
        resolved = candidate.resolve()
        if resolved.is_relative_to(ROOT) and resolved.is_file():
            relative = resolved.relative_to(ROOT).as_posix()
            if not sensitive(relative):
                return relative
    return None


def edges(data):
    return data.get("edges", data.get("links", []))


def recover_unit(tag, directory, consolidated):
    local = ROOT / directory / "graphify-out" / "graph.json"
    if directory != "." and local.exists():
        return read_json(local), local
    if tag == "rootmeta" and all(not node.get("repo") for node in consolidated["nodes"]):
        return {**copy.deepcopy(consolidated), "edges": copy.deepcopy(edges(consolidated))}, None
    prefixes = {tag}
    if tag == "skills":
        prefixes.update(("skills-sem", "skills-sem-retry"))
    nodes = [copy.deepcopy(node) for node in consolidated["nodes"] if node.get("repo") in prefixes]
    ids = {node["id"]: node.get("local_id", node["id"].split("::", 1)[-1]) for node in nodes}
    for node in nodes:
        node["id"] = ids[node["id"]]
    links = []
    for edge in edges(consolidated):
        if edge.get("source") in ids and edge.get("target") in ids:
            links.append({**edge, "source": ids[edge["source"]], "target": ids[edge["target"]]})
    hyperedges = []
    for edge in consolidated.get("hyperedges", []):
        if all(member in ids for member in edge.get("nodes", [])):
            hyperedges.append({**edge, "nodes": [ids[member] for member in edge.get("nodes", [])]})
    return {"nodes": nodes, "edges": links, "hyperedges": hyperedges}, None


def extract_unit(job):
    from graphify.extract import extract

    tag, directory, files, cache = job
    result = extract([ROOT / path for path in files], root=ROOT / directory, cache_root=Path(cache), parallel=False)
    return tag, result


def mark_root_sources(data):
    for item in [*data["nodes"], *edges(data), *data.get("hyperedges", [])]:
        if item.get("source_file"):
            item["source_base"] = "root"
    return data


def replace_ast(previous, fresh):
    nodes = [node for node in previous["nodes"] if node.get("_origin") != "ast"]
    links = [edge for edge in edges(previous) if edge.get("_origin") != "ast"]
    by_id = {node["id"]: node for node in nodes}
    by_id.update({node["id"]: node for node in fresh["nodes"]})
    removed_links = [edge for edge in links if edge["source"] not in by_id or edge["target"] not in by_id]
    hyperedges = previous.get("hyperedges", [])
    removed_hyperedges = [edge for edge in hyperedges if any(member not in by_id for member in edge.get("nodes", []))]
    return {
        "nodes": list(by_id.values()),
        "edges": [edge for edge in links if edge["source"] in by_id and edge["target"] in by_id] + edges(fresh),
        "hyperedges": [edge for edge in hyperedges if all(member in by_id for member in edge.get("nodes", []))],
        "update_issues": [{"reason": "obsolete_ast_endpoint", "edge": edge} for edge in removed_links + removed_hyperedges],
    }


def normalize_unit(tag, directory, data, records):
    result = copy.deepcopy(data)
    issues = list(result.pop("update_issues", []))
    identifiers = {node["id"] for node in result["nodes"]}
    for edge in edges(result):
        for endpoint in (edge["source"], edge["target"]):
            if endpoint not in identifiers:
                result["nodes"].append({"id": endpoint, "label": endpoint, "verification": "unverified", "reference_only": True})
                identifiers.add(endpoint)
                issues.append({"kind": "node", "id": endpoint, "reason": "unresolved_endpoint_reference"})
    for kind, items in (("node", result["nodes"]), ("edge", edges(result)), ("hyperedge", result.get("hyperedges", []))):
        for item in items:
            raw = item.get("source_file") or item.get("original_source_file")
            resolved = resolve_source(raw, "." if item.get("source_base") == "root" else directory)
            if resolved:
                item["source_file"] = resolved
                item["source_base"] = "root"
                if kind == "node" and resolved in records:
                    records[resolved]["status"] = "represented"
            elif raw:
                item["original_source_file"] = raw
                item.pop("source_file", None)
                issues.append({"kind": kind, "id": item.get("id"), "source": raw, "reason": "unresolved_source"})
            if kind == "node" and not item.get("label"):
                issues.append({"kind": kind, "id": item.get("id"), "reason": "missing_label"})
            if kind == "edge" and not item.get("confidence"):
                issues.append({"kind": kind, "source": item.get("source"), "target": item.get("target"), "reason": "missing_confidence"})
    return result, [{**issue, "unit": tag} for issue in issues]


def fingerprint(path):
    return hashlib.md5(path.read_bytes(), usedforsecurity=False).hexdigest()


def select_unit(tag, directory, state, consolidated):
    local = ROOT / directory / "graphify-out/graph.json"
    input_hash = fingerprint(local) if directory != "." and local.is_file() else None
    cached = state.get("units", {}).get(tag)
    if cached and (ROOT / cached).is_file() and input_hash == state.get("input_hashes", {}).get(tag):
        return mark_root_sources(read_json(ROOT / cached)), None, input_hash
    graph, source = recover_unit(tag, directory, consolidated)
    return graph, source, input_hash


def file_type(path):
    from graphify.detect import classify_file

    # O classificador oficial inclui shebangs, manifests e formatos compostos.
    return classify_file(ROOT / path)


def classify_inventory(records):
    for path, record in records.items():
        if record["status"] != "inventory_only":
            continue
        if record.get("reason") == "no_semantic_entities" and record.get("freshness") == "verified":
            continue
        kind = file_type(path)
        record["reason"] = {
            "code": "no_extracted_symbols",
            "document": "pending_semantic_extraction",
            "paper": "pending_semantic_extraction",
            "image": "pending_semantic_extraction",
            "video": "pending_transcription",
        }.get(kind, "unsupported_format")


def coverage_gaps(records):
    pending, unrepresented = [], []
    # Fonte verificada cujo conteúdo não rende entidade fica em campo próprio:
    # segue visível no relatório sem impedir `coverage_complete` de fechar. Sem
    # isso, um único lockfile gerado trava a métrica para sempre.
    no_entities = []
    for path, record in records.items():
        if record["status"].startswith("excluded_"):
            continue
        empty = (record.get("reason") == "no_semantic_entities"
                 and record.get("freshness") == "verified")
        if record["status"] != "represented":
            (no_entities if empty else unrepresented).append(path)
        if (record.get("reason") in {"pending_semantic_extraction", "pending_transcription"}
                or record["status"] == "pending_semantic_verification"
                or record.get("freshness") == "changed"):
            pending.append(path)
    return {"pending_extraction": sorted(pending),
            "unrepresented_files": sorted(unrepresented),
            "no_entity_files": sorted(no_entities),
            "coverage_complete": not pending and not unrepresented}


def assess_freshness(records, sources, mapping, previous_state):

    manifests = {}
    for tag, source in sources.items():
        manifest = source.parent / "manifest.json" if source else None
        manifests[tag] = read_json(manifest) if manifest and manifest.exists() else {}
    for path, record in records.items():
        file = ROOT / path
        if record["status"] == "excluded_sensitive":
            continue
        if file.is_symlink() or not file.is_file() or not file.resolve().is_relative_to(ROOT):
            record["status"] = "excluded_symlink_or_missing"
            continue
        if record["status"] != "represented":
            continue
        digest = fingerprint(file)
        record["hash"] = digest
        tag = record["unit"]
        relative = Path(path).relative_to(mapping[tag]).as_posix() if mapping[tag] != "." else path
        entry = manifests[tag].get(relative, {})
        previous = previous_state.get(path, {})
        code = file_type(path) == "code"
        expected = entry.get("ast_hash" if code else "semantic_hash")
        if not expected:
            expected = previous.get("expected_hash") or (previous.get("hash") if previous.get("freshness") == "verified" else None)
        record["expected_hash"] = expected
        record["freshness"] = "verified" if expected == digest else "changed" if expected else "unknown"
        if not code and record["freshness"] != "verified":
            record["status"] = "pending_semantic_verification"


def check_graph(data, check_sources=True):
    nodes = data["nodes"]
    identifiers = {node["id"] for node in nodes}
    if len(identifiers) != len(nodes):
        raise ValueError("Duplicate node IDs")
    links = edges(data)
    if not all(edge["source"] in identifiers and edge["target"] in identifiers for edge in links):
        raise ValueError("Dangling edge")
    if not all(member in identifiers for edge in data.get("hyperedges", []) for member in edge.get("nodes", [])):
        raise ValueError("Dangling hyperedge")
    invalid_sources = [node["source_file"] for node in nodes if node.get("source_file") and not resolve_source(node["source_file"], ".")]
    if check_sources and invalid_sources:
        raise ValueError(f"Unresolved sources: {invalid_sources[:3]}")
    return {
        "nodes": len(nodes), "edges": len(links),
        "self_loops": sum(edge["source"] == edge["target"] for edge in links),
        "missing_labels": sum(not node.get("label") for node in nodes),
        "missing_sources": sum(not node.get("source_file") for node in nodes),
        "missing_confidence": sum(not edge.get("confidence") for edge in links),
        "unverified_nodes": sum(node.get("verification") == "unverified" for node in nodes),
    }


def source_snapshot(records):
    result = {}
    for path, record in records.items():
        resolved = None if record["status"] == "excluded_sensitive" else resolve_source(path, ".")
        digest = fingerprint(ROOT / path) if resolved == path else None
        result[path] = digest
        record["observed_hash"] = digest
    return result


def snapshot_changes(previous, current):
    return {
        "added": sorted(path for path, digest in current.items() if digest is not None and previous.get(path) is None),
        "removed": sorted(path for path, digest in previous.items() if digest is not None and current.get(path) is None),
        "changed": sorted(path for path in previous.keys() & current.keys() if previous[path] is not None and current[path] is not None and previous[path] != current[path]),
    }


def code_snapshots(records, snapshot, mapping):
    code = {path: digest for path, digest in snapshot.items() if digest is not None and file_type(path) == "code"}
    return {tag: {path: digest for path, digest in code.items() if records[path]["unit"] == tag} for tag in mapping}


def units_to_update(mapping, state, code, engine, input_hashes):
    context_changed = state.get("code_engine") != engine or state.get("code_snapshot", {}).get("rootmeta") != code.get("rootmeta")
    return [tag for tag in mapping if context_changed or state.get("code_snapshot", {}).get(tag) != code[tag] or state.get("input_hashes", {}).get(tag) != input_hashes[tag]]


def active_output():
    out = ROOT / "graphify-out"
    current = out / "current"
    return current.resolve(strict=True) if current.is_symlink() else out


def check_current():
    try:
        out = active_output()
    except FileNotFoundError:
        print(json.dumps({"up_to_date": False, "missing_artifacts": ["current"]}))
        return 2
    missing = [name for name in ARTIFACTS if not (out / name).is_file()]
    if missing:
        print(json.dumps({"up_to_date": False, "missing_artifacts": missing}))
        return 2
    graph = read_json(out / "graph.json")
    state = read_json(out / "monorepo.json")
    mapping = units()
    records = inventory(mapping)
    current = source_snapshot(records)
    previous = state.get("source_snapshot")
    coverage = read_json(out / "coverage.json").get("files")
    if not isinstance(coverage, dict):
        print(json.dumps({"up_to_date": False, "invalid_artifacts": ["coverage.json"]}))
        return 2
    changes = snapshot_changes(previous if previous is not None else {path: row.get("observed_hash", row.get("hash")) for path, row in coverage.items()}, current)
    stale = sorted(path for path, row in coverage.items() if row.get("freshness") == "changed" and current.get(path) is not None)
    current_records = {path: {**coverage.get(path, {}), **record} for path, record in records.items() if current.get(path) is not None}
    for path, record in current_records.items():
        if path in coverage and not records[path]["status"].startswith("excluded_"):
            record.update(coverage[path])
        if path in changes["changed"]:
            record["freshness"] = "changed"
    classify_inventory(current_records)
    result = {**check_graph(graph, check_sources=False), **changes, **coverage_gaps(current_records), "baseline_complete": previous is not None}
    inputs = {tag: fingerprint(ROOT / directory / "graphify-out/graph.json") if directory != "." and (ROOT / directory / "graphify-out/graph.json").is_file() else None for tag, directory in mapping.items()}
    engine = {"graphify": version("graphifyy"), "script": fingerprint(Path(__file__))}
    result["inputs_changed"] = inputs != state.get("input_hashes")
    result["engine_changed"] = engine != state.get("engine")
    result["mapping_changed"] = mapping != state.get("mapping")
    result["missing_unit_snapshots"] = [path for path in state.get("units", {}).values() if not (ROOT / path).is_file()]
    result["up_to_date"] = previous is not None and not stale and not any(changes.values()) and not any(result[key] for key in ("inputs_changed", "engine_changed", "mapping_changed", "missing_unit_snapshots"))
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["up_to_date"] else 2


def publish(stage):
    out = ROOT / "graphify-out"
    for name in ARTIFACTS:
        if not (stage / name).is_file():
            raise ValueError(f"Incomplete snapshot: {name}")
    identifier = stage.name
    backup = Path("/tmp/claude-backups") / ("graphify-" + identifier)
    backup.mkdir(parents=True)
    current = out / "current"
    if not current.is_symlink():
        legacy = out / "runs" / ("legacy-" + identifier)
        legacy.mkdir(parents=True)
        for name in ARTIFACTS:
            if (out / name).is_file():
                shutil.copy2(out / name, legacy / name)
        current.symlink_to(legacy.relative_to(out), target_is_directory=True)
    for name in ARTIFACTS:
        target = out / name
        if target.is_symlink() and os.readlink(target) == f"current/{name}":
            continue
        if target.exists():
            shutil.copy2(target, backup / name)
        temporary = out / (name + "." + identifier)
        temporary.symlink_to(f"current/{name}")
        os.replace(temporary, target)
    (backup / "previous-current.txt").write_text(os.readlink(current), encoding="utf-8")
    temporary = out / ("current." + identifier)
    temporary.symlink_to(stage.relative_to(out), target_is_directory=True)
    os.replace(temporary, current)
    return backup


def render(stage, records, problems, provenance):
    import networkx as nx
    from graphify.analyze import god_nodes, suggest_questions, surprising_connections
    from graphify.cluster import cluster, label_communities_by_hub, score_all

    data = read_json(stage / "merged.json")
    summary = check_graph(data)
    graph = nx.node_link_graph(data, edges="links")
    communities = cluster(graph)
    labels = label_communities_by_hub(graph, communities)
    analysis = {
        "communities": communities,
        "cohesion": score_all(graph, communities),
        "gods": god_nodes(graph),
        "surprises": surprising_connections(graph, communities),
        "questions": suggest_questions(graph, communities, labels),
    }
    membership = {node: identifier for identifier, members in communities.items() for node in members}
    for node in data["nodes"]:
        node["community"] = membership[node["id"]]
        node["community_name"] = labels[node["community"]]
    data["graph"]["monorepo"] = provenance
    write_json(stage / "graph.json", data)
    write_json(stage / ".graphify_labels.json", labels)
    write_json(stage / ".graphify_analysis.json", analysis)
    write_json(stage / "coverage.json", {"summary": dict(Counter(row["status"] for row in records.values())), "files": records})
    write_json(stage / "diagnostics.json", {**summary, "issues": problems})
    write_json(stage / "monorepo.json", provenance)
    update, check = update_commands()
    report = ["# Grafo do projeto", "", f"{summary['nodes']} nós, {summary['edges']} relações, {len(communities)} comunidades.", "", "## Atualização", "", f"Atualizar código e consolidar: `{update}`", "", f"Conferir sem escrever: `{check}`", "", "Não use `graphify update .` no consolidado: os IDs e manifestos pertencem às unidades.", "", "## Cobertura", "", "Inventário inclui arquivos rastreados e locais não ignorados. Representação não prova extração completa.", ""]
    report.extend(f"- {status}: {count}" for status, count in Counter(row["status"] for row in records.values()).items())
    report.extend(["", "Motivos de arquivos somente inventariados:", ""])
    report.extend(f"- {reason}: {count}" for reason, count in Counter(row["reason"] for row in records.values() if row.get("reason")).items())
    report.extend(["", "Veja `coverage.json` para o estado de cada arquivo e `diagnostics.json` para as lacunas.", "", "## Qualidade", ""])
    report.extend(f"- {key}: {value}" for key, value in summary.items())
    report.extend(["", "Relações inferidas, autorrelações e referências sem fonte permanecem identificadas; não são prova de defeito no produto.", "", "## Nós mais conectados", ""])
    report.extend(f"- `{graph.nodes[node].get('label', node)}`: {degree}" for node, degree in sorted(graph.degree, key=lambda pair: (-pair[1], pair[0]))[:10])
    report.extend(["", "## Coesão das maiores comunidades", ""])
    report.extend(f"- {labels[key]}: {analysis['cohesion'][key]}" for key in list(communities)[:10])
    report.extend(["", "As pontuações de todas as comunidades estão em `.graphify_analysis.json`."])
    report.extend(["", "## Proveniência", "", "A consolidação não executa LLM. Contadores históricos de custo não representam um total auditado desta base.", "", "Cada unidade tem snapshot próprio e hashes em coverage.json. O HEAD de consolidação não certifica a atualidade das entradas."])
    (stage / "GRAPH_REPORT.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    export_cwd = stage.parent.parent / ("export-context-" + stage.name)
    export_cwd.mkdir()
    (export_cwd / "graphify-out").symlink_to(stage, target_is_directory=True)
    subprocess.run([sys.executable, "-B", "-m", "graphify", "export", "html", "--graph", str(stage / "graph.json"), "--labels", str(stage / ".graphify_labels.json")], cwd=export_cwd, check=True)
    subprocess.run([sys.executable, "-B", "-m", "graphify", "tree", "--graph", str(stage / "graph.json"), "--output", str(stage / "GRAPH_TREE.html"), "--root", ".", "--label", ROOT.name], cwd=export_cwd, check=True)
    # The context only carries a symlink used while rendering. Removing it here
    # keeps one directory per run from piling up next to the snapshots.
    discard([export_cwd / "graphify-out", export_cwd])
    return summary


def read_semantic_input(path, records, snapshot):
    """Valida um lote explícito; hashes são capturados antes da extração."""
    data = read_json(path)
    if data.get("schema_version") != 1 or not isinstance(data.get("files"), dict):
        raise ValueError("Entrada semântica exige schema_version=1 e files")
    for source, entry in data["files"].items():
        if (source not in records or snapshot.get(source) is None
                or resolve_source(source, ".") != source):
            raise ValueError(f"Fonte semântica fora do inventário seguro: {source}")
        if entry.get("hash") != snapshot[source]:
            raise ValueError(f"Fonte semântica mudou durante a extração: {source}")
        if not isinstance(entry.get("nodes"), list) or not isinstance(entry.get("edges"), list):
            raise TypeError(f"Extração semântica incompleta: {source}")
        for items in (entry["nodes"], entry["edges"], entry.get("hyperedges", [])):
            if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
                raise ValueError(f"Elementos semânticos inválidos: {source}")
            for item in items:
                if item.get("source_file", source) != source:
                    raise ValueError(f"Proveniência semântica divergente: {source}")
    return data["files"]


def apply_semantic(baseline, entries, previous_hashes, snapshot, mapping):
    """Substitui fontes do lote e remove fontes gerenciadas que desapareceram."""
    removed = {source for source in previous_hashes if snapshot.get(source) is None}
    replaced = set(entries) | removed
    for tag, graph in baseline.items():
        def retained(item, directory=mapping[tag]):
            source = item.get("source_file") or item.get("original_source_file")
            if (source and item.get("source_base") != "root" and directory != "."
                    and not source.startswith(directory + "/")):
                source = directory + "/" + source
            return item.get("_origin") == "ast" or source not in replaced

        old_ids = {item["id"] for item in graph["nodes"]}
        graph["nodes"] = [item for item in graph["nodes"] if retained(item)]
        graph["edges"] = [item for item in edges(graph) if retained(item)]
        graph["hyperedges"] = [item for item in graph.get("hyperedges", []) if retained(item)]
        graph.pop("links", None)
        for source, entry in entries.items():
            if owner(source, mapping) != tag:
                continue
            for key in ("nodes", "edges", "hyperedges"):
                graph[key].extend({**item, "source_file": source, "source_base": "root",
                                   "_origin": "semantic"} for item in entry.get(key, []))
        ids = {node["id"] for node in graph["nodes"]}
        if len(ids) != len(graph["nodes"]):
            raise ValueError("IDs semânticos duplicados ou em conflito com AST")
        for source, entry in entries.items():
            if owner(source, mapping) != tag:
                continue
            if any(item["source"] not in ids or item["target"] not in ids for item in entry["edges"]):
                raise ValueError(f"Relação semântica sem endpoint: {source}")
            if any(node not in ids for item in entry.get("hyperedges", []) for node in item.get("nodes", [])):
                raise ValueError(f"Hyperedge semântico sem endpoint: {source}")
        removed_ids = old_ids - ids
        # Preserva referências AST externas, mas remove relações com nós apagados.
        graph["edges"] = [item for item in graph["edges"]
                          if item["source"] not in removed_ids and item["target"] not in removed_ids]
        graph["hyperedges"] = [item for item in graph["hyperedges"]
                               if not removed_ids.intersection(item.get("nodes", []))]
    return {**{source: digest for source, digest in previous_hashes.items() if source not in removed},
            **{source: entry["hash"] for source, entry in entries.items()}}


def run(update_code, workers, semantic_input=None):
    out = ROOT / "graphify-out"
    if out.is_symlink():
        raise ValueError("Shared graphify-out symlinks are not supported")
    if os.environ.get("GRAPHIFY_OUT", "graphify-out") != "graphify-out":
        raise ValueError("This updater requires a local graphify-out directory")
    active = active_output()
    mapping = units()
    records = inventory(mapping)
    state = read_json(active / "monorepo.json") if (active / "monorepo.json").exists() else {}
    snapshot = source_snapshot(records)
    semantic_entries = read_semantic_input(semantic_input, records, snapshot) if semantic_input else {}
    semantic_hashes = state.get("semantic_hashes", {})
    code = code_snapshots(records, snapshot, mapping)
    engine = {"graphify": version("graphifyy"), "script": fingerprint(Path(__file__))}
    input_hashes = {tag: fingerprint(ROOT / directory / "graphify-out/graph.json") if directory != "." and (ROOT / directory / "graphify-out/graph.json").is_file() else None for tag, directory in mapping.items()}
    changed_units = units_to_update(mapping, state, code, engine, input_hashes) if update_code else []
    if semantic_input is None and state.get("source_snapshot") == snapshot and state.get("input_hashes") == input_hashes and state.get("engine") == engine and state.get("mapping") == mapping and not changed_units and all((active / name).is_file() for name in ARTIFACTS) and all((ROOT / path).is_file() for path in state.get("units", {}).values()):
        print(json.dumps({"status": "unchanged", "updated_units": [], "run": state["run"]}, ensure_ascii=False))
        return
    consolidated = read_json(active / "graph.json") if (active / "graph.json").exists() else {"nodes": [], "links": []}
    previous_records = read_json(active / "coverage.json").get("files", {}) if (active / "coverage.json").exists() else {}
    identifier = uuid.uuid4().hex
    stage = out / "runs" / identifier
    stage.mkdir(parents=True)
    baseline, sources = {}, {}
    for tag, directory in mapping.items():
        baseline[tag], sources[tag], input_hashes[tag] = select_unit(tag, directory, state, consolidated)
    updated_hashes = {}
    if changed_units:
        jobs = []
        for tag in changed_units:
            directory = mapping[tag]
            files = list(code[tag])
            updated_hashes.update(code[tag])
            if files:
                jobs.append((tag, directory, files, str(stage / "cache-units" / tag)))
            else:
                baseline[tag] = replace_ast(baseline[tag], {"nodes": [], "edges": []})
        with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as pool:
            for tag, fresh in pool.map(extract_unit, jobs):
                if fresh.get("failed_sources"):
                    raise RuntimeError(f"AST extraction failed for unit {tag}: {len(fresh['failed_sources'])} sources; current graph preserved")
                baseline[tag] = replace_ast(baseline[tag], fresh)
                print(f"AST {tag}: {len(fresh['nodes'])} nós", flush=True)
    if semantic_entries or semantic_hashes:
        semantic_hashes = apply_semantic(baseline, semantic_entries, semantic_hashes, snapshot, mapping)
    normalized, problems = {}, []
    for tag, directory in mapping.items():
        normalized[tag], issues = normalize_unit(tag, directory, baseline[tag], records)
        problems.extend(issues)
    assess_freshness(records, sources, mapping, previous_records)
    classify_inventory(records)
    if updated_hashes:
        for path, record in records.items():
            if path in updated_hashes:
                if fingerprint(ROOT / path) != updated_hashes[path]:
                    raise RuntimeError(f"Source changed during extraction: {path}; current graph preserved")
                if record["status"] == "represented":
                    record["hash"] = updated_hashes[path]
                    record["expected_hash"] = updated_hashes[path]
                    record["freshness"] = "verified"
    for source, digest in semantic_hashes.items():
        if source not in records or snapshot.get(source) is None:
            continue
        record = records[source]
        record["expected_hash"] = digest
        record["freshness"] = "verified" if snapshot[source] == digest else "changed"
        if record["freshness"] == "changed":
            record["status"] = "pending_semantic_verification"
        elif record["status"] == "pending_semantic_verification":
            record["status"] = "represented"
        elif record["status"] == "inventory_only":
            record["reason"] = "no_semantic_entities"
    graph_paths, saved_units = [], {}
    for tag in mapping:
        destination = stage / "units" / tag / "graphify-out" / "graph.json"
        write_json(destination, normalized[tag])
        graph_paths.append(str(destination))
        saved_units[tag] = destination.relative_to(ROOT).as_posix()
    if len(graph_paths) == 1:
        import networkx as nx
        from graphify.build import build_from_json

        graph = build_from_json(read_json(Path(graph_paths[0])), root=ROOT)
        write_json(stage / "merged.json", nx.node_link_data(graph, edges="links"))
    else:
        subprocess.run([sys.executable, "-B", "-m", "graphify", "merge-graphs", *graph_paths, "--out", str(stage / "merged.json")], check=True)
    provenance = {"run": identifier, "assembled_at": datetime.now(timezone.utc).isoformat(), "assembled_at_commit": head_commit(), "units": saved_units, "input_hashes": input_hashes, "update_code": update_code, "workers": workers, "source_snapshot": snapshot, "code_snapshot": code if update_code else state.get("code_snapshot", {}), "mapping": mapping, "engine": engine, "code_engine": engine if update_code else state.get("code_engine"), "updated_units": changed_units}
    provenance["semantic_hashes"] = semantic_hashes
    summary = render(stage, records, problems, provenance)
    if source_snapshot(inventory(mapping)) != snapshot:
        raise RuntimeError("Sources changed during build; current snapshot preserved")
    for tag, directory in mapping.items():
        local = ROOT / directory / "graphify-out/graph.json"
        digest = fingerprint(local) if directory != "." and local.is_file() else None
        if digest != input_hashes[tag]:
            raise RuntimeError(f"Unit input changed during build: {tag}; current snapshot preserved")
    backup = publish(stage)
    pruned = prune_snapshots()
    pruned.update(prune_backups())
    print(json.dumps({**summary, "backup": str(backup), "coverage": dict(Counter(row["status"] for row in records.values())), **pruned}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description="Consolida as unidades do projeto sem executar extração semântica.")
    parser.add_argument("--semantic-input", type=Path, help="Importa lote semântico explícito com fontes e hashes verificados")
    parser.add_argument("--update-code", action="store_true", help="Atualiza o AST por unidade antes de consolidar")
    parser.add_argument("--check", action="store_true", help="Valida a integridade do grafo publicado, sem alterações")
    parser.add_argument("--workers", type=int, default=2, help="Processos simultâneos de AST (padrão: 2)")
    parser.add_argument("--background", action="store_true", help="Agenda atualização em segundo plano para os hooks Git")
    parser.add_argument("--auto-worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.workers < 1:
        parser.error("--workers must be at least 1")
    if args.check:
        raise SystemExit(check_current())
    if args.semantic_input and (args.background or args.auto_worker):
        parser.error("--semantic-input só é permitido em execução manual")
    if args.background:
        launch_background(args.workers)
        return
    if args.auto_worker and skip_automatic_update():
        return
    if args.auto_worker:
        time.sleep(3)
    lock_path = Path(git("rev-parse", "--git-common-dir").decode().strip())
    if not lock_path.is_absolute():
        lock_path = ROOT / lock_path
    with (lock_path / "graphify-monorepo.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | (0 if args.auto_worker else fcntl.LOCK_NB))
        except BlockingIOError:
            raise SystemExit("graph:update já está em execução; aguarde e consulte graphify-out/auto-update.log") from None
        if args.semantic_input:
            run(args.update_code, args.workers, args.semantic_input)
        else:
            run(args.update_code, args.workers)
        if args.auto_worker:
            print("graph:update automático concluído", flush=True)


def skip_automatic_update():
    if os.environ.get("GRAPHIFY_SKIP_HOOK") == "1":
        return True
    git_dir, common_dir = git("rev-parse", "--git-dir", "--git-common-dir").decode().splitlines()
    if (ROOT / git_dir).resolve() != (ROOT / common_dir).resolve():
        print("graph:update automático ignorado em worktree secundário", flush=True)
        return True
    return False


def launch_background(workers):
    if skip_automatic_update():
        return
    out = ROOT / "graphify-out"
    out.mkdir(parents=True, exist_ok=True)
    if out.is_symlink():
        raise ValueError("Shared graphify-out symlinks are not supported")
    with (out / "auto-update.log").open("a", encoding="utf-8") as log:
        process = subprocess.Popen(
            [sys.executable, "-B", "-u", str(Path(__file__).resolve()), "--update-code", "--auto-worker", "--workers", str(workers)],
            cwd=ROOT,
            env={**os.environ, "PYTHONHASHSEED": "0"},
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            close_fds=True,
        )
    print(f"graph:update agendado (PID {process.pid}); log: {out / 'auto-update.log'}")


if __name__ == "__main__":
    main()
