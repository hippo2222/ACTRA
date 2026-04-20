from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from persistence.postgres import postgres_connection


class HostedSessionRepository:
    """Postgres-backed source of truth for hosted complex sessions."""

    def __init__(self, dsn: str) -> None:
        self._dsn = str(dsn or "").strip()

    def ensure_schema(self) -> None:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_hosted_complex_sessions (
                        session_id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        complex_id TEXT NOT NULL,
                        is_active BOOLEAN NOT NULL DEFAULT TRUE,
                        paused BOOLEAN NOT NULL DEFAULT FALSE,
                        updated_at TEXT NOT NULL,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_actra_hosted_complex_sessions_user
                    ON actra_hosted_complex_sessions (user_id)
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_actra_hosted_complex_sessions_user_complex
                    ON actra_hosted_complex_sessions (user_id, complex_id)
                    """
                )

    def upsert_session(
        self,
        *,
        session_id: str,
        user_id: str,
        complex_id: str,
        is_active: bool,
        paused: bool,
        updated_at: str,
        payload: Dict[str, Any],
    ) -> None:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_complex_sessions (
                        session_id,
                        user_id,
                        complex_id,
                        is_active,
                        paused,
                        updated_at,
                        payload
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (session_id) DO UPDATE
                    SET
                        user_id = EXCLUDED.user_id,
                        complex_id = EXCLUDED.complex_id,
                        is_active = EXCLUDED.is_active,
                        paused = EXCLUDED.paused,
                        updated_at = EXCLUDED.updated_at,
                        payload = EXCLUDED.payload
                    """,
                    (
                        session_id,
                        user_id,
                        complex_id,
                        bool(is_active),
                        bool(paused),
                        updated_at,
                        json.dumps(payload, ensure_ascii=False),
                    ),
                )

    def get_session_by_session_id(self, *, user_id: str, session_id: str) -> Optional[Dict[str, Any]]:
        clean_user_id = str(user_id or "").strip()
        clean_session_id = str(session_id or "").strip()
        if not clean_user_id or not clean_session_id:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT session_id, user_id, complex_id, is_active, paused, updated_at, payload
                    FROM actra_hosted_complex_sessions
                    WHERE user_id = %s AND session_id = %s
                    LIMIT 1
                    """,
                    (clean_user_id, clean_session_id),
                )
                row = cur.fetchone()
        return self._decode_row(row) if row else None

    def list_sessions_for_user(self, *, user_id: str) -> List[Dict[str, Any]]:
        clean_user_id = str(user_id or "").strip()
        if not clean_user_id:
            return []
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT session_id, user_id, complex_id, is_active, paused, updated_at, payload
                    FROM actra_hosted_complex_sessions
                    WHERE user_id = %s
                    ORDER BY updated_at DESC, session_id DESC
                    """,
                    (clean_user_id,),
                )
                rows = cur.fetchall() or []
        return [item for item in (self._decode_row(row) for row in rows) if item is not None]

    def list_sessions_for_complex(self, *, user_id: str, complex_id: str) -> List[Dict[str, Any]]:
        clean_user_id = str(user_id or "").strip()
        clean_complex_id = str(complex_id or "").strip()
        if not clean_user_id or not clean_complex_id:
            return []
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT session_id, user_id, complex_id, is_active, paused, updated_at, payload
                    FROM actra_hosted_complex_sessions
                    WHERE user_id = %s AND complex_id = %s
                    ORDER BY updated_at DESC, session_id DESC
                    """,
                    (clean_user_id, clean_complex_id),
                )
                rows = cur.fetchall() or []
        return [item for item in (self._decode_row(row) for row in rows) if item is not None]

    def delete_session_by_session_id(self, *, user_id: str, session_id: str) -> None:
        clean_user_id = str(user_id or "").strip()
        clean_session_id = str(session_id or "").strip()
        if not clean_user_id or not clean_session_id:
            return
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM actra_hosted_complex_sessions
                    WHERE user_id = %s AND session_id = %s
                    """,
                    (clean_user_id, clean_session_id),
                )

    def delete_sessions_for_complex(self, *, user_id: str, complex_id: str) -> None:
        clean_user_id = str(user_id or "").strip()
        clean_complex_id = str(complex_id or "").strip()
        if not clean_user_id or not clean_complex_id:
            return
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM actra_hosted_complex_sessions
                    WHERE user_id = %s AND complex_id = %s
                    """,
                    (clean_user_id, clean_complex_id),
                )

    @staticmethod
    def _decode_row(row: Any) -> Optional[Dict[str, Any]]:
        if not row:
            return None
        payload = HostedSessionRepository._json_object(row[6])
        if payload is None:
            return None
        return {
            "session_id": row[0],
            "user_id": row[1],
            "complex_id": row[2],
            "is_active": bool(row[3]),
            "paused": bool(row[4]),
            "updated_at": row[5],
            "payload": payload,
        }

    @staticmethod
    def _json_object(value: Any) -> Optional[Dict[str, Any]]:
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            try:
                decoded = json.loads(value)
            except Exception:
                return None
            return decoded if isinstance(decoded, dict) else None
        return None
