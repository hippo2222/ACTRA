"""
Unit tests for ImportExportService — T9 coverage plan.

Covers:
- Pure helpers: _compute_json_hash, _strip_volatile_keys
- _validate_zip_security checks
- _analyze_task_in_archive
- _check_task_dependencies
- _find_task_in_storage, _build_task_index
- _ensure_module_topic_exists
- _log_import
- validate_import_archive integration
- import_tasks_atomic conflict resolution
- create_export_archive basics
"""

import sys
import os
import json
import zipfile
import tempfile
import shutil
import pytest
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.import_export_service import ImportExportService
from services.hosted_shadow_fallback import HostedShadowWriteFallbackDisabledError


# ─── Helpers ───────────────────────────────────────────────────────


def _scan_modules_tree(modules_dir):
    modules = []
    if not modules_dir.exists():
        return modules

    for module_dir in sorted((path for path in modules_dir.iterdir() if path.is_dir()), key=lambda path: path.name):
        module = {"id": module_dir.name, "topics": []}
        topics_dir = module_dir / "topics"
        if topics_dir.exists():
            for topic_dir in sorted((path for path in topics_dir.iterdir() if path.is_dir()), key=lambda path: path.name):
                topic = {"id": topic_dir.name, "tasks": []}
                tasks_dir = topic_dir / "tasks"
                if tasks_dir.exists():
                    for task_dir in sorted((path for path in tasks_dir.iterdir() if path.is_dir()), key=lambda path: path.name):
                        topic["tasks"].append({"id": task_dir.name})
                module["topics"].append(topic)
        modules.append(module)
    return modules


def _write_task_dir(modules_dir, module_id, topic_id, task_id, task_data=None):
    task_dir = modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
    task_dir.mkdir(parents=True, exist_ok=True)
    payload = dict(task_data or {"id": task_id})
    payload.setdefault("id", task_id)
    (task_dir / "task.json").write_text(json.dumps(payload), encoding="utf-8")
    return task_dir


def _make_svc(tmp_path):
    storage = MagicMock()
    storage.modules_dir = tmp_path / "modules"
    storage.modules_dir.mkdir(parents=True, exist_ok=True)
    storage.data_dir = tmp_path

    def load_modules():
        return _scan_modules_tree(storage.modules_dir)

    def get_module(module_id):
        raw_mod = next((module for module in load_modules() if module["id"] == module_id), None)
        if raw_mod:
            module_json_path = storage.modules_dir / module_id / "module.json"
            if module_json_path.exists():
                try:
                    meta = json.loads(module_json_path.read_text(encoding="utf-8"))
                    raw_mod["name"] = meta.get("name")
                except Exception:
                    pass
        return raw_mod

    def get_topic(module_id, topic_id):
        module = get_module(module_id)
        if not module:
            return None
        raw_topic = next((topic for topic in module.get("topics", []) if topic["id"] == topic_id), None)
        if raw_topic:
            topic_json_path = storage.modules_dir / module_id / "topics" / topic_id / "topic.json"
            if topic_json_path.exists():
                try:
                    meta = json.loads(topic_json_path.read_text(encoding="utf-8"))
                    raw_topic["name"] = meta.get("name")
                except Exception:
                    pass
        return raw_topic

    def create_module(module_id, name, workspace_meta=None):
        module_dir = storage.modules_dir / module_id
        if module_dir.exists():
            return False
        module_dir.mkdir(parents=True, exist_ok=False)
        (module_dir / "module.json").write_text(
            json.dumps({"id": module_id, "name": name, "workspace_meta": workspace_meta or {}}),
            encoding="utf-8",
        )
        return True

    def create_topic(module_id, topic_id, name, theory_link=None, workspace_meta=None):
        module_dir = storage.modules_dir / module_id
        if not module_dir.exists():
            return False
        topic_dir = module_dir / "topics" / topic_id
        if topic_dir.exists():
            return False
        (topic_dir / "tasks").mkdir(parents=True, exist_ok=False)
        (topic_dir / "topic.json").write_text(
            json.dumps(
                {
                    "id": topic_id,
                    "name": name,
                    "theory_link": theory_link,
                    "workspace_meta": workspace_meta or {},
                }
            ),
            encoding="utf-8",
        )
        return True

    def load_task(module_id, topic_id, task_id):
        task_json = storage.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id / "task.json"
        if not task_json.exists():
            return None
        return {
            "task_data": json.loads(task_json.read_text(encoding="utf-8")),
            "task_dir": str(task_json.parent),
        }

    def save_task(module_id, topic_id, task_id, task_data, validate=True):
        task_dir = storage.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
        task_dir.mkdir(parents=True, exist_ok=True)
        payload = json.loads(json.dumps(task_data, ensure_ascii=False))
        payload["id"] = task_id
        (task_dir / "task.json").write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return True

    def delete_task(module_id, topic_id, task_id):
        task_dir = storage.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
        if not task_dir.exists():
            return False
        shutil.rmtree(task_dir)
        return True

    def delete_topic(module_id, topic_id):
        topic_dir = storage.modules_dir / module_id / "topics" / topic_id
        if not topic_dir.exists():
            return False
        shutil.rmtree(topic_dir)
        return True

    def delete_module(module_id):
        module_dir = storage.modules_dir / module_id
        if not module_dir.exists():
            return False
        shutil.rmtree(module_dir)
        return True

    storage.load_modules = MagicMock(side_effect=load_modules)
    storage.get_module = MagicMock(side_effect=get_module)
    storage.get_topic = MagicMock(side_effect=get_topic)
    storage.create_module = MagicMock(side_effect=create_module)
    storage.create_topic = MagicMock(side_effect=create_topic)
    storage.load_task = MagicMock(side_effect=load_task)
    storage.save_task = MagicMock(side_effect=save_task)
    storage.delete_task = MagicMock(side_effect=delete_task)
    storage.delete_topic = MagicMock(side_effect=delete_topic)
    storage.delete_module = MagicMock(side_effect=delete_module)
    storage.reload_modules = MagicMock()
    with patch.object(ImportExportService, "_read_app_version", return_value="1.0.0"):
        svc = ImportExportService(storage)
    return svc


def _create_zip(tmp_path, files_dict, name="test.zip"):
    """Create a zip with given file contents. files_dict: {arc_name: content_bytes_or_str}"""
    zip_path = tmp_path / name
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for arc_name, content in files_dict.items():
            if isinstance(content, str):
                content = content.encode("utf-8")
            zf.writestr(arc_name, content)
    return str(zip_path)


# ═══════════════════════════════════════════════════════════════════
# _compute_json_hash / _strip_volatile_keys
# ═══════════════════════════════════════════════════════════════════


class TestJsonHash:
    def test_same_data_same_hash(self, tmp_path):
        svc = _make_svc(tmp_path)
        h1 = svc._compute_json_hash({"a": 1, "b": 2})
        h2 = svc._compute_json_hash({"b": 2, "a": 1})
        assert h1 == h2

    def test_different_data_different_hash(self, tmp_path):
        svc = _make_svc(tmp_path)
        h1 = svc._compute_json_hash({"a": 1})
        h2 = svc._compute_json_hash({"a": 2})
        assert h1 != h2

    def test_volatile_keys_ignored(self, tmp_path):
        svc = _make_svc(tmp_path)
        h1 = svc._compute_json_hash({"a": 1, "created_at": "2024-01-01"})
        h2 = svc._compute_json_hash({"a": 1, "created_at": "2025-06-01"})
        assert h1 == h2


class TestStripVolatileKeys:
    def test_strips_top_level(self, tmp_path):
        svc = _make_svc(tmp_path)
        result = svc._strip_volatile_keys({"a": 1, "created_at": "x", "updated_at": "y"})
        assert "created_at" not in result
        assert "updated_at" not in result
        assert result["a"] == 1

    def test_strips_nested(self, tmp_path):
        svc = _make_svc(tmp_path)
        result = svc._strip_volatile_keys({"meta": {"created_at": "x", "val": 1}})
        assert "created_at" not in result["meta"]

    def test_strips_in_list(self, tmp_path):
        svc = _make_svc(tmp_path)
        result = svc._strip_volatile_keys([{"created_at": "x", "v": 1}])
        assert "created_at" not in result[0]


# ═══════════════════════════════════════════════════════════════════
# _validate_zip_security
# ═══════════════════════════════════════════════════════════════════


class TestZipSecurity:
    def test_normal_zip_passes(self, tmp_path):
        svc = _make_svc(tmp_path)
        zip_path = _create_zip(tmp_path, {"test.json": "{}"})
        svc._validate_zip_security(zip_path)  # should not raise

    def test_zip_slip_detected(self, tmp_path):
        svc = _make_svc(tmp_path)
        zip_path = _create_zip(tmp_path, {"../../../etc/passwd": "bad"})
        with pytest.raises(ValueError, match="Malicious path"):
            svc._validate_zip_security(zip_path)

    def test_deep_nesting_detected(self, tmp_path):
        svc = _make_svc(tmp_path)
        deep_name = "/".join([f"d{i}" for i in range(15)]) + "/file.json"
        zip_path = _create_zip(tmp_path, {deep_name: "{}"})
        with pytest.raises(ValueError, match="nesting too deep"):
            svc._validate_zip_security(zip_path)


# ═══════════════════════════════════════════════════════════════════
# _check_task_dependencies
# ═══════════════════════════════════════════════════════════════════


class TestCheckDependencies:
    def test_no_images(self, tmp_path):
        svc = _make_svc(tmp_path)
        zip_path = _create_zip(tmp_path, {"task.json": "{}"})
        with zipfile.ZipFile(zip_path, "r") as zf:
            missing = svc._check_task_dependencies({"content": {"text": "hello"}}, zf, Path("."))
        assert missing == []

    def test_image_present(self, tmp_path):
        svc = _make_svc(tmp_path)
        zip_path = _create_zip(tmp_path, {
            "tasks/t1/task.json": "{}",
            "tasks/t1/img.png": b"PNG",
        })
        with zipfile.ZipFile(zip_path, "r") as zf:
            data = {"content": {"image": "img.png"}}
            missing = svc._check_task_dependencies(data, zf, Path("tasks/t1"))
        assert missing == []

    def test_image_missing(self, tmp_path):
        svc = _make_svc(tmp_path)
        zip_path = _create_zip(tmp_path, {"tasks/t1/task.json": "{}"})
        with zipfile.ZipFile(zip_path, "r") as zf:
            data = {"content": {"image": "missing.png"}}
            missing = svc._check_task_dependencies(data, zf, Path("tasks/t1"))
        assert "missing.png" in missing

    def test_http_url_ignored(self, tmp_path):
        svc = _make_svc(tmp_path)
        zip_path = _create_zip(tmp_path, {"task.json": "{}"})
        with zipfile.ZipFile(zip_path, "r") as zf:
            data = {"content": {"image": "https://example.com/img.png"}}
            missing = svc._check_task_dependencies(data, zf, Path("."))
        assert missing == []


class TestAnalyzeTaskInArchive:
    def test_uses_meta_name_when_top_level_name_missing(self, tmp_path):
        svc = _make_svc(tmp_path)
        zip_path = _create_zip(
            tmp_path,
            {
                "modules/m1/topics/t1/tasks/task_meta_name/task.json": json.dumps(
                    {
                        "id": "task_meta_name",
                        "type": "test",
                        "meta": {
                            "id": "task_meta_name",
                            "name": "Task From Meta",
                        },
                        "content": {
                            "questions": [],
                        },
                    }
                ),
            },
        )
        with zipfile.ZipFile(zip_path, "r") as zf:
            report = svc._analyze_task_in_archive(
                zf,
                "modules/m1/topics/t1/tasks/task_meta_name/task.json",
            )

        assert report["status"] == "valid"
        assert report["name"] == "Task From Meta"


# ═══════════════════════════════════════════════════════════════════
# _find_task_in_storage / _build_task_index
# ═══════════════════════════════════════════════════════════════════


class TestFindTask:
    def test_not_found(self, tmp_path):
        svc = _make_svc(tmp_path)
        assert svc._find_task_in_storage("nonexistent") is None

    def test_found(self, tmp_path):
        svc = _make_svc(tmp_path)
        _write_task_dir(svc.storage.modules_dir, "mod1", "top1", "task1")
        result = svc._find_task_in_storage("task1")
        assert result is not None
        assert "task1" in str(result)

    def test_index_lookup(self, tmp_path):
        svc = _make_svc(tmp_path)
        index = {"task1": Path("/some/path/task1")}
        assert svc._find_task_in_storage("task1", index=index) == Path("/some/path/task1")
        assert svc._find_task_in_storage("missing", index=index) is None

    def test_build_task_index(self, tmp_path):
        svc = _make_svc(tmp_path)
        _write_task_dir(svc.storage.modules_dir, "m1", "t1", "tk1")
        _write_task_dir(svc.storage.modules_dir, "m1", "t1", "tk2")
        index = svc._build_task_index()
        assert "tk1" in index
        assert "tk2" in index


# ═══════════════════════════════════════════════════════════════════
# _ensure_module_topic_exists
# ═══════════════════════════════════════════════════════════════════


class TestEnsureModuleTopic:
    def test_creates_dirs(self, tmp_path):
        svc = _make_svc(tmp_path)
        svc._ensure_module_topic_exists("new_mod", "new_topic")
        mod_dir = svc.storage.modules_dir / "new_mod"
        assert mod_dir.exists()
        assert (mod_dir / "module.json").exists()
        topic_dir = mod_dir / "topics" / "new_topic"
        assert topic_dir.exists()
        assert (topic_dir / "topic.json").exists()
        assert (topic_dir / "tasks").exists()

    def test_idempotent(self, tmp_path):
        svc = _make_svc(tmp_path)
        svc._ensure_module_topic_exists("m1", "t1")
        svc._ensure_module_topic_exists("m1", "t1")  # should not raise

    def test_creates_dirs_with_original_names(self, tmp_path):
        svc = _make_svc(tmp_path)
        module_names = {"new_mod": "Лучевая диагностика"}
        topic_names = {"new_mod": {"new_topic": "Глава 1: Введение"}}
        
        svc._ensure_module_topic_exists(
            "new_mod", 
            "new_topic", 
            module_names=module_names, 
            topic_names=topic_names
        )
        
        mod = svc.storage.get_module("new_mod")
        assert mod is not None
        assert mod["name"] == "Лучевая диагностика"
        
        topic = svc.storage.get_topic("new_mod", "new_topic")
        assert topic is not None
        assert topic["name"] == "Глава 1: Введение"


# ═══════════════════════════════════════════════════════════════════
# _log_import
# ═══════════════════════════════════════════════════════════════════


class TestLogImport:
    def test_creates_journal(self, tmp_path):
        svc = _make_svc(tmp_path)
        svc._log_import("archive.zip", {"imported": 5, "skipped": 1, "errors": 0})
        journal = svc.storage.modules_dir.parent / "import_journal.json"
        assert journal.exists()
        entries = json.loads(journal.read_text(encoding="utf-8"))
        assert len(entries) == 1
        assert entries[0]["imported"] == 5

    def test_appends_journal(self, tmp_path):
        svc = _make_svc(tmp_path)
        svc._log_import("a1.zip", {"imported": 1})
        svc._log_import("a2.zip", {"imported": 2})
        journal = svc.storage.modules_dir.parent / "import_journal.json"
        entries = json.loads(journal.read_text(encoding="utf-8"))
        assert len(entries) == 2


# ═══════════════════════════════════════════════════════════════════
# validate_import_archive
# ═══════════════════════════════════════════════════════════════════


class TestValidateArchive:
    def test_valid_archive_with_tasks(self, tmp_path):
        svc = _make_svc(tmp_path)
        task_data = {"id": "t1", "name": "Task 1", "type": "click", "content": {"text": "hi"}}
        manifest = {"app_version": "1.0.0", "export_type": "tasks"}
        zip_path = _create_zip(tmp_path, {
            "modules/m1/topics/tp1/tasks/t1/task.json": json.dumps(task_data),
            "manifest.json": json.dumps(manifest),
        })
        report = svc.validate_import_archive(zip_path)
        assert report["ok"] is True
        assert report["summary"]["total"] == 1
        assert report["summary"]["valid"] == 1
        assert report["service_contract"] == ImportExportService.SERVICE_CONTRACT

    def test_archive_no_manifest(self, tmp_path):
        svc = _make_svc(tmp_path)
        task_data = {"id": "t1", "name": "Task 1", "type": "click", "content": {}}
        zip_path = _create_zip(tmp_path, {
            "modules/m1/topics/tp1/tasks/t1/task.json": json.dumps(task_data),
        })
        report = svc.validate_import_archive(zip_path)
        assert report["ok"] is True
        assert len(report.get("warnings", [])) >= 1

    def test_archive_invalid_task_json(self, tmp_path):
        svc = _make_svc(tmp_path)
        zip_path = _create_zip(tmp_path, {
            "modules/m1/topics/tp1/tasks/t1/task.json": "{bad json",
        })
        report = svc.validate_import_archive(zip_path)
        assert report["ok"] is True
        assert report["summary"]["errors"] >= 1

    def test_unknown_task_type_warning(self, tmp_path):
        svc = _make_svc(tmp_path)
        task_data = {"id": "t1", "name": "T", "type": "exotic_new_type", "content": {}}
        zip_path = _create_zip(tmp_path, {
            "modules/m1/topics/tp1/tasks/t1/task.json": json.dumps(task_data),
        })
        report = svc.validate_import_archive(zip_path)
        task_report = report["tasks"][0]
        assert task_report.get("status") == "warning" or "warnings" in task_report

    def test_task_missing_id_error(self, tmp_path):
        svc = _make_svc(tmp_path)
        task_data = {"name": "No ID", "type": "click", "content": {}}
        zip_path = _create_zip(tmp_path, {
            "modules/m1/topics/tp1/tasks/t1/task.json": json.dumps(task_data),
        })
        report = svc.validate_import_archive(zip_path)
        assert report["summary"]["errors"] >= 1


# ═══════════════════════════════════════════════════════════════════
# create_export_archive
# ═══════════════════════════════════════════════════════════════════


class TestExportArchive:
    def test_export_creates_zip(self, tmp_path):
        svc = _make_svc(tmp_path)
        # Create a task directory
        task_dir = svc.storage.modules_dir / "m1" / "topics" / "t1" / "tasks" / "tk1"
        task_dir.mkdir(parents=True)
        (task_dir / "task.json").write_text(json.dumps({"id": "tk1"}), encoding="utf-8")

        zip_path = svc.create_export_archive([
            {"module_id": "m1", "topic_id": "t1", "task_id": "tk1"}
        ])
        assert os.path.exists(zip_path)
        with zipfile.ZipFile(zip_path, "r") as zf:
            names = zf.namelist()
            assert any("task.json" in n for n in names)
            assert any("manifest.json" in n for n in names)
        os.remove(zip_path)

    def test_export_skips_missing_task(self, tmp_path):
        svc = _make_svc(tmp_path)
        zip_path = svc.create_export_archive([
            {"module_id": "m1", "topic_id": "t1", "task_id": "missing"}
        ])
        with zipfile.ZipFile(zip_path, "r") as zf:
            task_files = [n for n in zf.namelist() if "task.json" in n]
            assert len(task_files) == 0
        os.remove(zip_path)

    def test_export_creates_zip_from_hosted_load_task_without_task_dir(self, tmp_path):
        storage = MagicMock()
        storage.modules_dir = tmp_path / "modules"
        storage.modules_dir.mkdir(parents=True, exist_ok=True)
        storage.data_dir = tmp_path
        storage.load_modules.return_value = []
        storage.reload_modules = MagicMock()
        storage.load_task.return_value = {
            "task_data": {
                "id": "tk1",
                "name": "Hosted Task",
                "type": "open_answer",
                "content": {
                    "question": "Prompt",
                    "reference_answer": "Reference",
                    "image_asset_id": "asset_1",
                },
            },
            "task_dir": str(tmp_path / "virtual_task_dir"),
        }
        asset_service = MagicMock()
        asset_file = tmp_path / "asset.png"
        asset_file.write_bytes(b"PNG")
        asset_service.resolve_asset_file.return_value = asset_file

        with patch.object(ImportExportService, "_read_app_version", return_value="1.0.0"):
            svc = ImportExportService(storage, asset_service=asset_service)

        zip_path = svc.create_export_archive(
            [{"module_id": "m1", "topic_id": "t1", "task_id": "tk1"}]
        )
        assert os.path.exists(zip_path)
        with zipfile.ZipFile(zip_path, "r") as zf:
            names = zf.namelist()
            assert "modules/m1/topics/t1/tasks/tk1/task.json" in names
            assert any(name.startswith("modules/m1/topics/t1/tasks/tk1/images/_archive_assets/") for name in names)
            exported_task = json.loads(
                zf.read("modules/m1/topics/t1/tasks/tk1/task.json").decode("utf-8")
            )
            assert exported_task["content"]["image_path"].startswith("images/_archive_assets/")
            assert "image_asset_id" not in exported_task["content"]
        os.remove(zip_path)


# ═══════════════════════════════════════════════════════════════════
# import_tasks_atomic
# ═══════════════════════════════════════════════════════════════════


class TestImportAtomic:
    def test_import_new_task(self, tmp_path):
        svc = _make_svc(tmp_path)
        task_data = {"id": "tk1", "name": "Task 1", "type": "click"}
        zip_path = _create_zip(tmp_path, {
            "modules/m1/topics/t1/tasks/tk1/task.json": json.dumps(task_data),
        })
        result = svc.import_tasks_atomic(zip_path, {"conflict_resolution": "skip"})
        assert result["ok"] is True
        assert result["imported"] == 1
        assert result["service_contract"] == ImportExportService.SERVICE_CONTRACT

    def test_import_skip_conflict(self, tmp_path):
        svc = _make_svc(tmp_path)
        _write_task_dir(svc.storage.modules_dir, "m1", "t1", "tk1")

        task_data = {"id": "tk1", "name": "Updated", "type": "click"}
        zip_path = _create_zip(tmp_path, {
            "modules/m1/topics/t1/tasks/tk1/task.json": json.dumps(task_data),
        })
        result = svc.import_tasks_atomic(zip_path, {"conflict_resolution": "skip"})
        assert result["ok"] is True
        assert result["skipped"] == 1
        assert result["imported"] == 0

    def test_import_new_id_conflict(self, tmp_path):
        svc = _make_svc(tmp_path)
        _write_task_dir(svc.storage.modules_dir, "m1", "t1", "tk1")

        task_data = {"id": "tk1", "name": "Task", "type": "click"}
        zip_path = _create_zip(tmp_path, {
            "modules/m1/topics/t1/tasks/tk1/task.json": json.dumps(task_data),
        })
        result = svc.import_tasks_atomic(zip_path, {"conflict_resolution": "new_id"})
        assert result["ok"] is True
        assert result["imported"] == 1

    def test_import_tasks_with_excluded_list(self, tmp_path):
        svc = _make_svc(tmp_path)
        task_data_1 = {"id": "tk1", "name": "Task 1", "type": "click"}
        task_data_2 = {"id": "tk2", "name": "Task 2", "type": "click"}
        zip_path = _create_zip(tmp_path, {
            "modules/m1/topics/t1/tasks/tk1/task.json": json.dumps(task_data_1),
            "modules/m1/topics/t1/tasks/tk2/task.json": json.dumps(task_data_2),
        })

        result = svc.import_tasks_atomic(
            zip_path,
            {
                "conflict_resolution": "skip",
                "excluded_tasks": [0, "1"]
            }
        )
        assert result["ok"] is True
        assert result["imported"] == 0
        assert result["skipped"] == 2

    def test_import_overwrite_uses_existing_location_without_creating_archive_target(self, tmp_path):
        svc = _make_svc(tmp_path)
        existing_task_dir = _write_task_dir(
            svc.storage.modules_dir,
            "existing_mod",
            "existing_topic",
            "tk1",
            {"id": "tk1", "name": "Original", "type": "click"},
        )

        task_data = {"id": "tk1", "name": "Updated", "type": "click"}
        zip_path = _create_zip(tmp_path, {
            "modules/new_mod/topics/new_topic/tasks/tk1/task.json": json.dumps(task_data),
        })

        result = svc.import_tasks_atomic(zip_path, {"conflict_resolution": "overwrite"})

        assert result["ok"] is True
        assert result["imported"] == 1
        saved_task = json.loads((existing_task_dir / "task.json").read_text(encoding="utf-8"))
        assert saved_task["name"] == "Updated"
        assert not (svc.storage.modules_dir / "new_mod").exists()

    def test_import_returns_explicit_degraded_payload_when_hosted_write_is_blocked(self, tmp_path):
        svc = _make_svc(tmp_path)
        svc.storage.save_task.side_effect = HostedShadowWriteFallbackDisabledError(
            "import_export.import_tasks_atomic",
            reason="test_shadow_write_blocked",
        )

        task_data = {"id": "tk1", "name": "Task 1", "type": "click"}
        zip_path = _create_zip(tmp_path, {
            "modules/m1/topics/t1/tasks/tk1/task.json": json.dumps(task_data),
        })

        result = svc.import_tasks_atomic(
            zip_path,
            {"conflict_resolution": "skip", "skip_errors": False},
        )

        assert result["ok"] is False
        assert result["degraded"] is True
        assert result["error"] == "hosted_shadow_write_blocked"
        assert result["details"]["reason"] == "test_shadow_write_blocked"
        assert result["rollback"] is True
        assert result["service_contract"] == ImportExportService.SERVICE_CONTRACT
