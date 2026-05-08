from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from persistence.postgres import postgres_connection
from services.user_service import User, USER_PLAN_FREE, USER_ROLE_USER


class HostedIdentityRepository:
    """Postgres-backed identity storage for hosted web runtime."""

    def __init__(self, dsn: str) -> None:
        self._dsn = str(dsn or "").strip()

    _USER_SELECT_FIELDS = (
        "user_id, name, created_at, avatar_seed, login, email, pending_email, email_verified_at, "
        "email_verification_sent_at, pending_email_verification_sent_at, password_hash, role, plan, "
        "premium_expires_at, security_settings, settings"
    )

    def ensure_schema(self) -> None:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_hosted_users (
                        user_id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        avatar_seed TEXT NULL,
                        login TEXT NULL,
                        email TEXT NULL,
                        pending_email TEXT NULL,
                        email_verified_at TEXT NULL,
                        email_verification_sent_at TEXT NULL,
                        pending_email_verification_sent_at TEXT NULL,
                        password_hash TEXT NULL,
                        role TEXT NOT NULL DEFAULT 'user',
                        plan TEXT NOT NULL DEFAULT 'free',
                        premium_expires_at TEXT NULL,
                        security_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
                        settings JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE actra_hosted_users
                    ADD COLUMN IF NOT EXISTS login TEXT NULL
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE actra_hosted_users
                    ADD COLUMN IF NOT EXISTS email TEXT NULL
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE actra_hosted_users
                    ADD COLUMN IF NOT EXISTS email_verified_at TEXT NULL
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE actra_hosted_users
                    ADD COLUMN IF NOT EXISTS pending_email TEXT NULL
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE actra_hosted_users
                    ADD COLUMN IF NOT EXISTS email_verification_sent_at TEXT NULL
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE actra_hosted_users
                    ADD COLUMN IF NOT EXISTS pending_email_verification_sent_at TEXT NULL
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE actra_hosted_users
                    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE actra_hosted_users
                    ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE actra_hosted_users
                    ADD COLUMN IF NOT EXISTS premium_expires_at TEXT NULL
                    """
                )
                cur.execute(
                    """
                    DROP INDEX IF EXISTS actra_hosted_users_name_lower_uidx
                    """
                )
                cur.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS actra_hosted_users_login_lower_uidx
                    ON actra_hosted_users ((lower(login)))
                    WHERE login IS NOT NULL
                    """
                )
                cur.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS actra_hosted_users_email_lower_uidx
                    ON actra_hosted_users ((lower(email)))
                    WHERE email IS NOT NULL
                    """
                )
                cur.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS actra_hosted_users_pending_email_lower_uidx
                    ON actra_hosted_users ((lower(pending_email)))
                    WHERE pending_email IS NOT NULL
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_hosted_user_consents (
                        consent_id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL REFERENCES actra_hosted_users(user_id) ON DELETE CASCADE,
                        terms_version TEXT NOT NULL,
                        privacy_version TEXT NOT NULL,
                        accepted_at TEXT NOT NULL,
                        source TEXT NOT NULL,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS actra_hosted_user_consents_user_id_idx
                    ON actra_hosted_user_consents (user_id, accepted_at DESC)
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_hosted_email_tokens (
                        token_id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL REFERENCES actra_hosted_users(user_id) ON DELETE CASCADE,
                        email TEXT NOT NULL,
                        purpose TEXT NOT NULL,
                        token_hash TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        expires_at TEXT NOT NULL,
                        used_at TEXT NULL,
                        meta JSONB NOT NULL DEFAULT '{}'::jsonb
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS actra_hosted_email_tokens_hash_uidx
                    ON actra_hosted_email_tokens (token_hash)
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS actra_hosted_email_tokens_user_idx
                    ON actra_hosted_email_tokens (user_id, purpose, created_at DESC)
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_hosted_rate_limits (
                        scope TEXT NOT NULL,
                        subject_key TEXT NOT NULL,
                        window_key BIGINT NOT NULL,
                        attempt_count INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        expires_at TEXT NOT NULL,
                        PRIMARY KEY (scope, subject_key, window_key)
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS actra_hosted_rate_limits_expires_idx
                    ON actra_hosted_rate_limits (expires_at)
                    """
                )

    def count_users(self) -> int:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM actra_hosted_users")
                row = cur.fetchone()
        return int(row[0] if row else 0)

    def user_exists(self, user_id: str) -> bool:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM actra_hosted_users WHERE user_id = %s LIMIT 1",
                    (str(user_id or "").strip(),),
                )
                row = cur.fetchone()
        return bool(row)

    def name_exists(self, name: str, *, exclude_user_id: Optional[str] = None) -> bool:
        lowered = str(name or "").strip().lower()
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                if exclude_user_id:
                    cur.execute(
                        """
                        SELECT 1
                        FROM actra_hosted_users
                        WHERE lower(name) = %s AND user_id <> %s
                        LIMIT 1
                        """,
                        (lowered, str(exclude_user_id).strip()),
                    )
                else:
                    cur.execute(
                        """
                        SELECT 1
                        FROM actra_hosted_users
                        WHERE lower(name) = %s
                        LIMIT 1
                        """,
                        (lowered,),
                    )
                row = cur.fetchone()
        return bool(row)

    def login_exists(self, login: str, *, exclude_user_id: Optional[str] = None) -> bool:
        lowered = str(login or "").strip().lower()
        if not lowered:
            return False
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                if exclude_user_id:
                    cur.execute(
                        """
                        SELECT 1
                        FROM actra_hosted_users
                        WHERE lower(login) = %s AND user_id <> %s
                        LIMIT 1
                        """,
                        (lowered, str(exclude_user_id).strip()),
                    )
                else:
                    cur.execute(
                        """
                        SELECT 1
                        FROM actra_hosted_users
                        WHERE lower(login) = %s
                        LIMIT 1
                        """,
                        (lowered,),
                    )
                row = cur.fetchone()
        return bool(row)

    def email_exists(self, email: str, *, exclude_user_id: Optional[str] = None) -> bool:
        lowered = str(email or "").strip().lower()
        if not lowered:
            return False
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                if exclude_user_id:
                    cur.execute(
                        """
                        SELECT 1
                        FROM actra_hosted_users
                        WHERE lower(email) = %s AND user_id <> %s
                        LIMIT 1
                        """,
                        (lowered, str(exclude_user_id).strip()),
                    )
                else:
                    cur.execute(
                        """
                        SELECT 1
                        FROM actra_hosted_users
                        WHERE lower(email) = %s
                        LIMIT 1
                        """,
                        (lowered,),
                    )
                row = cur.fetchone()
        return bool(row)

    def pending_email_exists(self, email: str, *, exclude_user_id: Optional[str] = None) -> bool:
        lowered = str(email or "").strip().lower()
        if not lowered:
            return False
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                if exclude_user_id:
                    cur.execute(
                        """
                        SELECT 1
                        FROM actra_hosted_users
                        WHERE lower(pending_email) = %s AND user_id <> %s
                        LIMIT 1
                        """,
                        (lowered, str(exclude_user_id).strip()),
                    )
                else:
                    cur.execute(
                        """
                        SELECT 1
                        FROM actra_hosted_users
                        WHERE lower(pending_email) = %s
                        LIMIT 1
                        """,
                        (lowered,),
                    )
                row = cur.fetchone()
        return bool(row)

    def get_user_by_login(self, login: str) -> Optional[User]:
        clean_login = str(login or "").strip().lower()
        if not clean_login:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT {self._USER_SELECT_FIELDS}
                    FROM actra_hosted_users
                    WHERE lower(login) = %s
                    LIMIT 1
                    """,
                    (clean_login,),
                )
                row = cur.fetchone()
        return self._row_to_user(row)

    def get_user_by_email(self, email: str) -> Optional[User]:
        clean_email = str(email or "").strip().lower()
        if not clean_email:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT {self._USER_SELECT_FIELDS}
                    FROM actra_hosted_users
                    WHERE lower(email) = %s
                    LIMIT 1
                    """,
                    (clean_email,),
                )
                row = cur.fetchone()
        return self._row_to_user(row)

    def get_user(self, user_id: str) -> Optional[User]:
        clean_user_id = str(user_id or "").strip()
        if not clean_user_id:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT {self._USER_SELECT_FIELDS}
                    FROM actra_hosted_users
                    WHERE user_id = %s
                    LIMIT 1
                    """,
                    (clean_user_id,),
                )
                row = cur.fetchone()
        return self._row_to_user(row)

    def list_users(self) -> List[User]:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT {self._USER_SELECT_FIELDS}
                    FROM actra_hosted_users
                    ORDER BY created_at ASC, user_id ASC
                    """
                )
                rows = cur.fetchall() or []
        out: List[User] = []
        for row in rows:
            user = self._row_to_user(row)
            if user is not None:
                out.append(user)
        return out

    def search_users(self, query: str = "") -> List[User]:
        clean_query = str(query or "").strip().lower()
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                if clean_query:
                    pattern = f"%{clean_query}%"
                    cur.execute(
                        f"""
                        SELECT {self._USER_SELECT_FIELDS}
                        FROM actra_hosted_users
                        WHERE lower(name) LIKE %s
                           OR lower(coalesce(login, '')) LIKE %s
                           OR lower(coalesce(email, '')) LIKE %s
                        ORDER BY created_at ASC, user_id ASC
                        """,
                        (pattern, pattern, pattern),
                    )
                else:
                    cur.execute(
                        f"""
                        SELECT {self._USER_SELECT_FIELDS}
                        FROM actra_hosted_users
                        ORDER BY created_at ASC, user_id ASC
                        """
                    )
                rows = cur.fetchall() or []
        out: List[User] = []
        for row in rows:
            user = self._row_to_user(row)
            if user is not None:
                out.append(user)
        return out

    def create_user(self, user: User, *, updated_at: str) -> None:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_users (
                        user_id, name, created_at, avatar_seed, login, email, pending_email,
                        email_verified_at, email_verification_sent_at, pending_email_verification_sent_at,
                        password_hash, role, plan, premium_expires_at, security_settings, settings, updated_at
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s
                    )
                    """,
                    (
                        user.user_id,
                        user.name,
                        user.created_at,
                        user.avatar_seed,
                        user.login,
                        user.email,
                        user.pending_email,
                        user.email_verified_at,
                        user.email_verification_sent_at,
                        user.pending_email_verification_sent_at,
                        user.password_hash,
                        user.role or USER_ROLE_USER,
                        user.plan or USER_PLAN_FREE,
                        user.premium_expires_at,
                        json.dumps(user.security_settings or {}, ensure_ascii=False),
                        json.dumps(user.settings or {}, ensure_ascii=False),
                        updated_at,
                    ),
                )

    def import_user_if_absent(self, user: User, *, updated_at: str) -> None:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_users (
                        user_id, name, created_at, avatar_seed, login, email, pending_email,
                        email_verified_at, email_verification_sent_at, pending_email_verification_sent_at,
                        password_hash, role, plan, premium_expires_at, security_settings, settings, updated_at
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s
                    )
                    ON CONFLICT (user_id) DO NOTHING
                    """,
                    (
                        user.user_id,
                        user.name,
                        user.created_at,
                        user.avatar_seed,
                        user.login,
                        user.email,
                        user.pending_email,
                        user.email_verified_at,
                        user.email_verification_sent_at,
                        user.pending_email_verification_sent_at,
                        user.password_hash,
                        user.role or USER_ROLE_USER,
                        user.plan or USER_PLAN_FREE,
                        user.premium_expires_at,
                        json.dumps(user.security_settings or {}, ensure_ascii=False),
                        json.dumps(user.settings or {}, ensure_ascii=False),
                        updated_at,
                    ),
                )

    def update_user(self, user: User, *, updated_at: str) -> bool:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE actra_hosted_users
                    SET
                        name = %s,
                        avatar_seed = %s,
                        login = %s,
                        email = %s,
                        pending_email = %s,
                        email_verified_at = %s,
                        email_verification_sent_at = %s,
                        pending_email_verification_sent_at = %s,
                        password_hash = %s,
                        role = %s,
                        plan = %s,
                        premium_expires_at = %s,
                        security_settings = %s::jsonb,
                        settings = %s::jsonb,
                        updated_at = %s
                    WHERE user_id = %s
                    """,
                    (
                        user.name,
                        user.avatar_seed,
                        user.login,
                        user.email,
                        user.pending_email,
                        user.email_verified_at,
                        user.email_verification_sent_at,
                        user.pending_email_verification_sent_at,
                        user.password_hash,
                        user.role or USER_ROLE_USER,
                        user.plan or USER_PLAN_FREE,
                        user.premium_expires_at,
                        json.dumps(user.security_settings or {}, ensure_ascii=False),
                        json.dumps(user.settings or {}, ensure_ascii=False),
                        updated_at,
                        user.user_id,
                    ),
                )
                updated = int(cur.rowcount or 0)
        return updated > 0

    def delete_user(self, user_id: str) -> bool:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM actra_hosted_users WHERE user_id = %s",
                    (str(user_id or "").strip(),),
                )
                deleted = int(cur.rowcount or 0)
        return deleted > 0

    def create_email_token(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        normalized_payload = dict(payload or {})
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_email_tokens (
                        token_id, user_id, email, purpose, token_hash, created_at, expires_at, used_at, meta
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb
                    )
                    """,
                    (
                        normalized_payload.get("token_id"),
                        normalized_payload.get("user_id"),
                        normalized_payload.get("email"),
                        normalized_payload.get("purpose"),
                        normalized_payload.get("token_hash"),
                        normalized_payload.get("created_at"),
                        normalized_payload.get("expires_at"),
                        normalized_payload.get("used_at"),
                        json.dumps(normalized_payload.get("meta") or {}, ensure_ascii=False),
                    ),
                )
        return normalized_payload

    def get_email_token_by_hash(
        self,
        token_hash: str,
        *,
        purpose: Optional[str] = None,
        include_used: bool = True,
    ) -> Optional[Dict[str, Any]]:
        clean_hash = str(token_hash or "").strip()
        if not clean_hash:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                query = """
                    SELECT token_id, user_id, email, purpose, token_hash, created_at, expires_at, used_at, meta
                    FROM actra_hosted_email_tokens
                    WHERE token_hash = %s
                """
                params: List[Any] = [clean_hash]
                if purpose:
                    query += " AND purpose = %s"
                    params.append(str(purpose).strip())
                if not include_used:
                    query += " AND used_at IS NULL"
                query += " ORDER BY created_at DESC, token_id DESC LIMIT 1"
                cur.execute(query, tuple(params))
                row = cur.fetchone()
        return self._token_row_to_payload(row)

    def mark_email_token_used(self, token_id: str, *, used_at: str) -> bool:
        clean_token_id = str(token_id or "").strip()
        if not clean_token_id:
            return False
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE actra_hosted_email_tokens
                    SET used_at = %s
                    WHERE token_id = %s AND used_at IS NULL
                    """,
                    (used_at, clean_token_id),
                )
                updated = int(cur.rowcount or 0)
        return updated > 0

    def consume_rate_limit(
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
        if not clean_scope or not clean_subject_key:
            raise ValueError("rate_limit_scope_required")

        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM actra_hosted_rate_limits
                    WHERE expires_at < %s
                    """,
                    (str(current_at or "").strip(),),
                )
                cur.execute(
                    """
                    INSERT INTO actra_hosted_rate_limits (
                        scope, subject_key, window_key, attempt_count, created_at, updated_at, expires_at
                    ) VALUES (
                        %s, %s, %s, 1, %s, %s, %s
                    )
                    ON CONFLICT (scope, subject_key, window_key)
                    DO UPDATE SET
                        attempt_count = actra_hosted_rate_limits.attempt_count + 1,
                        updated_at = EXCLUDED.updated_at,
                        expires_at = EXCLUDED.expires_at
                    RETURNING attempt_count, expires_at
                    """,
                    (
                        clean_scope,
                        clean_subject_key,
                        int(window_key),
                        str(current_at or "").strip(),
                        str(current_at or "").strip(),
                        str(expires_at or "").strip(),
                    ),
                )
                row = cur.fetchone()
        return {
            "scope": clean_scope,
            "subject_key": clean_subject_key,
            "window_key": int(window_key),
            "attempt_count": int(row[0] if row else 0),
            "expires_at": (str(row[1]).strip() if row and row[1] is not None else "") or str(expires_at or "").strip(),
        }

    def write_consent(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        normalized_payload = dict(payload or {})
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_user_consents (
                        consent_id, user_id, terms_version, privacy_version, accepted_at, source, payload
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s::jsonb
                    )
                    """,
                    (
                        normalized_payload.get("consent_id"),
                        normalized_payload.get("user_id"),
                        normalized_payload.get("terms_version"),
                        normalized_payload.get("privacy_version"),
                        normalized_payload.get("accepted_at"),
                        normalized_payload.get("source"),
                        json.dumps(normalized_payload, ensure_ascii=False),
                    ),
                )
        return normalized_payload

    def import_consent_if_absent(self, payload: Dict[str, Any]) -> None:
        normalized_payload = dict(payload or {})
        consent_id = str(normalized_payload.get("consent_id") or "").strip()
        if not consent_id:
            return
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_user_consents (
                        consent_id, user_id, terms_version, privacy_version, accepted_at, source, payload
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s::jsonb
                    )
                    ON CONFLICT (consent_id) DO NOTHING
                    """,
                    (
                        consent_id,
                        normalized_payload.get("user_id"),
                        normalized_payload.get("terms_version"),
                        normalized_payload.get("privacy_version"),
                        normalized_payload.get("accepted_at"),
                        normalized_payload.get("source"),
                        json.dumps(normalized_payload, ensure_ascii=False),
                    ),
                )

    def get_latest_consent(self, user_id: str) -> Optional[Dict[str, Any]]:
        clean_user_id = str(user_id or "").strip()
        if not clean_user_id:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_hosted_user_consents
                    WHERE user_id = %s
                    ORDER BY accepted_at DESC, consent_id DESC
                    LIMIT 1
                    """,
                    (clean_user_id,),
                )
                row = cur.fetchone()
        if not row:
            return None
        payload = row[0]
        if isinstance(payload, dict):
            return payload
        if isinstance(payload, str):
            try:
                decoded = json.loads(payload)
                return decoded if isinstance(decoded, dict) else None
            except Exception:
                return None
        return None

    @staticmethod
    def _json_obj(value: Any) -> Dict[str, Any]:
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            try:
                decoded = json.loads(value)
                return decoded if isinstance(decoded, dict) else {}
            except Exception:
                return {}
        return {}

    @classmethod
    def _token_row_to_payload(cls, row: Any) -> Optional[Dict[str, Any]]:
        if not row:
            return None
        return {
            "token_id": str(row[0] or ""),
            "user_id": str(row[1] or ""),
            "email": (str(row[2]).strip() if row[2] is not None else "") or "",
            "purpose": (str(row[3]).strip() if row[3] is not None else "") or "",
            "token_hash": (str(row[4]).strip() if row[4] is not None else "") or "",
            "created_at": (str(row[5]).strip() if row[5] is not None else "") or "",
            "expires_at": (str(row[6]).strip() if row[6] is not None else "") or "",
            "used_at": (str(row[7]).strip() if row[7] is not None else None) or None,
            "meta": cls._json_obj(row[8]),
        }

    @classmethod
    def _row_to_user(cls, row: Any) -> Optional[User]:
        if not row:
            return None

        return User(
            user_id=str(row[0] or ""),
            name=str(row[1] or ""),
            created_at=str(row[2] or ""),
            avatar_seed=(str(row[3]).strip() if row[3] is not None else None) or None,
            login=(str(row[4]).strip() if row[4] is not None else None) or None,
            email=(str(row[5]).strip() if row[5] is not None else None) or None,
            pending_email=(str(row[6]).strip() if row[6] is not None else None) or None,
            email_verified_at=(str(row[7]).strip() if row[7] is not None else None) or None,
            email_verification_sent_at=(str(row[8]).strip() if row[8] is not None else None) or None,
            pending_email_verification_sent_at=(str(row[9]).strip() if row[9] is not None else None) or None,
            password_hash=(str(row[10]).strip() if row[10] is not None else None) or None,
            role=(str(row[11]).strip() if row[11] is not None else USER_ROLE_USER) or USER_ROLE_USER,
            plan=(str(row[12]).strip() if row[12] is not None else USER_PLAN_FREE) or USER_PLAN_FREE,
            premium_expires_at=(str(row[13]).strip() if row[13] is not None else None) or None,
            security_settings=cls._json_obj(row[14]),
            settings=cls._json_obj(row[15]),
        )
