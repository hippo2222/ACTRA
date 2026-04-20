from __future__ import annotations

import hashlib
import logging
import mimetypes
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from persistence.hosted_asset_repository import HostedAssetRepository
from persistence.postgres import PostgresUnavailableError
from persistence.runtime import PersistenceRuntimeSettings


class HostedAssetService:
    """Hosted asset metadata service with managed server-side blob storage."""

    def __init__(self, data_dir: str, persistence_settings: PersistenceRuntimeSettings) -> None:
        self.data_dir = Path(data_dir).resolve()
        self.persistence_settings = persistence_settings
        self.repository = HostedAssetRepository(self.persistence_settings.postgres_dsn)
        self._storage_ready = False
        self.logger = logging.getLogger(self.__class__.__name__)

    @property
    def hosted_storage_ready(self) -> bool:
        return bool(self._storage_ready)

    def ensure_persistence_ready(self) -> None:
        if self._storage_ready:
            return
        try:
            self.repository.ensure_schema()
        except PostgresUnavailableError as exc:
            self.logger.warning("[HOSTED][DEV-FALLBACK] HostedAssetRepository schema check skipped: %s", exc)
        self.persistence_settings.asset_blobs_root().mkdir(parents=True, exist_ok=True)
        self._storage_ready = True

    def build_asset_url(self, asset_id: str) -> str:
        clean_asset_id = str(asset_id or "").strip()
        return f"/api/assets/{clean_asset_id}/content"

    def get_asset(self, asset_id: str) -> Optional[Dict[str, Any]]:
        self.ensure_persistence_ready()
        asset = self.repository.get_asset(asset_id)
        asset = self._maybe_migrate_asset_to_managed_storage(asset)
        return self._with_derived_fields(asset)

    def register_existing_file(
        self,
        file_path: Path,
        *,
        owner_user_id: Optional[str],
        visibility_scope: str,
        asset_kind: str,
        original_filename: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        self.ensure_persistence_ready()
        resolved = Path(file_path).resolve()
        if not resolved.exists() or not resolved.is_file():
            raise FileNotFoundError(str(resolved))

        source_storage_root, source_storage_rel_path = self._resolve_storage_locator(resolved)
        existing = None
        try:
            existing = self.repository.get_asset_by_storage_locator(
                storage_root=source_storage_root,
                storage_rel_path=source_storage_rel_path,
            )
        except PostgresUnavailableError as exc:
            self.logger.warning("[HOSTED][DEV-FALLBACK] register_existing_file using minimal fallback: %s", exc)
            return {
                "asset_id": None,
                "asset_url": None,
                "storage_root": source_storage_root,
                "storage_rel_path": source_storage_rel_path,
                "original_filename": original_filename or resolved.name,
                "size_bytes": int(resolved.stat().st_size),
            }
        digest = self._sha256_file(resolved)
        if existing is not None:
            existing = self._ensure_asset_in_managed_storage(
                existing,
                source_path=resolved,
                original_filename=original_filename,
            )
            return self._with_derived_fields(existing) or existing

        dedup = self.repository.get_asset_by_content_fingerprint(
            owner_user_id=owner_user_id,
            content_sha256=digest,
            visibility_scope=str(visibility_scope or "private_workspace").strip() or "private_workspace",
        )
        if dedup is not None:
            dedup = self._maybe_migrate_asset_to_managed_storage(dedup)
            return self._with_derived_fields(dedup) or dedup

        mime_type = mimetypes.guess_type(resolved.name)[0] or "application/octet-stream"
        managed_rel_path = self._ensure_blob_copied_to_managed_store(
            resolved,
            content_sha256=digest,
            original_filename=original_filename or resolved.name,
        )
        now = datetime.utcnow().isoformat() + "Z"
        record = {
            "asset_id": f"asset_{uuid.uuid4().hex}",
            "owner_user_id": str(owner_user_id or "").strip() or None,
            "visibility_scope": str(visibility_scope or "private_workspace").strip()
            or "private_workspace",
            "asset_kind": str(asset_kind or "generic_file").strip() or "generic_file",
            "storage_backend": "managed_state_blobs",
            "storage_root": "state_root",
            "storage_rel_path": managed_rel_path,
            "mime_type": mime_type,
            "original_filename": str(original_filename or resolved.name).strip() or resolved.name,
            "content_sha256": digest,
            "size_bytes": int(resolved.stat().st_size),
            "created_at": now,
            "updated_at": now,
            "metadata": {
                **dict(metadata or {}),
                "source_storage_root": source_storage_root,
                "source_storage_rel_path": source_storage_rel_path,
            },
        }
        created = self.repository.create_asset(record)
        return self._with_derived_fields(created) or created

    def resolve_asset_file(self, asset_id: str) -> Optional[Path]:
        asset = self.get_asset(asset_id)
        if asset is None:
            return None
        asset = self._maybe_migrate_asset_to_managed_storage(asset)
        storage_root = str(asset.get("storage_root") or "").strip()
        storage_rel_path = str(asset.get("storage_rel_path") or "").strip()
        if not storage_root or not storage_rel_path:
            return None

        if storage_root == "data_root":
            candidate = (self.data_dir / storage_rel_path).resolve()
        elif storage_root == "state_root":
            candidate = (self.persistence_settings.state_root / storage_rel_path).resolve()
        else:
            return None

        if not candidate.exists() or not candidate.is_file():
            return None
        return candidate

    def can_access_asset(self, asset: Dict[str, Any], *, user_id: Optional[str]) -> bool:
        visibility_scope = str(asset.get("visibility_scope") or "").strip().lower()
        owner_user_id = str(asset.get("owner_user_id") or "").strip()
        clean_user_id = str(user_id or "").strip()
        if visibility_scope in {"public", "shared_catalog"}:
            return True
        if not clean_user_id:
            return False
        if owner_user_id and owner_user_id == clean_user_id:
            return True
        return False

    def _resolve_storage_locator(self, path: Path) -> tuple[str, str]:
        resolved = path.resolve()
        try:
            rel = resolved.relative_to(self.data_dir)
            return "data_root", rel.as_posix()
        except ValueError:
            pass

        try:
            rel = resolved.relative_to(self.persistence_settings.state_root)
            return "state_root", rel.as_posix()
        except ValueError as exc:
            raise ValueError(f"asset_path_outside_managed_roots:{resolved}") from exc

    def _managed_blob_relative_path(self, *, content_sha256: str, original_filename: str) -> str:
        clean_sha = str(content_sha256 or "").strip().lower()
        if not clean_sha:
            raise ValueError("content_sha256_required")
        suffix = Path(str(original_filename or "")).suffix.strip().lower()
        if not suffix:
            suffix = mimetypes.guess_extension(mimetypes.guess_type(str(original_filename or ""))[0] or "") or ""
        return f"asset_blobs/{clean_sha[:2]}/{clean_sha[2:4]}/{clean_sha}{suffix}"

    def _ensure_blob_copied_to_managed_store(
        self,
        source_path: Path,
        *,
        content_sha256: str,
        original_filename: str,
    ) -> str:
        rel_path = self._managed_blob_relative_path(
            content_sha256=content_sha256,
            original_filename=original_filename,
        )
        target = (self.persistence_settings.state_root / rel_path).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            shutil.copy2(str(source_path), str(target))
        return rel_path

    def _asset_source_path(self, asset: Dict[str, Any]) -> Optional[Path]:
        storage_root = str(asset.get("storage_root") or "").strip()
        storage_rel_path = str(asset.get("storage_rel_path") or "").strip()
        if not storage_root or not storage_rel_path:
            return None
        if storage_root == "data_root":
            candidate = (self.data_dir / storage_rel_path).resolve()
        elif storage_root == "state_root":
            candidate = (self.persistence_settings.state_root / storage_rel_path).resolve()
        else:
            return None
        return candidate if candidate.exists() and candidate.is_file() else None

    def _ensure_asset_in_managed_storage(
        self,
        asset: Dict[str, Any],
        *,
        source_path: Optional[Path] = None,
        original_filename: Optional[str] = None,
    ) -> Dict[str, Any]:
        storage_backend = str(asset.get("storage_backend") or "").strip()
        storage_root = str(asset.get("storage_root") or "").strip()
        storage_rel_path = str(asset.get("storage_rel_path") or "").strip()
        if storage_backend == "managed_state_blobs" and storage_root == "state_root" and storage_rel_path.startswith("asset_blobs/"):
            return asset

        source = source_path if source_path is not None else self._asset_source_path(asset)
        if source is None:
            return asset

        digest = str(asset.get("content_sha256") or "").strip() or self._sha256_file(source)
        managed_rel_path = self._ensure_blob_copied_to_managed_store(
            source,
            content_sha256=digest,
            original_filename=original_filename or str(asset.get("original_filename") or source.name),
        )
        updated = dict(asset)
        metadata = dict(updated.get("metadata") or {})
        if storage_root and storage_rel_path:
            metadata.setdefault("source_storage_root", storage_root)
            metadata.setdefault("source_storage_rel_path", storage_rel_path)
        updated["metadata"] = metadata
        updated["storage_backend"] = "managed_state_blobs"
        updated["storage_root"] = "state_root"
        updated["storage_rel_path"] = managed_rel_path
        updated["updated_at"] = datetime.utcnow().isoformat() + "Z"
        migrated = self.repository.create_asset(updated)
        self.logger.info("[HOSTED] Migrated asset %s into managed blob store", updated.get("asset_id"))
        return migrated

    def _maybe_migrate_asset_to_managed_storage(self, asset: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if asset is None:
            return None
        try:
            return self._ensure_asset_in_managed_storage(asset)
        except Exception as exc:
            self.logger.warning(
                "[HOSTED] Failed to migrate asset %s to managed storage: %s",
                asset.get("asset_id"),
                exc,
            )
            return asset

    def _with_derived_fields(self, asset: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if asset is None:
            return None
        item = dict(asset)
        asset_id = str(item.get("asset_id") or "").strip()
        if asset_id:
            item["asset_url"] = self.build_asset_url(asset_id)
        return item

    @staticmethod
    def _sha256_file(path: Path) -> str:
        hasher = hashlib.sha256()
        with open(path, "rb") as fh:
            while True:
                chunk = fh.read(8192)
                if not chunk:
                    break
                hasher.update(chunk)
        return hasher.hexdigest()
