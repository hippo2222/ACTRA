import sys
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

from flask import Flask


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

import routes.quick_access_routes as quick_access_routes
from services.hosted_shadow_fallback import HostedShadowWriteFallbackDisabledError
from services.linked_complex_runtime import build_linked_runtime_complex_id
from services.workspace_limits_service import PremiumArchivedContentError


def test_start_complex_session_force_clears_paused_session_before_restart(monkeypatch):
    app = Flask(__name__)
    paused_session = SimpleNamespace(id="paused_session_1")
    call_log = []

    def fake_cancel_session(session_id, user_id=None):
        call_log.append(("cancel", session_id, user_id))
        return True

    def fake_start_session(*, complex_id, user_id, start_iteration):
        call_log.append(("start", complex_id, user_id, start_iteration))
        return {"ok": True, "session_id": "new_session_1"}

    fake_session_api = SimpleNamespace(
        _session_manager=SimpleNamespace(cancel_session=fake_cancel_session),
        start_session=fake_start_session,
    )
    fake_ctx = SimpleNamespace(session_api=fake_session_api)

    monkeypatch.setattr(quick_access_routes, "get_ctx", lambda: fake_ctx)
    monkeypatch.setattr(
        quick_access_routes,
        "_find_paused_session",
        lambda session_api, complex_id, user_id: paused_session,
    )

    with app.test_request_context(
        "/api/session/complex_alpha/start",
        method="POST",
        json={"user_id": "audit_user", "force": True, "start_iteration": 3},
    ):
        response, status = quick_access_routes.start_complex_session("complex_alpha")

    assert status == 200
    assert response.get_json() == {"ok": True, "session_id": "new_session_1"}
    assert call_log == [
        ("cancel", "paused_session_1", "audit_user"),
        ("start", "complex_alpha", "audit_user", 3),
    ]


def test_start_complex_session_force_returns_conflict_when_paused_session_not_cleared(monkeypatch):
    app = Flask(__name__)
    paused_session = SimpleNamespace(id="paused_session_1")

    fake_session_api = SimpleNamespace(
        _session_manager=SimpleNamespace(cancel_session=lambda session_id, user_id=None: False),
        start_session=lambda **kwargs: {"ok": True, "session_id": "unexpected"},
    )
    fake_ctx = SimpleNamespace(session_api=fake_session_api)

    monkeypatch.setattr(quick_access_routes, "get_ctx", lambda: fake_ctx)
    monkeypatch.setattr(
        quick_access_routes,
        "_find_paused_session",
        lambda session_api, complex_id, user_id: paused_session,
    )

    with app.test_request_context(
        "/api/session/complex_alpha/start",
        method="POST",
        json={"user_id": "audit_user", "force": True},
    ):
        response, status = quick_access_routes.start_complex_session("complex_alpha")

    assert status == 409
    assert response.get_json() == {"ok": False, "error": "failed_to_clear_paused_session"}


def test_start_complex_session_blocks_repository_restored_active_session(monkeypatch):
    app = Flask(__name__)
    now = datetime.utcnow()
    orphan_session = SimpleNamespace(
        id="session_orphan",
        user_id="audit_user",
        complex_id="complex_alpha",
        paused=False,
        paused_at=None,
        is_active=True,
        ui_state={
            "screen_type": "task",
            "task_ref": "module/topic/task_001",
            "task_index": 0,
        },
        start_time=now - timedelta(minutes=5),
    )

    def fake_mark_interrupted_session_as_paused(session):
        session.paused = True
        session.paused_at = now
        return session

    repo = SimpleNamespace(load_session=lambda complex_id, user_id: orphan_session)
    fake_session_api = SimpleNamespace(
        _session_manager=SimpleNamespace(session_repository=repo, _active_sessions={}),
        mark_interrupted_session_as_paused=fake_mark_interrupted_session_as_paused,
        start_session=lambda **kwargs: {"ok": True, "session_id": "unexpected"},
    )
    fake_ctx = SimpleNamespace(session_api=fake_session_api)

    monkeypatch.setattr(quick_access_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/session/complex_alpha/start",
        method="POST",
        json={"user_id": "audit_user"},
    ):
        response, status = quick_access_routes.start_complex_session("complex_alpha")

    assert status == 409
    assert response.get_json() == {
        "ok": False,
        "error": "paused_session_exists",
        "session_id": "session_orphan",
        "paused_at": now.isoformat(),
    }


def test_start_complex_session_returns_explicit_degraded_response_for_blocked_hosted_write(monkeypatch):
    app = Flask(__name__)
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    fake_session_api = SimpleNamespace(
        _session_manager=SimpleNamespace(cancel_session=lambda session_id, user_id=None: True),
        start_session=lambda **kwargs: (_ for _ in ()).throw(
            HostedShadowWriteFallbackDisabledError("save_session", reason="postgres_dsn_missing")
        ),
    )
    fake_ctx = SimpleNamespace(session_api=fake_session_api)

    monkeypatch.setattr(quick_access_routes, "get_ctx", lambda: fake_ctx)
    monkeypatch.setattr(
        quick_access_routes,
        "_find_paused_session",
        lambda session_api, complex_id, user_id: None,
    )

    with app.test_request_context(
        "/api/session/complex_alpha/start",
        method="POST",
        json={"user_id": "audit_user", "start_iteration": 1},
    ):
        response, status = quick_access_routes.start_complex_session("complex_alpha")

    assert status == 503
    assert response.get_json() == {
        "ok": False,
        "error": "hosted_shadow_write_blocked",
        "degraded": True,
        "details": {
            "operation": "save_session",
            "reason": "postgres_dsn_missing",
            "runtime_mode": "hosted_web",
            "env_opt_in": "ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK",
        },
    }


def test_start_complex_session_blocks_premium_archived_complex(monkeypatch):
    app = Flask(__name__)
    start_calls = []

    archived_item = {
        "entity_kind": "complex",
        "scope": "workspace",
        "id": "complex_alpha",
        "ref": "complex_alpha",
        "limit_kind": "personal",
        "allowed_actions": {
            "list": True,
            "read": True,
            "delete": True,
            "edit": False,
            "start": False,
            "publish": False,
        },
    }

    def fake_assert_entity_not_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        raise PremiumArchivedContentError(
            entity_kind=entity_kind,
            entity_ref=entity_ref,
            action=action,
            plan="free",
            limit_kind="personal",
            archived_item=archived_item,
        )

    fake_session_api = SimpleNamespace(
        _session_manager=SimpleNamespace(cancel_session=lambda session_id, user_id=None: True),
        start_session=lambda **kwargs: start_calls.append(kwargs) or {"ok": True},
    )
    fake_ctx = SimpleNamespace(
        session_api=fake_session_api,
        workspace_limits_service=SimpleNamespace(assert_entity_not_archived=fake_assert_entity_not_archived),
    )

    monkeypatch.setattr(quick_access_routes, "get_ctx", lambda: fake_ctx)
    monkeypatch.setattr(
        quick_access_routes,
        "_find_paused_session",
        lambda session_api, complex_id, user_id: None,
    )

    with app.test_request_context(
        "/api/session/complex_alpha/start",
        method="POST",
        json={"user_id": "audit_user", "start_iteration": 1},
    ):
        response, status = quick_access_routes.start_complex_session("complex_alpha")

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["action"] == "start"
    assert start_calls == []


def test_start_complex_session_blocks_deleted_source_linked_complex(monkeypatch):
    app = Flask(__name__)
    start_calls = []
    runtime_complex_id = build_linked_runtime_complex_id("complexlib_item_alpha")

    fake_session_api = SimpleNamespace(
        start_session=lambda **kwargs: start_calls.append(kwargs) or {"ok": True},
    )
    fake_catalog_service = SimpleNamespace(
        get_complex_library_entry=lambda library_entry_id, *, requested_by_user_id: {
            "ok": True,
            "library_entry": {
                "library_entry_id": library_entry_id,
                "access_state": "deleted_source",
                "access_reason": "Source complex was deleted by the author.",
            },
            "snapshot": None,
        }
    )
    fake_ctx = SimpleNamespace(
        session_api=fake_session_api,
        catalog_service=fake_catalog_service,
        workspace_limits_service=SimpleNamespace(
            assert_entity_not_archived=lambda *args, **kwargs: {
                "workspace_access_state": "active",
                "is_premium_archived": False,
            }
        ),
    )

    monkeypatch.setattr(quick_access_routes, "get_ctx", lambda: fake_ctx)
    monkeypatch.setattr(
        quick_access_routes,
        "_find_paused_session",
        lambda session_api, complex_id, user_id: None,
    )

    with app.test_request_context(
        f"/api/session/{runtime_complex_id}/start",
        method="POST",
        json={"user_id": "reader", "start_iteration": 1},
    ):
        response, status = quick_access_routes.start_complex_session(runtime_complex_id)

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "complex_library_entry_not_accessible"
    assert payload["access_state"] == "deleted_source"
    assert payload["message"] == "Source complex was deleted by the author."
    assert payload["library_entry_id"] == "complexlib_item_alpha"
    assert payload["resolution_actions"] == ["remove_from_library"]
    assert start_calls == []


def test_start_old_paused_linked_complex_returns_deleted_source_message(monkeypatch):
    app = Flask(__name__)
    start_calls = []
    paused_session = SimpleNamespace(id="paused_linked_session")
    runtime_complex_id = build_linked_runtime_complex_id("complexlib_item_deleted")

    fake_session_api = SimpleNamespace(
        _session_manager=SimpleNamespace(cancel_session=lambda session_id, user_id=None: True),
        start_session=lambda **kwargs: start_calls.append(kwargs) or {"ok": True},
    )
    fake_catalog_service = SimpleNamespace(
        get_complex_library_entry=lambda library_entry_id, *, requested_by_user_id: {
            "ok": True,
            "library_entry": {
                "library_entry_id": library_entry_id,
                "access_state": "deleted_source",
                "access_reason": "Source complex was deleted by the author.",
            },
            "snapshot": None,
        }
    )
    fake_ctx = SimpleNamespace(
        session_api=fake_session_api,
        catalog_service=fake_catalog_service,
        workspace_limits_service=SimpleNamespace(
            assert_entity_not_archived=lambda *args, **kwargs: {
                "workspace_access_state": "active",
                "is_premium_archived": False,
            }
        ),
    )

    monkeypatch.setattr(quick_access_routes, "get_ctx", lambda: fake_ctx)
    monkeypatch.setattr(
        quick_access_routes,
        "_find_paused_session",
        lambda session_api, complex_id, user_id: paused_session,
    )

    with app.test_request_context(
        f"/api/session/{runtime_complex_id}/start",
        method="POST",
        json={"user_id": "reader", "force": True},
    ):
        response, status = quick_access_routes.start_complex_session(runtime_complex_id)

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "complex_library_entry_not_accessible"
    assert payload["message"] == "Source complex was deleted by the author."
    assert payload["access_state"] == "deleted_source"
    assert payload["resolution_actions"] == ["remove_from_library"]
    assert "session_id" not in payload
    assert start_calls == []


def test_get_quick_access_marks_repository_restored_active_session_as_paused(monkeypatch):
    app = Flask(__name__)
    now = datetime.utcnow()
    orphan_session = SimpleNamespace(
        id="session_orphan",
        user_id="audit_user",
        complex_id="complex_alpha",
        paused=False,
        paused_at=None,
        start_time=now - timedelta(minutes=5),
        end_time=None,
        iteration=1,
        current_task_index=1,
        queue=[object(), object()],
        is_active=True,
        ui_state={
            "screen_type": "task",
            "task_ref": "module/topic/task_001",
            "task_index": 0,
        },
    )

    def fake_mark_interrupted_session_as_paused(session):
        session.paused = True
        session.paused_at = now
        session.paused_resume_target = {
            "screen_type": "task",
            "url": "/ui/session/session_orphan",
            "task_ref": "module/topic/task_001",
            "task_index": 0,
        }
        return session

    repo = SimpleNamespace(
        list_active_sessions=lambda user_id: (
            [{"session_id": "session_orphan"}] if user_id == "audit_user" else []
        ),
        load_session_by_session_id=lambda user_id, session_id: (
            orphan_session
            if user_id == "audit_user" and session_id == "session_orphan"
            else None
        ),
    )
    fake_session_api = SimpleNamespace(
        _session_manager=SimpleNamespace(session_repository=repo),
        mark_interrupted_session_as_paused=fake_mark_interrupted_session_as_paused,
        get_resume_target=lambda session: session.paused_resume_target,
    )
    fake_ctx = SimpleNamespace(
        session_api=fake_session_api,
        statistics_service=SimpleNamespace(get_complex_statistics=lambda user_id: {}),
    )

    monkeypatch.setattr(quick_access_routes, "get_ctx", lambda: fake_ctx)
    monkeypatch.setattr(quick_access_routes, "get_extra", lambda name: None)
    monkeypatch.setattr(quick_access_routes, "_resolve_effective_user_id", lambda raw: "audit_user")
    monkeypatch.setattr(
        quick_access_routes,
        "_read_ui_state",
        lambda user_id: {"version": 1, "user_id": user_id, "pinned": [], "recent": []},
    )
    monkeypatch.setattr(
        quick_access_routes,
        "_get_complex_by_id",
        lambda complex_id: {"id": complex_id, "name": "Complex Alpha"},
    )

    with app.test_request_context("/api/ui/quick-access?user_id=audit_user", method="GET"):
        response = quick_access_routes.get_quick_access()

    payload = response.get_json()

    assert payload["paused_complex_ids"] == ["complex_alpha"]
    assert payload["items"][0]["complex"]["id"] == "complex_alpha"
    assert payload["items"][0]["paused_session"]["paused"] is True
    assert payload["items"][0]["paused_session"]["session_id"] == "session_orphan"
