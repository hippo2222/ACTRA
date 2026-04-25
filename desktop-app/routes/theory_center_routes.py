"""Overview API for the new Theory Center / Theory Hub v2."""

import logging
from collections import defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

from flask import Blueprint, jsonify

from routes._context import get_ctx, is_hosted_web_runtime
from routes._helpers import (
    _build_theory_link_snapshot,
    _compute_inherited_theory_for_topics,
    _maybe_hosted_shadow_write_error_response,
    _serialize_complex_payload,
    _serialize_theory_payload,
    _serialize_workspace_catalog_modules,
    compute_theory_usage_stats,
)

logger = logging.getLogger(__name__)

theory_center_bp = Blueprint("theory_center", __name__)


def _normalize_optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _is_imported_library_theory_payload(item: Any) -> bool:
    if not isinstance(item, dict):
        return False
    created_via = str(
        item.get("created_via")
        or ((item.get("ownership") or {}).get("created_via") if isinstance(item.get("ownership"), dict) else "")
        or ""
    ).strip().lower()
    if created_via in {"workspace_import", "archive_import"}:
        return True
    return bool(
        _normalize_optional_text(item.get("source_catalog_item_id"))
        or _normalize_optional_text(
            (item.get("source_lineage") or {}).get("catalog_item_id")
            if isinstance(item.get("source_lineage"), dict)
            else None
        )
        or _normalize_optional_text(
            (item.get("sourceLineage") or {}).get("catalog_item_id")
            if isinstance(item.get("sourceLineage"), dict)
            else None
        )
    )


def _extract_workspace_owner_user_id(item: Any) -> Optional[str]:
    if not isinstance(item, dict):
        return None
    ownership = item.get("ownership") if isinstance(item.get("ownership"), dict) else {}
    return _normalize_optional_text(
        ownership.get("created_by_user_id")
        or ownership.get("createdByUserId")
        or item.get("created_by_user_id")
        or item.get("createdByUserId")
    )


def _is_visible_library_theory_for_current_user(item: Any) -> bool:
    if not isinstance(item, dict):
        return False
    ownership = item.get("ownership") if isinstance(item.get("ownership"), dict) else {}
    if ownership.get("is_owned_by_current_user") is True:
        return True
    if _extract_workspace_owner_user_id(item) is not None:
        return False
    return _is_imported_library_theory_payload(item)


def _is_imported_library_complex_payload(item: Any) -> bool:
    if not isinstance(item, dict):
        return False
    created_via = str(
        item.get("created_via")
        or ((item.get("ownership") or {}).get("created_via") if isinstance(item.get("ownership"), dict) else "")
        or ""
    ).strip().lower()
    if created_via in {"workspace_import", "archive_import"}:
        return True
    return bool(
        _normalize_optional_text(item.get("source_catalog_item_id"))
        or _normalize_optional_text(
            (item.get("source_lineage") or {}).get("catalog_item_id")
            if isinstance(item.get("source_lineage"), dict)
            else None
        )
        or _normalize_optional_text(
            (item.get("sourceLineage") or {}).get("catalog_item_id")
            if isinstance(item.get("sourceLineage"), dict)
            else None
        )
    )


def _is_visible_library_complex_for_current_user(item: Any) -> bool:
    if not isinstance(item, dict):
        return False
    ownership = item.get("ownership") if isinstance(item.get("ownership"), dict) else {}
    if ownership.get("is_owned_by_current_user") is True:
        return True
    if _extract_workspace_owner_user_id(item) is not None:
        return False
    return _is_imported_library_complex_payload(item)


def _filter_visible_workspace_catalog_modules(modules: Any) -> List[Dict[str, Any]]:
    filtered_modules: List[Dict[str, Any]] = []
    if not isinstance(modules, list):
        return filtered_modules

    for module in modules:
        if not isinstance(module, dict):
            continue
        module_payload = dict(module)
        serialized_topics: List[Dict[str, Any]] = []
        for topic in module_payload.get("topics") or []:
            if not isinstance(topic, dict):
                continue
            topic_payload = dict(topic)
            serialized_tasks: List[Dict[str, Any]] = []
            for task in topic_payload.get("tasks") or []:
                if not isinstance(task, dict):
                    continue
                task_payload = dict(task)
                if _is_visible_library_complex_for_current_user(task_payload):
                    serialized_tasks.append(task_payload)
            topic_payload["tasks"] = serialized_tasks
            if serialized_tasks or _is_visible_library_complex_for_current_user(topic_payload):
                serialized_topics.append(topic_payload)
        module_payload["topics"] = serialized_topics
        if serialized_topics or _is_visible_library_complex_for_current_user(module_payload):
            filtered_modules.append(module_payload)

    return filtered_modules


def _parse_task_ref(task_ref: Any) -> Optional[Tuple[str, str, str]]:
    if not isinstance(task_ref, str):
        return None
    parts = [part.strip() for part in task_ref.split("/")]
    if len(parts) < 3:
        return None
    module_id, topic_id, task_id = parts[0], parts[1], parts[-1]
    if not module_id or not topic_id or not task_id:
        return None
    return module_id, topic_id, task_id


def _collect_topic_refs(task_refs: Any) -> Set[Tuple[str, str]]:
    refs: Set[Tuple[str, str]] = set()
    if not isinstance(task_refs, list):
        return refs
    for task_ref in task_refs:
        parsed = _parse_task_ref(task_ref)
        if not parsed:
            continue
        module_id, topic_id, _ = parsed
        refs.add((module_id, topic_id))
    return refs


def _normalize_complex_theory_mode(payload: Dict[str, Any]) -> str:
    raw = str(payload.get("theory_mode") or "").strip().lower()
    if raw in {"inherit", "override"}:
        return raw
    if _extract_stored_theory_item(payload.get("theory_link")):
        return "override"
    return "inherit"


def _normalize_complex_sync_status(payload: Dict[str, Any]) -> str:
    raw = str(payload.get("theory_sync_status") or "").strip().lower()
    if raw == "conflict":
        return "composite"
    if raw in {"ok", "none", "composite"}:
        return raw

    theory_ids = payload.get("theory_sync_meta", {}).get("theory_ids")
    normalized_theory_ids = (
        [str(value or "").strip() for value in theory_ids if str(value or "").strip()]
        if isinstance(theory_ids, list)
        else []
    )
    if len(normalized_theory_ids) > 1:
        return "composite"

    return "ok" if _extract_stored_theory_item(payload.get("theory_link")) else "none"


def _dedupe_theory_items(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not items:
        return []
    deduped: Dict[str, Dict[str, Any]] = {}
    ordered_fallback: List[Dict[str, Any]] = []
    for item in items:
        theory_id = str(item.get("theory_id") or "").strip()
        library_entry_id = str(item.get("library_entry_id") or "").strip()
        item_key = theory_id or (f"linked:{library_entry_id}" if library_entry_id else "")
        if item_key:
            deduped[item_key] = item
        else:
            ordered_fallback.append(item)
    if deduped:
        return [deduped[key] for key in sorted(deduped.keys())]
    return ordered_fallback


def _extract_stored_theory_item(theory_link: Any) -> Optional[Dict[str, Any]]:
    """Build a theory item from stored data WITHOUT re-fetching from disk.

    Unlike _build_theory_link_snapshot this preserves the updated_at that was
    recorded at the time of the last sync, which is essential for needs_sync
    version comparison.
    """
    if not isinstance(theory_link, dict):
        return None
    live_snapshot = _build_theory_link_snapshot(theory_link)
    if isinstance(live_snapshot, dict) and live_snapshot.get("missing"):
        return None
    source_kind = str(theory_link.get("source_kind") or "").strip().lower() or "workspace"
    item: Dict[str, Any] = {"source_kind": source_kind}
    if source_kind == "linked_library" or str(theory_link.get("library_entry_id") or "").strip():
        library_entry_id = str(theory_link.get("library_entry_id") or "").strip()
        if not library_entry_id:
            return None
        item["library_entry_id"] = library_entry_id
        for key in ("catalog_item_id", "source_theory_id", "access_state", "access_reason"):
            value = str(theory_link.get(key) or "").strip()
            if value:
                item[key] = value
    else:
        theory_id = str(theory_link.get("theory_id") or "").strip()
        if not theory_id:
            return None
        item["theory_id"] = theory_id
    relation = str(theory_link.get("relation") or "link").strip()
    if relation:
        item["relation"] = relation
    updated_at = str(theory_link.get("updated_at") or "").strip()
    if updated_at:
        item["updated_at"] = updated_at
    title_cache = str(theory_link.get("title_cache") or "").strip()
    if title_cache:
        item["title_cache"] = title_cache
    return item


def _build_stored_complex_theory_items(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    mode = _normalize_complex_theory_mode(payload)
    sync_status = _normalize_complex_sync_status(payload)

    items: List[Dict[str, Any]] = []
    if mode == "override":
        snapshot = _extract_stored_theory_item(payload.get("theory_link"))
        if snapshot:
            items.append(snapshot)
        return items

    if sync_status == "ok":
        snapshot = _extract_stored_theory_item(payload.get("theory_link"))
        if snapshot:
            items.append(snapshot)
        return items

    if sync_status != "composite":
        return items

    sync_meta = payload.get("theory_sync_meta") if isinstance(payload.get("theory_sync_meta"), dict) else {}
    raw_links = sync_meta.get("composite_theory_links")
    if isinstance(raw_links, list):
        for raw_link in raw_links:
            snapshot = _extract_stored_theory_item(raw_link)
            if snapshot:
                items.append(snapshot)

    if items:
        return _dedupe_theory_items(items)

    theory_ids = sync_meta.get("theory_ids")
    if isinstance(theory_ids, list):
        for theory_id in theory_ids:
            normalized = str(theory_id or "").strip()
            if not normalized:
                continue
            snapshot = _extract_stored_theory_item({"theory_id": normalized, "relation": "link"})
            if snapshot:
                items.append(snapshot)
    return _dedupe_theory_items(items)


def _build_live_inherited_theory_items(topic_refs: Set[Tuple[str, str]]) -> Tuple[str, List[Dict[str, Any]]]:
    inherited = _compute_inherited_theory_for_topics(topic_refs)
    status = str(inherited.get("status") or "none").strip().lower()
    items: List[Dict[str, Any]] = []

    if status == "ok":
        snapshot = inherited.get("inherited_theory_link")
        if isinstance(snapshot, dict):
            items.append(snapshot)
    elif status == "composite":
        raw_links = inherited.get("inherited_theory_links")
        if isinstance(raw_links, list):
            for raw_link in raw_links:
                if isinstance(raw_link, dict):
                    items.append(raw_link)

    return status, _dedupe_theory_items(items)


def _theory_item_ids(items: List[Dict[str, Any]]) -> Tuple[str, ...]:
    return tuple(
        sorted(
            {
                str(item.get("theory_id") or "").strip()
                for item in items
                if str(item.get("theory_id") or "").strip()
            }
        )
    )


def _theory_item_versions(items: List[Dict[str, Any]]) -> Dict[str, str]:
    """Return {theory_id: updated_at} for items that have both fields set."""
    result: Dict[str, str] = {}
    for item in items:
        theory_id = str(item.get("theory_id") or "").strip()
        updated_at = str(item.get("updated_at") or "").strip()
        if theory_id and updated_at:
            result[theory_id] = updated_at
    return result


def _stored_state_to_ui_state(payload: Dict[str, Any]) -> str:
    mode = _normalize_complex_theory_mode(payload)
    sync_status = _normalize_complex_sync_status(payload)
    if mode == "override":
        items = _build_stored_complex_theory_items(payload)
        return "own" if items else "none"
    if sync_status == "composite":
        return "composite"
    if sync_status == "ok":
        return "single"
    return "none"


def _resolve_complex_overview(
    payload: Dict[str, Any],
    topic_refs: Set[Tuple[str, str]],
) -> Dict[str, Any]:
    mode = _normalize_complex_theory_mode(payload)
    stored_state = _stored_state_to_ui_state(payload)
    stored_items = _build_stored_complex_theory_items(payload)

    if mode == "override":
        theory_items = stored_items
        theory_state = "own" if theory_items else "none"
        return {
            "theory_state": theory_state,
            "theory_source": "own",
            "theory_source_label": "Своя теория комплекса",
            "theory_state_label": (
                "Собственная теория" if theory_state == "own" else "Теория не задана"
            ),
            "theory_items": theory_items,
            "needs_sync": False,
            "sync_label": None,
        }

    live_status, theory_items = _build_live_inherited_theory_items(topic_refs)
    if live_status == "composite":
        theory_state = "composite"
        theory_state_label = "Подборка теорий"
    elif live_status == "ok":
        theory_state = "single"
        theory_state_label = "Одна теория"
    else:
        theory_state = "none"
        theory_state_label = "Теория не задана"

    needs_sync = stored_state != theory_state or _theory_item_ids(stored_items) != _theory_item_ids(theory_items)
    if not needs_sync:
        live_versions = _theory_item_versions(theory_items)
        stored_versions = _theory_item_versions(stored_items)
        if live_versions and live_versions != stored_versions:
            needs_sync = True
    if not needs_sync:
        sync_label = None
    elif theory_state == "composite":
        sync_label = "В темах появилась подборка теорий"
    elif theory_state == "single":
        sync_label = "Теория темы изменилась"
    else:
        sync_label = "Теория больше не задана в темах"

    return {
        "theory_state": theory_state,
        "theory_source": "topics",
        "theory_source_label": "Из тем",
        "theory_state_label": theory_state_label,
        "theory_items": theory_items,
        "needs_sync": needs_sync,
        "sync_label": sync_label,
    }


@theory_center_bp.route("/api/theory-center/overview", methods=["GET"])
def get_theory_center_overview() -> Any:
    try:
        ctx = get_ctx()
        storage = ctx.storage_service

        modules = storage.load_modules()
        if is_hosted_web_runtime():
            modules = _serialize_workspace_catalog_modules(
                modules,
                current_user_id=ctx.user_id,
            )
            modules = _filter_visible_workspace_catalog_modules(modules)
        module_name_by_id: Dict[str, str] = {}
        module_filter_rows: List[Dict[str, str]] = []
        for module in modules:
            module_id = str(module.get("id") or "").strip()
            if not module_id:
                continue
            module_name = str(module.get("name") or module_id).strip() or module_id
            module_name_by_id[module_id] = module_name
            module_filter_rows.append({"id": module_id, "name": module_name})

        serialized_complexes: List[Dict[str, Any]] = []
        topic_to_complex_ids: Dict[Tuple[str, str], Set[str]] = defaultdict(set)

        for complex_obj in ctx.complex_service.get_all_complexes():
            payload = _serialize_complex_payload(complex_obj, current_user_id=ctx.user_id)
            if is_hosted_web_runtime() and not _is_visible_library_complex_for_current_user(payload):
                continue
            serialized_complexes.append(payload)
            complex_id = str(payload.get("id") or "").strip()
            if not complex_id:
                continue
            for topic_ref in _collect_topic_refs(payload.get("tasks")):
                topic_to_complex_ids[topic_ref].add(complex_id)

        usage_stats, topic_theory_map = compute_theory_usage_stats(
            modules=modules,
            complex_payloads=serialized_complexes,
        )

        try:
            theory_catalog = [
                _serialize_theory_payload(item, current_user_id=ctx.user_id)
                for item in ctx.theory_service.list_theories()
            ]
            if is_hosted_web_runtime():
                theory_catalog = [
                    item
                    for item in theory_catalog
                    if _is_visible_library_theory_for_current_user(item)
                ]
        except Exception:
            theory_catalog = []
        theory_meta_by_id: Dict[str, Dict[str, Any]] = {}
        for item in theory_catalog:
            theory_id = str(item.get("id") or "").strip()
            if theory_id:
                theory_meta_by_id[theory_id] = item

        topic_rows: List[Dict[str, Any]] = []
        for module in modules:
            module_id = str(module.get("id") or "").strip()
            if not module_id:
                continue
            module_name = module_name_by_id.get(module_id) or module_id
            topics = module.get("topics") if isinstance(module.get("topics"), list) else []
            for topic in topics:
                topic_id = str(topic.get("id") or "").strip()
                if not topic_id:
                    continue
                topic_name = str(topic.get("name") or topic_id).strip() or topic_id
                theory_link = _build_theory_link_snapshot(
                    storage.get_topic_theory_link(module_id, topic_id)
                )
                has_visible_theory = isinstance(theory_link, dict) and not bool(theory_link.get("missing"))
                linked_complex_ids = sorted(topic_to_complex_ids.get((module_id, topic_id), set()))
                theory_topic_id = theory_link.get("theory_id") if has_visible_theory else None
                meta = theory_meta_by_id.get(theory_topic_id)
                topic_rows.append(
                    {
                        "module_id": module_id,
                        "module_name": module_name,
                        "topic_id": topic_id,
                        "topic_name": topic_name,
                        "has_theory": has_visible_theory,
                        "theory_state": "assigned" if has_visible_theory else "missing",
                        "theory_state_label": "\u0422\u0435\u043e\u0440\u0438\u044f \u0437\u0430\u0434\u0430\u043d\u0430" if has_visible_theory else "\u0422\u0435\u043e\u0440\u0438\u044f \u043d\u0435 \u0437\u0430\u0434\u0430\u043d\u0430",
                        "theory_id": theory_link.get("theory_id") if has_visible_theory else None,
                        "theory_title": theory_link.get("title_cache") if has_visible_theory else None,
                        "theory_link": theory_link,
                        "linked_complexes_count": len(linked_complex_ids),
                        "linked_complex_ids": linked_complex_ids,
                        "theory_has_content": None if meta is None else bool(meta.get("has_content", True)),
                        "theory_image_count": None if meta is None else int(meta.get("image_count") or 0),
                    }
                )

        complex_rows: List[Dict[str, Any]] = []
        for payload in serialized_complexes:
            complex_id = str(payload.get("id") or "").strip()
            if not complex_id:
                continue
            complex_name = str(payload.get("name") or complex_id).strip() or complex_id
            task_refs = payload.get("tasks") if isinstance(payload.get("tasks"), list) else []
            topic_refs = sorted(_collect_topic_refs(task_refs))
            module_ids = sorted({module_id for module_id, _ in topic_refs})
            module_names = [module_name_by_id.get(module_id, module_id) for module_id in module_ids]
            overview = _resolve_complex_overview(payload, set(topic_refs))
            base_theory_items = overview["theory_items"]
            theory_items: List[Dict[str, Any]] = []
            for item in base_theory_items:
                if not isinstance(item, dict):
                    continue
                theory_id = str(item.get("theory_id") or "").strip()
                meta = theory_meta_by_id.get(theory_id)
                enriched = dict(item)
                if meta is not None:
                    enriched["has_content"] = bool(meta.get("has_content", True))
                    enriched["image_count"] = int(meta.get("image_count") or 0)
                theory_items.append(enriched)
            has_empty_theory = any(entry.get("has_content") is False for entry in theory_items)
            theory_ids = [
                str(item.get("theory_id") or "").strip() for item in theory_items if str(item.get("theory_id") or "").strip()
            ]
            theory_titles = [
                str(item.get("title_cache") or item.get("theory_id") or "").strip()
                for item in theory_items
                if str(item.get("title_cache") or item.get("theory_id") or "").strip()
            ]
            complex_rows.append(
                {
                    "complex_id": complex_id,
                    "complex_name": complex_name,
                    "task_count": len(task_refs),
                    "module_ids": module_ids,
                    "module_names": module_names,
                    "topic_count": len(topic_refs),
                    "theory_source": overview["theory_source"],
                    "theory_source_label": overview["theory_source_label"],
                    "theory_state": overview["theory_state"],
                    "theory_state_label": overview["theory_state_label"],
                    "effective_theory_count": len(theory_ids),
                    "has_theory": bool(theory_ids),
                    "theory_ids": theory_ids,
                    "theory_titles": theory_titles,
                    "theory_items": theory_items,
                    "open_theory_id": theory_ids[0] if len(theory_ids) == 1 else None,
                    "can_sync_from_topics": _normalize_complex_theory_mode(payload) == "inherit",
                    "needs_sync": bool(overview.get("needs_sync")),
                    "sync_label": overview.get("sync_label"),
                    "updated_at": payload.get("updated_at"),
                    "ownership": payload.get("ownership") if isinstance(payload.get("ownership"), dict) else {},
                    "has_empty_content": has_empty_theory,
                }
            )

        topic_rows.sort(
            key=lambda row: (
                0 if row.get("theory_state") == "missing" else 1,
                -int(row.get("linked_complexes_count") or 0),
                str(row.get("module_name") or "").lower(),
                str(row.get("topic_name") or "").lower(),
            )
        )
        state_priority = {"none": 0, "composite": 1, "own": 2, "single": 3}
        complex_rows.sort(
            key=lambda row: (
                state_priority.get(str(row.get("theory_state") or ""), 9),
                str(row.get("complex_name") or "").lower(),
            )
        )

        theory_rows: List[Dict[str, Any]] = []
        orphans: List[Dict[str, Any]] = []
        for item in theory_catalog:
            theory_id = str(item.get("id") or "").strip()
            usage = usage_stats.get(theory_id, {"topics": 0, "complexes": 0})
            usage_topics = int(usage.get("topics") or 0)
            usage_complexes = int(usage.get("complexes") or 0)
            theory_row = dict(item)
            theory_row["usage_topics"] = usage_topics
            theory_row["usage_complexes"] = usage_complexes
            theory_row["is_orphan"] = (usage_topics + usage_complexes) == 0
            theory_rows.append(theory_row)
            if theory_row["is_orphan"]:
                orphans.append(theory_row)

        theory_rows.sort(
            key=lambda row: (
                str(row.get("updated_at") or row.get("version") or ""),
                str(row.get("title") or row.get("id") or "").lower(),
            ),
            reverse=True,
        )

        summary = {
            "theories_total": len(theory_rows),
            "topics_total": len(topic_rows),
            "topics_without_theory": sum(1 for row in topic_rows if row.get("theory_state") == "missing"),
            "complexes_total": len(complex_rows),
            "complexes_without_theory": sum(1 for row in complex_rows if row.get("theory_state") == "none"),
            "complexes_single_theory": sum(1 for row in complex_rows if row.get("theory_state") == "single"),
            "complexes_composite_theory": sum(1 for row in complex_rows if row.get("theory_state") == "composite"),
            "complexes_override_theory": sum(1 for row in complex_rows if row.get("theory_state") == "own"),
            "orphan_theories": len(orphans),
        }

        return jsonify(
            {
                "ok": True,
                "summary": summary,
                "filters": {
                    "modules": sorted(module_filter_rows, key=lambda row: str(row.get("name") or "").lower()),
                    "topic_states": [
                        {"id": "all", "label": "Все"},
                        {"id": "missing", "label": "Теория не задана"},
                        {"id": "assigned", "label": "Теория задана"},
                    ],
                    "complex_states": [
                        {"id": "all", "label": "Все"},
                        {"id": "none", "label": "Теория не задана"},
                        {"id": "single", "label": "Одна теория"},
                        {"id": "composite", "label": "Подборка теорий"},
                        {"id": "own", "label": "Своя теория комплекса"},
                    ],
                },
                "topics": topic_rows,
                "complexes": complex_rows,
                "theories": theory_rows,
                "orphans": sorted(
                    orphans,
                    key=lambda row: str(row.get("updated_at") or row.get("version") or ""),
                    reverse=True,
                ),
            }
        )
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to build theory center overview: %s", exc)
        return jsonify({"ok": False, "error": "theory_center_overview_failed"}), 500
