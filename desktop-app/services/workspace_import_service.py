from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple

from werkzeug.utils import secure_filename

from services.workspace_graph_materialization_service import WorkspaceGraphMaterializationService
from services.workspace_lineage import (
    build_source_lineage_fields,
    normalize_workspace_graph_entity_fields,
    normalize_workspace_lineage_fields,
)


class WorkspaceImportService:
    """Use-case layer over workspace graph materialization.

    This service does not expose public catalog routes. Its job is to provide
    a stable internal materialization/import contract for linked-library
    snapshot flows and legacy operational bridges.
    """

    SERVICE_CONTRACT = {
        "namespace": "internal_workspace_import",
        "import_family": "workspace_complex_copy",
        "workspace_import": True,
        "public_api": False,
        "bridge_only": True,
        "intended_usage": "internal_snapshot_materialization",
        "uses_legacy_import_services": False,
    }

    def __init__(
        self,
        *,
        complex_service: Any,
        storage_service: Any,
        theory_service: Any,
        source_complex_service: Optional[Any] = None,
        source_storage_service: Optional[Any] = None,
        source_theory_service: Optional[Any] = None,
    ) -> None:
        self.materializer = WorkspaceGraphMaterializationService(
            complex_service=complex_service,
            storage_service=storage_service,
            theory_service=theory_service,
            source_complex_service=source_complex_service,
            source_storage_service=source_storage_service,
            source_theory_service=source_theory_service,
        )

    def import_complex_copy_by_source_complex_id(
        self,
        source_complex_id: str,
        *,
        source_catalog_item_id: str,
        source_catalog_version_id: str,
        source_catalog_visibility: Optional[str] = None,
        requested_by_user_id: Optional[str] = None,
        prefer_existing_by_lineage: bool = True,
        workspace_created_via: Optional[str] = None,
    ) -> Dict[str, Any]:
        raw_result = self.materializer.materialize_complex_copy_by_id(
            source_complex_id,
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_catalog_visibility=source_catalog_visibility,
            requested_by_user_id=requested_by_user_id,
            prefer_existing_by_lineage=prefer_existing_by_lineage,
            workspace_created_via=workspace_created_via,
        )
        return self._normalize_import_result(
            raw_result,
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            requested_by_user_id=requested_by_user_id,
        )

    def import_complex_copy(
        self,
        source_complex: Any,
        *,
        source_catalog_item_id: str,
        source_catalog_version_id: str,
        source_catalog_visibility: Optional[str] = None,
        requested_by_user_id: Optional[str] = None,
        prefer_existing_by_lineage: bool = True,
        workspace_created_via: Optional[str] = None,
    ) -> Dict[str, Any]:
        raw_result = self.materializer.materialize_complex_copy(
            source_complex,
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_catalog_visibility=source_catalog_visibility,
            requested_by_user_id=requested_by_user_id,
            prefer_existing_by_lineage=prefer_existing_by_lineage,
            workspace_created_via=workspace_created_via,
        )
        return self._normalize_import_result(
            raw_result,
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            requested_by_user_id=requested_by_user_id,
        )

    def preview_complex_copy_by_source_complex_id(
        self,
        source_complex_id: str,
        *,
        source_catalog_item_id: str,
        source_catalog_version_id: str,
        source_catalog_visibility: Optional[str] = None,
        requested_by_user_id: Optional[str] = None,
        prefer_existing_by_lineage: bool = True,
        workspace_created_via: Optional[str] = None,
    ) -> Dict[str, Any]:
        source_complex = self.materializer.source_complex_service.get_complex(source_complex_id)
        if source_complex is None:
            raise ValueError("source_complex_not_found")
        return self.preview_complex_copy(
            source_complex,
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_catalog_visibility=source_catalog_visibility,
            requested_by_user_id=requested_by_user_id,
            prefer_existing_by_lineage=prefer_existing_by_lineage,
            workspace_created_via=workspace_created_via,
        )

    def preview_complex_copy(
        self,
        source_complex: Any,
        *,
        source_catalog_item_id: str,
        source_catalog_version_id: str,
        source_catalog_visibility: Optional[str] = None,
        requested_by_user_id: Optional[str] = None,
        prefer_existing_by_lineage: bool = True,
        workspace_created_via: Optional[str] = None,
    ) -> Dict[str, Any]:
        source_payload = self.materializer._normalize_source_complex(source_complex)
        source_complex_id = str(source_payload.get("id") or "").strip()
        normalized_created_via = self._normalize_optional_text(workspace_created_via) or "workspace_import"
        complex_workspace_meta = self._build_workspace_copy_meta(
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_catalog_visibility=source_catalog_visibility,
            workspace_created_via=normalized_created_via,
            source_entity_kind="complex",
            source_entity_id=source_complex_id,
            requested_by_user_id=requested_by_user_id,
        )

        complex_source_lookup = build_source_lineage_fields(
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_entity_kind="complex",
            source_entity_id=source_complex_id,
        )

        if prefer_existing_by_lineage:
            existing_complex = self.materializer.complex_service.find_complex_by_source_lineage(
                source_catalog_item_id=complex_source_lookup.get("source_catalog_item_id"),
                source_catalog_version_id=complex_source_lookup.get("source_catalog_version_id"),
                source_entity_kind=complex_source_lookup.get("source_entity_kind"),
                source_entity_id=complex_source_lookup.get("source_entity_id"),
            )
            if existing_complex is not None:
                reused_raw = self.materializer._build_reused_complex_result(existing_complex)
                return self._normalize_preview_result(
                    reused_raw,
                    source_catalog_item_id=source_catalog_item_id,
                    source_catalog_version_id=source_catalog_version_id,
                    requested_by_user_id=requested_by_user_id,
                )

        taken = self._build_taken_state()
        cached_theories: Dict[str, Dict[str, Any]] = {}
        module_results: Dict[str, Dict[str, Any]] = {}
        topic_results: Dict[str, Dict[str, Any]] = {}
        task_results: Dict[str, Dict[str, Any]] = {}
        task_ref_map: Dict[str, str] = {}

        for source_task_ref in source_payload.get("tasks") or []:
            module_result, topic_result, task_result = self._preview_task_ref(
                str(source_task_ref),
                source_catalog_item_id=source_catalog_item_id,
                source_catalog_version_id=source_catalog_version_id,
                source_catalog_visibility=source_catalog_visibility,
                requested_by_user_id=requested_by_user_id,
                taken=taken,
                cached_theories=cached_theories,
                workspace_created_via=normalized_created_via,
            )
            source_module_id, source_topic_id, _ = self.materializer._parse_task_ref(source_task_ref)
            module_results[source_module_id] = module_result
            topic_results[f"{source_module_id}/{source_topic_id}"] = topic_result
            task_results[str(source_task_ref)] = task_result
            task_ref_map[str(source_task_ref)] = str(task_result.get("target_task_ref") or "")

        mapped_complex_theory_link = self._preview_theory_link(
            source_payload.get("theory_link"),
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_catalog_visibility=source_catalog_visibility,
            requested_by_user_id=requested_by_user_id,
            taken=taken,
            cached_theories=cached_theories,
            workspace_created_via=normalized_created_via,
        )

        predicted_complex_id = self._reserve_candidate_id(
            preferred_id=source_complex_id,
            display_name=source_payload.get("name"),
            taken=taken["complex_ids"],
            entity_kind="complex",
        )
        taken["complex_ids"].add(predicted_complex_id)

        complex_item = normalize_workspace_lineage_fields(
            {
                "id": predicted_complex_id,
                "name": source_payload.get("name"),
                "description": source_payload.get("description"),
                "tasks": [task_ref_map[str(task_ref)] for task_ref in source_payload.get("tasks") or []],
                "chains": self.materializer._remap_chains(source_payload.get("chains"), task_ref_map),
                "settings": self.materializer._remap_complex_settings(
                    source_payload.get("settings"),
                    task_ref_map,
                ),
                "theory_link": mapped_complex_theory_link,
                **complex_workspace_meta,
            },
            entity_kind="complex",
            entity_id=predicted_complex_id,
            entity_ref=predicted_complex_id,
        )

        raw_result = {
            "source_complex_id": source_complex_id,
            "complex": {
                "created": True,
                "reused": False,
                "complex_id": predicted_complex_id,
                "item": complex_item,
            },
            "modules": list(module_results.values()),
            "topics": list(topic_results.values()),
            "tasks": list(task_results.values()),
            "theories": list(cached_theories.values()),
            "task_ref_map": task_ref_map,
            "complex_theory_link": mapped_complex_theory_link,
            "created_counts": {
                "complexes": 1,
                "modules": sum(1 for item in module_results.values() if item.get("created")),
                "topics": sum(1 for item in topic_results.values() if item.get("created")),
                "tasks": sum(1 for item in task_results.values() if item.get("created")),
                "theories": sum(1 for item in cached_theories.values() if item.get("created")),
            },
            "reused_counts": {
                "complexes": 0,
                "modules": sum(1 for item in module_results.values() if item.get("reused")),
                "topics": sum(1 for item in topic_results.values() if item.get("reused")),
                "tasks": sum(1 for item in task_results.values() if item.get("reused")),
                "theories": sum(1 for item in cached_theories.values() if item.get("reused")),
            },
        }
        return self._normalize_preview_result(
            raw_result,
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            requested_by_user_id=requested_by_user_id,
        )

    def _normalize_import_result(
        self,
        raw_result: Dict[str, Any],
        *,
        source_catalog_item_id: str,
        source_catalog_version_id: str,
        requested_by_user_id: Optional[str],
    ) -> Dict[str, Any]:
        complex_node = self._summarize_complex_result(
            raw_result.get("complex"),
            current_user_id=requested_by_user_id,
        )
        module_nodes = [
            self._summarize_module_result(
                node,
                current_user_id=requested_by_user_id,
            )
            for node in raw_result.get("modules") or []
            if isinstance(node, dict)
        ]
        topic_nodes = [
            self._summarize_topic_result(
                node,
                current_user_id=requested_by_user_id,
            )
            for node in raw_result.get("topics") or []
            if isinstance(node, dict)
        ]
        task_nodes = [
            self._summarize_task_result(
                node,
                current_user_id=requested_by_user_id,
            )
            for node in raw_result.get("tasks") or []
            if isinstance(node, dict)
        ]
        theory_nodes = [
            self._summarize_theory_result(
                node,
                current_user_id=requested_by_user_id,
            )
            for node in raw_result.get("theories") or []
            if isinstance(node, dict)
        ]

        workspace_snapshot = {
            "complex_id": complex_node.get("complex_id"),
            "complex_ref": complex_node.get("workspace_entity_ref"),
            "module_ids": [node.get("module_id") for node in module_nodes if node.get("module_id")],
            "topic_refs": [node.get("workspace_entity_ref") for node in topic_nodes if node.get("workspace_entity_ref")],
            "task_refs": [node.get("target_task_ref") for node in task_nodes if node.get("target_task_ref")],
            "theory_ids": [node.get("theory_id") for node in theory_nodes if node.get("theory_id")],
        }

        created_counts = self._normalize_counts(raw_result.get("created_counts"))
        reused_counts = self._normalize_counts(raw_result.get("reused_counts"))
        total_nodes = {
            "complexes": 1 if complex_node.get("complex_id") else 0,
            "modules": len(module_nodes),
            "topics": len(topic_nodes),
            "tasks": len(task_nodes),
            "theories": len(theory_nodes),
        }

        return {
            "ok": True,
            "import_kind": "workspace_complex_copy",
            "created_at": datetime.utcnow().isoformat(),
            "requested_by_user_id": str(requested_by_user_id or "").strip() or None,
            "service_contract": dict(self.SERVICE_CONTRACT),
            "source": {
                "catalog_item_id": source_catalog_item_id,
                "catalog_version_id": source_catalog_version_id,
                "complex_id": raw_result.get("source_complex_id"),
            },
            "summary": {
                "created_counts": created_counts,
                "reused_counts": reused_counts,
                "total_nodes": total_nodes,
            },
            "workspace": workspace_snapshot,
            "result": {
                "complex": complex_node,
                "modules": module_nodes,
                "topics": topic_nodes,
                "tasks": task_nodes,
                "theories": theory_nodes,
                "task_ref_map": dict(raw_result.get("task_ref_map") or {}),
                "complex_theory_link": self._clone_mapping(raw_result.get("complex_theory_link")),
            },
        }

    def _normalize_preview_result(
        self,
        raw_result: Dict[str, Any],
        *,
        source_catalog_item_id: str,
        source_catalog_version_id: str,
        requested_by_user_id: Optional[str],
    ) -> Dict[str, Any]:
        normalized = self._normalize_import_result(
            raw_result,
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            requested_by_user_id=requested_by_user_id,
        )
        normalized["import_kind"] = "workspace_complex_copy_preview"
        normalized["preview_only"] = True
        result_block = normalized.get("result") if isinstance(normalized.get("result"), dict) else {}
        self._mark_preview_actions(result_block.get("complex"))
        for key in ("modules", "topics", "tasks", "theories"):
            for item in result_block.get(key) or []:
                self._mark_preview_actions(item)
        return normalized

    def _normalize_counts(self, raw_counts: Any) -> Dict[str, int]:
        payload = raw_counts if isinstance(raw_counts, dict) else {}
        return {
            "complexes": int(payload.get("complexes") or 0),
            "modules": int(payload.get("modules") or 0),
            "topics": int(payload.get("topics") or 0),
            "tasks": int(payload.get("tasks") or 0),
            "theories": int(payload.get("theories") or 0),
        }

    def _normalize_optional_text(self, value: Any) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    def _build_node_ownership_payload(
        self,
        item: Dict[str, Any],
        *,
        current_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        effective_user_id = self._normalize_optional_text(current_user_id)
        created_by_user_id = self._normalize_optional_text(item.get("created_by_user_id"))
        updated_by_user_id = self._normalize_optional_text(item.get("updated_by_user_id"))
        if updated_by_user_id is None:
            updated_by_user_id = created_by_user_id

        created_via = self._normalize_optional_text(item.get("created_via")) or "legacy_unknown"
        content_scope = self._normalize_optional_text(item.get("content_scope")) or "shared_local"
        return {
            "scope": "workspace",
            "content_scope": content_scope,
            "created_by_user_id": created_by_user_id,
            "updated_by_user_id": updated_by_user_id,
            "created_via": created_via,
            "has_owner": bool(created_by_user_id),
            "is_owned_by_current_user": bool(
                created_by_user_id and effective_user_id and created_by_user_id == effective_user_id
            ),
            "is_shared_library": content_scope == "shared_local",
        }

    def _build_workspace_copy_meta(
        self,
        *,
        source_catalog_item_id: str,
        source_catalog_version_id: str,
        source_catalog_visibility: Optional[str] = None,
        workspace_created_via: Optional[str] = None,
        source_entity_kind: str,
        requested_by_user_id: Optional[str] = None,
        source_entity_id: Any = None,
        module_id: Any = None,
        topic_id: Any = None,
        task_id: Any = None,
    ) -> Dict[str, Any]:
        payload = build_source_lineage_fields(
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_entity_kind=source_entity_kind,
            source_entity_id=source_entity_id,
            module_id=module_id,
            topic_id=topic_id,
            task_id=task_id,
        )
        payload["created_via"] = self._normalize_optional_text(workspace_created_via) or "workspace_import"
        payload["content_scope"] = "workspace_private"
        normalized_source_visibility = self._normalize_optional_text(source_catalog_visibility)
        if normalized_source_visibility is not None:
            payload["source_catalog_visibility"] = normalized_source_visibility
        normalized_owner_user_id = self._normalize_optional_text(requested_by_user_id)
        if normalized_owner_user_id is not None:
            payload["created_by_user_id"] = normalized_owner_user_id
            payload["updated_by_user_id"] = normalized_owner_user_id
        return payload

    def _to_plain_dict(self, payload: Any) -> Dict[str, Any]:
        if hasattr(payload, "dict"):
            payload = payload.dict()
        if not isinstance(payload, dict):
            return {}
        return self._convert_datetime_to_str(payload)

    def _convert_datetime_to_str(self, payload: Any) -> Any:
        if isinstance(payload, datetime):
            return payload.isoformat()
        if isinstance(payload, dict):
            return {key: self._convert_datetime_to_str(value) for key, value in payload.items()}
        if isinstance(payload, list):
            return [self._convert_datetime_to_str(value) for value in payload]
        return payload

    def _clone_mapping(self, payload: Any) -> Optional[Dict[str, Any]]:
        plain = self._to_plain_dict(payload)
        return plain or None

    def _mark_preview_actions(self, payload: Any) -> None:
        if not isinstance(payload, dict):
            return
        payload["planned_action"] = "reuse" if payload.get("reused") else "create"
        payload["will_reuse"] = bool(payload.get("reused"))
        payload["will_create"] = bool(payload.get("created"))

    def _base_node_summary(
        self,
        result: Dict[str, Any],
        *,
        entity_kind: str,
        current_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        item = self._to_plain_dict(result.get("item"))
        return {
            "entity_kind": entity_kind,
            "created": bool(result.get("created")),
            "reused": bool(result.get("reused")),
            "workspace_entity_kind": item.get("workspace_entity_kind"),
            "workspace_entity_id": item.get("workspace_entity_id"),
            "workspace_entity_ref": item.get("workspace_entity_ref"),
            "workspace_copy_kind": item.get("workspace_copy_kind"),
            "workspace_copy": self._clone_mapping(item.get("workspace_copy")),
            "created_by_user_id": item.get("created_by_user_id"),
            "updated_by_user_id": item.get("updated_by_user_id"),
            "created_via": item.get("created_via"),
            "content_scope": item.get("content_scope"),
            "source_catalog_item_id": item.get("source_catalog_item_id"),
            "source_catalog_version_id": item.get("source_catalog_version_id"),
            "source_entity_kind": item.get("source_entity_kind"),
            "source_entity_id": item.get("source_entity_id"),
            "source_lineage": self._clone_mapping(item.get("source_lineage")),
            "source_lineage_key": item.get("source_lineage_key"),
            "has_source_lineage": bool(item.get("has_source_lineage")),
            "ownership": self._build_node_ownership_payload(
                item,
                current_user_id=current_user_id,
            ),
        }

    def _summarize_complex_result(
        self,
        result: Any,
        *,
        current_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload = result if isinstance(result, dict) else {}
        node = self._base_node_summary(
            payload,
            entity_kind="complex",
            current_user_id=current_user_id,
        )
        item = self._to_plain_dict(payload.get("item"))
        node.update(
            {
                "complex_id": payload.get("complex_id") or item.get("id") or item.get("workspace_entity_id"),
                "name": item.get("name"),
                "task_count": len(item.get("tasks") or []) if isinstance(item.get("tasks"), list) else 0,
                "tasks": list(item.get("tasks") or []) if isinstance(item.get("tasks"), list) else [],
                "theory_link": self._clone_mapping(item.get("theory_link")),
            }
        )
        return node

    def _summarize_module_result(
        self,
        result: Dict[str, Any],
        *,
        current_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        node = self._base_node_summary(
            result,
            entity_kind="module",
            current_user_id=current_user_id,
        )
        item = self._to_plain_dict(result.get("item"))
        node.update(
            {
                "module_id": result.get("module_id") or item.get("id") or item.get("workspace_entity_id"),
                "name": item.get("name"),
                "source_module_id": result.get("source_module_id") or item.get("source_entity_id"),
            }
        )
        return node

    def _summarize_topic_result(
        self,
        result: Dict[str, Any],
        *,
        current_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        node = self._base_node_summary(
            result,
            entity_kind="topic",
            current_user_id=current_user_id,
        )
        item = self._to_plain_dict(result.get("item"))
        node.update(
            {
                "module_id": result.get("module_id") or item.get("module_id") or item.get("module"),
                "topic_id": result.get("topic_id") or item.get("id") or item.get("workspace_entity_id"),
                "name": item.get("name"),
                "source_module_id": result.get("source_module_id"),
                "source_topic_id": result.get("source_topic_id"),
                "source_topic_ref": result.get("source_topic_ref") or item.get("source_entity_id"),
                "theory_link": self._clone_mapping(item.get("theory_link")),
            }
        )
        return node

    def _summarize_task_result(
        self,
        result: Dict[str, Any],
        *,
        current_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        node = self._base_node_summary(
            result,
            entity_kind="task",
            current_user_id=current_user_id,
        )
        item = self._to_plain_dict(result.get("item"))
        node.update(
            {
                "module_id": result.get("module_id") or item.get("module_id") or item.get("module"),
                "topic_id": result.get("topic_id") or item.get("topic_id") or item.get("topic"),
                "task_id": result.get("task_id") or item.get("id") or item.get("workspace_entity_id"),
                "name": item.get("name"),
                "source_module_id": result.get("source_module_id"),
                "source_topic_id": result.get("source_topic_id"),
                "source_task_id": result.get("source_task_id"),
                "source_task_ref": result.get("source_task_ref") or item.get("source_entity_id"),
                "target_task_ref": result.get("target_task_ref") or item.get("workspace_entity_ref"),
            }
        )
        return node

    def _summarize_theory_result(
        self,
        result: Dict[str, Any],
        *,
        current_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        node = self._base_node_summary(
            result,
            entity_kind="theory",
            current_user_id=current_user_id,
        )
        item = self._to_plain_dict(result.get("item"))
        node.update(
            {
                "theory_id": result.get("theory_id") or item.get("id") or item.get("workspace_entity_id"),
                "title": item.get("title"),
                "source_theory_id": result.get("source_theory_id") or item.get("source_entity_id"),
            }
        )
        return node

    def _build_taken_state(self) -> Dict[str, Any]:
        complex_ids: Set[str] = set()
        for complex_obj in self.materializer.complex_service.get_all_complexes():
            complex_id = str(getattr(complex_obj, "id", "") or "").strip()
            if complex_id:
                complex_ids.add(complex_id)

        theory_ids: Set[str] = set()
        for item in self.materializer.theory_service.list_theories():
            if not isinstance(item, dict):
                continue
            theory_id = str(item.get("id") or "").strip()
            if theory_id:
                theory_ids.add(theory_id)

        module_ids: Set[str] = set()
        topic_ids_by_module: Dict[str, Set[str]] = {}
        task_ids_by_topic: Dict[Tuple[str, str], Set[str]] = {}
        for module in self.materializer.storage_service.load_modules():
            if not isinstance(module, dict):
                continue
            module_id = str(module.get("id") or "").strip()
            if not module_id:
                continue
            module_ids.add(module_id)
            topics_taken = topic_ids_by_module.setdefault(module_id, set())
            for topic in module.get("topics") or []:
                if not isinstance(topic, dict):
                    continue
                topic_id = str(topic.get("id") or "").strip()
                if not topic_id:
                    continue
                topics_taken.add(topic_id)
                task_taken = task_ids_by_topic.setdefault((module_id, topic_id), set())
                for task in topic.get("tasks") or []:
                    if not isinstance(task, dict):
                        continue
                    task_id = str(task.get("id") or "").strip()
                    if task_id:
                        task_taken.add(task_id)

        return {
            "complex_ids": complex_ids,
            "theory_ids": theory_ids,
            "module_ids": module_ids,
            "topic_ids_by_module": topic_ids_by_module,
            "task_ids_by_topic": task_ids_by_topic,
        }

    def _reserve_candidate_id(
        self,
        *,
        preferred_id: Any,
        display_name: Any,
        taken: Set[str],
        entity_kind: str,
    ) -> str:
        explicit = str(preferred_id or "").strip()
        if explicit:
            if entity_kind == "complex":
                base_id = secure_filename(explicit).strip().lower() or "complex_preview"
            else:
                base_id = explicit
        else:
            seed = secure_filename(str(display_name or "").strip().lower().replace(" ", "_"))
            if entity_kind == "theory":
                base_id = f"th_{seed}" if seed else "th_preview"
            elif entity_kind == "complex":
                base_id = seed or "complex_preview"
            else:
                base_id = seed or f"{entity_kind}_preview"

        candidate = base_id
        suffix = 1
        while candidate in taken:
            candidate = f"{base_id}_{suffix:02d}"
            suffix += 1
        return candidate

    def _preview_task_ref(
        self,
        source_task_ref: str,
        *,
        source_catalog_item_id: str,
        source_catalog_version_id: str,
        source_catalog_visibility: Optional[str] = None,
        requested_by_user_id: Optional[str] = None,
        taken: Dict[str, Any],
        cached_theories: Dict[str, Dict[str, Any]],
        workspace_created_via: Optional[str] = None,
    ) -> Tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
        source_module_id, source_topic_id, source_task_id = self.materializer._parse_task_ref(source_task_ref)
        source_module = self.materializer.source_storage_service.get_module(source_module_id)
        source_topic = self.materializer.source_storage_service.get_topic(source_module_id, source_topic_id)
        source_task = self.materializer.source_storage_service.load_task(source_module_id, source_topic_id, source_task_id)
        if not isinstance(source_module, dict) or not isinstance(source_topic, dict) or not isinstance(source_task, dict):
            raise ValueError(f"source_task_graph_incomplete:{source_task_ref}")

        module_workspace_meta = self._build_workspace_copy_meta(
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_catalog_visibility=source_catalog_visibility,
            workspace_created_via=workspace_created_via,
            source_entity_kind="module",
            module_id=source_module_id,
            requested_by_user_id=requested_by_user_id,
        )
        module_source_lookup = build_source_lineage_fields(
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_entity_kind="module",
            module_id=source_module_id,
        )
        existing_module = self.materializer.storage_service.find_module_by_source_lineage(**module_source_lookup)
        if isinstance(existing_module, dict):
            target_module_id = str(existing_module.get("id") or "").strip()
            module_result = {
                "created": False,
                "reused": True,
                "module_id": target_module_id,
                "item": existing_module,
                "source_module_id": source_module_id,
            }
        else:
            target_module_id = self._reserve_candidate_id(
                preferred_id=source_module_id,
                display_name=source_module.get("name"),
                taken=taken["module_ids"],
                entity_kind="module",
            )
            taken["module_ids"].add(target_module_id)
            taken["topic_ids_by_module"].setdefault(target_module_id, set())
            module_item = normalize_workspace_graph_entity_fields(
                {
                    "id": target_module_id,
                    "name": source_module.get("name"),
                    **module_workspace_meta,
                },
                entity_kind="module",
                module_id=target_module_id,
            )
            module_result = {
                "created": True,
                "reused": False,
                "module_id": target_module_id,
                "item": module_item,
                "source_module_id": source_module_id,
            }

        target_topic_theory_link = self._preview_theory_link(
            self.materializer.source_storage_service.get_topic_theory_link(source_module_id, source_topic_id),
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_catalog_visibility=source_catalog_visibility,
            workspace_created_via=workspace_created_via,
            requested_by_user_id=requested_by_user_id,
            taken=taken,
            cached_theories=cached_theories,
        )

        topic_workspace_meta = self._build_workspace_copy_meta(
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_catalog_visibility=source_catalog_visibility,
            workspace_created_via=workspace_created_via,
            source_entity_kind="topic",
            module_id=source_module_id,
            topic_id=source_topic_id,
            requested_by_user_id=requested_by_user_id,
        )
        topic_source_lookup = build_source_lineage_fields(
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_entity_kind="topic",
            module_id=source_module_id,
            topic_id=source_topic_id,
        )
        existing_topic = self.materializer.storage_service.find_topic_by_source_lineage(**topic_source_lookup)
        if isinstance(existing_topic, dict):
            target_topic_id = str(existing_topic.get("id") or "").strip()
            target_topic_module_id = str(existing_topic.get("module_id") or existing_topic.get("module") or "").strip() or target_module_id
            topic_result = {
                "created": False,
                "reused": True,
                "module_id": target_topic_module_id,
                "topic_id": target_topic_id,
                "item": existing_topic,
                "source_module_id": source_module_id,
                "source_topic_id": source_topic_id,
                "source_topic_ref": f"{source_module_id}/{source_topic_id}",
            }
        else:
            taken["topic_ids_by_module"].setdefault(target_module_id, set())
            target_topic_id = self._reserve_candidate_id(
                preferred_id=source_topic_id,
                display_name=source_topic.get("name"),
                taken=taken["topic_ids_by_module"][target_module_id],
                entity_kind="topic",
            )
            taken["topic_ids_by_module"][target_module_id].add(target_topic_id)
            taken["task_ids_by_topic"].setdefault((target_module_id, target_topic_id), set())
            topic_item = normalize_workspace_graph_entity_fields(
                {
                    "id": target_topic_id,
                    "name": source_topic.get("name"),
                    "module_id": target_module_id,
                    "module": target_module_id,
                    "theory_link": target_topic_theory_link,
                    **topic_workspace_meta,
                },
                entity_kind="topic",
                module_id=target_module_id,
                topic_id=target_topic_id,
            )
            topic_result = {
                "created": True,
                "reused": False,
                "module_id": target_module_id,
                "topic_id": target_topic_id,
                "item": topic_item,
                "source_module_id": source_module_id,
                "source_topic_id": source_topic_id,
                "source_topic_ref": f"{source_module_id}/{source_topic_id}",
            }

        task_workspace_meta = self._build_workspace_copy_meta(
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_catalog_visibility=source_catalog_visibility,
            workspace_created_via=workspace_created_via,
            source_entity_kind="task",
            module_id=source_module_id,
            topic_id=source_topic_id,
            task_id=source_task_id,
            requested_by_user_id=requested_by_user_id,
        )
        task_source_lookup = build_source_lineage_fields(
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_entity_kind="task",
            module_id=source_module_id,
            topic_id=source_topic_id,
            task_id=source_task_id,
        )
        existing_task = self.materializer.storage_service.find_task_by_source_lineage(**task_source_lookup)
        if isinstance(existing_task, dict):
            target_task_id = str(existing_task.get("id") or "").strip()
            target_task_module_id = str(existing_task.get("module_id") or existing_task.get("module") or "").strip() or str(topic_result.get("module_id") or "")
            target_task_topic_id = str(existing_task.get("topic_id") or existing_task.get("topic") or "").strip() or str(topic_result.get("topic_id") or "")
            task_result = {
                "created": False,
                "reused": True,
                "task_id": target_task_id,
                "module_id": target_task_module_id,
                "topic_id": target_task_topic_id,
                "item": existing_task,
                "task": self.materializer.storage_service.load_task(target_task_module_id, target_task_topic_id, target_task_id),
                "source_module_id": source_module_id,
                "source_topic_id": source_topic_id,
                "source_task_id": source_task_id,
                "source_task_ref": source_task_ref,
                "target_task_ref": f"{target_task_module_id}/{target_task_topic_id}/{target_task_id}",
            }
        else:
            task_data = source_task.get("task_data") if isinstance(source_task.get("task_data"), dict) else {}
            source_meta = task_data.get("meta") if isinstance(task_data.get("meta"), dict) else {}
            task_name = source_meta.get("name") or task_data.get("name") or source_task_id
            topic_key = (str(topic_result.get("module_id") or ""), str(topic_result.get("topic_id") or ""))
            taken["task_ids_by_topic"].setdefault(topic_key, set())
            target_task_id = self._reserve_candidate_id(
                preferred_id=source_task_id,
                display_name=task_name,
                taken=taken["task_ids_by_topic"][topic_key],
                entity_kind="task",
            )
            taken["task_ids_by_topic"][topic_key].add(target_task_id)
            task_item = normalize_workspace_graph_entity_fields(
                {
                    "id": target_task_id,
                    "name": task_name,
                    "module_id": topic_key[0],
                    "module": topic_key[0],
                    "topic_id": topic_key[1],
                    "topic": topic_key[1],
                    **task_workspace_meta,
                },
                entity_kind="task",
                module_id=topic_key[0],
                topic_id=topic_key[1],
                task_id=target_task_id,
            )
            task_result = {
                "created": True,
                "reused": False,
                "task_id": target_task_id,
                "module_id": topic_key[0],
                "topic_id": topic_key[1],
                "item": task_item,
                "task": None,
                "source_module_id": source_module_id,
                "source_topic_id": source_topic_id,
                "source_task_id": source_task_id,
                "source_task_ref": source_task_ref,
                "target_task_ref": f"{topic_key[0]}/{topic_key[1]}/{target_task_id}",
            }

        return module_result, topic_result, task_result

    def _preview_theory_link(
        self,
        source_theory_link: Any,
        *,
        source_catalog_item_id: str,
        source_catalog_version_id: str,
        source_catalog_visibility: Optional[str] = None,
        requested_by_user_id: Optional[str] = None,
        taken: Dict[str, Any],
        cached_theories: Dict[str, Dict[str, Any]],
        workspace_created_via: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        if not isinstance(source_theory_link, dict):
            return None

        source_theory_id = str(source_theory_link.get("theory_id") or "").strip()
        if not source_theory_id:
            return None
        if source_theory_id not in cached_theories:
            theory_workspace_meta = self._build_workspace_copy_meta(
                source_catalog_item_id=source_catalog_item_id,
                source_catalog_version_id=source_catalog_version_id,
                source_catalog_visibility=source_catalog_visibility,
                workspace_created_via=workspace_created_via,
                source_entity_kind="theory",
                source_entity_id=source_theory_id,
                requested_by_user_id=requested_by_user_id,
            )
            theory_source_lookup = build_source_lineage_fields(
                source_catalog_item_id=source_catalog_item_id,
                source_catalog_version_id=source_catalog_version_id,
                source_entity_kind="theory",
                source_entity_id=source_theory_id,
            )
            existing_theory = self.materializer.theory_service.find_theory_by_source_lineage(**theory_source_lookup)
            if isinstance(existing_theory, dict):
                cached_theories[source_theory_id] = {
                    "created": False,
                    "reused": True,
                    "theory_id": existing_theory.get("id"),
                    "item": existing_theory,
                    "source_theory_id": source_theory_id,
                }
            else:
                source_theory = self.materializer.source_theory_service.get_theory(source_theory_id, include_delta=False)
                predicted_theory_id = self._reserve_candidate_id(
                    preferred_id=source_theory_id,
                    display_name=source_theory.get("title"),
                    taken=taken["theory_ids"],
                    entity_kind="theory",
                )
                taken["theory_ids"].add(predicted_theory_id)
                theory_item = normalize_workspace_lineage_fields(
                    {
                        "id": predicted_theory_id,
                        "title": source_theory.get("title"),
                        **theory_workspace_meta,
                    },
                    entity_kind="theory",
                    entity_id=predicted_theory_id,
                    entity_ref=predicted_theory_id,
                )
                cached_theories[source_theory_id] = {
                    "created": True,
                    "reused": False,
                    "theory_id": predicted_theory_id,
                    "item": theory_item,
                    "source_theory_id": source_theory_id,
                }

        predicted_theory_id = str(cached_theories[source_theory_id].get("theory_id") or "").strip()
        if not predicted_theory_id:
            return None
        mapped_link = dict(source_theory_link)
        mapped_link["theory_id"] = predicted_theory_id
        return mapped_link
