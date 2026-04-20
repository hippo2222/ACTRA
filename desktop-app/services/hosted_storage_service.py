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
from services.workspace_lineage import normalize_workspace_graph_entity_fields


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
        self._bootstrap_from_shadow_if_empty()
        self._bootstrap_task_content_from_shadow()
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
        module_dir = self.modules_dir / module_id
        if module_dir.exists():
            self.logger.warning("[HOSTED] Module already exists: %s", module_id)
            return False

        try:
            module_dir.mkdir(parents=True, exist_ok=False)
            payload: Dict[str, Any] = {"id": module_id, "name": clean_name, "topics": []}
            if isinstance(workspace_meta, dict):
                payload.update(
                    {
                        field_name: workspace_meta.get(field_name)
                        for field_name in (
                            "source_catalog_item_id",
                            "source_catalog_version_id",
                            "source_entity_kind",
                            "source_entity_id",
                        )
                        if workspace_meta.get(field_name) is not None
                    }
                )
            payload = normalize_workspace_graph_entity_fields(
                payload,
                entity_kind="module",
                module_id=module_id,
            )
            self._atomic_json_dump(module_dir / "module.json", payload)
            self._sync_catalog_from_shadow()
            return True
        except Exception:
            shutil.rmtree(module_dir, ignore_errors=True)
            raise

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
        module_dir = self.modules_dir / module_id
        if not module_dir.exists():
            self.logger.warning("[HOSTED] Cannot create topic for missing module: %s", module_id)
            return False

        topic_dir = module_dir / "topics" / topic_id
        if topic_dir.exists():
            self.logger.warning("[HOSTED] Topic already exists: %s/%s", module_id, topic_id)
            return False

        try:
            (topic_dir / "tasks").mkdir(parents=True, exist_ok=False)
            payload: Dict[str, Any] = {"id": topic_id, "name": clean_name, "tasks": []}
            if isinstance(theory_link, dict):
                payload["theory_link"] = dict(theory_link)
            if isinstance(workspace_meta, dict):
                payload.update(
                    {
                        field_name: workspace_meta.get(field_name)
                        for field_name in (
                            "source_catalog_item_id",
                            "source_catalog_version_id",
                            "source_entity_kind",
                            "source_entity_id",
                        )
                        if workspace_meta.get(field_name) is not None
                    }
                )
            payload = normalize_workspace_graph_entity_fields(
                payload,
                entity_kind="topic",
                module_id=module_id,
                topic_id=topic_id,
            )
            self._atomic_json_dump(topic_dir / "topic.json", payload)
            self._sync_catalog_from_shadow()
            return True
        except Exception:
            shutil.rmtree(topic_dir, ignore_errors=True)
            raise

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
        success = super().delete_task(module_id, topic_id, task_id)
        if not success:
            return False
        try:
            self.content_repository.delete_task_content(module_id, topic_id, task_id)
            self._sync_catalog_from_shadow()
            return True
        except Exception as exc:
            self.logger.exception(
                "[HOSTED] Failed to sync hosted task delete %s/%s/%s: %s",
                module_id,
                topic_id,
                task_id,
                exc,
            )
            return False

    def delete_module(self, module_id: str) -> bool:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("delete_module", exc)
            return StorageService.delete_module(self, module_id)
        success = super().delete_module(module_id)
        if not success:
            return False
        try:
            self._sync_catalog_from_shadow()
            self._prune_task_content_to_catalog()
            return True
        except Exception as exc:
            self.logger.exception("[HOSTED] Failed to prune module task content %s: %s", module_id, exc)
            return False

    def delete_topic(self, module_id: str, topic_id: str) -> bool:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("delete_topic", exc)
            return StorageService.delete_topic(self, module_id, topic_id)
        success = super().delete_topic(module_id, topic_id)
        if not success:
            return False
        try:
            self._sync_catalog_from_shadow()
            self._prune_task_content_to_catalog()
            return True
        except Exception as exc:
            self.logger.exception(
                "[HOSTED] Failed to prune topic task content %s/%s: %s",
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
        success = super().rename_module(module_id, new_name)
        if success:
            self._sync_catalog_from_shadow()
        return success

    def rename_topic(self, module_id: str, topic_id: str, new_name: str) -> bool:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("rename_topic", exc)
            return StorageService.rename_topic(self, module_id, topic_id, new_name)
        success = super().rename_topic(module_id, topic_id, new_name)
        if success:
            self._sync_catalog_from_shadow()
        return success

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
        payload = super().set_topic_theory_link(module_id, topic_id, theory_link)
        self._sync_catalog_from_shadow()
        return payload

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
