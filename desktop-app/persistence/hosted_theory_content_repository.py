from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from persistence.postgres import postgres_connection


class HostedTheoryContentRepository:
    """Postgres-backed source of truth for hosted theory content/history."""

    def __init__(self, dsn: str) -> None:
        self._dsn = str(dsn or "").strip()

    def ensure_schema(self) -> None:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_hosted_workspace_theory_content (
                        theory_id TEXT PRIMARY KEY,
                        delta_payload JSONB NOT NULL DEFAULT '{"ops":[{"insert":"\\n"}]}'::jsonb,
                        images_payload JSONB NOT NULL DEFAULT '[]'::jsonb,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_hosted_workspace_theory_history (
                        theory_id TEXT NOT NULL,
                        snapshot_timestamp TEXT NOT NULL,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        PRIMARY KEY (theory_id, snapshot_timestamp)
                    )
                    """
                )

    def get_theory_content(self, theory_id: str) -> Optional[Dict[str, Any]]:
        clean_theory_id = str(theory_id or "").strip()
        if not clean_theory_id:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT theory_id, delta_payload, images_payload, updated_at
                    FROM actra_hosted_workspace_theory_content
                    WHERE theory_id = %s
                    LIMIT 1
                    """,
                    (clean_theory_id,),
                )
                row = cur.fetchone()
        if not row:
            return None
        return {
            "theory_id": str(row[0] or clean_theory_id),
            "delta": self._json_value(row[1], {"ops": [{"insert": "\n"}]}),
            "images": self._json_list(row[2]),
            "updated_at": str(row[3] or ""),
        }

    def upsert_theory_content(
        self,
        theory_id: str,
        *,
        delta: Dict[str, Any],
        images: List[Any],
        updated_at: str,
    ) -> None:
        clean_theory_id = str(theory_id or "").strip()
        if not clean_theory_id:
            raise ValueError("theory_id is required")
        clean_updated_at = str(updated_at or "").strip() or clean_theory_id
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_workspace_theory_content (
                        theory_id,
                        delta_payload,
                        images_payload,
                        updated_at
                    )
                    VALUES (%s, %s::jsonb, %s::jsonb, %s)
                    ON CONFLICT (theory_id) DO UPDATE
                    SET
                        delta_payload = EXCLUDED.delta_payload,
                        images_payload = EXCLUDED.images_payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        clean_theory_id,
                        json.dumps(delta or {"ops": [{"insert": "\n"}]}, ensure_ascii=False),
                        json.dumps(images or [], ensure_ascii=False),
                        clean_updated_at,
                    ),
                )

    def import_theory_content_if_absent(
        self,
        theory_id: str,
        *,
        delta: Dict[str, Any],
        images: List[Any],
        updated_at: str,
    ) -> None:
        clean_theory_id = str(theory_id or "").strip()
        if not clean_theory_id:
            return
        clean_updated_at = str(updated_at or "").strip() or clean_theory_id
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_workspace_theory_content (
                        theory_id,
                        delta_payload,
                        images_payload,
                        updated_at
                    )
                    VALUES (%s, %s::jsonb, %s::jsonb, %s)
                    ON CONFLICT (theory_id) DO NOTHING
                    """,
                    (
                        clean_theory_id,
                        json.dumps(delta or {"ops": [{"insert": "\n"}]}, ensure_ascii=False),
                        json.dumps(images or [], ensure_ascii=False),
                        clean_updated_at,
                    ),
                )

    def delete_theory_content(self, theory_id: str) -> bool:
        clean_theory_id = str(theory_id or "").strip()
        if not clean_theory_id:
            return False
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM actra_hosted_workspace_theory_content WHERE theory_id = %s",
                    (clean_theory_id,),
                )
                deleted = int(cur.rowcount or 0)
        return deleted > 0

    def import_history_snapshot_if_absent(
        self,
        theory_id: str,
        snapshot_timestamp: str,
        payload: Dict[str, Any],
    ) -> None:
        clean_theory_id = str(theory_id or "").strip()
        clean_timestamp = str(snapshot_timestamp or "").strip()
        if not clean_theory_id or not clean_timestamp:
            return
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_workspace_theory_history (
                        theory_id,
                        snapshot_timestamp,
                        payload
                    )
                    VALUES (%s, %s, %s::jsonb)
                    ON CONFLICT (theory_id, snapshot_timestamp) DO NOTHING
                    """,
                    (
                        clean_theory_id,
                        clean_timestamp,
                        json.dumps(payload or {}, ensure_ascii=False),
                    ),
                )

    def upsert_history_snapshot(
        self,
        theory_id: str,
        snapshot_timestamp: str,
        payload: Dict[str, Any],
    ) -> None:
        clean_theory_id = str(theory_id or "").strip()
        clean_timestamp = str(snapshot_timestamp or "").strip()
        if not clean_theory_id or not clean_timestamp:
            raise ValueError("theory_id and snapshot_timestamp are required")
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_workspace_theory_history (
                        theory_id,
                        snapshot_timestamp,
                        payload
                    )
                    VALUES (%s, %s, %s::jsonb)
                    ON CONFLICT (theory_id, snapshot_timestamp) DO UPDATE
                    SET payload = EXCLUDED.payload
                    """,
                    (
                        clean_theory_id,
                        clean_timestamp,
                        json.dumps(payload or {}, ensure_ascii=False),
                    ),
                )

    def list_history(self, theory_id: str) -> List[Dict[str, Any]]:
        clean_theory_id = str(theory_id or "").strip()
        if not clean_theory_id:
            return []
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT snapshot_timestamp, payload
                    FROM actra_hosted_workspace_theory_history
                    WHERE theory_id = %s
                    ORDER BY snapshot_timestamp DESC
                    """,
                    (clean_theory_id,),
                )
                rows = cur.fetchall() or []
        items: List[Dict[str, Any]] = []
        for row in rows:
            payload = self._json_object(row[1]) or {}
            payload["_snapshot_timestamp"] = str(row[0] or "")
            items.append(payload)
        return items

    def get_history_snapshot(
        self,
        theory_id: str,
        snapshot_timestamp: str,
    ) -> Optional[Dict[str, Any]]:
        clean_theory_id = str(theory_id or "").strip()
        clean_timestamp = str(snapshot_timestamp or "").strip()
        if not clean_theory_id or not clean_timestamp:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_hosted_workspace_theory_history
                    WHERE theory_id = %s AND snapshot_timestamp = %s
                    LIMIT 1
                    """,
                    (clean_theory_id, clean_timestamp),
                )
                row = cur.fetchone()
        return self._json_object(row[0]) if row else None

    def delete_history(self, theory_id: str) -> int:
        clean_theory_id = str(theory_id or "").strip()
        if not clean_theory_id:
            return 0
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM actra_hosted_workspace_theory_history WHERE theory_id = %s",
                    (clean_theory_id,),
                )
                deleted = int(cur.rowcount or 0)
        return deleted

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

    @classmethod
    def _json_list(cls, value: Any) -> List[Any]:
        if isinstance(value, list):
            return value
        if isinstance(value, str):
            try:
                decoded = json.loads(value)
                return decoded if isinstance(decoded, list) else []
            except Exception:
                return []
        return []

    @classmethod
    def _json_value(cls, value: Any, default: Any) -> Any:
        if isinstance(value, (dict, list)):
            return value
        if isinstance(value, str):
            try:
                return json.loads(value)
            except Exception:
                return default
        return default
