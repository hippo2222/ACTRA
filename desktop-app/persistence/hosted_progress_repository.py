from __future__ import annotations

import json
from typing import Any, Dict, Optional

from persistence.postgres import postgres_connection


class HostedProgressRepository:
    """Postgres-backed source of truth for hosted user progress documents."""

    def __init__(self, dsn: str) -> None:
        self._dsn = str(dsn or "").strip()

    def ensure_schema(self) -> None:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_hosted_progress_documents (
                        user_id TEXT PRIMARY KEY,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TEXT NOT NULL
                    )
                    """
                )

    def get_progress(self, user_id: str) -> Optional[Dict[str, Any]]:
        clean_user_id = str(user_id or "").strip()
        if not clean_user_id:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_hosted_progress_documents
                    WHERE user_id = %s
                    LIMIT 1
                    """,
                    (clean_user_id,),
                )
                row = cur.fetchone()
        return self._json_object(row[0]) if row else None

    def write_progress(self, user_id: str, payload: Dict[str, Any], *, updated_at: str) -> None:
        clean_user_id = str(user_id or "").strip()
        if not clean_user_id:
            raise ValueError("user_id is required")
        normalized_payload = payload if isinstance(payload, dict) else {}
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_progress_documents (user_id, payload, updated_at)
                    VALUES (%s, %s::jsonb, %s)
                    ON CONFLICT (user_id) DO UPDATE
                    SET
                        payload = EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        clean_user_id,
                        json.dumps(normalized_payload, ensure_ascii=False),
                        updated_at,
                    ),
                )

    @staticmethod
    def _json_object(value: Any) -> Optional[Dict[str, Any]]:
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            try:
                decoded = json.loads(value)
                return decoded if isinstance(decoded, dict) else None
            except Exception:
                return None
        return None
