from __future__ import annotations

import copy
import json
from datetime import datetime
from pathlib import Path
import secrets
from typing import Any, Dict, List, Optional
from uuid import uuid4

from werkzeug.utils import secure_filename

from services.workspace_limits_service import WorkspaceLimitError
from services.workspace_import_service import WorkspaceImportService


class _SnapshotComplexSourceService:
    def __init__(self, payload: Dict[str, Any]) -> None:
        self._payload = copy.deepcopy(payload if isinstance(payload, dict) else {})

    def get_complex(self, complex_id: str) -> Optional[Dict[str, Any]]:
        clean_complex_id = str(complex_id or "").strip()
        payload_id = str(self._payload.get("id") or "").strip()
        if clean_complex_id and payload_id == clean_complex_id:
            return copy.deepcopy(self._payload)
        return None


class _SnapshotStorageSourceService:
    def __init__(self, dependencies: Dict[str, Any]) -> None:
        payload = dependencies if isinstance(dependencies, dict) else {}
        self._modules = {
            str(key): copy.deepcopy(value)
            for key, value in (payload.get("modules") or {}).items()
            if isinstance(value, dict)
        }
        self._topics = {
            str(key): copy.deepcopy(value)
            for key, value in (payload.get("topics") or {}).items()
            if isinstance(value, dict)
        }
        self._tasks = {
            str(key): copy.deepcopy(value)
            for key, value in (payload.get("tasks") or {}).items()
            if isinstance(value, dict)
        }
        self._topic_theory_links = {
            str(key): copy.deepcopy(value)
            for key, value in (payload.get("topic_theory_links") or {}).items()
            if isinstance(value, dict)
        }

    def get_module(self, module_id: str) -> Optional[Dict[str, Any]]:
        clean_module_id = str(module_id or "").strip()
        payload = self._modules.get(clean_module_id)
        return copy.deepcopy(payload) if isinstance(payload, dict) else None

    def get_topic(self, module_id: str, topic_id: str) -> Optional[Dict[str, Any]]:
        topic_ref = f"{str(module_id or '').strip()}/{str(topic_id or '').strip()}"
        payload = self._topics.get(topic_ref)
        return copy.deepcopy(payload) if isinstance(payload, dict) else None

    def load_task(self, module_id: str, topic_id: str, task_id: str) -> Optional[Dict[str, Any]]:
        task_ref = f"{str(module_id or '').strip()}/{str(topic_id or '').strip()}/{str(task_id or '').strip()}"
        payload = self._tasks.get(task_ref)
        return copy.deepcopy(payload) if isinstance(payload, dict) else None

    def get_topic_theory_link(self, module_id: str, topic_id: str) -> Optional[Dict[str, Any]]:
        topic_ref = f"{str(module_id or '').strip()}/{str(topic_id or '').strip()}"
        payload = self._topic_theory_links.get(topic_ref)
        return copy.deepcopy(payload) if isinstance(payload, dict) else None


class _SnapshotTheorySourceService:
    def __init__(self, payload: Dict[str, Any]) -> None:
        theories = payload if isinstance(payload, dict) else {}
        self._theories = {
            str(key): copy.deepcopy(value)
            for key, value in theories.items()
            if isinstance(value, dict)
        }

    def get_theory(self, theory_id: str, include_delta: bool = True) -> Dict[str, Any]:
        clean_theory_id = str(theory_id or "").strip()
        payload = self._theories.get(clean_theory_id)
        if not isinstance(payload, dict):
            raise ValueError("theory_not_found")
        normalized = copy.deepcopy(payload)
        if not include_delta:
            normalized.pop("delta", None)
        return normalized


class CatalogService:
    """Filesystem-backed public catalog service.

    Hosted runtime overrides the storage layer with Postgres while keeping this
    service contract stable.
    """

    SERVICE_CONTRACT = {
        "namespace": "public_catalog",
        "catalog_public_api": True,
        "legacy_editor_import": False,
        "supports_publish": True,
        "supports_public_read": True,
        "supports_add_to_library": True,
        "supports_theory_linked_library": True,
        "supports_complex_linked_library": True,
    }
    _ACCESS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    _ACCESS_CODE_LENGTH = 16

    def __init__(
        self,
        *,
        data_dir: str,
        complex_service: Any,
        theory_service: Any,
        storage_service: Any,
    ) -> None:
        self.data_dir = Path(data_dir)
        self.catalog_dir = self.data_dir / "catalog"
        self.catalog_file = self.catalog_dir / "catalog.json"
        self.users_dir = self.data_dir / "users"
        self.catalog_dir.mkdir(parents=True, exist_ok=True)
        self.complex_service = complex_service
        self.theory_service = theory_service
        self.storage_service = storage_service
        self.workspace_limits_service = None
        self._owner_display_name_cache: Dict[str, str] = {}

    @property
    def hosted_storage_ready(self) -> bool:
        return True

    def list_items(
        self,
        *,
        query: Optional[str] = None,
        content_type: Optional[str] = None,
        owner_user_id: Optional[str] = None,
        include_owned_non_public: bool = False,
        requested_by_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        normalized_query = str(query or "").strip().lower()
        normalized_content_type = self._normalize_content_type(content_type, allow_empty=True)
        normalized_owner_user_id = self._normalize_optional_text(owner_user_id)
        requester = self._normalize_optional_text(requested_by_user_id)
        items: List[Dict[str, Any]] = []
        relationship_candidates: List[Dict[str, Any]] = []
        for payload in self._list_item_payloads():
            if not self._can_list_item(
                payload,
                requested_by_user_id=requester,
                owner_user_id=normalized_owner_user_id,
                include_owned_non_public=include_owned_non_public,
            ):
                continue
            relationship_candidates.append(payload)
            item = self._summarize_item_payload(
                payload,
                include_sensitive=self._should_include_sensitive_fields(payload, requested_by_user_id=requester),
            )
            if normalized_content_type and item.get("content_type") != normalized_content_type:
                continue
            if normalized_owner_user_id and item.get("owner_user_id") != normalized_owner_user_id:
                continue
            if normalized_query:
                haystack = " ".join(
                    [
                        str(item.get("title") or ""),
                        str(item.get("description") or ""),
                        str(item.get("item_id") or ""),
                        str(item.get("owner_user_id") or ""),
                    ]
                ).lower()
                if normalized_query not in haystack:
                    continue
            items.append(item)
        self._attach_catalog_relationships(
            items,
            candidate_payloads=relationship_candidates,
        )
        items.sort(
            key=lambda value: (
                str(value.get("latest_published_at") or ""),
                str(value.get("item_id") or ""),
            ),
            reverse=True,
        )
        return {
            "ok": True,
            "service_contract": dict(self.SERVICE_CONTRACT),
            "filters": {
                "query": normalized_query or None,
                "content_type": normalized_content_type,
                "owner_user_id": normalized_owner_user_id,
                "include_owned_non_public": bool(include_owned_non_public),
                "requested_by_user_id": requester,
            },
            "items": items,
            "count": len(items),
        }

    def _attach_catalog_relationships(
        self,
        items: List[Dict[str, Any]],
        *,
        candidate_payloads: List[Dict[str, Any]],
    ) -> None:
        item_by_id: Dict[str, Dict[str, Any]] = {}
        for item in items:
            item_id = self._normalize_optional_text(item.get("item_id"))
            if item_id:
                item_by_id[item_id] = item

        theory_payload_by_item_id: Dict[str, Dict[str, Any]] = {}
        theory_payload_by_source_id: Dict[str, Dict[str, Any]] = {}
        theory_payload_by_source_ref: Dict[str, Dict[str, Any]] = {}
        raw_complex_payloads: List[Dict[str, Any]] = []

        for payload in candidate_payloads:
            if not isinstance(payload, dict):
                continue
            content_type = str(payload.get("content_type") or "").strip().lower()
            if content_type == "theory":
                item_id = self._normalize_optional_text(payload.get("item_id"))
                source_id = self._normalize_optional_text(payload.get("source_workspace_id"))
                source_ref = self._normalize_optional_text(payload.get("source_workspace_ref"))
                if item_id:
                    theory_payload_by_item_id[item_id] = payload
                if source_id:
                    theory_payload_by_source_id[source_id] = payload
                if source_ref:
                    theory_payload_by_source_ref[source_ref] = payload
            elif content_type == "complex":
                raw_complex_payloads.append(payload)

        direct_pairs: List[tuple[Dict[str, Any], Dict[str, Any]]] = []
        theory_to_complexes: Dict[str, List[Dict[str, Any]]] = {}

        for complex_payload in raw_complex_payloads:
            resolved_theory_payload = self._resolve_direct_public_theory_payload_for_complex(
                complex_payload,
                theory_payload_by_item_id=theory_payload_by_item_id,
                theory_payload_by_source_id=theory_payload_by_source_id,
                theory_payload_by_source_ref=theory_payload_by_source_ref,
            )
            if not isinstance(resolved_theory_payload, dict):
                continue
            complex_item_id = self._normalize_optional_text(complex_payload.get("item_id"))
            theory_item_id = self._normalize_optional_text(resolved_theory_payload.get("item_id"))
            if not complex_item_id or not theory_item_id:
                continue
            direct_pairs.append((complex_payload, resolved_theory_payload))
            theory_to_complexes.setdefault(theory_item_id, []).append(complex_payload)

        for complex_payload, theory_payload in direct_pairs:
            complex_item_id = self._normalize_optional_text(complex_payload.get("item_id"))
            theory_item_id = self._normalize_optional_text(theory_payload.get("item_id"))
            if not complex_item_id or not theory_item_id:
                continue
            complex_item = item_by_id.get(complex_item_id)
            if isinstance(complex_item, dict):
                complex_item["linked_theory_item"] = self._summarize_related_catalog_item(theory_payload)
                if len(theory_to_complexes.get(theory_item_id) or []) == 1:
                    complex_item["bundle"] = {
                        "bundle_id": self._build_catalog_bundle_id(complex_item_id, theory_item_id),
                        "role": "complex",
                        "paired_item_id": theory_item_id,
                    }

        for theory_item_id, complex_payloads in theory_to_complexes.items():
            theory_item = item_by_id.get(theory_item_id)
            if not isinstance(theory_item, dict):
                continue
            sorted_complex_payloads = sorted(
                complex_payloads,
                key=lambda value: (
                    str(value.get("latest_published_at") or ""),
                    str(value.get("item_id") or ""),
                ),
                reverse=True,
            )
            theory_item["linked_complex_count"] = len(sorted_complex_payloads)
            theory_item["linked_complex_items"] = [
                self._summarize_related_catalog_item(payload)
                for payload in sorted_complex_payloads[:3]
            ]
            if len(sorted_complex_payloads) == 1:
                complex_item_id = self._normalize_optional_text(sorted_complex_payloads[0].get("item_id"))
                if complex_item_id:
                    theory_item["bundle"] = {
                        "bundle_id": self._build_catalog_bundle_id(complex_item_id, theory_item_id),
                        "role": "theory",
                        "paired_item_id": complex_item_id,
                    }

    def _resolve_direct_public_theory_payload_for_complex(
        self,
        complex_payload: Dict[str, Any],
        *,
        theory_payload_by_item_id: Dict[str, Dict[str, Any]],
        theory_payload_by_source_id: Dict[str, Dict[str, Any]],
        theory_payload_by_source_ref: Dict[str, Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        snapshot = self._get_latest_snapshot_payload(complex_payload)
        direct_theory_link = self._get_direct_complex_theory_link(snapshot)
        if not isinstance(direct_theory_link, dict):
            return None

        catalog_item_id = self._normalize_optional_text(direct_theory_link.get("catalog_item_id"))
        if catalog_item_id and isinstance(theory_payload_by_item_id.get(catalog_item_id), dict):
            return theory_payload_by_item_id[catalog_item_id]

        source_theory_id = self._normalize_optional_text(
            direct_theory_link.get("source_theory_id") or direct_theory_link.get("theory_id")
        )
        if source_theory_id:
            if isinstance(theory_payload_by_source_id.get(source_theory_id), dict):
                return theory_payload_by_source_id[source_theory_id]
            if isinstance(theory_payload_by_source_ref.get(source_theory_id), dict):
                return theory_payload_by_source_ref[source_theory_id]

        direct_theory_payload = self._extract_direct_complex_theory_payload(snapshot)
        if not isinstance(direct_theory_payload, dict):
            return None

        published_theory_payload = self._find_published_theory_item_for_snapshot(
            direct_theory_payload,
            preferred_owner_user_id=self._normalize_optional_text(complex_payload.get("owner_user_id")),
        )
        if not isinstance(published_theory_payload, dict):
            return None
        visibility = self._normalize_catalog_visibility(
            published_theory_payload.get("catalog_visibility"),
            allow_empty=True,
        ) or "public"
        if visibility != "public":
            return None
        return published_theory_payload

    def _get_latest_snapshot_payload(self, item_payload: Dict[str, Any]) -> Dict[str, Any]:
        latest_version_id = self._normalize_optional_text(item_payload.get("latest_version_id"))
        item_id = self._normalize_optional_text(item_payload.get("item_id"))
        if not latest_version_id or not item_id:
            return {}
        version_payload = self._get_version_payload(item_id, latest_version_id)
        if not isinstance(version_payload, dict):
            return {}
        snapshot_payload = version_payload.get("snapshot")
        return snapshot_payload if isinstance(snapshot_payload, dict) else {}

    def _get_direct_complex_theory_link(self, snapshot_payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        complex_payload = snapshot_payload.get("complex") if isinstance(snapshot_payload.get("complex"), dict) else {}
        theory_link = complex_payload.get("theory_link") if isinstance(complex_payload.get("theory_link"), dict) else None
        return dict(theory_link) if isinstance(theory_link, dict) else None

    def _extract_direct_complex_theory_payload(self, snapshot_payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        direct_theory_link = self._get_direct_complex_theory_link(snapshot_payload)
        if not isinstance(direct_theory_link, dict):
            return None
        dependencies_payload = (
            snapshot_payload.get("dependencies") if isinstance(snapshot_payload.get("dependencies"), dict) else {}
        )
        theories_payload = (
            dependencies_payload.get("theories") if isinstance(dependencies_payload.get("theories"), dict) else {}
        )
        direct_theory_id = self._normalize_optional_text(
            direct_theory_link.get("source_theory_id") or direct_theory_link.get("theory_id")
        )
        if direct_theory_id and isinstance(theories_payload.get(direct_theory_id), dict):
            theory_payload = copy.deepcopy(theories_payload[direct_theory_id])
            if not self._normalize_optional_text(theory_payload.get("id")):
                theory_payload["id"] = direct_theory_id
            return theory_payload
        linked_theory_payload = self._build_linked_library_theory_snapshot(direct_theory_link)
        if isinstance(linked_theory_payload, dict):
            return linked_theory_payload
        return None

    def _summarize_related_catalog_item(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        owner_user_id = payload.get("owner_user_id")
        return {
            "item_id": payload.get("item_id"),
            "content_type": payload.get("content_type"),
            "title": payload.get("title") or "",
            "owner_user_id": owner_user_id,
            "owner_display_name": self._resolve_owner_display_name(owner_user_id),
            "catalog_visibility": self._normalize_catalog_visibility(
                payload.get("catalog_visibility"),
                allow_empty=True,
            ) or "public",
            "latest_published_at": payload.get("latest_published_at"),
        }

    @staticmethod
    def _build_catalog_bundle_id(complex_item_id: str, theory_item_id: str) -> str:
        return f"bundle::{complex_item_id}::{theory_item_id}"

    def get_item(
        self,
        item_id: str,
        *,
        requested_by_user_id: Optional[str] = None,
        access_code: Optional[str] = None,
    ) -> Dict[str, Any]:
        clean_item_id = self._require_text(item_id, "item_id_required")
        item_payload = self._get_item_payload(clean_item_id)
        if not isinstance(item_payload, dict):
            raise ValueError("catalog_item_not_found")
        self._assert_item_access(item_payload, requested_by_user_id=requested_by_user_id, access_code=access_code)
        versions = [
            self._summarize_version_payload(
                item_payload,
                value,
                include_snapshot=False,
                include_sensitive=self._should_include_sensitive_fields(item_payload, requested_by_user_id=requested_by_user_id),
            )
            for value in self._list_version_payloads(clean_item_id)
        ]
        return {
            "ok": True,
            "service_contract": dict(self.SERVICE_CONTRACT),
            "item": self._summarize_item_payload(
                item_payload,
                include_sensitive=self._should_include_sensitive_fields(item_payload, requested_by_user_id=requested_by_user_id),
            ),
            "versions": versions,
            "count_versions": len(versions),
        }

    def get_version(
        self,
        item_id: str,
        version_id: str,
        *,
        requested_by_user_id: Optional[str] = None,
        access_code: Optional[str] = None,
    ) -> Dict[str, Any]:
        clean_item_id = self._require_text(item_id, "item_id_required")
        clean_version_id = self._require_text(version_id, "version_id_required")
        item_payload = self._get_item_payload(clean_item_id)
        if not isinstance(item_payload, dict):
            raise ValueError("catalog_item_not_found")
        self._assert_item_access(item_payload, requested_by_user_id=requested_by_user_id, access_code=access_code)
        version_payload = self._get_version_payload(clean_item_id, clean_version_id)
        if not isinstance(version_payload, dict):
            raise ValueError("catalog_version_not_found")
        return {
            "ok": True,
            "service_contract": dict(self.SERVICE_CONTRACT),
            "item": self._summarize_item_payload(
                item_payload,
                include_sensitive=self._should_include_sensitive_fields(item_payload, requested_by_user_id=requested_by_user_id),
            ),
            "version": self._normalize_version_payload(
                version_payload,
                include_snapshot=True,
                include_sensitive=self._should_include_sensitive_fields(item_payload, requested_by_user_id=requested_by_user_id),
            ),
        }

    def publish_complex(
        self,
        workspace_complex_id: str,
        *,
        requested_by_user_id: Optional[str],
        catalog_visibility: Optional[str] = None,
    ) -> Dict[str, Any]:
        clean_complex_id = self._require_text(workspace_complex_id, "workspace_complex_id_required")
        workspace_complex = self.complex_service.get_complex(clean_complex_id)
        if workspace_complex is None:
            raise ValueError("workspace_complex_not_found")
        complex_snapshot = self._json_safe(
            copy.deepcopy(workspace_complex.dict() if hasattr(workspace_complex, "dict") else dict(workspace_complex))
        )
        dependency_bundle = self._build_complex_dependency_bundle(complex_snapshot)
        snapshot = {
            "complex": complex_snapshot,
            "dependencies": dependency_bundle,
        }
        source = {
            "source_workspace_kind": "complex",
            "source_workspace_id": complex_snapshot.get("workspace_entity_id") or complex_snapshot.get("id") or clean_complex_id,
            "source_workspace_ref": complex_snapshot.get("workspace_entity_ref") or complex_snapshot.get("id") or clean_complex_id,
        }
        owner_user_id = self._resolve_publish_owner(complex_snapshot, requested_by_user_id=requested_by_user_id)
        title = str(complex_snapshot.get("name") or clean_complex_id)
        description = str(complex_snapshot.get("description") or "").strip()
        manifest = {
            "content_type": "complex",
            "task_count": len(complex_snapshot.get("tasks") or []),
            "chain_count": len(complex_snapshot.get("chains") or []),
            "has_theory_link": bool(complex_snapshot.get("theory_link")),
            "workspace_entity": complex_snapshot.get("workspace_entity"),
            "dependency_counts": {
                "modules": len(dependency_bundle.get("modules") or {}),
                "topics": len(dependency_bundle.get("topics") or {}),
                "tasks": len(dependency_bundle.get("tasks") or {}),
                "theories": len(dependency_bundle.get("theories") or {}),
            },
        }
        publish_result = self._publish_workspace_snapshot(
            content_type="complex",
            owner_user_id=owner_user_id,
            title=title,
            description=description,
            source=source,
            manifest=manifest,
            snapshot=snapshot,
            catalog_visibility=catalog_visibility,
        )
        self._sync_theory_visibility_for_complex_snapshot(
            snapshot,
            preferred_owner_user_id=owner_user_id,
        )
        return publish_result

    def publish_theory(
        self,
        theory_id: str,
        *,
        requested_by_user_id: Optional[str],
        catalog_visibility: Optional[str] = None,
    ) -> Dict[str, Any]:
        clean_theory_id = self._require_text(theory_id, "workspace_theory_id_required")
        theory = self.theory_service.get_theory(clean_theory_id, include_delta=True)
        if not isinstance(theory, dict):
            raise ValueError("workspace_theory_not_found")
        snapshot = self._json_safe(copy.deepcopy(theory))
        source = {
            "source_workspace_kind": "theory",
            "source_workspace_id": snapshot.get("workspace_entity_id") or snapshot.get("id") or clean_theory_id,
            "source_workspace_ref": snapshot.get("workspace_entity_ref") or snapshot.get("id") or clean_theory_id,
        }
        owner_user_id = self._resolve_publish_owner(snapshot, requested_by_user_id=requested_by_user_id)
        delta = snapshot.get("delta") if isinstance(snapshot.get("delta"), dict) else {}
        ops = delta.get("ops") if isinstance(delta, dict) else []
        manifest = {
            "content_type": "theory",
            "image_count": len(snapshot.get("images") or []),
            "ops_count": len(ops or []),
            "has_content": bool((snapshot.get("images") or []) or (ops or [])),
            "workspace_entity": snapshot.get("workspace_entity"),
        }
        return self._publish_workspace_snapshot(
            content_type="theory",
            owner_user_id=owner_user_id,
            title=str(snapshot.get("title") or clean_theory_id),
            description="",
            source=source,
            manifest=manifest,
            snapshot=snapshot,
            catalog_visibility=catalog_visibility,
        )

    def add_version_to_library(
        self,
        item_id: str,
        version_id: str,
        *,
        requested_by_user_id: Optional[str],
        prefer_existing_by_lineage: bool = True,
        access_code: Optional[str] = None,
    ) -> Dict[str, Any]:
        item_payload, version_payload = self._resolve_catalog_version_pair(
            item_id,
            version_id,
            requested_by_user_id=requested_by_user_id,
            access_code=access_code,
        )
        content_type = str(version_payload.get("content_type") or "").strip()
        if content_type == "theory":
            return self._add_theory_version_to_library(
                item_payload,
                version_payload,
                requested_by_user_id=requested_by_user_id,
                prefer_existing_by_lineage=prefer_existing_by_lineage,
            )
        if content_type == "complex":
            return self._add_complex_version_to_library(
                item_payload,
                version_payload,
                requested_by_user_id=requested_by_user_id,
                prefer_existing_by_lineage=prefer_existing_by_lineage,
            )
        raise ValueError("catalog_version_content_type_not_supported")

    def preview_add_version_to_library(
        self,
        item_id: str,
        version_id: str,
        *,
        requested_by_user_id: Optional[str],
        prefer_existing_by_lineage: bool = True,
        access_code: Optional[str] = None,
    ) -> Dict[str, Any]:
        item_payload, version_payload = self._resolve_catalog_version_pair(
            item_id,
            version_id,
            requested_by_user_id=requested_by_user_id,
            access_code=access_code,
        )
        content_type = str(version_payload.get("content_type") or "").strip()
        if content_type == "theory":
            result = self._preview_add_theory_version_to_library(
                item_payload,
                version_payload,
                requested_by_user_id=requested_by_user_id,
                prefer_existing_by_lineage=prefer_existing_by_lineage,
            )
        elif content_type == "complex":
            result = self._preview_add_complex_version_to_library(
                item_payload,
                version_payload,
                requested_by_user_id=requested_by_user_id,
                prefer_existing_by_lineage=prefer_existing_by_lineage,
            )
        else:
            raise ValueError("catalog_version_content_type_not_supported")
        result["preview_only"] = True
        return result

    def _evaluate_workspace_limits(
        self,
        *,
        requested_by_user_id: Optional[str],
        theory_slots: int = 0,
        complex_slots: int = 0,
    ) -> Optional[Dict[str, Any]]:
        service = getattr(self, "workspace_limits_service", None)
        if service is None:
            return None
        return service.evaluate_capacity(
            requested_by_user_id,
            requests=[
                {
                    "entity_kind": "theory",
                    "limit_kind": "library_total",
                    "slots": int(theory_slots or 0),
                },
                {
                    "entity_kind": "complex",
                    "limit_kind": "library_total",
                    "slots": int(complex_slots or 0),
                },
            ],
        )

    def _attach_workspace_limits(self, payload: Dict[str, Any], evaluation: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        if not isinstance(payload, dict) or not isinstance(evaluation, dict):
            return payload
        blocked = bool(evaluation.get("blocked"))
        payload["workspace_limits"] = evaluation
        library_status = payload.get("library_status") if isinstance(payload.get("library_status"), dict) else {}
        payload["library_status"] = {
            **library_status,
            "blocked": blocked,
            "workspace_limits": evaluation,
        }
        payload["blocked"] = blocked
        if blocked:
            errors = evaluation.get("errors") if isinstance(evaluation.get("errors"), list) else []
            if errors:
                first_error = errors[0] if isinstance(errors[0], dict) else {}
                payload["message"] = str(first_error.get("message") or payload.get("message") or "")
        return payload

    def _raise_for_workspace_limits(self, evaluation: Optional[Dict[str, Any]]) -> None:
        if not isinstance(evaluation, dict):
            return
        if bool(evaluation.get("blocked")):
            service = getattr(self, "workspace_limits_service", None)
            if service is not None and hasattr(service, "_raise_for_blocked_evaluation"):
                service._raise_for_blocked_evaluation(evaluation)

    def _preview_related_theory_library_entries_for_complex_snapshot(
        self,
        snapshot_payload: Any,
        *,
        requested_by_user_id: Optional[str],
        preferred_owner_user_id: Optional[str],
    ) -> List[Dict[str, Any]]:
        requester = self._normalize_optional_text(requested_by_user_id)
        if not requester:
            return []

        results: List[Dict[str, Any]] = []
        seen_item_ids = set()
        for theory_payload in self._iter_complex_snapshot_theory_payloads(snapshot_payload):
            published_item = self._find_published_theory_item_for_snapshot(
                theory_payload,
                preferred_owner_user_id=preferred_owner_user_id,
            )
            item_id = self._normalize_optional_text((published_item or {}).get("item_id"))
            if not item_id or item_id in seen_item_ids:
                continue
            seen_item_ids.add(item_id)
            existing_entry = self._get_theory_library_entry_by_user_item(requester, item_id)
            results.append(
                {
                    "item": self._summarize_item_payload(published_item),
                    "created": not isinstance(existing_entry, dict),
                    "reused": isinstance(existing_entry, dict),
                }
            )
        return results

    def add_item_to_library(
        self,
        item_id: str,
        *,
        requested_by_user_id: Optional[str],
        access_code: Optional[str] = None,
        auto_added_by_complex_library_entry_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        clean_item_id = self._require_text(item_id, "item_id_required")
        requester = self._require_text(requested_by_user_id, "requested_by_user_id_required")
        item_payload = self._get_item_payload(clean_item_id)
        if not isinstance(item_payload, dict):
            raise ValueError("catalog_item_not_found")
        content_type = str(item_payload.get("content_type") or "").strip()
        if content_type == "theory":
            self._assert_item_access(item_payload, requested_by_user_id=requester, access_code=access_code)
            existing_entry = self._get_theory_library_entry_by_user_item(requester, clean_item_id)
            limit_evaluation = self._evaluate_workspace_limits(
                requested_by_user_id=requester,
                theory_slots=0 if isinstance(existing_entry, dict) else 1,
            )
            self._raise_for_workspace_limits(limit_evaluation)
            auto_source_entry_id = self._normalize_optional_text(auto_added_by_complex_library_entry_id)
            entry_payload = copy.deepcopy(existing_entry) if isinstance(existing_entry, dict) else {
                "library_entry_id": self._build_theory_library_entry_id(clean_item_id),
                "user_id": requester,
                "catalog_item_id": clean_item_id,
                "pinned_version_id": None,
                "granted_access_code": None,
                "created_at": self._utcnow_iso(),
                "manually_added": auto_source_entry_id is None,
                "auto_added_by_complex_library_entry_ids": [],
            }
            entry_payload["updated_at"] = self._utcnow_iso()
            if access_code is not None:
                entry_payload["granted_access_code"] = self._normalize_access_code(access_code, allow_empty=True)
            linked_source_entry_ids = self._normalize_linked_theory_source_entry_ids(
                entry_payload.get("auto_added_by_complex_library_entry_ids")
            )
            if auto_source_entry_id:
                if auto_source_entry_id not in linked_source_entry_ids:
                    linked_source_entry_ids.append(auto_source_entry_id)
            else:
                entry_payload["manually_added"] = True
            entry_payload["auto_added_by_complex_library_entry_ids"] = linked_source_entry_ids
            entry_payload["manually_added"] = bool(entry_payload.get("manually_added"))

            resolved = self._resolve_theory_library_entry_payload(entry_payload, requested_by_user_id=requester)
            self._upsert_theory_library_entry_payload(resolved["entry_payload"])
            return {
                "ok": True,
                "add_to_library_kind": "catalog_theory_add_to_linked_library",
                "requested_by_user_id": requester,
                "service_contract": dict(self.SERVICE_CONTRACT),
                "item": self._summarize_item_payload(item_payload),
                "version": copy.deepcopy(resolved.get("version")),
                "library_entry": copy.deepcopy(resolved.get("library_entry")),
                "library_status": self._build_theory_linked_library_status(resolved["library_entry"]),
                "created": not isinstance(existing_entry, dict),
                "reused": isinstance(existing_entry, dict),
                "workspace_limits": limit_evaluation,
            }
        if content_type == "complex":
            self._assert_item_access(item_payload, requested_by_user_id=requester, access_code=access_code)
            existing_entry = self._get_complex_library_entry_by_user_item(requester, clean_item_id)
            entry_payload = copy.deepcopy(existing_entry) if isinstance(existing_entry, dict) else {
                "library_entry_id": self._build_complex_library_entry_id(clean_item_id),
                "user_id": requester,
                "catalog_item_id": clean_item_id,
                "pinned_version_id": None,
                "granted_access_code": None,
                "created_at": self._utcnow_iso(),
            }
            entry_payload["updated_at"] = self._utcnow_iso()
            if access_code is not None:
                entry_payload["granted_access_code"] = self._normalize_access_code(access_code, allow_empty=True)

            resolved = self._resolve_complex_library_entry_payload(entry_payload, requested_by_user_id=requester)
            related_theories_preview = self._preview_related_theory_library_entries_for_complex_snapshot(
                resolved.get("snapshot"),
                requested_by_user_id=requester,
                preferred_owner_user_id=self._normalize_optional_text(item_payload.get("owner_user_id")),
            )
            limit_evaluation = self._evaluate_workspace_limits(
                requested_by_user_id=requester,
                complex_slots=0 if isinstance(existing_entry, dict) else 1,
                theory_slots=sum(1 for row in related_theories_preview if bool(row.get("created"))),
            )
            self._raise_for_workspace_limits(limit_evaluation)
            self._upsert_complex_library_entry_payload(resolved["entry_payload"])
            related_theories = self._sync_theory_library_entries_for_complex_snapshot(
                resolved.get("snapshot"),
                requested_by_user_id=requester,
                preferred_owner_user_id=self._normalize_optional_text(item_payload.get("owner_user_id")),
                source_complex_library_entry_id=self._normalize_optional_text(
                    resolved["library_entry"].get("library_entry_id")
                ),
            )
            return {
                "ok": True,
                "add_to_library_kind": "catalog_complex_add_to_linked_library",
                "requested_by_user_id": requester,
                "service_contract": dict(self.SERVICE_CONTRACT),
                "item": self._summarize_item_payload(item_payload),
                "version": copy.deepcopy(resolved.get("version")),
                "library_entry": copy.deepcopy(resolved.get("library_entry")),
                "library_status": self._build_complex_linked_library_status(resolved["library_entry"]),
                "related_theory_library_entries": related_theories,
                "created": not isinstance(existing_entry, dict),
                "reused": isinstance(existing_entry, dict),
                "workspace_limits": limit_evaluation,
            }
        raise ValueError("catalog_item_content_type_not_supported")

    def get_version_library_status(
        self,
        item_id: str,
        version_id: str,
        *,
        requested_by_user_id: Optional[str],
        access_code: Optional[str] = None,
    ) -> Dict[str, Any]:
        preview = self.preview_add_version_to_library(
            item_id,
            version_id,
            requested_by_user_id=requested_by_user_id,
            prefer_existing_by_lineage=True,
            access_code=access_code,
        )
        status = preview.get("library_status") if isinstance(preview.get("library_status"), dict) else {}
        return {
            "ok": True,
            "status_kind": "catalog_version_library_status",
            "requested_by_user_id": self._require_text(requested_by_user_id, "requested_by_user_id_required"),
            "service_contract": dict(self.SERVICE_CONTRACT),
            "item": copy.deepcopy(preview.get("item")),
            "version": copy.deepcopy(preview.get("version")),
            "source": copy.deepcopy(preview.get("source")),
            "library_status": copy.deepcopy(status),
            "summary": copy.deepcopy(preview.get("summary")),
            "workspace": copy.deepcopy(preview.get("workspace")),
            "workspace_limits": copy.deepcopy(preview.get("workspace_limits")),
            "blocked": bool(preview.get("blocked")),
        }

    def get_item_library_status(
        self,
        item_id: str,
        *,
        requested_by_user_id: Optional[str],
    ) -> Dict[str, Any]:
        clean_item_id = self._require_text(item_id, "item_id_required")
        requester = self._require_text(requested_by_user_id, "requested_by_user_id_required")
        item_payload = self._get_item_payload(clean_item_id)
        if not isinstance(item_payload, dict):
            raise ValueError("catalog_item_not_found")
        content_type = str(item_payload.get("content_type") or "").strip()
        if content_type == "theory":
            entry_payload = self._get_theory_library_entry_by_user_item(requester, clean_item_id)
            resolved = (
                self._resolve_theory_library_entry_payload(entry_payload, requested_by_user_id=requester)
                if isinstance(entry_payload, dict)
                else None
            )
            if isinstance(resolved, dict):
                self._upsert_theory_library_entry_payload(resolved["entry_payload"])

            return {
                "ok": True,
                "status_kind": "catalog_item_library_status",
                "requested_by_user_id": requester,
                "service_contract": dict(self.SERVICE_CONTRACT),
                "item": self._summarize_item_payload(item_payload),
                "library_status": self._build_theory_linked_library_status(
                    resolved["library_entry"] if isinstance(resolved, dict) else None
                ),
                "library_entry": copy.deepcopy(resolved.get("library_entry")) if isinstance(resolved, dict) else None,
                "version": copy.deepcopy(resolved.get("version")) if isinstance(resolved, dict) else None,
            }
        if content_type == "complex":
            entry_payload = self._get_complex_library_entry_by_user_item(requester, clean_item_id)
            resolved = (
                self._resolve_complex_library_entry_payload(entry_payload, requested_by_user_id=requester)
                if isinstance(entry_payload, dict)
                else None
            )
            if isinstance(resolved, dict):
                self._upsert_complex_library_entry_payload(resolved["entry_payload"])

            return {
                "ok": True,
                "status_kind": "catalog_item_library_status",
                "requested_by_user_id": requester,
                "service_contract": dict(self.SERVICE_CONTRACT),
                "item": self._summarize_item_payload(item_payload),
                "library_status": self._build_complex_linked_library_status(
                    resolved["library_entry"] if isinstance(resolved, dict) else None
                ),
                "library_entry": copy.deepcopy(resolved.get("library_entry")) if isinstance(resolved, dict) else None,
                "version": copy.deepcopy(resolved.get("version")) if isinstance(resolved, dict) else None,
            }
        raise ValueError("catalog_item_content_type_not_supported")

    def list_complex_library_entries(
        self,
        *,
        requested_by_user_id: Optional[str],
    ) -> Dict[str, Any]:
        requester = self._require_text(requested_by_user_id, "requested_by_user_id_required")
        entries: List[Dict[str, Any]] = []
        for raw_entry in self._list_complex_library_entry_payloads_for_user(requester):
            resolved = self._resolve_complex_library_entry_payload(raw_entry, requested_by_user_id=requester)
            self._upsert_complex_library_entry_payload(resolved["entry_payload"])
            entries.append(
                {
                    "library_entry": copy.deepcopy(resolved["library_entry"]),
                    "item": copy.deepcopy(resolved.get("item")),
                    "version": copy.deepcopy(resolved.get("version")),
                    "snapshot": copy.deepcopy(resolved.get("snapshot")),
                }
            )
        entries.sort(
            key=lambda value: (
                str(((value.get("library_entry") or {}).get("updated_at")) or ""),
                str(((value.get("library_entry") or {}).get("library_entry_id")) or ""),
            ),
            reverse=True,
        )
        return {
            "ok": True,
            "list_kind": "complex_linked_library",
            "requested_by_user_id": requester,
            "service_contract": dict(self.SERVICE_CONTRACT),
            "entries": entries,
            "count": len(entries),
        }

    def get_complex_library_entry(
        self,
        library_entry_id: str,
        *,
        requested_by_user_id: Optional[str],
        access_code: Optional[str] = None,
    ) -> Dict[str, Any]:
        requester = self._require_text(requested_by_user_id, "requested_by_user_id_required")
        clean_entry_id = self._require_text(library_entry_id, "library_entry_id_required")
        entry_payload = self._get_complex_library_entry_payload(clean_entry_id)
        if not isinstance(entry_payload, dict):
            raise ValueError("complex_library_entry_not_found")
        if self._normalize_optional_text(entry_payload.get("user_id")) != requester:
            raise ValueError("complex_library_entry_forbidden")
        if access_code is not None:
            entry_payload["granted_access_code"] = self._normalize_access_code(access_code, allow_empty=True)
        resolved = self._resolve_complex_library_entry_payload(entry_payload, requested_by_user_id=requester)
        self._upsert_complex_library_entry_payload(resolved["entry_payload"])
        return {
            "ok": True,
            "detail_kind": "complex_linked_library_entry",
            "requested_by_user_id": requester,
            "service_contract": dict(self.SERVICE_CONTRACT),
            "library_entry": copy.deepcopy(resolved["library_entry"]),
            "item": copy.deepcopy(resolved.get("item")),
            "version": copy.deepcopy(resolved.get("version")),
            "snapshot": copy.deepcopy(resolved.get("snapshot")),
        }

    def submit_complex_library_access_code(
        self,
        library_entry_id: str,
        *,
        requested_by_user_id: Optional[str],
        access_code: Optional[str],
    ) -> Dict[str, Any]:
        normalized_code = self._normalize_access_code(access_code, allow_empty=False)
        return self.get_complex_library_entry(
            library_entry_id,
            requested_by_user_id=requested_by_user_id,
            access_code=normalized_code,
        )

    def remove_complex_library_entry(
        self,
        library_entry_id: str,
        *,
        requested_by_user_id: Optional[str],
    ) -> Dict[str, Any]:
        requester = self._require_text(requested_by_user_id, "requested_by_user_id_required")
        clean_entry_id = self._require_text(library_entry_id, "library_entry_id_required")
        entry_payload = self._get_complex_library_entry_payload(clean_entry_id)
        if not isinstance(entry_payload, dict):
            raise ValueError("complex_library_entry_not_found")
        if self._normalize_optional_text(entry_payload.get("user_id")) != requester:
            raise ValueError("complex_library_entry_forbidden")
        resolved = self._resolve_complex_library_entry_payload(entry_payload, requested_by_user_id=requester)
        cascade_result = self._detach_theory_library_entries_for_removed_complex_snapshot(
            resolved.get("snapshot"),
            requested_by_user_id=requester,
            source_complex_library_entry_id=clean_entry_id,
            preferred_owner_user_id=self._normalize_optional_text((resolved.get("item") or {}).get("owner_user_id")),
        )
        self._delete_complex_library_entry_payload(clean_entry_id)
        return {
            "ok": True,
            "remove_kind": "complex_linked_library_entry_removed",
            "requested_by_user_id": requester,
            "service_contract": dict(self.SERVICE_CONTRACT),
            "library_entry_id": clean_entry_id,
            "catalog_item_id": entry_payload.get("catalog_item_id"),
            "removed": True,
            "related_theory_entries_removed": copy.deepcopy(cascade_result.get("removed") or []),
            "related_theory_entries_retained": copy.deepcopy(cascade_result.get("retained") or []),
        }

    def list_theory_library_entries(
        self,
        *,
        requested_by_user_id: Optional[str],
    ) -> Dict[str, Any]:
        requester = self._require_text(requested_by_user_id, "requested_by_user_id_required")
        entries: List[Dict[str, Any]] = []
        for raw_entry in self._list_theory_library_entry_payloads_for_user(requester):
            resolved = self._resolve_theory_library_entry_payload(raw_entry, requested_by_user_id=requester)
            self._upsert_theory_library_entry_payload(resolved["entry_payload"])
            entries.append(
                {
                    "library_entry": copy.deepcopy(resolved["library_entry"]),
                    "item": copy.deepcopy(resolved.get("item")),
                    "version": copy.deepcopy(resolved.get("version")),
                }
            )
        entries.sort(
            key=lambda value: (
                str(((value.get("library_entry") or {}).get("updated_at")) or ""),
                str(((value.get("library_entry") or {}).get("library_entry_id")) or ""),
            ),
            reverse=True,
        )
        return {
            "ok": True,
            "list_kind": "theory_linked_library",
            "requested_by_user_id": requester,
            "service_contract": dict(self.SERVICE_CONTRACT),
            "entries": entries,
            "count": len(entries),
        }

    def get_theory_library_entry(
        self,
        library_entry_id: str,
        *,
        requested_by_user_id: Optional[str],
        access_code: Optional[str] = None,
    ) -> Dict[str, Any]:
        requester = self._require_text(requested_by_user_id, "requested_by_user_id_required")
        clean_entry_id = self._require_text(library_entry_id, "library_entry_id_required")
        entry_payload = self._get_theory_library_entry_payload(clean_entry_id)
        if not isinstance(entry_payload, dict):
            raise ValueError("theory_library_entry_not_found")
        if self._normalize_optional_text(entry_payload.get("user_id")) != requester:
            raise ValueError("theory_library_entry_forbidden")
        if access_code is not None:
            entry_payload["granted_access_code"] = self._normalize_access_code(access_code, allow_empty=True)
        resolved = self._resolve_theory_library_entry_payload(entry_payload, requested_by_user_id=requester)
        self._upsert_theory_library_entry_payload(resolved["entry_payload"])
        return {
            "ok": True,
            "detail_kind": "theory_linked_library_entry",
            "requested_by_user_id": requester,
            "service_contract": dict(self.SERVICE_CONTRACT),
            "library_entry": copy.deepcopy(resolved["library_entry"]),
            "item": copy.deepcopy(resolved.get("item")),
            "version": copy.deepcopy(resolved.get("version")),
            "snapshot": copy.deepcopy(resolved.get("snapshot")),
        }

    def submit_theory_library_access_code(
        self,
        library_entry_id: str,
        *,
        requested_by_user_id: Optional[str],
        access_code: Optional[str],
    ) -> Dict[str, Any]:
        normalized_code = self._normalize_access_code(access_code, allow_empty=False)
        return self.get_theory_library_entry(
            library_entry_id,
            requested_by_user_id=requested_by_user_id,
            access_code=normalized_code,
        )

    def remove_theory_library_entry(
        self,
        library_entry_id: str,
        *,
        requested_by_user_id: Optional[str],
    ) -> Dict[str, Any]:
        requester = self._require_text(requested_by_user_id, "requested_by_user_id_required")
        clean_entry_id = self._require_text(library_entry_id, "library_entry_id_required")
        entry_payload = self._get_theory_library_entry_payload(clean_entry_id)
        if not isinstance(entry_payload, dict):
            raise ValueError("theory_library_entry_not_found")
        if self._normalize_optional_text(entry_payload.get("user_id")) != requester:
            raise ValueError("theory_library_entry_forbidden")
        self._delete_theory_library_entry_payload(clean_entry_id)
        return {
            "ok": True,
            "remove_kind": "theory_linked_library_entry_removed",
            "requested_by_user_id": requester,
            "service_contract": dict(self.SERVICE_CONTRACT),
            "library_entry_id": clean_entry_id,
            "catalog_item_id": entry_payload.get("catalog_item_id"),
            "removed": True,
        }

    def set_item_visibility(
        self,
        item_id: str,
        *,
        catalog_visibility: Optional[str],
        requested_by_user_id: Optional[str],
    ) -> Dict[str, Any]:
        clean_item_id = self._require_text(item_id, "item_id_required")
        requester = self._require_text(requested_by_user_id, "requested_by_user_id_required")
        item_payload = self._get_item_payload(clean_item_id)
        if not isinstance(item_payload, dict):
            raise ValueError("catalog_item_not_found")
        if self._is_item_deleted_source(item_payload):
            raise ValueError("catalog_item_source_deleted")
        owner_user_id = self._require_text(item_payload.get("owner_user_id"), "catalog_item_owner_required")
        if owner_user_id != requester:
            raise ValueError("catalog_item_visibility_update_forbidden")
        next_visibility = self._normalize_catalog_visibility(catalog_visibility)
        content_type = str(item_payload.get("content_type") or "").strip().lower()
        if content_type == "theory":
            self._assert_theory_visibility_change_allowed(
                source_workspace_id=item_payload.get("source_workspace_id"),
                source_workspace_ref=item_payload.get("source_workspace_ref"),
                requested_visibility=next_visibility,
            )
        updated_item = dict(item_payload)
        updated_item["catalog_visibility"] = next_visibility
        updated_item["updated_at"] = self._utcnow_iso()
        access_code = self._normalize_optional_text(updated_item.get("access_code"))
        if next_visibility == "access_code":
            if self._should_rotate_access_code(access_code):
                access_code = self._generate_access_code()
            updated_item["access_code"] = access_code
        else:
            updated_item.pop("access_code", None)
        self._upsert_item_payload(updated_item)
        if content_type == "complex":
            latest_version_id = self._normalize_optional_text(updated_item.get("latest_version_id"))
            version_payload = self._get_version_payload(clean_item_id, latest_version_id) if latest_version_id else None
            snapshot_payload = version_payload.get("snapshot") if isinstance(version_payload, dict) else {}
            self._sync_theory_visibility_for_complex_snapshot(
                snapshot_payload,
                preferred_owner_user_id=owner_user_id,
            )
        return {
            "ok": True,
            "visibility_update_kind": "catalog_item_visibility_update",
            "requested_by_user_id": requester,
            "service_contract": dict(self.SERVICE_CONTRACT),
            "item": self._summarize_item_payload(updated_item, include_sensitive=True),
        }

    def handle_workspace_source_deleted(
        self,
        content_type: str,
        *,
        owner_user_id: Optional[str],
        source_workspace_id: Optional[str] = None,
        source_workspace_ref: Optional[str] = None,
        source_workspace_kind: Optional[str] = None,
        reason: str = "workspace_source_deleted",
    ) -> Dict[str, Any]:
        normalized_content_type = self._normalize_content_type(content_type)
        owner = self._require_text(owner_user_id, "catalog_item_owner_required")
        source_id = self._normalize_optional_text(source_workspace_id)
        source_ref = self._normalize_optional_text(source_workspace_ref)
        source_kind = self._normalize_optional_text(source_workspace_kind) or normalized_content_type
        if not source_id and not source_ref:
            raise ValueError("source_workspace_id_required")

        candidate_keys = set()
        if source_id and source_ref:
            candidate_keys.add(
                self._build_source_workspace_key(
                    owner_user_id=owner,
                    content_type=normalized_content_type,
                    source_workspace_kind=source_kind,
                    source_workspace_id=source_id,
                    source_workspace_ref=source_ref,
                )
            )

        matched_items: List[Dict[str, Any]] = []
        for item_payload in self._list_item_payloads():
            if not isinstance(item_payload, dict):
                continue
            if str(item_payload.get("content_type") or "").strip().lower() != normalized_content_type:
                continue
            if self._normalize_optional_text(item_payload.get("owner_user_id")) != owner:
                continue
            item_key = self._normalize_optional_text(item_payload.get("source_workspace_key"))
            item_source_id = self._normalize_optional_text(item_payload.get("source_workspace_id"))
            item_source_ref = self._normalize_optional_text(item_payload.get("source_workspace_ref"))
            key_match = bool(item_key and item_key in candidate_keys)
            id_match = bool(source_id and source_id in {item_source_id, item_source_ref})
            ref_match = bool(source_ref and source_ref in {item_source_id, item_source_ref})
            if key_match or id_match or ref_match:
                matched_items.append(item_payload)

        deleted_at = self._utcnow_iso()
        affected_items: List[Dict[str, Any]] = []
        affected_library_entries: List[Dict[str, Any]] = []
        for item_payload in matched_items:
            updated_item = dict(item_payload)
            updated_item["status"] = "deleted_source"
            updated_item["catalog_visibility"] = "private"
            updated_item["source_deleted_at"] = deleted_at
            updated_item["source_deleted_reason"] = str(reason or "workspace_source_deleted")
            updated_item["updated_at"] = deleted_at
            updated_item.pop("access_code", None)
            self._upsert_item_payload(updated_item)
            affected_items.append(self._summarize_item_payload(updated_item, include_sensitive=True))
            for entry_payload in self._list_complex_library_entry_payloads_for_item(
                self._normalize_optional_text(updated_item.get("item_id"))
            ):
                updated_entry = dict(entry_payload)
                updated_entry["access_state"] = "deleted_source"
                updated_entry["access_reason"] = "Source complex was deleted by the author."
                updated_entry["resolved_version_id"] = None
                updated_entry["updated_at"] = deleted_at
                self._upsert_complex_library_entry_payload(updated_entry)
                affected_library_entries.append(
                    {
                        "library_entry_id": updated_entry.get("library_entry_id"),
                        "user_id": updated_entry.get("user_id"),
                        "catalog_item_id": updated_entry.get("catalog_item_id"),
                        "access_state": updated_entry.get("access_state"),
                        "access_reason": updated_entry.get("access_reason"),
                    }
                )

        return {
            "ok": True,
            "delete_source_kind": "catalog_workspace_source_deleted",
            "content_type": normalized_content_type,
            "owner_user_id": owner,
            "source_workspace_id": source_id,
            "source_workspace_ref": source_ref,
            "affected_count": len(affected_items),
            "items": affected_items,
            "affected_library_entries": affected_library_entries,
            "affected_library_entry_count": len(affected_library_entries),
        }

    def resolve_access_code(
        self,
        access_code: str,
        *,
        requested_by_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        clean_code = self._normalize_access_code(access_code)
        item_payload = self._get_item_by_access_code(clean_code)
        if not isinstance(item_payload, dict):
            raise ValueError("catalog_access_code_not_found")
        self._assert_item_access(item_payload, requested_by_user_id=requested_by_user_id, access_code=clean_code)
        latest_version_id = self._require_text(item_payload.get("latest_version_id"), "catalog_item_latest_version_required")
        version_payload = self._get_version_payload(str(item_payload.get("item_id") or ""), latest_version_id)
        if not isinstance(version_payload, dict):
            raise ValueError("catalog_version_not_found")
        return {
            "ok": True,
            "resolve_kind": "catalog_access_code_resolve",
            "service_contract": dict(self.SERVICE_CONTRACT),
            "item": self._summarize_item_payload(
                item_payload,
                include_sensitive=self._should_include_sensitive_fields(item_payload, requested_by_user_id=requested_by_user_id),
            ),
            "version": self._summarize_version_payload(
                item_payload,
                version_payload,
                include_snapshot=False,
                include_sensitive=self._should_include_sensitive_fields(item_payload, requested_by_user_id=requested_by_user_id),
            ),
        }

    def _publish_workspace_snapshot(
        self,
        *,
        content_type: str,
        owner_user_id: str,
        title: str,
        description: str,
        source: Dict[str, Any],
        manifest: Dict[str, Any],
        snapshot: Dict[str, Any],
        catalog_visibility: Optional[str] = None,
    ) -> Dict[str, Any]:
        normalized_content_type = self._normalize_content_type(content_type)
        published_at = self._utcnow_iso()
        source_workspace_kind = self._require_text(source.get("source_workspace_kind"), "source_workspace_kind_required")
        source_workspace_id = self._require_text(source.get("source_workspace_id"), "source_workspace_id_required")
        source_workspace_ref = self._require_text(source.get("source_workspace_ref"), "source_workspace_ref_required")
        source_workspace_key = self._build_source_workspace_key(
            owner_user_id=owner_user_id,
            content_type=normalized_content_type,
            source_workspace_kind=source_workspace_kind,
            source_workspace_id=source_workspace_id,
            source_workspace_ref=source_workspace_ref,
        )
        existing_item = self._get_item_by_source_workspace_key(source_workspace_key)
        item_id = str(existing_item.get("item_id") or "") if isinstance(existing_item, dict) else ""
        if not item_id:
            item_id = self._build_catalog_item_id(normalized_content_type, source_workspace_id)
        previous_versions_count = int(existing_item.get("versions_count") or 0) if isinstance(existing_item, dict) else 0
        next_visibility = self._resolve_catalog_visibility_for_publish(
            existing_item,
            requested_visibility=catalog_visibility,
        )
        if normalized_content_type == "theory":
            self._assert_theory_visibility_change_allowed(
                source_workspace_id=source_workspace_id,
                source_workspace_ref=source_workspace_ref,
                requested_visibility=next_visibility,
            )
        access_code = self._resolve_access_code_for_publish(
            existing_item,
            catalog_visibility=next_visibility,
        )
        version_id = self._build_catalog_version_id(item_id)
        version_payload = {
            "version_id": version_id,
            "item_id": item_id,
            "content_type": normalized_content_type,
            "owner_user_id": owner_user_id,
            "published_at": published_at,
            "manifest": self._json_safe(manifest),
            "snapshot": self._json_safe(snapshot),
        }
        item_payload = {
            "item_id": item_id,
            "content_type": normalized_content_type,
            "owner_user_id": owner_user_id,
            "title": str(title or "").strip() or item_id,
            "description": str(description or "").strip(),
            "status": "published",
            "catalog_visibility": next_visibility,
            "source_workspace_kind": source_workspace_kind,
            "source_workspace_id": source_workspace_id,
            "source_workspace_ref": source_workspace_ref,
            "source_workspace_key": source_workspace_key,
            "latest_version_id": version_id,
            "latest_published_at": published_at,
            "versions_count": previous_versions_count + 1,
            "created_at": existing_item.get("created_at") if isinstance(existing_item, dict) else published_at,
            "updated_at": published_at,
            "latest_manifest": self._json_safe(manifest),
        }
        if access_code:
            item_payload["access_code"] = access_code
        self._persist_publish_records(item_payload, version_payload)
        return {
            "ok": True,
            "publish_kind": f"{normalized_content_type}_publish",
            "published_at": published_at,
            "requested_by_user_id": owner_user_id,
            "service_contract": dict(self.SERVICE_CONTRACT),
            "item": self._summarize_item_payload(item_payload, include_sensitive=True),
            "version": self._summarize_version_payload(item_payload, version_payload, include_snapshot=False, include_sensitive=True),
        }

    def _persist_publish_records(self, item_payload: Dict[str, Any], version_payload: Dict[str, Any]) -> None:
        self._upsert_item_payload(item_payload)
        self._append_version_payload(version_payload)

    def _resolve_catalog_version_pair(
        self,
        item_id: str,
        version_id: str,
        *,
        requested_by_user_id: Optional[str],
        access_code: Optional[str] = None,
    ) -> Any:
        clean_item_id = self._require_text(item_id, "item_id_required")
        clean_version_id = self._require_text(version_id, "version_id_required")
        item_payload = self._get_item_payload(clean_item_id)
        if not isinstance(item_payload, dict):
            raise ValueError("catalog_item_not_found")
        self._assert_item_access(item_payload, requested_by_user_id=requested_by_user_id, access_code=access_code)
        version_payload = self._get_version_payload(clean_item_id, clean_version_id)
        if not isinstance(version_payload, dict):
            raise ValueError("catalog_version_not_found")
        return item_payload, version_payload

    def _add_theory_version_to_library(
        self,
        item_payload: Dict[str, Any],
        version_payload: Dict[str, Any],
        *,
        requested_by_user_id: Optional[str],
        prefer_existing_by_lineage: bool,
    ) -> Dict[str, Any]:
        requester = self._require_text(requested_by_user_id, "requested_by_user_id_required")
        snapshot = version_payload.get("snapshot") if isinstance(version_payload.get("snapshot"), dict) else {}
        source_theory_id = str(
            snapshot.get("workspace_entity_id")
            or snapshot.get("id")
            or item_payload.get("source_workspace_id")
            or ""
        ).strip()
        if not source_theory_id:
            raise ValueError("catalog_theory_snapshot_invalid")
        theory_payload = copy.deepcopy(snapshot)
        theory_payload["source_catalog_item_id"] = item_payload.get("item_id")
        theory_payload["source_catalog_version_id"] = version_payload.get("version_id")
        theory_payload["source_entity_kind"] = "theory"
        theory_payload["source_entity_id"] = source_theory_id
        theory_payload["created_by_user_id"] = requester
        theory_payload["updated_by_user_id"] = requester
        theory_payload["created_via"] = "workspace_import"
        theory_payload["content_scope"] = "workspace_private"
        existing = None
        if prefer_existing_by_lineage and hasattr(self.theory_service, "find_theory_by_source_lineage"):
            existing = self.theory_service.find_theory_by_source_lineage(
                source_catalog_item_id=item_payload.get("item_id"),
                source_catalog_version_id=version_payload.get("version_id"),
                source_entity_kind="theory",
                source_entity_id=source_theory_id,
            )
        limit_evaluation = self._evaluate_workspace_limits(
            requested_by_user_id=requester,
            theory_slots=0 if isinstance(existing, dict) else 1,
        )
        self._raise_for_workspace_limits(limit_evaluation)

        result = self.theory_service.ensure_workspace_theory_copy(
            theory_payload,
            prefer_existing_by_lineage=prefer_existing_by_lineage,
        )
        item = result.get("item") if isinstance(result.get("item"), dict) else {}
        payload = {
            "ok": True,
            "add_to_library_kind": "catalog_theory_add_to_library",
            "requested_by_user_id": requester,
            "service_contract": dict(self.SERVICE_CONTRACT),
            "item": self._summarize_item_payload(item_payload),
            "version": self._summarize_version_payload(item_payload, version_payload, include_snapshot=False),
            "source": {
                "catalog_item_id": item_payload.get("item_id"),
                "catalog_version_id": version_payload.get("version_id"),
                "source_entity_kind": "theory",
                "source_entity_id": source_theory_id,
            },
            "summary": {
                "created_counts": {
                    "complexes": 0,
                    "modules": 0,
                    "topics": 0,
                    "tasks": 0,
                    "theories": 1 if result.get("created") else 0,
                },
                "reused_counts": {
                    "complexes": 0,
                    "modules": 0,
                    "topics": 0,
                    "tasks": 0,
                    "theories": 1 if result.get("reused") else 0,
                },
                "total_nodes": {
                    "complexes": 0,
                    "modules": 0,
                    "topics": 0,
                    "tasks": 0,
                    "theories": 1,
                },
            },
            "workspace": {
                "complex_id": None,
                "complex_ref": None,
                "module_ids": [],
                "topic_refs": [],
                "task_refs": [],
                "theory_ids": [item.get("id")] if item.get("id") else [],
            },
            "result": {
                "complex": None,
                "modules": [],
                "topics": [],
                "tasks": [],
                "theories": [
                    {
                        "created": bool(result.get("created")),
                        "reused": bool(result.get("reused")),
                        "theory_id": result.get("theory_id"),
                        "item": copy.deepcopy(item),
                    }
                ],
                "task_ref_map": {},
                "complex_theory_link": None,
            },
        }
        payload["workspace_limits"] = limit_evaluation
        return payload

    def _preview_add_theory_version_to_library(
        self,
        item_payload: Dict[str, Any],
        version_payload: Dict[str, Any],
        *,
        requested_by_user_id: Optional[str],
        prefer_existing_by_lineage: bool,
    ) -> Dict[str, Any]:
        requester = self._require_text(requested_by_user_id, "requested_by_user_id_required")
        snapshot = version_payload.get("snapshot") if isinstance(version_payload.get("snapshot"), dict) else {}
        source_theory_id = str(
            snapshot.get("workspace_entity_id")
            or snapshot.get("id")
            or item_payload.get("source_workspace_id")
            or ""
        ).strip()
        if not source_theory_id:
            raise ValueError("catalog_theory_snapshot_invalid")

        existing = None
        if prefer_existing_by_lineage and hasattr(self.theory_service, "find_theory_by_source_lineage"):
            existing = self.theory_service.find_theory_by_source_lineage(
                source_catalog_item_id=item_payload.get("item_id"),
                source_catalog_version_id=version_payload.get("version_id"),
                source_entity_kind="theory",
                source_entity_id=source_theory_id,
            )

        existing_item = copy.deepcopy(existing) if isinstance(existing, dict) else None
        already_in_library = bool(existing_item)
        payload = {
            "ok": True,
            "preview_kind": "catalog_theory_add_to_library_preview",
            "requested_by_user_id": requester,
            "service_contract": dict(self.SERVICE_CONTRACT),
            "item": self._summarize_item_payload(item_payload),
            "version": self._summarize_version_payload(item_payload, version_payload, include_snapshot=False),
            "source": {
                "catalog_item_id": item_payload.get("item_id"),
                "catalog_version_id": version_payload.get("version_id"),
                "source_entity_kind": "theory",
                "source_entity_id": source_theory_id,
            },
            "library_status": {
                "already_in_library": already_in_library,
                "action": "open_existing" if already_in_library else "create_copy",
                "content_type": "theory",
                "library_entity_ref": existing_item.get("workspace_entity_ref") if existing_item else None,
                "library_entity_id": existing_item.get("id") if existing_item else None,
            },
            "summary": {
                "created_counts": {
                    "complexes": 0,
                    "modules": 0,
                    "topics": 0,
                    "tasks": 0,
                    "theories": 0 if already_in_library else 1,
                },
                "reused_counts": {
                    "complexes": 0,
                    "modules": 0,
                    "topics": 0,
                    "tasks": 0,
                    "theories": 1 if already_in_library else 0,
                },
                "total_nodes": {
                    "complexes": 0,
                    "modules": 0,
                    "topics": 0,
                    "tasks": 0,
                    "theories": 1,
                },
            },
            "workspace": {
                "complex_id": None,
                "complex_ref": None,
                "module_ids": [],
                "topic_refs": [],
                "task_refs": [],
                "theory_ids": [existing_item.get("id")] if existing_item and existing_item.get("id") else [],
            },
            "result": {
                "complex": None,
                "modules": [],
                "topics": [],
                "tasks": [],
                "theories": [
                    {
                        "created": not already_in_library,
                        "reused": already_in_library,
                        "theory_id": existing_item.get("id") if existing_item else None,
                        "item": existing_item,
                        "planned_action": "reuse_existing" if already_in_library else "create_copy",
                    }
                ],
                "task_ref_map": {},
                "complex_theory_link": None,
            },
        }
        limit_evaluation = self._evaluate_workspace_limits(
            requested_by_user_id=requester,
            theory_slots=0 if already_in_library else 1,
        )
        return self._attach_workspace_limits(payload, limit_evaluation)

    def _add_complex_version_to_library(
        self,
        item_payload: Dict[str, Any],
        version_payload: Dict[str, Any],
        *,
        requested_by_user_id: Optional[str],
        prefer_existing_by_lineage: bool,
    ) -> Dict[str, Any]:
        requester = self._require_text(requested_by_user_id, "requested_by_user_id_required")
        snapshot_import_service, source_complex_id = self._build_snapshot_import_service(
            item_payload,
            version_payload,
        )
        preview_payload = snapshot_import_service.preview_complex_copy_by_source_complex_id(
            source_complex_id,
            source_catalog_item_id=str(item_payload.get("item_id") or ""),
            source_catalog_version_id=str(version_payload.get("version_id") or ""),
            source_catalog_visibility=str(item_payload.get("catalog_visibility") or ""),
            requested_by_user_id=requester,
            prefer_existing_by_lineage=prefer_existing_by_lineage,
        )
        limit_evaluation = self._evaluate_workspace_limits(
            requested_by_user_id=requester,
            theory_slots=int(((preview_payload.get("summary") or {}).get("created_counts") or {}).get("theories") or 0),
            complex_slots=int(((preview_payload.get("summary") or {}).get("created_counts") or {}).get("complexes") or 0),
        )
        self._raise_for_workspace_limits(limit_evaluation)
        result = snapshot_import_service.import_complex_copy_by_source_complex_id(
            source_complex_id,
            source_catalog_item_id=str(item_payload.get("item_id") or ""),
            source_catalog_version_id=str(version_payload.get("version_id") or ""),
            source_catalog_visibility=str(item_payload.get("catalog_visibility") or ""),
            requested_by_user_id=requester,
            prefer_existing_by_lineage=prefer_existing_by_lineage,
        )
        import_service_contract = dict(result.get("service_contract") or {})
        result["service_contract"] = dict(self.SERVICE_CONTRACT)
        result["import_service_contract"] = import_service_contract
        result["add_to_library_kind"] = "catalog_complex_add_to_library"
        result["item"] = self._summarize_item_payload(item_payload)
        result["version"] = self._summarize_version_payload(item_payload, version_payload, include_snapshot=False)
        result["library_status"] = self._build_library_status_from_import_result(result, content_type="complex")
        result["workspace_limits"] = limit_evaluation
        return result

    def _preview_add_complex_version_to_library(
        self,
        item_payload: Dict[str, Any],
        version_payload: Dict[str, Any],
        *,
        requested_by_user_id: Optional[str],
        prefer_existing_by_lineage: bool,
    ) -> Dict[str, Any]:
        requester = self._require_text(requested_by_user_id, "requested_by_user_id_required")
        snapshot_import_service, source_complex_id = self._build_snapshot_import_service(
            item_payload,
            version_payload,
        )
        result = snapshot_import_service.preview_complex_copy_by_source_complex_id(
            source_complex_id,
            source_catalog_item_id=str(item_payload.get("item_id") or ""),
            source_catalog_version_id=str(version_payload.get("version_id") or ""),
            source_catalog_visibility=str(item_payload.get("catalog_visibility") or ""),
            requested_by_user_id=requester,
            prefer_existing_by_lineage=prefer_existing_by_lineage,
        )
        import_service_contract = dict(result.get("service_contract") or {})
        result["service_contract"] = dict(self.SERVICE_CONTRACT)
        result["import_service_contract"] = import_service_contract
        result["preview_kind"] = "catalog_complex_add_to_library_preview"
        result["item"] = self._summarize_item_payload(item_payload)
        result["version"] = self._summarize_version_payload(item_payload, version_payload, include_snapshot=False)
        result["library_status"] = self._build_library_status_from_import_result(result, content_type="complex")
        limit_evaluation = self._evaluate_workspace_limits(
            requested_by_user_id=requester,
            theory_slots=int(((result.get("summary") or {}).get("created_counts") or {}).get("theories") or 0),
            complex_slots=int(((result.get("summary") or {}).get("created_counts") or {}).get("complexes") or 0),
        )
        return self._attach_workspace_limits(result, limit_evaluation)

    def _build_complex_dependency_bundle(self, complex_snapshot: Dict[str, Any]) -> Dict[str, Any]:
        modules: Dict[str, Any] = {}
        topics: Dict[str, Any] = {}
        tasks: Dict[str, Any] = {}
        topic_theory_links: Dict[str, Any] = {}
        theories: Dict[str, Any] = {}

        for raw_task_ref in complex_snapshot.get("tasks") or []:
            task_ref = str(raw_task_ref or "").strip()
            module_id, topic_id, task_id = self._parse_task_ref(task_ref)
            module_payload = self.storage_service.get_module(module_id)
            if not isinstance(module_payload, dict):
                raise ValueError(f"publish_dependency_module_not_found:{module_id}")
            topic_payload = self.storage_service.get_topic(module_id, topic_id)
            if not isinstance(topic_payload, dict):
                raise ValueError(f"publish_dependency_topic_not_found:{module_id}/{topic_id}")
            task_payload = self.storage_service.load_task(module_id, topic_id, task_id)
            if not isinstance(task_payload, dict):
                raise ValueError(f"publish_dependency_task_not_found:{task_ref}")

            modules[module_id] = self._json_safe(copy.deepcopy(module_payload))
            topic_ref = f"{module_id}/{topic_id}"
            topics[topic_ref] = self._json_safe(copy.deepcopy(topic_payload))
            tasks[task_ref] = self._json_safe(copy.deepcopy(task_payload))

            topic_theory_link = self.storage_service.get_topic_theory_link(module_id, topic_id)
            if isinstance(topic_theory_link, dict):
                topic_theory_links[topic_ref] = self._json_safe(copy.deepcopy(topic_theory_link))
                self._collect_theory_dependency(theories, topic_theory_link)

        self._collect_theory_dependency(theories, complex_snapshot.get("theory_link"))
        return {
            "modules": modules,
            "topics": topics,
            "tasks": tasks,
            "topic_theory_links": topic_theory_links,
            "theories": theories,
        }

    def _resolve_theory_catalog_item_from_link(self, theory_link: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(theory_link, dict):
            return None
        catalog_item_id = self._normalize_optional_text(theory_link.get("catalog_item_id"))
        if not catalog_item_id:
            library_entry_id = self._normalize_optional_text(theory_link.get("library_entry_id"))
            if library_entry_id:
                entry_payload = self._get_theory_library_entry_payload(library_entry_id)
                if isinstance(entry_payload, dict):
                    catalog_item_id = self._normalize_optional_text(entry_payload.get("catalog_item_id"))
        if not catalog_item_id:
            return None
        item_payload = self._get_item_payload(catalog_item_id)
        if not isinstance(item_payload, dict):
            return None
        if str(item_payload.get("content_type") or "").strip() != "theory":
            return None
        return dict(item_payload)

    def _build_linked_library_theory_snapshot(self, theory_link: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(theory_link, dict):
            return None

        item_payload = self._resolve_theory_catalog_item_from_link(theory_link)
        if isinstance(item_payload, dict):
            item_id = self._normalize_optional_text(item_payload.get("item_id")) or ""
            latest_version_id = self._normalize_optional_text(item_payload.get("latest_version_id")) or ""
            version_payload = self._get_version_payload(item_id, latest_version_id) if latest_version_id else None
            snapshot = version_payload.get("snapshot") if isinstance(version_payload, dict) else None
            if isinstance(snapshot, dict):
                return self._json_safe(copy.deepcopy(snapshot))

        source_theory_id = self._normalize_optional_text(
            theory_link.get("source_theory_id") or theory_link.get("theory_id")
        )
        if not source_theory_id:
            return None
        try:
            theory_payload = self.theory_service.get_theory(source_theory_id, include_delta=True)
        except Exception:
            theory_payload = None
        if not isinstance(theory_payload, dict):
            return None
        return self._json_safe(copy.deepcopy(theory_payload))

    def _ensure_snapshot_theory_dependencies(self, snapshot_payload: Any) -> Any:
        if not isinstance(snapshot_payload, dict):
            return snapshot_payload
        complex_payload = snapshot_payload.get("complex") if isinstance(snapshot_payload.get("complex"), dict) else None
        if not isinstance(complex_payload, dict):
            return snapshot_payload
        dependencies_payload = (
            snapshot_payload.get("dependencies") if isinstance(snapshot_payload.get("dependencies"), dict) else {}
        )
        theories_payload = (
            dependencies_payload.get("theories") if isinstance(dependencies_payload.get("theories"), dict) else {}
        )
        topic_theory_links = (
            dependencies_payload.get("topic_theory_links")
            if isinstance(dependencies_payload.get("topic_theory_links"), dict)
            else {}
        )
        normalized_snapshot = copy.deepcopy(snapshot_payload)
        normalized_dependencies = dict(dependencies_payload)
        normalized_theories = dict(theories_payload)

        self._collect_theory_dependency(normalized_theories, complex_payload.get("theory_link"))
        for link_payload in topic_theory_links.values():
            self._collect_theory_dependency(normalized_theories, link_payload)

        normalized_dependencies["theories"] = normalized_theories
        normalized_snapshot["dependencies"] = normalized_dependencies
        return normalized_snapshot

    def _build_snapshot_import_service(
        self,
        item_payload: Dict[str, Any],
        version_payload: Dict[str, Any],
    ) -> Any:
        snapshot = version_payload.get("snapshot") if isinstance(version_payload.get("snapshot"), dict) else {}
        complex_payload = snapshot.get("complex") if isinstance(snapshot.get("complex"), dict) else {}
        dependencies_payload = snapshot.get("dependencies") if isinstance(snapshot.get("dependencies"), dict) else {}
        source_complex_id = str(
            complex_payload.get("workspace_entity_id")
            or complex_payload.get("id")
            or item_payload.get("source_workspace_id")
            or ""
        ).strip()
        if not source_complex_id:
            raise ValueError("catalog_complex_snapshot_invalid")
        snapshot_import_service = WorkspaceImportService(
            complex_service=self.complex_service,
            storage_service=self.storage_service,
            theory_service=self.theory_service,
            source_complex_service=_SnapshotComplexSourceService(complex_payload),
            source_storage_service=_SnapshotStorageSourceService(dependencies_payload),
            source_theory_service=_SnapshotTheorySourceService(
                dependencies_payload.get("theories") if isinstance(dependencies_payload.get("theories"), dict) else {}
            ),
        )
        return snapshot_import_service, source_complex_id

    def _build_library_status_from_import_result(self, payload: Dict[str, Any], *, content_type: str) -> Dict[str, Any]:
        summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
        workspace = payload.get("workspace") if isinstance(payload.get("workspace"), dict) else {}
        created_counts = summary.get("created_counts") if isinstance(summary.get("created_counts"), dict) else {}
        reused_counts = summary.get("reused_counts") if isinstance(summary.get("reused_counts"), dict) else {}
        main_entity_count_key = "theories" if content_type == "theory" else "complexes"
        already_in_library = int(reused_counts.get(main_entity_count_key) or 0) > 0
        library_entity_ref = workspace.get("complex_ref") if content_type == "complex" else None
        library_entity_id = workspace.get("complex_id") if content_type == "complex" else None
        if content_type == "theory":
            theory_ids = workspace.get("theory_ids") if isinstance(workspace.get("theory_ids"), list) else []
            library_entity_id = theory_ids[0] if theory_ids else None
            library_entity_ref = library_entity_id
        return {
            "already_in_library": already_in_library,
            "action": "open_existing" if already_in_library else "create_copy",
            "content_type": content_type,
            "library_entity_ref": library_entity_ref,
            "library_entity_id": library_entity_id,
            "created_main_entities": int(created_counts.get(main_entity_count_key) or 0),
            "reused_main_entities": int(reused_counts.get(main_entity_count_key) or 0),
        }

    def _collect_theory_dependency(self, theories: Dict[str, Any], theory_link: Any) -> None:
        if not isinstance(theory_link, dict):
            return
        theory_id = str(theory_link.get("theory_id") or "").strip()
        if not theory_id or theory_id in theories:
            if theory_id:
                return
            linked_theory_payload = self._build_linked_library_theory_snapshot(theory_link)
            if not isinstance(linked_theory_payload, dict):
                return
            linked_theory_id = self._normalize_optional_text(
                linked_theory_payload.get("workspace_entity_id")
                or linked_theory_payload.get("id")
                or theory_link.get("source_theory_id")
            )
            if not linked_theory_id or linked_theory_id in theories:
                return
            theories[linked_theory_id] = self._json_safe(copy.deepcopy(linked_theory_payload))
            return
        theory_payload = self.theory_service.get_theory(theory_id, include_delta=True)
        if not isinstance(theory_payload, dict):
            raise ValueError(f"publish_dependency_theory_not_found:{theory_id}")
        theories[theory_id] = self._json_safe(copy.deepcopy(theory_payload))

    def _iter_complex_snapshot_theory_payloads(self, snapshot_payload: Any) -> List[Dict[str, Any]]:
        snapshot = snapshot_payload if isinstance(snapshot_payload, dict) else {}
        complex_payload = snapshot.get("complex") if isinstance(snapshot.get("complex"), dict) else {}
        dependencies_payload = snapshot.get("dependencies") if isinstance(snapshot.get("dependencies"), dict) else {}
        theories_payload = dependencies_payload.get("theories") if isinstance(dependencies_payload.get("theories"), dict) else {}
        topic_theory_links = (
            dependencies_payload.get("topic_theory_links")
            if isinstance(dependencies_payload.get("topic_theory_links"), dict)
            else {}
        )
        theory_ids: List[str] = []
        seen_ids = set()

        def remember_theory_id(raw_value: Any) -> None:
            theory_id = str(raw_value or "").strip()
            if not theory_id or theory_id in seen_ids:
                return
            seen_ids.add(theory_id)
            theory_ids.append(theory_id)

        direct_theory_link = complex_payload.get("theory_link") if isinstance(complex_payload.get("theory_link"), dict) else {}
        remember_theory_id(direct_theory_link.get("theory_id"))

        sync_meta = complex_payload.get("theory_sync_meta") if isinstance(complex_payload.get("theory_sync_meta"), dict) else {}
        for raw_theory_id in sync_meta.get("theory_ids") or []:
            remember_theory_id(raw_theory_id)

        for link_payload in topic_theory_links.values():
            if isinstance(link_payload, dict):
                remember_theory_id(link_payload.get("theory_id"))

        for theory_id in theories_payload.keys():
            remember_theory_id(theory_id)

        theory_items: List[Dict[str, Any]] = []
        for theory_id in theory_ids:
            theory_payload = theories_payload.get(theory_id)
            if not isinstance(theory_payload, dict):
                continue
            normalized_payload = self._json_safe(copy.deepcopy(theory_payload))
            if not self._normalize_optional_text(normalized_payload.get("id")):
                normalized_payload["id"] = theory_id
            theory_items.append(normalized_payload)
        return theory_items

    def _find_published_theory_item_for_snapshot(
        self,
        theory_payload: Any,
        *,
        preferred_owner_user_id: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        payload = theory_payload if isinstance(theory_payload, dict) else {}
        source_workspace_id = self._normalize_optional_text(
            payload.get("workspace_entity_id") or payload.get("id")
        )
        source_workspace_ref = self._normalize_optional_text(
            payload.get("workspace_entity_ref") or payload.get("id")
        )
        if not source_workspace_id and not source_workspace_ref:
            return None

        preferred_owner = self._normalize_optional_text(preferred_owner_user_id)
        candidates: List[Dict[str, Any]] = []
        for item_payload in self._list_item_payloads():
            if not isinstance(item_payload, dict):
                continue
            if str(item_payload.get("content_type") or "").strip() != "theory":
                continue
            item_source_id = self._normalize_optional_text(item_payload.get("source_workspace_id"))
            item_source_ref = self._normalize_optional_text(item_payload.get("source_workspace_ref"))
            if source_workspace_id and item_source_id == source_workspace_id:
                candidates.append(item_payload)
                continue
            if source_workspace_ref and item_source_ref == source_workspace_ref:
                candidates.append(item_payload)

        if not candidates:
            return None

        candidates.sort(
            key=lambda value: (
                self._normalize_optional_text(value.get("owner_user_id")) == preferred_owner,
                str(value.get("latest_published_at") or ""),
                str(value.get("item_id") or ""),
            ),
            reverse=True,
        )
        return dict(candidates[0])

    def _sync_theory_library_entries_for_complex_snapshot(
        self,
        snapshot_payload: Any,
        *,
        requested_by_user_id: Optional[str],
        preferred_owner_user_id: Optional[str],
        source_complex_library_entry_id: Optional[str],
    ) -> List[Dict[str, Any]]:
        requester = self._normalize_optional_text(requested_by_user_id)
        if not requester:
            return []

        results: List[Dict[str, Any]] = []
        seen_item_ids = set()
        for theory_payload in self._iter_complex_snapshot_theory_payloads(snapshot_payload):
            published_item = self._find_published_theory_item_for_snapshot(
                theory_payload,
                preferred_owner_user_id=preferred_owner_user_id,
            )
            item_id = self._normalize_optional_text((published_item or {}).get("item_id"))
            if not item_id or item_id in seen_item_ids:
                continue
            seen_item_ids.add(item_id)
            try:
                add_result = self.add_item_to_library(
                    item_id,
                    requested_by_user_id=requester,
                    auto_added_by_complex_library_entry_id=source_complex_library_entry_id,
                )
            except ValueError:
                continue
            results.append(
                {
                    "item": copy.deepcopy(add_result.get("item")),
                    "library_entry": copy.deepcopy(add_result.get("library_entry")),
                    "created": bool(add_result.get("created")),
                    "reused": bool(add_result.get("reused")),
                }
            )
        return results

    def _detach_theory_library_entries_for_removed_complex_snapshot(
        self,
        snapshot_payload: Any,
        *,
        requested_by_user_id: Optional[str],
        source_complex_library_entry_id: Optional[str],
        preferred_owner_user_id: Optional[str],
    ) -> Dict[str, List[Dict[str, Any]]]:
        requester = self._normalize_optional_text(requested_by_user_id)
        source_entry_id = self._normalize_optional_text(source_complex_library_entry_id)
        if not requester or not source_entry_id:
            return {"removed": [], "retained": []}

        removed: List[Dict[str, Any]] = []
        retained: List[Dict[str, Any]] = []
        seen_item_ids = set()
        for theory_payload in self._iter_complex_snapshot_theory_payloads(snapshot_payload):
            published_item = self._find_published_theory_item_for_snapshot(
                theory_payload,
                preferred_owner_user_id=preferred_owner_user_id,
            )
            item_id = self._normalize_optional_text((published_item or {}).get("item_id"))
            if not item_id or item_id in seen_item_ids:
                continue
            seen_item_ids.add(item_id)
            entry_payload = self._get_theory_library_entry_by_user_item(requester, item_id)
            if not isinstance(entry_payload, dict):
                continue
            entry_id = self._normalize_optional_text(entry_payload.get("library_entry_id"))
            if not entry_id:
                continue

            linked_source_entry_ids = self._normalize_linked_theory_source_entry_ids(
                entry_payload.get("auto_added_by_complex_library_entry_ids")
            )
            if source_entry_id not in linked_source_entry_ids:
                retained.append(
                    {
                        "library_entry_id": entry_id,
                        "catalog_item_id": item_id,
                        "reason": "not_auto_added_by_removed_complex",
                    }
                )
                continue

            remaining_source_entry_ids = [
                value for value in linked_source_entry_ids if value != source_entry_id
            ]
            if bool(entry_payload.get("manually_added")) or remaining_source_entry_ids:
                entry_payload["auto_added_by_complex_library_entry_ids"] = remaining_source_entry_ids
                self._upsert_theory_library_entry_payload(entry_payload)
                retained.append(
                    {
                        "library_entry_id": entry_id,
                        "catalog_item_id": item_id,
                        "reason": (
                            "manually_added"
                            if bool(entry_payload.get("manually_added"))
                            else "still_referenced_by_other_complex"
                        ),
                    }
                )
                continue

            self._delete_theory_library_entry_payload(entry_id)
            removed.append(
                {
                    "library_entry_id": entry_id,
                    "catalog_item_id": item_id,
                    "reason": "orphaned_auto_added_entry",
                }
            )

        return {
            "removed": removed,
            "retained": retained,
        }

    def _normalize_theory_source_signature(
        self,
        *,
        source_workspace_id: Any = None,
        source_workspace_ref: Any = None,
        theory_payload: Any = None,
    ) -> Dict[str, str]:
        payload = theory_payload if isinstance(theory_payload, dict) else {}
        theory_id = self._normalize_optional_text(
            payload.get("workspace_entity_id")
            or payload.get("id")
            or source_workspace_id
        ) or ""
        theory_ref = self._normalize_optional_text(
            payload.get("workspace_entity_ref")
            or payload.get("id")
            or source_workspace_ref
        ) or ""
        return {
            "source_workspace_id": theory_id,
            "source_workspace_ref": theory_ref,
        }

    def _theory_signature_matches(
        self,
        candidate_payload: Any,
        *,
        source_workspace_id: Any,
        source_workspace_ref: Any,
    ) -> bool:
        signature = self._normalize_theory_source_signature(
            source_workspace_id=source_workspace_id,
            source_workspace_ref=source_workspace_ref,
        )
        candidate_signature = self._normalize_theory_source_signature(theory_payload=candidate_payload)
        target_id = signature["source_workspace_id"]
        target_ref = signature["source_workspace_ref"]
        candidate_id = candidate_signature["source_workspace_id"]
        candidate_ref = candidate_signature["source_workspace_ref"]
        if target_id and candidate_id and target_id == candidate_id:
            return True
        if target_ref and candidate_ref and target_ref == candidate_ref:
            return True
        return False

    def _find_complex_references_for_theory(
        self,
        *,
        source_workspace_id: Any,
        source_workspace_ref: Any,
    ) -> List[Dict[str, Any]]:
        signature = self._normalize_theory_source_signature(
            source_workspace_id=source_workspace_id,
            source_workspace_ref=source_workspace_ref,
        )
        if not signature["source_workspace_id"] and not signature["source_workspace_ref"]:
            return []

        matches: List[Dict[str, Any]] = []
        for item_payload in self._list_item_payloads():
            if not isinstance(item_payload, dict):
                continue
            if str(item_payload.get("content_type") or "").strip() != "complex":
                continue
            visibility = self._normalize_catalog_visibility(
                item_payload.get("catalog_visibility"),
                allow_empty=True,
            ) or "public"
            if visibility not in {"public", "access_code", "private"}:
                continue
            latest_version_id = self._normalize_optional_text(item_payload.get("latest_version_id"))
            if not latest_version_id:
                continue
            version_payload = self._get_version_payload(str(item_payload.get("item_id") or ""), latest_version_id)
            if not isinstance(version_payload, dict):
                continue
            snapshot_payload = version_payload.get("snapshot") if isinstance(version_payload.get("snapshot"), dict) else {}
            for theory_payload in self._iter_complex_snapshot_theory_payloads(snapshot_payload):
                if self._theory_signature_matches(
                    theory_payload,
                    source_workspace_id=signature["source_workspace_id"],
                    source_workspace_ref=signature["source_workspace_ref"],
                ):
                    matches.append(
                        {
                            "item_id": str(item_payload.get("item_id") or ""),
                            "title": str(item_payload.get("title") or "").strip() or str(item_payload.get("item_id") or ""),
                            "catalog_visibility": visibility,
                            "latest_version_id": latest_version_id,
                            "latest_published_at": item_payload.get("latest_published_at"),
                        }
                    )
                    break
        matches.sort(
            key=lambda value: (
                str(value.get("latest_published_at") or ""),
                str(value.get("item_id") or ""),
            ),
            reverse=True,
        )
        return matches

    @staticmethod
    def _pick_stronger_catalog_visibility(current: Optional[str], candidate: Optional[str]) -> Optional[str]:
        priority = {
            "private": 1,
            "access_code": 2,
            "public": 3,
        }
        if candidate not in priority:
            return current
        if current not in priority:
            return candidate
        return candidate if priority[candidate] > priority[current] else current

    def _resolve_forced_theory_visibility(
        self,
        *,
        source_workspace_id: Any,
        source_workspace_ref: Any,
    ) -> Optional[str]:
        forced_visibility: Optional[str] = None
        for reference in self._find_complex_references_for_theory(
            source_workspace_id=source_workspace_id,
            source_workspace_ref=source_workspace_ref,
        ):
            forced_visibility = self._pick_stronger_catalog_visibility(
                forced_visibility,
                self._normalize_catalog_visibility(reference.get("catalog_visibility"), allow_empty=True),
            )
        return forced_visibility

    def _build_theory_visibility_lock(
        self,
        *,
        source_workspace_id: Any,
        source_workspace_ref: Any,
    ) -> Optional[Dict[str, Any]]:
        referencing_complexes = self._find_complex_references_for_theory(
            source_workspace_id=source_workspace_id,
            source_workspace_ref=source_workspace_ref,
        )
        if not referencing_complexes:
            return None
        forced_visibility = self._resolve_forced_theory_visibility(
            source_workspace_id=source_workspace_id,
            source_workspace_ref=source_workspace_ref,
        )
        if not forced_visibility:
            return None
        preview_titles = [
            str(item.get("title") or "").strip()
            for item in referencing_complexes[:3]
            if str(item.get("title") or "").strip()
        ]
        return {
            "forced_visibility": forced_visibility,
            "reason": f"linked_to_{forced_visibility}_complex",
            "complex_count": len(referencing_complexes),
            "complex_titles": preview_titles,
            "complexes": self._json_safe(referencing_complexes[:5]),
        }

    def _assert_theory_visibility_change_allowed(
        self,
        *,
        source_workspace_id: Any,
        source_workspace_ref: Any,
        requested_visibility: Optional[str],
    ) -> None:
        lock_payload = self._build_theory_visibility_lock(
            source_workspace_id=source_workspace_id,
            source_workspace_ref=source_workspace_ref,
        )
        forced_visibility = self._normalize_catalog_visibility(
            (lock_payload or {}).get("forced_visibility"),
            allow_empty=True,
        )
        requested = self._normalize_catalog_visibility(requested_visibility, allow_empty=True)
        if forced_visibility and requested != forced_visibility:
            raise ValueError("theory_catalog_visibility_locked_by_public_complex")

    def _ensure_public_theory_publications_for_complex_snapshot(
        self,
        snapshot_payload: Any,
        *,
        preferred_owner_user_id: Optional[str],
    ) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        seen_theory_ids = set()
        for theory_payload in self._iter_complex_snapshot_theory_payloads(snapshot_payload):
            theory_signature = self._normalize_theory_source_signature(theory_payload=theory_payload)
            theory_id = theory_signature["source_workspace_id"]
            if not theory_id or theory_id in seen_theory_ids:
                continue
            seen_theory_ids.add(theory_id)
            owner_user_id = self._normalize_optional_text(
                theory_payload.get("created_by_user_id")
                or theory_payload.get("updated_by_user_id")
                or preferred_owner_user_id
            )
            if not owner_user_id:
                continue
            try:
                publish_result = self.publish_theory(
                    theory_id,
                    requested_by_user_id=owner_user_id,
                    catalog_visibility="public",
                )
            except ValueError:
                continue
            results.append(
                {
                    "item": copy.deepcopy(publish_result.get("item")),
                    "version": copy.deepcopy(publish_result.get("version")),
                }
        )
        return results

    def _apply_item_visibility(self, item_payload: Dict[str, Any], *, catalog_visibility: str) -> Dict[str, Any]:
        updated_item = dict(item_payload or {})
        next_visibility = self._normalize_catalog_visibility(catalog_visibility)
        updated_item["catalog_visibility"] = next_visibility
        updated_item["updated_at"] = self._utcnow_iso()
        access_code = self._normalize_optional_text(updated_item.get("access_code"))
        if next_visibility == "access_code":
            if self._should_rotate_access_code(access_code):
                access_code = self._generate_access_code()
            updated_item["access_code"] = access_code
        else:
            updated_item.pop("access_code", None)
        return updated_item

    def _sync_theory_visibility_for_complex_snapshot(
        self,
        snapshot_payload: Any,
        *,
        preferred_owner_user_id: Optional[str],
    ) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        seen_theory_ids = set()
        for theory_payload in self._iter_complex_snapshot_theory_payloads(snapshot_payload):
            theory_signature = self._normalize_theory_source_signature(theory_payload=theory_payload)
            theory_id = theory_signature["source_workspace_id"]
            theory_ref = theory_signature["source_workspace_ref"]
            dedupe_key = theory_id or theory_ref
            if not dedupe_key or dedupe_key in seen_theory_ids:
                continue
            seen_theory_ids.add(dedupe_key)

            forced_visibility = self._resolve_forced_theory_visibility(
                source_workspace_id=theory_id,
                source_workspace_ref=theory_ref,
            )
            published_item = self._find_published_theory_item_for_snapshot(
                theory_payload,
                preferred_owner_user_id=preferred_owner_user_id,
            )

            if not forced_visibility:
                continue

            if isinstance(published_item, dict):
                current_visibility = self._normalize_catalog_visibility(
                    published_item.get("catalog_visibility"),
                    allow_empty=True,
                ) or "public"
                if current_visibility == forced_visibility:
                    continue
                updated_item = self._apply_item_visibility(
                    published_item,
                    catalog_visibility=forced_visibility,
                )
                self._upsert_item_payload(updated_item)
                results.append(
                    {
                        "item": self._summarize_item_payload(updated_item, include_sensitive=True),
                        "updated": True,
                    }
                )
                continue

            if forced_visibility == "private":
                continue

            owner_user_id = self._normalize_optional_text(
                theory_payload.get("created_by_user_id")
                or theory_payload.get("updated_by_user_id")
                or preferred_owner_user_id
            )
            if not owner_user_id or not theory_id:
                continue
            try:
                publish_result = self.publish_theory(
                    theory_id,
                    requested_by_user_id=owner_user_id,
                    catalog_visibility=forced_visibility,
                )
            except ValueError:
                continue
            results.append(
                {
                    "item": copy.deepcopy(publish_result.get("item")),
                    "version": copy.deepcopy(publish_result.get("version")),
                    "created": True,
                }
            )
        return results

    def _parse_task_ref(self, task_ref: Any) -> Any:
        raw_ref = str(task_ref or "").strip()
        parts = [part.strip() for part in raw_ref.split("/") if part.strip()]
        if len(parts) != 3:
            raise ValueError(f"invalid_task_ref:{raw_ref}")
        return parts[0], parts[1], parts[2]

    def _list_item_payloads(self) -> List[Dict[str, Any]]:
        state = self._read_state()
        items = state.get("items")
        if not isinstance(items, list):
            return []
        return [dict(item) for item in items if isinstance(item, dict)]

    def _get_item_payload(self, item_id: str) -> Optional[Dict[str, Any]]:
        clean_item_id = str(item_id or "").strip()
        if not clean_item_id:
            return None
        for payload in self._list_item_payloads():
            if str(payload.get("item_id") or "").strip() == clean_item_id:
                return payload
        return None

    def _get_item_by_source_workspace_key(self, source_workspace_key: str) -> Optional[Dict[str, Any]]:
        clean_key = str(source_workspace_key or "").strip()
        if not clean_key:
            return None
        for payload in self._list_item_payloads():
            if str(payload.get("source_workspace_key") or "").strip() == clean_key:
                return payload
        return None

    def _get_item_by_access_code(self, access_code: str) -> Optional[Dict[str, Any]]:
        clean_code = self._normalize_access_code(access_code, allow_empty=True)
        if not clean_code:
            return None
        for payload in self._list_item_payloads():
            payload_code = self._normalize_access_code(payload.get("access_code"), allow_empty=True)
            if payload_code and payload_code == clean_code:
                return payload
        return None

    def _upsert_item_payload(self, item_payload: Dict[str, Any]) -> None:
        state = self._read_state()
        items = [dict(item) for item in state.get("items") or [] if isinstance(item, dict)]
        clean_item_id = str(item_payload.get("item_id") or "").strip()
        replaced = False
        for index, value in enumerate(items):
            if str(value.get("item_id") or "").strip() == clean_item_id:
                items[index] = dict(item_payload)
                replaced = True
                break
        if not replaced:
            items.append(dict(item_payload))
        state["items"] = items
        self._write_state(state)

    def _list_version_payloads(self, item_id: str) -> List[Dict[str, Any]]:
        clean_item_id = str(item_id or "").strip()
        if not clean_item_id:
            return []
        state = self._read_state()
        versions = state.get("versions")
        if not isinstance(versions, list):
            return []
        filtered = [
            dict(item)
            for item in versions
            if isinstance(item, dict) and str(item.get("item_id") or "").strip() == clean_item_id
        ]
        filtered.sort(key=lambda value: str(value.get("published_at") or ""), reverse=True)
        return filtered

    def _get_version_payload(self, item_id: str, version_id: str) -> Optional[Dict[str, Any]]:
        clean_item_id = str(item_id or "").strip()
        clean_version_id = str(version_id or "").strip()
        if not clean_item_id or not clean_version_id:
            return None
        for payload in self._list_version_payloads(clean_item_id):
            if str(payload.get("version_id") or "").strip() == clean_version_id:
                return payload
        return None

    def _append_version_payload(self, version_payload: Dict[str, Any]) -> None:
        state = self._read_state()
        versions = [dict(item) for item in state.get("versions") or [] if isinstance(item, dict)]
        versions.append(dict(version_payload))
        state["versions"] = versions
        self._write_state(state)

    def _list_theory_library_entry_payloads_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        clean_user_id = self._normalize_optional_text(user_id)
        if not clean_user_id:
            return []
        state = self._read_state()
        entries = [
            dict(item)
            for item in state.get("theory_library_entries") or []
            if isinstance(item, dict) and self._normalize_optional_text(item.get("user_id")) == clean_user_id
        ]
        return entries

    def _get_theory_library_entry_payload(self, library_entry_id: str) -> Optional[Dict[str, Any]]:
        clean_entry_id = self._normalize_optional_text(library_entry_id)
        if not clean_entry_id:
            return None
        state = self._read_state()
        for item in state.get("theory_library_entries") or []:
            if not isinstance(item, dict):
                continue
            if self._normalize_optional_text(item.get("library_entry_id")) == clean_entry_id:
                return dict(item)
        return None

    def _get_theory_library_entry_by_user_item(self, user_id: str, catalog_item_id: str) -> Optional[Dict[str, Any]]:
        clean_user_id = self._normalize_optional_text(user_id)
        clean_item_id = self._normalize_optional_text(catalog_item_id)
        if not clean_user_id or not clean_item_id:
            return None
        state = self._read_state()
        for item in state.get("theory_library_entries") or []:
            if not isinstance(item, dict):
                continue
            if (
                self._normalize_optional_text(item.get("user_id")) == clean_user_id
                and self._normalize_optional_text(item.get("catalog_item_id")) == clean_item_id
            ):
                return dict(item)
        return None

    def _upsert_theory_library_entry_payload(self, entry_payload: Dict[str, Any]) -> None:
        state = self._read_state()
        entries = [dict(item) for item in state.get("theory_library_entries") or [] if isinstance(item, dict)]
        clean_entry_id = self._require_text(entry_payload.get("library_entry_id"), "library_entry_id_required")
        clean_user_id = self._require_text(entry_payload.get("user_id"), "requested_by_user_id_required")
        clean_item_id = self._require_text(entry_payload.get("catalog_item_id"), "item_id_required")
        normalized_payload = dict(entry_payload)
        normalized_payload["auto_added_by_complex_library_entry_ids"] = self._normalize_linked_theory_source_entry_ids(
            normalized_payload.get("auto_added_by_complex_library_entry_ids")
        )
        normalized_payload["manually_added"] = bool(normalized_payload.get("manually_added"))
        replaced = False
        for index, item in enumerate(entries):
            if self._normalize_optional_text(item.get("library_entry_id")) == clean_entry_id:
                entries[index] = normalized_payload
                replaced = True
                break
        if not replaced:
            entries = [
                item
                for item in entries
                if not (
                    self._normalize_optional_text(item.get("user_id")) == clean_user_id
                    and self._normalize_optional_text(item.get("catalog_item_id")) == clean_item_id
                )
            ]
            entries.append(normalized_payload)
        state["theory_library_entries"] = entries
        self._write_state(state)

    def _delete_theory_library_entry_payload(self, library_entry_id: str) -> None:
        clean_entry_id = self._require_text(library_entry_id, "library_entry_id_required")
        state = self._read_state()
        entries = [dict(item) for item in state.get("theory_library_entries") or [] if isinstance(item, dict)]
        state["theory_library_entries"] = [
            item
            for item in entries
            if self._normalize_optional_text(item.get("library_entry_id")) != clean_entry_id
        ]
        self._write_state(state)

    def _list_complex_library_entry_payloads_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        clean_user_id = self._normalize_optional_text(user_id)
        if not clean_user_id:
            return []
        state = self._read_state()
        entries = [
            dict(item)
            for item in state.get("complex_library_entries") or []
            if isinstance(item, dict) and self._normalize_optional_text(item.get("user_id")) == clean_user_id
        ]
        return entries

    def _get_complex_library_entry_payload(self, library_entry_id: str) -> Optional[Dict[str, Any]]:
        clean_entry_id = self._normalize_optional_text(library_entry_id)
        if not clean_entry_id:
            return None
        state = self._read_state()
        for item in state.get("complex_library_entries") or []:
            if not isinstance(item, dict):
                continue
            if self._normalize_optional_text(item.get("library_entry_id")) == clean_entry_id:
                return dict(item)
        return None

    def _get_complex_library_entry_by_user_item(self, user_id: str, catalog_item_id: str) -> Optional[Dict[str, Any]]:
        clean_user_id = self._normalize_optional_text(user_id)
        clean_item_id = self._normalize_optional_text(catalog_item_id)
        if not clean_user_id or not clean_item_id:
            return None
        state = self._read_state()
        for item in state.get("complex_library_entries") or []:
            if not isinstance(item, dict):
                continue
            if (
                self._normalize_optional_text(item.get("user_id")) == clean_user_id
                and self._normalize_optional_text(item.get("catalog_item_id")) == clean_item_id
            ):
                return dict(item)
        return None

    def _list_complex_library_entry_payloads_for_item(self, catalog_item_id: Optional[str]) -> List[Dict[str, Any]]:
        clean_item_id = self._normalize_optional_text(catalog_item_id)
        if not clean_item_id:
            return []
        state = self._read_state()
        return [
            dict(item)
            for item in state.get("complex_library_entries") or []
            if isinstance(item, dict)
            and self._normalize_optional_text(item.get("catalog_item_id")) == clean_item_id
        ]

    def _upsert_complex_library_entry_payload(self, entry_payload: Dict[str, Any]) -> None:
        state = self._read_state()
        entries = [dict(item) for item in state.get("complex_library_entries") or [] if isinstance(item, dict)]
        clean_entry_id = self._require_text(entry_payload.get("library_entry_id"), "library_entry_id_required")
        clean_user_id = self._require_text(entry_payload.get("user_id"), "requested_by_user_id_required")
        clean_item_id = self._require_text(entry_payload.get("catalog_item_id"), "item_id_required")
        replaced = False
        for index, item in enumerate(entries):
            if self._normalize_optional_text(item.get("library_entry_id")) == clean_entry_id:
                entries[index] = dict(entry_payload)
                replaced = True
                break
        if not replaced:
            entries = [
                item
                for item in entries
                if not (
                    self._normalize_optional_text(item.get("user_id")) == clean_user_id
                    and self._normalize_optional_text(item.get("catalog_item_id")) == clean_item_id
                )
            ]
            entries.append(dict(entry_payload))
        state["complex_library_entries"] = entries
        self._write_state(state)

    def _delete_complex_library_entry_payload(self, library_entry_id: str) -> None:
        clean_entry_id = self._require_text(library_entry_id, "library_entry_id_required")
        state = self._read_state()
        entries = [dict(item) for item in state.get("complex_library_entries") or [] if isinstance(item, dict)]
        state["complex_library_entries"] = [
            item
            for item in entries
            if self._normalize_optional_text(item.get("library_entry_id")) != clean_entry_id
        ]
        self._write_state(state)

    def _normalize_linked_theory_source_entry_ids(self, value: Any) -> List[str]:
        if not isinstance(value, list):
            return []
        normalized_ids: List[str] = []
        for raw_value in value:
            normalized = self._normalize_optional_text(raw_value)
            if not normalized or normalized in normalized_ids:
                continue
            normalized_ids.append(normalized)
        return normalized_ids

    def _read_state(self) -> Dict[str, Any]:
        if not self.catalog_file.exists():
            return {"items": [], "versions": [], "theory_library_entries": [], "complex_library_entries": []}
        try:
            with open(self.catalog_file, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except Exception:
            return {"items": [], "versions": [], "theory_library_entries": [], "complex_library_entries": []}
        if not isinstance(data, dict):
            return {"items": [], "versions": [], "theory_library_entries": [], "complex_library_entries": []}
        if not isinstance(data.get("items"), list):
            data["items"] = []
        if not isinstance(data.get("versions"), list):
            data["versions"] = []
        if not isinstance(data.get("theory_library_entries"), list):
            data["theory_library_entries"] = []
        if not isinstance(data.get("complex_library_entries"), list):
            data["complex_library_entries"] = []
        return data

    def _write_state(self, state: Dict[str, Any]) -> None:
        payload = {
            "items": [dict(item) for item in state.get("items") or [] if isinstance(item, dict)],
            "versions": [dict(item) for item in state.get("versions") or [] if isinstance(item, dict)],
            "theory_library_entries": [
                dict(item) for item in state.get("theory_library_entries") or [] if isinstance(item, dict)
            ],
            "complex_library_entries": [
                dict(item) for item in state.get("complex_library_entries") or [] if isinstance(item, dict)
            ],
        }
        with open(self.catalog_file, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)

    def _summarize_item_payload(self, payload: Dict[str, Any], *, include_sensitive: bool = False) -> Dict[str, Any]:
        latest_manifest = payload.get("latest_manifest") if isinstance(payload.get("latest_manifest"), dict) else {}
        owner_user_id = payload.get("owner_user_id")
        content_type = payload.get("content_type")
        normalized = {
            "item_id": payload.get("item_id"),
            "content_type": content_type,
            "title": payload.get("title") or "",
            "description": payload.get("description") or "",
            "owner_user_id": owner_user_id,
            "owner_display_name": self._resolve_owner_display_name(owner_user_id),
            "status": payload.get("status") or "published",
            "catalog_visibility": payload.get("catalog_visibility") or "public",
            "has_access_code": bool(self._normalize_optional_text(payload.get("access_code"))),
            "source_workspace_kind": payload.get("source_workspace_kind"),
            "source_workspace_id": payload.get("source_workspace_id"),
            "source_workspace_ref": payload.get("source_workspace_ref"),
            "latest_version_id": payload.get("latest_version_id"),
            "latest_published_at": payload.get("latest_published_at"),
            "versions_count": int(payload.get("versions_count") or 0),
            "created_at": payload.get("created_at"),
            "updated_at": payload.get("updated_at"),
            "latest_manifest": self._json_safe(latest_manifest),
        }
        if str(content_type or "").strip() == "theory":
            lock_payload = self._build_theory_visibility_lock(
                source_workspace_id=payload.get("source_workspace_id"),
                source_workspace_ref=payload.get("source_workspace_ref"),
            )
            if lock_payload:
                normalized["visibility_lock"] = self._json_safe(lock_payload)
        if include_sensitive:
            normalized["access_code"] = self._normalize_optional_text(payload.get("access_code"))
        return normalized

    def _resolve_owner_display_name(self, owner_user_id: Any) -> str:
        normalized_owner_user_id = self._normalize_optional_text(owner_user_id)
        if not normalized_owner_user_id:
            return ""
        cached = self._owner_display_name_cache.get(normalized_owner_user_id)
        if cached is not None:
            return cached
        profile_file = self.users_dir / normalized_owner_user_id / "profile.json"
        display_name = ""
        try:
            with open(profile_file, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            if isinstance(payload, dict):
                profile = payload.get("profile") if isinstance(payload.get("profile"), dict) else {}
                display_name = self._repair_possible_utf8_mojibake(profile.get("name"))
        except Exception:
            display_name = ""
        self._owner_display_name_cache[normalized_owner_user_id] = display_name
        return display_name

    @staticmethod
    def _repair_possible_utf8_mojibake(value: Any) -> str:
        text = CatalogService._normalize_optional_text(value) or ""
        if not text:
            return ""
        for source_encoding in ("cp1251", "latin1"):
            try:
                repaired = text.encode(source_encoding).decode("utf-8")
            except (UnicodeEncodeError, UnicodeDecodeError):
                continue
            if repaired != text and CatalogService._is_printable_text(repaired):
                return repaired
        return text

    @staticmethod
    def _is_printable_text(value: str) -> bool:
        return bool(value) and "\ufffd" not in value and all(ch.isprintable() or ch in "\r\n\t" for ch in value)

    def _summarize_version_payload(
        self,
        item_payload: Dict[str, Any],
        payload: Dict[str, Any],
        *,
        include_snapshot: bool,
        include_sensitive: bool = False,
    ) -> Dict[str, Any]:
        normalized = self._normalize_version_payload(
            payload,
            include_snapshot=include_snapshot,
            include_sensitive=include_sensitive,
        )
        normalized["item"] = {
            "item_id": item_payload.get("item_id"),
            "content_type": item_payload.get("content_type"),
            "title": item_payload.get("title") or "",
        }
        if include_sensitive:
            normalized["catalog_visibility"] = (
                self._normalize_catalog_visibility(item_payload.get("catalog_visibility"), allow_empty=True) or "public"
            )
        return normalized

    def _normalize_version_payload(
        self,
        payload: Dict[str, Any],
        *,
        include_snapshot: bool,
        include_sensitive: bool = False,
    ) -> Dict[str, Any]:
        normalized = {
            "version_id": payload.get("version_id"),
            "item_id": payload.get("item_id"),
            "content_type": payload.get("content_type"),
            "owner_user_id": payload.get("owner_user_id"),
            "published_at": payload.get("published_at"),
            "manifest": self._json_safe(payload.get("manifest") if isinstance(payload.get("manifest"), dict) else {}),
        }
        if include_snapshot:
            normalized["snapshot"] = self._json_safe(
                payload.get("snapshot") if isinstance(payload.get("snapshot"), dict) else {}
            )
        if include_sensitive:
            normalized["catalog_visibility"] = self._normalize_optional_text(payload.get("catalog_visibility"))
        return normalized

    def _build_theory_library_entry_id(self, item_id: str) -> str:
        return f"theory_library::{secure_filename(str(item_id or '').strip().lower()) or uuid4().hex[:8]}::{uuid4().hex[:10]}"

    def _build_complex_library_entry_id(self, item_id: str) -> str:
        return f"complex_library::{secure_filename(str(item_id or '').strip().lower()) or uuid4().hex[:8]}::{uuid4().hex[:10]}"

    def _compute_theory_library_access(
        self,
        item_payload: Optional[Dict[str, Any]],
        *,
        requested_by_user_id: Optional[str],
        granted_access_code: Optional[str] = None,
    ) -> Dict[str, Any]:
        requester = self._normalize_optional_text(requested_by_user_id)
        if not isinstance(item_payload, dict):
            return {
                "access_state": "deleted_source",
                "access_reason": "Источник больше не доступен.",
                "resolved_version_id": None,
                "granted_access_code": None,
            }

        if self._is_item_deleted_source(item_payload):
            return {
                "access_state": "deleted_source",
                "access_reason": "Source theory was deleted by the author.",
                "resolved_version_id": None,
                "granted_access_code": None,
            }

        if self._is_item_owner(item_payload, requested_by_user_id=requester):
            return {
                "access_state": "active",
                "access_reason": "Автор публикации.",
                "resolved_version_id": item_payload.get("latest_version_id"),
                "granted_access_code": None,
            }

        visibility = self._normalize_catalog_visibility(item_payload.get("catalog_visibility"), allow_empty=True) or "public"
        if visibility == "public":
            return {
                "access_state": "active",
                "access_reason": "Публикация доступна в каталоге.",
                "resolved_version_id": item_payload.get("latest_version_id"),
                "granted_access_code": None,
            }

        if visibility == "private":
            return {
                "access_state": "revoked",
                "access_reason": "Автор убрал теорию из общего доступа.",
                "resolved_version_id": None,
                "granted_access_code": None,
            }

        expected_code = self._normalize_access_code(item_payload.get("access_code"), allow_empty=True)
        provided_code = self._normalize_access_code(granted_access_code, allow_empty=True)
        if expected_code and provided_code and expected_code == provided_code:
            return {
                "access_state": "active",
                "access_reason": "Доступ подтверждён кодом.",
                "resolved_version_id": item_payload.get("latest_version_id"),
                "granted_access_code": provided_code,
            }
        return {
            "access_state": "requires_access_code",
            "access_reason": "Нужен код доступа от автора.",
            "resolved_version_id": None,
            "granted_access_code": None,
        }

    def _summarize_theory_library_entry_payload(
        self,
        payload: Dict[str, Any],
        *,
        access_state: Optional[str] = None,
        access_reason: Optional[str] = None,
        resolved_version_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        return {
            "library_entry_id": payload.get("library_entry_id"),
            "user_id": payload.get("user_id"),
            "catalog_item_id": payload.get("catalog_item_id"),
            "pinned_version_id": payload.get("pinned_version_id"),
            "resolved_version_id": resolved_version_id if resolved_version_id is not None else payload.get("resolved_version_id"),
            "access_state": access_state if access_state is not None else payload.get("access_state"),
            "access_reason": access_reason if access_reason is not None else payload.get("access_reason"),
            "created_at": payload.get("created_at"),
            "updated_at": payload.get("updated_at"),
        }

    def _build_theory_linked_library_status(self, library_entry: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        entry = library_entry if isinstance(library_entry, dict) else {}
        already_in_library = bool(entry.get("library_entry_id"))
        access_state = str(entry.get("access_state") or "").strip() or "missing"
        action = "create_link"
        if already_in_library:
            action = "enter_access_code" if access_state == "requires_access_code" else "open_linked"
        return {
            "already_in_library": already_in_library,
            "action": action,
            "content_type": "theory",
            "library_entity_id": entry.get("library_entry_id"),
            "library_entity_ref": entry.get("catalog_item_id"),
            "access_state": access_state,
            "access_reason": entry.get("access_reason"),
            "locked": access_state in {"requires_access_code", "revoked", "deleted_source"},
        }

    def _compute_complex_library_access(
        self,
        item_payload: Optional[Dict[str, Any]],
        *,
        requested_by_user_id: Optional[str],
        granted_access_code: Optional[str] = None,
    ) -> Dict[str, Any]:
        requester = self._normalize_optional_text(requested_by_user_id)
        if not isinstance(item_payload, dict):
            return {
                "access_state": "deleted_source",
                "access_reason": "Источник больше не доступен.",
                "resolved_version_id": None,
                "granted_access_code": None,
            }

        if self._is_item_deleted_source(item_payload):
            return {
                "access_state": "deleted_source",
                "access_reason": "Source complex was deleted by the author.",
                "resolved_version_id": None,
                "granted_access_code": None,
            }

        if self._is_item_owner(item_payload, requested_by_user_id=requester):
            return {
                "access_state": "active",
                "access_reason": "Автор публикации.",
                "resolved_version_id": item_payload.get("latest_version_id"),
                "granted_access_code": None,
            }

        visibility = self._normalize_catalog_visibility(item_payload.get("catalog_visibility"), allow_empty=True) or "public"
        if visibility == "public":
            return {
                "access_state": "active",
                "access_reason": "Связанная публикация доступна в каталоге.",
                "resolved_version_id": item_payload.get("latest_version_id"),
                "granted_access_code": None,
            }
        if visibility == "private":
            return {
                "access_state": "revoked",
                "access_reason": "Автор убрал публикацию из общего доступа.",
                "resolved_version_id": None,
                "granted_access_code": None,
            }
        expected_code = self._normalize_access_code(item_payload.get("access_code"), allow_empty=True)
        provided_code = self._normalize_access_code(granted_access_code, allow_empty=True)
        if expected_code and provided_code and expected_code == provided_code:
            return {
                "access_state": "active",
                "access_reason": "Доступ подтверждён кодом.",
                "resolved_version_id": item_payload.get("latest_version_id"),
                "granted_access_code": provided_code,
            }
        return {
            "access_state": "requires_access_code",
            "access_reason": "Для этой публикации нужен код доступа.",
            "resolved_version_id": None,
            "granted_access_code": None,
        }

    def _summarize_complex_library_entry_payload(
        self,
        payload: Dict[str, Any],
        *,
        access_state: str,
        access_reason: Optional[str],
        resolved_version_id: Optional[str],
    ) -> Dict[str, Any]:
        return {
            "library_entry_id": payload.get("library_entry_id"),
            "user_id": payload.get("user_id"),
            "catalog_item_id": payload.get("catalog_item_id"),
            "pinned_version_id": payload.get("pinned_version_id"),
            "resolved_version_id": resolved_version_id,
            "access_state": access_state,
            "access_reason": access_reason if access_reason is not None else payload.get("access_reason"),
            "created_at": payload.get("created_at"),
            "updated_at": payload.get("updated_at"),
        }

    def _build_complex_linked_library_status(self, library_entry: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        entry = library_entry if isinstance(library_entry, dict) else {}
        already_in_library = bool(entry.get("library_entry_id"))
        access_state = str(entry.get("access_state") or "").strip() or "missing"
        action = "create_link"
        if already_in_library:
            action = "enter_access_code" if access_state == "requires_access_code" else "open_linked"
        return {
            "already_in_library": already_in_library,
            "action": action,
            "content_type": "complex",
            "library_entity_id": entry.get("library_entry_id"),
            "library_entity_ref": entry.get("catalog_item_id"),
            "access_state": access_state,
            "access_reason": entry.get("access_reason"),
            "locked": access_state in {"requires_access_code", "revoked", "deleted_source"},
        }

    def _resolve_complex_library_entry_payload(
        self,
        entry_payload: Dict[str, Any],
        *,
        requested_by_user_id: Optional[str],
    ) -> Dict[str, Any]:
        normalized_entry = dict(entry_payload or {})
        item_payload = self._get_item_payload(str(normalized_entry.get("catalog_item_id") or "").strip())
        access = self._compute_complex_library_access(
            item_payload,
            requested_by_user_id=requested_by_user_id,
            granted_access_code=normalized_entry.get("granted_access_code"),
        )
        resolved_version_id = access.get("resolved_version_id")
        version_payload = (
            self._get_version_payload(str(item_payload.get("item_id") or "").strip(), str(resolved_version_id or "").strip())
            if isinstance(item_payload, dict) and resolved_version_id
            else None
        )
        normalized_entry["access_state"] = access.get("access_state")
        normalized_entry["access_reason"] = access.get("access_reason")
        normalized_entry["resolved_version_id"] = resolved_version_id
        normalized_entry["granted_access_code"] = access.get("granted_access_code")
        normalized_entry["updated_at"] = self._utcnow_iso()
        library_entry = self._summarize_complex_library_entry_payload(
            normalized_entry,
            access_state=str(access.get("access_state") or ""),
            access_reason=str(access.get("access_reason") or ""),
            resolved_version_id=resolved_version_id,
        )
        snapshot_payload = (
            self._normalize_version_payload(version_payload, include_snapshot=True).get("snapshot")
            if isinstance(version_payload, dict)
            else None
        )
        if isinstance(snapshot_payload, dict):
            snapshot_payload = self._ensure_snapshot_theory_dependencies(snapshot_payload)
        return {
            "entry_payload": normalized_entry,
            "library_entry": library_entry,
            "item": self._summarize_item_payload(item_payload) if isinstance(item_payload, dict) else None,
            "version": (
                self._summarize_version_payload(item_payload, version_payload, include_snapshot=False)
                if isinstance(item_payload, dict) and isinstance(version_payload, dict)
                else None
            ),
            "snapshot": snapshot_payload,
        }

    def _resolve_theory_library_entry_payload(
        self,
        entry_payload: Dict[str, Any],
        *,
        requested_by_user_id: Optional[str],
    ) -> Dict[str, Any]:
        normalized_entry = dict(entry_payload or {})
        item_payload = self._get_item_payload(str(normalized_entry.get("catalog_item_id") or "").strip())
        access = self._compute_theory_library_access(
            item_payload,
            requested_by_user_id=requested_by_user_id,
            granted_access_code=normalized_entry.get("granted_access_code"),
        )
        resolved_version_id = access.get("resolved_version_id")
        version_payload = (
            self._get_version_payload(str(item_payload.get("item_id") or "").strip(), str(resolved_version_id or "").strip())
            if isinstance(item_payload, dict) and resolved_version_id
            else None
        )
        normalized_entry["access_state"] = access.get("access_state")
        normalized_entry["access_reason"] = access.get("access_reason")
        normalized_entry["resolved_version_id"] = resolved_version_id
        normalized_entry["granted_access_code"] = access.get("granted_access_code")
        normalized_entry["updated_at"] = self._utcnow_iso()
        library_entry = self._summarize_theory_library_entry_payload(
            normalized_entry,
            access_state=str(access.get("access_state") or ""),
            access_reason=str(access.get("access_reason") or ""),
            resolved_version_id=resolved_version_id,
        )
        return {
            "entry_payload": normalized_entry,
            "library_entry": library_entry,
            "item": self._summarize_item_payload(item_payload) if isinstance(item_payload, dict) else None,
            "version": (
                self._summarize_version_payload(item_payload, version_payload, include_snapshot=False)
                if isinstance(item_payload, dict) and isinstance(version_payload, dict)
                else None
            ),
            "snapshot": (
                self._normalize_version_payload(version_payload, include_snapshot=True)
                .get("snapshot")
                if isinstance(version_payload, dict)
                else None
            ),
        }

    def _resolve_publish_owner(self, workspace_payload: Dict[str, Any], *, requested_by_user_id: Optional[str]) -> str:
        requester = self._normalize_optional_text(requested_by_user_id)
        created_by_user_id = self._normalize_optional_text(workspace_payload.get("created_by_user_id"))
        if requester and created_by_user_id and requester != created_by_user_id:
            raise ValueError("publish_forbidden_owner_mismatch")
        return requester or created_by_user_id or "unknown_owner"

    def _build_source_workspace_key(
        self,
        *,
        owner_user_id: str,
        content_type: str,
        source_workspace_kind: str,
        source_workspace_id: str,
        source_workspace_ref: str,
    ) -> str:
        return "::".join(
            [
                owner_user_id,
                content_type,
                source_workspace_kind,
                source_workspace_id,
                source_workspace_ref,
            ]
        )

    def _normalize_catalog_visibility(self, value: Optional[str], *, allow_empty: bool = False) -> Optional[str]:
        normalized = self._normalize_optional_text(value)
        if normalized is None and allow_empty:
            return None
        if normalized not in {"public", "access_code", "private"}:
            raise ValueError("invalid_catalog_visibility")
        return normalized

    def _normalize_access_code(self, value: Any, *, allow_empty: bool = False) -> Optional[str]:
        normalized = self._normalize_optional_text(value)
        if normalized is None:
            if allow_empty:
                return None
            raise ValueError("access_code_required")
        normalized = normalized.replace(" ", "").replace("-", "").upper()
        if not normalized:
            if allow_empty:
                return None
            raise ValueError("access_code_required")
        if len(normalized) < 6:
            raise ValueError("invalid_access_code")
        return normalized

    def _should_rotate_access_code(self, access_code: Optional[str]) -> bool:
        normalized = self._normalize_access_code(access_code, allow_empty=True)
        if not normalized:
            return True
        return len(normalized) < self._ACCESS_CODE_LENGTH

    def _generate_access_code(self) -> str:
        existing_codes = {
            self._normalize_access_code(item.get("access_code"), allow_empty=True)
            for item in self._list_item_payloads()
            if isinstance(item, dict)
        }
        existing_codes.discard(None)
        code = ""
        while not code or code in existing_codes:
            code = "".join(
                secrets.choice(self._ACCESS_CODE_ALPHABET)
                for _ in range(self._ACCESS_CODE_LENGTH)
            )
        return code

    def _resolve_catalog_visibility_for_publish(
        self,
        existing_item: Any,
        *,
        requested_visibility: Optional[str],
    ) -> str:
        normalized_requested = self._normalize_catalog_visibility(requested_visibility, allow_empty=True)
        if normalized_requested:
            return normalized_requested
        if isinstance(existing_item, dict):
            existing_visibility = self._normalize_catalog_visibility(
                existing_item.get("catalog_visibility"),
                allow_empty=True,
            )
            if existing_visibility:
                return existing_visibility
        return "public"

    def _resolve_access_code_for_publish(
        self,
        existing_item: Any,
        *,
        catalog_visibility: str,
    ) -> Optional[str]:
        existing_code = None
        if isinstance(existing_item, dict):
            existing_code = self._normalize_access_code(existing_item.get("access_code"), allow_empty=True)
        if catalog_visibility != "access_code":
            return None
        if self._should_rotate_access_code(existing_code):
            return self._generate_access_code()
        return existing_code

    def _is_item_owner(self, payload: Dict[str, Any], *, requested_by_user_id: Optional[str]) -> bool:
        requester = self._normalize_optional_text(requested_by_user_id)
        owner_user_id = self._normalize_optional_text(payload.get("owner_user_id"))
        return bool(requester and owner_user_id and requester == owner_user_id)

    def _is_item_deleted_source(self, payload: Dict[str, Any]) -> bool:
        status = str(payload.get("status") or "").strip().lower()
        return status in {"deleted_source", "source_deleted", "deleted"}

    def _should_include_sensitive_fields(self, payload: Dict[str, Any], *, requested_by_user_id: Optional[str]) -> bool:
        return self._is_item_owner(payload, requested_by_user_id=requested_by_user_id)

    def _can_list_item(
        self,
        payload: Dict[str, Any],
        *,
        requested_by_user_id: Optional[str],
        owner_user_id: Optional[str],
        include_owned_non_public: bool,
    ) -> bool:
        if self._is_item_deleted_source(payload):
            return False
        visibility = self._normalize_catalog_visibility(payload.get("catalog_visibility"), allow_empty=True) or "public"
        payload_owner_user_id = self._normalize_optional_text(payload.get("owner_user_id"))
        if owner_user_id:
            if payload_owner_user_id != owner_user_id:
                return False
            if visibility == "public":
                return True
            return bool(
                include_owned_non_public
                and requested_by_user_id
                and owner_user_id == requested_by_user_id
            )
        if visibility != "public":
            return False
        return visibility == "public"

    def _assert_item_access(
        self,
        payload: Dict[str, Any],
        *,
        requested_by_user_id: Optional[str],
        access_code: Optional[str],
    ) -> None:
        if self._is_item_deleted_source(payload):
            raise ValueError("catalog_item_source_deleted")
        visibility = self._normalize_catalog_visibility(payload.get("catalog_visibility"), allow_empty=True) or "public"
        if visibility == "public":
            return
        if self._is_item_owner(payload, requested_by_user_id=requested_by_user_id):
            return
        if visibility == "access_code":
            expected_code = self._normalize_access_code(payload.get("access_code"), allow_empty=True)
            provided_code = self._normalize_access_code(access_code, allow_empty=True)
            if expected_code and provided_code and expected_code == provided_code:
                return
            raise ValueError("catalog_access_code_required")
        raise ValueError("catalog_item_not_accessible")

    def _build_catalog_item_id(self, content_type: str, source_workspace_id: str) -> str:
        base = secure_filename(f"{content_type}_{source_workspace_id}").strip().lower() or f"{content_type}_{uuid4().hex[:8]}"
        existing_ids = {
            str(item.get("item_id") or "").strip()
            for item in self._list_item_payloads()
            if isinstance(item, dict)
        }
        candidate = f"catalog_{base}"
        suffix = 1
        while candidate in existing_ids:
            candidate = f"catalog_{base}_{suffix:02d}"
            suffix += 1
        return candidate

    def _build_catalog_version_id(self, item_id: str) -> str:
        return f"{item_id}:v:{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{uuid4().hex[:8]}"

    def _normalize_content_type(self, value: Optional[str], *, allow_empty: bool = False) -> Optional[str]:
        normalized = self._normalize_optional_text(value)
        if normalized is None and allow_empty:
            return None
        if normalized not in {"complex", "theory"}:
            raise ValueError("invalid_content_type")
        return normalized

    @staticmethod
    def _normalize_optional_text(value: Any) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    def _require_text(self, value: Any, error: str) -> str:
        normalized = self._normalize_optional_text(value)
        if normalized is None:
            raise ValueError(error)
        return normalized

    @staticmethod
    def _utcnow_iso() -> str:
        return datetime.utcnow().isoformat()

    def _json_safe(self, value: Any) -> Any:
        if isinstance(value, dict):
            return {str(key): self._json_safe(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self._json_safe(item) for item in value]
        if isinstance(value, tuple):
            return [self._json_safe(item) for item in value]
        if hasattr(value, "isoformat"):
            try:
                return value.isoformat()
            except Exception:
                pass
        return value
