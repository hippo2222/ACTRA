from __future__ import annotations

import json
from typing import Any, Dict, Optional

from persistence.postgres import postgres_connection


class HostedAssetRepository:
    """Postgres-backed metadata store for hosted asset references."""

    def __init__(self, dsn: str) -> None:
        self._dsn = str(dsn or "").strip()

    def ensure_schema(self) -> None:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_hosted_assets (
                        asset_id TEXT PRIMARY KEY,
                        owner_user_id TEXT,
                        visibility_scope TEXT NOT NULL,
                        asset_kind TEXT NOT NULL,
                        storage_backend TEXT NOT NULL,
                        storage_root TEXT NOT NULL,
                        storage_rel_path TEXT NOT NULL,
                        mime_type TEXT,
                        original_filename TEXT,
                        content_sha256 TEXT,
                        size_bytes BIGINT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_actra_hosted_assets_storage_locator
                    ON actra_hosted_assets (storage_root, storage_rel_path)
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_actra_hosted_assets_owner_sha_visibility
                    ON actra_hosted_assets (owner_user_id, content_sha256, visibility_scope)
                    """
                )

    def get_asset(self, asset_id: str) -> Optional[Dict[str, Any]]:
        clean_asset_id = str(asset_id or "").strip()
        if not clean_asset_id:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        asset_id,
                        owner_user_id,
                        visibility_scope,
                        asset_kind,
                        storage_backend,
                        storage_root,
                        storage_rel_path,
                        mime_type,
                        original_filename,
                        content_sha256,
                        size_bytes,
                        created_at,
                        updated_at,
                        metadata
                    FROM actra_hosted_assets
                    WHERE asset_id = %s
                    LIMIT 1
                    """,
                    (clean_asset_id,),
                )
                row = cur.fetchone()
        return self._row_to_dict(row)

    def get_asset_by_storage_locator(
        self,
        *,
        storage_root: str,
        storage_rel_path: str,
    ) -> Optional[Dict[str, Any]]:
        clean_root = str(storage_root or "").strip()
        clean_rel_path = str(storage_rel_path or "").strip()
        if not clean_root or not clean_rel_path:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        asset_id,
                        owner_user_id,
                        visibility_scope,
                        asset_kind,
                        storage_backend,
                        storage_root,
                        storage_rel_path,
                        mime_type,
                        original_filename,
                        content_sha256,
                        size_bytes,
                        created_at,
                        updated_at,
                        metadata
                    FROM actra_hosted_assets
                    WHERE storage_root = %s AND storage_rel_path = %s
                    LIMIT 1
                    """,
                    (clean_root, clean_rel_path),
                )
                row = cur.fetchone()
        return self._row_to_dict(row)

    def get_asset_by_content_fingerprint(
        self,
        *,
        owner_user_id: Optional[str],
        content_sha256: str,
        visibility_scope: str,
    ) -> Optional[Dict[str, Any]]:
        clean_owner_user_id = str(owner_user_id or "").strip() or None
        clean_sha = str(content_sha256 or "").strip()
        clean_visibility = str(visibility_scope or "").strip()
        if not clean_sha or not clean_visibility:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                if clean_owner_user_id is None:
                    cur.execute(
                        """
                        SELECT
                            asset_id,
                            owner_user_id,
                            visibility_scope,
                            asset_kind,
                            storage_backend,
                            storage_root,
                            storage_rel_path,
                            mime_type,
                            original_filename,
                            content_sha256,
                            size_bytes,
                            created_at,
                            updated_at,
                            metadata
                        FROM actra_hosted_assets
                        WHERE owner_user_id IS NULL AND content_sha256 = %s AND visibility_scope = %s
                        LIMIT 1
                        """,
                        (clean_sha, clean_visibility),
                    )
                else:
                    cur.execute(
                        """
                        SELECT
                            asset_id,
                            owner_user_id,
                            visibility_scope,
                            asset_kind,
                            storage_backend,
                            storage_root,
                            storage_rel_path,
                            mime_type,
                            original_filename,
                            content_sha256,
                            size_bytes,
                            created_at,
                            updated_at,
                            metadata
                        FROM actra_hosted_assets
                        WHERE owner_user_id = %s AND content_sha256 = %s AND visibility_scope = %s
                        LIMIT 1
                        """,
                        (clean_owner_user_id, clean_sha, clean_visibility),
                    )
                row = cur.fetchone()
        return self._row_to_dict(row)

    def create_asset(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        normalized = dict(payload or {})
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_assets (
                        asset_id,
                        owner_user_id,
                        visibility_scope,
                        asset_kind,
                        storage_backend,
                        storage_root,
                        storage_rel_path,
                        mime_type,
                        original_filename,
                        content_sha256,
                        size_bytes,
                        created_at,
                        updated_at,
                        metadata
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb
                    )
                    ON CONFLICT (asset_id)
                    DO UPDATE SET
                        owner_user_id = EXCLUDED.owner_user_id,
                        visibility_scope = EXCLUDED.visibility_scope,
                        asset_kind = EXCLUDED.asset_kind,
                        storage_backend = EXCLUDED.storage_backend,
                        storage_root = EXCLUDED.storage_root,
                        storage_rel_path = EXCLUDED.storage_rel_path,
                        mime_type = EXCLUDED.mime_type,
                        original_filename = EXCLUDED.original_filename,
                        content_sha256 = EXCLUDED.content_sha256,
                        size_bytes = EXCLUDED.size_bytes,
                        updated_at = EXCLUDED.updated_at,
                        metadata = EXCLUDED.metadata
                    """,
                    (
                        normalized.get("asset_id"),
                        normalized.get("owner_user_id"),
                        normalized.get("visibility_scope"),
                        normalized.get("asset_kind"),
                        normalized.get("storage_backend"),
                        normalized.get("storage_root"),
                        normalized.get("storage_rel_path"),
                        normalized.get("mime_type"),
                        normalized.get("original_filename"),
                        normalized.get("content_sha256"),
                        normalized.get("size_bytes"),
                        normalized.get("created_at"),
                        normalized.get("updated_at"),
                        json.dumps(normalized.get("metadata") or {}, ensure_ascii=False),
                    ),
                )
        created = self.get_asset(str(normalized.get("asset_id") or ""))
        if created is None:
            raise RuntimeError("asset_create_failed")
        return created

    @staticmethod
    def _row_to_dict(row: Any) -> Optional[Dict[str, Any]]:
        if not row:
            return None
        metadata = row[13]
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except Exception:
                metadata = {}
        if not isinstance(metadata, dict):
            metadata = {}
        return {
            "asset_id": row[0],
            "owner_user_id": row[1],
            "visibility_scope": row[2],
            "asset_kind": row[3],
            "storage_backend": row[4],
            "storage_root": row[5],
            "storage_rel_path": row[6],
            "mime_type": row[7],
            "original_filename": row[8],
            "content_sha256": row[9],
            "size_bytes": row[10],
            "created_at": row[11],
            "updated_at": row[12],
            "metadata": metadata,
        }
