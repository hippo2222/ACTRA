"""
Unit tests for ComplexService — coverage plan.

Covers:
- Init and directory creation
- load_complexes (empty, valid, corrupt JSON)
- get_all_complexes, get_complex
- create_complex (normal, duplicate, validation)
- update_complex (normal, not found, conflict)
- delete_complex (normal, not found)
- get_complex_history, _save_history_snapshot
- restore_from_history
- ConflictError
"""

import sys
import os
import json
import pytest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.complex_service import ComplexService, ConflictError


def _valid_complex_data(cid="c1", name="Test Complex"):
    return {
        "id": cid,
        "name": name,
        "description": "A test complex",
        "tasks": ["mod/topic/task1"],
        "chains": [],
        "settings": {},
    }


@pytest.fixture
def svc(tmp_path):
    return ComplexService(data_dir=str(tmp_path))


# ═══════════════════════════════════════════════════════════════════
# Init
# ═══════════════════════════════════════════════════════════════════


class TestInit:
    def test_creates_dir(self, tmp_path):
        svc = ComplexService(data_dir=str(tmp_path))
        assert (tmp_path / "complexes").is_dir()


# ═══════════════════════════════════════════════════════════════════
# load_complexes
# ═══════════════════════════════════════════════════════════════════


class TestLoadComplexes:
    def test_no_file(self, svc):
        result = svc.load_complexes()
        assert result == []
        assert svc.complexes_file.exists()

    def test_valid(self, svc):
        data = [_valid_complex_data()]
        svc.complexes_file.write_text(json.dumps(data), encoding="utf-8")
        result = svc.load_complexes()
        assert len(result) == 1
        assert result[0].id == "c1"

    def test_corrupt_json(self, svc):
        svc.complexes_file.write_text("{bad json", encoding="utf-8")
        result = svc.load_complexes()
        assert result == []

    def test_not_list(self, svc):
        svc.complexes_file.write_text(json.dumps({"not": "a list"}), encoding="utf-8")
        result = svc.load_complexes()
        assert result == []

    def test_backfills_ownership_metadata_for_legacy_complex(self, svc):
        svc.complexes_file.write_text(
            json.dumps([_valid_complex_data()]),
            encoding="utf-8",
        )
        result = svc.load_complexes()
        assert len(result) == 1
        assert result[0].created_via == "legacy_unknown"
        assert result[0].content_scope == "shared_local"


# ═══════════════════════════════════════════════════════════════════
# get_all / get_complex
# ═══════════════════════════════════════════════════════════════════


class TestGet:
    def test_get_all_empty(self, svc):
        assert svc.get_all_complexes() == []

    def test_get_complex_not_found(self, svc):
        assert svc.get_complex("nonexistent") is None

    def test_get_complex_found(self, svc):
        svc.create_complex(_valid_complex_data())
        c = svc.get_complex("c1")
        assert c is not None
        assert c.name == "Test Complex"


# ═══════════════════════════════════════════════════════════════════
# create_complex
# ═══════════════════════════════════════════════════════════════════


class TestCreateComplex:
    def test_normal(self, svc):
        c = svc.create_complex(_valid_complex_data())
        assert c.id == "c1"
        assert c.name == "Test Complex"
        assert c.created_via == "manual_editor"
        assert c.content_scope == "shared_local"
        # Persisted
        assert svc.complexes_file.exists()

    def test_duplicate(self, svc):
        svc.create_complex(_valid_complex_data())
        with pytest.raises(ValueError, match="already exists"):
            svc.create_complex(_valid_complex_data())


# ═══════════════════════════════════════════════════════════════════
# update_complex
# ═══════════════════════════════════════════════════════════════════


class TestUpdateComplex:
    def test_normal(self, svc):
        svc.create_complex(
            {
                **_valid_complex_data(),
                "created_by_user_id": "owner_1",
                "updated_by_user_id": "owner_1",
                "created_via": "manual_editor",
            }
        )
        updated = svc.update_complex("c1", {"name": "Updated Name"})
        assert updated.name == "Updated Name"
        assert updated.created_by_user_id == "owner_1"
        assert updated.updated_by_user_id == "owner_1"
        assert updated.created_via == "manual_editor"

    def test_not_found(self, svc):
        with pytest.raises(ValueError, match="not found"):
            svc.update_complex("nonexistent", {"name": "X"})

    def test_conflict(self, svc):
        svc.create_complex(_valid_complex_data())
        with pytest.raises(ConflictError):
            svc.update_complex("c1", {"name": "X"}, expected_version="wrong_version")


# ═══════════════════════════════════════════════════════════════════
# delete_complex
# ═══════════════════════════════════════════════════════════════════


class TestDeleteComplex:
    def test_normal(self, svc):
        svc.create_complex(_valid_complex_data())
        assert svc.delete_complex("c1") is True
        assert svc.get_complex("c1") is None

    def test_not_found(self, svc):
        assert svc.delete_complex("nonexistent") is False


# ═══════════════════════════════════════════════════════════════════
# History
# ═══════════════════════════════════════════════════════════════════


class TestHistory:
    def test_empty_history(self, svc):
        assert svc.get_complex_history("c1") == []

    def test_update_creates_history(self, svc):
        svc.create_complex(_valid_complex_data())
        svc.update_complex("c1", {"name": "V2"})
        history = svc.get_complex_history("c1")
        assert len(history) >= 1

    def test_restore_from_history(self, svc):
        svc.create_complex(_valid_complex_data())
        svc.update_complex("c1", {"name": "V2"})
        history = svc.get_complex_history("c1")
        ts = history[0]["_snapshot_timestamp"]
        restored = svc.restore_from_history("c1", ts)
        assert restored.name == "Test Complex"

    def test_restore_not_found(self, svc):
        svc.create_complex(_valid_complex_data())
        with pytest.raises(ValueError, match="Snapshot not found"):
            svc.restore_from_history("c1", "nonexistent_timestamp")


# ═══════════════════════════════════════════════════════════════════
# ConflictError
# ═══════════════════════════════════════════════════════════════════


class TestConflictError:
    def test_attrs(self):
        err = ConflictError("msg", current_version="v1", expected_version="v2")
        assert err.current_version == "v1"
        assert err.expected_version == "v2"
        assert str(err) == "msg"
