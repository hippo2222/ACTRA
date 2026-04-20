from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from persistence.postgres import postgres_connection


class HostedComplexRepository:
    """Postgres-backed source of truth for hosted complex metadata."""

    def __init__(self, dsn: str) -> None:
        self._dsn = str(dsn or "").strip()

    def ensure_schema(self) -> None:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_hosted_workspace_complexes (
                        complex_id TEXT PRIMARY KEY,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_hosted_workspace_complex_history (
                        complex_id TEXT NOT NULL,
                        snapshot_timestamp TEXT NOT NULL,
                        history_kind TEXT NOT NULL DEFAULT 'manual',
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TEXT NOT NULL,
                        PRIMARY KEY (complex_id, snapshot_timestamp)
                    )
                    """
                )

    def count_complexes(self) -> int:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM actra_hosted_workspace_complexes")
                row = cur.fetchone()
        return int(row[0] if row else 0)

    def list_complexes(self) -> List[Dict[str, Any]]:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_hosted_workspace_complexes
                    ORDER BY updated_at DESC, complex_id ASC
                    """
                )
                rows = cur.fetchall() or []
        items: List[Dict[str, Any]] = []
        for row in rows:
            item = self._json_object(row[0])
            if item is not None:
                items.append(item)
        return items

    def get_complex(self, complex_id: str) -> Optional[Dict[str, Any]]:
        clean_complex_id = str(complex_id or "").strip()
        if not clean_complex_id:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_hosted_workspace_complexes
                    WHERE complex_id = %s
                    LIMIT 1
                    """,
                    (clean_complex_id,),
                )
                row = cur.fetchone()
        return self._json_object(row[0]) if row else None

    def replace_all_complexes(self, payloads: List[Dict[str, Any]]) -> None:
        normalized_payloads: List[Dict[str, Any]] = []
        for payload in payloads or []:
            normalized = payload if isinstance(payload, dict) else {}
            complex_id = str(normalized.get("id") or "").strip()
            if not complex_id:
                continue
            normalized_payloads.append(normalized)

        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM actra_hosted_workspace_complexes")
                for payload in normalized_payloads:
                    complex_id = str(payload.get("id") or "").strip()
                    updated_at = str(
                        payload.get("updated_at")
                        or payload.get("created_at")
                        or ""
                    ).strip() or complex_id
                    cur.execute(
                        """
                        INSERT INTO actra_hosted_workspace_complexes (complex_id, payload, updated_at)
                        VALUES (%s, %s::jsonb, %s)
                        """,
                        (
                            complex_id,
                            json.dumps(payload, ensure_ascii=False),
                            updated_at,
                        ),
                    )

    def import_complex_if_absent(self, payload: Dict[str, Any]) -> None:
        normalized = payload if isinstance(payload, dict) else {}
        complex_id = str(normalized.get("id") or "").strip()
        if not complex_id:
            return
        updated_at = str(
            normalized.get("updated_at")
            or normalized.get("created_at")
            or ""
        ).strip() or complex_id
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_workspace_complexes (complex_id, payload, updated_at)
                    VALUES (%s, %s::jsonb, %s)
                    ON CONFLICT (complex_id) DO NOTHING
                    """,
                    (
                        complex_id,
                        json.dumps(normalized, ensure_ascii=False),
                        updated_at,
                    ),
                )

    def upsert_history_snapshot(
        self,
        complex_id: str,
        snapshot_timestamp: str,
        payload: Dict[str, Any],
        *,
        updated_at: str,
        history_kind: str,
    ) -> None:
        clean_complex_id = str(complex_id or "").strip()
        clean_snapshot_timestamp = str(snapshot_timestamp or "").strip()
        if not clean_complex_id or not clean_snapshot_timestamp:
            return
        normalized_payload = payload if isinstance(payload, dict) else {}
        clean_updated_at = str(updated_at or "").strip() or clean_snapshot_timestamp
        clean_history_kind = str(history_kind or "").strip() or "manual"
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_workspace_complex_history (
                        complex_id,
                        snapshot_timestamp,
                        history_kind,
                        payload,
                        updated_at
                    )
                    VALUES (%s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (complex_id, snapshot_timestamp)
                    DO UPDATE SET
                        history_kind = EXCLUDED.history_kind,
                        payload = EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        clean_complex_id,
                        clean_snapshot_timestamp,
                        clean_history_kind,
                        json.dumps(normalized_payload, ensure_ascii=False),
                        clean_updated_at,
                    ),
                )

    def list_history(
        self,
        complex_id: str,
        *,
        history_kind: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        clean_complex_id = str(complex_id or "").strip()
        if not clean_complex_id:
            return []
        clean_history_kind = str(history_kind or "").strip()
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                if clean_history_kind:
                    cur.execute(
                        """
                        SELECT snapshot_timestamp, payload
                        FROM actra_hosted_workspace_complex_history
                        WHERE complex_id = %s AND history_kind = %s
                        ORDER BY snapshot_timestamp DESC
                        """,
                        (clean_complex_id, clean_history_kind),
                    )
                else:
                    cur.execute(
                        """
                        SELECT snapshot_timestamp, payload
                        FROM actra_hosted_workspace_complex_history
                        WHERE complex_id = %s
                        ORDER BY snapshot_timestamp DESC
                        """,
                        (clean_complex_id,),
                    )
                rows = cur.fetchall() or []
        items: List[Dict[str, Any]] = []
        for row in rows:
            payload = self._json_object(row[1])
            if payload is None:
                continue
            item = dict(payload)
            item["_snapshot_timestamp"] = str(row[0] or "").strip()
            items.append(item)
        return items

    def get_history_snapshot(self, complex_id: str, snapshot_timestamp: str) -> Optional[Dict[str, Any]]:
        clean_complex_id = str(complex_id or "").strip()
        clean_snapshot_timestamp = str(snapshot_timestamp or "").strip()
        if not clean_complex_id or not clean_snapshot_timestamp:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_hosted_workspace_complex_history
                    WHERE complex_id = %s AND snapshot_timestamp = %s
                    LIMIT 1
                    """,
                    (clean_complex_id, clean_snapshot_timestamp),
                )
                row = cur.fetchone()
        payload = self._json_object(row[0]) if row else None
        if payload is None:
            return None
        item = dict(payload)
        item["_snapshot_timestamp"] = clean_snapshot_timestamp
        return item

    def delete_history_snapshot(self, complex_id: str, snapshot_timestamp: str) -> bool:
        clean_complex_id = str(complex_id or "").strip()
        clean_snapshot_timestamp = str(snapshot_timestamp or "").strip()
        if not clean_complex_id or not clean_snapshot_timestamp:
            return False
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM actra_hosted_workspace_complex_history
                    WHERE complex_id = %s AND snapshot_timestamp = %s
                    """,
                    (clean_complex_id, clean_snapshot_timestamp),
                )
                deleted = cur.rowcount
        return bool(deleted)

    def delete_autosave_snapshots(self, complex_id: str) -> int:
        clean_complex_id = str(complex_id or "").strip()
        if not clean_complex_id:
            return 0
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM actra_hosted_workspace_complex_history
                    WHERE complex_id = %s AND history_kind = 'autosave'
                    """,
                    (clean_complex_id,),
                )
                deleted = cur.rowcount
        return int(deleted or 0)

    def delete_history(self, complex_id: str) -> int:
        clean_complex_id = str(complex_id or "").strip()
        if not clean_complex_id:
            return 0
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM actra_hosted_workspace_complex_history
                    WHERE complex_id = %s
                    """,
                    (clean_complex_id,),
                )
                deleted = cur.rowcount
        return int(deleted or 0)

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
