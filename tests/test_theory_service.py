"""
Unit tests for TheoryService — T10 coverage plan.

Covers:
- Init and directory creation
- _normalize_theory_id, _normalize_title
- _sanitize_delta (ops filtering, text limits, image sanitization)
- _sanitize_attributes (allowed attrs, XSS prevention)
- _sanitize_image_ref (javascript:, data:, /api/local-image, ..)
- _sanitize_images_list
- _collect_delta_image_refs
- _remap_delta_images
- create_theory, get_theory, update_theory, clone_theory
- list_theories with query filter
- get_history, restore_from_history
- TheoryConflictError on version mismatch
- _save_history_snapshot pruning
"""

import sys
import os
import json
import pytest
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.theory_service import (
    TheoryService,
    TheoryConflictError,
    TheoryNotFoundError,
    TheoryValidationError,
)


@pytest.fixture
def svc(tmp_path):
    return TheoryService(data_dir=str(tmp_path))


# ═══════════════════════════════════════════════════════════════════
# Init
# ═══════════════════════════════════════════════════════════════════


class TestInit:
    def test_creates_theories_dir(self, tmp_path):
        svc = TheoryService(data_dir=str(tmp_path))
        assert (tmp_path / "complexes" / "theories").is_dir()


# ═══════════════════════════════════════════════════════════════════
# _normalize_theory_id
# ═══════════════════════════════════════════════════════════════════


class TestNormalizeTheoryId:
    def test_valid(self, svc):
        assert svc._normalize_theory_id("th_abc123") == "th_abc123"

    def test_strips_whitespace(self, svc):
        assert svc._normalize_theory_id("  th_abc  ") == "th_abc"

    def test_none(self, svc):
        assert svc._normalize_theory_id(None) is None

    def test_empty(self, svc):
        assert svc._normalize_theory_id("") is None

    def test_not_string(self, svc):
        assert svc._normalize_theory_id(123) is None

    def test_slash_rejected(self, svc):
        with pytest.raises(TheoryValidationError):
            svc._normalize_theory_id("../evil")

    def test_backslash_rejected(self, svc):
        with pytest.raises(TheoryValidationError):
            svc._normalize_theory_id("foo\\bar")


# ═══════════════════════════════════════════════════════════════════
# _normalize_title
# ═══════════════════════════════════════════════════════════════════


class TestNormalizeTitle:
    def test_normal(self, svc):
        assert svc._normalize_title("  Hello  ") == "Hello"

    def test_none(self, svc):
        assert svc._normalize_title(None) == ""

    def test_not_string(self, svc):
        with pytest.raises(TheoryValidationError):
            svc._normalize_title(123)


# ═══════════════════════════════════════════════════════════════════
# _sanitize_delta
# ═══════════════════════════════════════════════════════════════════


class TestSanitizeDelta:
    def test_none_returns_default(self, svc):
        result = svc._sanitize_delta(None)
        assert result == {"ops": [{"insert": "\n"}]}

    def test_not_dict_raises(self, svc):
        with pytest.raises(TheoryValidationError, match="delta_must_be_object"):
            svc._sanitize_delta("bad")

    def test_no_ops_raises(self, svc):
        with pytest.raises(TheoryValidationError, match="delta_ops_must_be_array"):
            svc._sanitize_delta({"ops": "bad"})

    def test_valid_ops(self, svc):
        delta = {"ops": [{"insert": "Hello\n"}]}
        result = svc._sanitize_delta(delta)
        assert result["ops"][0]["insert"] == "Hello\n"

    def test_strips_unknown_ops(self, svc):
        delta = {"ops": [{"delete": 5}, {"insert": "ok\n"}]}
        result = svc._sanitize_delta(delta)
        assert len(result["ops"]) == 1

    def test_normalizes_crlf(self, svc):
        delta = {"ops": [{"insert": "a\r\nb\rc\n"}]}
        result = svc._sanitize_delta(delta)
        assert result["ops"][0]["insert"] == "a\nb\nc\n"

    def test_image_insert(self, svc):
        delta = {"ops": [{"insert": {"image": "path/img.png"}}]}
        result = svc._sanitize_delta(delta)
        assert result["ops"][0]["insert"]["image"] == "path/img.png"

    def test_empty_ops_returns_default(self, svc):
        delta = {"ops": [{"retain": 5}]}
        result = svc._sanitize_delta(delta)
        assert result["ops"] == [{"insert": "\n"}]

    def test_preserves_valid_attributes(self, svc):
        delta = {"ops": [{"insert": "bold\n", "attributes": {"bold": True}}]}
        result = svc._sanitize_delta(delta)
        assert result["ops"][0]["attributes"]["bold"] is True

    def test_too_many_ops(self, svc):
        delta = {"ops": [{"insert": "x"}] * 25000}
        with pytest.raises(TheoryValidationError, match="delta_too_large"):
            svc._sanitize_delta(delta)


# ═══════════════════════════════════════════════════════════════════
# _sanitize_attributes
# ═══════════════════════════════════════════════════════════════════


class TestSanitizeAttributes:
    def test_allowed(self, svc):
        result = svc._sanitize_attributes({"bold": True, "italic": True})
        assert result == {"bold": True, "italic": True}

    def test_unknown_stripped(self, svc):
        result = svc._sanitize_attributes({"bold": True, "evil_attr": "hack"})
        assert "evil_attr" not in result

    def test_link_xss_blocked(self, svc):
        result = svc._sanitize_attributes({"link": "javascript:alert(1)"})
        assert "link" not in result

    def test_link_data_blocked(self, svc):
        result = svc._sanitize_attributes({"link": "data:text/html,evil"})
        assert "link" not in result

    def test_link_valid(self, svc):
        result = svc._sanitize_attributes({"link": "https://example.com"})
        assert result["link"] == "https://example.com"

    def test_list_valid(self, svc):
        result = svc._sanitize_attributes({"list": "ordered"})
        assert result["list"] == "ordered"

    def test_list_invalid(self, svc):
        result = svc._sanitize_attributes({"list": "invalid_value"})
        assert "list" not in result

    def test_align_valid(self, svc):
        result = svc._sanitize_attributes({"align": "center"})
        assert result["align"] == "center"

    def test_align_invalid(self, svc):
        result = svc._sanitize_attributes({"align": "stretch"})
        assert "align" not in result


# ═══════════════════════════════════════════════════════════════════
# _sanitize_image_ref
# ═══════════════════════════════════════════════════════════════════


class TestSanitizeImageRef:
    def test_normal(self, svc):
        assert svc._sanitize_image_ref("path/to/img.png") == "path/to/img.png"

    def test_empty(self, svc):
        assert svc._sanitize_image_ref("  ") is None

    def test_javascript_blocked(self, svc):
        assert svc._sanitize_image_ref("javascript:alert(1)") is None

    def test_data_uri_blocked(self, svc):
        assert svc._sanitize_image_ref("data:image/png;base64,abc") is None

    def test_dotdot_blocked(self, svc):
        assert svc._sanitize_image_ref("../../etc/passwd") is None

    def test_leading_slash_stripped(self, svc):
        assert svc._sanitize_image_ref("/path/img.png") == "path/img.png"

    def test_backslash_normalized(self, svc):
        assert svc._sanitize_image_ref("path\\to\\img.png") == "path/to/img.png"

    def test_api_local_image(self, svc):
        result = svc._sanitize_image_ref("/api/local-image?path=complexes/theories/th1/images/img.png")
        assert result == "complexes/theories/th1/images/img.png"

    def test_api_local_image_no_path(self, svc):
        assert svc._sanitize_image_ref("/api/local-image?other=val") is None


# ═══════════════════════════════════════════════════════════════════
# _sanitize_images_list
# ═══════════════════════════════════════════════════════════════════


class TestSanitizeImagesList:
    def test_none(self, svc):
        assert svc._sanitize_images_list(None) == []

    def test_not_list(self, svc):
        with pytest.raises(TheoryValidationError):
            svc._sanitize_images_list("bad")

    def test_filters(self, svc):
        result = svc._sanitize_images_list(["img.png", 123, "javascript:x", "ok.jpg"])
        assert result == ["img.png", "ok.jpg"]

    def test_deduplicates(self, svc):
        result = svc._sanitize_images_list(["img.png", "img.png"])
        assert result == ["img.png"]


# ═══════════════════════════════════════════════════════════════════
# CRUD: create / get / update / list
# ═══════════════════════════════════════════════════════════════════


class TestCRUD:
    def test_create_and_get(self, svc):
        result = svc.create_theory({"title": "Test Theory", "delta": {"ops": [{"insert": "Hello\n"}]}})
        assert result["title"] == "Test Theory"
        assert "id" in result
        fetched = svc.get_theory(result["id"])
        assert fetched["title"] == "Test Theory"

    def test_create_not_dict(self, svc):
        with pytest.raises(TheoryValidationError):
            svc.create_theory("bad")

    def test_create_duplicate_id(self, svc):
        svc.create_theory({"id": "th_dup", "title": "A"})
        with pytest.raises(TheoryValidationError, match="already_exists"):
            svc.create_theory({"id": "th_dup", "title": "B"})

    def test_get_not_found(self, svc):
        with pytest.raises(TheoryNotFoundError):
            svc.get_theory("th_nonexistent")

    def test_get_without_delta(self, svc):
        created = svc.create_theory({"title": "T"})
        result = svc.get_theory(created["id"], include_delta=False)
        assert "delta" not in result

    def test_update_title(self, svc):
        created = svc.create_theory({"title": "Old"})
        updated = svc.update_theory(created["id"], {"title": "New"})
        assert updated["title"] == "New"

    def test_update_not_dict(self, svc):
        created = svc.create_theory({"title": "T"})
        with pytest.raises(TheoryValidationError):
            svc.update_theory(created["id"], "bad")

    def test_update_not_found(self, svc):
        with pytest.raises(TheoryNotFoundError):
            svc.update_theory("th_missing", {"title": "X"})

    def test_update_version_conflict(self, svc):
        created = svc.create_theory({"title": "T"})
        with pytest.raises(TheoryConflictError):
            svc.update_theory(created["id"], {"title": "X"}, expected_version="wrong_version")

    def test_list_empty(self, svc):
        assert svc.list_theories() == []

    def test_list_with_query(self, svc):
        svc.create_theory({"title": "Alpha Theory"})
        svc.create_theory({"title": "Beta Theory"})
        results = svc.list_theories(query="alpha")
        assert len(results) == 1
        assert results[0]["title"] == "Alpha Theory"

    def test_list_all(self, svc):
        svc.create_theory({"title": "A"})
        svc.create_theory({"title": "B"})
        assert len(svc.list_theories()) == 2


# ═══════════════════════════════════════════════════════════════════
# clone_theory
# ═══════════════════════════════════════════════════════════════════


class TestCloneTheory:
    def test_clone(self, svc):
        created = svc.create_theory({"title": "Original", "delta": {"ops": [{"insert": "Content\n"}]}})
        cloned = svc.clone_theory(created["id"])
        assert cloned["id"] != created["id"]
        assert "copy" in cloned["title"].lower()
        assert cloned["delta"]["ops"][0]["insert"] == "Content\n"

    def test_clone_custom_title(self, svc):
        created = svc.create_theory({"title": "Orig"})
        cloned = svc.clone_theory(created["id"], title="Custom Clone")
        assert cloned["title"] == "Custom Clone"

    def test_clone_not_found(self, svc):
        with pytest.raises(TheoryNotFoundError):
            svc.clone_theory("th_missing")


# ═══════════════════════════════════════════════════════════════════
# History
# ═══════════════════════════════════════════════════════════════════


class TestHistory:
    def test_history_empty(self, svc):
        created = svc.create_theory({"title": "T"})
        assert svc.get_history(created["id"]) == []

    def test_update_creates_history(self, svc):
        created = svc.create_theory({"title": "V1"})
        svc.update_theory(created["id"], {"title": "V2"})
        history = svc.get_history(created["id"])
        assert len(history) >= 1

    def test_restore_from_history(self, svc):
        created = svc.create_theory({"title": "V1", "delta": {"ops": [{"insert": "old\n"}]}})
        svc.update_theory(created["id"], {"title": "V2", "delta": {"ops": [{"insert": "new\n"}]}})
        history = svc.get_history(created["id"])
        assert len(history) >= 1
        snapshot_ts = history[0]["_snapshot_timestamp"]
        restored = svc.restore_from_history(created["id"], snapshot_ts)
        assert restored["title"] == "V1"

    def test_restore_not_found_snapshot(self, svc):
        created = svc.create_theory({"title": "T"})
        with pytest.raises(TheoryNotFoundError, match="snapshot_not_found"):
            svc.restore_from_history(created["id"], "nonexistent_timestamp")


# ═══════════════════════════════════════════════════════════════════
# _collect_delta_image_refs / _remap_delta_images
# ═══════════════════════════════════════════════════════════════════


class TestDeltaImageHelpers:
    def test_collect(self, svc):
        delta = {"ops": [
            {"insert": {"image": "path/img1.png"}},
            {"insert": "text\n"},
            {"insert": {"image": "path/img2.png"}},
        ]}
        refs = svc._collect_delta_image_refs(delta)
        assert refs == ["path/img1.png", "path/img2.png"]

    def test_collect_deduplicates(self, svc):
        delta = {"ops": [
            {"insert": {"image": "img.png"}},
            {"insert": {"image": "img.png"}},
        ]}
        assert len(svc._collect_delta_image_refs(delta)) == 1

    def test_remap(self, svc):
        delta = {"ops": [{"insert": {"image": "old/img.png"}}, {"insert": "\n"}]}
        remap = {"old/img.png": "new/img.png"}
        result = svc._remap_delta_images(delta, remap)
        assert result["ops"][0]["insert"]["image"] == "new/img.png"
