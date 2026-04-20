from __future__ import annotations

from typing import Any, Dict, Iterable, Optional


_SOURCE_LINEAGE_FIELDS = (
    "source_catalog_item_id",
    "source_catalog_version_id",
    "source_entity_kind",
    "source_entity_id",
)


def _normalize_optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def extract_source_lineage_fields(
    payload: Optional[Dict[str, Any]],
    *,
    existing: Optional[Dict[str, Any]] = None,
) -> Dict[str, Optional[str]]:
    normalized_payload = payload if isinstance(payload, dict) else {}
    existing_payload = existing if isinstance(existing, dict) else {}
    extracted: Dict[str, Optional[str]] = {}
    for field in _SOURCE_LINEAGE_FIELDS:
        value = _normalize_optional_text(normalized_payload.get(field))
        if value is None:
            value = _normalize_optional_text(existing_payload.get(field))
        extracted[field] = value
    return extracted


def build_source_lineage_key(
    payload: Optional[Dict[str, Any]] = None,
    *,
    existing: Optional[Dict[str, Any]] = None,
    source_catalog_item_id: Any = None,
    source_catalog_version_id: Any = None,
    source_entity_kind: Any = None,
    source_entity_id: Any = None,
) -> Optional[str]:
    extracted = extract_source_lineage_fields(payload, existing=existing)
    if source_catalog_item_id is not None:
        extracted["source_catalog_item_id"] = _normalize_optional_text(source_catalog_item_id)
    if source_catalog_version_id is not None:
        extracted["source_catalog_version_id"] = _normalize_optional_text(source_catalog_version_id)
    if source_entity_kind is not None:
        extracted["source_entity_kind"] = _normalize_optional_text(source_entity_kind)
    if source_entity_id is not None:
        extracted["source_entity_id"] = _normalize_optional_text(source_entity_id)

    non_empty = {
        key: value
        for key, value in extracted.items()
        if value is not None
    }
    if not non_empty:
        return None
    return "|".join(
        f"{key}={non_empty[key]}"
        for key in _SOURCE_LINEAGE_FIELDS
        if non_empty.get(key) is not None
    )


def has_source_lineage(payload: Optional[Dict[str, Any]], *, existing: Optional[Dict[str, Any]] = None) -> bool:
    return bool(build_source_lineage_key(payload, existing=existing))


def classify_workspace_copy_kind(
    payload: Optional[Dict[str, Any]],
    *,
    existing: Optional[Dict[str, Any]] = None,
) -> str:
    return "imported_copy" if has_source_lineage(payload, existing=existing) else "local_draft"


def clear_source_lineage_fields(payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    normalized = dict(payload or {})
    for field in _SOURCE_LINEAGE_FIELDS:
        normalized[field] = None
    normalized["has_source_lineage"] = False
    normalized["source_lineage"] = None
    normalized["source_lineage_key"] = None
    normalized["workspace_copy_kind"] = "local_draft"
    normalized["workspace_copy"] = {
        "kind": "local_draft",
        "source_lineage_key": None,
        "has_source_lineage": False,
    }
    return normalized


def source_lineage_matches(
    payload: Optional[Dict[str, Any]],
    *,
    source_catalog_item_id: Any = None,
    source_catalog_version_id: Any = None,
    source_entity_kind: Any = None,
    source_entity_id: Any = None,
) -> bool:
    payload_key = build_source_lineage_key(payload)
    if payload_key is None:
        return False
    lookup_key = build_source_lineage_key(
        {},
        source_catalog_item_id=source_catalog_item_id,
        source_catalog_version_id=source_catalog_version_id,
        source_entity_kind=source_entity_kind,
        source_entity_id=source_entity_id,
    )
    return payload_key is not None and payload_key == lookup_key


def find_first_by_source_lineage(
    items: Iterable[Any],
    *,
    source_catalog_item_id: Any = None,
    source_catalog_version_id: Any = None,
    source_entity_kind: Any = None,
    source_entity_id: Any = None,
) -> Optional[Any]:
    for item in items:
        payload = item.dict() if hasattr(item, "dict") else item
        if isinstance(payload, dict) and source_lineage_matches(
            payload,
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_entity_kind=source_entity_kind,
            source_entity_id=source_entity_id,
        ):
            return item
    return None


def build_workspace_entity_ref(
    *,
    entity_kind: str,
    entity_ref: Any = None,
    module_id: Any = None,
    topic_id: Any = None,
    task_id: Any = None,
) -> Optional[str]:
    explicit_ref = _normalize_optional_text(entity_ref)
    if explicit_ref is not None:
        return explicit_ref

    clean_entity_kind = _normalize_optional_text(entity_kind) or "workspace_entity"
    clean_module_id = _normalize_optional_text(module_id)
    clean_topic_id = _normalize_optional_text(topic_id)
    clean_task_id = _normalize_optional_text(task_id)

    if clean_entity_kind == "task":
        if clean_module_id and clean_topic_id and clean_task_id:
            return f"{clean_module_id}/{clean_topic_id}/{clean_task_id}"
        return clean_task_id

    if clean_entity_kind == "topic":
        if clean_module_id and clean_topic_id:
            return f"{clean_module_id}/{clean_topic_id}"
        return clean_topic_id

    if clean_entity_kind == "module":
        return clean_module_id

    return None


def build_source_entity_id(
    *,
    entity_kind: str,
    source_entity_id: Any = None,
    module_id: Any = None,
    topic_id: Any = None,
    task_id: Any = None,
) -> Optional[str]:
    explicit_id = _normalize_optional_text(source_entity_id)
    if explicit_id is not None:
        return explicit_id
    return build_workspace_entity_ref(
        entity_kind=entity_kind,
        module_id=module_id,
        topic_id=topic_id,
        task_id=task_id,
    )


def build_source_lineage_fields(
    *,
    source_catalog_item_id: Any,
    source_catalog_version_id: Any,
    source_entity_kind: Any,
    source_entity_id: Any = None,
    module_id: Any = None,
    topic_id: Any = None,
    task_id: Any = None,
) -> Dict[str, Optional[str]]:
    clean_entity_kind = _normalize_optional_text(source_entity_kind)
    return {
        "source_catalog_item_id": _normalize_optional_text(source_catalog_item_id),
        "source_catalog_version_id": _normalize_optional_text(source_catalog_version_id),
        "source_entity_kind": clean_entity_kind,
        "source_entity_id": build_source_entity_id(
            entity_kind=clean_entity_kind or "workspace_entity",
            source_entity_id=source_entity_id,
            module_id=module_id,
            topic_id=topic_id,
            task_id=task_id,
        ),
    }


def normalize_workspace_lineage_fields(
    payload: Dict[str, Any],
    *,
    entity_kind: str,
    entity_id: Any = None,
    entity_ref: Any = None,
    existing: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    normalized = payload if isinstance(payload, dict) else {}
    existing_payload = existing if isinstance(existing, dict) else {}

    clean_entity_kind = _normalize_optional_text(entity_kind) or "workspace_entity"
    clean_entity_id = _normalize_optional_text(entity_id) or _normalize_optional_text(
        normalized.get("workspace_entity_id")
    ) or _normalize_optional_text(existing_payload.get("workspace_entity_id"))
    clean_entity_ref = _normalize_optional_text(entity_ref) or _normalize_optional_text(
        normalized.get("workspace_entity_ref")
    ) or _normalize_optional_text(existing_payload.get("workspace_entity_ref"))

    normalized["workspace_entity_kind"] = clean_entity_kind
    normalized["workspace_entity_id"] = clean_entity_id
    normalized["workspace_entity_ref"] = clean_entity_ref
    normalized["workspace_entity"] = {
        "kind": clean_entity_kind,
        "id": clean_entity_id,
        "ref": clean_entity_ref,
    }

    extracted_source_fields = extract_source_lineage_fields(normalized, existing=existing_payload)
    source_lineage: Dict[str, str] = {}
    for field in _SOURCE_LINEAGE_FIELDS:
        value = extracted_source_fields.get(field)
        normalized[field] = value
        if value is not None:
            source_lineage[field] = value

    has_source_lineage = bool(source_lineage)
    source_lineage_key = build_source_lineage_key(normalized)
    workspace_copy_kind = "imported_copy" if has_source_lineage else "local_draft"
    normalized["has_source_lineage"] = has_source_lineage
    normalized["source_lineage"] = source_lineage if has_source_lineage else None
    normalized["source_lineage_key"] = source_lineage_key
    normalized["workspace_copy_kind"] = workspace_copy_kind
    normalized["workspace_copy"] = {
        "kind": workspace_copy_kind,
        "source_lineage_key": source_lineage_key,
        "has_source_lineage": has_source_lineage,
    }
    return normalized


def normalize_workspace_graph_entity_fields(
    payload: Dict[str, Any],
    *,
    entity_kind: str,
    module_id: Any = None,
    topic_id: Any = None,
    task_id: Any = None,
    existing: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    clean_entity_kind = _normalize_optional_text(entity_kind) or "workspace_entity"
    clean_module_id = _normalize_optional_text(module_id)
    clean_topic_id = _normalize_optional_text(topic_id)
    clean_task_id = _normalize_optional_text(task_id)

    if clean_entity_kind == "task":
        entity_id = clean_task_id
    elif clean_entity_kind == "topic":
        entity_id = clean_topic_id
    elif clean_entity_kind == "module":
        entity_id = clean_module_id
    else:
        entity_id = None

    entity_ref = build_workspace_entity_ref(
        entity_kind=clean_entity_kind,
        module_id=clean_module_id,
        topic_id=clean_topic_id,
        task_id=clean_task_id,
    )
    return normalize_workspace_lineage_fields(
        payload,
        entity_kind=clean_entity_kind,
        entity_id=entity_id,
        entity_ref=entity_ref,
        existing=existing,
    )
