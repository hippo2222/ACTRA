"""Quick-access, UI settings, session start, and complexes list/get routes.

Endpoints:
- POST   /api/session/<complex_id>/start       - Start complex session
- GET    /api/ui/quick-access                   - Quick-access dashboard
- POST   /api/ui/quick-access/pin               - Pin complex
- POST   /api/ui/quick-access/unpin             - Unpin complex
- POST   /api/ui/quick-access/remove            - Remove from quick-access
- POST   /api/ui/quick-access/recent            - Mark complex as recent
- GET    /api/ui/settings                       - Get UI settings
- POST   /api/ui/settings                       - Update UI settings
- GET    /api/complexes                         - List all complexes
- GET    /api/complexes/<id>                    - Get single complex
"""

import json
import logging
import os
import tempfile
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, Optional

from flask import Blueprint, jsonify, request

from persistence.postgres import PostgresUnavailableError
from routes._context import get_ctx, get_extra, is_hosted_web_runtime
from routes._helpers import (
    _get_complex_by_id,
    _json_safe,
    _maybe_hosted_shadow_write_error_response,
    _normalize_complex_id,
    _resolve_effective_user_id,
    _serialize_complex_payload,
)
from services.hosted_shadow_fallback import HostedShadowReadFallbackDisabledError
from services.linked_complex_runtime import parse_linked_runtime_complex_id
from services.workspace_limits_service import PremiumArchivedContentError

logger = logging.getLogger(__name__)

quick_access_bp = Blueprint("quick_access", __name__)
_HOSTED_UI_STATE_SETTINGS_KEY = "web_ui_state"


# ---------------------------------------------------------------------------
# UI state helpers (per-user JSON file)
# ---------------------------------------------------------------------------


def _normalize_optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


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
        or _normalize_optional_text((item.get("source_lineage") or {}).get("catalog_item_id") if isinstance(item.get("source_lineage"), dict) else None)
        or _normalize_optional_text((item.get("sourceLineage") or {}).get("catalog_item_id") if isinstance(item.get("sourceLineage"), dict) else None)
    )


def _is_visible_library_complex_for_current_user(item: Any) -> bool:
    if not isinstance(item, dict):
        return False
    ownership = item.get("ownership") if isinstance(item.get("ownership"), dict) else {}
    if ownership.get("is_owned_by_current_user") is True:
        return True
    return _is_imported_library_complex_payload(item)


def _should_adopt_ownerless_complex_payload(item: Any, *, current_user_id: str) -> bool:
    normalized_user_id = _normalize_optional_text(current_user_id)
    if not normalized_user_id or normalized_user_id == "guest":
        return False
    if not isinstance(item, dict):
        return False
    created_by_user_id = _normalize_optional_text(item.get("created_by_user_id"))
    if created_by_user_id is not None:
        return False
    if bool(item.get("has_source_lineage")):
        return False
    if _normalize_optional_text(item.get("source_catalog_item_id")) is not None:
        return False
    workspace_copy_kind = str(item.get("workspace_copy_kind") or "").strip().lower()
    if workspace_copy_kind and workspace_copy_kind != "local_draft":
        return False
    content_scope = str(item.get("content_scope") or "").strip().lower()
    if content_scope and content_scope != "shared_local":
        return False
    return True


def _adopt_ownerless_complexes_for_current_user(complexes: Any, *, current_user_id: str) -> Any:
    normalized_user_id = _normalize_optional_text(current_user_id)
    if not normalized_user_id or normalized_user_id == "guest" or not isinstance(complexes, list):
        return complexes

    service = get_ctx().complex_service
    adopted_any = False
    for complex_obj in list(complexes):
        raw_payload = complex_obj.dict() if hasattr(complex_obj, "dict") else dict(complex_obj or {})
        if not _should_adopt_ownerless_complex_payload(raw_payload, current_user_id=normalized_user_id):
            continue
        complex_id = _normalize_complex_id(raw_payload.get("id"))
        if not complex_id:
            continue
        try:
            service.update_complex(
                complex_id,
                {
                    "created_by_user_id": normalized_user_id,
                    "updated_by_user_id": normalized_user_id,
                    "created_via": str(raw_payload.get("created_via") or "manual_editor").strip() or "manual_editor",
                    "content_scope": "shared_local",
                },
            )
            adopted_any = True
            logger.info("[HTTP] Adopted ownerless complex %s for hosted user %s", complex_id, normalized_user_id)
        except Exception as exc:
            logger.warning(
                "[HTTP] Failed to adopt ownerless complex %s for hosted user %s: %s",
                complex_id,
                normalized_user_id,
                exc,
            )
    if adopted_any:
        return service.get_all_complexes()
    return complexes


def _resolve_display_task_index(session_api: Any, session: Any) -> Optional[int]:
    if session is None:
        return None

    try:
        resolver = getattr(session_api, "_resolve_current_queue_slot", None)
        if callable(resolver):
            _, queue_index = resolver(session)
            if isinstance(queue_index, int) and queue_index >= 0:
                return queue_index
    except Exception:
        logger.debug("[HTTP] Failed to resolve quick-access display task index", exc_info=True)

    queue = getattr(session, "queue", None)
    if not isinstance(queue, list) or not queue:
        return None

    current_index = getattr(session, "current_task_index", 0)
    if not isinstance(current_index, int):
        current_index = 0

    if getattr(session, "complex_id", None) == "daily_mix":
        return max(0, min(current_index, len(queue) - 1))

    return max(0, min(current_index - 1, len(queue) - 1))


def _normalize_recoverable_session(session_api: Any, session: Any) -> Any:
    if session is None:
        return None

    normalizer = getattr(session_api, "mark_interrupted_session_as_paused", None)
    if callable(normalizer):
        try:
            return normalizer(session)
        except Exception:
            logger.debug(
                "[HTTP] Failed to normalize quick-access session restored from repository",
                exc_info=True,
            )
    return session


def _find_paused_session(session_api: Any, complex_id: str, user_id: str) -> Optional[Any]:
    sm = getattr(session_api, "_session_manager", None)
    repo = getattr(sm, "session_repository", None) if sm is not None else None

    existing = None
    try:
        if repo is not None:
            existing = repo.load_session(complex_id, user_id)
            existing = _normalize_recoverable_session(session_api, existing)
    except Exception:
        logger.warning(
            "[HTTP] Failed to load paused session snapshot for complex %s",
            complex_id,
            exc_info=True,
        )

    candidates = []
    if existing is not None:
        candidates.append(existing)

    in_memory_sessions = getattr(sm, "_active_sessions", {}) if sm is not None else {}
    if isinstance(in_memory_sessions, dict):
        for loaded in in_memory_sessions.values():
            if not loaded:
                continue
            if str(getattr(loaded, "user_id", "") or "").strip() != user_id:
                continue
            if str(getattr(loaded, "complex_id", "") or "").strip() != complex_id:
                continue
            candidates.append(loaded)

    for candidate in candidates:
        if (
            candidate
            and getattr(candidate, "is_active", False)
            and getattr(candidate, "paused", False)
        ):
            return candidate

    return None


def _premium_archive_response(exc: PremiumArchivedContentError) -> Any:
    return jsonify(exc.to_payload()), 409


def _assert_complex_start_not_archived(ctx: Any, user_id: str, complex_id: str) -> None:
    service = getattr(ctx, "workspace_limits_service", None)
    if service is None:
        return
    linked_entry_id = parse_linked_runtime_complex_id(complex_id)
    service.assert_entity_not_archived(
        user_id,
        "complex",
        linked_entry_id or complex_id,
        action="start",
        scope="linked_library" if linked_entry_id else "workspace",
    )


def _linked_complex_unavailable_response(detail: Dict[str, Any], complex_id: str) -> Any:
    library_entry = detail.get("library_entry") if isinstance(detail.get("library_entry"), dict) else {}
    access_state = str(library_entry.get("access_state") or "revoked").strip() or "revoked"
    access_reason = str(library_entry.get("access_reason") or "").strip()
    if access_state == "deleted_source":
        message = "Source complex was deleted by the author."
    elif access_state == "requires_access_code":
        message = "Access code is required to start this linked complex."
    else:
        message = access_reason or "Linked complex is no longer accessible."
    return jsonify(
        {
            "ok": False,
            "error": "complex_library_entry_not_accessible",
            "message": message,
            "complex_id": complex_id,
            "library_entry_id": library_entry.get("library_entry_id"),
            "access_state": access_state,
            "access_reason": access_reason,
            "resolution_actions": ["remove_from_library"],
        }
    ), 409


def _linked_complex_start_unavailable(ctx: Any, user_id: str, complex_id: str) -> Optional[Any]:
    linked_entry_id = parse_linked_runtime_complex_id(complex_id)
    if not linked_entry_id:
        return None
    catalog_service = getattr(ctx, "catalog_service", None)
    if catalog_service is None:
        return None
    try:
        detail = catalog_service.get_complex_library_entry(
            linked_entry_id,
            requested_by_user_id=user_id,
        )
    except ValueError as exc:
        error = str(exc)
        status = 404 if error.endswith("_not_found") else 403 if "forbidden" in error else 400
        return jsonify(
            {
                "ok": False,
                "error": error,
                "complex_id": complex_id,
                "library_entry_id": linked_entry_id,
            }
        ), status
    library_entry = detail.get("library_entry") if isinstance(detail, dict) else {}
    if str((library_entry or {}).get("access_state") or "").strip().lower() == "active":
        return None
    return _linked_complex_unavailable_response(detail, complex_id)


def _get_user_dir(user_id: str) -> Path:
    return get_ctx().data_dir / "users" / user_id


def _ui_state_path(user_id: str) -> Path:
    return _get_user_dir(user_id) / "ui_state.json"


def _default_ui_state(user_id: str) -> Dict[str, Any]:
    return {
        "version": 1,
        "user_id": user_id,
        "updated_at": datetime.now().isoformat(),
        "pinned": [],
        "recent": [],
        "dismissed": [],
        "settings": {},
    }


def _normalize_ui_state_payload(user_id: str, raw: Any) -> Dict[str, Any]:
    normalized = _default_ui_state(user_id)
    if isinstance(raw, dict):
        updated_at = _normalize_optional_text(raw.get("updated_at"))
        if updated_at:
            normalized["updated_at"] = updated_at
        normalized["pinned"] = [x for x in raw.get("pinned", []) if isinstance(x, str)]
        normalized["recent"] = [x for x in raw.get("recent", []) if isinstance(x, str)]
        normalized["dismissed"] = [x for x in raw.get("dismissed", []) if isinstance(x, str)]
        settings = raw.get("settings")
        if isinstance(settings, dict):
            normalized["settings"] = dict(settings)
    return normalized


def _load_hosted_user_for_ui_state(user_id: str) -> Any:
    user_service = getattr(get_ctx(), "user_service", None)
    if user_service is None:
        return None

    repository = getattr(user_service, "repository", None)
    ensure_persistence_ready = getattr(user_service, "ensure_persistence_ready", None)
    if repository is None or not callable(ensure_persistence_ready):
        getter = getattr(user_service, "get_user", None)
        return getter(user_id) if callable(getter) else None

    try:
        ensure_persistence_ready()
        return repository.get_user(user_id)
    except PostgresUnavailableError as exc:
        if hasattr(user_service, "_shadow_read_fallback_blocked"):
            user_service._shadow_read_fallback_blocked = True
        raise HostedShadowReadFallbackDisabledError("quick_access.ui_state", reason=str(exc)) from exc


def _read_ui_state(user_id: str) -> Dict[str, Any]:
    if is_hosted_web_runtime():
        user = _load_hosted_user_for_ui_state(user_id)
        if user is None:
            return _default_ui_state(user_id)
        settings = user.settings if isinstance(getattr(user, "settings", None), dict) else {}
        return _normalize_ui_state_payload(user_id, settings.get(_HOSTED_UI_STATE_SETTINGS_KEY))

    user_dir = _get_user_dir(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)

    path = _ui_state_path(user_id)
    if not path.exists():
        return _default_ui_state(user_id)

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("ui_state_must_be_object")
        if data.get("version") != 1:
            data["version"] = 1
        if data.get("user_id") != user_id:
            data["user_id"] = user_id
        if not isinstance(data.get("pinned"), list):
            data["pinned"] = []
        if not isinstance(data.get("recent"), list):
            data["recent"] = []
        if not isinstance(data.get("dismissed"), list):
            data["dismissed"] = []
        return _normalize_ui_state_payload(user_id, data)
    except Exception as exc:
        logger.exception("[HTTP] Failed to read ui_state for user %s: %s", user_id, exc)
        return _default_ui_state(user_id)


def _write_ui_state(user_id: str, data: Dict[str, Any]) -> None:
    if is_hosted_web_runtime():
        user_service = getattr(get_ctx(), "user_service", None)
        if user_service is None:
            raise RuntimeError("user_service_required")
        user = _load_hosted_user_for_ui_state(user_id)
        if user is None:
            raise RuntimeError("user_not_found")
        if not isinstance(getattr(user, "settings", None), dict):
            user.settings = {}
        user.settings[_HOSTED_UI_STATE_SETTINGS_KEY] = _normalize_ui_state_payload(user_id, data)
        if user_service.update_user(user) is not True:
            raise RuntimeError("hosted_ui_state_update_failed")
        return

    user_dir = _get_user_dir(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)

    path = _ui_state_path(user_id)
    data = _normalize_ui_state_payload(user_id, data)

    dir_path = str(path.parent)
    final_path = str(path)

    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            dir=dir_path,
            delete=False,
            encoding="utf-8",
            suffix=".tmp",
        ) as tf:
            json.dump(data, tf, ensure_ascii=False, indent=2)
            temp_name = tf.name

        try:
            os.replace(temp_name, final_path)
        except OSError:
            if os.path.exists(final_path):
                os.remove(final_path)
            os.rename(temp_name, final_path)
    finally:
        if temp_name and os.path.exists(temp_name):
            try:
                os.remove(temp_name)
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@quick_access_bp.route(
    "/api/session/<string:complex_id>/start", methods=["POST"], endpoint="start_complex_session"
)
def start_complex_session(complex_id: str) -> Any:
    ctx = get_ctx()
    session_api = ctx.session_api
    payload = request.get_json(silent=True) or {}
    user_id = _resolve_effective_user_id(payload.get("user_id"))
    start_iteration = payload.get("start_iteration", 1)
    force = payload.get("force", False)

    # MISSING-3 fix: проверяем наличие паузированной сессии для этого комплекса
    try:
        _assert_complex_start_not_archived(ctx, user_id, complex_id)
    except PremiumArchivedContentError as exc:
        return _premium_archive_response(exc)
    linked_unavailable_response = _linked_complex_start_unavailable(ctx, user_id, complex_id)
    if linked_unavailable_response is not None:
        return linked_unavailable_response

    existing = _find_paused_session(session_api, complex_id, user_id)
    if existing and not force:
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "paused_session_exists",
                    "session_id": existing.id,
                    "paused_at": _json_safe(getattr(existing, "paused_at", None)),
                }
            ),
            409,
        )

    if existing and force:
        sm = getattr(session_api, "_session_manager", None)
        cancelled = False
        if sm is not None and hasattr(sm, "cancel_session"):
            try:
                cancelled = bool(sm.cancel_session(existing.id, user_id=user_id))
            except Exception:
                logger.warning(
                    "[HTTP] Failed to cancel paused session %s before restart of complex %s",
                    getattr(existing, "id", None),
                    complex_id,
                    exc_info=True,
                )
        if not cancelled:
            return jsonify({"ok": False, "error": "failed_to_clear_paused_session"}), 409

    try:
        data = session_api.start_session(
            complex_id=complex_id, user_id=user_id, start_iteration=start_iteration
        )
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        raise
    status = 200 if data.get("ok") else 400
    return jsonify(data), status


@quick_access_bp.route("/api/ui/quick-access", methods=["GET"])
def get_quick_access() -> Any:
    ctx = get_ctx()
    session_api = ctx.session_api
    user_id = _resolve_effective_user_id(request.args.get("user_id"))
    try:
        state = _read_ui_state(user_id)
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to load quick-access state for user %s: %s", user_id, exc)
        return jsonify({"ok": False, "error": "quick_access_state_load_failed"}), 500

    pinned = [x for x in state.get("pinned", []) if isinstance(x, str)]
    recent = [x for x in state.get("recent", []) if isinstance(x, str)]
    dismissed = {x for x in state.get("dismissed", []) if isinstance(x, str)}

    paused_sessions_by_complex: Dict[str, Dict[str, Any]] = {}
    try:
        sm = getattr(session_api, "_session_manager", None)
        repo = sm.session_repository if sm is not None else None
        if repo is not None:
            sessions_meta = repo.list_active_sessions(user_id)
            for meta in sessions_meta:
                session_id = meta.get("session_id")
                if not session_id:
                    continue

                loaded = repo.load_session_by_session_id(user_id=user_id, session_id=session_id)
                loaded = _normalize_recoverable_session(session_api, loaded)
                if not loaded:
                    continue
                if not getattr(loaded, "is_active", True):
                    continue
                if not getattr(loaded, "paused", False):
                    continue

                cid = getattr(loaded, "complex_id", None)
                if not cid:
                    continue

                paused_at = getattr(loaded, "paused_at", None)
                start_time = getattr(loaded, "start_time", None)
                end_time = getattr(loaded, "end_time", None)
                ts_candidates = [
                    dt.timestamp()
                    for dt in (paused_at, end_time, start_time)
                    if hasattr(dt, "timestamp")
                ]
                sort_ts = max(ts_candidates) if ts_candidates else 0.0

                payload = {
                    "session_id": loaded.id,
                    "complex_id": cid,
                    "paused": True,
                    "paused_at": _json_safe(paused_at),
                    "last_resume_source": getattr(loaded, "last_resume_source", None),
                    "last_resumed_at": _json_safe(getattr(loaded, "last_resumed_at", None)),
                    "start_time": _json_safe(start_time),
                    "iteration": getattr(loaded, "iteration", None),
                    "current_task_index": getattr(loaded, "current_task_index", None),
                    "display_task_index": _resolve_display_task_index(session_api, loaded),
                    "total_tasks": len(getattr(loaded, "queue", []) or []),
                    "_sort_ts": sort_ts,
                }
                try:
                    if hasattr(session_api, "get_resume_target"):
                        payload["resume_target"] = _json_safe(session_api.get_resume_target(loaded))
                except Exception:
                    logger.debug("[HTTP] Failed to attach resume_target to paused quick-access session", exc_info=True)

                prev = paused_sessions_by_complex.get(cid)
                if prev is None or payload["_sort_ts"] >= prev.get("_sort_ts", 0):
                    paused_sessions_by_complex[cid] = payload
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.warning("[HTTP] Failed to load paused sessions for quick-access: %s", exc, exc_info=True)

    seen = set()
    ordered_ids = []
    paused_ids = sorted(
        paused_sessions_by_complex.keys(),
        key=lambda cid: paused_sessions_by_complex.get(cid, {}).get("_sort_ts", 0),
        reverse=True,
    )
    visible_paused_ids = [cid for cid in paused_ids if cid not in dismissed]
    for cid in visible_paused_ids + pinned + recent:
        if cid in seen:
            continue
        seen.add(cid)
        ordered_ids.append(cid)

    # Fetch stats and health (safe fallback if services missing)
    complex_stats_map = {}
    try:
        stats_dict = ctx.statistics_service.get_complex_statistics(user_id)
        if isinstance(stats_dict, dict):
            complex_stats_map = stats_dict
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.warning("[HTTP] Failed to load quick-access statistics: %s", exc, exc_info=True)

    calendar_service = get_extra("calendar_service")
    health_map = {}
    try:
        if calendar_service:
            if hasattr(calendar_service, "_get_all_progress"):
                all_p = calendar_service._get_all_progress(user_id)
            else:
                all_p = calendar_service.get_all_progress()
            for item in all_p:
                health_map[item.complex_id] = {
                    "health_percent": item.health_percent,
                    "status": (
                        item.status.value if hasattr(item.status, "value") else str(item.status)
                    ),
                    "is_critical": item.is_critical,
                    "days_since_last": (
                        (date.today() - item.last_practice_date).days
                        if item.last_practice_date
                        else None
                    ),
                }
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.warning("[HTTP] Failed to load quick-access health map: %s", exc, exc_info=True)

    items = []
    for cid in ordered_ids:
        cobj = _get_complex_by_id(cid)
        if not cobj:
            continue

        # Merge stats
        c_stats = complex_stats_map.get(cid, {})
        c_aggregated = c_stats.get("aggregated", {}) if isinstance(c_stats, dict) else {}
        c_health = health_map.get(cid, {})

        paused_info = paused_sessions_by_complex.get(cid)
        if paused_info:
            paused_info = {k: v for k, v in paused_info.items() if k != "_sort_ts"}

        items.append(
            {
                "complex": cobj,
                "is_pinned": cid in pinned,
                "is_recent": cid in recent,
                "stats": {
                    "progress": c_aggregated.get("success_rate", 0),
                    "solved": c_aggregated.get("wins", 0),
                    "total": c_aggregated.get("attempts", 0),
                },
                "health": c_health,
                "paused_session": paused_info,
            }
        )

    return jsonify(
        {
            "ok": True,
            "items": items,
            "pinned": pinned,
            "recent": recent,
            "paused_complex_ids": visible_paused_ids,
        }
    )


@quick_access_bp.route("/api/ui/quick-access/pin", methods=["POST"])
def pin_quick_access() -> Any:
    payload = request.get_json(silent=True) or {}
    user_id = _resolve_effective_user_id(payload.get("user_id"))
    complex_id = _normalize_complex_id(payload.get("complex_id"))
    if not complex_id:
        return jsonify({"ok": False, "error": "complex_id_required"}), 400

    try:
        state = _read_ui_state(user_id)
        pinned = [x for x in state.get("pinned", []) if isinstance(x, str)]
        if complex_id not in pinned:
            pinned.insert(0, complex_id)
        state["pinned"] = pinned[:12]
        state["dismissed"] = [
            x for x in state.get("dismissed", []) if isinstance(x, str) and x != complex_id
        ]
        _write_ui_state(user_id, state)
        return jsonify({"ok": True})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to pin quick-access item %s for user %s: %s", complex_id, user_id, exc)
        return jsonify({"ok": False, "error": "quick_access_pin_failed"}), 500


@quick_access_bp.route("/api/ui/quick-access/unpin", methods=["POST"])
def unpin_quick_access() -> Any:
    payload = request.get_json(silent=True) or {}
    user_id = _resolve_effective_user_id(payload.get("user_id"))
    complex_id = _normalize_complex_id(payload.get("complex_id"))
    if not complex_id:
        return jsonify({"ok": False, "error": "complex_id_required"}), 400

    try:
        state = _read_ui_state(user_id)
        pinned = [x for x in state.get("pinned", []) if isinstance(x, str) and x != complex_id]
        state["pinned"] = pinned
        _write_ui_state(user_id, state)
        return jsonify({"ok": True})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to unpin quick-access item %s for user %s: %s", complex_id, user_id, exc)
        return jsonify({"ok": False, "error": "quick_access_unpin_failed"}), 500


@quick_access_bp.route("/api/ui/quick-access/remove", methods=["POST"])
def remove_from_quick_access() -> Any:
    """Remove a complex from both pinned and recent lists."""
    payload = request.get_json(silent=True) or {}
    user_id = _resolve_effective_user_id(payload.get("user_id"))
    complex_id = _normalize_complex_id(payload.get("complex_id"))
    if not complex_id:
        return jsonify({"ok": False, "error": "complex_id_required"}), 400

    try:
        state = _read_ui_state(user_id)
        state["pinned"] = [x for x in state.get("pinned", []) if isinstance(x, str) and x != complex_id]
        state["recent"] = [x for x in state.get("recent", []) if isinstance(x, str) and x != complex_id]
        dismissed = [x for x in state.get("dismissed", []) if isinstance(x, str) and x != complex_id]
        dismissed.insert(0, complex_id)
        state["dismissed"] = dismissed[:50]
        _write_ui_state(user_id, state)
        return jsonify({"ok": True})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to remove quick-access item %s for user %s: %s", complex_id, user_id, exc)
        return jsonify({"ok": False, "error": "quick_access_remove_failed"}), 500


@quick_access_bp.route("/api/ui/quick-access/recent", methods=["POST"])
def mark_recent_complex() -> Any:
    payload = request.get_json(silent=True) or {}
    user_id = _resolve_effective_user_id(payload.get("user_id"))
    complex_id = _normalize_complex_id(payload.get("complex_id"))
    if not complex_id:
        return jsonify({"ok": False, "error": "complex_id_required"}), 400

    try:
        state = _read_ui_state(user_id)
        recent = [x for x in state.get("recent", []) if isinstance(x, str) and x != complex_id]
        recent.insert(0, complex_id)
        state["recent"] = recent[:12]
        state["dismissed"] = [
            x for x in state.get("dismissed", []) if isinstance(x, str) and x != complex_id
        ]
        _write_ui_state(user_id, state)
        return jsonify({"ok": True})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to mark quick-access recent item %s for user %s: %s", complex_id, user_id, exc)
        return jsonify({"ok": False, "error": "quick_access_recent_failed"}), 500


@quick_access_bp.route("/api/ui/settings", methods=["GET"])
def get_ui_settings() -> Any:
    user_id = _resolve_effective_user_id(request.args.get("user_id"))
    try:
        state = _read_ui_state(user_id)
        return jsonify({"ok": True, "settings": state.get("settings", {})})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to load UI settings for user %s: %s", user_id, exc)
        return jsonify({"ok": False, "error": "ui_settings_load_failed"}), 500


@quick_access_bp.route("/api/ui/settings", methods=["POST"])
def update_ui_settings() -> Any:
    payload = request.get_json(silent=True) or {}
    user_id = _resolve_effective_user_id(payload.get("user_id"))

    try:
        state = _read_ui_state(user_id)
        current_settings = state.get("settings", {})
        if not isinstance(current_settings, dict):
            current_settings = {}

        updates = payload.get("settings", {})
        if isinstance(updates, dict):
            current_settings.update(updates)

        state["settings"] = current_settings
        _write_ui_state(user_id, state)
        return jsonify({"ok": True, "settings": current_settings})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to update UI settings for user %s: %s", user_id, exc)
        return jsonify({"ok": False, "error": "ui_settings_update_failed"}), 500


@quick_access_bp.route("/api/complexes", methods=["GET"])
def list_complexes() -> Any:
    """Return the list of complexes available for the current user."""
    try:
        ctx = get_ctx()
        complexes = ctx.complex_service.get_all_complexes()
        if is_hosted_web_runtime():
            complexes = _adopt_ownerless_complexes_for_current_user(
                complexes,
                current_user_id=ctx.user_id,
            )
        items = [
            _serialize_complex_payload(c, current_user_id=ctx.user_id)
            for c in complexes
        ]
        if is_hosted_web_runtime():
            items = [
                item
                for item in items
                if _is_visible_library_complex_for_current_user(item)
            ]
        return jsonify({"ok": True, "items": items})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to list complexes: %s", exc)
        return jsonify({"ok": False, "error": "complexes_load_failed"}), 500


@quick_access_bp.route("/api/complexes/<string:complex_id>", methods=["GET"])
def get_complex(complex_id: str) -> Any:
    try:
        if is_hosted_web_runtime():
            _adopt_ownerless_complexes_for_current_user(
                get_ctx().complex_service.get_all_complexes(),
                current_user_id=get_ctx().user_id,
            )
        obj = _get_complex_by_id(complex_id)
        if not obj:
            return jsonify({"ok": False, "error": "complex_not_found"}), 404
        if is_hosted_web_runtime() and not _is_visible_library_complex_for_current_user(obj):
            return jsonify({"ok": False, "error": "complex_not_found"}), 404
        return jsonify({"ok": True, "item": obj})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to get complex %s: %s", complex_id, exc)
        return jsonify({"ok": False, "error": "complex_load_failed"}), 500
