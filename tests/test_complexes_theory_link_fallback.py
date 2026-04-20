import os
import sys
from types import SimpleNamespace


ROOT_DIR = os.path.dirname(os.path.dirname(__file__))
DESKTOP_APP_DIR = os.path.join(ROOT_DIR, "desktop-app")
if DESKTOP_APP_DIR not in sys.path:
    sys.path.insert(0, DESKTOP_APP_DIR)

from routes import _helpers as route_helpers  # type: ignore
from routes import complexes_routes  # type: ignore


class _FailingCatalogService:
    def get_theory_library_entry(self, *_args, **_kwargs):
        raise ValueError("theory_library_entry_not_found")


class _NoPostgresCatalogService:
    def __init__(self):
        self.persistence_settings = SimpleNamespace(postgres_dsn="")

    def get_theory_library_entry(self, *_args, **_kwargs):
        raise AssertionError("catalog enrichment should be skipped when postgres dsn is missing")


class _FakeTheoryService:
    def get_theory(self, theory_id, include_delta=False):
        return {
            "id": theory_id,
            "title": "Attached theory",
            "updated_at": "2026-04-15T00:10:00",
            "created_by_user_id": "author",
            "updated_by_user_id": "author",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
            "workspace_entity_kind": "theory",
            "workspace_entity_id": theory_id,
            "workspace_entity_ref": theory_id,
            "workspace_entity": {
                "kind": "theory",
                "id": theory_id,
                "ref": theory_id,
            },
            "delta": {"ops": []} if include_delta else None,
        }


def _fake_ctx():
    return SimpleNamespace(
        user_id="author",
        catalog_service=_FailingCatalogService(),
        theory_service=_FakeTheoryService(),
    )


def test_build_theory_link_snapshot_falls_back_to_workspace_theory(monkeypatch):
    monkeypatch.setattr(route_helpers, "get_ctx", _fake_ctx)
    monkeypatch.setattr(route_helpers, "is_hosted_web_runtime", lambda: False)

    snapshot = route_helpers._build_theory_link_snapshot(
        {
            "source_kind": "linked_library",
            "library_entry_id": "theory_library::missing",
            "source_theory_id": "th_demo",
            "title_cache": "Old title",
        }
    )

    assert snapshot is not None
    assert snapshot["source_kind"] == "workspace"
    assert snapshot["theory_id"] == "th_demo"
    assert snapshot["title_cache"] == "Attached theory"
    assert snapshot.get("missing") is not True


def test_resolve_complex_theory_link_falls_back_to_workspace_theory(monkeypatch):
    monkeypatch.setattr(complexes_routes, "get_ctx", _fake_ctx)

    resolved, error = complexes_routes._resolve_complex_theory_link(
        {
            "source_kind": "linked_library",
            "library_entry_id": "theory_library::missing",
            "source_theory_id": "th_demo",
            "title_cache": "Old title",
        }
    )

    assert error is None
    assert resolved is not None
    assert resolved["source_kind"] == "workspace"
    assert resolved["theory_id"] == "th_demo"
    assert resolved["title_cache"] == "Attached theory"


def test_build_theory_link_snapshot_skips_catalog_enrichment_when_hosted_postgres_missing(monkeypatch):
    ctx = SimpleNamespace(
        user_id="author",
        catalog_service=_NoPostgresCatalogService(),
        theory_service=_FakeTheoryService(),
    )
    monkeypatch.setattr(route_helpers, "get_ctx", lambda: ctx)
    monkeypatch.setattr(route_helpers, "is_hosted_web_runtime", lambda: True)
    monkeypatch.setattr(route_helpers, "_resolve_effective_user_id", lambda value=None, fallback="default_user": "author")

    snapshot = route_helpers._build_theory_link_snapshot(
        {
            "source_kind": "linked_library",
            "library_entry_id": "theory_library::missing",
            "source_theory_id": "th_demo",
            "title_cache": "Old title",
        }
    )

    assert snapshot is not None
    assert snapshot["source_kind"] == "linked_library"
    assert snapshot["library_entry_id"] == "theory_library::missing"
    assert snapshot["source_theory_id"] == "th_demo"
    assert snapshot["title_cache"] == "Old title"
    assert snapshot["missing"] is True


def test_build_theory_link_snapshot_preserves_blocked_linked_library_state_in_hosted_runtime(monkeypatch):
    class _BlockedCatalogService:
        def __init__(self):
            self.persistence_settings = SimpleNamespace(postgres_dsn="postgres://ready")

        def get_theory_library_entry(self, *_args, **_kwargs):
            return {
                "library_entry": {
                    "library_entry_id": "theory_library::blocked",
                    "access_state": "requires_access_code",
                    "access_reason": "Need access code",
                },
                "item": {
                    "item_id": "catalog_theory_demo",
                    "source_workspace_id": "th_demo",
                },
                "snapshot": {},
            }

    ctx = SimpleNamespace(
        user_id="reader",
        catalog_service=_BlockedCatalogService(),
        theory_service=_FakeTheoryService(),
    )
    monkeypatch.setattr(route_helpers, "get_ctx", lambda: ctx)
    monkeypatch.setattr(route_helpers, "is_hosted_web_runtime", lambda: True)
    monkeypatch.setattr(
        route_helpers,
        "_resolve_effective_user_id",
        lambda value=None, fallback="default_user": "reader",
    )

    snapshot = route_helpers._build_theory_link_snapshot(
        {
            "source_kind": "linked_library",
            "library_entry_id": "theory_library::blocked",
            "catalog_item_id": "catalog_theory_demo",
            "source_theory_id": "th_demo",
            "title_cache": "Old title",
        }
    )

    assert snapshot is not None
    assert snapshot["source_kind"] == "linked_library"
    assert snapshot["library_entry_id"] == "theory_library::blocked"
    assert snapshot["access_state"] == "requires_access_code"
    assert snapshot["missing"] is True
