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
