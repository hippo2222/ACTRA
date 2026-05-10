import sys
from pathlib import Path
from types import SimpleNamespace

from flask import Flask


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

import routes.complexes_routes as complexes_routes
from services.linked_complex_runtime import build_linked_runtime_complex_id


class _FakeComplex:
    def __init__(self, payload):
        self._payload = dict(payload)

    def dict(self):
        return dict(self._payload)


def test_delete_complex_marks_catalog_source_deleted(monkeypatch):
    app = Flask(__name__)
    calls = []
    runtime_complex_id = build_linked_runtime_complex_id("complexlib_item_alpha")
    complex_payload = {
        "id": "complex_alpha",
        "workspace_entity_id": "workspace_complex_alpha",
        "workspace_entity_ref": "complex_alpha",
        "created_by_user_id": "author",
    }

    fake_complex_service = SimpleNamespace(
        get_complex=lambda complex_id: _FakeComplex(complex_payload)
        if complex_id == "complex_alpha"
        else None,
        delete_complex=lambda complex_id: calls.append(("delete_complex", complex_id)) or True,
        _complexes_cache={runtime_complex_id: object()},
    )
    fake_catalog_service = SimpleNamespace(
        handle_workspace_source_deleted=lambda *args, **kwargs: calls.append(
            ("handle_workspace_source_deleted", args, kwargs)
        )
        or {
            "ok": True,
            "affected_count": 1,
            "affected_library_entries": [
                {
                    "library_entry_id": "complexlib_item_alpha",
                    "user_id": "reader",
                    "catalog_item_id": "item_alpha",
                    "access_state": "deleted_source",
                }
            ],
        }
    )
    fake_session_repository = SimpleNamespace(
        delete_session=lambda complex_id, user_id: calls.append(("delete_session", complex_id, user_id)) or True
    )
    fake_active_session = SimpleNamespace(
        id="session_reader",
        complex_id=runtime_complex_id,
        user_id="reader",
    )
    fake_ctx = SimpleNamespace(
        user_id="author",
        complex_service=fake_complex_service,
        catalog_service=fake_catalog_service,
        session_api=SimpleNamespace(
            _session_manager=SimpleNamespace(
                _active_sessions={"session_reader": fake_active_session},
                session_repository=fake_session_repository,
            )
        ),
    )
    monkeypatch.setattr(complexes_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context("/api/complexes/complex_alpha", method="DELETE"):
        response = complexes_routes.delete_complex_endpoint("complex_alpha")

    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["catalog_source_delete"]["affected_count"] == 1
    assert payload["linked_runtime_cleanup"]["cleaned_count"] == 1
    assert fake_ctx.session_api._session_manager._active_sessions == {}
    assert fake_complex_service._complexes_cache == {}
    assert calls[0] == (
        "handle_workspace_source_deleted",
        ("complex",),
        {
            "owner_user_id": "author",
            "source_workspace_id": "workspace_complex_alpha",
            "source_workspace_ref": "complex_alpha",
            "source_workspace_kind": "complex",
            "reason": "author_deleted_workspace_complex",
        },
    )
    assert calls[1] == ("delete_complex", "complex_alpha")
    assert calls[2] == ("delete_session", runtime_complex_id, "reader")
    assert calls[3] == ("delete_session", "complex_alpha", "author")


def test_delete_complex_refuses_delete_when_catalog_source_delete_fails(monkeypatch):
    app = Flask(__name__)
    calls = []
    complex_payload = {
        "id": "complex_alpha",
        "workspace_entity_id": "workspace_complex_alpha",
        "workspace_entity_ref": "complex_alpha",
    }

    def fail_source_delete(*args, **kwargs):
        calls.append(("handle_workspace_source_deleted", args, kwargs))
        raise RuntimeError("catalog unavailable")

    fake_ctx = SimpleNamespace(
        user_id="author",
        complex_service=SimpleNamespace(
            get_complex=lambda complex_id: _FakeComplex(complex_payload),
            delete_complex=lambda complex_id: calls.append(("delete_complex", complex_id)) or True,
        ),
        catalog_service=SimpleNamespace(handle_workspace_source_deleted=fail_source_delete),
        session_api=SimpleNamespace(_session_manager=SimpleNamespace(session_repository=None)),
    )
    monkeypatch.setattr(complexes_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context("/api/complexes/complex_alpha", method="DELETE"):
        response, status = complexes_routes.delete_complex_endpoint("complex_alpha")

    payload = response.get_json()
    assert status == 409
    assert payload["ok"] is False
    assert payload["error"] == "catalog_source_delete_failed"
    assert [call[0] for call in calls] == ["handle_workspace_source_deleted"]
