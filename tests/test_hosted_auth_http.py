import io
import os
import re
import sys
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import bcrypt
import pytest
from PIL import Image

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

import server  # type: ignore
import routes.auth_routes as auth_routes  # type: ignore
import routes._context as ctx_module  # type: ignore
import routes.users_routes as users_routes  # type: ignore
from services.hosted_shadow_fallback import HostedShadowWriteFallbackDisabledError
from services.user_service import User


class _FakeHostedUserService:
    def __init__(self):
        self._users = {}
        self._counter = 0
        self._email_tokens = {}
        self._email_token_counter = 0
        self.PASSWORD_RESET_TOKEN_TTL_SECONDS = 60 * 60

    @staticmethod
    def _build_login_from_name(name):
        base = re.sub(r"[^a-z0-9]+", "-", str(name or "").strip().lower()).strip("-")
        if not base:
            base = "user"
        if len(base) < 3:
            base = f"user-{base}".strip("-")
        return base[:32].rstrip("-") or "user"

    def create_auth_user(self, *, name, login, email, password, avatar_seed=None):
        clean_name = str(name or "").strip()
        login = str(login or "").strip().lower()
        email = str(email or "").strip().lower()
        if any((user.name or "").strip().lower() == clean_name.lower() for user in self._users.values()):
            raise ValueError("duplicate_name")
        if any(
            (user.email or "").lower() == email or (getattr(user, "pending_email", "") or "").lower() == email
            for user in self._users.values()
        ):
            raise ValueError("email_already_exists")
        if not login:
            base_login = self._build_login_from_name(clean_name)
            login = base_login
            suffix_number = 2
            while any((user.login or "").lower() == login for user in self._users.values()):
                suffix = f"-{suffix_number}"
                login = f"{base_login[:32 - len(suffix)].rstrip('-')}{suffix}"
                suffix_number += 1
        elif any((user.login or "").lower() == login for user in self._users.values()):
            raise ValueError("login_already_exists")

        self._counter += 1
        user = User(
            user_id=f"user_{self._counter}",
            name=name,
            created_at="2026-04-13T10:00:00Z",
            avatar_seed=avatar_seed or "1.png",
            login=login,
            email=email,
            pending_email=None,
            email_verified_at=None,
            email_verification_sent_at=None,
            pending_email_verification_sent_at=None,
            password_hash=bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8"),
            security_settings={
                "require_password_on_login": True,
                "require_password_on_edit": False,
            },
            settings={},
        )
        self._users[user.user_id] = user
        return user

    def find_user_by_identifier(self, identifier):
        lowered = str(identifier or "").strip().lower()
        for user in self._users.values():
            if user.user_id == lowered:
                return user
            if str(user.login or "").lower() == lowered:
                return user
            if str(user.email or "").lower() == lowered:
                return user
        return None

    def verify_password(self, user_id, password):
        user = self._users.get(user_id)
        if not user or not user.password_hash:
            return not user or not user.password_hash
        return bcrypt.checkpw(password.encode("utf-8"), user.password_hash.encode("utf-8"))

    def get_user(self, user_id):
        return self._users.get(user_id)

    def get_all_users(self):
        return list(self._users.values())

    def update_user(self, user):
        if user.user_id not in self._users:
            return False
        previous = self._users.get(user.user_id)
        for existing in self._users.values():
            if existing.user_id == user.user_id:
                continue
            if str(existing.name or "").strip().lower() == str(user.name or "").strip().lower() and str(user.name or "").strip():
                return False
            existing_email = str(existing.email or "").strip().lower()
            existing_pending_email = str(getattr(existing, "pending_email", "") or "").strip().lower()
            next_email = str(getattr(user, "email", "") or "").strip().lower()
            next_pending_email = str(getattr(user, "pending_email", "") or "").strip().lower()
            if next_email and (existing_email == next_email or existing_pending_email == next_email):
                return False
            if next_pending_email and (existing_email == next_pending_email or existing_pending_email == next_pending_email):
                return False
        previous_email = str(getattr(previous, "email", "") or "").strip().lower()
        next_email = str(getattr(user, "email", "") or "").strip().lower()
        previous_pending_email = str(getattr(previous, "pending_email", "") or "").strip().lower()
        next_pending_email = str(getattr(user, "pending_email", "") or "").strip().lower()
        confirmed_pending_swap = bool(previous_pending_email and previous_pending_email == next_email and previous_email != next_email)
        if previous is not None and previous_email != next_email and not confirmed_pending_swap:
            user.email_verified_at = None
            user.email_verification_sent_at = None
        if next_pending_email != previous_pending_email or not next_pending_email:
            user.pending_email_verification_sent_at = None if not next_pending_email or next_pending_email != previous_pending_email else user.pending_email_verification_sent_at
        self._users[user.user_id] = user
        return True

    def mark_email_verification_sent(self, user_id, *, sent_at=None):
        user = self._users.get(user_id)
        if user is None:
            return False
        user.email_verification_sent_at = str(sent_at or "2026-04-13T10:17:00Z")
        return True

    def mark_email_as_verified(self, user_id, *, verified_at=None):
        user = self._users.get(user_id)
        if user is None:
            return False
        stamp = str(verified_at or "2026-04-13T10:18:00Z")
        user.email_verified_at = stamp
        if not user.email_verification_sent_at:
            user.email_verification_sent_at = stamp
        return True

    def mark_pending_email_verification_sent(self, user_id, *, sent_at=None):
        user = self._users.get(user_id)
        if user is None or not str(getattr(user, "pending_email", "") or "").strip():
            return False
        user.pending_email_verification_sent_at = str(sent_at or "2026-04-13T10:19:00Z")
        return True

    def stage_pending_email_change(self, user_id, new_email):
        user = self._users.get(user_id)
        if user is None:
            return None
        user.pending_email = str(new_email or "").strip().lower()
        user.pending_email_verification_sent_at = None
        self._users[user_id] = user
        return user

    def clear_pending_email_change(self, user_id):
        user = self._users.get(user_id)
        if user is None:
            return False
        user.pending_email = None
        user.pending_email_verification_sent_at = None
        self._users[user_id] = user
        return True

    def confirm_pending_email_change(self, user_id, *, verified_at=None):
        user = self._users.get(user_id)
        if user is None or not str(getattr(user, "pending_email", "") or "").strip():
            return False
        stamp = str(verified_at or "2026-04-13T10:20:00Z")
        sent_at = str(getattr(user, "pending_email_verification_sent_at", "") or "").strip() or stamp
        user.email = str(user.pending_email or "").strip().lower()
        user.pending_email = None
        user.pending_email_verification_sent_at = None
        user.email_verified_at = stamp
        user.email_verification_sent_at = sent_at
        self._users[user_id] = user
        return True

    def create_email_verification_token(self, user_id, *, purpose="verify_email", ttl_seconds=None, meta=None, email_override=None):
        user = self._users.get(user_id)
        if user is None:
            raise ValueError("user_not_found")
        email = str(email_override if email_override is not None else user.email or "").strip().lower()
        if not email:
            raise ValueError("email_required")

        self._email_token_counter += 1
        raw_token = f"verify-token-{self._email_token_counter}"
        token_id = f"email_token_{self._email_token_counter}"
        payload = {
            "token_id": token_id,
            "user_id": user.user_id,
            "email": email,
            "purpose": str(purpose or "verify_email"),
            "token": raw_token,
            "created_at": "2026-04-13T10:16:30Z",
            "expires_at": "2026-04-14T10:16:30Z",
            "used_at": None,
            "meta": dict(meta or {}),
        }
        self._email_tokens[raw_token] = payload
        return dict(payload)

    def get_email_verification_token(self, token, *, purpose="verify_email", include_used=False):
        payload = self._email_tokens.get(str(token or "").strip())
        if not payload:
            return None
        if str(payload.get("purpose") or "") != str(purpose or "verify_email"):
            return None
        if payload.get("used_at") and not include_used:
            return None
        return dict(payload)

    def consume_email_verification_token(self, token, *, purpose="verify_email", used_at=None):
        raw_token = str(token or "").strip()
        payload = self._email_tokens.get(raw_token)
        if not payload:
            return None
        if str(payload.get("purpose") or "") != str(purpose or "verify_email"):
            return None
        if payload.get("used_at"):
            return None
        payload["used_at"] = str(used_at or "2026-04-13T10:18:00Z")
        self._email_tokens[raw_token] = payload
        return dict(payload)

    def set_password(self, user_id, new_password):
        user = self._users.get(user_id)
        if user is None:
            raise ValueError("user_not_found")
        if len(str(new_password or "")) < 8:
            raise ValueError("invalid_password")
        user.password_hash = bcrypt.hashpw(str(new_password).encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        security_settings = dict(getattr(user, "security_settings", {}) or {})
        security_settings["require_password_on_login"] = True
        user.security_settings = security_settings
        self._users[user_id] = user
        return user

    def delete_user(self, user_id):
        removed = self._users.pop(str(user_id or "").strip(), None)
        if removed is None:
            return False
        self._email_tokens = {
            raw_token: payload
            for raw_token, payload in self._email_tokens.items()
            if str(payload.get("user_id") or "").strip() != removed.user_id
        }
        return True

    def _check_duplicate_name(self, name):
        lowered = str(name or "").strip().lower()
        return any(str(user.name or "").strip().lower() == lowered for user in self._users.values())

    @staticmethod
    def normalize_email(email):
        return str(email or "").strip().lower()

    @staticmethod
    def validate_email(email):
        clean_email = str(email or "").strip().lower()
        if not clean_email or "@" not in clean_email or "." not in clean_email.split("@")[-1]:
            raise ValueError("invalid_email")


def _install_hosted_auth_context(monkeypatch, data_dir=None):
    import routes._context as ctx_module

    user_service = _FakeHostedUserService()
    app_ctx = getattr(ctx_module, "_app_ctx", None)
    if app_ctx is None:
        app_ctx = SimpleNamespace()

    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_HOSTED_DEV_AUTH_BRIDGE", raising=False)
    monkeypatch.setattr(app_ctx, "user_service", user_service, raising=False)
    monkeypatch.setattr(app_ctx, "data_dir", str(data_dir or (ROOT_DIR / "data")), raising=False)
    monkeypatch.setattr(app_ctx, "user_id", "", raising=False)
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)

    def _issue_auth_verification_email(user, request_base_url=None):
        token_payload = user_service.create_email_verification_token(
            user.user_id,
            meta={"channel": "test"},
        )
        user_service.mark_email_verification_sent(user.user_id)
        base_url = str(request_base_url or "http://localhost/").rstrip("/")
        return {
            "sent": True,
            "to": [str(getattr(user, "email", "") or "").strip().lower()],
            "from": "noreply@example.test",
            "verify_url": f"{base_url}/welcome?verify_email_token={token_payload['token']}",
            "token_id": token_payload["token_id"],
            "expires_at": token_payload["expires_at"],
        }

    def _issue_auth_pending_email_verification_email(user, request_base_url=None):
        token_payload = user_service.create_email_verification_token(
            user.user_id,
            purpose="change_email",
            meta={"channel": "test", "source": "settings"},
            email_override=getattr(user, "pending_email", None),
        )
        user_service.mark_pending_email_verification_sent(user.user_id)
        base_url = str(request_base_url or "http://localhost/").rstrip("/")
        return {
            "sent": True,
            "to": [str(getattr(user, "pending_email", "") or "").strip().lower()],
            "from": "noreply@example.test",
            "verify_url": f"{base_url}/settings?pending_email_token={token_payload['token']}",
            "token_id": token_payload["token_id"],
            "expires_at": token_payload["expires_at"],
        }

    def _issue_auth_password_reset_email(user, request_base_url=None):
        token_payload = user_service.create_email_verification_token(
            user.user_id,
            purpose="reset_password",
            ttl_seconds=user_service.PASSWORD_RESET_TOKEN_TTL_SECONDS,
            meta={"channel": "test", "source": "forgot_password"},
        )
        base_url = str(request_base_url or "http://localhost/").rstrip("/")
        return {
            "sent": True,
            "to": [str(getattr(user, "email", "") or "").strip().lower()],
            "from": "noreply@example.test",
            "reset_url": f"{base_url}/welcome?reset_password_token={token_payload['token']}",
            "token_id": token_payload["token_id"],
            "expires_at": token_payload["expires_at"],
        }

    monkeypatch.setattr(
        ctx_module,
        "_extra",
        {
            "utc_now_iso": lambda: "2026-04-13T10:15:00Z",
            "server_helpers": {
                "extract_consent_payload": lambda payload: payload.get("consent") or {},
                "has_explicit_consent_payload": lambda payload: "consent" in payload,
                "required_consent_versions": lambda: {
                    "terms_version": "terms-v1",
                    "privacy_version": "privacy-v1",
                    "refund_version": "refund-v1",
                },
                "validate_consent_payload": lambda consent: (
                    {"ok": True}
                    if consent.get("accepted")
                    and consent.get("terms_version")
                    and consent.get("privacy_version")
                    and consent.get("refund_version")
                    else {"ok": False, "error": "consent_required", "status_code": 400}
                ),
                "write_user_consent": lambda user_id, terms, privacy, refund, source="unknown": {
                    "consent_id": f"consent-{user_id}",
                    "accepted_at": "2026-04-13T10:16:00Z",
                    "terms_version": terms,
                    "privacy_version": privacy,
                    "refund_version": refund,
                    "source": source,
                },
                "issue_auth_verification_email": _issue_auth_verification_email,
                "issue_auth_pending_email_verification_email": _issue_auth_pending_email_verification_email,
                "issue_auth_password_reset_email": _issue_auth_password_reset_email,
            },
        },
    )
    return user_service


@pytest.fixture
def client(monkeypatch, tmp_path):
    _install_hosted_auth_context(monkeypatch, data_dir=tmp_path)
    auth_routes._AUTH_RATE_LIMIT_STATE.clear()
    users_routes._SETTINGS_RATE_LIMIT_STATE.clear()
    with server.app.test_client() as c:
        yield c
    auth_routes._AUTH_RATE_LIMIT_STATE.clear()
    users_routes._SETTINGS_RATE_LIMIT_STATE.clear()


def _png_bytes(color=(80, 140, 220), size=(12, 12)):
    buffer = io.BytesIO()
    image = Image.new("RGB", size, color)
    image.save(buffer, format="PNG")
    buffer.seek(0)
    return buffer


def test_delete_hosted_account_related_data_removes_owned_workspace_content_and_avatar(tmp_path):
    class _FakeStorageService:
        def __init__(self):
            self.deleted_tasks = []
            self.deleted_topics = []
            self.deleted_modules = []

        def load_modules(self):
            return [
                {
                    "id": "module-owned",
                    "created_by_user_id": "user_1",
                    "topics": [
                        {"id": "topic-inside-owned-module", "created_by_user_id": "user_1", "tasks": []},
                    ],
                },
                {
                    "id": "module-shared",
                    "topics": [
                        {"id": "topic-owned", "created_by_user_id": "user_1", "tasks": []},
                        {
                            "id": "topic-shared",
                            "tasks": [
                                {"id": "task-owned", "created_by_user_id": "user_1"},
                                {"id": "task-other", "created_by_user_id": "user_2"},
                            ],
                        },
                    ],
                },
            ]

        def delete_task(self, module_id, topic_id, task_id):
            self.deleted_tasks.append((module_id, topic_id, task_id))
            return True

        def delete_topic(self, module_id, topic_id):
            self.deleted_topics.append((module_id, topic_id))
            return True

        def delete_module(self, module_id):
            self.deleted_modules.append(module_id)
            return True

    class _FakeComplexService:
        def __init__(self):
            self.deleted_complex_ids = []

        def get_all_complexes(self):
            return [
                SimpleNamespace(id="complex-owned", created_by_user_id="user_1"),
                SimpleNamespace(id="complex-other", created_by_user_id="user_2"),
            ]

        def delete_complex(self, complex_id):
            self.deleted_complex_ids.append(complex_id)
            return True

    class _FakeTheoryService:
        def __init__(self):
            self.deleted_theory_ids = []

        def list_theories(self):
            return [
                {"id": "theory-owned", "created_by_user_id": "user_1"},
                {"id": "theory-other", "created_by_user_id": "user_2"},
            ]

        def delete_theory(self, theory_id):
            self.deleted_theory_ids.append(theory_id)

    avatar_dir = tmp_path / "avatars"
    avatar_dir.mkdir(parents=True, exist_ok=True)
    avatar_path = avatar_dir / "user-user_1-avatar.png"
    avatar_path.write_bytes(b"avatar")

    storage_service = _FakeStorageService()
    complex_service = _FakeComplexService()
    theory_service = _FakeTheoryService()
    ctx = SimpleNamespace(
        data_dir=str(tmp_path),
        storage_service=storage_service,
        complex_service=complex_service,
        theory_service=theory_service,
        persistence_runtime=SimpleNamespace(
            postgres_dsn="",
            user_runtime_root=lambda user_id: tmp_path / "runtime" / str(user_id or ""),
        ),
    )
    user = User(
        user_id="user_1",
        name="Delete Me",
        created_at="2026-04-13T10:00:00Z",
        avatar_seed=avatar_path.name,
        login="delete.me",
        email="delete@example.com",
    )

    report = users_routes._delete_hosted_account_related_data(ctx, user)

    assert report["tasks_deleted"] == 1
    assert report["topics_deleted"] == 1
    assert report["modules_deleted"] == 1
    assert report["complexes_deleted"] == 1
    assert report["theories_deleted"] == 1
    assert report["avatar_files_deleted"] == 1
    assert storage_service.deleted_tasks == [("module-shared", "topic-shared", "task-owned")]
    assert storage_service.deleted_topics == [("module-shared", "topic-owned")]
    assert storage_service.deleted_modules == ["module-owned"]
    assert complex_service.deleted_complex_ids == ["complex-owned"]
    assert theory_service.deleted_theory_ids == ["theory-owned"]
    assert not avatar_path.exists()


def test_register_creates_hosted_user_and_logs_in(client):
    response = client.post(
        "/api/auth/register",
        json={
            "name": "Author One",
            "email": "author@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )

    assert response.status_code == 201
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["user"]["authenticated"] is True
    assert payload["user"]["login"] == "author-one"
    assert payload["user"]["email"] == "author@example.com"
    assert payload["user"]["avatar_seed"] == "1.png"
    assert payload["user"]["email_verified"] is False
    assert payload["user"]["email_verification_sent_at"] == "2026-04-13T10:17:00Z"
    assert payload["user"]["auth_source"] == "auth_session"
    assert payload["verification_email"]["sent"] is True
    assert payload["verification_email"]["verify_url"].startswith("http://localhost/welcome?verify_email_token=")

    me = client.get("/api/auth/me")
    me_payload = me.get_json()
    assert me.status_code == 200
    assert me_payload["authenticated"] is True
    assert me_payload["user"]["login"] == "author-one"
    assert me_payload["user"]["email"] == "author@example.com"


def test_register_generates_unique_login_from_display_name(client):
    first = client.post(
        "/api/auth/register",
        json={
            "name": "Author One",
            "email": "author.one@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert first.status_code == 201
    assert client.post("/api/auth/logout").status_code == 200

    second = client.post(
        "/api/auth/register",
        json={
            "name": "Author-One",
            "email": "author.two@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert second.status_code == 201

    first_payload = first.get_json()
    second_payload = second.get_json()
    assert first_payload["user"]["login"] == "author-one"
    assert second_payload["user"]["login"] == "author-one-2"


def test_delete_account_allows_reregister_with_same_email(client):
    payload = {
        "name": "Reusable Email",
        "email": "reusable@example.com",
        "password": "StrongPass1",
        "consent": {
            "accepted": True,
            "terms_version": "terms-v1",
            "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
        },
    }

    register = client.post("/api/auth/register", json=payload)
    assert register.status_code == 201

    delete = client.post(
        "/api/users/delete",
        json={"verification_password": "StrongPass1"},
    )
    assert delete.status_code == 200
    assert delete.get_json()["ok"] is True

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.get_json()["authenticated"] is False

    reregister = client.post(
        "/api/auth/register",
        json={
            **payload,
            "name": "Reusable Email Again",
        },
    )
    assert reregister.status_code == 201
    reregister_payload = reregister.get_json()
    assert reregister_payload["ok"] is True
    assert reregister_payload["user"]["email"] == "reusable@example.com"


def test_login_accepts_email_identifier(client):
    register = client.post(
        "/api/auth/register",
        json={
            "name": "Reader Two",
            "login": "reader.two",
            "email": "reader@example.com",
            "password": "ReaderPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201

    logout = client.post("/api/auth/logout")
    assert logout.status_code == 200

    login = client.post(
        "/api/auth/login",
        json={
            "identifier": "reader@example.com",
            "password": "ReaderPass1",
        },
    )
    payload = login.get_json()
    assert login.status_code == 200
    assert payload["ok"] is True
    assert payload["user"]["login"] == "reader.two"
    assert payload["user"]["email"] == "reader@example.com"
    assert payload["user"]["auth_source"] == "auth_session"


def test_login_uses_generic_invalid_credentials_response(client):
    register = client.post(
        "/api/auth/register",
        json={
            "name": "Reader Three",
            "login": "reader.three",
            "email": "reader3@example.com",
            "password": "ReaderPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201
    assert client.post("/api/auth/logout").status_code == 200

    missing_user = client.post(
        "/api/auth/login",
        json={"identifier": "missing@example.com", "password": "ReaderPass1"},
    )
    wrong_password = client.post(
        "/api/auth/login",
        json={"identifier": "reader3@example.com", "password": "WrongPass1"},
    )

    for response in (missing_user, wrong_password):
        payload = response.get_json()
        assert response.status_code == 401
        assert payload["error"] == "invalid_credentials"
        assert "email" in payload["message"]


def test_login_rate_limit_returns_too_many_requests(client, monkeypatch):
    monkeypatch.setitem(auth_routes._AUTH_RATE_LIMITS, "login", {"limit": 2, "window_seconds": 60})

    register = client.post(
        "/api/auth/register",
        json={
            "name": "Rate Limited Reader",
            "login": "rate.reader",
            "email": "rate.reader@example.com",
            "password": "ReaderPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201
    assert client.post("/api/auth/logout").status_code == 200

    first = client.post(
        "/api/auth/login",
        json={"identifier": "rate.reader@example.com", "password": "WrongPass1"},
    )
    second = client.post(
        "/api/auth/login",
        json={"identifier": "rate.reader@example.com", "password": "WrongPass1"},
    )
    limited = client.post(
        "/api/auth/login",
        json={"identifier": "rate.reader@example.com", "password": "WrongPass1"},
    )

    assert first.status_code == 401
    assert second.status_code == 401
    assert limited.status_code == 429
    limited_payload = limited.get_json()
    assert limited_payload["error"] == "too_many_requests"
    assert int(limited_payload["retry_after_seconds"]) >= 1


def test_resend_verification_email_returns_delivery_status(client):
    register = client.post(
        "/api/auth/register",
        json={
            "name": "Verify Resend",
            "login": "verify.resend",
            "email": "verify.resend@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201

    response = client.post("/api/auth/resend-verification", json={})
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["ok"] is True
    assert payload["user"]["email_verified"] is False
    assert payload["user"]["email_verification_sent_at"] == "2026-04-13T10:17:00Z"
    assert payload["verification_email"]["sent"] is True
    assert payload["verification_email"]["verify_url"].startswith("http://localhost/welcome?verify_email_token=")


def test_resend_verification_is_concealed_for_identifier_lookup(client):
    register = client.post(
        "/api/auth/register",
        json={
            "name": "Verify Lookup",
            "login": "verify.lookup",
            "email": "verify.lookup@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201
    assert client.post("/api/auth/logout").status_code == 200

    existing = client.post(
        "/api/auth/resend-verification",
        json={"identifier": "verify.lookup@example.com"},
    )
    missing = client.post(
        "/api/auth/resend-verification",
        json={"identifier": "missing@example.com"},
    )

    for response in (existing, missing):
        payload = response.get_json()
        assert response.status_code == 200
        assert payload["ok"] is True
        assert payload["requested"] is True
        assert payload["verification_email"]["concealed"] is True
        assert payload["verification_email"]["sent"] is False


def test_verify_email_marks_user_as_verified_and_rejects_token_reuse(client):
    register = client.post(
        "/api/auth/register",
        json={
            "name": "Verify Once",
            "login": "verify.once",
            "email": "verify.once@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201

    verification_url = register.get_json()["verification_email"]["verify_url"]
    token = parse_qs(urlparse(verification_url).query)["verify_email_token"][0]

    verified = client.get(f"/api/auth/verify-email?token={token}")
    verified_payload = verified.get_json()

    assert verified.status_code == 200
    assert verified_payload["ok"] is True
    assert verified_payload["verified"] is True
    assert verified_payload["user"]["email_verified"] is True
    assert verified_payload["user"]["email_verified_at"] == "2026-04-13T10:18:00Z"
    assert verified_payload["user"]["authenticated"] is True

    reused = client.get(f"/api/auth/verify-email?token={token}")
    assert reused.status_code == 409
    assert reused.get_json()["error"] == "token_already_used"


def test_register_rejects_duplicate_login_email_and_name(client):
    payload = {
        "name": "User A",
        "login": "duplicate.user",
        "email": "duplicate@example.com",
        "password": "StrongPass1",
        "consent": {
            "accepted": True,
            "terms_version": "terms-v1",
            "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
        },
    }

    first = client.post("/api/auth/register", json=payload)
    assert first.status_code == 201

    duplicate_login = client.post(
        "/api/auth/register",
        json={
            **payload,
            "name": "User B",
            "email": "other@example.com",
        },
    )
    assert duplicate_login.status_code == 409
    assert duplicate_login.get_json()["error"] == "registration_conflict"

    duplicate_email = client.post(
        "/api/auth/register",
        json={
            **payload,
            "name": "User C",
            "login": "other.user",
        },
    )
    assert duplicate_email.status_code == 409
    assert duplicate_email.get_json()["error"] == "registration_conflict"

    duplicate_name = client.post(
        "/api/auth/register",
        json={
            **payload,
            "login": "third.user",
            "email": "third@example.com",
        },
    )
    assert duplicate_name.status_code == 400
    assert duplicate_name.get_json()["error"] == "duplicate_name"


def test_hosted_email_change_rate_limit_returns_too_many_requests(client, monkeypatch):
    monkeypatch.setitem(users_routes._SETTINGS_RATE_LIMITS, "change_email", {"limit": 1, "window_seconds": 60})

    register = client.post(
        "/api/auth/register",
        json={
            "name": "Rate Email Change",
            "login": "rate.email.change",
            "email": "rate.email.change@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201

    first = client.post("/api/users/update", json={"email": "rate.email.change+one@example.com"})
    limited = client.post("/api/users/update", json={"email": "rate.email.change+two@example.com"})

    assert first.status_code == 200
    assert limited.status_code == 429
    limited_payload = limited.get_json()
    assert limited_payload["error"] == "too_many_requests"
    assert int(limited_payload["retry_after_seconds"]) >= 1


def test_resend_pending_email_change_rate_limit_returns_too_many_requests(client, monkeypatch):
    monkeypatch.setitem(users_routes._SETTINGS_RATE_LIMITS, "resend_email_change", {"limit": 1, "window_seconds": 60})

    register = client.post(
        "/api/auth/register",
        json={
            "name": "Rate Pending Resend",
            "login": "rate.pending.resend",
            "email": "rate.pending.resend@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201

    update = client.post("/api/users/update", json={"email": "rate.pending.resend+next@example.com"})
    assert update.status_code == 200

    first = client.post("/api/users/resend-email-change", json={})
    limited = client.post("/api/users/resend-email-change", json={})

    assert first.status_code == 200
    assert limited.status_code == 429
    limited_payload = limited.get_json()
    assert limited_payload["error"] == "too_many_requests"
    assert int(limited_payload["retry_after_seconds"]) >= 1


def test_hosted_profile_update_stages_pending_email_change(client):
    register = client.post(
        "/api/auth/register",
        json={
            "name": "Editor One",
            "login": "editor.one",
            "email": "editor@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201

    update = client.post(
        "/api/users/update",
        json={
            "name": "Editor Prime",
            "email": "editor.prime@example.com",
        },
    )

    payload = update.get_json()
    assert update.status_code == 200
    assert payload["ok"] is True
    assert payload["email_change_pending"] is True
    assert payload["user"]["name"] == "Editor Prime"
    assert payload["user"]["email"] == "editor@example.com"
    assert payload["user"]["pending_email"] == "editor.prime@example.com"
    assert payload["user"]["pending_email_change_pending"] is True
    assert payload["user"]["pending_email_verification_sent_at"] == "2026-04-13T10:19:00Z"
    assert payload["verification_email"]["sent"] is True
    assert payload["verification_email"]["verify_url"].startswith("http://localhost/settings?pending_email_token=")


def test_hosted_profile_update_conceals_duplicate_email_change_conflict(client):
    first = client.post(
        "/api/auth/register",
        json={
            "name": "Editor Alpha",
            "login": "editor.alpha",
            "email": "editor.alpha@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert first.status_code == 201

    second = client.post(
        "/api/auth/register",
        json={
            "name": "Editor Beta",
            "login": "editor.beta",
            "email": "editor.beta@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert second.status_code == 201

    assert client.post("/api/auth/logout").status_code == 200
    login = client.post(
        "/api/auth/login",
        json={"identifier": "editor.alpha@example.com", "password": "StrongPass1"},
    )
    assert login.status_code == 200

    update = client.post(
        "/api/users/update",
        json={"email": "editor.beta@example.com"},
    )
    payload = update.get_json()
    assert update.status_code == 409
    assert payload["error"] == "email_change_unavailable"


def test_resend_pending_email_change_returns_delivery_status(client):
    register = client.post(
        "/api/auth/register",
        json={
            "name": "Pending Resend",
            "login": "pending.resend",
            "email": "pending.resend@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201

    update = client.post(
        "/api/users/update",
        json={"email": "pending.resend+next@example.com"},
    )
    assert update.status_code == 200

    resend = client.post("/api/users/resend-email-change", json={})
    payload = resend.get_json()

    assert resend.status_code == 200
    assert payload["ok"] is True
    assert payload["email_change_pending"] is True
    assert payload["user"]["email"] == "pending.resend@example.com"
    assert payload["user"]["pending_email"] == "pending.resend+next@example.com"
    assert payload["verification_email"]["sent"] is True
    assert payload["verification_email"]["verify_url"].startswith("http://localhost/settings?pending_email_token=")


def test_verify_pending_email_change_promotes_pending_email(client):
    register = client.post(
        "/api/auth/register",
        json={
            "name": "Pending Verify",
            "login": "pending.verify",
            "email": "pending.verify@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201

    update = client.post(
        "/api/users/update",
        json={"email": "pending.verify+next@example.com"},
    )
    assert update.status_code == 200

    verification_url = update.get_json()["verification_email"]["verify_url"]
    token = parse_qs(urlparse(verification_url).query)["pending_email_token"][0]

    verified = client.get(f"/api/auth/verify-email?token={token}&purpose=change_email")
    payload = verified.get_json()

    assert verified.status_code == 200
    assert payload["ok"] is True
    assert payload["verified"] is True
    assert payload["email_changed"] is True
    assert payload["user"]["email"] == "pending.verify+next@example.com"
    assert payload["user"]["pending_email"] is None
    assert payload["user"]["email_verified"] is True
    assert payload["user"]["email_verified_at"] == "2026-04-13T10:20:00Z"


def test_forgot_password_returns_generic_success_and_reset_link(client):
    register = client.post(
        "/api/auth/register",
        json={
            "name": "Forgot User",
            "login": "forgot.user",
            "email": "forgot@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201

    forgot = client.post(
        "/api/auth/forgot-password",
        json={"identifier": "forgot@example.com"},
    )
    assert forgot.status_code == 200
    payload = forgot.get_json()
    assert payload["ok"] is True
    assert payload["requested"] is True
    assert "Если аккаунт" in payload["message"]
    assert payload["password_reset_email"]["sent"] is False
    assert payload["password_reset_email"]["concealed"] is True

    concealed = client.post(
        "/api/auth/forgot-password",
        json={"identifier": "missing@example.com"},
    )
    assert concealed.status_code == 200
    concealed_payload = concealed.get_json()
    assert concealed_payload["ok"] is True
    assert concealed_payload["requested"] is True
    assert concealed_payload["password_reset_email"]["sent"] is False
    assert concealed_payload["password_reset_email"]["concealed"] is True


def test_reset_password_changes_password_and_rejects_token_reuse(client):
    register = client.post(
        "/api/auth/register",
        json={
            "name": "Reset User",
            "login": "reset.user",
            "email": "reset@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201

    forgot = client.post(
        "/api/auth/forgot-password",
        json={"identifier": "reset@example.com"},
    )
    assert forgot.status_code == 200
    user_service = ctx_module._app_ctx.user_service
    token = next(
        raw_token
        for raw_token, token_payload in user_service._email_tokens.items()
        if token_payload.get("purpose") == "reset_password"
        and token_payload.get("email") == "reset@example.com"
    )

    reset = client.post(
        "/api/auth/reset-password",
        json={
            "token": token,
            "new_password": "StrongPass2",
        },
    )
    assert reset.status_code == 200
    reset_payload = reset.get_json()
    assert reset_payload["ok"] is True
    assert reset_payload["password_reset"] is True
    assert reset_payload["user"]["authenticated"] is True

    logout = client.post("/api/auth/logout")
    assert logout.status_code == 200

    login = client.post(
        "/api/auth/login",
        json={
            "identifier": "reset@example.com",
            "password": "StrongPass2",
        },
    )
    assert login.status_code == 200
    assert login.get_json()["ok"] is True

    reused = client.post(
        "/api/auth/reset-password",
        json={
            "token": token,
            "new_password": "StrongPass3",
        },
    )
    assert reused.status_code == 409
    assert reused.get_json()["error"] == "token_already_used"


def test_hosted_profile_update_rejects_invalid_email(client):
    register = client.post(
        "/api/auth/register",
        json={
            "name": "Editor Two",
            "login": "editor.two",
            "email": "editor.two@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201

    update = client.post(
        "/api/users/update",
        json={"email": "invalid-email"},
    )

    assert update.status_code == 400
    assert update.get_json()["error"] == "invalid_email"


def test_hosted_change_password_requires_current_password(client):
    register = client.post(
        "/api/auth/register",
        json={
            "name": "Password User",
            "login": "password.user",
            "email": "password@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201

    missing = client.post(
        "/api/users/change-password",
        json={"new_password": "StrongPass2"},
    )
    assert missing.status_code == 400
    assert missing.get_json()["error"] == "current_password_required"

    invalid = client.post(
        "/api/users/change-password",
        json={
            "current_password": "WrongPass1",
            "new_password": "StrongPass2",
        },
    )
    assert invalid.status_code == 401
    assert invalid.get_json()["error"] == "current_password_invalid"

    valid = client.post(
        "/api/users/change-password",
        json={
            "current_password": "StrongPass1",
            "new_password": "StrongPass2",
        },
    )
    assert valid.status_code == 200
    assert valid.get_json()["ok"] is True

    relogin = client.post("/api/auth/logout")
    assert relogin.status_code == 200
    login = client.post(
        "/api/auth/login",
        json={
            "identifier": "password@example.com",
            "password": "StrongPass2",
        },
    )
    assert login.status_code == 200
    assert login.get_json()["ok"] is True


def test_hosted_avatar_upload_accepts_png_and_updates_profile(client):
    register = client.post(
        "/api/auth/register",
        json={
            "name": "Avatar User",
            "login": "avatar.user",
            "email": "avatar@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201

    response = client.post(
        "/api/users/avatar",
        data={"file": (_png_bytes(), "avatar.png")},
        content_type="multipart/form-data",
    )

    payload = response.get_json()
    assert response.status_code == 200
    assert payload["ok"] is True
    assert payload["user"]["avatar_seed"].endswith(".png")


def test_hosted_avatar_upload_crops_to_square_without_transparent_padding(client, tmp_path):
    register = client.post(
        "/api/auth/register",
        json={
            "name": "Avatar Crop",
            "login": "avatar.crop",
            "email": "avatar.crop@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201

    response = client.post(
        "/api/users/avatar",
        data={"file": (_png_bytes(size=(40, 20), color=(12, 180, 90)), "avatar.png")},
        content_type="multipart/form-data",
    )

    payload = response.get_json()
    assert response.status_code == 200
    avatar_path = tmp_path / "avatars" / payload["user"]["avatar_seed"]
    assert avatar_path.exists()

    with Image.open(avatar_path) as avatar:
        avatar = avatar.convert("RGBA")
        assert avatar.size == (512, 512)
        assert avatar.getpixel((0, 0))[3] == 255


def test_hosted_avatar_upload_uses_self_service_shadow_fallback_when_profile_write_blocked(client, monkeypatch):
    register = client.post(
        "/api/auth/register",
        json={
            "name": "Avatar Fallback",
            "login": "avatar.fallback",
            "email": "avatar.fallback@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201

    user_service = ctx_module._app_ctx.user_service

    def _blocked_update(_user):
        raise HostedShadowWriteFallbackDisabledError("update_user", reason="postgres_dsn_missing")

    def _shadow_update(user):
        return _FakeHostedUserService.update_user(user_service, user)

    monkeypatch.setattr(user_service, "update_user", _blocked_update)
    monkeypatch.setattr(user_service, "_shadow_update_user", _shadow_update, raising=False)

    response = client.post(
        "/api/users/avatar",
        data={"file": (_png_bytes(), "avatar.png")},
        content_type="multipart/form-data",
    )

    payload = response.get_json()
    assert response.status_code == 200
    assert payload["ok"] is True
    assert payload["user"]["avatar_seed"].endswith(".png")


def test_hosted_avatar_upload_rejects_unsupported_file_type(client):
    register = client.post(
        "/api/auth/register",
        json={
            "name": "Avatar Reject",
            "login": "avatar.reject",
            "email": "avatar.reject@example.com",
            "password": "StrongPass1",
            "consent": {
                "accepted": True,
                "terms_version": "terms-v1",
                "privacy_version": "privacy-v1",
                "refund_version": "refund-v1",
            },
        },
    )
    assert register.status_code == 201

    response = client.post(
        "/api/users/avatar",
        data={"file": (io.BytesIO(b"not-an-image"), "avatar.txt")},
        content_type="multipart/form-data",
    )

    assert response.status_code == 400
    assert response.get_json()["error"] == "invalid_image"


def test_legacy_default_avatar_url_returns_neutral_placeholder_svg(client):
    response = client.get("/api/assets/avatars/1.png")

    assert response.status_code == 200
    assert response.mimetype == "image/svg+xml"
    body = response.get_data(as_text=True)
    assert "<svg" in body
    assert "#F3F4F6" in body


def test_list_avatars_excludes_legacy_default_files(client, tmp_path):
    avatar_dir = tmp_path / "avatars"
    avatar_dir.mkdir(parents=True, exist_ok=True)
    (avatar_dir / "1.png").write_bytes(b"legacy")
    (avatar_dir / "7.png").write_bytes(b"legacy")
    (avatar_dir / "custom-user-avatar.png").write_bytes(b"custom")

    response = client.get("/api/assets/avatars")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["files"] == ["custom-user-avatar.png"]
