from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List

from persistence.postgres import postgres_connection
from services.workspace_lineage import normalize_workspace_graph_entity_fields


class HostedWorkspaceCatalogRepository:
    """Postgres-backed source of truth for hosted modules/topics/tasks metadata."""

    _CATALOG_KEY = "default"

    def __init__(self, dsn: str) -> None:
        self._dsn = str(dsn or "").strip()

    def ensure_schema(self) -> None:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_hosted_workspace_catalog (
                        catalog_key TEXT PRIMARY KEY,
                        payload JSONB NOT NULL DEFAULT '[]'::jsonb,
                        updated_at TEXT NOT NULL
                    )
                    """
                )

    def count_catalogs(self) -> int:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM actra_hosted_workspace_catalog")
                row = cur.fetchone()
        return int(row[0] if row else 0)

    def load_catalog(self) -> List[Dict[str, Any]]:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_hosted_workspace_catalog
                    WHERE catalog_key = %s
                    LIMIT 1
                    """,
                    (self._CATALOG_KEY,),
                )
                row = cur.fetchone()
        if not row:
            return []
        return self._normalize_modules(self._json_list(row[0]))

    def replace_catalog(self, modules: List[Dict[str, Any]]) -> None:
        normalized_modules = self._normalize_modules(modules)
        updated_at = datetime.utcnow().isoformat() + "Z"
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_workspace_catalog (catalog_key, payload, updated_at)
                    VALUES (%s, %s::jsonb, %s)
                    ON CONFLICT (catalog_key)
                    DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
                    """,
                    (
                        self._CATALOG_KEY,
                        json.dumps(normalized_modules, ensure_ascii=False),
                        updated_at,
                    ),
                )

    def import_catalog_if_absent(self, modules: List[Dict[str, Any]]) -> None:
        normalized_modules = self._normalize_modules(modules)
        updated_at = datetime.utcnow().isoformat() + "Z"
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_workspace_catalog (catalog_key, payload, updated_at)
                    VALUES (%s, %s::jsonb, %s)
                    ON CONFLICT (catalog_key) DO NOTHING
                    """,
                    (
                        self._CATALOG_KEY,
                        json.dumps(normalized_modules, ensure_ascii=False),
                        updated_at,
                    ),
                )

    @staticmethod
    def _normalize_modules(modules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        normalized_items: List[Dict[str, Any]] = []
        for module in modules or []:
            if not isinstance(module, dict):
                continue
            module_id = str(module.get("id") or "").strip()
            if not module_id:
                continue
            module_payload = normalize_workspace_graph_entity_fields(
                dict(module),
                entity_kind="module",
                module_id=module_id,
            )
            normalized_topics: List[Dict[str, Any]] = []
            for topic in module_payload.get("topics") or []:
                if not isinstance(topic, dict):
                    continue
                topic_id = str(topic.get("id") or "").strip()
                if not topic_id:
                    continue
                topic_payload = normalize_workspace_graph_entity_fields(
                    dict(topic),
                    entity_kind="topic",
                    module_id=module_id,
                    topic_id=topic_id,
                )
                normalized_tasks: List[Dict[str, Any]] = []
                for task in topic_payload.get("tasks") or []:
                    if not isinstance(task, dict):
                        continue
                    task_id = str(task.get("id") or "").strip()
                    if not task_id:
                        continue
                    normalized_tasks.append(
                        normalize_workspace_graph_entity_fields(
                            dict(task),
                            entity_kind="task",
                            module_id=module_id,
                            topic_id=topic_id,
                            task_id=task_id,
                        )
                    )
                topic_payload["tasks"] = normalized_tasks
                normalized_topics.append(topic_payload)
            module_payload["topics"] = normalized_topics
            normalized_items.append(module_payload)
        return normalized_items

    @staticmethod
    def _json_list(value: Any) -> List[Dict[str, Any]]:
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, str):
            try:
                decoded = json.loads(value)
            except Exception:
                return []
            return [item for item in decoded if isinstance(item, dict)] if isinstance(decoded, list) else []
        return []
