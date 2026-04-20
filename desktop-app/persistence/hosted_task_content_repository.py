from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

from persistence.postgres import postgres_connection


class HostedTaskContentRepository:
    """Postgres-backed source of truth for hosted task payload blobs."""

    def __init__(self, dsn: str) -> None:
        self._dsn = str(dsn or "").strip()

    def ensure_schema(self) -> None:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_hosted_workspace_task_content (
                        module_id TEXT NOT NULL,
                        topic_id TEXT NOT NULL,
                        task_id TEXT NOT NULL,
                        task_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        answer_key_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TEXT NOT NULL,
                        PRIMARY KEY (module_id, topic_id, task_id)
                    )
                    """
                )

    def get_task_content(
        self,
        module_id: str,
        topic_id: str,
        task_id: str,
    ) -> Optional[Dict[str, Any]]:
        clean_module_id, clean_topic_id, clean_task_id = self._clean_ref(module_id, topic_id, task_id)
        if not clean_module_id or not clean_topic_id or not clean_task_id:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT task_payload, answer_key_payload, updated_at
                    FROM actra_hosted_workspace_task_content
                    WHERE module_id = %s AND topic_id = %s AND task_id = %s
                    LIMIT 1
                    """,
                    (clean_module_id, clean_topic_id, clean_task_id),
                )
                row = cur.fetchone()
        if not row:
            return None
        return {
            "module_id": clean_module_id,
            "topic_id": clean_topic_id,
            "task_id": clean_task_id,
            "task_data": self._json_object(row[0]) or {},
            "answer_key": self._json_object(row[1]) or {},
            "updated_at": str(row[2] or ""),
        }

    def upsert_task_content(
        self,
        module_id: str,
        topic_id: str,
        task_id: str,
        *,
        task_data: Dict[str, Any],
        answer_key: Dict[str, Any],
        updated_at: str,
    ) -> None:
        clean_module_id, clean_topic_id, clean_task_id = self._clean_ref(module_id, topic_id, task_id)
        if not clean_module_id or not clean_topic_id or not clean_task_id:
            raise ValueError("module_id, topic_id and task_id are required")
        clean_updated_at = str(updated_at or "").strip() or clean_task_id
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_workspace_task_content (
                        module_id,
                        topic_id,
                        task_id,
                        task_payload,
                        answer_key_payload,
                        updated_at
                    )
                    VALUES (%s, %s, %s, %s::jsonb, %s::jsonb, %s)
                    ON CONFLICT (module_id, topic_id, task_id) DO UPDATE
                    SET
                        task_payload = EXCLUDED.task_payload,
                        answer_key_payload = EXCLUDED.answer_key_payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        clean_module_id,
                        clean_topic_id,
                        clean_task_id,
                        json.dumps(task_data or {}, ensure_ascii=False),
                        json.dumps(answer_key or {}, ensure_ascii=False),
                        clean_updated_at,
                    ),
                )

    def import_task_content_if_absent(
        self,
        module_id: str,
        topic_id: str,
        task_id: str,
        *,
        task_data: Dict[str, Any],
        answer_key: Dict[str, Any],
        updated_at: str,
    ) -> None:
        clean_module_id, clean_topic_id, clean_task_id = self._clean_ref(module_id, topic_id, task_id)
        if not clean_module_id or not clean_topic_id or not clean_task_id:
            return
        clean_updated_at = str(updated_at or "").strip() or clean_task_id
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_workspace_task_content (
                        module_id,
                        topic_id,
                        task_id,
                        task_payload,
                        answer_key_payload,
                        updated_at
                    )
                    VALUES (%s, %s, %s, %s::jsonb, %s::jsonb, %s)
                    ON CONFLICT (module_id, topic_id, task_id) DO NOTHING
                    """,
                    (
                        clean_module_id,
                        clean_topic_id,
                        clean_task_id,
                        json.dumps(task_data or {}, ensure_ascii=False),
                        json.dumps(answer_key or {}, ensure_ascii=False),
                        clean_updated_at,
                    ),
                )

    def delete_task_content(self, module_id: str, topic_id: str, task_id: str) -> bool:
        clean_module_id, clean_topic_id, clean_task_id = self._clean_ref(module_id, topic_id, task_id)
        if not clean_module_id or not clean_topic_id or not clean_task_id:
            return False
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM actra_hosted_workspace_task_content
                    WHERE module_id = %s AND topic_id = %s AND task_id = %s
                    """,
                    (clean_module_id, clean_topic_id, clean_task_id),
                )
                deleted = int(cur.rowcount or 0)
        return deleted > 0

    def list_task_refs(self) -> List[Tuple[str, str, str]]:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT module_id, topic_id, task_id
                    FROM actra_hosted_workspace_task_content
                    ORDER BY module_id, topic_id, task_id
                    """
                )
                rows = cur.fetchall() or []
        return [
            (
                str(row[0] or ""),
                str(row[1] or ""),
                str(row[2] or ""),
            )
            for row in rows
            if row and str(row[0] or "").strip() and str(row[1] or "").strip() and str(row[2] or "").strip()
        ]

    @staticmethod
    def _clean_ref(module_id: str, topic_id: str, task_id: str) -> Tuple[str, str, str]:
        return (
            str(module_id or "").strip(),
            str(topic_id or "").strip(),
            str(task_id or "").strip(),
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
