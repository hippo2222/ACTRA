import sys
from pathlib import Path
from types import SimpleNamespace

from flask import Flask


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

import routes.billing_routes as billing_routes


def _make_app():
    app = Flask(__name__)
    app.register_blueprint(billing_routes.billing_bp)
    return app


def test_create_billing_order_requires_auth(monkeypatch):
    app = _make_app()
    monkeypatch.setattr(billing_routes, "is_hosted_web_runtime", lambda: True)
    monkeypatch.setattr(billing_routes, "get_authenticated_user_id", lambda: "")

    with app.test_client() as client:
        response = client.post("/api/billing/orders", json={"period_days": 30})

    assert response.status_code == 401
    assert response.get_json()["error"] == "authentication_required"


def test_create_billing_order(monkeypatch):
    app = _make_app()
    fake_billing = SimpleNamespace(
        create_order=lambda user_id, period_days: {
            "order_id": "bill_1",
            "user_id": user_id,
            "period_days": period_days,
            "status": "pending",
        }
    )
    monkeypatch.setattr(billing_routes, "is_hosted_web_runtime", lambda: True)
    monkeypatch.setattr(billing_routes, "get_authenticated_user_id", lambda: "user_1")
    monkeypatch.setattr(billing_routes, "get_ctx", lambda: SimpleNamespace(billing_service=fake_billing))

    with app.test_client() as client:
        response = client.post("/api/billing/orders", json={"period_days": 30})

    assert response.status_code == 201
    assert response.get_json()["order"]["period_days"] == 30


def test_admin_grant_user_premium(monkeypatch):
    app = _make_app()
    fake_billing = SimpleNamespace(
        grant_premium=lambda user_id, period_days, admin_user_id="": {
            "user": {
                "user_id": user_id,
                "effective_plan": "premium",
                "premium_expires_at": "2026-06-07T00:00:00Z",
            }
        }
    )
    monkeypatch.setattr(billing_routes, "is_hosted_web_runtime", lambda: True)
    monkeypatch.setattr(billing_routes, "get_authenticated_user_id", lambda: "admin_1")
    monkeypatch.setattr(billing_routes, "current_user_is_hosted_admin", lambda: True)
    monkeypatch.setattr(billing_routes, "get_ctx", lambda: SimpleNamespace(billing_service=fake_billing))

    with app.test_client() as client:
        response = client.post("/api/admin/users/user_1/premium/grant", json={"period_days": 30})

    assert response.status_code == 200
    assert response.get_json()["user"]["effective_plan"] == "premium"
