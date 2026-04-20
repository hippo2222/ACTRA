import sys
from pathlib import Path


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

from services.schemas.user_schemas import ProfileSchema
from services.user_service import (
    User,
    UserService,
    USER_PLAN_FREE,
    USER_ROLE_USER,
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


def test_user_service_create_user_defaults_role_and_plan(tmp_path):
    service = UserService(data_dir=str(tmp_path))

    user = service.create_user("Axes User")

    assert user.role == USER_ROLE_USER
    assert user.plan == USER_PLAN_FREE
    profile_errors = ProfileSchema.validate(user.to_dict())
    assert profile_errors == []


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
