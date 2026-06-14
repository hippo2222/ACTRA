import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

from services.schemas.user_schemas import ProfileSchema
from services.user_service import (
    User,
    UserService,
    USER_PLAN_FREE,
    USER_PLAN_PREMIUM,
    USER_ROLE_ADMIN,
    USER_ROLE_USER,
    apply_registration_premium_promo,
    registration_premium_promo_expires_at,
)


def test_user_from_dict_defaults_role_and_plan_when_missing():
    user = User.from_dict(
        {
            "user_id": "user_1",
            "profile": {
                "name": "Legacy User",
                "created_at": "2026-04-20T10:00:00",
                "settings": {},
            },
        }
    )

    assert user.role == USER_ROLE_USER
    assert user.plan == USER_PLAN_FREE


def test_user_to_api_dict_exposes_role_and_plan():
    user = User(
        user_id="user_1",
        name="Admin Premium",
        created_at="2026-04-20T10:00:00",
        role="admin",
        plan="premium",
        settings={},
    )

    payload = user.to_api_dict()

    assert payload["role"] == "admin"
    assert payload["plan"] == "premium"
    assert payload["effective_plan"] == "premium"


def test_admin_effective_plan_is_premium_even_when_stored_plan_is_free():
    user = User(
        user_id="user_1",
        name="Admin Free",
        created_at="2026-04-20T10:00:00",
        role=USER_ROLE_ADMIN,
        plan=USER_PLAN_FREE,
        settings={},
    )

    payload = user.to_api_dict()

    assert user.effective_plan == USER_PLAN_PREMIUM
    assert payload["plan"] == USER_PLAN_FREE
    assert payload["effective_plan"] == USER_PLAN_PREMIUM


def test_active_timed_premium_is_effective_premium():
    expires_at = (datetime.now(timezone.utc) + timedelta(days=2)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    user = User(
        user_id="user_1",
        name="Timed Premium",
        created_at="2026-04-20T10:00:00",
        role=USER_ROLE_USER,
        plan=USER_PLAN_PREMIUM,
        premium_expires_at=expires_at,
        settings={},
    )

    payload = user.to_api_dict()

    assert user.effective_plan == USER_PLAN_PREMIUM
    assert payload["premium_expires_at"] == expires_at
    assert payload["effective_plan"] == USER_PLAN_PREMIUM


def test_expired_timed_premium_resolves_to_free():
    expires_at = (datetime.now(timezone.utc) - timedelta(days=1)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    user = User(
        user_id="user_1",
        name="Expired Premium",
        created_at="2026-04-20T10:00:00",
        role=USER_ROLE_USER,
        plan=USER_PLAN_PREMIUM,
        premium_expires_at=expires_at,
        settings={},
    )

    assert user.to_api_dict()["effective_plan"] == USER_PLAN_FREE


def test_user_service_create_user_defaults_role_and_plan(tmp_path):
    service = UserService(data_dir=str(tmp_path))

    user = service.create_user("Axes User")

    assert user.role == USER_ROLE_USER
    assert user.plan == USER_PLAN_FREE
    profile_errors = ProfileSchema.validate(user.to_dict())
    assert profile_errors == []


def test_registration_premium_promo_includes_start_and_end_dates():
    start_expiry = registration_premium_promo_expires_at("2026-05-13T00:00:00+03:00")
    end_expiry = registration_premium_promo_expires_at("2026-06-01T23:59:59+03:00")

    assert start_expiry == "2026-06-02T21:00:00Z"
    assert end_expiry == "2026-06-22T20:59:59Z"


def test_registration_premium_promo_excludes_dates_outside_window():
    assert registration_premium_promo_expires_at("2026-05-12T23:59:59+03:00") is None
    assert registration_premium_promo_expires_at("2026-06-02T00:00:00+03:00") is None


def test_apply_registration_premium_promo_sets_timed_premium():
    user = User(
        user_id="user_1",
        name="Promo User",
        created_at="2026-05-20T10:00:00+03:00",
        role=USER_ROLE_USER,
        plan=USER_PLAN_FREE,
        settings={},
    )

    applied = apply_registration_premium_promo(user, user.created_at)

    assert applied is True
    assert user.plan == USER_PLAN_PREMIUM
    assert user.premium_expires_at == "2026-06-10T07:00:00Z"
    # NB: effective_plan is a LIVE computation (premium_expires_at vs now) and the
    # registration promo is a fixed launch campaign, so its granted window is in
    # the past — asserting effective_plan here would be a time-bomb. Live active/
    # lapse behaviour is covered by test_active_timed_premium_is_effective_premium
    # and test_expired_timed_premium_resolves_to_free.


def test_profile_schema_rejects_invalid_role_and_plan():
    errors = ProfileSchema.validate(
        {
            "user_id": "user_1",
            "profile": {
                "name": "Invalid Axes",
                "created_at": "2026-04-20T10:00:00",
                "role": "owner",
                "plan": "vip",
                "settings": {},
            },
        }
    )

    assert any("profile.role" in error for error in errors)
    assert any("profile.plan" in error for error in errors)
