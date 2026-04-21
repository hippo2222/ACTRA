from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

from services.user_service import USER_PLAN_FREE, USER_PLAN_PREMIUM, resolve_effective_plan
from services.workspace_lineage import has_source_lineage


_ENTITY_KEY_BY_KIND = {
    "theory": "theories",
    "complex": "complexes",
    "task": "tasks",
}

_ENTITY_KIND_BY_KEY = {value: key for key, value in _ENTITY_KEY_BY_KIND.items()}

_ENTITY_LABELS = {
    "theory": "теорий",
    "complex": "комплексов",
    "task": "заданий",
}

_LIMIT_SPECS = {
    "theory": {"personal_limit": 5, "library_limit": 10},
    "complex": {"personal_limit": 5, "library_limit": 10},
    "task": {"personal_limit": 20, "library_limit": None},
}


@dataclass
class WorkspaceLimitError(ValueError):
    entity_kind: str
    limit_kind: str
    count: int
    limit: int
    remaining: int
    plan: str
    message: str

    @property
    def scope(self) -> str:
        if self.limit_kind == "personal":
            return "workspace_non_catalog_only"
        return "workspace_and_linked_library"

    def to_payload(self) -> Dict[str, Any]:
        return {
            "ok": False,
            "error": "workspace_limit_reached",
            "message": self.message,
            "details": {
                "entity_kind": self.entity_kind,
                "limit_kind": self.limit_kind,
                "count": int(self.count),
                "limit": int(self.limit),
                "remaining": int(self.remaining),
                "plan": self.plan,
                "scope": self.scope,
            },
        }


class WorkspaceLimitsService:
    def __init__(
        self,
        *,
        user_service: Any,
        theory_service: Any,
        complex_service: Any,
        storage_service: Any,
        catalog_service: Any,
    ) -> None:
        self.user_service = user_service
        self.theory_service = theory_service
        self.complex_service = complex_service
        self.storage_service = storage_service
        self.catalog_service = catalog_service

    def get_summary(self, user_id: Any) -> Dict[str, Any]:
        clean_user_id = self._normalize_optional_text(user_id)
        plan = self._resolve_plan(clean_user_id)
        summary = {
            "ok": True,
            "plan": plan,
            "scope": {
                "personal": "workspace_non_catalog_only",
                "library_total": "workspace_and_linked_library",
            },
        }
        for entity_kind, entity_key in _ENTITY_KEY_BY_KIND.items():
            summary[entity_key] = self._build_entity_summary(clean_user_id, entity_kind, plan)
        return summary

    def assert_can_create_workspace_entity(self, user_id: Any, entity_kind: str) -> Dict[str, Any]:
        clean_entity_kind = self._normalize_entity_kind(entity_kind)
        requests = [{"entity_kind": clean_entity_kind, "limit_kind": "personal", "slots": 1}]
        if clean_entity_kind in {"theory", "complex"}:
            requests.append({"entity_kind": clean_entity_kind, "limit_kind": "library_total", "slots": 1})
        evaluation = self.evaluate_capacity(user_id, requests=requests)
        self._raise_for_blocked_evaluation(evaluation)
        return evaluation

    def assert_can_add_library_entries(
        self,
        user_id: Any,
        *,
        theory_slots: int = 0,
        complex_slots: int = 0,
    ) -> Dict[str, Any]:
        requests: List[Dict[str, Any]] = []
        if int(theory_slots or 0) > 0:
            requests.append({"entity_kind": "theory", "limit_kind": "library_total", "slots": int(theory_slots or 0)})
        if int(complex_slots or 0) > 0:
            requests.append({"entity_kind": "complex", "limit_kind": "library_total", "slots": int(complex_slots or 0)})
        evaluation = self.evaluate_capacity(user_id, requests=requests)
        self._raise_for_blocked_evaluation(evaluation)
        return evaluation

    def evaluate_capacity(self, user_id: Any, *, requests: Optional[Iterable[Dict[str, Any]]] = None) -> Dict[str, Any]:
        normalized_requests = self._normalize_requests(requests)
        summary = self.get_summary(user_id)
        plan = str(summary.get("plan") or USER_PLAN_FREE).strip() or USER_PLAN_FREE
        if plan == USER_PLAN_PREMIUM:
            return {
                "ok": True,
                "blocked": False,
                "plan": plan,
                "requests": normalized_requests,
                "errors": [],
                "summary": summary,
            }

        errors: List[Dict[str, Any]] = []
        for request in normalized_requests:
            entity_kind = request["entity_kind"]
            entity_key = _ENTITY_KEY_BY_KIND[entity_kind]
            entity_summary = summary.get(entity_key) if isinstance(summary.get(entity_key), dict) else {}
            slots = int(request.get("slots") or 0)
            if slots <= 0:
                continue

            limit_kind = str(request.get("limit_kind") or "").strip()
            if limit_kind == "personal":
                errors.extend(self._evaluate_personal_limit(entity_kind, entity_summary, slots, plan))
            elif limit_kind == "library_total":
                errors.extend(self._evaluate_library_limit(entity_kind, entity_summary, slots, plan))

        blocked = bool(errors)
        return {
            "ok": not blocked,
            "blocked": blocked,
            "plan": plan,
            "requests": normalized_requests,
            "errors": errors,
            "summary": summary,
        }

    def _build_entity_summary(self, user_id: Optional[str], entity_kind: str, plan: str) -> Dict[str, Any]:
        clean_entity_kind = self._normalize_entity_kind(entity_kind)
        spec = dict(_LIMIT_SPECS[clean_entity_kind])
        workspace_items = self._list_workspace_items(user_id, clean_entity_kind)
        workspace_total_count = len(workspace_items)
        personal_count = sum(1 for item in workspace_items if self._is_personal_workspace_item(item))
        linked_library_count = self._count_linked_library_entries(user_id, clean_entity_kind)
        library_total_count = workspace_total_count + linked_library_count

        personal_limit = None if plan == USER_PLAN_PREMIUM else spec.get("personal_limit")
        library_limit = None if plan == USER_PLAN_PREMIUM else spec.get("library_limit")
        remaining_personal = None if personal_limit is None else max(0, int(personal_limit) - int(personal_count))
        remaining_library = None if library_limit is None else max(0, int(library_limit) - int(library_total_count))

        return {
            "entity_kind": clean_entity_kind,
            "entity_key": _ENTITY_KEY_BY_KIND[clean_entity_kind],
            "label": _ENTITY_LABELS[clean_entity_kind],
            "personal_count": int(personal_count),
            "linked_library_count": int(linked_library_count),
            "workspace_total_count": int(workspace_total_count),
            "library_total_count": int(library_total_count),
            "personal_limit": personal_limit,
            "library_limit": library_limit,
            "remaining_personal": remaining_personal,
            "remaining_library": remaining_library,
            "is_personal_limited": personal_limit is not None,
            "is_library_limited": library_limit is not None,
            "is_personal_blocked": personal_limit is not None and personal_count >= int(personal_limit),
            "is_library_blocked": library_limit is not None and library_total_count >= int(library_limit),
            "is_blocked": (
                (personal_limit is not None and personal_count >= int(personal_limit))
                or (library_limit is not None and library_total_count >= int(library_limit))
            ),
        }

    def _normalize_requests(self, requests: Optional[Iterable[Dict[str, Any]]]) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        for raw_request in requests or []:
            if not isinstance(raw_request, dict):
                continue
            clean_entity_kind = self._normalize_entity_kind(raw_request.get("entity_kind"))
            limit_kind = str(raw_request.get("limit_kind") or "").strip()
            slots = int(raw_request.get("slots") or 0)
            if limit_kind not in {"personal", "library_total"} or slots <= 0:
                continue
            normalized.append(
                {
                    "entity_kind": clean_entity_kind,
                    "entity_key": _ENTITY_KEY_BY_KIND[clean_entity_kind],
                    "limit_kind": limit_kind,
                    "slots": slots,
                }
            )
        return normalized

    def _evaluate_personal_limit(
        self,
        entity_kind: str,
        entity_summary: Dict[str, Any],
        slots: int,
        plan: str,
    ) -> List[Dict[str, Any]]:
        limit = entity_summary.get("personal_limit")
        if limit is None:
            return []
        count = int(entity_summary.get("personal_count") or 0)
        limit_value = int(limit)
        projected = count + int(slots)
        if projected <= limit_value:
            return []
        remaining = max(0, limit_value - count)
        return [
            {
                "entity_kind": entity_kind,
                "limit_kind": "personal",
                "count": count,
                "limit": limit_value,
                "remaining": remaining,
                "plan": plan,
                "message": self._build_limit_message(entity_kind, "personal", count, limit_value),
            }
        ]

    def _evaluate_library_limit(
        self,
        entity_kind: str,
        entity_summary: Dict[str, Any],
        slots: int,
        plan: str,
    ) -> List[Dict[str, Any]]:
        limit = entity_summary.get("library_limit")
        if limit is None:
            return []
        count = int(entity_summary.get("library_total_count") or 0)
        limit_value = int(limit)
        projected = count + int(slots)
        if projected <= limit_value:
            return []
        remaining = max(0, limit_value - count)
        return [
            {
                "entity_kind": entity_kind,
                "limit_kind": "library_total",
                "count": count,
                "limit": limit_value,
                "remaining": remaining,
                "plan": plan,
                "message": self._build_limit_message(entity_kind, "library_total", count, limit_value),
            }
        ]

    def _raise_for_blocked_evaluation(self, evaluation: Dict[str, Any]) -> None:
        if not bool(evaluation.get("blocked")):
            return
        errors = evaluation.get("errors") if isinstance(evaluation.get("errors"), list) else []
        if not errors:
            raise WorkspaceLimitError(
                entity_kind="theory",
                limit_kind="library_total",
                count=0,
                limit=0,
                remaining=0,
                plan=str(evaluation.get("plan") or USER_PLAN_FREE),
                message="Лимит библиотеки исчерпан.",
            )
        first_error = errors[0] if isinstance(errors[0], dict) else {}
        raise WorkspaceLimitError(
            entity_kind=str(first_error.get("entity_kind") or "theory"),
            limit_kind=str(first_error.get("limit_kind") or "library_total"),
            count=int(first_error.get("count") or 0),
            limit=int(first_error.get("limit") or 0),
            remaining=int(first_error.get("remaining") or 0),
            plan=str(first_error.get("plan") or evaluation.get("plan") or USER_PLAN_FREE),
            message=str(first_error.get("message") or "Лимит библиотеки исчерпан."),
        )

    def _build_limit_message(self, entity_kind: str, limit_kind: str, count: int, limit: int) -> str:
        label = _ENTITY_LABELS.get(entity_kind, "элементов")
        if limit_kind == "personal":
            return f"Лимит собственных {label} исчерпан: {count}/{limit}. Удалите лишнее или перейдите на Premium."
        return f"Лимит библиотеки для {label} исчерпан: {count}/{limit}. Удалите лишнее или перейдите на Premium."

    def _resolve_plan(self, user_id: Optional[str]) -> str:
        clean_user_id = self._normalize_optional_text(user_id)
        if not clean_user_id:
            return USER_PLAN_FREE
        try:
            user = self.user_service.get_user(clean_user_id)
        except Exception:
            user = None
        return resolve_effective_plan(user)

    def _list_workspace_items(self, user_id: Optional[str], entity_kind: str) -> List[Dict[str, Any]]:
        clean_user_id = self._normalize_optional_text(user_id)
        if not clean_user_id:
            return []
        if entity_kind == "theory":
            raw_items = self.theory_service.list_theories()
            return [
                item
                for item in self._to_plain_dicts(raw_items)
                if self._normalize_optional_text(item.get("created_by_user_id")) == clean_user_id
            ]
        if entity_kind == "complex":
            list_complexes = getattr(self.complex_service, "list_complexes", None)
            if callable(list_complexes):
                raw_items = list_complexes()
            else:
                raw_items = self.complex_service.load_complexes()
            return [
                item
                for item in self._to_plain_dicts(raw_items)
                if self._normalize_optional_text(item.get("created_by_user_id")) == clean_user_id
            ]
        if entity_kind == "task":
            return self._list_user_tasks(clean_user_id)
        raise ValueError(f"unsupported_entity_kind:{entity_kind}")

    def _list_user_tasks(self, user_id: str) -> List[Dict[str, Any]]:
        tasks: List[Dict[str, Any]] = []
        for module in self.storage_service.load_modules() or []:
            if not isinstance(module, dict):
                continue
            topics = module.get("topics") if isinstance(module.get("topics"), list) else []
            for topic in topics:
                if not isinstance(topic, dict):
                    continue
                for task in topic.get("tasks") or []:
                    metadata = self._extract_task_metadata(task)
                    if not isinstance(metadata, dict):
                        continue
                    if self._normalize_optional_text(metadata.get("created_by_user_id")) != user_id:
                        continue
                    tasks.append(metadata)
        return tasks

    def _extract_task_metadata(self, task: Any) -> Dict[str, Any]:
        payload = task if isinstance(task, dict) else {}
        metadata = payload.get("metadata")
        if isinstance(metadata, dict):
            return dict(metadata)
        task_data = payload.get("task_data") if isinstance(payload.get("task_data"), dict) else {}
        meta = task_data.get("meta")
        if isinstance(meta, dict):
            return dict(meta)
        return dict(payload)

    def _count_linked_library_entries(self, user_id: Optional[str], entity_kind: str) -> int:
        clean_user_id = self._normalize_optional_text(user_id)
        if not clean_user_id:
            return 0
        if entity_kind == "theory":
            payload = self.catalog_service.list_theory_library_entries(requested_by_user_id=clean_user_id)
            entries = payload.get("entries") if isinstance(payload, dict) else []
            return len(entries) if isinstance(entries, list) else 0
        if entity_kind == "complex":
            payload = self.catalog_service.list_complex_library_entries(requested_by_user_id=clean_user_id)
            entries = payload.get("entries") if isinstance(payload, dict) else []
            return len(entries) if isinstance(entries, list) else 0
        return 0

    def _is_personal_workspace_item(self, payload: Dict[str, Any]) -> bool:
        if not isinstance(payload, dict):
            return False
        if has_source_lineage(payload):
            return False
        created_via = str(payload.get("created_via") or "").strip().lower()
        if not created_via:
            return True
        if created_via == "manual_copy":
            return False
        if "import" in created_via:
            return False
        if "copy" in created_via:
            return False
        return True

    def _normalize_entity_kind(self, entity_kind: Any) -> str:
        normalized = str(entity_kind or "").strip().lower()
        if normalized in _ENTITY_KIND_BY_KEY:
            return _ENTITY_KIND_BY_KEY[normalized]
        if normalized in _ENTITY_KEY_BY_KIND:
            return normalized
        raise ValueError(f"unsupported_entity_kind:{normalized}")

    def _to_plain_dicts(self, items: Any) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []
        for item in items or []:
            if hasattr(item, "dict"):
                payload = item.dict()
            elif isinstance(item, dict):
                payload = item
            else:
                continue
            result.append(dict(payload))
        return result

    def _normalize_optional_text(self, value: Any) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None
