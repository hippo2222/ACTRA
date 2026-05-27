"""
Theory Service - CRUD and filesystem storage for rich-text theory notes.

Storage layout:
  data/complexes/theories/<theory_id>/
    theory.json
    body.delta.json
    images/
    history/
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse, unquote

from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

from services.workspace_lineage import (
    build_source_lineage_key,
    clear_source_lineage_fields,
    find_first_by_source_lineage,
    normalize_workspace_lineage_fields,
)

logger = logging.getLogger(__name__)


def _normalize_optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _normalize_theory_ownership_fields(
    payload: Dict[str, Any],
    *,
    fallback_source: str = "legacy_unknown",
    fallback_scope: str = "shared_local",
    existing: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    existing_payload = existing if isinstance(existing, dict) else {}

    created_by_user_id = _normalize_optional_text(payload.get("created_by_user_id"))
    if created_by_user_id is None:
        created_by_user_id = _normalize_optional_text(existing_payload.get("created_by_user_id"))

    updated_by_user_id = _normalize_optional_text(payload.get("updated_by_user_id"))
    if updated_by_user_id is None:
        updated_by_user_id = _normalize_optional_text(existing_payload.get("updated_by_user_id"))
    if updated_by_user_id is None:
        updated_by_user_id = created_by_user_id

    created_via = _normalize_optional_text(payload.get("created_via"))
    if created_via is None:
        created_via = _normalize_optional_text(existing_payload.get("created_via"))
    if created_via is None:
        created_via = fallback_source

    content_scope = _normalize_optional_text(payload.get("content_scope"))
    if content_scope is None:
        content_scope = _normalize_optional_text(existing_payload.get("content_scope"))
    if content_scope is None:
        content_scope = fallback_scope

    payload["created_by_user_id"] = created_by_user_id
    payload["updated_by_user_id"] = updated_by_user_id
    payload["created_via"] = created_via
    payload["content_scope"] = content_scope
    return payload


class TheoryConflictError(Exception):
    """Raised when optimistic-lock version mismatch is detected."""

    def __init__(self, message: str, current_version: str, expected_version: str):
        super().__init__(message)
        self.current_version = current_version
        self.expected_version = expected_version


class TheoryValidationError(Exception):
    """Raised when theory payload is invalid."""


class TheoryNotFoundError(Exception):
    """Raised when requested theory does not exist."""


class TheoryService:
    """Filesystem-backed service for storing theory notes in Delta format."""

    ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
    ALLOWED_DELTA_ATTRIBUTES = {
        "bold",
        "italic",
        "underline",
        "strike",
        "color",
        "background",
        "font",
        "size",
        "align",
        "header",
        "list",
        "link",
        "blockquote",
        "code",
        "width",
        "rotate",
        "float",
        "flip",
    }
    MAX_DELTA_OPS = 20000
    MAX_TOTAL_TEXT = 250000

    def __init__(self, data_dir: str):
        self.data_dir = Path(data_dir)
        self.complexes_dir = self.data_dir / "complexes"
        self.theories_dir = self.complexes_dir / "theories"
        self.theories_dir.mkdir(parents=True, exist_ok=True)

    def _normalize_theory_meta(
        self,
        payload: Dict[str, Any],
        *,
        theory_id: Optional[str] = None,
        existing: Optional[Dict[str, Any]] = None,
        fallback_source: str = "legacy_unknown",
        fallback_scope: str = "shared_local",
    ) -> Dict[str, Any]:
        clean_payload = dict(payload or {})
        resolved_theory_id = str(
            theory_id
            or clean_payload.get("id")
            or (existing or {}).get("id")
            or ""
        ).strip()
        clean_payload = _normalize_theory_ownership_fields(
            clean_payload,
            fallback_source=fallback_source,
            fallback_scope=fallback_scope,
            existing=existing,
        )
        return normalize_workspace_lineage_fields(
            clean_payload,
            entity_kind="theory",
            entity_id=resolved_theory_id or None,
            entity_ref=resolved_theory_id or None,
            existing=existing,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def _summarize_delta(self, theory_dir: Path) -> Dict[str, Any]:
        """Return basic stats about the Delta content (images, text)."""
        summary: Dict[str, Any] = {
            "image_count": 0,
            "text_chars": 0,
            "has_text": False,
            "ops_count": 0,
        }

        delta_path = theory_dir / "body.delta.json"
        if not delta_path.exists():
            return summary

        try:
            delta = self._read_json(delta_path)
            ops = delta.get("ops", []) if isinstance(delta, dict) else []
            summary["ops_count"] = len(ops)
            image_paths = set()

            for op in ops:
                if not isinstance(op, dict):
                    continue
                insert = op.get("insert")
                if isinstance(insert, dict) and "image" in insert:
                    image_path = insert["image"]
                    if self._image_ref_exists(image_path):
                        image_paths.add(image_path)
                    continue
                if isinstance(insert, str):
                    stripped = insert.replace("\n", "").strip()
                    if stripped:
                        summary["text_chars"] += len(stripped)

            summary["image_count"] = len(image_paths)
            summary["has_text"] = summary["text_chars"] > 0
        except Exception:
            # Return whatever we have accumulated so far
            pass

        return summary

    def list_theories(self, query: Optional[str] = None) -> List[Dict[str, Any]]:
        q = (query or "").strip().lower()
        items: List[Dict[str, Any]] = []
        for theory_dir in self.theories_dir.iterdir():
            if not theory_dir.is_dir():
                continue
            meta_path = theory_dir / "theory.json"
            if not meta_path.exists():
                continue
            try:
                meta = self._normalize_theory_meta(
                    self._read_json(meta_path),
                    theory_id=theory_dir.name,
                    fallback_source="legacy_unknown",
                    fallback_scope="shared_local",
                )
            except Exception as exc:  # pragma: no cover - defensive path
                logger.warning("Failed to read theory metadata %s: %s", meta_path, exc)
                continue

            title = str(meta.get("title") or "")
            theory_id = str(meta.get("id") or theory_dir.name)
            if q and q not in title.lower() and q not in theory_id.lower():
                continue

            delta_summary = self._summarize_delta(theory_dir)
            items.append(
                {
                    "id": theory_id,
                    "title": title,
                    "created_at": meta.get("created_at"),
                    "updated_at": meta.get("updated_at"),
                    "version": meta.get("version"),
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

        items.sort(key=lambda x: str(x.get("updated_at") or ""), reverse=True)
        return items

    def create_theory(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise TheoryValidationError("payload_must_be_object")

        theory_id = self._normalize_theory_id(payload.get("id")) or self._generate_theory_id()
        theory_dir = self.theories_dir / theory_id
        if theory_dir.exists():
            raise TheoryValidationError("theory_id_already_exists")

        title = self._normalize_title(payload.get("title"))
        delta = self._sanitize_delta(payload.get("delta"))
        images = self._sanitize_images_list(payload.get("images"))

        theory_dir.mkdir(parents=True, exist_ok=False)
        (theory_dir / "images").mkdir(parents=True, exist_ok=True)
        (theory_dir / "history").mkdir(parents=True, exist_ok=True)

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
        ):
            if payload.get(field_name) is not None:
                meta[field_name] = payload.get(field_name)
        for field_name in (
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

        self._write_json_atomic(theory_dir / "theory.json", meta)
        self._write_json_atomic(theory_dir / "body.delta.json", delta)
        return self.get_theory(theory_id)

    def _reserve_theory_id(
        self,
        preferred_theory_id: Any = None,
        *,
        title: Any = None,
    ) -> str:
        preferred = self._normalize_theory_id(preferred_theory_id)
        if preferred:
            base_id = preferred
        else:
            title_seed = secure_filename(str(title or "").strip().lower().replace(" ", "_"))
            if title_seed:
                base_id = f"th_{title_seed}"
            else:
                base_id = self._generate_theory_id()

        candidate = base_id
        suffix = 1
        while (self.theories_dir / candidate).exists():
            candidate = f"{base_id}_{suffix:02d}"
            suffix += 1
        return candidate

    def ensure_workspace_theory_copy(
        self,
        payload: Dict[str, Any],
        *,
        prefer_existing_by_lineage: bool = True,
    ) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise TheoryValidationError("payload_must_be_object")

        normalized_payload = self._normalize_theory_meta(
            dict(payload),
            fallback_source="workspace_import",
            fallback_scope="workspace_private",
        )
        if prefer_existing_by_lineage and build_source_lineage_key(normalized_payload):
            existing = self.find_theory_by_source_lineage(
                source_catalog_item_id=normalized_payload.get("source_catalog_item_id"),
                source_catalog_version_id=normalized_payload.get("source_catalog_version_id"),
                source_entity_kind=normalized_payload.get("source_entity_kind") or "theory",
                source_entity_id=normalized_payload.get("source_entity_id"),
            )
            if isinstance(existing, dict):
                return {
                    "created": False,
                    "reused": True,
                    "theory_id": existing.get("id"),
                    "item": existing,
                }

        preferred_theory_id = normalized_payload.get("id")
        if not self._normalize_theory_id(preferred_theory_id) or (self.theories_dir / str(preferred_theory_id)).exists():
            normalized_payload["id"] = self._reserve_theory_id(
                preferred_theory_id,
                title=normalized_payload.get("title"),
            )
            normalized_payload = self._normalize_theory_meta(
                normalized_payload,
                theory_id=normalized_payload["id"],
                fallback_source="workspace_import",
                fallback_scope="workspace_private",
            )

        created = self.create_theory(normalized_payload)
        return {
            "created": True,
            "reused": False,
            "theory_id": created.get("id"),
            "item": created,
        }

    def get_theory(self, theory_id: str, include_delta: bool = True) -> Dict[str, Any]:
        theory_dir = self._resolve_theory_dir(theory_id)
        meta_path = theory_dir / "theory.json"
        if not meta_path.exists():
            raise TheoryNotFoundError("theory_not_found")

        meta = self._normalize_theory_meta(
            self._read_json(meta_path),
            theory_id=theory_id,
            fallback_source="legacy_unknown",
            fallback_scope="shared_local",
        )
        item = {
            "id": meta.get("id", theory_id),
            "title": meta.get("title") or "",
            "created_at": meta.get("created_at"),
            "updated_at": meta.get("updated_at"),
            "version": meta.get("version"),
            "images": meta.get("images") or [],
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
            delta_path = theory_dir / str(meta.get("delta_path") or "body.delta.json")
            if delta_path.exists():
                item["delta"] = self._sanitize_delta(self._read_json(delta_path))
            else:
                item["delta"] = {"ops": [{"insert": "\n"}]}
        return item

    def update_theory(
        self,
        theory_id: str,
        updates: Dict[str, Any],
        expected_version: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not isinstance(updates, dict):
            raise TheoryValidationError("payload_must_be_object")

        theory_dir = self._resolve_theory_dir(theory_id)
        meta_path = theory_dir / "theory.json"
        delta_path = theory_dir / "body.delta.json"
        if not meta_path.exists():
            raise TheoryNotFoundError("theory_not_found")

        meta = self._normalize_theory_meta(
            self._read_json(meta_path),
            theory_id=theory_id,
            fallback_source="legacy_unknown",
            fallback_scope="shared_local",
        )
        current_delta = (
            self._read_json(delta_path) if delta_path.exists() else {"ops": [{"insert": "\n"}]}
        )
        current_version = str(meta.get("version") or "")

        if expected_version is not None and current_version != expected_version:
            raise TheoryConflictError(
                "Theory has been modified by another user",
                current_version=current_version,
                expected_version=expected_version,
            )

        self._save_history_snapshot(theory_id, meta, current_delta)

        if "title" in updates:
            meta["title"] = self._normalize_title(updates.get("title"))
        if "images" in updates:
            meta["images"] = self._sanitize_images_list(updates.get("images"))
        if "delta" in updates:
            current_delta = self._sanitize_delta(updates.get("delta"))
        if updates.get("created_by_user_id") is not None:
            meta["created_by_user_id"] = updates.get("created_by_user_id")
        if updates.get("updated_by_user_id") is not None:
            meta["updated_by_user_id"] = updates.get("updated_by_user_id")
        if updates.get("created_via") is not None:
            meta["created_via"] = updates.get("created_via")
        if updates.get("content_scope") is not None:
            meta["content_scope"] = updates.get("content_scope")

        now = datetime.utcnow().isoformat()
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

        self._write_json_atomic(meta_path, meta)
        self._write_json_atomic(delta_path, current_delta)
        return self.get_theory(theory_id)

    def clone_theory(
        self,
        source_theory_id: str,
        title: Optional[str] = None,
        *,
        created_by_user_id: Any = None,
    ) -> Dict[str, Any]:
        source_dir = self._resolve_theory_dir(source_theory_id)
        source_meta_path = source_dir / "theory.json"
        source_delta_path = source_dir / "body.delta.json"
        if not source_meta_path.exists():
            raise TheoryNotFoundError("theory_not_found")

        source_meta = self._normalize_theory_meta(
            self._read_json(source_meta_path),
            theory_id=source_theory_id,
            fallback_source="legacy_unknown",
            fallback_scope="shared_local",
        )
        source_delta_raw = (
            self._read_json(source_delta_path)
            if source_delta_path.exists()
            else {"ops": [{"insert": "\n"}]}
        )
        source_delta = self._sanitize_delta(source_delta_raw)

        if title is None:
            base_title = str(source_meta.get("title") or "").strip() or source_theory_id
            clone_title = self._normalize_title(f"{base_title} (copy)")
        else:
            clone_title = self._normalize_title(title)

        theory_id = self._generate_theory_id()
        theory_dir = self.theories_dir / theory_id
        while theory_dir.exists():
            theory_id = self._generate_theory_id()
            theory_dir = self.theories_dir / theory_id

        theory_dir.mkdir(parents=True, exist_ok=False)
        images_dir = theory_dir / "images"
        images_dir.mkdir(parents=True, exist_ok=True)
        (theory_dir / "history").mkdir(parents=True, exist_ok=True)

        image_refs = self._collect_delta_image_refs(source_delta)
        for ref in self._sanitize_images_list(source_meta.get("images")):
            if ref not in image_refs:
                image_refs.append(ref)

        image_remap = self._clone_image_refs(image_refs, images_dir)
        cloned_delta = self._remap_delta_images(source_delta, image_remap)

        cloned_images: List[str] = []
        for ref in self._sanitize_images_list(source_meta.get("images")):
            mapped = image_remap.get(ref)
            if mapped and mapped not in cloned_images:
                cloned_images.append(mapped)
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

        self._write_json_atomic(theory_dir / "theory.json", cloned_meta)
        self._write_json_atomic(theory_dir / "body.delta.json", cloned_delta)
        return self.get_theory(theory_id)

    def find_theory_by_source_lineage(
        self,
        *,
        source_catalog_item_id: Any = None,
        source_catalog_version_id: Any = None,
        source_entity_kind: Any = "theory",
        source_entity_id: Any = None,
    ) -> Optional[Dict[str, Any]]:
        return find_first_by_source_lineage(
            self.list_theories(),
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_entity_kind=source_entity_kind,
            source_entity_id=source_entity_id,
        )

    def delete_theory(self, theory_id: str) -> Dict[str, Any]:
        theory_dir = self._resolve_theory_dir(theory_id)
        meta_path = theory_dir / "theory.json"
        if not meta_path.exists():
            raise TheoryNotFoundError("theory_not_found")

        meta = self._read_json(meta_path)
        now = datetime.utcnow()
        timestamp = now.strftime("%Y%m%d_%H%M%S_%f")

        shutil.rmtree(str(theory_dir))
        return {
            "id": str(meta.get("id") or theory_id),
            "title": str(meta.get("title") or "").strip(),
            "deleted_at": now.isoformat(),
        }

    def add_image(self, theory_id: str, upload: FileStorage) -> Dict[str, Any]:
        if upload is None:
            raise TheoryValidationError("file_required")
        if not upload.filename:
            raise TheoryValidationError("file_name_required")

        theory_dir = self._resolve_theory_dir(theory_id)
        meta_path = theory_dir / "theory.json"
        if not meta_path.exists():
            raise TheoryNotFoundError("theory_not_found")

        filename = secure_filename(upload.filename)
        if not filename:
            raise TheoryValidationError("invalid_file_name")
        ext = Path(filename).suffix.lower()
        if ext not in self.ALLOWED_IMAGE_EXTENSIONS:
            raise TheoryValidationError("unsupported_image_format")

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

        meta = self._normalize_theory_meta(
            self._read_json(meta_path),
            theory_id=theory_id,
            fallback_source="legacy_unknown",
            fallback_scope="shared_local",
        )
        images = list(meta.get("images") or [])
        if rel_path not in images:
            images.append(rel_path)
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
        self._write_json_atomic(meta_path, meta)

        return {"path": rel_path, "version": now}

    def get_history(self, theory_id: str) -> List[Dict[str, Any]]:
        theory_dir = self._resolve_theory_dir(theory_id)
        history_dir = theory_dir / "history"
        if not history_dir.exists():
            return []

        snapshots: List[Dict[str, Any]] = []
        for path in sorted(history_dir.glob("*.json"), reverse=True):
            try:
                data = self._read_json(path)
            except Exception as exc:  # pragma: no cover - defensive path
                logger.warning("Failed to read theory snapshot %s: %s", path, exc)
                continue

            meta = data.get("meta") if isinstance(data, dict) else {}
            snapshots.append(
                {
                    "_snapshot_timestamp": path.stem,
                    "id": meta.get("id", theory_id),
                    "title": meta.get("title", ""),
                    "version": meta.get("version"),
                    "updated_at": meta.get("updated_at"),
                }
            )
        return snapshots

    def restore_from_history(
        self,
        theory_id: str,
        snapshot_timestamp: str,
        *,
        restored_by_user_id: Any = None,
    ) -> Dict[str, Any]:
        theory_dir = self._resolve_theory_dir(theory_id)
        history_file = theory_dir / "history" / f"{snapshot_timestamp}.json"
        if not history_file.exists():
            raise TheoryNotFoundError("snapshot_not_found")

        meta_path = theory_dir / "theory.json"
        delta_path = theory_dir / "body.delta.json"
        if not meta_path.exists():
            raise TheoryNotFoundError("theory_not_found")

        current_meta = self._normalize_theory_meta(
            self._read_json(meta_path),
            theory_id=theory_id,
            fallback_source="legacy_unknown",
            fallback_scope="shared_local",
        )
        current_delta = (
            self._read_json(delta_path) if delta_path.exists() else {"ops": [{"insert": "\n"}]}
        )
        self._save_history_snapshot(theory_id, current_meta, current_delta)

        snapshot = self._read_json(history_file)
        snapshot_meta = snapshot.get("meta") if isinstance(snapshot, dict) else None
        snapshot_delta = snapshot.get("delta") if isinstance(snapshot, dict) else None
        if not isinstance(snapshot_meta, dict) or snapshot_delta is None:
            raise TheoryValidationError("invalid_snapshot_format")

        restored_meta = dict(snapshot_meta)
        restored_meta["id"] = theory_id
        restored_meta["delta_path"] = "body.delta.json"
        now = datetime.utcnow().isoformat()
        restored_meta["updated_at"] = now
        restored_meta["version"] = now
        normalized_restored_by_user_id = _normalize_optional_text(restored_by_user_id)
        if normalized_restored_by_user_id is not None:
            restored_meta["updated_by_user_id"] = normalized_restored_by_user_id
        restored_meta = self._normalize_theory_meta(
            restored_meta,
            theory_id=theory_id,
            existing=current_meta,
            fallback_source="legacy_unknown",
            fallback_scope="shared_local",
        )

        restored_delta = self._sanitize_delta(snapshot_delta)
        self._write_json_atomic(meta_path, restored_meta)
        self._write_json_atomic(delta_path, restored_delta)
        return self.get_theory(theory_id)

    def normalize_theory_image_refs(
        self,
        theory_id: str,
        *,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        """Remove broken image references from one theory."""
        theory_dir = self._resolve_theory_dir(theory_id)
        meta_path = theory_dir / "theory.json"
        delta_path = theory_dir / "body.delta.json"
        if not meta_path.exists():
            raise TheoryNotFoundError("theory_not_found")

        meta = self._normalize_theory_meta(
            self._read_json(meta_path),
            theory_id=theory_id,
            fallback_source="legacy_unknown",
            fallback_scope="shared_local",
        )
        current_delta = (
            self._read_json(delta_path) if delta_path.exists() else {"ops": [{"insert": "\n"}]}
        )
        normalized_delta, removed_delta_refs, removed_delta_ops = self._prune_missing_delta_images(
            current_delta
        )
        normalized_images, removed_meta_images = self._prune_missing_images_list(
            meta.get("images")
        )

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

        self._save_history_snapshot(theory_id, meta, current_delta)

        now = datetime.utcnow().isoformat()
        meta["id"] = meta.get("id") or theory_id
        meta["delta_path"] = "body.delta.json"
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

        self._write_json_atomic(meta_path, meta)
        self._write_json_atomic(delta_path, normalized_delta)

        result["version"] = now
        return result

    def normalize_theories_image_refs(
        self,
        theory_ids: Optional[List[str]] = None,
        *,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        """Normalize broken image references across selected or all theories."""
        if theory_ids is None:
            targets = sorted(
                theory_dir.name
                for theory_dir in self.theories_dir.iterdir()
                if theory_dir.is_dir() and (theory_dir / "theory.json").exists()
            )
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
                logger.exception("Failed to normalize theory image refs for %s: %s", theory_id, exc)
                errors.append({"theory_id": theory_id, "error": str(exc)})

        return {
            "ok": not errors,
            "dry_run": dry_run,
            "theories_scanned": len(targets),
            "theories_changed": sum(1 for item in items if item.get("changed")),
            "removed_delta_image_ops_total": sum(
                int(item.get("removed_delta_image_ops") or 0) for item in items
            ),
            "removed_delta_image_refs_total": sum(
                len(item.get("removed_delta_image_refs") or []) for item in items
            ),
            "removed_meta_images_total": sum(
                len(item.get("removed_meta_images") or []) for item in items
            ),
            "items": items,
            "errors": errors,
        }

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _generate_theory_id(self) -> str:
        return f"th_{uuid.uuid4().hex[:12]}"

    def _normalize_theory_id(self, value: Any) -> Optional[str]:
        if not isinstance(value, str):
            return None
        candidate = value.strip()
        if not candidate:
            return None
        if "/" in candidate or "\\" in candidate or ".." in candidate:
            raise TheoryValidationError("invalid_theory_id")
        return candidate

    def _normalize_title(self, value: Any) -> str:
        if value is None:
            return ""
        if not isinstance(value, str):
            raise TheoryValidationError("title_must_be_string")
        return value.strip()

    def _resolve_theory_dir(self, theory_id: str) -> Path:
        normalized = self._normalize_theory_id(theory_id)
        if not normalized:
            raise TheoryValidationError("theory_id_required")
        theory_dir = (self.theories_dir / normalized).resolve()
        try:
            theory_dir.relative_to(self.theories_dir.resolve())
        except ValueError as exc:
            raise TheoryValidationError("invalid_theory_id") from exc
        return theory_dir

    def _sanitize_delta(self, raw_delta: Any) -> Dict[str, Any]:
        if raw_delta is None:
            return {"ops": [{"insert": "\n"}]}
        if not isinstance(raw_delta, dict):
            raise TheoryValidationError("delta_must_be_object")
        ops = raw_delta.get("ops")
        if not isinstance(ops, list):
            raise TheoryValidationError("delta_ops_must_be_array")
        if len(ops) > self.MAX_DELTA_OPS:
            raise TheoryValidationError("delta_too_large")

        clean_ops: List[Dict[str, Any]] = []
        total_text = 0

        for op in ops:
            if not isinstance(op, dict) or "insert" not in op:
                continue
            insert = op.get("insert")
            clean_insert: Any

            if isinstance(insert, str):
                clean_insert = insert.replace("\r\n", "\n").replace("\r", "\n")
                total_text += len(clean_insert)
            elif isinstance(insert, dict):
                image_ref = insert.get("image")
                if not isinstance(image_ref, str):
                    continue
                sanitized_image = self._sanitize_image_ref(image_ref)
                if not sanitized_image:
                    continue
                clean_insert = {"image": sanitized_image}
            else:
                continue

            attributes = op.get("attributes")
            clean_op: Dict[str, Any] = {"insert": clean_insert}
            if isinstance(attributes, dict):
                clean_attrs = self._sanitize_attributes(attributes)
                if clean_attrs:
                    clean_op["attributes"] = clean_attrs
            clean_ops.append(clean_op)

        if total_text > self.MAX_TOTAL_TEXT:
            raise TheoryValidationError("delta_text_too_large")

        if not clean_ops:
            clean_ops = [{"insert": "\n"}]
        return {"ops": clean_ops}

    def _sanitize_attributes(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        clean: Dict[str, Any] = {}
        for key, value in attrs.items():
            if key not in self.ALLOWED_DELTA_ATTRIBUTES:
                continue
            if isinstance(value, (bool, int, float, str)):
                if key == "link" and isinstance(value, str):
                    vv = value.strip()
                    lower = vv.lower()
                    if lower.startswith("javascript:") or lower.startswith("data:"):
                        continue
                    clean[key] = vv
                elif key in {"list"} and isinstance(value, str):
                    if value in {"ordered", "bullet", "check"}:
                        clean[key] = value
                elif key in {"align"} and isinstance(value, str):
                    if value in {"left", "center", "right", "justify"}:
                        clean[key] = value
                else:
                    clean[key] = value
        return clean

    def _sanitize_image_ref(self, raw_value: str) -> Optional[str]:
        value = raw_value.strip()
        if not value:
            return None

        lower = value.lower()
        if lower.startswith("javascript:") or lower.startswith("data:"):
            return None

        if value.startswith("/api/assets/"):
            return value

        # Quill image URLs can arrive as /api/local-image?path=<relative>
        # or /api/local-image?asset_id=<id>; normalize hosted refs to the
        # canonical asset content route.
        if value.startswith("/api/local-image?"):
            parsed = urlparse(value)
            params = parse_qs(parsed.query)
            asset_values = params.get("asset_id") or []
            if asset_values:
                asset_id = unquote(asset_values[0]).strip()
                if not asset_id or ".." in asset_id.split("/"):
                    return None
                return f"/api/assets/{asset_id}/content"
            path_values = params.get("path") or []
            if not path_values:
                return None
            value = unquote(path_values[0]).strip()

        # Store only relative paths under data dir.
        value = value.replace("\\", "/")
        if value.startswith("/"):
            value = value.lstrip("/")
        if not value or ".." in value.split("/"):
            return None
        return value

    def _sanitize_images_list(self, raw_images: Any) -> List[str]:
        if raw_images is None:
            return []
        if not isinstance(raw_images, list):
            raise TheoryValidationError("images_must_be_array")
        clean: List[str] = []
        for item in raw_images:
            if not isinstance(item, str):
                continue
            sanitized = self._sanitize_image_ref(item)
            if sanitized and sanitized not in clean:
                clean.append(sanitized)
        return clean

    def _image_ref_exists(self, raw_value: Any) -> bool:
        if not isinstance(raw_value, str):
            return False
        sanitized = self._sanitize_image_ref(raw_value)
        if not sanitized:
            return False
        if sanitized.startswith("/api/assets/"):
            return True
        try:
            target = (self.data_dir / sanitized).resolve()
            target.relative_to(self.data_dir.resolve())
        except ValueError:
            return False
        return target.exists() and target.is_file()

    def _prune_missing_images_list(self, raw_images: Any) -> tuple[List[str], List[str]]:
        clean_images = self._sanitize_images_list(raw_images)
        kept: List[str] = []
        removed: List[str] = []
        for image_ref in clean_images:
            if self._image_ref_exists(image_ref):
                kept.append(image_ref)
            elif image_ref not in removed:
                removed.append(image_ref)
        return kept, removed

    def _prune_missing_delta_images(
        self, raw_delta: Any
    ) -> tuple[Dict[str, Any], List[str], int]:
        delta = self._sanitize_delta(raw_delta)
        clean_ops: List[Dict[str, Any]] = []
        removed_refs: List[str] = []
        removed_ops = 0

        for op in delta.get("ops", []):
            if not isinstance(op, dict) or "insert" not in op:
                continue
            insert = op.get("insert")
            if isinstance(insert, dict):
                image_ref = insert.get("image")
                if isinstance(image_ref, str):
                    sanitized = self._sanitize_image_ref(image_ref)
                    if sanitized and not self._image_ref_exists(sanitized):
                        removed_ops += 1
                        if sanitized not in removed_refs:
                            removed_refs.append(sanitized)
                        continue
            clean_ops.append(op)

        if not clean_ops:
            clean_ops = [{"insert": "\n"}]
        return self._sanitize_delta({"ops": clean_ops}), removed_refs, removed_ops

    def _save_history_snapshot(
        self, theory_id: str, meta: Dict[str, Any], delta: Dict[str, Any]
    ) -> None:
        theory_dir = self._resolve_theory_dir(theory_id)
        history_dir = theory_dir / "history"
        history_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
        snapshot_path = history_dir / f"{timestamp}.json"
        payload = {"meta": meta, "delta": delta}
        self._write_json_atomic(snapshot_path, payload)

        snapshots = sorted(history_dir.glob("*.json"))
        if len(snapshots) > 25:
            for old in snapshots[:-25]:
                try:
                    old.unlink()
                except Exception:
                    logger.debug("Failed to prune old theory snapshot: %s", old, exc_info=True)

    def _collect_delta_image_refs(self, delta: Dict[str, Any]) -> List[str]:
        refs: List[str] = []
        for op in delta.get("ops", []):
            if not isinstance(op, dict):
                continue
            insert = op.get("insert")
            if not isinstance(insert, dict):
                continue
            image_ref = insert.get("image")
            if not isinstance(image_ref, str):
                continue
            sanitized = self._sanitize_image_ref(image_ref)
            if sanitized and sanitized not in refs:
                refs.append(sanitized)
        return refs

    def _clone_image_refs(self, image_refs: List[str], target_images_dir: Path) -> Dict[str, str]:
        mapping: Dict[str, str] = {}
        data_root = self.data_dir.resolve()
        for raw_ref in image_refs:
            sanitized = self._sanitize_image_ref(raw_ref)
            if not sanitized or sanitized in mapping:
                continue

            source = (self.data_dir / sanitized).resolve()
            try:
                source.relative_to(data_root)
            except ValueError:
                continue
            if not source.exists() or not source.is_file():
                continue

            safe_name = secure_filename(source.name) or f"image_{uuid.uuid4().hex[:8]}"
            stem = Path(safe_name).stem or "image"
            suffix = Path(safe_name).suffix
            target = target_images_dir / safe_name
            counter = 1
            while target.exists():
                target = target_images_dir / f"{stem}_{counter:02d}{suffix}"
                counter += 1

            shutil.copy2(source, target)
            mapping[sanitized] = target.relative_to(self.data_dir).as_posix()
        return mapping

    def _remap_delta_images(
        self, delta: Dict[str, Any], image_remap: Dict[str, str]
    ) -> Dict[str, Any]:
        remapped_ops: List[Dict[str, Any]] = []
        for op in delta.get("ops", []):
            if not isinstance(op, dict) or "insert" not in op:
                continue
            cloned_op = dict(op)
            insert = op.get("insert")
            if isinstance(insert, dict):
                image_ref = insert.get("image")
                if isinstance(image_ref, str):
                    sanitized = self._sanitize_image_ref(image_ref)
                    if sanitized:
                        cloned_op["insert"] = {"image": image_remap.get(sanitized, sanitized)}
            remapped_ops.append(cloned_op)
        return self._sanitize_delta({"ops": remapped_ops})

    def _read_json(self, path: Path) -> Dict[str, Any]:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _write_json_atomic(self, path: Path, payload: Dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_name = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                dir=str(path.parent),
                encoding="utf-8",
                delete=False,
                suffix=".tmp",
            ) as tf:
                json.dump(payload, tf, ensure_ascii=False, indent=2)
                temp_name = tf.name
            os.replace(temp_name, path)
        finally:
            if temp_name and os.path.exists(temp_name):
                try:
                    os.remove(temp_name)
                except Exception:
                    pass
