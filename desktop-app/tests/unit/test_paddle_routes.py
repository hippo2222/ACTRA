from __future__ import annotations

import hashlib
import hmac
import json
import tempfile
from pathlib import Path

import pytest
from flask import Flask

from routes.paddle_routes import paddle_bp
from services.paddle_service import PaddleService
from services.user_service import USER_PLAN_FREE, User, UserService


class DummyBillingService:
    pass


@pytest.fixture
def temp_dir():
    with tempfile.TemporaryDirectory() as tmp:
        yield Path(tmp)


@pytest.fixture
def user_service(temp_dir):
    service = UserService(data_dir=str(temp_dir))
    user_dir = temp_dir / "users" / "user_route_test"
    user_dir.mkdir(parents=True, exist_ok=True)
    (user_dir / "profile.json").write_text(
        '{"user_id":"user_route_test","profile":{"name":"Route User","created_at":"2026-07-04T12:00:00Z","login":"route_user","email":"route@example.com","plan":"free"}}',
        encoding="utf-8",
    )
    return service


@pytest.fixture
def paddle_service(user_service, temp_dir):
    return PaddleService(
        billing_service=DummyBillingService(),
        user_service=user_service,
        data_dir=str(temp_dir),
        environment="production",
        webhook_secret="secret_for_route_tests_123",
        client_token="test_client_token_abc",
    )


@pytest.fixture
def app(paddle_service, user_service):
    app = Flask(__name__)
    app.register_blueprint(paddle_bp)

    class DummyCtx:
        def __init__(self):
            self.paddle_service = paddle_service
            self.user_service = user_service
            self.user_id = "user_route_test"

    from routes import _context
    _context.init_context(DummyCtx())

    yield app


@pytest.fixture
def client(app):
    return app.test_client()


def test_paddle_config_endpoint(client):
    res = client.get("/api/billing/paddle/config")
    assert res.status_code == 200
    data = res.get_json()
    assert data["ok"] is True
    assert data["environment"] == "production"
    assert data["client_token"] == "test_client_token_abc"
    assert "prices" in data


def test_paddle_webhook_endpoint_invalid_sig(client):
    res = client.post(
        "/api/webhooks/paddle",
        data=b'{"event_id": "evt_test"}',
        headers={"Content-Type": "application/json", "Paddle-Signature": "ts=100;h1=invalid"},
    )
    assert res.status_code == 400
    assert res.get_json()["error"] == "invalid_signature"


def test_paddle_webhook_endpoint_valid(client, user_service):
    raw_body = b'{"event_id":"evt_http_001","event_type":"transaction.completed","data":{"id":"txn_http","custom_data":{"user_id":"user_route_test"},"items":[{"price":{"id":"pri_01kwqccmf32mnnt98ek3d3xapf"}}]}}'
    ts = "1700000000"
    signed_payload = f"{ts}:{raw_body.decode('utf-8')}"
    h1 = hmac.new(
        b"secret_for_route_tests_123",
        signed_payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    res = client.post(
        "/api/webhooks/paddle",
        data=raw_body,
        headers={
            "Content-Type": "application/json",
            "Paddle-Signature": f"ts={ts};h1={h1}",
        },
    )
    assert res.status_code == 200
    data = res.get_json()
    assert data["ok"] is True
    assert data["granted_premium"] is True

    user = user_service.get_user("user_route_test")
    assert user.plan == "premium"


def test_csp_header_allows_paddle():
    from server import _add_security_headers
    from flask import Response
    resp = _add_security_headers(Response())
    csp = resp.headers.get("Content-Security-Policy", "")
    assert "https://cdn.paddle.com" in csp
    assert "https://*.paddle.com" in csp
