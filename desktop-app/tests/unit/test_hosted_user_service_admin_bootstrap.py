import logging
import sys
from pathlib import Path


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

from services.hosted_user_service import HostedUserService
from services.user_service import User


def _make_service():
    service = object.__new__(HostedUserService)
    service.logger = logging.getLogger("test.hosted_user_service.bootstrap")
    return service


def test_bootstrap_admin_matches_by_login(monkeypatch):
    service = _make_service()
    monkeypatch.setenv("ACTRA_ADMIN_LOGIN", "founder")
    monkeypatch.delenv("ACTRA_ADMIN_EMAIL", raising=False)

    user = User(
        user_id="user_1",
        name="Founder",
        created_at="2026-04-20T10:00:00Z",
        login="founder",
        email="founder@actra.site",
    )

    assert service._bootstrap_admin_matches_user(user) is True


def test_bootstrap_admin_matches_by_email(monkeypatch):
    service = _make_service()
    monkeypatch.delenv("ACTRA_ADMIN_LOGIN", raising=False)
    monkeypatch.setenv("ACTRA_ADMIN_EMAIL", "founder@actra.site")

    user = User(
        user_id="user_1",
        name="Founder",
        created_at="2026-04-20T10:00:00Z",
        login="founder",
        email="founder@actra.site",
    )

    assert service._bootstrap_admin_matches_user(user) is True


def test_bootstrap_admin_conflict_requires_same_account(monkeypatch):
    service = _make_service()
    monkeypatch.setenv("ACTRA_ADMIN_LOGIN", "founder")
    monkeypatch.setenv("ACTRA_ADMIN_EMAIL", "another@actra.site")

    user = User(
        user_id="user_1",
        name="Founder",
        created_at="2026-04-20T10:00:00Z",
        login="founder",
        email="founder@actra.site",
    )

    assert service._bootstrap_admin_matches_user(user) is False


def test_maybe_promote_bootstrap_admin_sets_role_and_persists(monkeypatch):
    service = _make_service()
    monkeypatch.setenv("ACTRA_ADMIN_LOGIN", "founder")
    monkeypatch.delenv("ACTRA_ADMIN_EMAIL", raising=False)

    calls = []
    service.update_user = lambda user: calls.append((user.user_id, user.role)) or True
    user = User(
        user_id="user_1",
        name="Founder",
        created_at="2026-04-20T10:00:00Z",
        login="founder",
        email="founder@actra.site",
        role="user",
        plan="free",
    )

    promoted = service._maybe_promote_bootstrap_admin(user)

    assert promoted is user
    assert promoted.role == "admin"
    assert calls == [("user_1", "admin")]
