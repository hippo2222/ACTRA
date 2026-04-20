import sys
from pathlib import Path
from types import SimpleNamespace

from flask import Flask


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

import routes.admin_routes as admin_routes


def _make_app():
    app = Flask(__name__)
    app.register_blueprint(admin_routes.admin_bp)
    return app


def test_admin_list_users_requires_admin(monkeypatch):
    app = _make_app()

    monkeypatch.setattr(admin_routes, "is_hosted_web_runtime", lambda: True)
    monkeypatch.setattr(admin_routes, "get_authenticated_user_id", lambda: "user_1")
    monkeypatch.setattr(admin_routes, "get_authenticated_hosted_user", lambda: SimpleNamespace(user_id="user_1", role="user"))
    monkeypatch.setattr(admin_routes, "current_user_is_hosted_admin", lambda: False)

    with app.test_client() as client:
        response = client.get("/api/admin/users")

    assert response.status_code == 403
    assert response.get_json()["error"] == "admin_required"


def test_admin_list_users_returns_compact_payload(monkeypatch):
    app = _make_app()
    fake_service = SimpleNamespace(
        search_users=lambda query: [
            SimpleNamespace(
                user_id="user_1",
                name="Alice",
                login="alice",
                email="alice@actra.site",
                role="user",
                plan="premium",
                created_at="2026-04-20T10:00:00Z",
            )
        ]
    )

    monkeypatch.setattr(admin_routes, "is_hosted_web_runtime", lambda: True)
    monkeypatch.setattr(admin_routes, "get_authenticated_user_id", lambda: "admin_1")
    monkeypatch.setattr(admin_routes, "get_authenticated_hosted_user", lambda: SimpleNamespace(user_id="admin_1", role="admin"))
    monkeypatch.setattr(admin_routes, "current_user_is_hosted_admin", lambda: True)
    monkeypatch.setattr(admin_routes, "get_ctx", lambda: SimpleNamespace(user_service=fake_service))

    with app.test_client() as client:
        response = client.get("/api/admin/users?query=ali")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["query"] == "ali"
    assert payload["users"] == [
        {
            "user_id": "user_1",
            "name": "Alice",
            "login": "alice",
            "email": "alice@actra.site",
            "role": "user",
            "plan": "premium",
            "created_at": "2026-04-20T10:00:00Z",
        }
    ]


def test_admin_update_user_plan_rejects_role_change(monkeypatch):
    app = _make_app()

    monkeypatch.setattr(admin_routes, "is_hosted_web_runtime", lambda: True)
    monkeypatch.setattr(admin_routes, "get_authenticated_user_id", lambda: "admin_1")
    monkeypatch.setattr(admin_routes, "get_authenticated_hosted_user", lambda: SimpleNamespace(user_id="admin_1", role="admin"))
    monkeypatch.setattr(admin_routes, "current_user_is_hosted_admin", lambda: True)
    monkeypatch.setattr(admin_routes, "get_ctx", lambda: SimpleNamespace(user_service=SimpleNamespace()))

    with app.test_client() as client:
        response = client.patch("/api/admin/users/user_1/plan", json={"plan": "premium", "role": "admin"})

    assert response.status_code == 400
    assert response.get_json()["error"] == "role_update_forbidden"


def test_admin_update_user_plan_updates_plan(monkeypatch):
    app = _make_app()
    fake_service = SimpleNamespace(
        set_user_plan=lambda user_id, plan, actor_user_id="": SimpleNamespace(
            user_id=user_id,
            name="Alice",
            login="alice",
            email="alice@actra.site",
            role="user",
            plan=plan,
            created_at="2026-04-20T10:00:00Z",
        )
    )

    monkeypatch.setattr(admin_routes, "is_hosted_web_runtime", lambda: True)
    monkeypatch.setattr(admin_routes, "get_authenticated_user_id", lambda: "admin_1")
    monkeypatch.setattr(admin_routes, "get_authenticated_hosted_user", lambda: SimpleNamespace(user_id="admin_1", role="admin"))
    monkeypatch.setattr(admin_routes, "current_user_is_hosted_admin", lambda: True)
    monkeypatch.setattr(admin_routes, "get_ctx", lambda: SimpleNamespace(user_service=fake_service))

    with app.test_client() as client:
        response = client.patch("/api/admin/users/user_1/plan", json={"plan": "premium"})

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["user"]["plan"] == "premium"
    assert payload["user"]["role"] == "user"
