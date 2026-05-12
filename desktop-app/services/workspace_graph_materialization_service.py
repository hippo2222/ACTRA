from __future__ import annotations

import copy
from typing import Any, Dict, List, Optional, Tuple

from services.workspace_lineage import build_source_lineage_fields


class WorkspaceGraphMaterializationService:
    """Materialize imported complex graphs into workspace copies without name-based merges."""

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
        self.complex_service = complex_service
        self.storage_service = storage_service
        self.theory_service = theory_service
        self.source_complex_service = source_complex_service or complex_service
        self.source_storage_service = source_storage_service or storage_service
        self.source_theory_service = source_theory_service or theory_service

    def _build_workspace_copy_meta(
        self,
        *,
        owner_user_id: Any = None,
        source_catalog_visibility: Any = None,
        workspace_created_via: Any = None,
        **lineage_kwargs: Any,
    ) -> Dict[str, Any]:
        payload = build_source_lineage_fields(**lineage_kwargs)
        normalized_created_via = str(workspace_created_via or "").strip() or "workspace_import"
        payload["created_via"] = normalized_created_via
        payload["content_scope"] = "workspace_private"
        normalized_source_visibility = str(source_catalog_visibility or "").strip()
        if normalized_source_visibility:
            payload["source_catalog_visibility"] = normalized_source_visibility
        normalized_owner_user_id = str(owner_user_id or "").strip()
        if normalized_owner_user_id:
            payload["created_by_user_id"] = normalized_owner_user_id
            payload["updated_by_user_id"] = normalized_owner_user_id
        return payload

    def materialize_complex_copy_by_id(
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
        source_complex = self.source_complex_service.get_complex(source_complex_id)
        if source_complex is None:
            raise ValueError("source_complex_not_found")
        return self.materialize_complex_copy(
            source_complex,
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_catalog_visibility=source_catalog_visibility,
            requested_by_user_id=requested_by_user_id,
            prefer_existing_by_lineage=prefer_existing_by_lineage,
            workspace_created_via=workspace_created_via,
        )

    def materialize_complex_copy(
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
        source_payload = self._normalize_source_complex(source_complex)
        source_complex_id = str(source_payload.get("id") or "").strip()
        normalized_created_via = str(workspace_created_via or "").strip() or "workspace_import"
        complex_workspace_meta = self._build_workspace_copy_meta(
            owner_user_id=requested_by_user_id,
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_catalog_visibility=source_catalog_visibility,
            workspace_created_via=normalized_created_via,
            source_entity_kind="complex",
            source_entity_id=source_complex_id,
        )

        complex_source_lookup = build_source_lineage_fields(
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_entity_kind="complex",
            source_entity_id=source_complex_id,
        )

        if prefer_existing_by_lineage:
            existing_complex = self.complex_service.find_complex_by_source_lineage(
                source_catalog_item_id=complex_source_lookup.get("source_catalog_item_id"),
                source_catalog_version_id=complex_source_lookup.get("source_catalog_version_id"),
                source_entity_kind=complex_source_lookup.get("source_entity_kind"),
                source_entity_id=complex_source_lookup.get("source_entity_id"),
            )
            if existing_complex is not None:
                return self._build_reused_complex_result(existing_complex)

        cached_theories: Dict[str, Dict[str, Any]] = {}
        module_results: Dict[str, Dict[str, Any]] = {}
        topic_results: Dict[str, Dict[str, Any]] = {}
        task_results: Dict[str, Dict[str, Any]] = {}
        task_ref_map: Dict[str, str] = {}

        for source_task_ref in source_payload.get("tasks") or []:
            module_result, topic_result, task_result = self._materialize_task_ref(
                source_task_ref,
                source_catalog_item_id=source_catalog_item_id,
                source_catalog_version_id=source_catalog_version_id,
                source_catalog_visibility=source_catalog_visibility,
                requested_by_user_id=requested_by_user_id,
                cached_theories=cached_theories,
                workspace_created_via=normalized_created_via,
            )
            source_module_id, source_topic_id, _ = self._parse_task_ref(source_task_ref)
            module_results[source_module_id] = module_result
            topic_results[f"{source_module_id}/{source_topic_id}"] = topic_result
            task_results[source_task_ref] = task_result
            task_ref_map[source_task_ref] = task_result["target_task_ref"]

        mapped_complex_theory_link = self._materialize_theory_link(
            source_payload.get("theory_link"),
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_catalog_visibility=source_catalog_visibility,
            requested_by_user_id=requested_by_user_id,
            cached_theories=cached_theories,
            workspace_created_via=normalized_created_via,
        )

        complex_copy_payload = copy.deepcopy(source_payload)
        complex_copy_payload.update(complex_workspace_meta)
        complex_copy_payload["tasks"] = [
            task_ref_map[str(task_ref)]
            for task_ref in source_payload.get("tasks") or []
        ]
        complex_copy_payload["chains"] = self._remap_chains(
            source_payload.get("chains"),
            task_ref_map,
        )
        complex_copy_payload["settings"] = self._remap_complex_settings(
            source_payload.get("settings"),
            task_ref_map,
        )
        if isinstance(mapped_complex_theory_link, dict):
            complex_copy_payload["theory_link"] = mapped_complex_theory_link
        complex_copy_payload["created_via"] = normalized_created_via
        complex_copy_payload["content_scope"] = "workspace_private"

        complex_result = self.complex_service.ensure_workspace_complex_copy(
            complex_copy_payload,
            prefer_existing_by_lineage=False,
        )

        return {
            "source_complex_id": source_complex_id,
            "complex": complex_result,
            "modules": list(module_results.values()),
            "topics": list(topic_results.values()),
            "tasks": list(task_results.values()),
            "theories": list(cached_theories.values()),
            "task_ref_map": task_ref_map,
            "complex_theory_link": mapped_complex_theory_link,
            "created_counts": {
                "complexes": int(bool(complex_result.get("created"))),
                "modules": sum(1 for item in module_results.values() if item.get("created")),
                "topics": sum(1 for item in topic_results.values() if item.get("created")),
                "tasks": sum(1 for item in task_results.values() if item.get("created")),
                "theories": sum(1 for item in cached_theories.values() if item.get("created")),
            },
            "reused_counts": {
                "complexes": int(bool(complex_result.get("reused"))),
                "modules": sum(1 for item in module_results.values() if item.get("reused")),
                "topics": sum(1 for item in topic_results.values() if item.get("reused")),
                "tasks": sum(1 for item in task_results.values() if item.get("reused")),
                "theories": sum(1 for item in cached_theories.values() if item.get("reused")),
            },
        }

    def _normalize_source_complex(self, source_complex: Any) -> Dict[str, Any]:
        payload = source_complex.dict() if hasattr(source_complex, "dict") else source_complex
        if not isinstance(payload, dict):
            raise ValueError("source_complex_payload_required")
        normalized = copy.deepcopy(payload)
        tasks = normalized.get("tasks")
        if not isinstance(tasks, list) or not tasks:
            raise ValueError("source_complex_tasks_required")
        return normalized

    def _parse_task_ref(self, task_ref: Any) -> Tuple[str, str, str]:
        raw_ref = str(task_ref or "").strip()
        parts = [part.strip() for part in raw_ref.split("/") if part.strip()]
        if len(parts) != 3:
            raise ValueError(f"invalid_task_ref:{raw_ref}")
        return parts[0], parts[1], parts[2]

    def _materialize_task_ref(
        self,
        source_task_ref: str,
        *,
        source_catalog_item_id: str,
        source_catalog_version_id: str,
        source_catalog_visibility: Optional[str] = None,
        requested_by_user_id: Optional[str] = None,
        cached_theories: Dict[str, Dict[str, Any]],
        workspace_created_via: Optional[str] = None,
    ) -> Tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
        source_module_id, source_topic_id, source_task_id = self._parse_task_ref(source_task_ref)

        source_module = self.source_storage_service.get_module(source_module_id)
        if not isinstance(source_module, dict):
            raise ValueError(f"source_module_not_found:{source_module_id}")
        source_topic = self.source_storage_service.get_topic(source_module_id, source_topic_id)
        if not isinstance(source_topic, dict):
            raise ValueError(f"source_topic_not_found:{source_module_id}/{source_topic_id}")
        source_task = self.source_storage_service.load_task(source_module_id, source_topic_id, source_task_id)
        if not isinstance(source_task, dict):
            raise ValueError(f"source_task_not_found:{source_task_ref}")

        target_topic_theory_link = self._materialize_theory_link(
            self.source_storage_service.get_topic_theory_link(source_module_id, source_topic_id),
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_catalog_visibility=source_catalog_visibility,
            requested_by_user_id=requested_by_user_id,
            cached_theories=cached_theories,
            workspace_created_via=workspace_created_via,
        )

        module_source_lookup = build_source_lineage_fields(
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_entity_kind="module",
            module_id=source_module_id,
        )

        module_result = self.storage_service.ensure_module_workspace_copy(
            module_name=str(source_module.get("name") or source_module_id),
            preferred_module_id=source_module_id,
            workspace_meta=self._build_workspace_copy_meta(
                owner_user_id=requested_by_user_id,
                source_catalog_item_id=source_catalog_item_id,
                source_catalog_version_id=source_catalog_version_id,
                source_catalog_visibility=source_catalog_visibility,
                workspace_created_via=workspace_created_via,
                source_entity_kind="module",
                module_id=source_module_id,
            ),
            prefer_existing_by_lineage=True,
        )

        topic_source_lookup = build_source_lineage_fields(
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_entity_kind="topic",
            module_id=source_module_id,
            topic_id=source_topic_id,
        )

        topic_result = self.storage_service.ensure_topic_workspace_copy(
            module_id=str(module_result.get("module_id") or ""),
            topic_name=str(source_topic.get("name") or source_topic_id),
            preferred_topic_id=source_topic_id,
            theory_link=target_topic_theory_link,
            workspace_meta=self._build_workspace_copy_meta(
                owner_user_id=requested_by_user_id,
                source_catalog_item_id=source_catalog_item_id,
                source_catalog_version_id=source_catalog_version_id,
                source_catalog_visibility=source_catalog_visibility,
                workspace_created_via=workspace_created_via,
                source_entity_kind="topic",
                module_id=source_module_id,
                topic_id=source_topic_id,
            ),
            prefer_existing_by_lineage=True,
        )

        task_source_lookup = build_source_lineage_fields(
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_entity_kind="task",
            module_id=source_module_id,
            topic_id=source_topic_id,
            task_id=source_task_id,
        )

        task_result = self.storage_service.materialize_task_workspace_copy(
            module_id=str(topic_result.get("module_id") or ""),
            topic_id=str(topic_result.get("topic_id") or ""),
            source_task=source_task,
            preferred_task_id=source_task_id,
            workspace_meta=self._build_workspace_copy_meta(
                owner_user_id=requested_by_user_id,
                source_catalog_item_id=source_catalog_item_id,
                source_catalog_version_id=source_catalog_version_id,
                source_catalog_visibility=source_catalog_visibility,
                workspace_created_via=workspace_created_via,
                source_entity_kind="task",
                module_id=source_module_id,
                topic_id=source_topic_id,
                task_id=source_task_id,
            ),
            prefer_existing_by_lineage=True,
        )

        module_result["source_module_id"] = source_module_id
        topic_result["source_module_id"] = source_module_id
        topic_result["source_topic_id"] = source_topic_id
        topic_result["source_topic_ref"] = f"{source_module_id}/{source_topic_id}"
        task_result["source_module_id"] = source_module_id
        task_result["source_topic_id"] = source_topic_id
        task_result["source_task_id"] = source_task_id
        task_result["source_task_ref"] = source_task_ref
        task_result["target_task_ref"] = (
            f"{task_result['module_id']}/{task_result['topic_id']}/{task_result['task_id']}"
        )
        return module_result, topic_result, task_result

    def _materialize_theory_link(
        self,
        source_theory_link: Any,
        *,
        source_catalog_item_id: str,
        source_catalog_version_id: str,
        source_catalog_visibility: Optional[str] = None,
        requested_by_user_id: Optional[str] = None,
        cached_theories: Dict[str, Dict[str, Any]],
        workspace_created_via: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        if not isinstance(source_theory_link, dict):
            return None

        source_theory_id = str(source_theory_link.get("theory_id") or "").strip()
        if not source_theory_id:
            return None

        if source_theory_id not in cached_theories:
            source_theory = self.source_theory_service.get_theory(source_theory_id, include_delta=True)
            theory_payload = copy.deepcopy(source_theory)
            theory_payload.update(
                self._build_workspace_copy_meta(
                    owner_user_id=requested_by_user_id,
                    source_catalog_item_id=source_catalog_item_id,
                    source_catalog_version_id=source_catalog_version_id,
                    source_catalog_visibility=source_catalog_visibility,
                    workspace_created_via=workspace_created_via,
                    source_entity_kind="theory",
                    source_entity_id=source_theory_id,
                )
            )
            theory_payload["created_via"] = str(workspace_created_via or "").strip() or "workspace_import"
            theory_payload["content_scope"] = "workspace_private"
            theory_result = self.theory_service.ensure_workspace_theory_copy(
                theory_payload,
                prefer_existing_by_lineage=True,
            )
            theory_result["source_theory_id"] = source_theory_id
            cached_theories[source_theory_id] = theory_result

        target_theory_id = cached_theories[source_theory_id].get("theory_id")
        if not target_theory_id:
            return None
        mapped_link = dict(source_theory_link)
        mapped_link["theory_id"] = target_theory_id
        return mapped_link

    def _remap_chains(
        self,
        raw_chains: Any,
        task_ref_map: Dict[str, str],
    ) -> List[List[str]]:
        if not isinstance(raw_chains, list):
            return []

        remapped: List[List[str]] = []
        for raw_chain in raw_chains:
            if not isinstance(raw_chain, list):
                continue
            remapped_chain: List[str] = []
            for raw_ref in raw_chain:
                source_ref = str(raw_ref or "").strip()
                if not source_ref:
                    continue
                if source_ref not in task_ref_map:
                    raise ValueError(f"complex_chain_ref_not_materialized:{source_ref}")
                remapped_chain.append(task_ref_map[source_ref])
            if remapped_chain:
                remapped.append(remapped_chain)
        return remapped

    def _remap_complex_settings(
        self,
        raw_settings: Any,
        task_ref_map: Dict[str, str],
    ) -> Dict[str, Any]:
        if hasattr(raw_settings, "dict"):
            raw_settings = raw_settings.dict()
        if not isinstance(raw_settings, dict):
            return {}

        remapped_settings = copy.deepcopy(raw_settings)
        raw_modes = remapped_settings.get("test_question_display_modes")
        remapped_modes: Dict[str, str] = {}

        if isinstance(raw_modes, dict):
            mode_items = raw_modes.items()
        elif isinstance(raw_modes, list):
            mode_items = [
                (
                    entry.get("task_ref") if isinstance(entry, dict) else getattr(entry, "task_ref", None),
                    entry.get("display_mode") if isinstance(entry, dict) else getattr(entry, "display_mode", None),
                )
                for entry in raw_modes
            ]
        else:
            mode_items = []

        for raw_task_ref, raw_mode in mode_items:
            source_task_ref = str(raw_task_ref or "").strip()
            target_task_ref = str(task_ref_map.get(source_task_ref) or "").strip()
            display_mode = str(raw_mode or "").strip().lower()
            if target_task_ref and display_mode in {"together", "scattered"}:
                remapped_modes[target_task_ref] = display_mode

        if "test_question_display_modes" in remapped_settings or remapped_modes:
            remapped_settings["test_question_display_modes"] = remapped_modes

        return remapped_settings

    def _build_reused_complex_result(self, existing_complex: Any) -> Dict[str, Any]:
        complex_item = existing_complex.dict() if hasattr(existing_complex, "dict") else dict(existing_complex or {})
        modules: Dict[str, Dict[str, Any]] = {}
        topics: Dict[str, Dict[str, Any]] = {}
        tasks: Dict[str, Dict[str, Any]] = {}
        theories: Dict[str, Dict[str, Any]] = {}
        task_ref_map: Dict[str, str] = {}

        for raw_task_ref in complex_item.get("tasks") or []:
            target_task_ref = str(raw_task_ref or "").strip()
            if not target_task_ref:
                continue
            module_id, topic_id, task_id = self._parse_task_ref(target_task_ref)
            module_item = self.storage_service.get_module(module_id)
            topic_item = self.storage_service.get_topic(module_id, topic_id)
            task_payload = self.storage_service.load_task(module_id, topic_id, task_id)

            if isinstance(module_item, dict):
                modules[module_id] = {
                    "created": False,
                    "reused": True,
                    "module_id": module_id,
                    "item": module_item,
                    "source_module_id": module_item.get("source_entity_id") or module_id,
                }

            if isinstance(topic_item, dict):
                source_topic_ref = str(topic_item.get("source_entity_id") or f"{module_id}/{topic_id}")
                topics[f"{module_id}/{topic_id}"] = {
                    "created": False,
                    "reused": True,
                    "module_id": module_id,
                    "topic_id": topic_id,
                    "item": topic_item,
                    "source_topic_ref": source_topic_ref,
                    "source_module_id": source_topic_ref.split("/")[0] if "/" in source_topic_ref else module_id,
                    "source_topic_id": source_topic_ref.split("/")[-1],
                }
                topic_theory_link = self.storage_service.get_topic_theory_link(module_id, topic_id)
                if isinstance(topic_theory_link, dict):
                    theory_id = str(topic_theory_link.get("theory_id") or "").strip()
                    if theory_id:
                        theory_item = self.theory_service.get_theory(theory_id, include_delta=False)
                        theories[theory_id] = {
                            "created": False,
                            "reused": True,
                            "theory_id": theory_id,
                            "item": theory_item,
                            "source_theory_id": theory_item.get("source_entity_id") or theory_id,
                        }

            if isinstance(task_payload, dict):
                metadata = task_payload.get("metadata") if isinstance(task_payload.get("metadata"), dict) else {}
                source_task_ref = str(metadata.get("source_entity_id") or target_task_ref)
                tasks[target_task_ref] = {
                    "created": False,
                    "reused": True,
                    "task_id": task_id,
                    "module_id": module_id,
                    "topic_id": topic_id,
                    "item": metadata or None,
                    "task": task_payload,
                    "source_task_ref": source_task_ref,
                    "target_task_ref": target_task_ref,
                    "source_module_id": source_task_ref.split("/")[0] if "/" in source_task_ref else module_id,
                    "source_topic_id": source_task_ref.split("/")[1] if source_task_ref.count("/") >= 2 else topic_id,
                    "source_task_id": source_task_ref.split("/")[-1],
                }
                task_ref_map[source_task_ref] = target_task_ref

        complex_theory_link = complex_item.get("theory_link") if isinstance(complex_item.get("theory_link"), dict) else None
        if isinstance(complex_theory_link, dict):
            theory_id = str(complex_theory_link.get("theory_id") or "").strip()
            if theory_id and theory_id not in theories:
                theory_item = self.theory_service.get_theory(theory_id, include_delta=False)
                theories[theory_id] = {
                    "created": False,
                    "reused": True,
                    "theory_id": theory_id,
                    "item": theory_item,
                    "source_theory_id": theory_item.get("source_entity_id") or theory_id,
                }

        return {
            "source_complex_id": complex_item.get("source_entity_id") or complex_item.get("id"),
            "complex": {
                "created": False,
                "reused": True,
                "complex_id": complex_item.get("id"),
                "item": existing_complex,
            },
            "modules": list(modules.values()),
            "topics": list(topics.values()),
            "tasks": list(tasks.values()),
            "theories": list(theories.values()),
            "task_ref_map": task_ref_map,
            "complex_theory_link": complex_theory_link,
            "created_counts": {
                "complexes": 0,
                "modules": 0,
                "topics": 0,
                "tasks": 0,
                "theories": 0,
            },
            "reused_counts": {
                "complexes": 1,
                "modules": len(modules),
                "topics": len(topics),
                "tasks": len(tasks),
                "theories": len(theories),
            },
        }
