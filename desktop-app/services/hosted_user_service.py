from __future__ import annotations

import hashlib
import json
import logging
import os
import random
import re
import secrets
import shutil
import tempfile
import unicodedata
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from persistence.hosted_identity_repository import HostedIdentityRepository
from persistence.postgres import PostgresUnavailableError
from persistence.runtime import PersistenceRuntimeSettings
from services.hosted_shadow_fallback import (
    HostedShadowFallbackMixin,
    HostedShadowWriteFallbackDisabledError,
)
from services.schemas.user_schemas import ProfileSchema
from services.user_service import (
    User,
    UserService,
    USER_PLAN_FREE,
    USER_PLAN_PREMIUM,
    USER_ROLE_ADMIN,
    USER_ROLE_USER,
    apply_registration_premium_promo,
)


class HostedUserService(HostedShadowFallbackMixin, UserService):
    """Hosted identity service backed by Postgres with filesystem projection."""

    LOGIN_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$")
    EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    LOGIN_TRANSLITERATION_MAP = {
        "\u0430": "a",
        "\u0431": "b",
        "\u0432": "v",
        "\u0433": "g",
        "\u0491": "g",
        "\u0434": "d",
        "\u0435": "e",
        "\u0451": "e",
        "\u0454": "ye",
        "\u0436": "zh",
        "\u0437": "z",
        "\u0438": "i",
        "\u0456": "i",
        "\u0457": "yi",
        "\u0439": "y",
        "\u043a": "k",
        "\u043b": "l",
        "\u043c": "m",
        "\u043d": "n",
        "\u043e": "o",
        "\u043f": "p",
        "\u0440": "r",
        "\u0441": "s",
        "\u0442": "t",
        "\u0443": "u",
        "\u0444": "f",
        "\u0445": "kh",
        "\u0446": "ts",
        "\u0447": "ch",
        "\u0448": "sh",
        "\u0449": "shch",
        "\u044a": "",
        "\u044b": "y",
        "\u044c": "",
        "\u044d": "e",
        "\u044e": "yu",
        "\u044f": "ya",
        "\u0493": "gh",
        "\u04af": "u",
        "\u04b1": "u",
        "\u04d9": "e",
        "\u045f": "dj",
        "\u045c": "k",
        "\u0452": "dj",
        "\u0459": "lj",
        "\u045a": "nj",
        "\u045b": "c",
        "\u2019": "",
        "'": "",
    }
    SYNTHETIC_EMAIL_DOMAIN = "actra.local"
    EMAIL_TOKEN_TTL_SECONDS = 24 * 60 * 60
    PASSWORD_RESET_TOKEN_TTL_SECONDS = 60 * 60
    PASSWORD_MIN_LENGTH = 8
    ALLOWED_ROLES = {USER_ROLE_USER, USER_ROLE_ADMIN}
    ALLOWED_PLANS = {USER_PLAN_FREE, USER_PLAN_PREMIUM}

    def __init__(self, data_dir: str, persistence_settings: PersistenceRuntimeSettings):
        super().__init__(data_dir=data_dir)
        self.persistence_settings = persistence_settings
        self.repository = HostedIdentityRepository(self.persistence_settings.postgres_dsn)
        self._storage_ready = False
        self._migration_report_path = self.data_dir / "hosted_identity_migration_report.json"
        self.logger = logging.getLogger(self.__class__.__name__)
        self._init_hosted_shadow_fallback_state()

    @property
    def hosted_storage_ready(self) -> bool:
        return bool(self._storage_ready)

    def ensure_persistence_ready(self) -> None:
        if self._storage_ready:
            return
        self.repository.ensure_schema()
        self._bootstrap_from_legacy_if_empty()
        self._migrate_hosted_users_to_auth_identity()
        self._storage_ready = True

    def get_last_user_id(self) -> Optional[str]:
        return None

    def save_last_user_id(self, user_id: str):
        self.logger.debug("[HOSTED] save_last_user_id ignored for hosted runtime: %s", user_id)

    def create_user(self, name: str) -> User:
        """Legacy creation path kept for non-auth compat/bootstrap."""
        self.ensure_persistence_ready()
        clean_name = self._validate_name(name)
        if self.repository.name_exists(clean_name):
            raise ValueError("duplicate_name")
        created_at = datetime.utcnow().isoformat() + "Z"
        user = User(
            user_id=self._generate_user_id(),
            name=clean_name,
            created_at=created_at,
            avatar_seed=f"{random.randint(1, 7)}.png",
            settings={},
        )
        apply_registration_premium_promo(user, created_at)
        self.repository.create_user(user, updated_at=created_at)
        try:
            self._write_legacy_profile_projection(user, initialize_progress=True)
        except Exception:
            self.repository.delete_user(user.user_id)
            raise
        user = self._maybe_promote_bootstrap_admin(user)
        self.logger.info("[HOSTED] Created user in Postgres: %s (%s)", user.user_id, user.name)
        return user

    def create_auth_user(
        self,
        *,
        name: str,
        login: str,
        email: str,
        password: str,
        avatar_seed: Optional[str] = None,
    ) -> User:
        import bcrypt

        self.ensure_persistence_ready()
        clean_name = self._validate_name(name)
        clean_login = self.normalize_login(login)
        clean_email = self.normalize_email(email)
        self.validate_email(clean_email)

        if self.repository.name_exists(clean_name):
            raise ValueError("duplicate_name")
        if clean_login:
            self.validate_login(clean_login)
            if self.repository.login_exists(clean_login):
                raise ValueError("login_already_exists")
        else:
            clean_login = self.generate_available_login_from_name(clean_name)
        if self.repository.email_exists(clean_email) or self.repository.pending_email_exists(clean_email):
            raise ValueError("email_already_exists")
        if len(str(password or "")) < 8:
            raise ValueError("invalid_password")

        created_at = datetime.utcnow().isoformat() + "Z"
        user = User(
            user_id=self._generate_user_id(),
            name=clean_name,
            created_at=created_at,
            avatar_seed=(str(avatar_seed or "").strip() or "1.png"),
            login=clean_login,
            email=clean_email,
            password_hash=bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8"),
            settings={},
        )
        apply_registration_premium_promo(user, created_at)
        security_settings = dict(user.security_settings or {})
        security_settings["require_password_on_login"] = True
        user.security_settings = security_settings
        self.repository.create_user(user, updated_at=created_at)
        try:
            self._write_legacy_profile_projection(user, initialize_progress=True)
        except Exception:
            self.repository.delete_user(user.user_id)
            raise
        user = self._maybe_promote_bootstrap_admin(user)
        self.logger.info("[HOSTED] Created auth user in Postgres: %s (%s)", user.user_id, user.login)
        return user

    def create_external_auth_user(
        self,
        *,
        provider: str,
        provider_subject: str,
        name: str,
        email: str,
        avatar_seed: Optional[str] = None,
    ) -> User:
        self.ensure_persistence_ready()
        clean_provider = str(provider or "").strip().lower()
        clean_subject = str(provider_subject or "").strip()
        if clean_provider != "google" or not clean_subject:
            raise ValueError("invalid_external_provider")

        clean_name = self._validate_name(name)
        clean_email = self.normalize_email(email)
        self.validate_email(clean_email)
        if self.repository.name_exists(clean_name):
            raise ValueError("duplicate_name")
        if self.repository.email_exists(clean_email) or self.repository.pending_email_exists(clean_email):
            raise ValueError("email_already_exists")

        clean_login = self.generate_available_login_from_name(clean_email.split("@", 1)[0] or clean_name)
        created_at = datetime.utcnow().isoformat() + "Z"
        user = User(
            user_id=self._generate_user_id(),
            name=clean_name,
            created_at=created_at,
            avatar_seed=(str(avatar_seed or "").strip() or "1.png"),
            login=clean_login,
            email=clean_email,
            email_verified_at=created_at,
            email_verification_sent_at=created_at,
            password_hash=None,
            settings={
                "auth_providers": {
                    clean_provider: {
                        "sub": clean_subject,
                        "email": clean_email,
                        "linked_at": created_at,
                        "last_login_at": created_at,
                    }
                }
            },
        )
        apply_registration_premium_promo(user, created_at)
        security_settings = dict(user.security_settings or {})
        security_settings["require_password_on_login"] = False
        user.security_settings = security_settings
        self.repository.create_user(user, updated_at=created_at)
        try:
            self._write_legacy_profile_projection(user, initialize_progress=True)
        except Exception:
            self.repository.delete_user(user.user_id)
            raise
        user = self._maybe_promote_bootstrap_admin(user)
        self.logger.info("[HOSTED] Created external auth user in Postgres: %s (%s)", user.user_id, user.login)
        return user

    def get_user(self, user_id: str) -> Optional[User]:
        if not user_id or user_id == "guest":
            return None
        try:
            self.ensure_persistence_ready()
            user = self.repository.get_user(user_id)
            return self._maybe_promote_bootstrap_admin(user)
        except PostgresUnavailableError as exc:
            self._log_shadow_read_fallback("get_user", exc)
            return self._maybe_promote_bootstrap_admin(self._shadow_get_user(user_id))

    def get_all_users(self) -> List[User]:
        try:
            self.ensure_persistence_ready()
            users = self.repository.list_users()
            return [self._maybe_promote_bootstrap_admin(user) for user in users]
        except PostgresUnavailableError as exc:
            self._log_shadow_read_fallback("get_all_users", exc)
            return [self._maybe_promote_bootstrap_admin(user) for user in self._shadow_get_all_users()]

    def search_users(self, query: str = "") -> List[User]:
        clean_query = str(query or "").strip()
        try:
            self.ensure_persistence_ready()
            users = self.repository.search_users(clean_query)
            return [self._maybe_promote_bootstrap_admin(user) for user in users]
        except PostgresUnavailableError as exc:
            self._log_shadow_read_fallback("search_users", exc)
            lowered = clean_query.lower()
            users = [self._maybe_promote_bootstrap_admin(user) for user in self._shadow_get_all_users()]
            if not lowered:
                return users
            return [
                user
                for user in users
                if lowered in str(user.name or "").strip().lower()
                or lowered in str(user.login or "").strip().lower()
                or lowered in str(user.email or "").strip().lower()
            ]

    def is_admin_user(self, user: Optional[User]) -> bool:
        return str(getattr(user, "role", "") or "").strip().lower() == USER_ROLE_ADMIN

    def set_user_plan(self, target_user_id: str, plan: str, *, actor_user_id: str = "") -> Optional[User]:
        clean_target_user_id = str(target_user_id or "").strip()
        clean_plan = str(plan or "").strip().lower()
        if not clean_target_user_id:
            raise ValueError("user_id_required")
        if clean_plan not in self.ALLOWED_PLANS:
            raise ValueError("invalid_plan")

        user = self.get_user(clean_target_user_id)
        if user is None:
            return None

        previous_plan = str(user.plan or USER_PLAN_FREE).strip().lower() or USER_PLAN_FREE
        user.plan = clean_plan
        if clean_plan == USER_PLAN_FREE:
            user.premium_expires_at = None
        if not self.update_user(user):
            return None

        refreshed_user = self.get_user(clean_target_user_id) or user
        self.logger.info(
            "[HOSTED][ADMIN] actor=%s target=%s plan:%s->%s",
            str(actor_user_id or "").strip() or "unknown",
            clean_target_user_id,
            previous_plan,
            clean_plan,
        )
        return refreshed_user

    def find_user_by_identifier(self, identifier: str) -> Optional[User]:
        clean_identifier = str(identifier or "").strip()
        if not clean_identifier:
            return None
        try:
            self.ensure_persistence_ready()
            if "@" in clean_identifier:
                user = self.repository.get_user_by_email(clean_identifier)
                if user is not None:
                    return self._maybe_promote_bootstrap_admin(user)
            user = self.repository.get_user_by_login(clean_identifier)
            if user is not None:
                return self._maybe_promote_bootstrap_admin(user)
        except PostgresUnavailableError as exc:
            self._log_shadow_read_fallback("find_user_by_identifier", exc)

        direct = self._shadow_get_user(clean_identifier)
        if direct is not None:
            return self._maybe_promote_bootstrap_admin(direct)
        lowered = clean_identifier.lower()
        for user in self._shadow_get_all_users():
            if str(user.login or "").strip().lower() == lowered:
                return self._maybe_promote_bootstrap_admin(user)
            if str(user.email or "").strip().lower() == lowered:
                return self._maybe_promote_bootstrap_admin(user)
            if str(user.name or "").strip().lower() == lowered:
                return self._maybe_promote_bootstrap_admin(user)
        return None

    def verify_password(self, user_id: str, password: str, auto_migrate: bool = True) -> bool:
        import bcrypt

        user = self.get_user(user_id)
        if not user or not user.password_hash:
            return not user or not user.password_hash

        is_valid = False
        if user.password_hash.startswith("$2b$"):
            is_valid = bcrypt.checkpw(password.encode("utf-8"), user.password_hash.encode("utf-8"))
        else:
            hashed = hashlib.sha256(password.encode()).hexdigest()
            is_valid = hashed == user.password_hash
            if is_valid and auto_migrate:
                user.password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
                try:
                    self.update_user(user)
                    self.logger.info("[HOSTED] Auto-migrated password hash to bcrypt for user %s", user_id)
                except (PostgresUnavailableError, HostedShadowWriteFallbackDisabledError) as exc:
                    self.logger.warning(
                        "[HOSTED][DEV-FALLBACK] Skipped password hash auto-migration for user %s because persistence write is unavailable: %s",
                        user_id,
                        exc,
                    )
        return is_valid

    def update_user(self, user: User) -> bool:
        user = self._apply_shadow_auth_identity(user)
        user.role = self.normalize_role(getattr(user, "role", USER_ROLE_USER))
        user.plan = self.normalize_plan(getattr(user, "plan", USER_PLAN_FREE))
        try:
            self.ensure_persistence_ready()
            previous_user = self.repository.get_user(user.user_id)
            if previous_user is None:
                return False

            try:
                ProfileSchema.validate_or_raise(user.to_dict())
            except Exception as exc:
                self.logger.error("[HOSTED] Validation failed for user %s: %s", user.user_id, exc)
                return False

            try:
                user.name = self._validate_name(user.name)
            except ValueError:
                return False
            if self.repository.name_exists(user.name, exclude_user_id=user.user_id):
                self.logger.warning("[HOSTED] Duplicate name refused for user %s: %s", user.user_id, user.name)
                return False

            if user.login:
                user.login = self.normalize_login(user.login)
                try:
                    self.validate_login(user.login)
                except ValueError:
                    return False
                if self.repository.login_exists(user.login, exclude_user_id=user.user_id):
                    self.logger.warning("[HOSTED] Duplicate login refused for user %s: %s", user.user_id, user.login)
                    return False

            if user.email:
                user.email = self.normalize_email(user.email)
                try:
                    self.validate_email(user.email)
                except ValueError:
                    return False
                if self.repository.email_exists(user.email, exclude_user_id=user.user_id) or self.repository.pending_email_exists(user.email, exclude_user_id=user.user_id):
                    self.logger.warning("[HOSTED] Duplicate email refused for user %s: %s", user.user_id, user.email)
                    return False

            if user.pending_email:
                user.pending_email = self.normalize_email(user.pending_email)
                try:
                    self.validate_email(user.pending_email)
                except ValueError:
                    return False
                if self.repository.email_exists(user.pending_email, exclude_user_id=user.user_id) or self.repository.pending_email_exists(user.pending_email, exclude_user_id=user.user_id):
                    self.logger.warning("[HOSTED] Duplicate pending email refused for user %s: %s", user.user_id, user.pending_email)
                    return False
            else:
                user.pending_email = None

            previous_email = self.normalize_email(previous_user.email or "")
            current_email = self.normalize_email(user.email or "")
            previous_pending_email = self.normalize_email(previous_user.pending_email or "")
            current_pending_email = self.normalize_email(user.pending_email or "")
            confirmed_pending_swap = bool(previous_pending_email and previous_pending_email == current_email and previous_email != current_email)
            if previous_email != current_email and not confirmed_pending_swap:
                user.email_verified_at = None
                user.email_verification_sent_at = None
            if confirmed_pending_swap and not str(user.email_verified_at or "").strip():
                user.email_verified_at = str(previous_user.email_verified_at or "").strip() or None
            if current_pending_email != previous_pending_email:
                user.pending_email_verification_sent_at = None
            if not current_pending_email:
                user.pending_email_verification_sent_at = None

            updated = self.repository.update_user(user, updated_at=datetime.utcnow().isoformat() + "Z")
            if updated:
                try:
                    self._write_legacy_profile_projection(user, initialize_progress=False)
                except Exception as exc:
                    self.logger.warning("[HOSTED] Legacy projection update failed for user %s: %s", user.user_id, exc)
                    self.repository.update_user(previous_user, updated_at=datetime.utcnow().isoformat() + "Z")
                    try:
                        self._write_legacy_profile_projection(previous_user, initialize_progress=False)
                    except Exception:
                        pass
                    return False
            return updated
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("update_user", exc)
            return self._shadow_update_user(user)

    def delete_user(self, user_id: str) -> bool:
        self.ensure_persistence_ready()
        deleted = self.repository.delete_user(user_id)
        if not deleted:
            return False
        self._delete_legacy_projection(user_id)
        self.logger.info("[HOSTED] Deleted user from Postgres: %s", user_id)
        return True

    def read_consent(self, user_id: str) -> Optional[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
            return self.repository.get_latest_consent(user_id)
        except PostgresUnavailableError as exc:
            self._log_shadow_read_fallback("read_consent", exc)
            return self._read_legacy_consent_projection(user_id)

    def write_consent(
        self,
        user_id: str,
        terms_version: str,
        privacy_version: str,
        refund_version: str,
        *,
        source: str = "unknown",
    ) -> Dict[str, Any]:
        self.ensure_persistence_ready()
        payload: Dict[str, Any] = {
            "version": 1,
            "consent_id": f"consent_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}",
            "user_id": user_id,
            "terms_version": terms_version,
            "privacy_version": privacy_version,
            "refund_version": refund_version,
            "accepted_at": datetime.utcnow().isoformat() + "Z",
            "source": source,
        }
        self.repository.write_consent(payload)
        self._write_legacy_consent_projection(user_id, payload)
        return payload

    def bootstrap_consent_from_legacy(self, user_id: str, payload: Dict[str, Any]) -> None:
        self.ensure_persistence_ready()
        self.repository.import_consent_if_absent(payload)
        self._write_legacy_consent_projection(user_id, payload)

    def mark_email_verification_sent(
        self,
        user_id: str,
        *,
        sent_at: Optional[str] = None,
    ) -> bool:
        user = self.get_user(user_id)
        if user is None or not str(user.email or "").strip() or self.is_synthetic_email(user.email or ""):
            return False
        user.email_verification_sent_at = str(sent_at or self._utcnow_iso()).strip()
        return self.update_user(user)

    def mark_email_as_verified(
        self,
        user_id: str,
        *,
        verified_at: Optional[str] = None,
    ) -> bool:
        user = self.get_user(user_id)
        if user is None or not str(user.email or "").strip() or self.is_synthetic_email(user.email or ""):
            return False
        stamp = str(verified_at or self._utcnow_iso()).strip()
        user.email_verified_at = stamp
        if not str(user.email_verification_sent_at or "").strip():
            user.email_verification_sent_at = stamp
        return self.update_user(user)

    def mark_pending_email_verification_sent(
        self,
        user_id: str,
        *,
        sent_at: Optional[str] = None,
    ) -> bool:
        user = self.get_user(user_id)
        if user is None or not str(user.pending_email or "").strip() or self.is_synthetic_email(user.pending_email or ""):
            return False
        user.pending_email_verification_sent_at = str(sent_at or self._utcnow_iso()).strip()
        return self.update_user(user)

    def stage_pending_email_change(self, user_id: str, new_email: str) -> Optional[User]:
        user = self.get_user(user_id)
        if user is None:
            return None
        clean_email = self.normalize_email(new_email)
        self.validate_email(clean_email)
        if self.is_synthetic_email(clean_email):
            raise ValueError("invalid_email")
        user.pending_email = clean_email
        user.pending_email_verification_sent_at = None
        if not self.update_user(user):
            return None
        return self.get_user(user_id) or user

    def clear_pending_email_change(self, user_id: str) -> bool:
        user = self.get_user(user_id)
        if user is None:
            return False
        user.pending_email = None
        user.pending_email_verification_sent_at = None
        return self.update_user(user)

    def confirm_pending_email_change(
        self,
        user_id: str,
        *,
        verified_at: Optional[str] = None,
    ) -> bool:
        user = self.get_user(user_id)
        if user is None or not str(user.pending_email or "").strip() or self.is_synthetic_email(user.pending_email or ""):
            return False
        stamp = str(verified_at or self._utcnow_iso()).strip()
        pending_sent_at = str(user.pending_email_verification_sent_at or "").strip() or stamp
        user.email = self.normalize_email(user.pending_email)
        user.pending_email = None
        user.email_verified_at = stamp
        user.email_verification_sent_at = pending_sent_at
        user.pending_email_verification_sent_at = None
        return self.update_user(user)

    def consume_rate_limit(
        self,
        scope: str,
        subject_key: str,
        *,
        limit: int,
        window_seconds: int,
    ) -> Dict[str, Any]:
        clean_scope = str(scope or "").strip()
        clean_subject_key = str(subject_key or "").strip()
        limit_value = int(limit or 0)
        window_value = int(window_seconds or 0)
        if not clean_scope or not clean_subject_key:
            raise ValueError("rate_limit_scope_required")
        if limit_value <= 0 or window_value <= 0:
            return {
                "allowed": True,
                "attempt_count": 0,
                "retry_after_seconds": 0,
                "scope": clean_scope,
                "subject_key": clean_subject_key,
            }

        now_dt = datetime.utcnow()
        now_ts = int(now_dt.timestamp())
        window_key = now_ts // window_value
        retry_after = max(1, window_value - (now_ts % window_value))
        current_at = now_dt.isoformat() + "Z"
        expires_at = (now_dt + timedelta(seconds=retry_after)).isoformat() + "Z"

        try:
            self.ensure_persistence_ready()
            payload = self.repository.consume_rate_limit(
                clean_scope,
                clean_subject_key,
                window_key=window_key,
                current_at=current_at,
                expires_at=expires_at,
            )
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("consume_rate_limit", exc)
            payload = self._shadow_consume_rate_limit(
                clean_scope,
                clean_subject_key,
                window_key=window_key,
                current_at=current_at,
                expires_at=expires_at,
            )

        attempt_count = int((payload or {}).get("attempt_count") or 0)
        return {
            "allowed": attempt_count <= limit_value,
            "attempt_count": attempt_count,
            "retry_after_seconds": retry_after,
            "scope": clean_scope,
            "subject_key": clean_subject_key,
            "window_key": window_key,
            "expires_at": str((payload or {}).get("expires_at") or expires_at).strip() or expires_at,
        }

    def create_email_verification_token(
        self,
        user_id: str,
        *,
        purpose: str = "verify_email",
        ttl_seconds: Optional[int] = None,
        meta: Optional[Dict[str, Any]] = None,
        email_override: Optional[str] = None,
    ) -> Dict[str, Any]:
        user = self.get_user(user_id)
        if user is None:
            raise ValueError("user_not_found")

        email_source = email_override if email_override is not None else user.email
        clean_email = self.normalize_email(email_source or "")
        if not clean_email or self.is_synthetic_email(clean_email):
            raise ValueError("email_required")

        issued_at = self._utcnow_iso()
        ttl_value = int(ttl_seconds or self.EMAIL_TOKEN_TTL_SECONDS)
        raw_token = secrets.token_urlsafe(32)
        payload: Dict[str, Any] = {
            "token_id": f"evt_{uuid.uuid4().hex}",
            "user_id": user.user_id,
            "email": clean_email,
            "purpose": str(purpose or "verify_email").strip() or "verify_email",
            "token_hash": self.hash_email_token(raw_token),
            "created_at": issued_at,
            "expires_at": (datetime.fromisoformat(issued_at.replace("Z", "+00:00")) + timedelta(seconds=ttl_value))
            .isoformat()
            .replace("+00:00", "Z"),
            "used_at": None,
            "meta": dict(meta or {}),
        }

        try:
            self.ensure_persistence_ready()
            self.repository.create_email_token(payload)
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("create_email_verification_token", exc)
            self._shadow_create_email_token(payload)

        response = dict(payload)
        response.pop("token_hash", None)
        response["token"] = raw_token
        return response

    def get_email_verification_token(
        self,
        token: str,
        *,
        purpose: str = "verify_email",
        include_used: bool = False,
    ) -> Optional[Dict[str, Any]]:
        clean_token = str(token or "").strip()
        if not clean_token:
            return None

        token_hash = self.hash_email_token(clean_token)
        try:
            self.ensure_persistence_ready()
            payload = self.repository.get_email_token_by_hash(
                token_hash,
                purpose=str(purpose or "verify_email").strip() or "verify_email",
                include_used=include_used,
            )
        except PostgresUnavailableError as exc:
            self._log_shadow_read_fallback("get_email_verification_token", exc)
            payload = self._shadow_get_email_token_by_hash(
                token_hash,
                purpose=str(purpose or "verify_email").strip() or "verify_email",
                include_used=include_used,
            )
        return self._normalize_email_token_payload(payload, include_used=include_used)

    def consume_email_verification_token(
        self,
        token: str,
        *,
        purpose: str = "verify_email",
        used_at: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        payload = self.get_email_verification_token(token, purpose=purpose, include_used=False)
        if payload is None:
            return None

        used_stamp = str(used_at or self._utcnow_iso()).strip()
        try:
            self.ensure_persistence_ready()
            if not self.repository.mark_email_token_used(payload["token_id"], used_at=used_stamp):
                return None
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("consume_email_verification_token", exc)
            if not self._shadow_mark_email_token_used(payload["token_id"], used_at=used_stamp):
                return None

        payload["used_at"] = used_stamp
        return payload

    def set_password(self, user_id: str, new_password: str) -> User:
        import bcrypt

        clean_password = str(new_password or "")
        if len(clean_password) < self.PASSWORD_MIN_LENGTH:
            raise ValueError("invalid_password")

        user = self.get_user(user_id)
        if user is None:
            raise ValueError("user_not_found")

        user.password_hash = bcrypt.hashpw(clean_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        security_settings = dict(user.security_settings or {})
        security_settings["require_password_on_login"] = True
        user.security_settings = security_settings
        if not self.update_user(user):
            raise RuntimeError("update_failed")
        return self.get_user(user_id) or user

    def _bootstrap_from_legacy_if_empty(self) -> None:
        if self.repository.count_users() > 0:
            return
        legacy_users = super().get_all_users()
        if not legacy_users:
            return
        self.logger.info("[HOSTED] Bootstrapping %d legacy users into Postgres", len(legacy_users))
        for user in legacy_users:
            updated_at = datetime.utcnow().isoformat() + "Z"
            self.repository.import_user_if_absent(user, updated_at=updated_at)
            self._write_legacy_profile_projection(user, initialize_progress=False)
            legacy_consent = self._read_legacy_consent_projection(user.user_id)
            if legacy_consent:
                self.repository.import_consent_if_absent(legacy_consent)

    def _migrate_hosted_users_to_auth_identity(self) -> None:
        migrated_entries: List[Dict[str, Any]] = []
        for user in self.repository.list_users():
            changed = False
            temporary_password: Optional[str] = None
            if not user.login:
                user.login = self.build_synthetic_login(user.user_id)
                changed = True
            if not user.email:
                user.email = self.build_synthetic_email(user.user_id)
                changed = True
            if not user.password_hash:
                import bcrypt

                temporary_password = self.build_synthetic_password(user.user_id)
                user.password_hash = bcrypt.hashpw(
                    temporary_password.encode("utf-8"),
                    bcrypt.gensalt(),
                ).decode("utf-8")
                security_settings = dict(user.security_settings or {})
                security_settings["require_password_on_login"] = True
                user.security_settings = security_settings
                changed = True
            if not changed:
                continue
            self.repository.update_user(user, updated_at=datetime.utcnow().isoformat() + "Z")
            self._write_legacy_profile_projection(user, initialize_progress=False)
            migrated_entries.append(
                {
                    "user_id": user.user_id,
                    "name": user.name,
                    "login": user.login,
                    "email": user.email,
                    "temporary_password": temporary_password,
                    "temporary_password_generated": temporary_password is not None,
                }
            )

        if migrated_entries:
            self._write_migration_report(migrated_entries)
            self.logger.info(
                "[HOSTED] Migrated %d hosted users to login/email identity; report: %s",
                len(migrated_entries),
                self._migration_report_path,
            )

    def _write_migration_report(self, entries: List[Dict[str, Any]]) -> None:
        existing_entries: Dict[str, Dict[str, Any]] = {}
        if self._migration_report_path.exists():
            try:
                payload = json.loads(self._migration_report_path.read_text(encoding="utf-8"))
                for item in payload.get("users", []):
                    user_id = str((item or {}).get("user_id") or "").strip()
                    if user_id:
                        existing_entries[user_id] = dict(item)
            except Exception:
                existing_entries = {}
        for entry in entries:
            existing_entries[str(entry.get("user_id") or "").strip()] = dict(entry)

        report = {
            "version": 1,
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "users": [existing_entries[key] for key in sorted(existing_entries)],
        }
        self._migration_report_path.parent.mkdir(parents=True, exist_ok=True)
        temp_name = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                dir=str(self._migration_report_path.parent),
                delete=False,
                encoding="utf-8",
                suffix=".tmp",
            ) as tf:
                json.dump(report, tf, ensure_ascii=False, indent=2)
                temp_name = tf.name
            os.replace(temp_name, str(self._migration_report_path))
        finally:
            if temp_name and os.path.exists(temp_name):
                try:
                    os.remove(temp_name)
                except Exception:
                    pass

    def _generate_user_id(self) -> str:
        self.ensure_persistence_ready()
        while True:
            unique_id = str(uuid.uuid4()).replace("-", "")[:12]
            user_id = f"user_{unique_id}"
            if not self.repository.user_exists(user_id):
                return user_id

    @classmethod
    def normalize_login(cls, login: str) -> str:
        return str(login or "").strip().lower()

    @classmethod
    def build_login_base_from_name(cls, name: str) -> str:
        transliterated_parts: List[str] = []
        normalized_name = unicodedata.normalize("NFKD", str(name or "").strip().lower())
        for char in normalized_name:
            if unicodedata.category(char) == "Mn":
                continue
            mapped = cls.LOGIN_TRANSLITERATION_MAP.get(char)
            if mapped is not None:
                transliterated_parts.append(mapped)
                continue
            if char.isascii():
                transliterated_parts.append(char)

        candidate = "".join(transliterated_parts)
        candidate = re.sub(r"[^a-z0-9._-]+", "-", candidate)
        candidate = re.sub(r"[-._]{2,}", "-", candidate)
        candidate = candidate.strip("-._")
        if not candidate:
            candidate = "user"
        if len(candidate) < 3:
            candidate = f"user-{candidate}".strip("-")
        candidate = candidate[:32].rstrip("-._")
        if len(candidate) < 3:
            candidate = "user"
        cls.validate_login(candidate)
        return candidate

    def generate_available_login_from_name(self, name: str) -> str:
        base_login = self.build_login_base_from_name(name)
        if not self.repository.login_exists(base_login):
            return base_login

        for suffix_number in range(2, 1000):
            suffix = f"-{suffix_number}"
            stem = base_login[: 32 - len(suffix)].rstrip("-._")
            if len(stem) < 3:
                stem = "user"
            candidate = f"{stem}{suffix}"
            if not self.repository.login_exists(candidate):
                return candidate

        raise ValueError("login_already_exists")

    @classmethod
    def normalize_email(cls, email: str) -> str:
        return str(email or "").strip().lower()

    @classmethod
    def normalize_role(cls, role: str) -> str:
        clean_role = str(role or "").strip().lower()
        return clean_role if clean_role in cls.ALLOWED_ROLES else USER_ROLE_USER

    @classmethod
    def normalize_plan(cls, plan: str) -> str:
        clean_plan = str(plan or "").strip().lower()
        return clean_plan if clean_plan in cls.ALLOWED_PLANS else USER_PLAN_FREE

    @staticmethod
    def _bootstrap_admin_login() -> str:
        return str(os.environ.get("ACTRA_ADMIN_LOGIN") or "").strip().lower()

    @staticmethod
    def _bootstrap_admin_email() -> str:
        return str(os.environ.get("ACTRA_ADMIN_EMAIL") or "").strip().lower()

    def _bootstrap_admin_matches_user(self, user: Optional[User]) -> bool:
        if user is None:
            return False

        admin_login = self._bootstrap_admin_login()
        admin_email = self._bootstrap_admin_email()
        if not admin_login and not admin_email:
            return False

        user_login = self.normalize_login(getattr(user, "login", ""))
        user_email = self.normalize_email(getattr(user, "email", ""))
        login_match = bool(admin_login) and user_login == admin_login
        email_match = bool(admin_email) and user_email == admin_email

        if admin_login and admin_email:
            if login_match and email_match:
                return True
            if login_match != email_match:
                self.logger.warning(
                    "[HOSTED][ADMIN] Bootstrap admin env conflict for user %s: login=%s email=%s",
                    getattr(user, "user_id", ""),
                    admin_login,
                    admin_email,
                )
            return False
        return login_match or email_match

    def _maybe_promote_bootstrap_admin(self, user: Optional[User]) -> Optional[User]:
        if user is None:
            return None
        user.role = self.normalize_role(getattr(user, "role", USER_ROLE_USER))
        user.plan = self.normalize_plan(getattr(user, "plan", USER_PLAN_FREE))
        if user.role == USER_ROLE_ADMIN:
            return user
        if not self._bootstrap_admin_matches_user(user):
            return user

        user.role = USER_ROLE_ADMIN
        try:
            if self.update_user(user):
                self.logger.info("[HOSTED][ADMIN] Bootstrap promoted user to admin: %s", user.user_id)
        except Exception:
            self.logger.exception("[HOSTED][ADMIN] Failed to persist bootstrap admin role for user %s", user.user_id)
        return user

    @classmethod
    def validate_login(cls, login: str) -> None:
        clean_login = cls.normalize_login(login)
        if not clean_login:
            raise ValueError("login_required")
        if len(clean_login) < 3 or len(clean_login) > 32:
            raise ValueError("invalid_login")
        if not cls.LOGIN_PATTERN.match(clean_login):
            raise ValueError("invalid_login")

    @classmethod
    def validate_email(cls, email: str) -> None:
        clean_email = cls.normalize_email(email)
        if not clean_email:
            raise ValueError("email_required")
        if len(clean_email) > 255 or not cls.EMAIL_PATTERN.match(clean_email):
            raise ValueError("invalid_email")

    @classmethod
    def is_synthetic_email(cls, email: str) -> bool:
        clean_email = cls.normalize_email(email)
        return bool(clean_email) and clean_email.endswith(f"@{cls.SYNTHETIC_EMAIL_DOMAIN}")

    @classmethod
    def build_synthetic_login(cls, user_id: str) -> str:
        suffix = str(user_id or "").strip().lower().replace("user_", "")
        return f"legacy_{suffix}"

    @classmethod
    def build_synthetic_email(cls, user_id: str) -> str:
        clean_user_id = str(user_id or "").strip().lower()
        return f"legacy+{clean_user_id}@{cls.SYNTHETIC_EMAIL_DOMAIN}"

    @classmethod
    def build_synthetic_password(cls, user_id: str) -> str:
        digest = hashlib.sha256(str(user_id or "").strip().encode("utf-8")).hexdigest()[:10]
        return f"Actra!{digest}"

    @staticmethod
    def _utcnow_iso() -> str:
        return datetime.utcnow().isoformat() + "Z"

    @staticmethod
    def hash_email_token(token: str) -> str:
        return hashlib.sha256(str(token or "").strip().encode("utf-8")).hexdigest()

    def _email_token_store_path(self) -> Path:
        return self.data_dir / "hosted_email_tokens.json"

    def _rate_limit_store_path(self) -> Path:
        return self.data_dir / "hosted_rate_limits.json"

    def _normalize_email_token_payload(
        self,
        payload: Optional[Dict[str, Any]],
        *,
        include_used: bool,
    ) -> Optional[Dict[str, Any]]:
        if not isinstance(payload, dict):
            return None
        used_at = str(payload.get("used_at") or "").strip() or None
        expires_at = str(payload.get("expires_at") or "").strip()
        if used_at and not include_used:
            return None
        if expires_at:
            try:
                expires_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                if expires_dt < datetime.now(expires_dt.tzinfo):
                    return None
            except Exception:
                return None
        normalized = dict(payload)
        normalized["used_at"] = used_at
        normalized["meta"] = dict(payload.get("meta") or {})
        return normalized

    def _read_shadow_email_tokens(self) -> List[Dict[str, Any]]:
        path = self._email_token_store_path()
        if not path.exists():
            return []
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return []
        items = payload.get("tokens", []) if isinstance(payload, dict) else []
        return [dict(item) for item in items if isinstance(item, dict)]

    def _write_shadow_email_tokens(self, items: List[Dict[str, Any]]) -> None:
        path = self._email_token_store_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_name = None
        payload = {
            "version": 1,
            "updated_at": self._utcnow_iso(),
            "tokens": list(items or []),
        }
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                dir=str(path.parent),
                delete=False,
                encoding="utf-8",
                suffix=".tmp",
            ) as tf:
                json.dump(payload, tf, ensure_ascii=False, indent=2)
                temp_name = tf.name
            os.replace(temp_name, str(path))
        finally:
            if temp_name and os.path.exists(temp_name):
                try:
                    os.remove(temp_name)
                except Exception:
                    pass

    def _read_shadow_rate_limits(self) -> List[Dict[str, Any]]:
        path = self._rate_limit_store_path()
        if not path.exists():
            return []
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return []
        items = payload.get("items", []) if isinstance(payload, dict) else []
        return [dict(item) for item in items if isinstance(item, dict)]

    def _write_shadow_rate_limits(self, items: List[Dict[str, Any]]) -> None:
        path = self._rate_limit_store_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_name = None
        payload = {
            "version": 1,
            "updated_at": self._utcnow_iso(),
            "items": list(items or []),
        }
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                dir=str(path.parent),
                delete=False,
                encoding="utf-8",
                suffix=".tmp",
            ) as tf:
                json.dump(payload, tf, ensure_ascii=False, indent=2)
                temp_name = tf.name
            os.replace(temp_name, str(path))
        finally:
            if temp_name and os.path.exists(temp_name):
                try:
                    os.remove(temp_name)
                except Exception:
                    pass

    def _shadow_create_email_token(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        items = self._read_shadow_email_tokens()
        items.append(dict(payload or {}))
        self._write_shadow_email_tokens(items)
        return dict(payload or {})

    def _shadow_consume_rate_limit(
        self,
        scope: str,
        subject_key: str,
        *,
        window_key: int,
        current_at: str,
        expires_at: str,
    ) -> Dict[str, Any]:
        clean_scope = str(scope or "").strip()
        clean_subject_key = str(subject_key or "").strip()
        clean_current_at = str(current_at or "").strip()
        clean_expires_at = str(expires_at or "").strip()
        items = []
        for item in self._read_shadow_rate_limits():
            item_expires_at = str(item.get("expires_at") or "").strip()
            if item_expires_at and item_expires_at < clean_current_at:
                continue
            items.append(dict(item))

        match = None
        for item in items:
            if str(item.get("scope") or "").strip() != clean_scope:
                continue
            if str(item.get("subject_key") or "").strip() != clean_subject_key:
                continue
            if int(item.get("window_key") or -1) != int(window_key):
                continue
            match = item
            break

        if match is None:
            match = {
                "scope": clean_scope,
                "subject_key": clean_subject_key,
                "window_key": int(window_key),
                "attempt_count": 1,
                "created_at": clean_current_at,
                "updated_at": clean_current_at,
                "expires_at": clean_expires_at,
            }
            items.append(match)
        else:
            match["attempt_count"] = int(match.get("attempt_count") or 0) + 1
            match["updated_at"] = clean_current_at
            match["expires_at"] = clean_expires_at

        self._write_shadow_rate_limits(items)
        return dict(match)

    def _shadow_get_email_token_by_hash(
        self,
        token_hash: str,
        *,
        purpose: str,
        include_used: bool,
    ) -> Optional[Dict[str, Any]]:
        clean_hash = str(token_hash or "").strip()
        clean_purpose = str(purpose or "").strip()
        if not clean_hash or not clean_purpose:
            return None
        matches: List[Dict[str, Any]] = []
        for item in self._read_shadow_email_tokens():
            if str(item.get("token_hash") or "").strip() != clean_hash:
                continue
            if str(item.get("purpose") or "").strip() != clean_purpose:
                continue
            if not include_used and str(item.get("used_at") or "").strip():
                continue
            matches.append(dict(item))
        if not matches:
            return None
        matches.sort(key=lambda item: (str(item.get("created_at") or ""), str(item.get("token_id") or "")), reverse=True)
        return matches[0]

    def _shadow_mark_email_token_used(self, token_id: str, *, used_at: str) -> bool:
        clean_token_id = str(token_id or "").strip()
        if not clean_token_id:
            return False
        items = self._read_shadow_email_tokens()
        updated = False
        for item in items:
            if str(item.get("token_id") or "").strip() != clean_token_id:
                continue
            if str(item.get("used_at") or "").strip():
                return False
            item["used_at"] = used_at
            updated = True
            break
        if updated:
            self._write_shadow_email_tokens(items)
        return updated

    def _shadow_get_user(self, user_id: str) -> Optional[User]:
        user = super().get_user(user_id)
        if user is None:
            return None
        return self._apply_shadow_auth_identity(user)

    def _shadow_get_all_users(self) -> List[User]:
        return [self._apply_shadow_auth_identity(user) for user in super().get_all_users()]

    def _shadow_update_user(self, user: User) -> bool:
        previous_user = self._shadow_get_user(user.user_id)
        if previous_user is None:
            return False

        try:
            ProfileSchema.validate_or_raise(user.to_dict())
        except Exception as exc:
            self.logger.error("[HOSTED][DEV-FALLBACK] Validation failed for user %s: %s", user.user_id, exc)
            return False

        try:
            user.name = self._validate_name(user.name)
        except ValueError:
            return False

        if user.login:
            user.login = self.normalize_login(user.login)
            try:
                self.validate_login(user.login)
            except ValueError:
                return False

        if user.email:
            user.email = self.normalize_email(user.email)
            try:
                self.validate_email(user.email)
            except ValueError:
                return False

        if user.pending_email:
            user.pending_email = self.normalize_email(user.pending_email)
            try:
                self.validate_email(user.pending_email)
            except ValueError:
                return False
        else:
            user.pending_email = None

        for existing in self._shadow_get_all_users():
            if not existing or existing.user_id == user.user_id:
                continue
            if str(existing.name or "").strip().lower() == str(user.name or "").strip().lower():
                self.logger.warning(
                    "[HOSTED][DEV-FALLBACK] Duplicate name refused for user %s: %s",
                    user.user_id,
                    user.name,
                )
                return False
            if user.login and self.normalize_login(existing.login) == user.login:
                self.logger.warning(
                    "[HOSTED][DEV-FALLBACK] Duplicate login refused for user %s: %s",
                    user.user_id,
                    user.login,
                )
                return False
            existing_email = self.normalize_email(existing.email)
            existing_pending_email = self.normalize_email(getattr(existing, "pending_email", ""))
            if user.email and (existing_email == user.email or existing_pending_email == user.email):
                self.logger.warning(
                    "[HOSTED][DEV-FALLBACK] Duplicate email refused for user %s: %s",
                    user.user_id,
                    user.email,
                )
                return False
            if user.pending_email and (existing_email == user.pending_email or existing_pending_email == user.pending_email):
                self.logger.warning(
                    "[HOSTED][DEV-FALLBACK] Duplicate pending email refused for user %s: %s",
                    user.user_id,
                    user.pending_email,
                )
                return False

        previous_email = self.normalize_email(previous_user.email or "")
        current_email = self.normalize_email(user.email or "")
        previous_pending_email = self.normalize_email(previous_user.pending_email or "")
        current_pending_email = self.normalize_email(user.pending_email or "")
        confirmed_pending_swap = bool(previous_pending_email and previous_pending_email == current_email and previous_email != current_email)
        if previous_email != current_email and not confirmed_pending_swap:
            user.email_verified_at = None
            user.email_verification_sent_at = None
        if current_pending_email != previous_pending_email:
            user.pending_email_verification_sent_at = None
        if not current_pending_email:
            user.pending_email_verification_sent_at = None

        return super().update_user(user)

    def _apply_shadow_auth_identity(self, user: User) -> User:
        if not user or not user.user_id:
            return user

        if not str(user.login or "").strip():
            user.login = self.build_synthetic_login(user.user_id)

        if not str(user.email or "").strip():
            user.email = self.build_synthetic_email(user.user_id)

        if not str(user.password_hash or "").strip():
            synthetic_password = self.build_synthetic_password(user.user_id)
            user.password_hash = hashlib.sha256(synthetic_password.encode("utf-8")).hexdigest()

        user.role = self.normalize_role(getattr(user, "role", USER_ROLE_USER))
        user.plan = self.normalize_plan(getattr(user, "plan", USER_PLAN_FREE))
        security_settings = dict(user.security_settings or {})
        security_settings["require_password_on_login"] = True
        user.security_settings = security_settings
        return user

    def _validate_name(self, name: str) -> str:
        clean_name = str(name or "").strip()
        if not clean_name:
            raise ValueError("name_required")
        if len(clean_name) < 2:
            raise ValueError("name_too_short")
        if len(clean_name) > 50:
            raise ValueError("name_too_long")
        forbidden_chars = ["/", "\\", "<", ">", ":", '"', "|", "?", "*"]
        if any(char in clean_name for char in forbidden_chars):
            raise ValueError("invalid_name")
        return clean_name

    def _write_legacy_profile_projection(self, user: User, *, initialize_progress: bool) -> None:
        user_dir = self.users_dir / user.user_id
        user_dir.mkdir(parents=True, exist_ok=True)
        profile_file = user_dir / "profile.json"
        profile_data = user.to_dict()
        ProfileSchema.validate_or_raise(profile_data)

        temp_name = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                dir=str(user_dir),
                delete=False,
                encoding="utf-8",
                suffix=".tmp",
            ) as tf:
                json.dump(profile_data, tf, ensure_ascii=False, indent=2)
                temp_name = tf.name
            os.replace(temp_name, str(profile_file))
        finally:
            if temp_name and os.path.exists(temp_name):
                try:
                    os.remove(temp_name)
                except Exception:
                    pass

        if initialize_progress:
            progress_file = user_dir / "progress.json"
            statistics_file = user_dir / "statistics.json"
            complex_stats_file = user_dir / "complex_statistics.json"
            if not progress_file.exists() and not statistics_file.exists() and not complex_stats_file.exists():
                self._initialize_user_data(user.user_id)

    def _write_legacy_consent_projection(self, user_id: str, payload: Dict[str, Any]) -> None:
        user_dir = self.users_dir / user_id
        user_dir.mkdir(parents=True, exist_ok=True)
        path = user_dir / "consent.json"
        temp_name = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                dir=str(user_dir),
                delete=False,
                encoding="utf-8",
                suffix=".tmp",
            ) as tf:
                json.dump(payload, tf, ensure_ascii=False, indent=2)
                temp_name = tf.name
            os.replace(temp_name, str(path))
        finally:
            if temp_name and os.path.exists(temp_name):
                try:
                    os.remove(temp_name)
                except Exception:
                    pass

    def _read_legacy_consent_projection(self, user_id: str) -> Optional[Dict[str, Any]]:
        path = self.users_dir / user_id / "consent.json"
        if not path.exists():
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else None
        except Exception:
            return None

    def _delete_legacy_projection(self, user_id: str) -> None:
        user_dir = self.users_dir / user_id
        if user_dir.exists():
            shutil.rmtree(user_dir, ignore_errors=True)
        calendar_dir = self.data_dir / "user_calendar" / user_id
        if calendar_dir.exists():
            shutil.rmtree(calendar_dir, ignore_errors=True)
