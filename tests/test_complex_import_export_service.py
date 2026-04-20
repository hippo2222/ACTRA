"""
Unit tests for ComplexImportExportService — T8 coverage plan.

Covers:
- Pure helpers: _parse_task_ref, _serialize_datetimes
- Theory image ref helpers: _remap_theory_image_ref, _collect_delta_image_refs,
  _normalize_theory_ref_for_hash, _normalize_theory_delta_for_hash
- Theory rewriting: _rewrite_theory_meta_image_refs, _rewrite_theory_delta_image_refs
- _analyze_complex_payload logic
- _import_complex_payload policies (skip, overwrite, new_id)
- _normalized_complex_for_compare
- validate_import_archive with mocked zip
- import_complexes_atomic parameter validation
"""

import sys
import os
import json
import zipfile
import tempfile
import pytest
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch, PropertyMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.complex_import_export_service import ComplexImportExportService
from services.theory_service import TheoryNotFoundError


# ─── Mock factories ───────────────────────────────────────────────


def _mock_deps(tmp_path=None):
    storage = MagicMock()
    storage.modules_dir = Path(tmp_path or "/tmp") / "modules"
    storage.load_task.return_value = {"task_data": {}}
    storage.reload_modules = MagicMock()

    complex_svc = MagicMock()
    complex_svc.get_complex.return_value = None
    complex_svc.complexes_dir = Path(tmp_path or "/tmp") / "complexes"
    complex_svc.complexes_file = complex_svc.complexes_dir / "complexes.json"
    complex_svc.load_complexes = MagicMock()
    complex_svc.get_complex_history.return_value = [{"_snapshot_timestamp": "snapshot_1"}]

    theory_svc = MagicMock()
    theory_svc.theories_dir = Path(tmp_path or "/tmp") / "theories"

    return storage, complex_svc, theory_svc


def _make_svc(tmp_path=None):
    storage, complex_svc, theory_svc = _mock_deps(tmp_path)
    with patch.object(ComplexImportExportService, "_read_app_version", return_value="1.0.0"):
        svc = ComplexImportExportService(storage, complex_svc, theory_svc)
    return svc


# ═══════════════════════════════════════════════════════════════════
# _parse_task_ref
# ═══════════════════════════════════════════════════════════════════


class TestParseTaskRef:
    def setup_method(self):
        self.svc = _make_svc()

    def test_valid(self):
        assert self.svc._parse_task_ref("mod/topic/task1") == ("mod", "topic", "task1")

    def test_extra_parts(self):
        m, t, tk = self.svc._parse_task_ref("mod/topic/sub/task1")
        assert m == "mod"
        assert t == "topic"
        assert tk == "task1"

    def test_too_few(self):
        assert self.svc._parse_task_ref("mod/topic") is None

    def test_empty_string(self):
        assert self.svc._parse_task_ref("") is None

    def test_not_string(self):
        assert self.svc._parse_task_ref(123) is None

    def test_empty_parts(self):
        assert self.svc._parse_task_ref("mod//task") is None

    def test_slashes_only(self):
        assert self.svc._parse_task_ref("///") is None


# ═══════════════════════════════════════════════════════════════════
# _serialize_datetimes
# ═══════════════════════════════════════════════════════════════════


class TestSerializeDatetimes:
    def setup_method(self):
        self.svc = _make_svc()

    def test_datetime(self):
        dt = datetime(2024, 1, 15, 10, 30)
        assert self.svc._serialize_datetimes(dt) == "2024-01-15T10:30:00"

    def test_dict(self):
        result = self.svc._serialize_datetimes({"a": datetime(2024, 1, 1), "b": "hello"})
        assert result["a"] == "2024-01-01T00:00:00"
        assert result["b"] == "hello"

    def test_list(self):
        result = self.svc._serialize_datetimes([datetime(2024, 1, 1), "text"])
        assert result[0] == "2024-01-01T00:00:00"
        assert result[1] == "text"

    def test_nested(self):
        data = {"items": [{"dt": datetime(2024, 6, 1)}]}
        result = self.svc._serialize_datetimes(data)
        assert result["items"][0]["dt"] == "2024-06-01T00:00:00"

    def test_passthrough(self):
        assert self.svc._serialize_datetimes(42) == 42
        assert self.svc._serialize_datetimes("hello") == "hello"
        assert self.svc._serialize_datetimes(None) is None


# ═══════════════════════════════════════════════════════════════════
# Theory image ref helpers
# ═══════════════════════════════════════════════════════════════════


class TestRemapTheoryImageRef:
    def setup_method(self):
        self.svc = _make_svc()

    def test_remap_matching(self):
        ref = "complexes/theories/old_id/images/img.png"
        result = self.svc._remap_theory_image_ref(ref, "old_id", "new_id")
        assert result == "complexes/theories/new_id/images/img.png"

    def test_no_match(self):
        ref = "some/other/path.png"
        result = self.svc._remap_theory_image_ref(ref, "old_id", "new_id")
        assert result == "some/other/path.png"

    def test_backslash_normalized(self):
        ref = "complexes\\theories\\old_id\\images\\img.png"
        result = self.svc._remap_theory_image_ref(ref, "old_id", "new_id")
        assert result == "complexes/theories/new_id/images/img.png"


class TestCollectDeltaImageRefs:
    def setup_method(self):
        self.svc = _make_svc()

    def test_collects(self):
        delta = {"ops": [
            {"insert": {"image": "path/to/img1.png"}},
            {"insert": "text"},
            {"insert": {"image": "path/to/img2.png"}},
        ]}
        result = self.svc._collect_delta_image_refs(delta)
        assert len(result) == 2
        assert "path/to/img1.png" in result

    def test_deduplicates(self):
        delta = {"ops": [
            {"insert": {"image": "img.png"}},
            {"insert": {"image": "img.png"}},
        ]}
        result = self.svc._collect_delta_image_refs(delta)
        assert len(result) == 1

    def test_empty_delta(self):
        assert self.svc._collect_delta_image_refs({}) == []
        assert self.svc._collect_delta_image_refs({"ops": []}) == []


class TestNormalizeTheoryRefForHash:
    def setup_method(self):
        self.svc = _make_svc()

    def test_replaces_id(self):
        ref = "complexes/theories/abc123/images/photo.png"
        result = self.svc._normalize_theory_ref_for_hash(ref)
        assert result == "complexes/theories/<id>/images/photo.png"

    def test_non_matching(self):
        ref = "other/path/img.png"
        assert self.svc._normalize_theory_ref_for_hash(ref) == "other/path/img.png"


class TestNormalizeTheoryDeltaForHash:
    def setup_method(self):
        self.svc = _make_svc()

    def test_normalizes_images(self):
        delta = {"ops": [
            {"insert": {"image": "complexes/theories/abc/images/img.png"}},
            {"insert": "\n"},
        ]}
        result = self.svc._normalize_theory_delta_for_hash(delta)
        img = result["ops"][0]["insert"]["image"]
        assert "<id>" in img

    def test_empty(self):
        result = self.svc._normalize_theory_delta_for_hash(None)
        assert result == {"ops": [{"insert": "\n"}]}


# ═══════════════════════════════════════════════════════════════════
# Theory rewriting
# ═══════════════════════════════════════════════════════════════════


class TestRewriteTheoryMeta:
    def setup_method(self):
        self.svc = _make_svc()

    def test_rewrites_images(self):
        meta = {"images": ["complexes/theories/old/images/a.png", "complexes/theories/old/images/b.png"]}
        result = self.svc._rewrite_theory_meta_image_refs(meta, "old", "new")
        assert all("new" in ref for ref in result["images"])

    def test_non_string_skipped(self):
        meta = {"images": [123, None, "complexes/theories/old/images/a.png"]}
        result = self.svc._rewrite_theory_meta_image_refs(meta, "old", "new")
        assert len(result["images"]) == 1


class TestRewriteTheoryDelta:
    def setup_method(self):
        self.svc = _make_svc()

    def test_rewrites_images(self):
        delta = {"ops": [{"insert": {"image": "complexes/theories/old/images/img.png"}}]}
        result = self.svc._rewrite_theory_delta_image_refs(delta, "old", "new")
        assert "new" in result["ops"][0]["insert"]["image"]

    def test_empty(self):
        result = self.svc._rewrite_theory_delta_image_refs({}, "old", "new")
        assert result == {"ops": [{"insert": "\n"}]}


# ═══════════════════════════════════════════════════════════════════
# _analyze_complex_payload
# ═══════════════════════════════════════════════════════════════════


class TestAnalyzeComplexPayload:
    def setup_method(self):
        self.svc = _make_svc()

    def test_not_dict(self):
        result = self.svc._analyze_complex_payload("bad", set())
        assert result["status"] == "error"

    def test_missing_id(self):
        result = self.svc._analyze_complex_payload({}, set())
        assert result["status"] == "error"
        assert "id" in result["error"]

    def test_valid_new_complex(self):
        self.svc.complex_service.get_complex.return_value = None
        payload = {"id": "c1", "name": "Test", "tasks": ["mod/topic/t1"], "settings": {}}
        result = self.svc._analyze_complex_payload(payload, {"modules/mod/topics/topic/tasks/t1/task.json"})
        assert result["id"] == "c1"

    def test_missing_task_deps(self):
        self.svc.complex_service.get_complex.return_value = None
        self.svc.storage.load_task.return_value = None
        payload = {"id": "c1", "name": "Test", "tasks": ["mod/topic/missing_task"], "settings": {}}
        members = set()  # task not in archive
        result = self.svc._analyze_complex_payload(payload, members)
        assert result["status"] == "error"
        assert "broken_deps" in result


class TestValidateArchiveContracts:
    def test_validate_import_archive_attaches_public_service_contract(self, tmp_path):
        svc = _make_svc(tmp_path)
        zip_path = Path(tmp_path) / "complexes_contract.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(
                "complexes/c1.json",
                json.dumps({"id": "c1", "name": "Complex 1", "tasks": [], "settings": {}}),
            )
            zf.writestr(
                "manifest.json",
                json.dumps({"spec": svc.SPEC, "export_type": "complexes"}),
            )
            zf.writestr("checksums.json", json.dumps({}))

        report = svc.validate_import_archive(str(zip_path))

        assert report["ok"] is True
        assert report["service_contract"] == ComplexImportExportService.SERVICE_CONTRACT


class TestExportArchive:
    def test_export_creates_zip_from_hosted_payloads_without_shadow_dirs(self, tmp_path):
        storage, complex_svc, theory_svc = _mock_deps(tmp_path)
        asset_file = Path(tmp_path) / "asset.png"
        asset_file.write_bytes(b"PNG")

        storage.load_task.return_value = {
            "task_data": {
                "id": "tk1",
                "name": "Task 1",
                "type": "open_answer",
                "content": {
                    "question": "Prompt",
                    "reference_answer": "Reference",
                    "image_asset_id": "asset_1",
                },
            },
            "task_dir": str(Path(tmp_path) / "virtual_task_dir"),
        }

        complex_obj = MagicMock()
        complex_obj.dict.return_value = {
            "id": "c1",
            "name": "Complex 1",
            "tasks": ["m1/t1/tk1"],
            "theory_link": {"theory_id": "th1"},
            "settings": {},
        }
        complex_svc.get_complex.return_value = complex_obj

        theory_svc.get_theory.return_value = {
            "id": "th1",
            "title": "Theory 1",
            "created_at": "2026-04-19T00:00:00",
            "updated_at": "2026-04-19T00:00:00",
            "version": "2026-04-19T00:00:00",
            "images": [],
            "delta": {"ops": [{"insert": "Hosted theory\n"}]},
        }

        task_export_svc = MagicMock()

        def rewrite(payload, task_dir, staged_assets=None, **_kwargs):
            payload = json.loads(json.dumps(payload, ensure_ascii=False))
            payload["content"]["image_path"] = "images/_archive_assets/asset.png"
            payload["content"].pop("image_asset_id", None)
            if isinstance(staged_assets, dict):
                staged_assets["images/_archive_assets/asset.png"] = asset_file
            return payload, True

        task_export_svc._rewrite_task_payload_image_refs.side_effect = rewrite

        with patch.object(ComplexImportExportService, "_read_app_version", return_value="1.0.0"):
            svc = ComplexImportExportService(
                storage,
                complex_svc,
                theory_svc,
                task_import_export_service=task_export_svc,
            )

        zip_path = svc.create_export_archive(["c1"], options={"include_tasks": True, "include_theories": True})

        with zipfile.ZipFile(zip_path, "r") as zf:
            names = set(zf.namelist())
            assert "complexes/c1.json" in names
            assert "modules/m1/topics/t1/tasks/tk1/task.json" in names
            assert "modules/m1/topics/t1/tasks/tk1/images/_archive_assets/asset.png" in names
            assert "theories/th1/theory.json" in names
            assert "theories/th1/body.delta.json" in names

            exported_task = json.loads(
                zf.read("modules/m1/topics/t1/tasks/tk1/task.json").decode("utf-8")
            )
            assert exported_task["content"]["image_path"] == "images/_archive_assets/asset.png"
            assert "image_asset_id" not in exported_task["content"]

            exported_theory = json.loads(zf.read("theories/th1/theory.json").decode("utf-8"))
            assert exported_theory["id"] == "th1"
            exported_delta = json.loads(zf.read("theories/th1/body.delta.json").decode("utf-8"))
            assert exported_delta["ops"][0]["insert"] == "Hosted theory\n"


# ═══════════════════════════════════════════════════════════════════
# _import_complex_payload
# ═══════════════════════════════════════════════════════════════════


class TestImportComplexPayload:
    def setup_method(self):
        self.svc = _make_svc()

    def test_not_dict(self):
        result = self.svc._import_complex_payload("bad", "skip", {})
        assert result["status"] == "error"

    def test_missing_id(self):
        result = self.svc._import_complex_payload({}, "skip", {})
        assert result["status"] == "error"

    def test_new_complex_imported(self):
        self.svc.complex_service.get_complex.return_value = None
        payload = {"id": "c1", "name": "Test", "tasks": ["mod/topic/t1"], "settings": {}}
        result = self.svc._import_complex_payload(payload, "skip", {})
        assert result["status"] == "imported"
        assert result["incoming_id"] == "c1"
        self.svc.complex_service.create_complex.assert_called_once()

    def test_import_marks_complex_as_archive_import(self):
        self.svc.complex_service.get_complex.return_value = None
        payload = {
            "id": "c1",
            "name": "Test",
            "tasks": ["mod/topic/t1"],
            "settings": {},
            "created_via": "manual_editor",
        }
        result = self.svc._import_complex_payload(payload, "skip", {})
        assert result["status"] == "imported"
        created_payload = self.svc.complex_service.create_complex.call_args[0][0]
        assert created_payload["created_via"] == "archive_import"

    def test_existing_skip_policy(self):
        existing = MagicMock()
        existing.dict.return_value = {"id": "c1", "name": "Old", "tasks": ["mod/topic/t1"], "settings": {}}
        self.svc.complex_service.get_complex.return_value = existing
        payload = {"id": "c1", "name": "New", "tasks": ["mod/topic/t1"], "settings": {}}
        result = self.svc._import_complex_payload(payload, "skip", {})
        assert result["status"] == "skipped"

    def test_existing_overwrite_policy(self):
        existing = MagicMock()
        existing.dict.return_value = {"id": "c1", "name": "Old", "tasks": ["mod/topic/t1"], "settings": {}}
        self.svc.complex_service.get_complex.return_value = existing
        payload = {"id": "c1", "name": "New", "tasks": ["mod/topic/t1"], "settings": {}}
        result = self.svc._import_complex_payload(payload, "overwrite", {})
        assert result["status"] == "imported"
        assert result.get("action") == "overwrite"

    def test_existing_new_id_policy(self):
        existing = MagicMock()
        existing.dict.return_value = {"id": "c1", "name": "Old", "tasks": ["mod/topic/t1"], "settings": {}}
        self.svc.complex_service.get_complex.return_value = existing
        payload = {"id": "c1", "name": "New", "tasks": ["mod/topic/t1"], "settings": {}}
        result = self.svc._import_complex_payload(payload, "new_id", {})
        assert result["status"] == "imported"
        assert result["final_id"] != "c1"

    def test_missing_tasks_error(self):
        self.svc.complex_service.get_complex.return_value = None
        self.svc.storage.load_task.return_value = None
        payload = {"id": "c1", "name": "Test", "tasks": ["mod/topic/task1"], "settings": {}}
        result = self.svc._import_complex_payload(payload, "skip", {})
        assert result["status"] == "error"
        assert result.get("error") == "complex_missing_tasks"

    def test_theory_id_remap_applied(self):
        self.svc.complex_service.get_complex.return_value = None
        payload = {
            "id": "c1", "name": "Test", "tasks": ["mod/topic/t1"], "settings": {},
            "theory_link": {"theory_id": "old_theory"},
        }
        result = self.svc._import_complex_payload(payload, "skip", {"old_theory": "new_theory"})
        assert result["status"] == "imported"


# ═══════════════════════════════════════════════════════════════════
# import_complexes_atomic — parameter validation
# ═══════════════════════════════════════════════════════════════════


class TestImportAtomicParams:
    def setup_method(self):
        self.svc = _make_svc()

    def test_invalid_task_conflict(self):
        with pytest.raises(ValueError, match="task_conflict_resolution"):
            self.svc.import_complexes_atomic("fake.zip", {"task_conflict_resolution": "bad"})

    def test_invalid_complex_conflict(self):
        with pytest.raises(ValueError, match="complex_conflict_resolution"):
            self.svc.import_complexes_atomic("fake.zip", {"complex_conflict_resolution": "bad"})

    def test_invalid_theory_conflict(self):
        with pytest.raises(ValueError, match="theory_conflict_resolution"):
            self.svc.import_complexes_atomic("fake.zip", {"theory_conflict_resolution": "bad"})


class _RollbackStorage:
    def __init__(self, tmp_path):
        self.modules_dir = Path(tmp_path) / "modules"
        self.modules_dir.mkdir(parents=True, exist_ok=True)
        self.tasks = {}
        self.modules = {}
        self.topics = {}
        self.deleted_tasks = []
        self.deleted_topics = []
        self.deleted_modules = []
        self.saved_tasks = []
        self.reload_count = 0

    def load_task(self, module_id, topic_id, task_id):
        task_data = self.tasks.get((module_id, topic_id, task_id))
        if task_data is None:
            return None
        return {"task_data": json.loads(json.dumps(task_data, ensure_ascii=False))}

    def save_task(self, module_id, topic_id, task_id, task_data, validate=False):
        self.saved_tasks.append((module_id, topic_id, task_id))
        self.tasks[(module_id, topic_id, task_id)] = json.loads(json.dumps(task_data, ensure_ascii=False))
        return True

    def delete_task(self, module_id, topic_id, task_id):
        self.deleted_tasks.append((module_id, topic_id, task_id))
        self.tasks.pop((module_id, topic_id, task_id), None)
        return True

    def get_module(self, module_id):
        return self.modules.get(module_id)

    def get_topic(self, module_id, topic_id):
        return self.topics.get((module_id, topic_id))

    def create_module(self, module_id, name, workspace_meta=None):
        self.modules[module_id] = {"id": module_id, "name": name}
        return True

    def create_topic(self, module_id, topic_id, name, theory_link=None, workspace_meta=None):
        self.topics[(module_id, topic_id)] = {"id": topic_id, "name": name}
        return True

    def delete_topic(self, module_id, topic_id):
        self.deleted_topics.append((module_id, topic_id))
        self.topics.pop((module_id, topic_id), None)
        return True

    def delete_module(self, module_id):
        self.deleted_modules.append(module_id)
        self.modules.pop(module_id, None)
        return True

    def reload_modules(self):
        self.reload_count += 1


class _RollbackTaskImportService:
    def __init__(self, storage):
        self.storage = storage

    def import_tasks_atomic(self, archive_path, params, progress_callback=None):
        if progress_callback is not None:
            progress_callback(0, 1, "Importing task dependencies...")
        with zipfile.ZipFile(archive_path, "r") as zf:
            payload = json.loads(
                zf.read("modules/m1/topics/t1/tasks/tk1/task.json").decode("utf-8")
            )
        self.storage.create_module("m1", "m1")
        self.storage.create_topic("m1", "t1", "t1")
        self.storage.save_task("m1", "t1", "tk1", payload, validate=False)
        if progress_callback is not None:
            progress_callback(1, 1, "Done")
        return {"ok": True, "imported": 1, "skipped": 0, "errors": 0}


class _RollbackComplexService:
    def __init__(self, tmp_path):
        self.complexes_dir = Path(tmp_path) / "complexes"
        self.complexes_dir.mkdir(parents=True, exist_ok=True)
        self.complexes_file = self.complexes_dir / "complexes.json"
        self.complexes_file.write_text("[]", encoding="utf-8")
        self.created = []
        self.load_complexes = MagicMock()

    def get_complex(self, _complex_id):
        return None

    def create_complex(self, payload):
        self.created.append(dict(payload))
        raise RuntimeError("complex_create_failed")

    def delete_complex(self, complex_id):
        return True

    def get_complex_history(self, complex_id):
        return []

    def restore_from_history(self, complex_id, snapshot_timestamp):
        raise AssertionError("restore_from_history should not be used in this scenario")


class _RollbackTheoryService:
    def __init__(self, tmp_path):
        self.theories_dir = Path(tmp_path) / "theories"
        self.theories_dir.mkdir(parents=True, exist_ok=True)

    def get_theory(self, theory_id, include_delta=True):
        raise TheoryNotFoundError("theory_not_found")

    def delete_theory(self, theory_id):
        return {"id": theory_id}

    def restore_from_history(self, theory_id, snapshot_timestamp, restored_by_user_id=None):
        raise AssertionError("restore_from_history should not be used in this scenario")


def test_import_complexes_atomic_bundle_rolls_back_hosted_task_changes_without_state_backup(tmp_path):
    storage = _RollbackStorage(tmp_path)
    complex_svc = _RollbackComplexService(tmp_path)
    theory_svc = _RollbackTheoryService(tmp_path)
    task_import_svc = _RollbackTaskImportService(storage)

    with patch.object(ComplexImportExportService, "_read_app_version", return_value="1.0.0"):
        svc = ComplexImportExportService(
            storage,
            complex_svc,
            theory_svc,
            task_import_export_service=task_import_svc,
        )

    archive_path = Path(tmp_path) / "complex_import.zip"
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "modules/m1/topics/t1/tasks/tk1/task.json",
            json.dumps(
                {
                    "id": "tk1",
                    "name": "Task 1",
                    "type": "open_answer",
                    "content": {"question": "Prompt", "reference_answer": "Reference"},
                }
            ),
        )
        zf.writestr(
            "complexes/c1.json",
            json.dumps({"id": "c1", "name": "Complex 1", "tasks": ["m1/t1/tk1"], "settings": {}}),
        )

    result = svc.import_complexes_atomic(
        str(archive_path),
        {
            "task_conflict_resolution": "skip",
            "complex_conflict_resolution": "new_id",
            "theory_conflict_resolution": "reuse_if_same_hash",
            "atomic_mode": "bundle",
        },
    )

    assert result["ok"] is False
    assert result["rollback"] is True
    assert storage.deleted_tasks == [("m1", "t1", "tk1")]
    assert storage.deleted_topics == [("m1", "t1")]
    assert storage.deleted_modules == ["m1"]
    assert storage.tasks == {}
    assert storage.reload_count >= 1


def test_import_theory_dir_uses_service_api_and_uploaded_image_refs(tmp_path):
    storage, complex_svc, _ = _mock_deps(tmp_path)
    theory_svc = MagicMock()
    theory_svc.theories_dir = Path(tmp_path) / "theories"
    theory_svc.get_theory.side_effect = TheoryNotFoundError("theory_not_found")
    theory_svc.create_theory.return_value = {"id": "th1"}
    theory_svc.add_image.return_value = {"path": "complexes/theories/th1/images/illustration.png"}
    theory_svc.update_theory.return_value = {"id": "th1"}

    with patch.object(ComplexImportExportService, "_read_app_version", return_value="1.0.0"):
        svc = ComplexImportExportService(storage, complex_svc, theory_svc)

    source_dir = Path(tmp_path) / "theories" / "th1"
    (source_dir / "images").mkdir(parents=True, exist_ok=True)
    (source_dir / "images" / "illustration.png").write_bytes(b"PNG")
    (source_dir / "theory.json").write_text(
        json.dumps(
            {
                "id": "th1",
                "title": "Imported theory",
                "images": ["complexes/theories/th1/images/illustration.png"],
            }
        ),
        encoding="utf-8",
    )
    (source_dir / "body.delta.json").write_text(
        json.dumps(
            {
                "ops": [
                    {
                        "insert": {
                            "image": "complexes/theories/th1/images/illustration.png"
                        }
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    result = svc._import_theory_dir(source_dir, policy="reuse_if_same_hash")

    assert result["status"] == "imported"
    theory_svc.create_theory.assert_called_once()
    theory_svc.add_image.assert_called_once()
    update_payload = theory_svc.update_theory.call_args[0][1]
    assert update_payload["images"] == ["complexes/theories/th1/images/illustration.png"]
    assert (
        update_payload["delta"]["ops"][0]["insert"]["image"]
        == "complexes/theories/th1/images/illustration.png"
    )


# ═══════════════════════════════════════════════════════════════════
# _compute_theory_hash
# ═══════════════════════════════════════════════════════════════════


class TestComputeTheoryHash:
    def setup_method(self):
        self.svc = _make_svc()

    def test_same_content_same_hash(self):
        h1 = self.svc._compute_theory_hash("Title", ["img.png"], {"ops": [{"insert": "\n"}]})
        h2 = self.svc._compute_theory_hash("Title", ["img.png"], {"ops": [{"insert": "\n"}]})
        assert h1 == h2

    def test_different_title_different_hash(self):
        h1 = self.svc._compute_theory_hash("Title A", [], {"ops": [{"insert": "\n"}]})
        h2 = self.svc._compute_theory_hash("Title B", [], {"ops": [{"insert": "\n"}]})
        assert h1 != h2

    def test_image_order_irrelevant(self):
        h1 = self.svc._compute_theory_hash("T", ["a.png", "b.png"], {"ops": [{"insert": "\n"}]})
        h2 = self.svc._compute_theory_hash("T", ["b.png", "a.png"], {"ops": [{"insert": "\n"}]})
        assert h1 == h2
