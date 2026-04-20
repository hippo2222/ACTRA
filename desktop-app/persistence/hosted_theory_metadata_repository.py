from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from persistence.postgres import postgres_connection


class HostedTheoryMetadataRepository:
    """Postgres-backed source of truth for hosted theory metadata."""

    def __init__(self, dsn: str) -> None:
        self._dsn = str(dsn or "").strip()

    def ensure_schema(self) -> None:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_hosted_workspace_theories (
                        theory_id TEXT PRIMARY KEY,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TEXT NOT NULL
                    )
                    """
                )

    def count_theories(self) -> int:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM actra_hosted_workspace_theories")
                row = cur.fetchone()
        return int(row[0] if row else 0)

    def list_theories(self) -> List[Dict[str, Any]]:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_hosted_workspace_theories
                    ORDER BY updated_at DESC, theory_id ASC
                    """
                )
                rows = cur.fetchall() or []
        items: List[Dict[str, Any]] = []
        for row in rows:
            item = self._json_object(row[0])
            if item is not None:
                items.append(item)
        return items

    def get_theory_metadata(self, theory_id: str) -> Optional[Dict[str, Any]]:
        clean_theory_id = str(theory_id or "").strip()
        if not clean_theory_id:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_hosted_workspace_theories
                    WHERE theory_id = %s
                    LIMIT 1
                    """,
                    (clean_theory_id,),
                )
                row = cur.fetchone()
        return self._json_object(row[0]) if row else None

    def upsert_theory_metadata(self, payload: Dict[str, Any]) -> None:
        normalized = payload if isinstance(payload, dict) else {}
        theory_id = str(normalized.get("id") or "").strip()
        if not theory_id:
            raise ValueError("theory_id is required")
        updated_at = str(
            normalized.get("updated_at")
            or normalized.get("created_at")
            or ""
        ).strip() or theory_id
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_workspace_theories (theory_id, payload, updated_at)
                    VALUES (%s, %s::jsonb, %s)
                    ON CONFLICT (theory_id) DO UPDATE
                    SET
                        payload = EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        theory_id,
                        json.dumps(normalized, ensure_ascii=False),
                        updated_at,
                    ),
                )

    def import_theory_if_absent(self, payload: Dict[str, Any]) -> None:
        normalized = payload if isinstance(payload, dict) else {}
        theory_id = str(normalized.get("id") or "").strip()
        if not theory_id:
            return
        updated_at = str(
            normalized.get("updated_at")
            or normalized.get("created_at")
            or ""
        ).strip() or theory_id
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_workspace_theories (theory_id, payload, updated_at)
                    VALUES (%s, %s::jsonb, %s)
                    ON CONFLICT (theory_id) DO NOTHING
                    """,
                    (
                        theory_id,
                        json.dumps(normalized, ensure_ascii=False),
                        updated_at,
                    ),
                )

    def delete_theory_metadata(self, theory_id: str) -> bool:
        clean_theory_id = str(theory_id or "").strip()
        if not clean_theory_id:
            return False
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM actra_hosted_workspace_theories WHERE theory_id = %s",
                    (clean_theory_id,),
                )
                deleted = int(cur.rowcount or 0)
        return deleted > 0

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
