import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


DESKTOP_APP_PATH = Path(__file__).resolve().parents[1]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

from services.billing_service import BILLING_STATUS_ACTIVATED, BillingService
from services.user_service import USER_PLAN_FREE, USER_PLAN_PREMIUM, User


class _FakeUserService:
    def __init__(self, user):
        self.user = user

    def get_user(self, user_id):
        return self.user if user_id == self.user.user_id else None

    def update_user(self, user):
        self.user = user
        return True


def _service(tmp_path, user=None):
    user = user or User(
        user_id="user_1",
        name="Billing User",
        created_at="2026-05-08T00:00:00",
        role="user",
        plan=USER_PLAN_FREE,
        settings={},
    )
    return BillingService(data_dir=str(tmp_path), user_service=_FakeUserService(user))


def test_create_order_accepts_supported_periods(tmp_path):
    service = _service(tmp_path)

    order = service.create_order("user_1", 30)

    assert order["period_days"] == 30
    assert order["status"] == "pending"
    assert service.list_orders(user_id="user_1", status="pending")[0]["order_id"] == order["order_id"]


def test_create_order_rejects_invalid_period(tmp_path):
    service = _service(tmp_path)

    with pytest.raises(ValueError, match="invalid_period_days"):
        service.create_order("user_1", 7)


def test_activate_order_grants_timed_premium(tmp_path):
    service = _service(tmp_path)
    order = service.create_order("user_1", 14)

    result = service.activate_order(order["order_id"], admin_user_id="admin_1")

    assert result["order"]["status"] == BILLING_STATUS_ACTIVATED
    assert result["user"]["effective_plan"] == USER_PLAN_PREMIUM
    assert result["user"]["premium_expires_at"]


def test_grant_premium_extends_from_current_future_expiry(tmp_path):
    current_expiry = (datetime.now(timezone.utc) + timedelta(days=10)).replace(microsecond=0)
    user = User(
        user_id="user_1",
        name="Billing User",
        created_at="2026-05-08T00:00:00",
        role="user",
        plan=USER_PLAN_PREMIUM,
        premium_expires_at=current_expiry.isoformat().replace("+00:00", "Z"),
        settings={},
    )
    service = _service(tmp_path, user=user)

    result = service.grant_premium("user_1", 14, admin_user_id="admin_1")
    next_expiry = datetime.fromisoformat(result["user"]["premium_expires_at"].replace("Z", "+00:00"))

    assert next_expiry >= current_expiry + timedelta(days=14)
