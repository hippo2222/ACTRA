import sys
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

from flask import Flask


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

import routes.session_routes as session_routes


def make_session(
    *,
    session_id,
    user_id,
    complex_id="complex_1",
    paused=False,
    is_active=True,
    queue_size=2,
    iteration=1,
    current_task_index=0,
):
    now = datetime.utcnow()
    return SimpleNamespace(
        id=session_id,
        user_id=user_id,
        complex_id=complex_id,
        paused=paused,
        paused_at=(now - timedelta(minutes=1)) if paused else None,
        start_time=now - timedelta(minutes=5),
        end_time=None,
        iteration=iteration,
        current_task_index=current_task_index,
        queue=[object() for _ in range(queue_size)],
        is_active=is_active,
        ui_state={},
    )


def test_resolve_active_sessions_user_id_prefers_ctx_user(monkeypatch):
    fake_ctx = SimpleNamespace(user_id="audit_user")
    fake_session_api = SimpleNamespace(default_user_id="default_user")

    monkeypatch.setattr(session_routes, "get_ctx", lambda: fake_ctx)
    import routes._helpers as session_helpers
    monkeypatch.setattr(session_helpers, "get_ctx", lambda: fake_ctx)

    assert session_routes._resolve_active_sessions_user_id(fake_session_api) == "audit_user"



def test_resolve_active_sessions_user_id_prefers_explicit_request_user(monkeypatch):
    fake_ctx = SimpleNamespace(user_id="default_user")
    fake_session_api = SimpleNamespace(default_user_id="default_user")

    monkeypatch.setattr(session_routes, "get_ctx", lambda: fake_ctx)

    assert (
        session_routes._resolve_active_sessions_user_id(
            fake_session_api,
            requested_user_id="audit_user",
        )
        == "audit_user"
    )


def test_list_active_session_items_merges_repo_and_memory_for_same_user():
    persisted = make_session(session_id="session_repo", user_id="audit_user", complex_id="complex_repo")
    memory = make_session(
        session_id="session_mem",
        user_id="audit_user",
        complex_id="complex_mem",
        paused=True,
        iteration=2,
        current_task_index=1,
        queue_size=3,
    )
    foreign = make_session(session_id="session_foreign", user_id="other_user", complex_id="complex_other")

    repo = SimpleNamespace(load_all_sessions=lambda user_id: [persisted] if user_id == "audit_user" else [])
    session_manager = SimpleNamespace(
        session_repository=repo,
        _active_sessions={
            persisted.id: persisted,
            memory.id: memory,
            foreign.id: foreign,
        },
    )
    fake_session_api = SimpleNamespace(
        _session_manager=session_manager,
        get_resume_target=lambda session: {
            "screen_type": "iteration_results" if getattr(session, "paused", False) else "task",
            "url": f"/session/{session.id}/iteration/1" if getattr(session, "paused", False) else f"/session/{session.id}",
        },
    )

    items = session_routes._list_active_session_items(fake_session_api, "audit_user")

    by_id = {item["session_id"]: item for item in items}

    assert set(by_id.keys()) == {"session_repo", "session_mem"}
    assert by_id["session_mem"]["paused"] is True
    assert by_id["session_mem"]["resume_target"]["url"] == "/session/session_mem/iteration/1"
    assert by_id["session_mem"]["total_tasks"] == 3
    assert by_id["session_mem"]["iteration"] == 2
    assert by_id["session_mem"]["current_task_index"] == 1
    assert by_id["session_mem"]["display_task_index"] == 0
    assert by_id["session_repo"]["complex_id"] == "complex_repo"


def test_list_active_session_items_prefers_in_memory_state_over_repo_snapshot():
    repo_session = make_session(session_id="session_1", user_id="audit_user", paused=False)
    memory_session = make_session(session_id="session_1", user_id="audit_user", paused=True)

    repo = SimpleNamespace(load_all_sessions=lambda user_id: [repo_session])
    session_manager = SimpleNamespace(
        session_repository=repo,
        _active_sessions={memory_session.id: memory_session},
    )
    fake_session_api = SimpleNamespace(_session_manager=session_manager)

    items = session_routes._list_active_session_items(fake_session_api, "audit_user")

    assert len(items) == 1
    assert items[0]["session_id"] == "session_1"
    assert items[0]["paused"] is True


def test_list_active_session_items_marks_repository_restored_active_session_as_paused_after_restart():
    persisted = make_session(
        session_id="session_repo",
        user_id="audit_user",
        complex_id="complex_repo",
        paused=False,
    )
    persisted.ui_state = {
        "screen_type": "task",
        "task_ref": "module/topic/task_001",
        "task_index": 0,
    }
    normalized_calls = []

    def fake_mark_interrupted_session_as_paused(session):
        normalized_calls.append(session.id)
        session.paused = True
        session.paused_at = datetime.utcnow()
        return session

    repo = SimpleNamespace(load_all_sessions=lambda user_id: [persisted])
    session_manager = SimpleNamespace(
        session_repository=repo,
        _active_sessions={},
    )
    fake_session_api = SimpleNamespace(
        _session_manager=session_manager,
        mark_interrupted_session_as_paused=fake_mark_interrupted_session_as_paused,
        get_resume_target=lambda session: {"screen_type": "task", "url": f"/session/{session.id}"},
    )

    items = session_routes._list_active_session_items(fake_session_api, "audit_user")

    assert len(items) == 1
    assert items[0]["session_id"] == "session_repo"
    assert items[0]["paused"] is True
    assert normalized_calls == ["session_repo"]


def test_resolve_display_task_index_prefers_ui_state_task_index():
    session = make_session(
        session_id="session_ui",
        user_id="audit_user",
        queue_size=4,
        current_task_index=2,
    )
    session.ui_state = {
        "screen_type": "task",
        "task_ref": "module/topic/task_001",
        "task_index": 0,
    }

    fake_session_api = SimpleNamespace(
        _resolve_current_queue_slot=lambda loaded: (object(), 0)
    )

    assert session_routes._resolve_display_task_index(fake_session_api, session) == 0


def test_resolve_display_task_index_falls_back_to_previous_queue_slot():
    session = make_session(
        session_id="session_fallback",
        user_id="audit_user",
        queue_size=5,
        current_task_index=2,
    )
    fake_session_api = SimpleNamespace()

    assert session_routes._resolve_display_task_index(fake_session_api, session) == 1


def test_pause_session_route_prefers_explicit_user_id_from_request(monkeypatch):
    app = Flask(__name__)
    session = make_session(session_id="session_pause", user_id="audit_user", paused=False)
    fake_session_api = SimpleNamespace()
    fake_session_api.get_session_calls = []
    fake_session_api.pause_calls = []

    def fake_get_session(session_id, user_id=None):
        fake_session_api.get_session_calls.append((session_id, user_id))
        return session

    def fake_pause_session(session_id, **kwargs):
        fake_session_api.pause_calls.append((session_id, kwargs))
        session.paused = True

    fake_session_api.get_session = fake_get_session
    fake_session_api.pause_session = fake_pause_session

    fake_ctx = SimpleNamespace(user_id="default_user", session_api=fake_session_api)
    monkeypatch.setattr(session_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/session/session_pause/pause",
        method="POST",
        json={"user_id": "audit_user"},
    ):
        response = session_routes.pause_session("session_pause")

    assert response.get_json()["ok"] is True
    assert fake_session_api.get_session_calls == [
        ("session_pause", "audit_user"),
        ("session_pause", "audit_user"),
    ]
    assert fake_session_api.pause_calls == [
        ("session_pause", {"user_id": "audit_user", "user_input": None, "evaluation_result": None, "view_state": None, "task_ref": None, "task_index": None, "resume_target": None}),
    ]


def test_pause_session_route_forwards_explicit_resume_target(monkeypatch):
    app = Flask(__name__)
    session = make_session(session_id="session_pause", user_id="audit_user", paused=False)
    fake_session_api = SimpleNamespace()
    fake_session_api.pause_calls = []

    def fake_get_session(session_id, user_id=None):
        return session

    def fake_pause_session(session_id, **kwargs):
        fake_session_api.pause_calls.append((session_id, kwargs))
        session.paused = True

    fake_session_api.get_session = fake_get_session
    fake_session_api.pause_session = fake_pause_session

    fake_ctx = SimpleNamespace(user_id="default_user", session_api=fake_session_api)
    monkeypatch.setattr(session_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/session/session_pause/pause",
        method="POST",
        json={
            "user_id": "audit_user",
            "resume_target": {
                "screen_type": "iteration_results",
                "iteration_number": 1,
                "url": "/session/session_pause/iteration/1",
            },
        },
    ):
        response = session_routes.pause_session("session_pause")

    assert response.get_json()["ok"] is True
    assert fake_session_api.pause_calls == [
        (
            "session_pause",
            {
                "user_id": "audit_user",
                "user_input": None,
                "evaluation_result": None,
                "view_state": None,
                "task_ref": None,
                "task_index": None,
                "resume_target": {
                    "screen_type": "iteration_results",
                    "iteration_number": 1,
                    "url": "/session/session_pause/iteration/1",
                },
            },
        ),
    ]


def test_resume_session_route_returns_resume_target(monkeypatch):
    app = Flask(__name__)
    session = make_session(session_id="session_resume", user_id="audit_user", paused=True)
    session.ui_state = {"screen_type": "iteration_results", "iteration_number": 1}
    resume_calls = []
    target_calls = []

    def fake_resume_session(session_id, user_id=None, source=None):
        resume_calls.append((session_id, user_id, source))
        return session

    def fake_get_resume_target(loaded_session):
        target_calls.append(loaded_session)
        return {
            "screen_type": "iteration_results",
            "iteration_number": 1,
            "url": "/session/session_resume/iteration/1",
        }

    fake_session_api = SimpleNamespace(
        resume_session=fake_resume_session,
        get_resume_target=fake_get_resume_target,
    )

    fake_ctx = SimpleNamespace(user_id="default_user", session_api=fake_session_api)
    monkeypatch.setattr(session_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/session/session_resume/resume",
        method="POST",
        json={"user_id": "audit_user"},
    ):
        response = session_routes.resume_session("session_resume")

    assert response.get_json() == {
        "ok": True,
        "paused": False,
        "resume_target": {
            "screen_type": "iteration_results",
            "iteration_number": 1,
            "url": "/session/session_resume/iteration/1",
        },
    }
    assert resume_calls == [("session_resume", "audit_user", "http_resume")]
    assert target_calls == [session]


def test_cancel_session_route_prefers_explicit_user_id_from_request(monkeypatch):
    app = Flask(__name__)
    cancel_calls = []

    def fake_cancel_session(session_id, user_id=None):
        cancel_calls.append((session_id, user_id))
        return {"ok": True}

    fake_session_api = SimpleNamespace(cancel_session=fake_cancel_session)
    fake_ctx = SimpleNamespace(user_id="default_user", session_api=fake_session_api)
    monkeypatch.setattr(session_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/session/session_cancel/cancel",
        method="POST",
        json={"user_id": "audit_user"},
    ):
        response, status = session_routes.cancel_session("session_cancel")

    assert status == 200
    assert response.get_json() == {"ok": True}
    assert cancel_calls == [("session_cancel", "audit_user")]


def test_iteration_results_route_forwards_requested_iteration(monkeypatch):
    app = Flask(__name__)
    calls = []

    def fake_get_iteration_results(session_id, iteration_number=None, user_id=None):
        calls.append((session_id, iteration_number, user_id))
        return {"iteration": 1, "total_tasks": 1}

    fake_session_api = SimpleNamespace(get_iteration_results=fake_get_iteration_results)
    fake_ctx = SimpleNamespace(user_id="audit_user", session_api=fake_session_api)
    monkeypatch.setattr(session_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/session/session_resume/iteration-results?iteration=1",
        method="GET",
    ):
        response = session_routes.get_iteration_results("session_resume")

    assert response.get_json()["ok"] is True
    assert response.get_json()["results"]["iteration"] == 1
    assert calls == [("session_resume", 1, "audit_user")]

