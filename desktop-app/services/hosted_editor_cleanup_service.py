from __future__ import annotations

import copy
from dataclasses import asdict, dataclass
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple


TaskRef = Tuple[str, str, str]
TaskContentLoader = Callable[[str, str, str], Optional[Dict[str, Any]]]

_IMPORTED_CREATED_VIA_MARKERS = {"workspace_import", "archive_import"}


def _normalize_optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _normalize_lower_text(value: Any) -> str:
    return str(value or "").strip().lower()


def _safe_dict(value: Any) -> Dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _extract_ownership_dict(payload: Any) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    return _safe_dict(payload.get("ownership"))


def _extract_created_via(payload: Any) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    ownership = _extract_ownership_dict(payload)
    return _normalize_optional_text(payload.get("created_via")) or _normalize_optional_text(
        ownership.get("created_via")
    )


def _extract_created_by_user_id(payload: Any) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    ownership = _extract_ownership_dict(payload)
    return _normalize_optional_text(payload.get("created_by_user_id")) or _normalize_optional_text(
        ownership.get("created_by_user_id")
    )


def _extract_content_scope(payload: Any) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    ownership = _extract_ownership_dict(payload)
    return _normalize_optional_text(payload.get("content_scope")) or _normalize_optional_text(
        ownership.get("content_scope")
    )


def _extract_workspace_copy_kind(payload: Any) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    return _normalize_optional_text(payload.get("workspace_copy_kind"))


def _has_source_lineage(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    if bool(payload.get("has_source_lineage")):
        return True
    if _normalize_optional_text(payload.get("source_catalog_item_id")):
        return True
    if _normalize_optional_text(payload.get("source_lineage_key")):
        return True
    source_lineage = payload.get("source_lineage")
    if isinstance(source_lineage, dict) and _normalize_optional_text(source_lineage.get("catalog_item_id")):
        return True
    source_lineage_camel = payload.get("sourceLineage")
    if isinstance(source_lineage_camel, dict) and _normalize_optional_text(
        source_lineage_camel.get("catalog_item_id")
    ):
        return True
    return False


def _is_imported_workspace_payload(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    created_via = _normalize_lower_text(_extract_created_via(payload))
    if created_via in _IMPORTED_CREATED_VIA_MARKERS:
        return True
    return _has_source_lineage(payload)


def _task_content_metadata(row: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(row, dict):
        return {}
    task_data = row.get("task_data")
    if not isinstance(task_data, dict):
        return {}
    return _safe_dict(task_data.get("meta"))


def _iter_catalog_task_refs(modules: Sequence[Dict[str, Any]]) -> List[TaskRef]:
    refs: List[TaskRef] = []
    for module in modules or []:
        if not isinstance(module, dict):
            continue
        module_id = _normalize_optional_text(module.get("id"))
        if not module_id:
            continue
        for topic in module.get("topics") or []:
            if not isinstance(topic, dict):
                continue
            topic_id = _normalize_optional_text(topic.get("id"))
            if not topic_id:
                continue
            for task in topic.get("tasks") or []:
                if not isinstance(task, dict):
                    continue
                task_id = _normalize_optional_text(task.get("id"))
                if not task_id:
                    continue
                refs.append((module_id, topic_id, task_id))
    return refs


@dataclass(frozen=True)
class CleanupEntityRecord:
    entity_kind: str
    ref: str
    created_via: str
    created_by_user_id: str
    reasons: List[str]


@dataclass(frozen=True)
class CleanupDecision:
    removable: bool
    created_via: str
    created_by_user_id: str
    reasons: List[str]


@dataclass
class HostedEditorCleanupPlan:
    filtered_modules: List[Dict[str, Any]]
    modules_to_delete: List[CleanupEntityRecord]
    topics_to_delete: List[CleanupEntityRecord]
    tasks_to_delete: List[CleanupEntityRecord]
    task_content_to_delete: List[CleanupEntityRecord]
    kept_orphan_task_content: List[CleanupEntityRecord]

    @property
    def summary(self) -> Dict[str, int]:
        return {
            "modules_to_delete": len(self.modules_to_delete),
            "topics_to_delete": len(self.topics_to_delete),
            "tasks_to_delete": len(self.tasks_to_delete),
            "task_content_to_delete": len(self.task_content_to_delete),
            "kept_orphan_task_content": len(self.kept_orphan_task_content),
            "remaining_modules": len(self.filtered_modules),
            "remaining_tasks": len(_iter_catalog_task_refs(self.filtered_modules)),
        }

    def to_report(self) -> Dict[str, Any]:
        return {
            "summary": self.summary,
            "modules_to_delete": [asdict(item) for item in self.modules_to_delete],
            "topics_to_delete": [asdict(item) for item in self.topics_to_delete],
            "tasks_to_delete": [asdict(item) for item in self.tasks_to_delete],
            "task_content_to_delete": [asdict(item) for item in self.task_content_to_delete],
            "kept_orphan_task_content": [asdict(item) for item in self.kept_orphan_task_content],
            "filtered_modules": copy.deepcopy(self.filtered_modules),
        }


class HostedEditorCleanupService:
    """Build and apply cleanup plans for ownerless/legacy hosted editor data."""

    def __init__(
        self,
        *,
        repository: Optional[Any] = None,
        content_repository: Optional[Any] = None,
    ) -> None:
        self.repository = repository
        self.content_repository = content_repository

    @staticmethod
    def _make_record(
        *,
        entity_kind: str,
        ref: str,
        decision: CleanupDecision,
        extra_reasons: Optional[Iterable[str]] = None,
    ) -> CleanupEntityRecord:
        reasons = list(decision.reasons)
        for reason in extra_reasons or []:
            clean_reason = _normalize_optional_text(reason)
            if clean_reason and clean_reason not in reasons:
                reasons.append(clean_reason)
        return CleanupEntityRecord(
            entity_kind=entity_kind,
            ref=ref,
            created_via=decision.created_via,
            created_by_user_id=decision.created_by_user_id,
            reasons=reasons,
        )

    @staticmethod
    def _analyze_payload(payload: Any) -> CleanupDecision:
        if not isinstance(payload, dict):
            return CleanupDecision(removable=False, created_via="", created_by_user_id="", reasons=[])

        created_via = _normalize_optional_text(_extract_created_via(payload)) or ""
        created_by_user_id = _normalize_optional_text(_extract_created_by_user_id(payload)) or ""
        content_scope = _normalize_lower_text(_extract_content_scope(payload))
        workspace_copy_kind = _normalize_lower_text(_extract_workspace_copy_kind(payload))
        reasons: List[str] = []

        if _is_imported_workspace_payload(payload):
            return CleanupDecision(
                removable=False,
                created_via=created_via,
                created_by_user_id=created_by_user_id,
                reasons=[],
            )

        if content_scope and content_scope != "shared_local":
            return CleanupDecision(
                removable=False,
                created_via=created_via,
                created_by_user_id=created_by_user_id,
                reasons=[],
            )

        if workspace_copy_kind and workspace_copy_kind != "local_draft":
            return CleanupDecision(
                removable=False,
                created_via=created_via,
                created_by_user_id=created_by_user_id,
                reasons=[],
            )

        if not created_by_user_id:
            reasons.append("ownerless")
        if _normalize_lower_text(created_via) == "legacy_unknown":
            reasons.append("legacy_unknown")

        return CleanupDecision(
            removable=bool(reasons),
            created_via=created_via,
            created_by_user_id=created_by_user_id,
            reasons=reasons,
        )

    def build_plan(
        self,
        *,
        modules: Sequence[Dict[str, Any]],
        task_content_refs: Optional[Sequence[TaskRef]] = None,
        task_content_loader: Optional[TaskContentLoader] = None,
    ) -> HostedEditorCleanupPlan:
        filtered_modules: List[Dict[str, Any]] = []
        modules_to_delete: List[CleanupEntityRecord] = []
        topics_to_delete: List[CleanupEntityRecord] = []
        tasks_to_delete: List[CleanupEntityRecord] = []
        task_content_to_delete: List[CleanupEntityRecord] = []
        kept_orphan_task_content: List[CleanupEntityRecord] = []

        removed_task_refs: Set[TaskRef] = set()

        for module in modules or []:
            if not isinstance(module, dict):
                continue
            module_id = _normalize_optional_text(module.get("id"))
            if not module_id:
                continue

            module_decision = self._analyze_payload(module)
            filtered_topics: List[Dict[str, Any]] = []

            for topic in module.get("topics") or []:
                if not isinstance(topic, dict):
                    continue
                topic_id = _normalize_optional_text(topic.get("id"))
                if not topic_id:
                    continue

                topic_decision = self._analyze_payload(topic)
                filtered_tasks: List[Dict[str, Any]] = []

                for task in topic.get("tasks") or []:
                    if not isinstance(task, dict):
                        continue
                    task_id = _normalize_optional_text(task.get("id"))
                    if not task_id:
                        continue

                    task_decision = self._analyze_payload(task)
                    task_ref = (module_id, topic_id, task_id)
                    if task_decision.removable:
                        removed_task_refs.add(task_ref)
                        tasks_to_delete.append(
                            self._make_record(
                                entity_kind="task",
                                ref="/".join(task_ref),
                                decision=task_decision,
                            )
                        )
                        continue
                    filtered_tasks.append(copy.deepcopy(task))

                if topic_decision.removable and not filtered_tasks:
                    topics_to_delete.append(
                        self._make_record(
                            entity_kind="topic",
                            ref=f"{module_id}/{topic_id}",
                            decision=topic_decision,
                        )
                    )
                    continue

                topic_copy = copy.deepcopy(topic)
                topic_copy["tasks"] = filtered_tasks
                filtered_topics.append(topic_copy)

            if module_decision.removable and not filtered_topics:
                modules_to_delete.append(
                    self._make_record(
                        entity_kind="module",
                        ref=module_id,
                        decision=module_decision,
                    )
                )
                continue

            module_copy = copy.deepcopy(module)
            module_copy["topics"] = filtered_topics
            filtered_modules.append(module_copy)

        remaining_task_refs = set(_iter_catalog_task_refs(filtered_modules))

        for module_id, topic_id, task_id in sorted(task_content_refs or []):
            task_ref = (module_id, topic_id, task_id)
            ref_text = "/".join(task_ref)
            if task_ref in removed_task_refs:
                task_content_to_delete.append(
                    CleanupEntityRecord(
                        entity_kind="task_content",
                        ref=ref_text,
                        created_via="",
                        created_by_user_id="",
                        reasons=["catalog_task_deleted"],
                    )
                )
                continue
            if task_ref in remaining_task_refs:
                continue

            row = task_content_loader(module_id, topic_id, task_id) if callable(task_content_loader) else None
            meta = _task_content_metadata(row)
            task_content_decision = self._analyze_payload(meta)
            if task_content_decision.removable:
                task_content_to_delete.append(
                    self._make_record(
                        entity_kind="task_content",
                        ref=ref_text,
                        decision=task_content_decision,
                        extra_reasons=["orphan_task_content"],
                    )
                )
            else:
                kept_orphan_task_content.append(
                    CleanupEntityRecord(
                        entity_kind="task_content",
                        ref=ref_text,
                        created_via=task_content_decision.created_via,
                        created_by_user_id=task_content_decision.created_by_user_id,
                        reasons=["orphan_task_content_kept"],
                    )
                )

        return HostedEditorCleanupPlan(
            filtered_modules=filtered_modules,
            modules_to_delete=modules_to_delete,
            topics_to_delete=topics_to_delete,
            tasks_to_delete=tasks_to_delete,
            task_content_to_delete=task_content_to_delete,
            kept_orphan_task_content=kept_orphan_task_content,
        )

    def build_plan_from_repositories(self) -> HostedEditorCleanupPlan:
        if self.repository is None or self.content_repository is None:
            raise RuntimeError("repository_and_content_repository_required")

        modules = list(self.repository.load_catalog() or [])
        task_content_refs = list(self.content_repository.list_task_refs() or [])
        return self.build_plan(
            modules=modules,
            task_content_refs=task_content_refs,
            task_content_loader=self.content_repository.get_task_content,
        )

    def apply_hosted_plan(self, plan: HostedEditorCleanupPlan) -> Dict[str, int]:
        if self.repository is None or self.content_repository is None:
            raise RuntimeError("repository_and_content_repository_required")

        self.repository.replace_catalog(copy.deepcopy(plan.filtered_modules))
        deleted_task_content = 0
        for record in plan.task_content_to_delete:
            parts = record.ref.split("/")
            if len(parts) != 3:
                continue
            if self.content_repository.delete_task_content(parts[0], parts[1], parts[2]):
                deleted_task_content += 1

        return {
            **plan.summary,
            "task_content_deleted": deleted_task_content,
        }

    @staticmethod
    def apply_shadow_plan(storage_service: Any, plan: HostedEditorCleanupPlan) -> Dict[str, int]:
        deleted_tasks = 0
        deleted_topics = 0
        deleted_modules = 0

        deleted_module_ids = {record.ref for record in plan.modules_to_delete}
        deleted_topic_refs = {record.ref for record in plan.topics_to_delete}

        for record in plan.tasks_to_delete:
            parts = record.ref.split("/")
            if len(parts) != 3:
                continue
            module_id, topic_id, task_id = parts
            if module_id in deleted_module_ids:
                continue
            if f"{module_id}/{topic_id}" in deleted_topic_refs:
                continue
            if bool(storage_service.delete_task(module_id, topic_id, task_id)):
                deleted_tasks += 1

        for record in plan.topics_to_delete:
            parts = record.ref.split("/")
            if len(parts) != 2:
                continue
            module_id, topic_id = parts
            if module_id in deleted_module_ids:
                continue
            if bool(storage_service.delete_topic(module_id, topic_id)):
                deleted_topics += 1

        for record in plan.modules_to_delete:
            if bool(storage_service.delete_module(record.ref)):
                deleted_modules += 1

        return {
            **plan.summary,
            "shadow_tasks_deleted": deleted_tasks,
            "shadow_topics_deleted": deleted_topics,
            "shadow_modules_deleted": deleted_modules,
        }
