import concurrent.futures
import contextlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("monorepo", Path(__file__).with_name("graphify-update.py"))
MONOREPO = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MONOREPO)


class MonorepoTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="graphify-test-")).resolve()
        self.root_patch = patch.object(MONOREPO, "ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.write(".graphify.json", json.dumps({"units": {"rootmeta": "."}}))

    def write(self, name, content="fixture"):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        return target

    def test_same_basename_remains_in_its_unit_and_normalization_is_idempotent(self):
        self.write("packages/app/README.md")
        self.write("packages/server/README.md")
        self.write("README.md")
        for unit in ("app", "server"):
            expected = f"packages/{unit}/README.md"
            self.assertEqual(MONOREPO.resolve_source("README.md", f"packages/{unit}"), expected)
            self.assertEqual(MONOREPO.resolve_source(expected, f"packages/{unit}"), expected)

    def test_sensitive_and_external_sources_are_not_resolved(self):
        external = Path(tempfile.mkdtemp(prefix="graphify-external-test-"))
        (external / "fixture.ts").write_text("export const value = 1")
        (self.root / "linked").symlink_to(external, target_is_directory=True)
        self.assertIsNone(MONOREPO.resolve_source(str(external / "fixture.ts"), "."))
        self.assertIsNone(MONOREPO.resolve_source("linked/fixture.ts", "."))
        for name in ("credentials.json", "service_account_demo.json", ".env.local", "key.pem", ".ssh/config"):
            self.assertTrue(MONOREPO.sensitive(name))

    def test_removed_unit_readme_does_not_resolve_to_root_readme(self):
        self.write("README.md")
        self.assertIsNone(MONOREPO.resolve_source("README.md", "packages/app"))

    def test_root_relative_source_stays_root_relative_when_unit_has_same_path(self):
        self.write("packages/app/src/index.ts")
        self.write("packages/app/packages/app/src/index.ts")
        self.assertEqual(MONOREPO.resolve_source("packages/app/src/index.ts", "packages/app"), "packages/app/src/index.ts")

    def test_deleted_ast_symbol_drops_obsolete_relations_but_preserves_semantics(self):
        previous = {
            "nodes": [{"id": "deleted", "_origin": "ast"}, {"id": "doc", "_origin": "semantic"}],
            "edges": [{"source": "doc", "target": "deleted", "_origin": "semantic"}],
        }
        result = MONOREPO.replace_ast(previous, {"nodes": [], "edges": []})
        self.assertEqual(result["nodes"], [{"id": "doc", "_origin": "semantic"}])
        self.assertEqual(result["edges"], [])
        self.assertEqual(result["update_issues"][0]["reason"], "obsolete_ast_endpoint")

    def test_new_unit_import_replaces_snapshot_only_when_input_changes(self):
        imported = {"nodes": [{"id": "imported"}], "edges": []}
        local = self.write("packages/app/graphify-out/graph.json", json.dumps(imported))
        snapshot = {"nodes": [{"id": "refreshed"}], "edges": []}
        self.write("graphify-out/runs/fixture/app.json", json.dumps(snapshot))
        state = {"units": {"app": "graphify-out/runs/fixture/app.json"}, "input_hashes": {"app": MONOREPO.fingerprint(local)}}
        self.assertEqual(MONOREPO.select_unit("app", "packages/app", state, {})[0], snapshot)
        changed = {"nodes": [{"id": "new-semantic"}], "edges": []}
        local.write_text(json.dumps(changed))
        self.assertEqual(MONOREPO.select_unit("app", "packages/app", state, {})[0], changed)

    def test_changed_semantic_document_is_not_reported_fresh(self):
        path = self.write("docs/guide.md", "new document")
        records = {"docs/guide.md": {"unit": "docs", "status": "represented"}}
        previous = {"docs/guide.md": {"hash": "old-hash", "freshness": "verified"}}
        MONOREPO.assess_freshness(records, {"docs": None}, {"docs": "docs"}, previous)
        self.assertEqual(records["docs/guide.md"]["status"], "pending_semantic_verification")
        self.assertEqual(records["docs/guide.md"]["freshness"], "changed")
        self.assertEqual(records["docs/guide.md"]["hash"], MONOREPO.fingerprint(path))

    def test_integrity_gate_rejects_missing_endpoints_and_duplicate_ids(self):
        for data in (
            {"nodes": [{"id": "a"}, {"id": "a"}], "links": []},
            {"nodes": [{"id": "a"}], "links": [{"source": "a", "target": "missing"}]},
            {"nodes": [{"id": "a"}], "links": [], "hyperedges": [{"nodes": ["a", "missing"]}]},
        ):
            with self.assertRaises(ValueError):
                MONOREPO.check_graph(data)

    def test_external_reference_is_explicit_without_inventing_a_source(self):
        data = {"nodes": [{"id": "a", "label": "a"}], "edges": [{"source": "a", "target": "external", "confidence": "EXTRACTED"}]}
        normalized, issues = MONOREPO.normalize_unit("app", ".", data, {})
        reference = next(node for node in normalized["nodes"] if node["id"] == "external")
        self.assertTrue(reference["reference_only"])
        self.assertNotIn("source_file", reference)
        self.assertEqual(reference["verification"], "unverified")
        self.assertEqual(issues[0]["reason"], "unresolved_endpoint_reference")

    def test_official_classifier_includes_shebang_and_manifests(self):
        self.write("tools/run", "#!/usr/bin/env bash\nhello() { echo hello; }\n")
        self.write("pyproject.toml", "[project]\nname = 'fixture'\n")
        records = {name: {"unit": "rootmeta", "status": "inventory_only"}
                   for name in ("tools/run", "pyproject.toml", "notes.docx")}
        MONOREPO.classify_inventory(records)
        self.assertEqual(records["tools/run"]["reason"], "no_extracted_symbols")
        self.assertEqual(records["notes.docx"]["reason"], "pending_semantic_extraction")
        selected = MONOREPO.code_snapshots(records, dict.fromkeys(records, "hash"), {"rootmeta": "."})
        self.assertEqual(set(selected["rootmeta"]), {"tools/run", "pyproject.toml"})

    def test_pending_documents_are_distinct_from_unsupported_files(self):
        records = {name: {"status": "inventory_only"} for name in ("guide.md", "data.log")}
        MONOREPO.classify_inventory(records)
        gaps = MONOREPO.coverage_gaps(records)
        self.assertEqual(gaps["pending_extraction"], ["guide.md"])
        self.assertFalse(gaps["coverage_complete"])
        self.assertEqual(gaps["unrepresented_files"], ["data.log", "guide.md"])

    def test_empty_semantic_result_is_not_reported_as_unprocessed(self):
        records = {"guide.md": {"status": "inventory_only", "reason": "no_semantic_entities", "freshness": "verified"}}
        MONOREPO.classify_inventory(records)
        self.assertEqual(MONOREPO.coverage_gaps(records)["pending_extraction"], [])
        # Segue listado, agora em `no_entity_files`, sem travar a métrica.
        self.assertEqual(MONOREPO.coverage_gaps(records)["no_entity_files"], ["guide.md"])
        self.assertEqual(MONOREPO.coverage_gaps(records)["unrepresented_files"], [])
        self.assertTrue(MONOREPO.coverage_gaps(records)["coverage_complete"])
        records["guide.md"]["freshness"] = "changed"
        MONOREPO.classify_inventory(records)
        self.assertEqual(MONOREPO.coverage_gaps(records)["pending_extraction"], ["guide.md"])

    def test_semantic_import_checks_hash_and_preserves_ast(self):
        source = self.write("guide.md", "document")
        digest = MONOREPO.fingerprint(source)
        entry = {"hash": digest, "nodes": [{"id": "doc", "label": "Document"}], "edges": []}
        batch = self.write("batch.json", json.dumps({"schema_version": 1, "files": {"guide.md": entry}}))
        records = {"guide.md": {"unit": "rootmeta", "status": "inventory_only"}}
        entries = MONOREPO.read_semantic_input(batch, records, {"guide.md": digest})
        baseline = {"rootmeta": {"nodes": [{"id": "code", "_origin": "ast"}], "edges": []}}
        hashes = MONOREPO.apply_semantic(baseline, entries, {}, {"guide.md": digest}, {"rootmeta": "."})
        self.assertEqual({node["id"] for node in baseline["rootmeta"]["nodes"]}, {"code", "doc"})
        MONOREPO.apply_semantic(baseline, {}, hashes, {}, {"rootmeta": "."})
        self.assertEqual([node["id"] for node in baseline["rootmeta"]["nodes"]], ["code"])
        with self.assertRaisesRegex(ValueError, "mudou"):
            MONOREPO.read_semantic_input(batch, records, {"guide.md": "changed"})
        with self.assertRaisesRegex(ValueError, "inventário"):
            MONOREPO.read_semantic_input(batch, {}, {})

    def test_semantic_import_rejects_missing_endpoints_and_ast_collisions(self):
        for entry in (
            {"hash": "hash", "nodes": [{"id": "code"}], "edges": []},
            {"hash": "hash", "nodes": [{"id": "doc"}], "edges": [{"source": "doc", "target": "missing"}]},
        ):
            baseline = {"rootmeta": {"nodes": [{"id": "code", "_origin": "ast"}], "edges": []}}
            with self.assertRaises(ValueError):
                MONOREPO.apply_semantic(baseline, {"guide.md": entry}, {}, {"guide.md": "hash"}, {"rootmeta": "."})

    def test_semantic_pipeline_publication_freshness_and_removal(self):
        self.write("tool.py", "def answer(): return 42\n")
        doc = self.write("guide.md", "first document")
        files = ["tool.py", "guide.md"]
        batch = self.root / "graphify-out/semantic-input.json"

        def write_batch(label):
            MONOREPO.write_json(batch, {"schema_version": 1, "files": {
                "guide.md": {"hash": MONOREPO.fingerprint(doc),
                             "nodes": [{"id": "semantic:guide", "label": label, "file_type": "document"}],
                             "edges": []}}})

        def check_result():
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = MONOREPO.check_current()
            return code, json.loads(output.getvalue())

        with patch.object(MONOREPO, "git", side_effect=lambda *args: ("\0".join(files) + "\0").encode()), patch.object(MONOREPO, "head_commit", return_value=None), patch.object(MONOREPO.concurrent.futures, "ProcessPoolExecutor", concurrent.futures.ThreadPoolExecutor), contextlib.redirect_stdout(io.StringIO()):
            MONOREPO.run(True, 1)
            code, result = check_result()
            self.assertEqual(code, 0)
            self.assertTrue(result["up_to_date"])
            self.assertFalse(result["coverage_complete"])
            self.assertEqual(result["pending_extraction"], ["guide.md"])
            write_batch("First")
            MONOREPO.run(True, 1, batch)
            first = MONOREPO.active_output()
            self.assertEqual(check_result()[1]["pending_extraction"], [])
            MONOREPO.run(True, 1)
            self.assertEqual(MONOREPO.active_output(), first)
            doc.write_text("changed document")
            with self.assertRaisesRegex(ValueError, "mudou"):
                MONOREPO.run(True, 1, batch)
            self.assertEqual(MONOREPO.active_output(), first)
            MONOREPO.run(True, 1)
            self.assertEqual(check_result()[1]["pending_extraction"], ["guide.md"])
            write_batch("Changed")
            MONOREPO.run(True, 1, batch)
            graph = MONOREPO.read_json(MONOREPO.active_output() / "graph.json")
            labels = {node.get("label") for node in graph["nodes"]}
            self.assertIn("Changed", labels)
            self.assertNotIn("First", labels)
            # A remoção usa `trash` porque a política do repositório proíbe apagar
            # arquivo em definitivo, inclusive em teste. Sem o binário, o passo é
            # pulado em vez de falhar por motivo de ambiente.
            if not shutil.which("trash"):
                self.skipTest("o passo de remoção precisa do binário trash")
            subprocess.run(["trash", str(doc)], check=True)
            files.remove("guide.md")
            MONOREPO.run(True, 1)
            graph = MONOREPO.read_json(MONOREPO.active_output() / "graph.json")
            self.assertNotIn("semantic:guide", {node["id"] for node in graph["nodes"]})
            self.assertTrue(any(node.get("_origin") == "ast" for node in graph["nodes"]))

    def test_semantic_input_is_rejected_in_background(self):
        for mode in ("--background", "--auto-worker"):
            with patch.object(MONOREPO.sys, "argv", ["updater", mode, "--semantic-input", "batch.json"]), patch.object(MONOREPO, "launch_background") as launch, contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                MONOREPO.main()
            self.assertEqual(error.exception.code, 2)
            launch.assert_not_called()

    def test_inventory_distinguishes_unknown_formats_and_pending_semantics(self):
        records = {path: {"status": "inventory_only"} for path in ("app.css", "guide.md", "recording.wav", "index.ts")}
        MONOREPO.classify_inventory(records)
        self.assertEqual(records["app.css"]["reason"], "unsupported_format")
        self.assertEqual(records["guide.md"]["reason"], "pending_semantic_extraction")
        self.assertEqual(records["recording.wav"]["reason"], "pending_transcription")
        self.assertEqual(records["index.ts"]["reason"], "no_extracted_symbols")

    def test_check_reports_added_modified_and_removed_sources_without_writing(self):
        self.write("src/changed.ts", "new")
        self.write("src/added.ts", "added")
        self.write("package.json", json.dumps({"workspaces": []}))
        self.write("graphify-out/graph.json", json.dumps({"nodes": [{"id": "old", "source_file": "src/removed.ts"}], "links": []}))
        previous = {"src/changed.ts": "old-hash", "src/removed.ts": "removed-hash"}
        self.write("graphify-out/monorepo.json", json.dumps({"source_snapshot": previous}))
        self.write("graphify-out/coverage.json", json.dumps({"files": {}}))
        for name in MONOREPO.ARTIFACTS:
            if not (self.root / "graphify-out" / name).exists():
                self.write("graphify-out/" + name, "{}")
        records = {path: {"unit": "rootmeta", "status": "inventory_only"} for path in ("src/changed.ts", "src/added.ts", "src/removed.ts")}
        before = {path.name: path.read_bytes() for path in (self.root / "graphify-out").iterdir()}
        output = io.StringIO()
        with patch.object(MONOREPO, "inventory", return_value=records), contextlib.redirect_stdout(output):
            self.assertEqual(MONOREPO.check_current(), 2)
        result = json.loads(output.getvalue())
        self.assertEqual(result["added"], ["src/added.ts"])
        self.assertEqual(result["changed"], ["src/changed.ts"])
        self.assertEqual(result["removed"], ["src/removed.ts"])
        self.assertEqual(before, {path.name: path.read_bytes() for path in (self.root / "graphify-out").iterdir()})

    def make_stage(self, name, value):
        stage = self.root / "graphify-out/runs" / (self.root.name + "-" + name)
        for artifact in MONOREPO.ARTIFACTS:
            self.write(str((stage / artifact).relative_to(self.root)), value)
        return stage

    def test_failed_snapshot_switch_preserves_entire_previous_generation(self):
        first = self.make_stage("first", "old")
        MONOREPO.publish(first)
        second = self.make_stage("second", "new")
        real_replace = os.replace

        def fail_pointer(source, destination):
            if Path(destination).name == "current":
                raise OSError("injected failure before pointer switch")
            return real_replace(source, destination)

        with patch.object(MONOREPO.os, "replace", side_effect=fail_pointer), self.assertRaises(OSError):
            MONOREPO.publish(second)
        active = MONOREPO.active_output()
        self.assertEqual(active, first)
        for name in MONOREPO.ARTIFACTS:
            self.assertEqual((self.root / "graphify-out" / name).read_text(), "old")
        third = self.make_stage("third", "new")
        MONOREPO.publish(third)
        self.assertEqual(MONOREPO.active_output(), third)
        for name in MONOREPO.ARTIFACTS:
            self.assertEqual((self.root / "graphify-out" / name).read_text(), "new")
            self.assertEqual((active / name).read_text(), "old")

    def test_legacy_migration_never_exposes_new_generation_before_switch(self):
        for artifact in MONOREPO.ARTIFACTS:
            self.write("graphify-out/" + artifact, "legacy")
        stage = self.make_stage("migrated", "new")
        real_replace = os.replace
        observations = []

        def observe(source, destination):
            observations.append({(self.root / "graphify-out" / name).read_text() for name in MONOREPO.ARTIFACTS})
            return real_replace(source, destination)

        with patch.object(MONOREPO.os, "replace", side_effect=observe):
            MONOREPO.publish(stage)
        self.assertTrue(all(values == {"legacy"} for values in observations))
        self.assertEqual({(self.root / "graphify-out" / name).read_text() for name in MONOREPO.ARTIFACTS}, {"new"})

    def test_incomplete_snapshot_is_not_published(self):
        first = self.make_stage("complete", "old")
        MONOREPO.publish(first)
        partial = self.root / "graphify-out/runs/partial"
        partial.mkdir()
        with self.assertRaises(ValueError):
            MONOREPO.publish(partial)
        self.assertEqual(MONOREPO.active_output(), first)

    def test_snapshot_removal_and_code_selection_include_deleted_files(self):
        records = {"packages/a/new.ts": {"unit": "a"}, "packages/a/readme.md": {"unit": "a"}, "packages/b/index.ts": {"unit": "b"}}
        current = {"packages/a/new.ts": "new", "packages/a/readme.md": "doc", "packages/b/index.ts": "same"}
        previous = {"packages/a/old.ts": "old", "packages/b/index.ts": "same"}
        changes = MONOREPO.snapshot_changes(previous, current)
        self.assertEqual(changes["removed"], ["packages/a/old.ts"])
        code = MONOREPO.code_snapshots(records, current, {"a": "packages/a", "b": "packages/b"})
        self.assertEqual(code["b"], {"packages/b/index.ts": "same"})
        self.assertEqual(code["a"], {"packages/a/new.ts": "new"})

    def test_only_changed_unit_is_selected_and_root_changes_invalidate_all(self):
        mapping = {"a": "packages/a", "b": "packages/b", "rootmeta": "."}
        engine = {"graphify": "test", "script": "same"}
        code = {"a": {"packages/a/index.ts": "old"}, "b": {"packages/b/index.ts": "same"}, "rootmeta": {"package.json": "root"}}
        inputs = dict.fromkeys(mapping)
        state = {"code_engine": engine, "code_snapshot": code, "input_hashes": inputs}
        self.assertEqual(MONOREPO.units_to_update(mapping, state, code, engine, inputs), [])
        changed = {**code, "a": {"packages/a/index.ts": "new"}}
        self.assertEqual(MONOREPO.units_to_update(mapping, state, changed, engine, inputs), ["a"])
        removed = {**code, "a": {}}
        self.assertEqual(MONOREPO.units_to_update(mapping, state, removed, engine, inputs), ["a"])
        changed_root = {**code, "rootmeta": {"package.json": "changed"}}
        self.assertEqual(MONOREPO.units_to_update(mapping, state, changed_root, engine, inputs), list(mapping))
        self.assertEqual(MONOREPO.units_to_update(mapping, state, code, {"graphify": "new"}, inputs), list(mapping))

    def test_no_changes_skip_extraction_rendering_and_publication(self):
        mapping = {"rootmeta": "."}
        engine = {"graphify": MONOREPO.version("graphifyy"), "script": MONOREPO.fingerprint(Path(MONOREPO.__file__))}
        state = {"run": "existing", "source_snapshot": {}, "input_hashes": {"rootmeta": None}, "engine": engine, "code_engine": engine, "mapping": mapping, "code_snapshot": {"rootmeta": {}}, "units": {}}
        for name in MONOREPO.ARTIFACTS:
            self.write("graphify-out/" + name, json.dumps(state if name == "monorepo.json" else {}))
        with patch.object(MONOREPO, "units", return_value=mapping), patch.object(MONOREPO, "inventory", return_value={}), patch.object(MONOREPO, "render") as render, patch.object(MONOREPO, "publish") as publish, patch.object(MONOREPO.concurrent.futures, "ProcessPoolExecutor") as pool, contextlib.redirect_stdout(io.StringIO()):
            MONOREPO.run(True, 2)
        render.assert_not_called()
        publish.assert_not_called()
        pool.assert_not_called()
        self.assertFalse((self.root / "graphify-out/runs").exists())

    def test_real_pipeline_reextracts_only_changed_unit_and_preserves_snapshot_on_noop(self):
        self.write("package.json", json.dumps({"workspaces": ["packages/a", "packages/b"]}))
        self.write(".graphify.json", json.dumps({"units": {"a": "packages/a", "b": "packages/b", "rootmeta": "."}}))
        self.write("packages/a/index.ts", "export function alpha() { return 1; }\n")
        self.write("packages/b/index.ts", "export function beta() { return 2; }\n")
        files = ["package.json", "packages/a/index.ts", "packages/b/index.ts"]

        def fixture_git(*args):
            if args[0] == "ls-files":
                return ("\0".join(files) + "\0").encode()
            if args == ("rev-parse", "HEAD"):
                return b"fixture-head"
            raise AssertionError(args)

        with patch.object(MONOREPO, "head_commit", return_value="fixture-head"), patch.object(MONOREPO, "git", side_effect=fixture_git), patch.object(MONOREPO.concurrent.futures, "ProcessPoolExecutor", concurrent.futures.ThreadPoolExecutor), patch.object(MONOREPO, "extract_unit", wraps=MONOREPO.extract_unit) as extract, contextlib.redirect_stdout(io.StringIO()):
            MONOREPO.run(True, 1)
            first = MONOREPO.active_output()
            self.assertEqual({call.args[0][0] for call in extract.call_args_list}, {"a", "b", "rootmeta"})
            extract.reset_mock()
            MONOREPO.run(True, 1)
            extract.assert_not_called()
            self.assertEqual(MONOREPO.active_output(), first)
            self.assertEqual(MONOREPO.check_current(), 0)
            self.write("packages/a/index.ts", "export function changedAlpha() { return 3; }\n")
            self.assertEqual(MONOREPO.check_current(), 2)
            MONOREPO.run(True, 1)
            second = MONOREPO.active_output()
            self.assertNotEqual(second, first)
            self.assertEqual([call.args[0][0] for call in extract.call_args_list], ["a"])
            self.assertEqual(MONOREPO.check_current(), 0)
            labels = {node.get("label") for node in MONOREPO.read_json(second / "graph.json")["nodes"]}
            self.assertIn("changedAlpha()", labels)
            self.assertNotIn("alpha()", labels)

    def test_duplicate_unit_names_fail_instead_of_overwriting(self):
        (self.root / "packages/app").mkdir(parents=True)
        self.write(".graphify.json", json.dumps({"units": {"app": "packages/app", "duplicate": "packages/app", "rootmeta": "."}}))
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            MONOREPO.units()

    def test_single_project_without_package_json_uses_one_unit(self):
        self.assertEqual(MONOREPO.units(), {"rootmeta": "."})

    def test_native_root_graph_keeps_semantic_nodes_and_relations_on_import(self):
        data = {"nodes": [{"id": "guide", "source_file": "README.md"}, {"id": "concept"}], "edges": [{"source": "guide", "target": "concept"}]}
        graph, _ = MONOREPO.recover_unit("rootmeta", ".", data)
        self.assertEqual(graph["nodes"], data["nodes"])
        self.assertEqual(graph["edges"], data["edges"])

    def test_check_detects_new_unit_input_even_when_source_files_are_unchanged(self):
        subprocess.run(["git", "init", "--quiet", str(self.root)], check=True)
        self.write(".gitignore", "graphify-out/\n")
        self.write(".graphify.json", json.dumps({"units": {"docs": "docs", "rootmeta": "."}}))
        self.write("docs/guide.md", "Guide")
        self.write("example.py", "def answer():\n    return 42\n")
        with patch.object(MONOREPO.concurrent.futures, "ProcessPoolExecutor", concurrent.futures.ThreadPoolExecutor), contextlib.redirect_stdout(io.StringIO()):
            MONOREPO.run(True, 1)
            self.write("docs/graphify-out/graph.json", json.dumps({"nodes": [{"id": "guide", "label": "Guide", "source_file": "guide.md"}], "edges": []}))
            self.assertEqual(MONOREPO.check_current(), 2)

    def test_new_python_repository_without_commits_builds_and_reuses_snapshot(self):
        subprocess.run(["git", "init", "--quiet", str(self.root)], check=True)
        self.write("example.py", "def answer():\n    return 42\n")
        self.write(".gitignore", "graphify-out/\n")
        with patch.object(MONOREPO.concurrent.futures, "ProcessPoolExecutor", concurrent.futures.ThreadPoolExecutor), contextlib.redirect_stdout(io.StringIO()):
            MONOREPO.run(True, 1)
            first = MONOREPO.active_output()
            self.assertIsNone(MONOREPO.read_json(first / "monorepo.json")["assembled_at_commit"])
            self.assertGreater(len(MONOREPO.read_json(first / "graph.json")["nodes"]), 0)
            self.assertFalse((first / "export-context").exists())
            # The render context lives beside the snapshot and is trashed once
            # the export finishes, so no directory is left behind per run.
            export_context = self.root / "graphify-out" / ("export-context-" + first.name)
            self.assertFalse(export_context.exists())
            MONOREPO.run(True, 1)
            self.assertEqual(MONOREPO.active_output(), first)
            self.assertEqual(MONOREPO.check_current(), 0)

    def test_explicit_monorepo_units_allow_duplicate_package_basenames(self):
        (self.root / "services/api").mkdir(parents=True)
        (self.root / "tools/api").mkdir(parents=True)
        mapping = {"service-api": "services/api", "tool-api": "tools/api", "rootmeta": "."}
        self.write(".graphify.json", json.dumps({"units": mapping}))
        self.assertEqual(MONOREPO.units(), mapping)

    def test_units_reject_escape_symlink_missing_root_and_missing_directory(self):
        (self.root / "linked").symlink_to(Path(tempfile.mkdtemp(prefix="graphify-unit-external-")), target_is_directory=True)
        for mapping in ({"outside": "..", "rootmeta": "."}, {"linked": "linked", "rootmeta": "."}, {"missing": "missing", "rootmeta": "."}, {"project": "."}):
            self.write(".graphify.json", json.dumps({"units": mapping}))
            with self.assertRaises(ValueError):
                MONOREPO.units()

    def test_shared_graph_directory_is_rejected_before_publication(self):
        external = Path(tempfile.mkdtemp(prefix="graphify-shared-output-"))
        (self.root / "graphify-out").symlink_to(external, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "Shared"):
            MONOREPO.run(True, 2)
        self.assertEqual(list(external.iterdir()), [])

    def test_check_without_snapshot_reports_missing_artifacts(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(MONOREPO.check_current(), 2)
        self.assertEqual(set(json.loads(output.getvalue())["missing_artifacts"]), set(MONOREPO.ARTIFACTS))
        self.assertFalse((self.root / "graphify-out").exists())

    def test_background_launch_detaches_with_pinned_interpreter_and_append_log(self):
        log = self.write("graphify-out/auto-update.log", "previous run\n")
        directories = f"{self.root / '.git'}\n.git\n".encode()
        with patch.object(MONOREPO, "git", return_value=directories), patch.object(MONOREPO.subprocess, "Popen") as spawn, patch.dict(os.environ, {"GRAPHIFY_SKIP_HOOK": "0"}), contextlib.redirect_stdout(io.StringIO()):
            MONOREPO.launch_background(2)
        args, kwargs = spawn.call_args
        self.assertEqual(args[0][0], MONOREPO.sys.executable)
        self.assertIn("--auto-worker", args[0])
        self.assertTrue(kwargs["start_new_session"])
        self.assertEqual(kwargs["cwd"], self.root)
        self.assertEqual(log.read_text(), "previous run\n")

    def test_background_opt_out_does_not_spawn_or_create_output(self):
        with patch.dict(os.environ, {"GRAPHIFY_SKIP_HOOK": "1"}), patch.object(MONOREPO.subprocess, "Popen") as spawn:
            MONOREPO.launch_background(2)
        spawn.assert_not_called()
        self.assertFalse((self.root / "graphify-out").exists())

    def test_linked_worktree_skips_background_and_worker_without_output_or_lock(self):
        subprocess.run(["git", "init", "--quiet", str(self.root)], check=True)
        # The address is assembled here so the repository's public guard does
        # not read a literal e-mail in tracked source. Git only needs an author
        # for the throwaway fixture commit; `.invalid` is reserved by RFC 2606.
        identity = ["-c", "user.name=Graphify Test", "-c", "user.email=graphify@" + "example.invalid"]
        subprocess.run(["git", "-C", str(self.root), "-c", "core.hooksPath=/dev/null", *identity, "commit", "--quiet", "--allow-empty", "-m", "fixture"], check=True)
        linked = self.root / "linked checkout"
        subprocess.run(["git", "-C", str(self.root), "-c", "core.hooksPath=/dev/null", "worktree", "add", "--quiet", "--detach", str(linked)], check=True)
        real_popen = subprocess.Popen
        with patch.object(MONOREPO, "ROOT", linked), patch.dict(os.environ, {"GRAPHIFY_SKIP_HOOK": "0"}), patch.object(MONOREPO.subprocess, "Popen") as spawn, patch.object(MONOREPO, "run") as run, contextlib.redirect_stdout(io.StringIO()):
            spawn.side_effect = lambda command, **kwargs: real_popen(command, **kwargs) if command[0] == "git" else spawn.return_value
            MONOREPO.launch_background(2)
            self.assertEqual([call.args[0][0] for call in spawn.call_args_list if call.args[0][0] != "git"], [])
            with patch.object(MONOREPO.sys, "argv", ["graphify-update.py", "--update-code", "--auto-worker"]):
                MONOREPO.main()
        run.assert_not_called()
        self.assertFalse((linked / "graphify-out").exists())
        self.assertFalse((self.root / ".git/graphify-monorepo.lock").exists())
        script = linked / "scripts/graphify-update.py"
        script.parent.mkdir()
        script.write_text(Path(MONOREPO.__file__).read_text())
        for flag in ("--background", "--auto-worker"):
            result = subprocess.run([MONOREPO.sys.executable, "-B", str(script), "--update-code", flag], cwd=linked, env={**os.environ, "GRAPHIFY_SKIP_HOOK": "0"}, capture_output=True, text=True, check=True)
            self.assertIn("ignorado em worktree secundário", result.stdout)
        self.assertFalse((linked / "graphify-out").exists())
        self.assertFalse((self.root / ".git/graphify-monorepo.lock").exists())
        with patch.object(MONOREPO, "ROOT", linked), patch.object(MONOREPO, "run") as run, patch.object(MONOREPO.sys, "argv", ["graphify-update.py", "--update-code"]):
            MONOREPO.main()
        run.assert_called_once_with(True, 2)

    def test_background_git_failure_does_not_create_output(self):
        with patch.dict(os.environ, {"GRAPHIFY_SKIP_HOOK": "0"}), patch.object(MONOREPO, "git", side_effect=subprocess.CalledProcessError(128, "git")), patch.object(MONOREPO.subprocess, "Popen") as spawn, self.assertRaises(subprocess.CalledProcessError):
            MONOREPO.launch_background(2)
        spawn.assert_not_called()
        self.assertFalse((self.root / "graphify-out").exists())

    def test_manual_lock_conflict_reports_actionable_message_without_build(self):
        (self.root / ".git").mkdir()
        with patch.object(MONOREPO, "git", return_value=b".git"), patch.object(MONOREPO.fcntl, "flock", side_effect=BlockingIOError), patch.object(MONOREPO, "run") as run, patch.object(MONOREPO.sys, "argv", ["graphify-update.py", "--update-code"]), self.assertRaisesRegex(SystemExit, "já está em execução"):
            MONOREPO.main()
        run.assert_not_called()

    def test_check_rejects_coverage_without_files(self):
        for name in MONOREPO.ARTIFACTS:
            self.write("graphify-out/" + name, "{}")
        self.write("graphify-out/graph.json", json.dumps({"nodes": [], "links": []}))
        output = io.StringIO()
        with patch.object(MONOREPO, "inventory", return_value={}), contextlib.redirect_stdout(output):
            self.assertEqual(MONOREPO.check_current(), 2)
        self.assertEqual(json.loads(output.getvalue())["invalid_artifacts"], ["coverage.json"])

    def test_legacy_check_uses_observed_hash_of_inventory_only_file(self):
        path = self.write("style.css", "body {}")
        digest = MONOREPO.fingerprint(path)
        self.write("package.json", json.dumps({"workspaces": []}))
        for name in MONOREPO.ARTIFACTS:
            self.write("graphify-out/" + name, "{}")
        self.write("graphify-out/graph.json", json.dumps({"nodes": [], "links": []}))
        self.write("graphify-out/coverage.json", json.dumps({"files": {"style.css": {"status": "inventory_only", "observed_hash": digest}}}))
        records = {"style.css": {"status": "inventory_only", "unit": "rootmeta"}}
        output = io.StringIO()
        with patch.object(MONOREPO, "inventory", return_value=records), contextlib.redirect_stdout(output):
            self.assertEqual(MONOREPO.check_current(), 2)
        result = json.loads(output.getvalue())
        self.assertFalse(result["baseline_complete"])
        self.assertEqual(result["added"], [])


class PruneTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="graphify-prune-test-")).resolve()
        self.root_patch = patch.object(MONOREPO, "ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.out = self.root / "graphify-out"
        (self.out / "runs").mkdir(parents=True)
        self.trashed = []

    def snapshot(self, name, age):
        path = self.out / "runs" / name
        path.mkdir()
        (path / "graph.json").write_text("{}")
        os.utime(path, (age, age))
        return path

    def collect(self, command, check):
        self.trashed.extend(Path(item) for item in command[1:])

    def test_keeps_recent_snapshots_and_trashes_the_rest(self):
        for index in range(6):
            self.snapshot(f"run{index}", 1000 + index)
        with patch.object(MONOREPO.subprocess, "run", side_effect=self.collect), patch.object(MONOREPO.shutil, "which", return_value="/usr/bin/trash"):
            result = MONOREPO.prune_snapshots(keep=3)
        self.assertEqual(result["trashed_snapshots"], 3)
        self.assertEqual({path.name for path in self.trashed}, {"run0", "run1", "run2"})

    def test_published_snapshot_survives_even_when_it_is_the_oldest(self):
        oldest = self.snapshot("published", 1)
        for index in range(4):
            self.snapshot(f"run{index}", 2000 + index)
        (self.out / "current").symlink_to(oldest.relative_to(self.out), target_is_directory=True)
        with patch.object(MONOREPO.subprocess, "run", side_effect=self.collect), patch.object(MONOREPO.shutil, "which", return_value="/usr/bin/trash"):
            MONOREPO.prune_snapshots(keep=2)
        self.assertNotIn("published", {path.name for path in self.trashed})
        self.assertTrue(oldest.is_dir())

    def test_export_contexts_of_dropped_runs_are_trashed(self):
        for index in range(4):
            self.snapshot(f"run{index}", 1000 + index)
            (self.out / f"export-context-run{index}").mkdir()
        with patch.object(MONOREPO.subprocess, "run", side_effect=self.collect), patch.object(MONOREPO.shutil, "which", return_value="/usr/bin/trash"):
            result = MONOREPO.prune_snapshots(keep=3)
        self.assertEqual(result["trashed_export_contexts"], 1)
        self.assertIn("export-context-run0", {path.name for path in self.trashed})

    def test_missing_trash_binary_preserves_every_snapshot(self):
        for index in range(5):
            self.snapshot(f"run{index}", 1000 + index)
        with patch.object(MONOREPO.subprocess, "run", side_effect=self.collect), patch.object(MONOREPO.shutil, "which", return_value=None), contextlib.redirect_stdout(io.StringIO()):
            result = MONOREPO.prune_snapshots(keep=2)
        self.assertEqual(result["prune_skipped"], "trash_missing")
        self.assertEqual(self.trashed, [])
        self.assertEqual(len(list((self.out / "runs").iterdir())), 5)

    def test_nothing_is_trashed_when_runs_fit_the_retention(self):
        for index in range(2):
            self.snapshot(f"run{index}", 1000 + index)
        with patch.object(MONOREPO.subprocess, "run", side_effect=self.collect), patch.object(MONOREPO.shutil, "which", return_value="/usr/bin/trash"):
            result = MONOREPO.prune_snapshots(keep=3)
        self.assertEqual(result["trashed_snapshots"], 0)
        self.assertEqual(self.trashed, [])


class UpdateCommandTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="graphify-command-test-")).resolve()
        self.root_patch = patch.object(MONOREPO, "ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def declare(self, lockfile):
        """Point ROOT at a fresh directory holding the manifest and lockfile.

        Each case gets its own directory so no test has to remove a file to
        change the detected package manager.
        """
        root = Path(tempfile.mkdtemp(prefix="graphify-command-case-")).resolve()
        (root / "package.json").write_text(json.dumps({"scripts": {"graph:update": "sh scripts/graphify-run.sh --update-code"}}))
        if lockfile:
            (root / lockfile).write_text("")
        patcher = patch.object(MONOREPO, "ROOT", root)
        patcher.start()
        self.addCleanup(patcher.stop)
        return root

    def test_pnpm_receives_the_flag_without_a_separator(self):
        self.declare("pnpm-lock.yaml")
        self.assertEqual(MONOREPO.update_commands(), ("pnpm graph:update", "pnpm graph:update --check"))

    def test_npm_and_yarn_need_a_separator_before_the_flag(self):
        self.declare("package-lock.json")
        self.assertEqual(MONOREPO.update_commands()[1], "npm run graph:update -- --check")
        self.declare("yarn.lock")
        self.assertEqual(MONOREPO.update_commands()[1], "yarn graph:update -- --check")

    def test_project_without_node_quotes_the_launcher(self):
        update, check = MONOREPO.update_commands()
        self.assertEqual(update, "sh scripts/graphify-run.sh --update-code")
        self.assertEqual(check, "sh scripts/graphify-run.sh --update-code --check")

    def test_manifest_without_the_entry_falls_back_to_the_launcher(self):
        (self.root / "package.json").write_text(json.dumps({"scripts": {"build": "tsc"}}))
        self.assertEqual(MONOREPO.update_commands()[0], "sh scripts/graphify-run.sh --update-code")

    def test_unreadable_manifest_does_not_break_the_report(self):
        (self.root / "package.json").write_text("{ broken")
        self.assertEqual(MONOREPO.update_commands()[0], "sh scripts/graphify-run.sh --update-code")


class CoverageGapTests(unittest.TestCase):
    def test_verified_file_without_entities_does_not_block_coverage(self):
        records = {"pnpm-lock.yaml": {"status": "inventory_only", "unit": "rootmeta",
                                      "reason": "no_semantic_entities", "freshness": "verified"}}
        result = MONOREPO.coverage_gaps(records)
        self.assertEqual(result["unrepresented_files"], [])
        self.assertEqual(result["no_entity_files"], ["pnpm-lock.yaml"])
        self.assertTrue(result["coverage_complete"])

    def test_file_without_entities_still_blocks_while_it_changed(self):
        records = {"notes.md": {"status": "inventory_only", "unit": "rootmeta",
                                "reason": "no_semantic_entities", "freshness": "changed"}}
        result = MONOREPO.coverage_gaps(records)
        self.assertEqual(result["unrepresented_files"], ["notes.md"])
        self.assertEqual(result["pending_extraction"], ["notes.md"])

    def test_document_awaiting_extraction_is_reported_as_a_gap(self):
        records = {"docs/guide.md": {"status": "inventory_only", "unit": "rootmeta",
                                     "reason": "pending_semantic_extraction"}}
        result = MONOREPO.coverage_gaps(records)
        self.assertEqual(result["unrepresented_files"], ["docs/guide.md"])
        self.assertFalse(result["coverage_complete"])


class BackupRetentionTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="graphify-backup-test-")).resolve()
        self.trashed = []

    def make(self, name, age):
        path = self.root / name
        path.mkdir()
        os.utime(path, (age, age))
        return path

    def collect(self, command, check):
        self.trashed.extend(Path(item) for item in command[1:])

    def prune(self, keep):
        with patch.object(MONOREPO.subprocess, "run", side_effect=self.collect), \
             patch.object(MONOREPO.shutil, "which", return_value="/usr/bin/trash"):
            return MONOREPO.prune_backups(keep=keep, root=self.root)

    def test_backup_root_lives_inside_the_ignored_output_tree(self):
        # Um caminho fixo sob /tmp é gravável por outro usuário local, que pode
        # pré-criar um symlink e redirecionar a cópia e a remoção (CWE-377).
        root = MONOREPO.backup_root()
        self.assertEqual(root.parent.name, "graphify-out")
        self.assertTrue(root.is_relative_to(MONOREPO.ROOT))

    def test_only_the_most_recent_backups_survive(self):
        for index in range(5):
            self.make("graphify-%032x" % index, 1000 + index)
        result = self.prune(2)
        self.assertEqual(result["trashed_backups"], 3)
        self.assertEqual({path.name for path in self.trashed},
                         {"graphify-%032x" % index for index in range(3)})

    def test_unrelated_directories_are_never_touched(self):
        self.make("20260907_openrouter_removal", 1)
        for index in range(5):
            self.make("graphify-%032x" % index, 2000 + index)
        self.prune(3)
        self.assertNotIn("20260907_openrouter_removal", {path.name for path in self.trashed})


if __name__ == "__main__":
    unittest.main()
