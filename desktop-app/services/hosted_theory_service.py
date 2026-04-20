from __future__ import annotations

import logging
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

from persistence.hosted_theory_content_repository import HostedTheoryContentRepository
from persistence.hosted_theory_metadata_repository import HostedTheoryMetadataRepository
from persistence.postgres import PostgresUnavailableError
from persistence.runtime import PersistenceRuntimeSettings
from services.hosted_shadow_fallback import HostedShadowFallbackMixin
from services.theory_service import (
    TheoryConflictError,
    TheoryNotFoundError,
    TheoryService,
    TheoryValidationError,
    _normalize_optional_text,
)
from services.workspace_lineage import clear_source_lineage_fields


class HostedTheoryService(HostedShadowFallbackMixin, TheoryService):
    """Hosted theory service with Postgres metadata/content source of truth."""

    def __init__(self, data_dir: str, persistence_settings: PersistenceRuntimeSettings):
        super().__init__(data_dir=data_dir)
        self.persistence_settings = persistence_settings
        self.repository = HostedTheoryMetadataRepository(self.persistence_settings.postgres_dsn)
        self.content_repository = HostedTheoryContentRepository(self.persistence_settings.postgres_dsn)
        self._storage_ready = False
        self.logger = logging.getLogger(self.__class__.__name__)
        self._init_hosted_shadow_fallback_state()

    @property
    def hosted_storage_ready(self) -> bool:
        return bool(self._storage_ready)

    def ensure_persistence_ready(self) -> None:
        if self._storage_ready:
            return
        self.repository.ensure_schema()
        self.content_repository.ensure_schema()
        self._storage_ready = True

    def _ensure_repository_theory_state(self, theory_id: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        meta = self.repository.get_theory_metadata(theory_id)
        content = self.content_repository.get_theory_content(theory_id)
        if meta is None or content is None:
            raise TheoryNotFoundError("theory_not_found")
        normalized_meta = self._normalize_theory_meta(dict(meta or {}), theory_id=theory_id)
        normalized_content = {
            "theory_id": theory_id,
            "delta": self._sanitize_delta(content.get("delta")),
            "images": self._sanitize_images_list(content.get("images")),
            "updated_at": str(content.get("updated_at") or normalized_meta.get("updated_at") or "").strip(),
        }
        return normalized_meta, normalized_content

    def _reserve_hosted_theory_id(self, preferred_theory_id: Any = None, *, title: Any = None) -> str:
        preferred = self._normalize_theory_id(preferred_theory_id)
        if preferred:
            base_id = preferred
        else:
            title_seed = secure_filename(str(title or "").strip().lower().replace(" ", "_"))
            base_id = f"th_{title_seed}" if title_seed else self._generate_theory_id()

        candidate = base_id
        suffix = 1
        while self.repository.get_theory_metadata(candidate) is not None:
            candidate = f"{base_id}_{suffix:02d}"
            suffix += 1
        return candidate

    def _serialize_theory_item(
        self,
        theory_id: str,
        meta: Dict[str, Any],
        content: Dict[str, Any],
        *,
        include_delta: bool,
    ) -> Dict[str, Any]:
        item = {
            "id": meta.get("id", theory_id),
            "title": meta.get("title") or "",
            "created_at": meta.get("created_at"),
            "updated_at": meta.get("updated_at"),
            "version": meta.get("version"),
            "images": content.get("images") or meta.get("images") or [],
            "workspace_entity_kind": meta.get("workspace_entity_kind"),
            "workspace_entity_id": meta.get("workspace_entity_id"),
            "workspace_entity_ref": meta.get("workspace_entity_ref"),
            "workspace_entity": meta.get("workspace_entity"),
            "workspace_copy_kind": meta.get("workspace_copy_kind"),
            "workspace_copy": meta.get("workspace_copy"),
            "created_by_user_id": meta.get("created_by_user_id"),
            "updated_by_user_id": meta.get("updated_by_user_id"),
            "created_via": meta.get("created_via"),
            "content_scope": meta.get("content_scope"),
            "source_catalog_item_id": meta.get("source_catalog_item_id"),
            "source_catalog_version_id": meta.get("source_catalog_version_id"),
            "source_entity_kind": meta.get("source_entity_kind"),
            "source_entity_id": meta.get("source_entity_id"),
            "has_source_lineage": bool(meta.get("has_source_lineage")),
            "source_lineage": meta.get("source_lineage"),
            "source_lineage_key": meta.get("source_lineage_key"),
        }
        if include_delta:
            item["delta"] = self._sanitize_delta(content.get("delta"))
        return item

    def _save_repository_history_snapshot(
        self,
        theory_id: str,
        meta: Dict[str, Any],
        delta: Dict[str, Any],
        *,
        max_versions: int = 25,
    ) -> str:
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
        while self.content_repository.get_history_snapshot(theory_id, timestamp) is not None:
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
        self.content_repository.upsert_history_snapshot(
            theory_id,
            timestamp,
            {"meta": dict(meta or {}), "delta": self._sanitize_delta(delta)},
        )
        snapshots = self.content_repository.list_history(theory_id)
        if len(snapshots) > max_versions:
            for stale in snapshots[max_versions:]:
                stale_timestamp = str(stale.get("_snapshot_timestamp") or "").strip()
                if stale_timestamp:
                    self.content_repository.delete_history_snapshot(theory_id, stale_timestamp)
        return timestamp

    def _write_hosted_theory_state(
        self,
        theory_id: str,
        *,
        meta: Dict[str, Any],
        delta: Dict[str, Any],
        images: List[Any],
        updated_at: str,
    ) -> None:
        self.repository.upsert_theory_metadata(meta)
        self.content_repository.upsert_theory_content(
            theory_id,
            delta=self._sanitize_delta(delta),
            images=self._sanitize_images_list(images),
            updated_at=str(updated_at or "").strip() or theory_id,
        )

    def _cleanup_shadow_theory_dir(self, theory_id: str) -> None:
        try:
            theory_dir = self._resolve_theory_dir(theory_id)
        except TheoryValidationError:
            return
        if theory_dir.exists():
            shutil.rmtree(str(theory_dir), ignore_errors=True)

    def list_theories(self, query: Optional[str] = None) -> List[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("theories.list", exc)
            return TheoryService.list_theories(self, query=query)

        q = str(query or "").strip().lower()
        items: List[Dict[str, Any]] = []
        for meta in self.repository.list_theories():
            normalized_meta = self._normalize_theory_meta(
                dict(meta or {}),
                theory_id=(meta.get("id") if isinstance(meta, dict) else None),
            )
            theory_id = str(normalized_meta.get("id") or "").strip()
            title = str(normalized_meta.get("title") or "")
            if not theory_id:
                continue
            if q and q not in title.lower() and q not in theory_id.lower():
                continue
            content = self.content_repository.get_theory_content(theory_id) or {}
            delta_summary = self._summarize_delta_payload(content.get("delta"))
            items.append(
                {
                    "id": theory_id,
                    "title": title,
                    "created_at": normalized_meta.get("created_at"),
                    "updated_at": normalized_meta.get("updated_at"),
                    "version": normalized_meta.get("version"),
                    "workspace_entity_kind": normalized_meta.get("workspace_entity_kind"),
                    "workspace_entity_id": normalized_meta.get("workspace_entity_id"),
                    "workspace_entity_ref": normalized_meta.get("workspace_entity_ref"),
                    "workspace_entity": normalized_meta.get("workspace_entity"),
                    "workspace_copy_kind": normalized_meta.get("workspace_copy_kind"),
                    "workspace_copy": normalized_meta.get("workspace_copy"),
                    "created_by_user_id": normalized_meta.get("created_by_user_id"),
                    "updated_by_user_id": normalized_meta.get("updated_by_user_id"),
                    "created_via": normalized_meta.get("created_via"),
                    "content_scope": normalized_meta.get("content_scope"),
                    "source_catalog_item_id": normalized_meta.get("source_catalog_item_id"),
                    "source_catalog_version_id": normalized_meta.get("source_catalog_version_id"),
                    "source_entity_kind": normalized_meta.get("source_entity_kind"),
                    "source_entity_id": normalized_meta.get("source_entity_id"),
                    "has_source_lineage": bool(normalized_meta.get("has_source_lineage")),
                    "source_lineage": normalized_meta.get("source_lineage"),
                    "source_lineage_key": normalized_meta.get("source_lineage_key"),
                    "image_count": delta_summary.get("image_count", 0),
                    "has_text": bool(delta_summary.get("has_text")),
                    "has_content": bool(
                        delta_summary.get("has_text")
                        or (delta_summary.get("image_count") or 0) > 0
                    ),
                    "text_chars": int(delta_summary.get("text_chars") or 0),
                    "ops_count": int(delta_summary.get("ops_count") or 0),
                }
            )
        items.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
        return items

    def get_theory(self, theory_id: str, include_delta: bool = True) -> Dict[str, Any]:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("theories.get", exc)
            return TheoryService.get_theory(self, theory_id, include_delta=include_delta)

        meta, content = self._ensure_repository_theory_state(theory_id)
        return self._serialize_theory_item(theory_id, meta, content, include_delta=include_delta)

    def create_theory(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise TheoryValidationError("payload_must_be_object")
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("theories.write", exc)
            return TheoryService.create_theory(self, payload)

        preferred_theory_id = self._normalize_theory_id(payload.get("id"))
        theory_id = self._reserve_hosted_theory_id(preferred_theory_id, title=payload.get("title"))
        if preferred_theory_id and preferred_theory_id != theory_id:
            raise TheoryValidationError("theory_id_already_exists")

        title = self._normalize_title(payload.get("title"))
        delta = self._sanitize_delta(payload.get("delta"))
        images = self._sanitize_images_list(payload.get("images"))
        now = datetime.utcnow().isoformat()

        meta = {
            "id": theory_id,
            "title": title,
            "created_at": now,
            "updated_at": now,
            "version": now,
            "delta_path": "body.delta.json",
            "images": images,
        }
        for field_name in (
            "source_catalog_item_id",
            "source_catalog_version_id",
            "source_entity_kind",
            "source_entity_id",
            "created_by_user_id",
            "updated_by_user_id",
            "created_via",
            "content_scope",
        ):
            if payload.get(field_name) is not None:
                meta[field_name] = payload.get(field_name)
        meta = self._normalize_theory_meta(
            meta,
            theory_id=theory_id,
            fallback_source="manual_editor",
            fallback_scope="shared_local",
        )
        self._write_hosted_theory_state(
            theory_id,
            meta=meta,
            delta=delta,
            images=images,
            updated_at=now,
        )
        return self.get_theory(theory_id, include_delta=True)

    def update_theory(
        self,
        theory_id: str,
        updates: Dict[str, Any],
        expected_version: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not isinstance(updates, dict):
            raise TheoryValidationError("payload_must_be_object")
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("theories.write", exc)
            return TheoryService.update_theory(self, theory_id, updates, expected_version=expected_version)

        meta, content = self._ensure_repository_theory_state(theory_id)
        current_version = str(meta.get("version") or "")
        if expected_version is not None and current_version != expected_version:
            raise TheoryConflictError(
                "Theory has been modified by another user",
                current_version=current_version,
                expected_version=expected_version,
            )

        self._save_repository_history_snapshot(theory_id, meta, content.get("delta") or {"ops": [{"insert": "\n"}]})

        if "title" in updates:
            meta["title"] = self._normalize_title(updates.get("title"))
        if "images" in updates:
            meta["images"] = self._sanitize_images_list(updates.get("images"))
        if "delta" in updates:
            content["delta"] = self._sanitize_delta(updates.get("delta"))
        if updates.get("created_by_user_id") is not None:
            meta["created_by_user_id"] = updates.get("created_by_user_id")
        if updates.get("updated_by_user_id") is not None:
            meta["updated_by_user_id"] = updates.get("updated_by_user_id")
        if updates.get("created_via") is not None:
            meta["created_via"] = updates.get("created_via")
        if updates.get("content_scope") is not None:
            meta["content_scope"] = updates.get("content_scope")

        images = self._sanitize_images_list(meta.get("images"))
        now = datetime.utcnow().isoformat()
        meta["images"] = images
        meta["updated_at"] = now
        meta["version"] = now
        meta["id"] = meta.get("id") or theory_id
        meta["delta_path"] = "body.delta.json"
        meta = self._normalize_theory_meta(
            meta,
            theory_id=theory_id,
            existing=meta,
            fallback_source="manual_editor",
            fallback_scope="shared_local",
        )
        self._write_hosted_theory_state(
            theory_id,
            meta=meta,
            delta=content.get("delta") or {"ops": [{"insert": "\n"}]},
            images=images,
            updated_at=now,
        )
        return self.get_theory(theory_id, include_delta=True)

    def clone_theory(
        self,
        source_theory_id: str,
        title: Optional[str] = None,
        *,
        created_by_user_id: Any = None,
    ) -> Dict[str, Any]:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("theories.write", exc)
            return TheoryService.clone_theory(
                self,
                source_theory_id,
                title=title,
                created_by_user_id=created_by_user_id,
            )

        source_meta, source_content = self._ensure_repository_theory_state(source_theory_id)
        source_delta = self._sanitize_delta(source_content.get("delta"))
        clone_title = (
            self._normalize_title(f"{str(source_meta.get('title') or '').strip() or source_theory_id} (copy)")
            if title is None
            else self._normalize_title(title)
        )

        theory_id = self._reserve_hosted_theory_id(title=clone_title)
        theory_dir = self.theories_dir / theory_id
        images_dir = theory_dir / "images"
        images_dir.mkdir(parents=True, exist_ok=True)

        image_refs = self._collect_delta_image_refs(source_delta)
        for ref in self._sanitize_images_list(source_meta.get("images")):
            if ref not in image_refs:
                image_refs.append(ref)
        image_remap = self._clone_image_refs(image_refs, images_dir)
        cloned_delta = self._remap_delta_images(source_delta, image_remap)

        cloned_images: List[str] = []
        for ref in self._sanitize_images_list(source_meta.get("images")):
            sanitized = self._sanitize_image_ref(ref)
            if not sanitized:
                continue
            mapped = image_remap.get(sanitized)
            final_ref = mapped or sanitized
            if final_ref not in cloned_images:
                cloned_images.append(final_ref)
        for ref in self._collect_delta_image_refs(cloned_delta):
            if ref not in cloned_images:
                cloned_images.append(ref)

        now = datetime.utcnow().isoformat()
        cloned_meta = {
            "id": theory_id,
            "title": clone_title,
            "created_at": now,
            "updated_at": now,
            "version": now,
            "delta_path": "body.delta.json",
            "images": cloned_images,
        }
        normalized_owner_user_id = _normalize_optional_text(created_by_user_id)
        if normalized_owner_user_id is not None:
            cloned_meta["created_by_user_id"] = normalized_owner_user_id
            cloned_meta["updated_by_user_id"] = normalized_owner_user_id
        cloned_meta = clear_source_lineage_fields(cloned_meta)
        cloned_meta = self._normalize_theory_meta(
            cloned_meta,
            theory_id=theory_id,
            fallback_source="manual_copy",
            fallback_scope="shared_local",
        )
        self._write_hosted_theory_state(
            theory_id,
            meta=cloned_meta,
            delta=cloned_delta,
            images=cloned_images,
            updated_at=now,
        )
        return self.get_theory(theory_id, include_delta=True)

    def delete_theory(self, theory_id: str) -> Dict[str, Any]:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("theories.write", exc)
            return TheoryService.delete_theory(self, theory_id)

        meta, _ = self._ensure_repository_theory_state(theory_id)
        now = datetime.utcnow().isoformat()
        self.repository.delete_theory_metadata(theory_id)
        self.content_repository.delete_theory_content(theory_id)
        self.content_repository.delete_history(theory_id)
        self._cleanup_shadow_theory_dir(theory_id)
        return {
            "id": str(meta.get("id") or theory_id),
            "title": str(meta.get("title") or "").strip(),
            "deleted_at": now,
        }

    def add_image(self, theory_id: str, upload: FileStorage) -> Dict[str, Any]:
        if upload is None:
            raise TheoryValidationError("file_required")
        if not upload.filename:
            raise TheoryValidationError("file_name_required")
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("theories.write", exc)
            return TheoryService.add_image(self, theory_id, upload)

        meta, content = self._ensure_repository_theory_state(theory_id)
        filename = secure_filename(upload.filename)
        if not filename:
            raise TheoryValidationError("invalid_file_name")
        ext = Path(filename).suffix.lower()
        if ext not in self.ALLOWED_IMAGE_EXTENSIONS:
            raise TheoryValidationError("unsupported_image_format")

        theory_dir = self._resolve_theory_dir(theory_id)
        images_dir = theory_dir / "images"
        images_dir.mkdir(parents=True, exist_ok=True)

        target = images_dir / filename
        counter = 1
        while target.exists():
            stem = Path(filename).stem
            target = images_dir / f"{stem}_{counter:02d}{ext}"
            counter += 1

        upload.save(str(target))
        rel_path = target.relative_to(self.data_dir).as_posix()
        images = self._sanitize_images_list(list(meta.get("images") or []) + [rel_path])
        now = datetime.utcnow().isoformat()
        meta["images"] = images
        meta["updated_at"] = now
        meta["version"] = now
        meta = self._normalize_theory_meta(
            meta,
            theory_id=theory_id,
            existing=meta,
            fallback_source="legacy_unknown",
            fallback_scope="shared_local",
        )
        self._write_hosted_theory_state(
            theory_id,
            meta=meta,
            delta=content.get("delta") or {"ops": [{"insert": "\n"}]},
            images=images,
            updated_at=now,
        )
        return {"path": rel_path, "version": now}

    def get_history(self, theory_id: str) -> List[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("theories.history.read", exc)
            return TheoryService.get_history(self, theory_id)

        self._ensure_repository_theory_state(theory_id)
        snapshots = self.content_repository.list_history(theory_id)
        items: List[Dict[str, Any]] = []
        for snapshot in snapshots:
            meta = snapshot.get("meta") if isinstance(snapshot, dict) else {}
            if not isinstance(meta, dict):
                meta = {}
            items.append(
                {
                    "_snapshot_timestamp": snapshot.get("_snapshot_timestamp"),
                    "id": meta.get("id", theory_id),
                    "title": meta.get("title", ""),
                    "version": meta.get("version"),
                    "updated_at": meta.get("updated_at"),
                }
            )
        return items

    def restore_from_history(
        self,
        theory_id: str,
        snapshot_timestamp: str,
        *,
        restored_by_user_id: Any = None,
    ) -> Dict[str, Any]:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("theories.history.restore", exc)
            return TheoryService.restore_from_history(
                self,
                theory_id,
                snapshot_timestamp,
                restored_by_user_id=restored_by_user_id,
            )

        meta, content = self._ensure_repository_theory_state(theory_id)
        snapshot = self.content_repository.get_history_snapshot(theory_id, snapshot_timestamp)
        if snapshot is None:
            raise TheoryNotFoundError("snapshot_not_found")

        snapshot_meta = snapshot.get("meta") if isinstance(snapshot, dict) else None
        snapshot_delta = snapshot.get("delta") if isinstance(snapshot, dict) else None
        if not isinstance(snapshot_meta, dict) or snapshot_delta is None:
            raise TheoryValidationError("invalid_snapshot_format")

        self._save_repository_history_snapshot(
            theory_id,
            dict(meta),
            content.get("delta") or {"ops": [{"insert": "\n"}]},
        )

        now = datetime.utcnow().isoformat()
        restored_meta = dict(snapshot_meta)
        restored_meta["id"] = theory_id
        restored_meta["delta_path"] = "body.delta.json"
        restored_meta["images"] = self._sanitize_images_list(restored_meta.get("images"))
        restored_meta["updated_at"] = now
        restored_meta["version"] = now
        if restored_by_user_id is not None:
            restored_meta["updated_by_user_id"] = restored_by_user_id
        restored_meta = self._normalize_theory_meta(
            restored_meta,
            theory_id=theory_id,
            existing=meta,
        )
        restored_delta = self._sanitize_delta(snapshot_delta)
        self._write_hosted_theory_state(
            theory_id,
            meta=restored_meta,
            delta=restored_delta,
            images=restored_meta.get("images") or [],
            updated_at=now,
        )
        return self.get_theory(theory_id, include_delta=True)

    def normalize_theory_image_refs(
        self,
        theory_id: str,
        *,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            if dry_run:
                self._guard_shadow_read_fallback("normalize_theory_image_refs", exc)
            else:
                self._guard_shadow_write_fallback("normalize_theory_image_refs", exc)
            return TheoryService.normalize_theory_image_refs(self, theory_id, dry_run=dry_run)

        meta, content = self._ensure_repository_theory_state(theory_id)
        current_delta = self._sanitize_delta(content.get("delta"))
        normalized_delta, removed_delta_refs, removed_delta_ops = self._prune_missing_delta_images(current_delta)
        normalized_images, removed_meta_images = self._prune_missing_images_list(meta.get("images"))

        changed = (
            removed_delta_ops > 0
            or bool(removed_meta_images)
            or normalized_delta != current_delta
            or normalized_images != list(meta.get("images") or [])
        )
        result: Dict[str, Any] = {
            "theory_id": str(meta.get("id") or theory_id),
            "title": str(meta.get("title") or "").strip(),
            "changed": changed,
            "dry_run": dry_run,
            "removed_delta_image_ops": removed_delta_ops,
            "removed_delta_image_refs": removed_delta_refs,
            "removed_meta_images": removed_meta_images,
        }
        if not changed or dry_run:
            return result

        self._save_repository_history_snapshot(theory_id, dict(meta), current_delta)
        now = datetime.utcnow().isoformat()
        meta["images"] = normalized_images
        meta["updated_at"] = now
        meta["version"] = now
        meta = self._normalize_theory_meta(
            meta,
            theory_id=theory_id,
            existing=meta,
            fallback_source="legacy_unknown",
            fallback_scope="shared_local",
        )
        self._write_hosted_theory_state(
            theory_id,
            meta=meta,
            delta=normalized_delta,
            images=normalized_images,
            updated_at=now,
        )
        result["version"] = now
        return result

    def normalize_theories_image_refs(
        self,
        theory_ids: Optional[List[str]] = None,
        *,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            if dry_run:
                self._guard_shadow_read_fallback("normalize_theories_image_refs", exc)
            else:
                self._guard_shadow_write_fallback("normalize_theories_image_refs", exc)
            return TheoryService.normalize_theories_image_refs(self, theory_ids, dry_run=dry_run)

        if theory_ids is None:
            targets = [
                str(item.get("id") or "").strip()
                for item in self.repository.list_theories()
                if str(item.get("id") or "").strip()
            ]
        else:
            targets = []
            for theory_id in theory_ids:
                normalized = self._normalize_theory_id(theory_id)
                if normalized and normalized not in targets:
                    targets.append(normalized)

        items: List[Dict[str, Any]] = []
        errors: List[Dict[str, str]] = []
        for theory_id in targets:
            try:
                items.append(self.normalize_theory_image_refs(theory_id, dry_run=dry_run))
            except Exception as exc:
                self.logger.exception("Failed to normalize theory image refs for %s: %s", theory_id, exc)
                errors.append({"theory_id": theory_id, "error": str(exc)})

        return {
            "ok": not errors,
            "dry_run": dry_run,
            "theories_scanned": len(targets),
            "theories_changed": sum(1 for item in items if item.get("changed")),
            "removed_delta_image_ops_total": sum(int(item.get("removed_delta_image_ops") or 0) for item in items),
            "removed_delta_image_refs_total": sum(
                len(item.get("removed_delta_image_refs") or []) for item in items
            ),
            "removed_meta_images_total": sum(len(item.get("removed_meta_images") or []) for item in items),
            "items": items,
            "errors": errors,
        }
