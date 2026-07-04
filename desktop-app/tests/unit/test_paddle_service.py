from __future__ import annotations

import hashlib
import hmac
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from services.paddle_service import PaddleService
from services.user_service import USER_PLAN_FREE, USER_PLAN_PREMIUM, User, UserService


class MockBillingService:
    pass


@pytest.fixture
def temp_dir():
    with tempfile.TemporaryDirectory() as tmp:
        yield Path(tmp)


@pytest.fixture
def user_service(temp_dir):
    service = UserService(data_dir=str(temp_dir))
    user = User(
        user_id="user_paddle_123",
        name="Paddle User",
        created_at="2026-07-04T12:00:00Z",
        login="paddle_user",
        email="paddle@example.com",
        plan=USER_PLAN_FREE,
    )
    # Save user via profile file in users_dir
    user_dir = temp_dir / "users" / "user_paddle_123"
    user_dir.mkdir(parents=True, exist_ok=True)
    (user_dir / "profile.json").write_text(
        '{"user_id":"user_paddle_123","profile":{"name":"Paddle User","created_at":"2026-07-04T12:00:00Z","login":"paddle_user","email":"paddle@example.com","plan":"free"}}',
        encoding="utf-8",
    )
    return service


@pytest.fixture
def paddle_service(user_service, temp_dir):
    return PaddleService(
        billing_service=MockBillingService(),
        user_service=user_service,
        data_dir=str(temp_dir),
        environment="production",
        webhook_secret="test_webhook_secret_key_12345",
    )


def test_verify_signature_valid(paddle_service):
    raw_body = b'{"event_id":"evt_123","event_type":"transaction.completed"}'
    ts = "1700000000"
    signed_payload = f"{ts}:{raw_body.decode('utf-8')}"
    h1 = hmac.new(
        b"test_webhook_secret_key_12345",
        signed_payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    signature_header = f"ts={ts};h1={h1}"
    assert paddle_service.verify_signature(raw_body, signature_header) is True


def test_verify_signature_invalid(paddle_service):
    raw_body = b'{"event_id":"evt_123","event_type":"transaction.completed"}'
    ts = "1700000000"
    signature_header = f"ts={ts};h1=invalid_hash_value"
    assert paddle_service.verify_signature(raw_body, signature_header) is False


def test_handle_transaction_completed_event_30d(paddle_service, user_service):
    payload = {
        "event_id": "evt_txn_001",
        "event_type": "transaction.completed",
        "data": {
            "id": "txn_001",
            "status": "completed",
            "custom_data": {"user_id": "user_paddle_123"},
            "items": [{"price": {"id": "pri_01kwqccmf32mnnt98ek3d3xapf"}}],
        },
    }

    res = paddle_service.handle_webhook_event(payload)
    assert res["ok"] is True
    assert res["granted_premium"] is True
    assert res["period_days"] == 30

    user = user_service.get_user("user_paddle_123")
    assert user.plan == USER_PLAN_PREMIUM
    assert user.premium_expires_at is not None


def test_handle_transaction_completed_event_90d(paddle_service, user_service):
    payload = {
        "event_id": "evt_txn_002",
        "event_type": "transaction.completed",
        "data": {
            "id": "txn_002",
            "status": "completed",
            "custom_data": {"user_id": "user_paddle_123"},
            "items": [{"price": {"id": "pri_01kwqce6k2khvmsxr22yw446ry"}}],
        },
    }

    res = paddle_service.handle_webhook_event(payload)
    assert res["ok"] is True
    assert res["period_days"] == 90


def test_idempotent_event_processing(paddle_service):
    payload = {
        "event_id": "evt_duplicate_001",
        "event_type": "transaction.completed",
        "data": {
            "id": "txn_dup",
            "custom_data": {"user_id": "user_paddle_123"},
        },
    }

    res1 = paddle_service.handle_webhook_event(payload)
    assert res1["ok"] is True
    assert "skipped" not in res1

    res2 = paddle_service.handle_webhook_event(payload)
    assert res2["ok"] is True
    assert res2.get("skipped") is True
    assert res2.get("reason") == "already_processed"
