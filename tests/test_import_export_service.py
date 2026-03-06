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


# ─── Helpers ───────────────────────────────────────────────────────


def _make_svc(tmp_path):
    storage = MagicMock()
    storage.modules_dir = tmp_path / "modules"
    storage.modules_dir.mkdir(parents=True, exist_ok=True)
    storage.data_dir = tmp_path
    storage.load_modules.return_value = []
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
        svc.storage.load_modules.return_value = []
        assert svc._find_task_in_storage("nonexistent") is None

    def test_found(self, tmp_path):
        svc = _make_svc(tmp_path)
        svc.storage.load_modules.return_value = [
            {"id": "mod1", "topics": [
                {"id": "top1", "tasks": [{"id": "task1"}]}
            ]}
        ]
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
        svc.storage.load_modules.return_value = [
            {"id": "m1", "topics": [
                {"id": "t1", "tasks": [{"id": "tk1"}, {"id": "tk2"}]}
            ]}
        ]
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

    def test_import_skip_conflict(self, tmp_path):
        svc = _make_svc(tmp_path)
        # Create existing task
        existing_dir = svc.storage.modules_dir / "m1" / "topics" / "t1" / "tasks" / "tk1"
        existing_dir.mkdir(parents=True)
        (existing_dir / "task.json").write_text(json.dumps({"id": "tk1"}), encoding="utf-8")
        svc.storage.load_modules.return_value = [
            {"id": "m1", "topics": [{"id": "t1", "tasks": [{"id": "tk1"}]}]}
        ]

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
        existing_dir = svc.storage.modules_dir / "m1" / "topics" / "t1" / "tasks" / "tk1"
        existing_dir.mkdir(parents=True)
        (existing_dir / "task.json").write_text(json.dumps({"id": "tk1"}), encoding="utf-8")
        svc.storage.load_modules.return_value = [
            {"id": "m1", "topics": [{"id": "t1", "tasks": [{"id": "tk1"}]}]}
        ]

        task_data = {"id": "tk1", "name": "Task", "type": "click"}
        zip_path = _create_zip(tmp_path, {
            "modules/m1/topics/t1/tasks/tk1/task.json": json.dumps(task_data),
        })
        result = svc.import_tasks_atomic(zip_path, {"conflict_resolution": "new_id"})
        assert result["ok"] is True
        assert result["imported"] == 1
