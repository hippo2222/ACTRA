"""Shared helper functions used by multiple route modules."""

import logging
import uuid as _uuid
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from flask import jsonify

from persistence.runtime import HOSTED_SHADOW_WRITE_FALLBACK_ENV
from routes._context import get_authenticated_user_id, get_ctx, is_hosted_web_runtime
from services.hosted_shadow_fallback import (
    HostedShadowReadFallbackDisabledError,
    HostedShadowWriteFallbackDisabledError,
)

logger = logging.getLogger(__name__)


def compute_theory_usage_stats(
    *,
    modules: List[Dict[str, Any]],
    complex_payloads: List[Dict[str, Any]],
) -> Tuple[Dict[str, Dict[str, int]], Dict[Tuple[str, str], Optional[str]]]:
    """Return usage stats per theory along with topic->theory map.

    usage_stats[theory_id] = {"topics": <count>, "complexes": <count>}.
    topic_theory_map[(module_id, topic_id)] = theory_id or None.
    """

    def _collect_topic_refs(task_refs: Any) -> Set[Tuple[str, str]]:
        refs: Set[Tuple[str, str]] = set()
        if not isinstance(task_refs, list):
            return refs
        for task_ref in task_refs:
            if not isinstance(task_ref, str):
                continue
            parts = [part.strip() for part in task_ref.split("/")]
            if len(parts) < 3:
                continue
            module_id, topic_id = parts[0], parts[1]
            if module_id and topic_id:
                refs.add((module_id, topic_id))
        return refs

    def _collect_direct_complex_theory_ids(payload: Any) -> Set[str]:
        if not isinstance(payload, dict):
            return set()
        theory_ids: Set[str] = set()
        theory_link = payload.get("theory_link") if isinstance(payload.get("theory_link"), dict) else {}
        if theory_link:
            source_kind = _normalize_optional_text(theory_link.get("source_kind")) or "workspace"
            access_state = str(theory_link.get("access_state") or "").strip().lower()
            if source_kind != "linked_library" or access_state != "revoked":
                direct_theory_id = _normalize_optional_text(
                    theory_link.get("source_theory_id") or theory_link.get("theory_id")
                )
                if direct_theory_id:
                    theory_ids.add(direct_theory_id)

        sync_meta = payload.get("theory_sync_meta") if isinstance(payload.get("theory_sync_meta"), dict) else {}
        raw_theory_ids = sync_meta.get("theory_ids") if isinstance(sync_meta.get("theory_ids"), list) else []
        for raw_theory_id in raw_theory_ids:
            theory_id = _normalize_optional_text(raw_theory_id)
            if theory_id:
                theory_ids.add(theory_id)
        return theory_ids

    storage = get_ctx().storage_service
    usage: Dict[str, Dict[str, int]] = defaultdict(lambda: {"topics": 0, "complexes": 0})
    topic_theory_map: Dict[Tuple[str, str], Optional[str]] = {}

    for module in modules or []:
        module_id = _normalize_optional_text(module.get("id"))
        if not module_id:
            continue
        topics = module.get("topics") if isinstance(module.get("topics"), list) else []
        for topic in topics:
            topic_id = _normalize_optional_text(topic.get("id"))
            if not topic_id:
                continue
            theory_link = storage.get_topic_theory_link(module_id, topic_id)
            theory_id = None
            if isinstance(theory_link, dict):
                theory_id = _normalize_optional_text(theory_link.get("theory_id"))
            if not theory_id and isinstance(topic.get("theory_link"), dict):
                theory_id = _normalize_optional_text(topic["theory_link"].get("theory_id"))
            topic_theory_map[(module_id, topic_id)] = theory_id
            if theory_id:
                usage[theory_id]["topics"] += 1

    for payload in complex_payloads or []:
        task_refs = payload.get("tasks") if isinstance(payload.get("tasks"), list) else []
        theory_ids_in_complex: Set[str] = set(_collect_direct_complex_theory_ids(payload))
        for module_id, topic_id in _collect_topic_refs(task_refs):
            theory_id = topic_theory_map.get((module_id, topic_id))
            if theory_id:
                theory_ids_in_complex.add(theory_id)
        for theory_id in theory_ids_in_complex:
            usage[theory_id]["complexes"] += 1

    return dict(usage), topic_theory_map


def _make_safe_id(name: str) -> str:
    """Create a filesystem-safe ID from a (possibly Cyrillic) name.

    Unlike ``secure_filename`` which strips all non-ASCII chars, this helper
    keeps Cyrillic letters by doing a lightweight transliteration first.
    Falls back to a short UUID prefix when transliteration yields nothing.
    """
    _CYRILLIC_MAP = {
        "а": "a",
        "б": "b",
        "в": "v",
        "г": "g",
        "д": "d",
        "е": "e",
        "ё": "yo",
        "ж": "zh",
        "з": "z",
        "и": "i",
        "й": "j",
        "к": "k",
        "л": "l",
        "м": "m",
        "н": "n",
        "о": "o",
        "п": "p",
        "р": "r",
        "с": "s",
        "т": "t",
        "у": "u",
        "ф": "f",
        "х": "kh",
        "ц": "ts",
        "ч": "ch",
        "ш": "sh",
        "щ": "sch",
        "ъ": "",
        "ы": "y",
        "ь": "",
        "э": "e",
        "ю": "yu",
        "я": "ya",
    }
    lowered = name.strip().lower()
    chars = []
    for ch in lowered:
        if ch in _CYRILLIC_MAP:
            chars.append(_CYRILLIC_MAP[ch])
        elif ch.isascii() and (ch.isalnum() or ch in "_-"):
            chars.append(ch)
        elif ch in (" ", ".", "/", "\\"):
            chars.append("_")
        # else: skip
    result = "_".join(part for part in "".join(chars).split("_") if part)
    if not result:
        result = "item_" + _uuid.uuid4().hex[:8]
    return result


def _json_safe(obj: Any) -> Any:
    if obj is None:
        return None

    if isinstance(obj, (datetime, date)):
        try:
            return obj.isoformat()
        except Exception:
            return str(obj)

    obj_module = type(obj).__module__
    if obj_module and obj_module.split(".", 1)[0] == "numpy" and hasattr(obj, "item"):
        try:
            return obj.item()
        except Exception:
            pass

    if isinstance(obj, dict):
        return {str(k): _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]

    return obj


def _normalize_complex_id(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    v = value.strip()
    return v or None


def _normalize_optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _should_skip_linked_library_enrichment(catalog_service: Any) -> bool:
    if not is_hosted_web_runtime():
        return False
    if bool(getattr(catalog_service, "hosted_shadow_read_fallback_blocked", False)):
        return True
    persistence_settings = getattr(catalog_service, "persistence_settings", None)
    postgres_dsn = str(getattr(persistence_settings, "postgres_dsn", "") or "").strip()
    return postgres_dsn == ""


def _maybe_hosted_shadow_write_error_response(
    exc: Exception,
    *,
    extra_payload: Optional[Dict[str, Any]] = None,
    status: int = 503,
) -> Optional[Any]:
    if isinstance(exc, HostedShadowReadFallbackDisabledError):
        payload: Dict[str, Any] = {
            "ok": False,
            "error": "hosted_shadow_read_blocked",
            "degraded": True,
            "details": {
                "operation": str(exc.operation or "").strip() or None,
                "reason": str(exc.reason or "").strip() or None,
                "runtime_mode": "hosted_web" if is_hosted_web_runtime() else "legacy_local",
                "source_of_truth": "postgres",
            },
        }
        if isinstance(extra_payload, dict):
            payload.update(extra_payload)
        return jsonify(payload), int(status)

    if not isinstance(exc, HostedShadowWriteFallbackDisabledError):
        return None

    payload: Dict[str, Any] = {
        "ok": False,
        "error": "hosted_shadow_write_blocked",
        "degraded": True,
        "details": {
            "operation": str(exc.operation or "").strip() or None,
            "reason": str(exc.reason or "").strip() or None,
            "runtime_mode": "hosted_web" if is_hosted_web_runtime() else "legacy_local",
            "env_opt_in": HOSTED_SHADOW_WRITE_FALLBACK_ENV,
        },
    }
    if isinstance(extra_payload, dict):
        payload.update(extra_payload)
    return jsonify(payload), int(status)


def _resolve_effective_user_id(value: Any = None, *, fallback: str = "default_user") -> str:
    """Resolve a non-empty user id for routes that must stay functional without active profile."""
    if is_hosted_web_runtime():
        hosted_user_id = get_authenticated_user_id()
        if hosted_user_id:
            return hosted_user_id
        guest_fallback = str(fallback or "guest").strip() or "guest"
        return "guest" if guest_fallback == "default_user" else guest_fallback

    if isinstance(value, str):
        candidate = value.strip()
        if candidate:
            return candidate

    ctx_user_id = getattr(get_ctx(), "user_id", None)
    if isinstance(ctx_user_id, str):
        candidate = ctx_user_id.strip()
        if candidate:
            return candidate

    return fallback


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


def _is_visible_workspace_theory_payload_for_current_user(item: Any) -> bool:
    if not isinstance(item, dict):
        return False
    ownership = item.get("ownership") if isinstance(item.get("ownership"), dict) else {}
    if ownership.get("is_owned_by_current_user") is True:
        return True
    return _is_imported_library_theory_payload(item)


def _build_theory_link_snapshot(theory_link: Any) -> Optional[dict]:
    """Return a UI-friendly theory link enriched with cached title/version when possible."""
    if not isinstance(theory_link, dict):
        return None

    source_kind = _normalize_optional_text(theory_link.get("source_kind")) or "workspace"
    snapshot = dict(theory_link)
    snapshot["source_kind"] = source_kind

    def _mark_linked_snapshot_unresolved() -> dict:
        snapshot["missing"] = True
        return snapshot

    def _build_workspace_fallback_from_source() -> Optional[dict]:
        source_theory_id = _normalize_optional_text(
            theory_link.get("source_theory_id") or theory_link.get("theory_id")
        )
        if source_theory_id is None:
            return None
        try:
            from services.theory_service import TheoryNotFoundError  # type: ignore

            theory_item = get_ctx().theory_service.get_theory(source_theory_id, include_delta=False)
            serialized_theory_item = _serialize_theory_payload(
                theory_item,
                current_user_id=_resolve_effective_user_id(),
            )
            if is_hosted_web_runtime() and not _is_visible_workspace_theory_payload_for_current_user(serialized_theory_item):
                return None
            return {
                "source_kind": "workspace",
                "theory_id": source_theory_id,
                "relation": snapshot.get("relation") or "link",
                "title_cache": _normalize_optional_text(
                    theory_item.get("title") or snapshot.get("title_cache")
                ) or source_theory_id,
                "updated_at": _json_safe(
                    theory_item.get("updated_at") or theory_item.get("version") or snapshot.get("updated_at")
                ),
                "catalog_item_id": _normalize_optional_text(snapshot.get("catalog_item_id")),
                "source_theory_id": source_theory_id,
            }
        except TheoryNotFoundError:
            return None
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning(
                "[HTTP] Failed to fallback linked theory snapshot %s to workspace theory %s: %s",
                _normalize_optional_text(theory_link.get("library_entry_id")) or "",
                source_theory_id,
                exc,
            )
            return None

    if source_kind == "linked_library":
        library_entry_id = _normalize_optional_text(theory_link.get("library_entry_id"))
        if library_entry_id is None:
            if is_hosted_web_runtime():
                return _mark_linked_snapshot_unresolved()
            return _build_workspace_fallback_from_source()
        snapshot["library_entry_id"] = library_entry_id
        catalog_service = getattr(get_ctx(), "catalog_service", None)
        if catalog_service is None or _should_skip_linked_library_enrichment(catalog_service):
            if is_hosted_web_runtime():
                return _mark_linked_snapshot_unresolved()
            workspace_fallback = _build_workspace_fallback_from_source()
            if workspace_fallback is not None:
                return workspace_fallback
            return snapshot
        try:
            detail = catalog_service.get_theory_library_entry(
                library_entry_id,
                requested_by_user_id=_resolve_effective_user_id(),
            )
            entry = detail.get("library_entry") if isinstance(detail.get("library_entry"), dict) else {}
            item = detail.get("item") if isinstance(detail.get("item"), dict) else {}
            linked_snapshot = detail.get("snapshot") if isinstance(detail.get("snapshot"), dict) else {}
            title = _normalize_optional_text(
                linked_snapshot.get("title")
                or item.get("title")
                or snapshot.get("title_cache")
            )
            if title is not None:
                snapshot["title_cache"] = title
            updated_at = _json_safe(
                linked_snapshot.get("updated_at")
                or linked_snapshot.get("version")
                or snapshot.get("updated_at")
                or entry.get("updated_at")
            )
            if updated_at is not None:
                snapshot["updated_at"] = updated_at
            access_state = _normalize_optional_text(entry.get("access_state"))
            if access_state is None and linked_snapshot:
                access_state = "active"
            if access_state is not None:
                snapshot["access_state"] = access_state
            access_reason = _normalize_optional_text(entry.get("access_reason"))
            if access_reason is not None:
                snapshot["access_reason"] = access_reason
            catalog_item_id = _normalize_optional_text(
                item.get("item_id") or snapshot.get("catalog_item_id")
            )
            if catalog_item_id is not None:
                snapshot["catalog_item_id"] = catalog_item_id
            source_theory_id = _normalize_optional_text(
                linked_snapshot.get("workspace_entity_id")
                or linked_snapshot.get("id")
                or item.get("source_workspace_id")
                or snapshot.get("source_theory_id")
            )
            if source_theory_id is not None:
                snapshot["source_theory_id"] = source_theory_id
            if str(snapshot.get("access_state") or "").strip().lower() in {
                "revoked",
                "deleted_source",
                "requires_access_code",
            }:
                if is_hosted_web_runtime():
                    return _mark_linked_snapshot_unresolved()
                workspace_fallback = _build_workspace_fallback_from_source()
                if workspace_fallback is not None:
                    return workspace_fallback
                snapshot["missing"] = True
        except ValueError:
            if is_hosted_web_runtime():
                return _mark_linked_snapshot_unresolved()
            workspace_fallback = _build_workspace_fallback_from_source()
            if workspace_fallback is not None:
                return workspace_fallback
            snapshot["missing"] = True
        except HostedShadowReadFallbackDisabledError:
            if is_hosted_web_runtime():
                return _mark_linked_snapshot_unresolved()
            workspace_fallback = _build_workspace_fallback_from_source()
            if workspace_fallback is not None:
                return workspace_fallback
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning(
                "[HTTP] Failed to enrich linked theory snapshot %s: %s",
                library_entry_id,
                exc,
            )
            if is_hosted_web_runtime():
                return _mark_linked_snapshot_unresolved()
            workspace_fallback = _build_workspace_fallback_from_source()
            if workspace_fallback is not None:
                return workspace_fallback
        return snapshot

    theory_id = _normalize_optional_text(theory_link.get("theory_id"))
    if theory_id is None:
        return None

    snapshot["theory_id"] = theory_id

    try:
        from services.theory_service import TheoryNotFoundError  # type: ignore

        theory_item = get_ctx().theory_service.get_theory(theory_id, include_delta=False)
        serialized_theory_item = _serialize_theory_payload(
            theory_item,
            current_user_id=_resolve_effective_user_id(),
        )
        if is_hosted_web_runtime() and not _is_visible_workspace_theory_payload_for_current_user(serialized_theory_item):
            snapshot["missing"] = True
            return snapshot
        title = _normalize_optional_text(theory_item.get("title"))
        if title is not None:
            snapshot["title_cache"] = title

        updated_at = _json_safe(theory_item.get("updated_at"))
        if updated_at is not None:
            snapshot["updated_at"] = updated_at
    except TheoryNotFoundError:
        snapshot["missing"] = True
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.warning("[HTTP] Failed to enrich theory snapshot %s: %s", theory_id, exc)

    return snapshot


def _compute_inherited_theory_for_topics(
    topic_refs: Set[Tuple[str, str]],
) -> Dict[str, Any]:
    """Resolve effective inherited theory for a set of topic refs."""
    storage = get_ctx().storage_service
    topic_rows: List[Dict[str, Any]] = []
    unique_theory_links: Dict[str, Dict[str, Any]] = {}

    for module_id, topic_id in sorted(topic_refs):
        module_payload = storage.get_module(module_id)
        topic_payload = storage.get_topic(module_id, topic_id)
        theory_link = _build_theory_link_snapshot(
            storage.get_topic_theory_link(module_id, topic_id)
        )
        theory_link_missing = bool(theory_link.get("missing")) if isinstance(theory_link, dict) else False
        theory_id = (
            _normalize_optional_text(theory_link.get("theory_id"))
            if isinstance(theory_link, dict) and not theory_link_missing
            else None
        )

        topic_row: Dict[str, Any] = {
            "module_id": module_id,
            "topic_id": topic_id,
            "theory_id": theory_id,
        }
        module_title = _normalize_optional_text(
            module_payload.get("name") if isinstance(module_payload, dict) else None
        )
        topic_title = _normalize_optional_text(
            topic_payload.get("name") if isinstance(topic_payload, dict) else None
        )
        if module_title is not None:
            topic_row["module_title"] = module_title
        if topic_title is not None:
            topic_row["topic_title"] = topic_title
        theory_title = _normalize_optional_text(
            theory_link.get("title_cache") if isinstance(theory_link, dict) and not theory_link_missing else None
        )
        if theory_title is not None:
            topic_row["theory_title"] = theory_title
        topic_rows.append(topic_row)

        if theory_id is not None and isinstance(theory_link, dict):
            unique_theory_links[theory_id] = theory_link

    theory_ids = sorted(unique_theory_links.keys())
    inherited_theory_links = [unique_theory_links[theory_id] for theory_id in theory_ids]

    if not inherited_theory_links:
        return {
            "status": "none",
            "inherited_theory_link": None,
            "inherited_theory_links": [],
            "theory_ids": [],
            "topic_rows": topic_rows,
        }

    if len(inherited_theory_links) == 1:
        return {
            "status": "ok",
            "inherited_theory_link": inherited_theory_links[0],
            "inherited_theory_links": inherited_theory_links,
            "theory_ids": theory_ids,
            "topic_rows": topic_rows,
        }

    return {
        "status": "composite",
        "inherited_theory_link": None,
        "inherited_theory_links": inherited_theory_links,
        "theory_ids": theory_ids,
        "topic_rows": topic_rows,
    }


def _build_complex_ownership_payload(
    obj: dict,
    *,
    current_user_id: Optional[str] = None,
) -> dict:
    effective_user_id = _normalize_optional_text(current_user_id)
    if effective_user_id is None:
        effective_user_id = _normalize_optional_text(getattr(get_ctx(), "user_id", None))

    created_by_user_id = _normalize_optional_text(obj.get("created_by_user_id"))
    updated_by_user_id = _normalize_optional_text(obj.get("updated_by_user_id"))
    if updated_by_user_id is None:
        updated_by_user_id = created_by_user_id

    created_via = _normalize_optional_text(obj.get("created_via")) or "legacy_unknown"
    content_scope = _normalize_optional_text(obj.get("content_scope")) or "shared_local"
    is_owned_by_current_user = bool(
        created_by_user_id and effective_user_id and created_by_user_id == effective_user_id
    )

    user_service = getattr(get_ctx(), "user_service", None)
    created_by_user_name = None
    if user_service and created_by_user_id:
        try:
            user = user_service.get_user(created_by_user_id)
            if user:
                created_by_user_name = user.name
        except Exception:
            pass

    return {
        "scope": "workspace",
        "content_scope": content_scope,
        "created_by_user_id": created_by_user_id,
        "created_by_user_name": created_by_user_name,
        "updated_by_user_id": updated_by_user_id,
        "created_via": created_via,
        "has_owner": bool(created_by_user_id),
        "is_owned_by_current_user": is_owned_by_current_user,
        "is_shared_library": content_scope == "shared_local",
    }


def _serialize_theory_payload(
    theory_obj: Any,
    *,
    current_user_id: Optional[str] = None,
) -> dict:
    obj = theory_obj.dict() if hasattr(theory_obj, "dict") else dict(theory_obj or {})
    created_at = obj.get("created_at")
    updated_at = obj.get("updated_at")
    if created_at is not None:
        obj["created_at"] = (
            created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at)
        )
    if updated_at is not None:
        obj["updated_at"] = (
            updated_at.isoformat() if hasattr(updated_at, "isoformat") else str(updated_at)
        )
    obj["ownership"] = _build_complex_ownership_payload(
        obj,
        current_user_id=current_user_id,
    )
    return obj


def _serialize_workspace_graph_entry(
    graph_obj: Any,
    *,
    current_user_id: Optional[str] = None,
) -> dict:
    obj = graph_obj.dict() if hasattr(graph_obj, "dict") else dict(graph_obj or {})
    created_at = obj.get("created_at")
    updated_at = obj.get("updated_at")
    if created_at is not None:
        obj["created_at"] = (
            created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at)
        )
    if updated_at is not None:
        obj["updated_at"] = (
            updated_at.isoformat() if hasattr(updated_at, "isoformat") else str(updated_at)
        )
    obj["ownership"] = _build_complex_ownership_payload(
        obj,
        current_user_id=current_user_id,
    )
    return obj


def _serialize_workspace_catalog_modules(
    modules: Any,
    *,
    current_user_id: Optional[str] = None,
) -> List[dict]:
    serialized_modules: List[dict] = []
    if not isinstance(modules, list):
        return serialized_modules

    for module in modules:
        module_payload = _serialize_workspace_graph_entry(
            module,
            current_user_id=current_user_id,
        )
        serialized_topics: List[dict] = []
        for topic in module_payload.get("topics") or []:
            topic_payload = _serialize_workspace_graph_entry(
                topic,
                current_user_id=current_user_id,
            )
            topic_payload["tasks"] = [
                _serialize_workspace_graph_entry(task, current_user_id=current_user_id)
                for task in (topic_payload.get("tasks") or [])
                if isinstance(task, dict)
            ]
            serialized_topics.append(topic_payload)
        module_payload["topics"] = serialized_topics
        serialized_modules.append(module_payload)
    return serialized_modules


def _serialize_workspace_task_payload(
    task_obj: Any,
    *,
    current_user_id: Optional[str] = None,
) -> dict:
    obj = task_obj.dict() if hasattr(task_obj, "dict") else dict(task_obj or {})

    metadata = obj.get("metadata")
    if isinstance(metadata, dict):
        metadata_payload = _serialize_workspace_graph_entry(
            metadata,
            current_user_id=current_user_id,
        )
        obj["metadata"] = metadata_payload
        obj["ownership"] = metadata_payload.get("ownership")

    task_data = obj.get("task_data")
    if isinstance(task_data, dict):
        task_data_payload = dict(task_data)
        meta = task_data_payload.get("meta")
        if isinstance(meta, dict):
            task_data_payload["meta"] = _serialize_workspace_graph_entry(
                meta,
                current_user_id=current_user_id,
            )
            if not isinstance(obj.get("ownership"), dict):
                obj["ownership"] = task_data_payload["meta"].get("ownership")
        obj["task_data"] = task_data_payload

    return obj


def _serialize_complex_payload(
    complex_obj: Any,
    *,
    current_user_id: Optional[str] = None,
) -> dict:
    obj = complex_obj.dict() if hasattr(complex_obj, "dict") else dict(complex_obj or {})
    created_at = obj.get("created_at")
    updated_at = obj.get("updated_at")
    if created_at is not None:
        obj["created_at"] = (
            created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at)
        )
    if updated_at is not None:
        obj["updated_at"] = (
            updated_at.isoformat() if hasattr(updated_at, "isoformat") else str(updated_at)
        )
    obj["ownership"] = _build_complex_ownership_payload(
        obj, current_user_id=current_user_id
    )
    return _enrich_complex_with_theory_link(obj)


def _enrich_complex_with_theory_link(obj: dict) -> dict:
    """Attach cached theory metadata to complex payload for UI convenience."""
    theory_link = obj.get("theory_link")
    if not isinstance(theory_link, dict):
        obj["has_theory"] = False
        return obj

    enriched_link = _build_theory_link_snapshot(theory_link)
    if not isinstance(enriched_link, dict):
        obj["has_theory"] = False
        return obj
    obj["theory_link"] = enriched_link
    source_kind = _normalize_optional_text(enriched_link.get("source_kind")) or "workspace"
    if source_kind == "linked_library":
        library_entry_id = _normalize_optional_text(enriched_link.get("library_entry_id"))
        access_state = str(enriched_link.get("access_state") or "").strip().lower()
        obj["has_theory"] = bool(library_entry_id) and access_state != "revoked"
        return obj
    obj["has_theory"] = bool(_normalize_optional_text(enriched_link.get("theory_id"))) and not bool(
        enriched_link.get("missing")
    )
    return obj


def _get_complex_by_id(complex_id: str) -> Optional[dict]:
    try:
        complexes = get_ctx().complex_service.get_all_complexes()
        for c in complexes:
            obj = _serialize_complex_payload(c)
            if obj.get("id") == complex_id:
                return obj
        return None
    except Exception as exc:
        logger.exception("[HTTP] Failed to resolve complex by id %s: %s", complex_id, exc)
        return None


def _is_within_data_dir(candidate: Path) -> bool:
    data_dir = get_ctx().data_dir.resolve()
    try:
        candidate.resolve().relative_to(data_dir)
        return True
    except (ValueError, FileNotFoundError):
        return False


def _resolve_editor_image_path(
    path_str: str,
    *,
    module_id: Optional[str] = None,
    topic_id: Optional[str] = None,
    task_id: Optional[str] = None,
) -> Optional[Path]:
    """
    Try to resolve editor image path similarly to legacy Tkinter logic:
    - accept absolute paths under data_dir
    - allow relative paths inside task directory (if provided)
    - allow relative paths inside data_dir (modules/, images/, etc.)
    - handle ../data/images and data/images prefixes
    - fallback to data/images/<filename>
    """
    if not path_str:
        return None

    ctx = get_ctx()
    data_dir = ctx.data_dir.resolve()
    modules_dir = ctx.storage_service.modules_dir.resolve()
    raw_path = Path(path_str.strip())

    candidate_paths: list[Path] = []

    # 1. Absolute path as-is
    if raw_path.is_absolute():
        candidate_paths.append(raw_path)

    # Prepare task directory if module/topic/task specified
    task_dir: Optional[Path] = None
    if module_id and topic_id and task_id:
        task_dir = modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
        # Relative to task json directory
        candidate_paths.append(task_dir / raw_path)
        # Allow referencing by filename inside task dir and task images subdir
        if raw_path.name:
            candidate_paths.append(task_dir / raw_path.name)
            candidate_paths.append(task_dir / "images" / raw_path.name)

    # 2. Relative to data_dir root
    candidate_paths.append(data_dir / raw_path)

    normalized_str = str(raw_path).replace("\\", "/")
    # 3. Handle explicit data/images prefixes
    if normalized_str.startswith("../data/images/") or normalized_str.startswith("data/images/"):
        rel_part = normalized_str.split("data/images/", 1)[-1]
        candidate_paths.append(data_dir / "images" / rel_part)

    # 4. data/images/<filename>
    if raw_path.name:
        candidate_paths.append(data_dir / "images" / raw_path.name)

    seen: set[str] = set()
    for candidate in candidate_paths:
        try:
            resolved = candidate.resolve()
        except FileNotFoundError:
            resolved = candidate

        key = resolved.as_posix().lower()
        if key in seen:
            continue
        seen.add(key)

        if not resolved.exists() or not resolved.is_file():
            continue

        if not _is_within_data_dir(resolved):
            logger.warning("[HTTP] serve_editor_image rejected path outside data_dir: %s", resolved)
            continue

        return resolved

    return None
