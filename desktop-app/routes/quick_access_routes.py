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

from routes._context import get_ctx, get_extra
from routes._helpers import (
    _get_complex_by_id,
    _json_safe,
    _normalize_complex_id,
    _resolve_effective_user_id,
    _serialize_complex_payload,
)

logger = logging.getLogger(__name__)

quick_access_bp = Blueprint("quick_access", __name__)


# ---------------------------------------------------------------------------
# UI state helpers (per-user JSON file)
# ---------------------------------------------------------------------------


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


def _get_user_dir(user_id: str) -> Path:
    return get_ctx().data_dir / "users" / user_id


def _ui_state_path(user_id: str) -> Path:
    return _get_user_dir(user_id) / "ui_state.json"


def _read_ui_state(user_id: str) -> Dict[str, Any]:
    user_dir = _get_user_dir(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)

    path = _ui_state_path(user_id)
    if not path.exists():
        return {
            "version": 1,
            "user_id": user_id,
            "updated_at": datetime.now().isoformat(),
            "pinned": [],
            "recent": [],
        }

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
        return data
    except Exception as exc:
        logger.exception("[HTTP] Failed to read ui_state for user %s: %s", user_id, exc)
        return {
            "version": 1,
            "user_id": user_id,
            "updated_at": datetime.now().isoformat(),
            "pinned": [],
            "recent": [],
        }


def _write_ui_state(user_id: str, data: Dict[str, Any]) -> None:
    user_dir = _get_user_dir(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)

    path = _ui_state_path(user_id)
    data["version"] = 1
    data["user_id"] = user_id
    data["updated_at"] = datetime.now().isoformat()

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

    data = session_api.start_session(
        complex_id=complex_id, user_id=user_id, start_iteration=start_iteration
    )
    status = 200 if data.get("ok") else 400
    return jsonify(data), status


@quick_access_bp.route("/api/ui/quick-access", methods=["GET"])
def get_quick_access() -> Any:
    ctx = get_ctx()
    session_api = ctx.session_api
    user_id = _resolve_effective_user_id(request.args.get("user_id"))
    state = _read_ui_state(user_id)

    pinned = [x for x in state.get("pinned", []) if isinstance(x, str)]
    recent = [x for x in state.get("recent", []) if isinstance(x, str)]

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
    except Exception:
        pass

    seen = set()
    ordered_ids = []
    paused_ids = sorted(
        paused_sessions_by_complex.keys(),
        key=lambda cid: paused_sessions_by_complex.get(cid, {}).get("_sort_ts", 0),
        reverse=True,
    )
    for cid in paused_ids + pinned + recent:
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
    except Exception:
        pass

    calendar_service = get_extra("calendar_service")
    health_map = {}
    try:
        if calendar_service:
            all_p = calendar_service._get_all_progress(user_id)
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
    except Exception:
        pass

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
            "paused_complex_ids": paused_ids,
        }
    )


@quick_access_bp.route("/api/ui/quick-access/pin", methods=["POST"])
def pin_quick_access() -> Any:
    payload = request.get_json(silent=True) or {}
    user_id = _resolve_effective_user_id(payload.get("user_id"))
    complex_id = _normalize_complex_id(payload.get("complex_id"))
    if not complex_id:
        return jsonify({"ok": False, "error": "complex_id_required"}), 400

    state = _read_ui_state(user_id)
    pinned = [x for x in state.get("pinned", []) if isinstance(x, str)]
    if complex_id not in pinned:
        pinned.insert(0, complex_id)
    state["pinned"] = pinned[:12]
    _write_ui_state(user_id, state)
    return jsonify({"ok": True})


@quick_access_bp.route("/api/ui/quick-access/unpin", methods=["POST"])
def unpin_quick_access() -> Any:
    payload = request.get_json(silent=True) or {}
    user_id = _resolve_effective_user_id(payload.get("user_id"))
    complex_id = _normalize_complex_id(payload.get("complex_id"))
    if not complex_id:
        return jsonify({"ok": False, "error": "complex_id_required"}), 400

    state = _read_ui_state(user_id)
    pinned = [x for x in state.get("pinned", []) if isinstance(x, str) and x != complex_id]
    state["pinned"] = pinned
    _write_ui_state(user_id, state)
    return jsonify({"ok": True})


@quick_access_bp.route("/api/ui/quick-access/remove", methods=["POST"])
def remove_from_quick_access() -> Any:
    """Remove a complex from both pinned and recent lists."""
    payload = request.get_json(silent=True) or {}
    user_id = _resolve_effective_user_id(payload.get("user_id"))
    complex_id = _normalize_complex_id(payload.get("complex_id"))
    if not complex_id:
        return jsonify({"ok": False, "error": "complex_id_required"}), 400

    state = _read_ui_state(user_id)
    state["pinned"] = [x for x in state.get("pinned", []) if isinstance(x, str) and x != complex_id]
    state["recent"] = [x for x in state.get("recent", []) if isinstance(x, str) and x != complex_id]
    _write_ui_state(user_id, state)
    return jsonify({"ok": True})


@quick_access_bp.route("/api/ui/quick-access/recent", methods=["POST"])
def mark_recent_complex() -> Any:
    payload = request.get_json(silent=True) or {}
    user_id = _resolve_effective_user_id(payload.get("user_id"))
    complex_id = _normalize_complex_id(payload.get("complex_id"))
    if not complex_id:
        return jsonify({"ok": False, "error": "complex_id_required"}), 400

    state = _read_ui_state(user_id)
    recent = [x for x in state.get("recent", []) if isinstance(x, str) and x != complex_id]
    recent.insert(0, complex_id)
    state["recent"] = recent[:12]
    _write_ui_state(user_id, state)
    return jsonify({"ok": True})


@quick_access_bp.route("/api/ui/settings", methods=["GET"])
def get_ui_settings() -> Any:
    user_id = _resolve_effective_user_id(request.args.get("user_id"))
    state = _read_ui_state(user_id)
    return jsonify({"ok": True, "settings": state.get("settings", {})})


@quick_access_bp.route("/api/ui/settings", methods=["POST"])
def update_ui_settings() -> Any:
    payload = request.get_json(silent=True) or {}
    user_id = _resolve_effective_user_id(payload.get("user_id"))

    state = _read_ui_state(user_id)
    current_settings = state.get("settings", {})
    if not isinstance(current_settings, dict):
        current_settings = {}

    # Merge updates
    updates = payload.get("settings", {})
    if isinstance(updates, dict):
        current_settings.update(updates)

    state["settings"] = current_settings
    _write_ui_state(user_id, state)
    return jsonify({"ok": True, "settings": current_settings})


@quick_access_bp.route("/api/complexes", methods=["GET"])
def list_complexes() -> Any:
    """Return the list of complexes available for the current user."""
    try:
        complexes = get_ctx().complex_service.get_all_complexes()
        items = [
            _serialize_complex_payload(c, current_user_id=get_ctx().user_id)
            for c in complexes
        ]
        return jsonify({"ok": True, "items": items})
    except Exception as exc:
        logger.exception("[HTTP] Failed to list complexes: %s", exc)
        return jsonify({"ok": False, "error": "complexes_load_failed"}), 500


@quick_access_bp.route("/api/complexes/<string:complex_id>", methods=["GET"])
def get_complex(complex_id: str) -> Any:
    obj = _get_complex_by_id(complex_id)
    if not obj:
        return jsonify({"ok": False, "error": "complex_not_found"}), 404
    return jsonify({"ok": True, "item": obj})
