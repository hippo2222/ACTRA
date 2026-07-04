"""Tests for PaddleService handling billing webhooks, stacking logic, signature verification, and idempotency."""

import hmac
import hashlib
import json
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from services.paddle_service import PaddleService
from services.user_service import USER_PLAN_FREE, USER_PLAN_PREMIUM, User


class MockUserService:
    def __init__(self):
        self.users = {}

    def get_user(self, user_id: str):
        return self.users.get(user_id)

    def update_user(self, user: User):
        self.users[user.user_id] = user
        return user


@pytest.fixture
def user_service():
    svc = MockUserService()
    svc.users["usr_test_1"] = User(
        user_id="usr_test_1",
        created_at="2026-01-01T00:00:00Z",
        name="Test User",
        email="test@example.com",
        plan=USER_PLAN_FREE,
        premium_expires_at=None,
    )
    return svc


@pytest.fixture
def paddle_service(tmp_path, user_service):
    billing_service = MagicMock()
    svc = PaddleService(
        billing_service=billing_service,
        user_service=user_service,
        data_dir=str(tmp_path),
        environment="sandbox",
        api_key="test_api_key",
        client_token="test_client_token",
        webhook_secret="test_webhook_secret",
    )
    return svc


def test_paddle_webhook_signature_verification(paddle_service):
    raw_body = b'{"event_id":"evt_123","event_type":"transaction.completed"}'
    ts = "1700000000"
    signed_payload = f"{ts}:{raw_body.decode('utf-8')}"
    h1 = hmac.new(
        b"test_webhook_secret",
        signed_payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    header = f"ts={ts};h1={h1}"
    assert paddle_service.verify_signature(raw_body, header) is True

    # Bad signature
    bad_header = f"ts={ts};h1=invalid_hmac"
    assert paddle_service.verify_signature(raw_body, bad_header) is False


def test_grant_premium_transaction_stacks_dates(paddle_service, user_service):
    user = user_service.get_user("usr_test_1")
    assert user.plan == USER_PLAN_FREE
    assert user.premium_expires_at is None

    # 1. First purchase: 30 days
    payload = {
        "event_id": "evt_tx_1",
        "event_type": "transaction.completed",
        "data": {
            "custom_data": {"user_id": "usr_test_1"},
            "items": [{"price": {"id": paddle_service.price_30d}}],
        },
    }
    res1 = paddle_service.handle_webhook_event(payload)
    assert res1["ok"] is True
    assert res1["granted_premium"] is True
    assert res1["period_days"] == 30

    user_after_1 = user_service.get_user("usr_test_1")
    assert user_after_1.plan == USER_PLAN_PREMIUM
    dt1 = datetime.fromisoformat(user_after_1.premium_expires_at.replace("Z", "+00:00"))
    now_dt = datetime.now(timezone.utc)
    # Expected approx 30 days from now
    diff1 = (dt1 - now_dt).total_seconds() / 86400
    assert 29 <= diff1 <= 31

    # 2. Second purchase while active: 90 days (Stacking test!)
    payload2 = {
        "event_id": "evt_tx_2",
        "event_type": "transaction.completed",
        "data": {
            "custom_data": {"user_id": "usr_test_1"},
            "items": [{"price": {"id": paddle_service.price_90d}}],
        },
    }
    res2 = paddle_service.handle_webhook_event(payload2)
    assert res2["ok"] is True
    assert res2["granted_premium"] is True

    user_after_2 = user_service.get_user("usr_test_1")
    dt2 = datetime.fromisoformat(user_after_2.premium_expires_at.replace("Z", "+00:00"))
    # Should be dt1 + 90 days
    expected_dt2 = dt1 + timedelta(days=90)
    assert abs((dt2 - expected_dt2).total_seconds()) < 5


def test_paddle_idempotency_prevents_duplicate_grants(paddle_service, user_service):
    payload = {
        "event_id": "evt_duplicate_100",
        "event_type": "transaction.completed",
        "data": {
            "custom_data": {"user_id": "usr_test_1"},
            "items": [{"price": {"id": paddle_service.price_14d}}],
        },
    }
    res1 = paddle_service.handle_webhook_event(payload)
    assert res1["ok"] is True
    assert res1.get("skipped") is not True

    # Re-send exact same event
    res2 = paddle_service.handle_webhook_event(payload)
    assert res2["ok"] is True
    assert res2.get("skipped") is True
    assert res2.get("reason") == "already_processed"
