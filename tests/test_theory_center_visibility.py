import os
import sys
from types import SimpleNamespace

ROOT_DIR = os.path.dirname(os.path.dirname(__file__))
DESKTOP_APP_DIR = os.path.join(ROOT_DIR, "desktop-app")
if DESKTOP_APP_DIR not in sys.path:
    sys.path.insert(0, DESKTOP_APP_DIR)

from routes.theory_center_routes import (  # type: ignore
    _is_visible_library_complex_for_current_user,
)
from routes import _helpers as route_helpers  # type: ignore


def test_theory_center_visible_complex_accepts_owned_complex():
    assert _is_visible_library_complex_for_current_user(
        {
            "ownership": {
                "is_owned_by_current_user": True,
                "created_via": "complex_builder",
            }
        }
    ) is True


def test_theory_center_visible_complex_accepts_imported_library_copy():
    assert _is_visible_library_complex_for_current_user(
        {
            "created_via": "workspace_import",
            "ownership": {
                "is_owned_by_current_user": False,
                "created_via": "workspace_import",
            },
        }
    ) is True
    assert _is_visible_library_complex_for_current_user(
        {
            "source_catalog_item_id": "catalog_complex_demo",
            "ownership": {
                "is_owned_by_current_user": False,
                "created_via": "manual_copy",
            },
        }
    ) is True


def test_theory_center_visible_complex_rejects_foreign_shared_complex():
    assert _is_visible_library_complex_for_current_user(
        {
            "ownership": {
                "is_owned_by_current_user": False,
                "created_via": "legacy_unknown",
            },
            "content_scope": "shared_local",
        }
    ) is False


def test_theory_center_visible_complex_rejects_foreign_imported_complex():
    assert _is_visible_library_complex_for_current_user(
        {
            "source_catalog_item_id": "catalog_complex_demo",
            "created_by_user_id": "other-user",
            "ownership": {
                "is_owned_by_current_user": False,
                "created_by_user_id": "other-user",
                "created_via": "manual_copy",
            },
        }
    ) is False


def test_compute_theory_usage_counts_linked_library_complex_theory(monkeypatch):
    fake_storage = SimpleNamespace(get_topic_theory_link=lambda module_id, topic_id: None)
    monkeypatch.setattr(route_helpers, "get_ctx", lambda: SimpleNamespace(storage_service=fake_storage))

    usage_stats, topic_theory_map = route_helpers.compute_theory_usage_stats(
        modules=[],
        complex_payloads=[
            {
                "id": "complex_1",
                "tasks": [],
                "theory_link": {
                    "source_kind": "linked_library",
                    "library_entry_id": "theory_library::catalog_theory_th_laguska::123",
                    "source_theory_id": "th_laguska",
                    "access_state": "active",
                },
                "theory_sync_meta": {
                    "theory_ids": ["th_laguska"],
                },
            }
        ],
    )

    assert topic_theory_map == {}
    assert usage_stats["th_laguska"]["topics"] == 0
    assert usage_stats["th_laguska"]["complexes"] == 1
