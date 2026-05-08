import sys
from pathlib import Path

import pytest


ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from persistence.postgres import PostgresUnavailableError
from routes import quick_access_routes
from services.hosted_shadow_fallback import HostedShadowReadFallbackDisabledError
from services.user_service import User


class _FakeHostedIdentityRepository:
    def __init__(self, user=None, *, fail_reads: bool = False):
        self.user = user
        self.fail_reads = fail_reads

    def get_user(self, user_id: str):
        if self.fail_reads:
            raise PostgresUnavailableError("postgres_dsn_missing")
        if self.user is not None and self.user.user_id == user_id:
            return self.user
        return None


class _FakeHostedUserService:
    def __init__(self, user=None, *, fail_reads: bool = False):
        self.repository = _FakeHostedIdentityRepository(user, fail_reads=fail_reads)
        self.updated_users = []
        self._shadow_read_fallback_blocked = False

    def ensure_persistence_ready(self):
        if self.repository.fail_reads:
            raise PostgresUnavailableError("postgres_dsn_missing")

    def update_user(self, user: User) -> bool:
        self.updated_users.append(user)
        self.repository.user = user
        return True


def _make_user(*, user_id: str = "user1") -> User:
    return User(
        user_id=user_id,
        name="Hosted User",
        created_at="2026-04-19T10:00:00Z",
        settings={},
    )


def test_hosted_ui_state_reads_and_writes_via_user_profile(monkeypatch, tmp_path):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")

    user = _make_user()
    user_service = _FakeHostedUserService(user)
    app_ctx = type("Ctx", (), {"user_service": user_service, "data_dir": tmp_path})()
    monkeypatch.setattr(quick_access_routes, "get_ctx", lambda: app_ctx)
    monkeypatch.setattr(quick_access_routes, "is_hosted_web_runtime", lambda: True)

    quick_access_routes._write_ui_state(
        "user1",
        {
            "pinned": ["complex-a"],
            "recent": ["complex-b"],
            "dismissed": ["complex-c"],
            "settings": {"theme": "forest"},
        },
    )

    state = quick_access_routes._read_ui_state("user1")

    assert state["pinned"] == ["complex-a"]
    assert state["recent"] == ["complex-b"]
    assert state["dismissed"] == ["complex-c"]
    assert state["settings"]["theme"] == "forest"
    assert user.settings["web_ui_state"]["pinned"] == ["complex-a"]
    assert user.settings["web_ui_state"]["dismissed"] == ["complex-c"]
    assert (tmp_path / "users" / "user1" / "ui_state.json").exists() is False


def test_hosted_ui_state_blocks_shadow_read_when_identity_storage_is_unavailable(monkeypatch, tmp_path):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")

    user_service = _FakeHostedUserService(_make_user(), fail_reads=True)
    app_ctx = type("Ctx", (), {"user_service": user_service, "data_dir": tmp_path})()
    monkeypatch.setattr(quick_access_routes, "get_ctx", lambda: app_ctx)
    monkeypatch.setattr(quick_access_routes, "is_hosted_web_runtime", lambda: True)

    with pytest.raises(HostedShadowReadFallbackDisabledError) as exc_info:
        quick_access_routes._read_ui_state("user1")

    assert exc_info.value.operation == "quick_access.ui_state"
    assert user_service._shadow_read_fallback_blocked is True
