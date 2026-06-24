from __future__ import annotations

import copy
import json
import logging
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from persistence.postgres import PostgresUnavailableError
from persistence.hosted_task_content_repository import HostedTaskContentRepository
from persistence.hosted_workspace_catalog_repository import HostedWorkspaceCatalogRepository
from persistence.runtime import PersistenceRuntimeSettings
from services.hosted_shadow_fallback import HostedShadowFallbackMixin
from services.storage_service import StorageService


class HostedStorageService(HostedShadowFallbackMixin, StorageService):
    """Hosted storage service for modules/topics/tasks with Postgres-backed metadata and task blobs."""

    def __init__(self, data_dir: str, persistence_settings: PersistenceRuntimeSettings, strict_validation: bool = False):
        super().__init__(data_dir=data_dir, strict_validation=strict_validation)
        self.persistence_settings = persistence_settings
        self.repository = HostedWorkspaceCatalogRepository(self.persistence_settings.postgres_dsn)
        self.content_repository = HostedTaskContentRepository(self.persistence_settings.postgres_dsn)
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
        self._modules_cache = None
        self._modules_cache_timestamp = 0

    def _bootstrap_from_shadow_if_empty(self) -> None:
        if self.repository.count_catalogs() > 0:
            return
        shadow_catalog = self._load_catalog_from_shadow()
        self.repository.import_catalog_if_absent(shadow_catalog)

    def _load_catalog_from_shadow(self) -> List[Dict[str, Any]]:
        self._modules_cache = None
        self._modules_cache_timestamp = 0
        return StorageService.load_modules(self)

    def _iter_catalog_task_refs(
        self,
        modules: Optional[List[Dict[str, Any]]] = None,
    ) -> List[Tuple[str, str, str]]:
        refs: List[Tuple[str, str, str]] = []
        for module in modules or self.repository.load_catalog():
            if not isinstance(module, dict):
                continue
            module_id = str(module.get("id") or "").strip()
            if not module_id:
                continue
            for topic in module.get("topics") or []:
                if not isinstance(topic, dict):
                    continue
                topic_id = str(topic.get("id") or "").strip()
                if not topic_id:
                    continue
                for task in topic.get("tasks") or []:
                    if not isinstance(task, dict):
                        continue
                    task_id = str(task.get("id") or "").strip()
                    if not task_id:
                        continue
                    refs.append((module_id, topic_id, task_id))
        return refs

    def _bootstrap_task_content_from_shadow(self) -> None:
        for module_id, topic_id, task_id in self._iter_catalog_task_refs():
            try:
                self._sync_task_content_from_shadow(
                    module_id,
                    topic_id,
                    task_id,
                    import_only=True,
                )
            except Exception as exc:
                self.logger.warning(
                    "[HOSTED] Failed to bootstrap task shadow %s/%s/%s into Postgres: %s",
                    module_id,
                    topic_id,
                    task_id,
                    exc,
                )

    def _replace_catalog(self, modules: List[Dict[str, Any]]) -> None:
        self.repository.replace_catalog(modules)
        self._modules_cache = None
        self._modules_cache_timestamp = 0

    def _sync_catalog_from_shadow(self) -> None:
        shadow_catalog = self._load_catalog_from_shadow()
        self.repository.replace_catalog(shadow_catalog)
        self._modules_cache = shadow_catalog
        self._modules_cache_timestamp = 0

    def _resolve_task_metadata(
        self,
        module_id: str,
        topic_id: str,
        task_id: str,
    ) -> Optional[Dict[str, Any]]:
        for item in self.get_tasks(module_id, topic_id):
            if not isinstance(item, dict):
                continue
            if str(item.get("id") or "").strip() == str(task_id or "").strip():
                return dict(item)
        return None

    def _resolve_task_dir_path(
        self,
        module_id: str,
        topic_id: str,
        task_id: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Path:
        payload = metadata if isinstance(metadata, dict) else {}
        path_value = payload.get("path")
        if path_value:
            try:
                return self._resolve_task_path(str(path_value)).parent
            except Exception:
                pass
        return self.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id

    def _ensure_route_context(
        self,
        module_id: str,
        topic_id: str,
        task_id: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            return payload

        metadata_obj = payload.get("metadata")
        if not isinstance(metadata_obj, dict):
            metadata_obj = {}
            payload["metadata"] = metadata_obj
        if not metadata_obj.get("id"):
            metadata_obj["id"] = task_id
        if not metadata_obj.get("module"):
            metadata_obj["module"] = module_id
        if not metadata_obj.get("topic"):
            metadata_obj["topic"] = topic_id

        task_data_obj = payload.get("task_data")
        if isinstance(task_data_obj, dict):
            meta_obj = task_data_obj.get("meta")
            if not isinstance(meta_obj, dict):
                meta_obj = {}
                task_data_obj["meta"] = meta_obj
            if not meta_obj.get("id"):
                meta_obj["id"] = task_id
            if not meta_obj.get("module"):
                meta_obj["module"] = module_id
            if not meta_obj.get("topic"):
                meta_obj["topic"] = topic_id
            if task_data_obj.get("name") and not meta_obj.get("name"):
                meta_obj["name"] = task_data_obj.get("name")

        return payload

    def _task_updated_at(self, task_data: Dict[str, Any], task_id: str) -> str:
        meta = task_data.get("meta") if isinstance(task_data, dict) else {}
        if not isinstance(meta, dict):
            meta = {}
        return str(
            meta.get("modified")
            or meta.get("updated_at")
            or meta.get("created_at")
            or meta.get("created")
            or datetime.now(timezone.utc).isoformat()
            or task_id
        )

    def _sync_task_content_from_shadow(
        self,
        module_id: str,
        topic_id: str,
        task_id: str,
        *,
        import_only: bool = False,
    ) -> Optional[Dict[str, Any]]:
        shadow_payload = StorageService.load_task(self, module_id, topic_id, task_id)
        if not shadow_payload:
            return None

        task_data = shadow_payload.get("task_data")
        answer_key = shadow_payload.get("answer_key")
        clean_task_data = copy.deepcopy(task_data) if isinstance(task_data, dict) else {}
        clean_answer_key = copy.deepcopy(answer_key) if isinstance(answer_key, dict) else {}
        updated_at = self._task_updated_at(clean_task_data, task_id)

        if import_only:
            self.content_repository.import_task_content_if_absent(
                module_id,
                topic_id,
                task_id,
                task_data=clean_task_data,
                answer_key=clean_answer_key,
                updated_at=updated_at,
            )
        else:
            self.content_repository.upsert_task_content(
                module_id,
                topic_id,
                task_id,
                task_data=clean_task_data,
                answer_key=clean_answer_key,
                updated_at=updated_at,
            )
        return shadow_payload

    def _build_task_payload_from_repository(
        self,
        module_id: str,
        topic_id: str,
        task_id: str,
        content_row: Dict[str, Any],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        task_data = copy.deepcopy(content_row.get("task_data") or {})
        answer_key = copy.deepcopy(content_row.get("answer_key") or {})
        if isinstance(task_data, dict) and isinstance(answer_key, dict):
            answer_key = self._normalize_answer_key(task_data, answer_key)

        resolved_metadata = dict(metadata) if isinstance(metadata, dict) else {"id": task_id}
        if not resolved_metadata.get("name") and isinstance(task_data, dict):
            meta = task_data.get("meta")
            if isinstance(meta, dict) and meta.get("name"):
                resolved_metadata["name"] = meta.get("name")
        task_dir = self._resolve_task_dir_path(module_id, topic_id, task_id, resolved_metadata)

        payload = {
            "task_data": task_data,
            "answer_key": answer_key,
            "metadata": resolved_metadata,
            "task_dir": str(task_dir),
        }
        payload = self._ensure_route_context(module_id, topic_id, task_id, payload)
        return self._convert_datetime_to_str(payload)

    def _prune_task_content_to_catalog(self) -> None:
        catalog_refs: Set[Tuple[str, str, str]] = set(self._iter_catalog_task_refs())
        existing_refs: Set[Tuple[str, str, str]] = set(self.content_repository.list_task_refs())
        for module_id, topic_id, task_id in sorted(existing_refs - catalog_refs):
            self.content_repository.delete_task_content(module_id, topic_id, task_id)

    def load_modules(self) -> List[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._log_shadow_read_fallback("load_modules", exc)
            return StorageService.load_modules(self)
        if self._modules_cache is not None:
            return self._modules_cache
        modules = self.repository.load_catalog()
        self._modules_cache = modules
        self._modules_cache_timestamp = 0
        return modules

    def reload_modules(self) -> None:
        self._modules_cache = None
        self._modules_cache_timestamp = 0
        self.load_modules()
        self.logger.info("Hosted workspace catalog reloaded")

    def load_task(self, module_id: str, topic_id: str, task_id: str) -> Optional[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._log_shadow_read_fallback("load_task", exc)
            return StorageService.load_task(self, module_id, topic_id, task_id)
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")
        self._validate_id(task_id, "task_id")

        metadata = self._resolve_task_metadata(module_id, topic_id, task_id)
        content_row = self.content_repository.get_task_content(module_id, topic_id, task_id)
        if content_row is None:
            shadow_payload = self._sync_task_content_from_shadow(
                module_id,
                topic_id,
                task_id,
                import_only=True,
            )
            if shadow_payload is not None and metadata is None:
                raw_metadata = shadow_payload.get("metadata")
                if isinstance(raw_metadata, dict):
                    metadata = dict(raw_metadata)
            content_row = self.content_repository.get_task_content(module_id, topic_id, task_id)

        if content_row is not None:
            return self._build_task_payload_from_repository(
                module_id,
                topic_id,
                task_id,
                content_row,
                metadata=metadata,
            )

        return StorageService.load_task(self, module_id, topic_id, task_id)

    def create_module(
        self,
        module_id: str,
        name: str,
        workspace_meta: Optional[Dict[str, Any]] = None,
    ) -> bool:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("create_module", exc)
            return StorageService.create_module(
                self,
                module_id,
                name,
                workspace_meta=workspace_meta,
            )
        self._validate_id(module_id, "module_id")
        clean_name = str(name or "").strip()
        if not clean_name:
            return False
        # Check existence in Postgres catalog (source of truth)
        current_catalog = self.repository.load_catalog()
        if any(isinstance(m, dict) and m.get("id") == module_id for m in current_catalog):
            self.logger.warning("[HOSTED] Module already exists in catalog: %s", module_id)
            return False
        payload: Dict[str, Any] = {"id": module_id, "name": clean_name, "topics": []}
        payload = self._apply_workspace_meta_fields(payload, workspace_meta)
        payload = self._normalize_module_payload(payload)
        # Best-effort: write shadow files
        module_dir = self.modules_dir / module_id
        try:
            module_dir.mkdir(parents=True, exist_ok=True)
            self._atomic_json_dump(module_dir / "module.json", payload)
        except Exception as exc:
            self.logger.warning("[HOSTED] Failed to write shadow for module %s: %s", module_id, exc)
        # Write to Postgres catalog directly
        try:
            new_catalog = list(current_catalog) + [payload]
            self.repository.replace_catalog(new_catalog)
            self._modules_cache = None
            self.logger.info("[HOSTED] Module added to catalog: %s", module_id)
            return True
        except Exception as exc:
            self.logger.exception("[HOSTED] Failed to add module %s to catalog: %s", module_id, exc)
            return False

    def create_topic(
        self,
        module_id: str,
        topic_id: str,
        name: str,
        theory_link: Optional[Dict[str, Any]] = None,
        workspace_meta: Optional[Dict[str, Any]] = None,
    ) -> bool:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("create_topic", exc)
            return StorageService.create_topic(
                self,
                module_id,
                topic_id,
                name,
                theory_link=theory_link,
                workspace_meta=workspace_meta,
            )
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")
        clean_name = str(name or "").strip()
        if not clean_name:
            return False
        # Check existence in Postgres catalog (source of truth — not filesystem)
        current_catalog = self.repository.load_catalog()
        module_entry = next(
            (m for m in current_catalog if isinstance(m, dict) and m.get("id") == module_id), None
        )
        if module_entry is None:
            self.logger.warning("[HOSTED] Cannot create topic: module not found in catalog: %s", module_id)
            return False
        existing_topics = module_entry.get("topics") or []
        if any(isinstance(t, dict) and t.get("id") == topic_id for t in existing_topics):
            self.logger.warning("[HOSTED] Topic already exists in catalog: %s/%s", module_id, topic_id)
            return False
        payload: Dict[str, Any] = {"id": topic_id, "name": clean_name, "tasks": []}
        if isinstance(theory_link, dict):
            payload["theory_link"] = dict(theory_link)
        payload = self._apply_workspace_meta_fields(payload, workspace_meta)
        payload = self._normalize_topic_payload(module_id, payload)
        # Best-effort: write shadow files
        topic_dir = self.modules_dir / module_id / "topics" / topic_id
        try:
            (topic_dir / "tasks").mkdir(parents=True, exist_ok=True)
            self._atomic_json_dump(topic_dir / "topic.json", payload)
        except Exception as exc:
            self.logger.warning("[HOSTED] Failed to write shadow for topic %s/%s: %s", module_id, topic_id, exc)
        # Update Postgres catalog directly
        try:
            new_catalog = []
            for module in current_catalog:
                if not isinstance(module, dict) or module.get("id") != module_id:
                    new_catalog.append(module)
                    continue
                module = dict(module)
                topics = list(module.get("topics") or [])
                topics.append(payload)
                module["topics"] = topics
                new_catalog.append(module)
            self.repository.replace_catalog(new_catalog)
            self._modules_cache = None
            self.logger.info("[HOSTED] Topic added to catalog: %s/%s", module_id, topic_id)
            return True
        except Exception as exc:
            self.logger.exception("[HOSTED] Failed to add topic %s/%s to catalog: %s", module_id, topic_id, exc)
            return False

    def save_task(
        self,
        module_id: str,
        topic_id: str,
        task_id: str,
        task_data: Dict[str, Any],
        validate: bool = True,
    ) -> bool:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("save_task", exc)
            return StorageService.save_task(
                self,
                module_id,
                topic_id,
                task_id,
                task_data,
                validate=validate,
            )
        success = super().save_task(module_id, topic_id, task_id, task_data, validate=validate)
        if not success:
            return False
        try:
            self._sync_catalog_from_shadow()
            synced = self._sync_task_content_from_shadow(module_id, topic_id, task_id, import_only=False)
            if synced is None:
                raise RuntimeError("task_shadow_sync_missing_after_save")
            return True
        except Exception as exc:
            self.logger.exception(
                "[HOSTED] Failed to sync task content after save %s/%s/%s: %s",
                module_id,
                topic_id,
                task_id,
                exc,
            )
            return False

    def _create_task_internal(
        self,
        module_id: str,
        topic_id: str,
        task_name: str,
        task_type: str,
        preferred_task_id: Optional[str] = None,
        workspace_meta: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("_create_task_internal", exc)
            return StorageService.create_task(
                self,
                module_id,
                topic_id,
                task_name,
                task_type,
                preferred_task_id=preferred_task_id,
                workspace_meta=workspace_meta,
            )
        task_id = super().create_task(
            module_id,
            topic_id,
            task_name,
            task_type,
            preferred_task_id=preferred_task_id,
            workspace_meta=workspace_meta,
        )
        if not task_id:
            return None
        try:
            self._sync_catalog_from_shadow()
            synced = self._sync_task_content_from_shadow(module_id, topic_id, task_id, import_only=False)
            if synced is None:
                raise RuntimeError("task_shadow_sync_missing_after_create")
            return task_id
        except Exception as exc:
            self.logger.exception(
                "[HOSTED] Failed to sync task content after create %s/%s/%s: %s",
                module_id,
                topic_id,
                task_id,
                exc,
            )
            return None

    def create_task(
        self,
        module_id: str,
        topic_id: str,
        task_name: str,
        task_type: str,
        preferred_task_id: Optional[str] = None,
        workspace_meta: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        return self._create_task_internal(
            module_id,
            topic_id,
            task_name,
            task_type,
            preferred_task_id=preferred_task_id,
            workspace_meta=workspace_meta,
        )

    def delete_task(self, module_id: str, topic_id: str, task_id: str) -> bool:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("delete_task", exc)
            return StorageService.delete_task(self, module_id, topic_id, task_id)
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")
        self._validate_id(task_id, "task_id")
        # Build new catalog without the target task, check existence
        current_catalog = self.repository.load_catalog()
        task_exists_in_catalog = False
        new_catalog = []
        for module in current_catalog:
            if not isinstance(module, dict) or module.get("id") != module_id:
                new_catalog.append(module)
                continue
            module = dict(module)
            new_topics = []
            for topic in module.get("topics") or []:
                if not isinstance(topic, dict) or topic.get("id") != topic_id:
                    new_topics.append(topic)
                    continue
                topic = dict(topic)
                tasks = topic.get("tasks") or []
                new_tasks = [t for t in tasks if not (isinstance(t, dict) and t.get("id") == task_id)]
                if len(new_tasks) < len(tasks):
                    task_exists_in_catalog = True
                topic["tasks"] = new_tasks
                new_topics.append(topic)
            module["topics"] = new_topics
            new_catalog.append(module)
        # Best-effort: delete shadow folder
        task_dir = self.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
        if task_dir.exists():
            try:
                shutil.rmtree(task_dir)
                self.logger.info("[HOSTED] Shadow task directory deleted: %s/%s/%s", module_id, topic_id, task_id)
            except Exception as exc:
                self.logger.warning(
                    "[HOSTED] Failed to remove shadow task dir %s/%s/%s: %s", module_id, topic_id, task_id, exc
                )
        if not task_exists_in_catalog:
            self.logger.warning("[HOSTED] Task delete: not found in catalog %s/%s/%s", module_id, topic_id, task_id)
            return False
        try:
            self.content_repository.delete_task_content(module_id, topic_id, task_id)
            self.repository.replace_catalog(new_catalog)
            self._modules_cache = None
            self.logger.info("[HOSTED] Task deleted from catalog: %s/%s/%s", module_id, topic_id, task_id)
            return True
        except Exception as exc:
            self.logger.exception(
                "[HOSTED] Failed to delete task %s/%s/%s from catalog: %s",
                module_id, topic_id, task_id, exc,
            )
            return False

    def delete_module(self, module_id: str) -> bool:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("delete_module", exc)
            return StorageService.delete_module(self, module_id)
        self._validate_id(module_id, "module_id")
        # Check existence in Postgres catalog (source of truth in hosted mode)
        current_catalog = self.repository.load_catalog()
        module_exists_in_catalog = any(
            isinstance(m, dict) and m.get("id") == module_id
            for m in current_catalog
        )
        # Also try to remove shadow directory if it exists (best effort)
        module_dir = self.modules_dir / module_id
        if module_dir.exists():
            try:
                shutil.rmtree(module_dir)
                self.logger.info("[HOSTED] Shadow module directory deleted: %s", module_id)
            except Exception as exc:
                self.logger.warning("[HOSTED] Failed to remove shadow module dir %s: %s", module_id, exc)
        if not module_exists_in_catalog:
            self.logger.warning("[HOSTED] Module delete requested but not found in catalog: %s", module_id)
            return False
        try:
            # Remove from Postgres catalog directly
            new_catalog = [m for m in current_catalog if not (isinstance(m, dict) and m.get("id") == module_id)]
            self.repository.replace_catalog(new_catalog)
            self._modules_cache = None
            self._prune_task_content_to_catalog()
            self.logger.info("[HOSTED] Module deleted from catalog: %s", module_id)
            return True
        except Exception as exc:
            self.logger.exception("[HOSTED] Failed to delete module %s from catalog: %s", module_id, exc)
            return False

    def delete_topic(self, module_id: str, topic_id: str) -> bool:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("delete_topic", exc)
            return StorageService.delete_topic(self, module_id, topic_id)
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")
        # Check existence in Postgres catalog (source of truth in hosted mode)
        current_catalog = self.repository.load_catalog()
        topic_exists_in_catalog = False
        new_catalog = []
        for module in current_catalog:
            if not isinstance(module, dict):
                new_catalog.append(module)
                continue
            if module.get("id") != module_id:
                new_catalog.append(module)
                continue
            topics = module.get("topics") or []
            new_topics = [t for t in topics if not (isinstance(t, dict) and t.get("id") == topic_id)]
            if len(new_topics) < len(topics):
                topic_exists_in_catalog = True
            module = dict(module)
            module["topics"] = new_topics
            new_catalog.append(module)
        # Also try to remove shadow topic directory if it exists (best effort)
        topic_dir = self.modules_dir / module_id / "topics" / topic_id
        if topic_dir.exists():
            try:
                shutil.rmtree(topic_dir)
                self.logger.info("[HOSTED] Shadow topic directory deleted: %s/%s", module_id, topic_id)
            except Exception as exc:
                self.logger.warning("[HOSTED] Failed to remove shadow topic dir %s/%s: %s", module_id, topic_id, exc)
        if not topic_exists_in_catalog:
            self.logger.warning("[HOSTED] Topic delete requested but not found in catalog: %s/%s", module_id, topic_id)
            return False
        try:
            self.repository.replace_catalog(new_catalog)
            self._modules_cache = None
            self._prune_task_content_to_catalog()
            self.logger.info("[HOSTED] Topic deleted from catalog: %s/%s", module_id, topic_id)
            return True
        except Exception as exc:
            self.logger.exception(
                "[HOSTED] Failed to delete topic %s/%s from catalog: %s",
                module_id,
                topic_id,
                exc,
            )
            return False

    def rename_module(self, module_id: str, new_name: str) -> bool:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("rename_module", exc)
            return StorageService.rename_module(self, module_id, new_name)
        self._validate_id(module_id, "module_id")
        clean_name = str(new_name or "").strip()
        if not clean_name:
            return False
        # Update in Postgres catalog directly
        current_catalog = self.repository.load_catalog()
        found = False
        new_catalog = []
        for module in current_catalog:
            if isinstance(module, dict) and module.get("id") == module_id:
                module = dict(module)
                module["name"] = clean_name
                found = True
            new_catalog.append(module)
        if not found:
            self.logger.warning("[HOSTED] Module rename: not found in catalog: %s", module_id)
            return False
        try:
            self.repository.replace_catalog(new_catalog)
            self._modules_cache = None
            self.logger.info("[HOSTED] Module renamed in catalog: %s -> '%s'", module_id, clean_name)
        except Exception as exc:
            self.logger.exception("[HOSTED] Failed to rename module %s in catalog: %s", module_id, exc)
            return False
        # Best-effort: update shadow module.json
        module_json_path = self.modules_dir / module_id / "module.json"
        if module_json_path.exists():
            try:
                with open(module_json_path, "r", encoding="utf-8") as fh:
                    shadow = json.load(fh)
                shadow["name"] = clean_name
                self._atomic_json_dump(module_json_path, shadow)
            except Exception as exc:
                self.logger.warning("[HOSTED] Failed to update shadow module.json for rename %s: %s", module_id, exc)
        return True

    def rename_topic(self, module_id: str, topic_id: str, new_name: str) -> bool:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("rename_topic", exc)
            return StorageService.rename_topic(self, module_id, topic_id, new_name)
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")
        clean_name = str(new_name or "").strip()
        if not clean_name:
            return False
        # Update in Postgres catalog directly
        current_catalog = self.repository.load_catalog()
        found = False
        new_catalog = []
        for module in current_catalog:
            if not isinstance(module, dict) or module.get("id") != module_id:
                new_catalog.append(module)
                continue
            module = dict(module)
            new_topics = []
            for topic in module.get("topics") or []:
                if isinstance(topic, dict) and topic.get("id") == topic_id:
                    topic = dict(topic)
                    topic["name"] = clean_name
                    found = True
                new_topics.append(topic)
            module["topics"] = new_topics
            new_catalog.append(module)
        if not found:
            self.logger.warning("[HOSTED] Topic rename: not found in catalog: %s/%s", module_id, topic_id)
            return False
        try:
            self.repository.replace_catalog(new_catalog)
            self._modules_cache = None
            self.logger.info("[HOSTED] Topic renamed in catalog: %s/%s -> '%s'", module_id, topic_id, clean_name)
        except Exception as exc:
            self.logger.exception("[HOSTED] Failed to rename topic %s/%s in catalog: %s", module_id, topic_id, exc)
            return False
        # Best-effort: update shadow topic.json
        topic_json_path = self.modules_dir / module_id / "topics" / topic_id / "topic.json"
        if topic_json_path.exists():
            try:
                with open(topic_json_path, "r", encoding="utf-8") as fh:
                    shadow = json.load(fh)
                shadow["name"] = clean_name
                self._atomic_json_dump(topic_json_path, shadow)
            except Exception as exc:
                self.logger.warning(
                    "[HOSTED] Failed to update shadow topic.json for rename %s/%s: %s", module_id, topic_id, exc
                )
        return True

    def set_topic_theory_link(
        self,
        module_id: str,
        topic_id: str,
        theory_link: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("set_topic_theory_link", exc)
            return StorageService.set_topic_theory_link(
                self,
                module_id,
                topic_id,
                theory_link,
            )
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")
        # Update theory_link in Postgres catalog directly
        current_catalog = self.repository.load_catalog()
        found = False
        updated_topic: Dict[str, Any] = {}
        new_catalog = []
        for module in current_catalog:
            if not isinstance(module, dict) or module.get("id") != module_id:
                new_catalog.append(module)
                continue
            module = dict(module)
            new_topics = []
            for topic in module.get("topics") or []:
                if isinstance(topic, dict) and topic.get("id") == topic_id:
                    topic = dict(topic)
                    if isinstance(theory_link, dict):
                        topic["theory_link"] = dict(theory_link)
                    else:
                        topic.pop("theory_link", None)
                    found = True
                    updated_topic = topic
                new_topics.append(topic)
            module["topics"] = new_topics
            new_catalog.append(module)
        if not found:
            raise ValueError("topic_not_found")
        try:
            self.repository.replace_catalog(new_catalog)
            self._modules_cache = None
            self.logger.info("[HOSTED] Theory link updated in catalog: %s/%s", module_id, topic_id)
        except Exception as exc:
            self.logger.exception(
                "[HOSTED] Failed to update theory link %s/%s in catalog: %s", module_id, topic_id, exc
            )
            raise
        # Best-effort: update shadow files
        try:
            StorageService.set_topic_theory_link(self, module_id, topic_id, theory_link)
        except Exception as exc:
            self.logger.warning(
                "[HOSTED] Failed to update shadow for theory link %s/%s: %s", module_id, topic_id, exc
            )
        return updated_topic

    @staticmethod
    def _atomic_json_dump(path: Path, payload: Dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_name = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                dir=str(path.parent),
                delete=False,
                encoding="utf-8",
                suffix=".tmp",
            ) as tf:
                json.dump(payload, tf, ensure_ascii=False, indent=2)
                temp_name = tf.name
            os.replace(temp_name, str(path))
        finally:
            if temp_name and os.path.exists(temp_name):
                try:
                    os.remove(temp_name)
                except Exception:
                    pass
