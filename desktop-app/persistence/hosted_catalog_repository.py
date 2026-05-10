from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from persistence.postgres import postgres_connection


class HostedCatalogRepository:
    """Postgres-backed source of truth for public catalog items and versions."""

    def __init__(self, dsn: str) -> None:
        self._dsn = str(dsn or "").strip()

    def ensure_schema(self) -> None:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_catalog_items (
                        item_id TEXT PRIMARY KEY,
                        source_workspace_key TEXT NOT NULL UNIQUE,
                        owner_user_id TEXT NOT NULL,
                        content_type TEXT NOT NULL,
                        latest_version_id TEXT,
                        latest_published_at TEXT NOT NULL,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_actra_catalog_items_type_published
                    ON actra_catalog_items (content_type, latest_published_at DESC, item_id ASC)
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_actra_catalog_items_access_code
                    ON actra_catalog_items ((payload->>'access_code'))
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_catalog_versions (
                        version_id TEXT PRIMARY KEY,
                        item_id TEXT NOT NULL,
                        owner_user_id TEXT NOT NULL,
                        content_type TEXT NOT NULL,
                        published_at TEXT NOT NULL,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_actra_catalog_versions_item_published
                    ON actra_catalog_versions (item_id, published_at DESC, version_id ASC)
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_theory_library_entries (
                        library_entry_id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        catalog_item_id TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_actra_theory_library_entries_user_item
                    ON actra_theory_library_entries (user_id, catalog_item_id)
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_actra_theory_library_entries_user_updated
                    ON actra_theory_library_entries (user_id, updated_at DESC, library_entry_id ASC)
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_complex_library_entries (
                        library_entry_id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        catalog_item_id TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_actra_complex_library_entries_user_item
                    ON actra_complex_library_entries (user_id, catalog_item_id)
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_actra_complex_library_entries_user_updated
                    ON actra_complex_library_entries (user_id, updated_at DESC, library_entry_id ASC)
                    """
                )

    def count_items(self) -> int:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM actra_catalog_items")
                row = cur.fetchone()
        return int(row[0] if row else 0)

    def list_items(self) -> List[Dict[str, Any]]:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_catalog_items
                    ORDER BY latest_published_at DESC, item_id ASC
                    """
                )
                rows = cur.fetchall() or []
        return [item for item in (self._json_object(row[0]) for row in rows) if item is not None]

    def get_item(self, item_id: str) -> Optional[Dict[str, Any]]:
        clean_item_id = str(item_id or "").strip()
        if not clean_item_id:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_catalog_items
                    WHERE item_id = %s
                    LIMIT 1
                    """,
                    (clean_item_id,),
                )
                row = cur.fetchone()
        return self._json_object(row[0]) if row else None

    def get_item_by_source_workspace_key(self, source_workspace_key: str) -> Optional[Dict[str, Any]]:
        clean_key = str(source_workspace_key or "").strip()
        if not clean_key:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_catalog_items
                    WHERE source_workspace_key = %s
                    LIMIT 1
                    """,
                    (clean_key,),
                )
                row = cur.fetchone()
        return self._json_object(row[0]) if row else None

    def get_item_by_access_code(self, access_code: str) -> Optional[Dict[str, Any]]:
        clean_code = str(access_code or "").strip()
        if not clean_code:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_catalog_items
                    WHERE payload->>'access_code' = %s
                    LIMIT 1
                    """,
                    (clean_code,),
                )
                row = cur.fetchone()
        return self._json_object(row[0]) if row else None

    def upsert_item(self, payload: Dict[str, Any]) -> None:
        normalized = payload if isinstance(payload, dict) else {}
        item_id = str(normalized.get("item_id") or "").strip()
        source_workspace_key = str(normalized.get("source_workspace_key") or "").strip()
        if not item_id:
            raise ValueError("item_id is required")
        if not source_workspace_key:
            raise ValueError("source_workspace_key is required")
        updated_at = str(
            normalized.get("updated_at")
            or normalized.get("latest_published_at")
            or ""
        ).strip() or item_id
        latest_published_at = str(normalized.get("latest_published_at") or updated_at).strip() or updated_at
        owner_user_id = str(normalized.get("owner_user_id") or "").strip()
        content_type = str(normalized.get("content_type") or "").strip()
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_catalog_items (
                        item_id,
                        source_workspace_key,
                        owner_user_id,
                        content_type,
                        latest_version_id,
                        latest_published_at,
                        payload,
                        updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (item_id) DO UPDATE
                    SET
                        source_workspace_key = EXCLUDED.source_workspace_key,
                        owner_user_id = EXCLUDED.owner_user_id,
                        content_type = EXCLUDED.content_type,
                        latest_version_id = EXCLUDED.latest_version_id,
                        latest_published_at = EXCLUDED.latest_published_at,
                        payload = EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        item_id,
                        source_workspace_key,
                        owner_user_id,
                        content_type,
                        normalized.get("latest_version_id"),
                        latest_published_at,
                        json.dumps(normalized, ensure_ascii=False),
                        updated_at,
                    ),
                )

    def list_versions(self, item_id: str) -> List[Dict[str, Any]]:
        clean_item_id = str(item_id or "").strip()
        if not clean_item_id:
            return []
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_catalog_versions
                    WHERE item_id = %s
                    ORDER BY published_at DESC, version_id ASC
                    """,
                    (clean_item_id,),
                )
                rows = cur.fetchall() or []
        return [item for item in (self._json_object(row[0]) for row in rows) if item is not None]

    def get_version(self, item_id: str, version_id: str) -> Optional[Dict[str, Any]]:
        clean_item_id = str(item_id or "").strip()
        clean_version_id = str(version_id or "").strip()
        if not clean_item_id or not clean_version_id:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_catalog_versions
                    WHERE item_id = %s AND version_id = %s
                    LIMIT 1
                    """,
                    (clean_item_id, clean_version_id),
                )
                row = cur.fetchone()
        return self._json_object(row[0]) if row else None

    def insert_version(self, payload: Dict[str, Any]) -> None:
        normalized = payload if isinstance(payload, dict) else {}
        version_id = str(normalized.get("version_id") or "").strip()
        item_id = str(normalized.get("item_id") or "").strip()
        owner_user_id = str(normalized.get("owner_user_id") or "").strip()
        content_type = str(normalized.get("content_type") or "").strip()
        published_at = str(normalized.get("published_at") or "").strip() or version_id
        if not version_id:
            raise ValueError("version_id is required")
        if not item_id:
            raise ValueError("item_id is required")
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_catalog_versions (
                        version_id,
                        item_id,
                        owner_user_id,
                        content_type,
                        published_at,
                        payload
                    )
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (version_id) DO NOTHING
                    """,
                    (
                        version_id,
                        item_id,
                        owner_user_id,
                        content_type,
                        published_at,
                        json.dumps(normalized, ensure_ascii=False),
                    ),
                )

    def list_theory_library_entries(self, user_id: str) -> List[Dict[str, Any]]:
        clean_user_id = str(user_id or "").strip()
        if not clean_user_id:
            return []
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_theory_library_entries
                    WHERE user_id = %s
                    ORDER BY updated_at DESC, library_entry_id ASC
                    """,
                    (clean_user_id,),
                )
                rows = cur.fetchall() or []
        return [item for item in (self._json_object(row[0]) for row in rows) if item is not None]

    def get_theory_library_entry(self, library_entry_id: str) -> Optional[Dict[str, Any]]:
        clean_entry_id = str(library_entry_id or "").strip()
        if not clean_entry_id:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_theory_library_entries
                    WHERE library_entry_id = %s
                    LIMIT 1
                    """,
                    (clean_entry_id,),
                )
                row = cur.fetchone()
        return self._json_object(row[0]) if row else None

    def get_theory_library_entry_by_user_item(self, user_id: str, catalog_item_id: str) -> Optional[Dict[str, Any]]:
        clean_user_id = str(user_id or "").strip()
        clean_item_id = str(catalog_item_id or "").strip()
        if not clean_user_id or not clean_item_id:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_theory_library_entries
                    WHERE user_id = %s AND catalog_item_id = %s
                    LIMIT 1
                    """,
                    (clean_user_id, clean_item_id),
                )
                row = cur.fetchone()
        return self._json_object(row[0]) if row else None

    def upsert_theory_library_entry(self, payload: Dict[str, Any]) -> None:
        normalized = payload if isinstance(payload, dict) else {}
        library_entry_id = str(normalized.get("library_entry_id") or "").strip()
        user_id = str(normalized.get("user_id") or "").strip()
        catalog_item_id = str(normalized.get("catalog_item_id") or "").strip()
        updated_at = str(normalized.get("updated_at") or "").strip() or library_entry_id
        if not library_entry_id:
            raise ValueError("library_entry_id is required")
        if not user_id:
            raise ValueError("user_id is required")
        if not catalog_item_id:
            raise ValueError("catalog_item_id is required")
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_theory_library_entries (
                        library_entry_id,
                        user_id,
                        catalog_item_id,
                        updated_at,
                        payload
                    )
                    VALUES (%s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (library_entry_id) DO UPDATE
                    SET
                        user_id = EXCLUDED.user_id,
                        catalog_item_id = EXCLUDED.catalog_item_id,
                        updated_at = EXCLUDED.updated_at,
                        payload = EXCLUDED.payload
                    """,
                    (
                        library_entry_id,
                        user_id,
                        catalog_item_id,
                        updated_at,
                        json.dumps(normalized, ensure_ascii=False),
                    ),
                )

    def delete_theory_library_entry(self, library_entry_id: str) -> None:
        clean_entry_id = str(library_entry_id or "").strip()
        if not clean_entry_id:
            return
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM actra_theory_library_entries
                    WHERE library_entry_id = %s
                    """,
                    (clean_entry_id,),
                )

    def list_complex_library_entries(self, user_id: str) -> List[Dict[str, Any]]:
        clean_user_id = str(user_id or "").strip()
        if not clean_user_id:
            return []
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_complex_library_entries
                    WHERE user_id = %s
                    ORDER BY updated_at DESC, library_entry_id ASC
                    """,
                    (clean_user_id,),
                )
                rows = cur.fetchall() or []
        return [item for item in (self._json_object(row[0]) for row in rows) if item is not None]

    def get_complex_library_entry(self, library_entry_id: str) -> Optional[Dict[str, Any]]:
        clean_entry_id = str(library_entry_id or "").strip()
        if not clean_entry_id:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_complex_library_entries
                    WHERE library_entry_id = %s
                    LIMIT 1
                    """,
                    (clean_entry_id,),
                )
                row = cur.fetchone()
        return self._json_object(row[0]) if row else None

    def get_complex_library_entry_by_user_item(self, user_id: str, catalog_item_id: str) -> Optional[Dict[str, Any]]:
        clean_user_id = str(user_id or "").strip()
        clean_item_id = str(catalog_item_id or "").strip()
        if not clean_user_id or not clean_item_id:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_complex_library_entries
                    WHERE user_id = %s AND catalog_item_id = %s
                    LIMIT 1
                    """,
                    (clean_user_id, clean_item_id),
                )
                row = cur.fetchone()
        return self._json_object(row[0]) if row else None

    def list_complex_library_entries_for_item(self, catalog_item_id: str) -> List[Dict[str, Any]]:
        clean_item_id = str(catalog_item_id or "").strip()
        if not clean_item_id:
            return []
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_complex_library_entries
                    WHERE catalog_item_id = %s
                    ORDER BY updated_at DESC, library_entry_id ASC
                    """,
                    (clean_item_id,),
                )
                rows = cur.fetchall() or []
        return [item for item in (self._json_object(row[0]) for row in rows) if item is not None]

    def upsert_complex_library_entry(self, payload: Dict[str, Any]) -> None:
        normalized = payload if isinstance(payload, dict) else {}
        library_entry_id = str(normalized.get("library_entry_id") or "").strip()
        user_id = str(normalized.get("user_id") or "").strip()
        catalog_item_id = str(normalized.get("catalog_item_id") or "").strip()
        updated_at = str(normalized.get("updated_at") or "").strip() or library_entry_id
        if not library_entry_id:
            raise ValueError("library_entry_id is required")
        if not user_id:
            raise ValueError("user_id is required")
        if not catalog_item_id:
            raise ValueError("catalog_item_id is required")
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_complex_library_entries (
                        library_entry_id,
                        user_id,
                        catalog_item_id,
                        updated_at,
                        payload
                    )
                    VALUES (%s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (library_entry_id) DO UPDATE
                    SET
                        user_id = EXCLUDED.user_id,
                        catalog_item_id = EXCLUDED.catalog_item_id,
                        updated_at = EXCLUDED.updated_at,
                        payload = EXCLUDED.payload
                    """,
                    (
                        library_entry_id,
                        user_id,
                        catalog_item_id,
                        updated_at,
                        json.dumps(normalized, ensure_ascii=False),
                    ),
                )

    def delete_complex_library_entry(self, library_entry_id: str) -> None:
        clean_entry_id = str(library_entry_id or "").strip()
        if not clean_entry_id:
            return
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM actra_complex_library_entries
                    WHERE library_entry_id = %s
                    """,
                    (clean_entry_id,),
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
