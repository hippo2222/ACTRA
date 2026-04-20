from __future__ import annotations

import json
from typing import Any, Optional

from persistence.postgres import postgres_connection


class HostedCalendarRepository:
    """Postgres-backed source of truth for hosted calendar document storage."""

    def __init__(self, dsn: str) -> None:
        self._dsn = str(dsn or "").strip()

    def ensure_schema(self) -> None:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_hosted_calendar_documents (
                        user_id TEXT NOT NULL,
                        doc_kind TEXT NOT NULL,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TEXT NOT NULL,
                        PRIMARY KEY (user_id, doc_kind)
                    )
                    """
                )

    def get_document(self, user_id: str, doc_kind: str) -> Optional[Any]:
        clean_user_id = str(user_id or "").strip()
        clean_doc_kind = str(doc_kind or "").strip()
        if not clean_user_id or not clean_doc_kind:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_hosted_calendar_documents
                    WHERE user_id = %s AND doc_kind = %s
                    LIMIT 1
                    """,
                    (clean_user_id, clean_doc_kind),
                )
                row = cur.fetchone()
        return self._json_value(row[0]) if row else None

    def write_document(self, user_id: str, doc_kind: str, payload: Any, *, updated_at: str) -> None:
        clean_user_id = str(user_id or "").strip()
        clean_doc_kind = str(doc_kind or "").strip()
        if not clean_user_id:
            raise ValueError("user_id is required")
        if not clean_doc_kind:
            raise ValueError("doc_kind is required")
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_calendar_documents (user_id, doc_kind, payload, updated_at)
                    VALUES (%s, %s, %s::jsonb, %s)
                    ON CONFLICT (user_id, doc_kind) DO UPDATE
                    SET
                        payload = EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        clean_user_id,
                        clean_doc_kind,
                        json.dumps(payload, ensure_ascii=False),
                        updated_at,
                    ),
                )

    @staticmethod
    def _json_value(value: Any) -> Optional[Any]:
        if isinstance(value, (dict, list)):
            return value
        if isinstance(value, str):
            try:
                return json.loads(value)
            except Exception:
                return None
        return None
