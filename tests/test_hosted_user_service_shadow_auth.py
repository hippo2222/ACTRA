import os
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from persistence.postgres import PostgresUnavailableError
from persistence.runtime import PersistenceRuntimeSettings
from services.hosted_user_service import HostedUserService
from services.user_service import UserService
import pytest


def _build_settings(tmp_path: Path) -> PersistenceRuntimeSettings:
    return PersistenceRuntimeSettings(
        runtime_mode="hosted_web",
        data_root=tmp_path,
        state_root=tmp_path / "runtime_state",
        postgres_dsn="",
        s3_endpoint="",
        s3_bucket="",
        s3_access_key="",
        s3_secret_key="",
        hosted_contract_errors=["missing_env:ACTRA_POSTGRES_DSN"],
    )


def test_shadow_fallback_synthesizes_auth_identity_for_legacy_users(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.setenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", "1")

    legacy = UserService(data_dir=str(tmp_path))
    created = legacy.create_user("Legacy Author")

    hosted = HostedUserService(data_dir=str(tmp_path), persistence_settings=_build_settings(tmp_path))

    expected_login = hosted.build_synthetic_login(created.user_id)
    expected_email = hosted.build_synthetic_email(created.user_id)
    expected_password = hosted.build_synthetic_password(created.user_id)

    all_users = hosted.get_all_users()
    assert len(all_users) == 1
    assert all_users[0].login == expected_login
    assert all_users[0].email == expected_email
    assert all_users[0].password_hash
    assert all_users[0].security_settings.get("require_password_on_login") is True

    by_login = hosted.find_user_by_identifier(expected_login)
    assert by_login is not None
    assert by_login.user_id == created.user_id

    by_email = hosted.find_user_by_identifier(expected_email)
    assert by_email is not None
    assert by_email.user_id == created.user_id

    fetched = hosted.get_user(created.user_id)
    assert fetched is not None
    assert fetched.login == expected_login
    assert hosted.verify_password(created.user_id, expected_password) is True
    assert hosted.verify_password(created.user_id, expected_password, auto_migrate=False) is True


def test_shadow_fallback_updates_user_when_postgres_unavailable(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.setenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", "1")

    legacy = UserService(data_dir=str(tmp_path))
    created = legacy.create_user("Legacy Author")

    hosted = HostedUserService(data_dir=str(tmp_path), persistence_settings=_build_settings(tmp_path))

    def _raise_postgres_unavailable() -> None:
        raise PostgresUnavailableError("postgres_dsn_missing")

    monkeypatch.setattr(hosted, "ensure_persistence_ready", _raise_postgres_unavailable)

    user = hosted.get_user(created.user_id)
    assert user is not None

    user.avatar_seed = "custom-avatar.png"
    user.name = "Legacy Renamed"

    assert hosted.update_user(user) is True
    assert hosted.hosted_shadow_fallback_active is True
    assert hosted.hosted_shadow_write_fallback_blocked is False

    refreshed = hosted.get_user(created.user_id)
    assert refreshed is not None
    assert refreshed.avatar_seed == "custom-avatar.png"
    assert refreshed.name == "Legacy Renamed"


def test_verify_password_still_succeeds_when_auto_migrate_write_is_blocked(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)

    legacy = UserService(data_dir=str(tmp_path))
    created = legacy.create_user("Legacy Author")

    hosted = HostedUserService(data_dir=str(tmp_path), persistence_settings=_build_settings(tmp_path))
    expected_password = hosted.build_synthetic_password(created.user_id)

    assert hosted.verify_password(created.user_id, expected_password) is True
    assert hosted.hosted_shadow_fallback_active is True
    assert hosted.hosted_shadow_write_fallback_blocked is True


def test_shadow_email_verification_status_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.setenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", "1")

    legacy = UserService(data_dir=str(tmp_path))
    created = legacy.create_user("Legacy Author")

    hosted = HostedUserService(data_dir=str(tmp_path), persistence_settings=_build_settings(tmp_path))
    user = hosted.get_user(created.user_id)
    assert user is not None

    user.email = "author@example.com"
    assert hosted.update_user(user) is True
    assert hosted.mark_email_verification_sent(created.user_id, sent_at="2026-04-17T10:00:00Z") is True
    assert hosted.mark_email_as_verified(created.user_id, verified_at="2026-04-17T10:05:00Z") is True

    verified = hosted.get_user(created.user_id)
    assert verified is not None
    assert verified.email == "author@example.com"
    assert verified.email_verification_sent_at == "2026-04-17T10:00:00Z"
    assert verified.email_verified_at == "2026-04-17T10:05:00Z"

    verified.email = "author+new@example.com"
    assert hosted.update_user(verified) is True

    refreshed = hosted.get_user(created.user_id)
    assert refreshed is not None
    assert refreshed.email == "author+new@example.com"
    assert refreshed.email_verification_sent_at is None
    assert refreshed.email_verified_at is None


def test_shadow_email_verification_tokens_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.setenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", "1")

    legacy = UserService(data_dir=str(tmp_path))
    created = legacy.create_user("Legacy Author")

    hosted = HostedUserService(data_dir=str(tmp_path), persistence_settings=_build_settings(tmp_path))
    user = hosted.get_user(created.user_id)
    assert user is not None

    user.email = "author@example.com"
    assert hosted.update_user(user) is True

    issued = hosted.create_email_verification_token(
        created.user_id,
        meta={"channel": "email"},
    )
    assert issued["user_id"] == created.user_id
    assert issued["email"] == "author@example.com"
    assert issued["purpose"] == "verify_email"
    assert issued["token"]
    assert "token_hash" not in issued

    fetched = hosted.get_email_verification_token(issued["token"])
    assert fetched is not None
    assert fetched["user_id"] == created.user_id
    assert fetched["email"] == "author@example.com"
    assert fetched["meta"]["channel"] == "email"
    assert fetched["used_at"] is None

    consumed = hosted.consume_email_verification_token(issued["token"])
    assert consumed is not None
    assert consumed["token_id"] == fetched["token_id"]
    assert consumed["used_at"]

    assert hosted.get_email_verification_token(issued["token"]) is None
    used_payload = hosted.get_email_verification_token(issued["token"], include_used=True)
    assert used_payload is not None
    assert used_payload["used_at"] == consumed["used_at"]


def test_shadow_email_verification_token_rejects_synthetic_email(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.setenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", "1")

    legacy = UserService(data_dir=str(tmp_path))
    created = legacy.create_user("Legacy Author")

    hosted = HostedUserService(data_dir=str(tmp_path), persistence_settings=_build_settings(tmp_path))

    with pytest.raises(ValueError, match="email_required"):
        hosted.create_email_verification_token(created.user_id)


def test_shadow_pending_email_change_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.setenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", "1")

    legacy = UserService(data_dir=str(tmp_path))
    created = legacy.create_user("Legacy Author")

    hosted = HostedUserService(data_dir=str(tmp_path), persistence_settings=_build_settings(tmp_path))
    user = hosted.get_user(created.user_id)
    assert user is not None

    user.email = "author@example.com"
    assert hosted.update_user(user) is True
    assert hosted.mark_email_verification_sent(created.user_id, sent_at="2026-04-17T10:00:00Z") is True
    assert hosted.mark_email_as_verified(created.user_id, verified_at="2026-04-17T10:05:00Z") is True

    staged = hosted.stage_pending_email_change(created.user_id, "author+next@example.com")
    assert staged is not None
    assert staged.email == "author@example.com"
    assert staged.pending_email == "author+next@example.com"
    assert staged.pending_email_verification_sent_at is None

    assert hosted.mark_pending_email_verification_sent(created.user_id, sent_at="2026-04-17T10:10:00Z") is True
    issued = hosted.create_email_verification_token(
        created.user_id,
        purpose="change_email",
        email_override="author+next@example.com",
        meta={"channel": "email", "source": "settings"},
    )
    assert issued["purpose"] == "change_email"
    assert issued["email"] == "author+next@example.com"

    consumed = hosted.consume_email_verification_token(issued["token"], purpose="change_email")
    assert consumed is not None
    assert hosted.confirm_pending_email_change(created.user_id, verified_at="2026-04-17T10:15:00Z") is True

    refreshed = hosted.get_user(created.user_id)
    assert refreshed is not None
    assert refreshed.email == "author+next@example.com"
    assert refreshed.pending_email is None
    assert refreshed.pending_email_verification_sent_at is None
    assert refreshed.email_verified_at == "2026-04-17T10:15:00Z"
    assert refreshed.email_verification_sent_at == "2026-04-17T10:10:00Z"


def test_shadow_rate_limit_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.setenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", "1")

    hosted = HostedUserService(data_dir=str(tmp_path), persistence_settings=_build_settings(tmp_path))

    first = hosted.consume_rate_limit("login", "127.0.0.1", limit=2, window_seconds=60)
    second = hosted.consume_rate_limit("login", "127.0.0.1", limit=2, window_seconds=60)
    limited = hosted.consume_rate_limit("login", "127.0.0.1", limit=2, window_seconds=60)

    assert first["allowed"] is True
    assert second["allowed"] is True
    assert limited["allowed"] is False
    assert limited["attempt_count"] == 3
    assert int(limited["retry_after_seconds"]) >= 1


def test_shadow_rate_limit_is_shared_between_hosted_service_instances(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.setenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", "1")

    first_hosted = HostedUserService(data_dir=str(tmp_path), persistence_settings=_build_settings(tmp_path))
    second_hosted = HostedUserService(data_dir=str(tmp_path), persistence_settings=_build_settings(tmp_path))

    first = first_hosted.consume_rate_limit("forgot_password", "shared-client", limit=2, window_seconds=60)
    second = second_hosted.consume_rate_limit("forgot_password", "shared-client", limit=2, window_seconds=60)
    limited = second_hosted.consume_rate_limit("forgot_password", "shared-client", limit=2, window_seconds=60)

    assert first["allowed"] is True
    assert second["allowed"] is True
    assert limited["allowed"] is False
    assert limited["attempt_count"] == 3
