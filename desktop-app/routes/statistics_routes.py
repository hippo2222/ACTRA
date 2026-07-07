"""Statistics API routes.

Endpoints:
- GET /api/statistics/overall       - Overall stats for current user
- GET /api/statistics/time-dynamics  - Time dynamics for activity calendar
- GET /api/statistics/complexes      - Per-complex statistics
- GET /api/statistics/sessions       - Recent sessions list
- GET /api/task-catalog              - Full task catalog
"""

import logging
from typing import Any

from flask import Blueprint, jsonify, request

from routes._context import get_ctx, is_hosted_web_runtime
from routes._helpers import (
    _maybe_hosted_shadow_write_error_response,
    _resolve_effective_user_id,
    _serialize_workspace_catalog_modules,
)
from routes.editor_routes import _filter_hosted_workspace_catalog_modules
from services.linked_complex_runtime import build_linked_runtime_complex_id

logger = logging.getLogger(__name__)

statistics_bp = Blueprint("statistics", __name__)


def _get_library_complex_ids(ctx: Any) -> list[str]:
    """Return complex ids from the user's current library."""
    complex_service = getattr(ctx, "complex_service", None)
    if complex_service is None:
        return []

    try:
        complexes = complex_service.get_all_complexes() or []
    except Exception as exc:
        logger.warning("[HTTP] Failed to load complex library for statistics filtering: %s", exc)
        return []

    result: list[str] = []
    for complex_obj in complexes:
        if isinstance(complex_obj, dict):
            complex_id = complex_obj.get("id") or complex_obj.get("complex_id")
        else:
            complex_id = getattr(complex_obj, "id", None) or getattr(complex_obj, "complex_id", None)
        normalized = str(complex_id or "").strip()
        if normalized:
            result.append(normalized)

    catalog_service = getattr(ctx, "catalog_service", None)
    user_id = str(getattr(ctx, "user_id", "") or "").strip()
    if catalog_service is not None and user_id:
        try:
            library_payload = catalog_service.list_complex_library_entries(requested_by_user_id=user_id)
            for entry in library_payload.get("entries") or []:
                library_entry = entry.get("library_entry") if isinstance(entry, dict) else {}
                library_entry_id = str((library_entry or {}).get("library_entry_id") or "").strip()
                if not library_entry_id:
                    continue
                runtime_complex_id = build_linked_runtime_complex_id(library_entry_id)
                if runtime_complex_id:
                    result.append(runtime_complex_id)
        except Exception as exc:
            logger.warning("[HTTP] Failed to load linked complex library ids for statistics filtering: %s", exc)
    return result


@statistics_bp.route("/api/statistics/overall", methods=["GET"])
def get_overall_stats() -> Any:
    """Get overall statistics for the current user."""
    ctx = get_ctx()
    user_id = _resolve_effective_user_id(request.args.get("user_id"))
    days_arg = request.args.get("days")
    days = int(days_arg) if days_arg and days_arg.isdigit() else None
    if days == 0:
        days = None

    try:
        stats = ctx.statistics_service.aggregate_statistics(user_id, days=days)
        return jsonify({"ok": True, "stats": stats})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to get overall stats: %s", exc)
        return jsonify({"ok": False, "error": "stats_load_failed"}), 500


@statistics_bp.route("/api/statistics/time-dynamics", methods=["GET"])
def get_time_dynamics() -> Any:
    """Get time dynamics for the activity calendar."""
    ctx = get_ctx()
    user_id = _resolve_effective_user_id(request.args.get("user_id"))
    days = int(request.args.get("days", 30))
    smoothing_window = int(request.args.get("smooth", 3))
    smoothing_window = max(1, min(10, smoothing_window))
    try:
        dynamics = ctx.statistics_service.get_time_dynamics(
            user_id, days=days, smoothing_window=smoothing_window
        )
        return jsonify({"ok": True, "dynamics": dynamics})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to get time dynamics: %s", exc)
        return jsonify({"ok": False, "error": "dynamics_load_failed"}), 500


@statistics_bp.route("/api/statistics/complexes", methods=["GET"])
def get_complex_statistics() -> Any:
    """Get complex statistics for the current user."""
    ctx = get_ctx()
    user_id = _resolve_effective_user_id(request.args.get("user_id"))
    try:
        stats = ctx.statistics_service.get_complex_statistics(user_id)
        stats = ctx.statistics_service.filter_complex_statistics(
            stats,
            valid_complex_ids=_get_library_complex_ids(ctx),
        )
        return jsonify({"ok": True, "complexes": stats})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to get complex statistics: %s", exc)
        return jsonify({"ok": False, "error": "complex_stats_load_failed"}), 500


@statistics_bp.route("/api/statistics/sessions", methods=["GET"])
def get_recent_sessions() -> Any:
    """Get recent sessions for the current user."""
    ctx = get_ctx()
    user_id = _resolve_effective_user_id(request.args.get("user_id"))
    limit = int(request.args.get("limit", 10))
    try:
        valid_complex_ids = set(_get_library_complex_ids(ctx))
        sessions = ctx.statistics_service.get_recent_sessions(user_id, limit=limit * 3)
        if valid_complex_ids:
            sessions = [
                session for session in sessions
                if str(session.get("complex_id") or "").strip() in valid_complex_ids
            ]
        else:
            sessions = []
        sessions = sessions[:limit]
        return jsonify({"ok": True, "sessions": sessions})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to get recent sessions: %s", exc)
        return jsonify({"ok": False, "error": "sessions_load_failed"}), 500


@statistics_bp.route("/api/task-catalog", methods=["GET"])
def task_catalog() -> Any:
    try:
        ctx = get_ctx()
        modules = ctx.storage_service.load_modules()
        modules = _serialize_workspace_catalog_modules(
            modules,
            current_user_id=ctx.user_id,
        )
        if is_hosted_web_runtime():
            modules = _filter_hosted_workspace_catalog_modules(
                modules,
                current_user_id=ctx.user_id,
            )
        items = []
        for m in modules or []:
            if not isinstance(m, dict):
                continue
            module_id = m.get("id")
            module_name = m.get("name")
            topics = m.get("topics") or []
            for t in topics:
                if not isinstance(t, dict):
                    continue
                topic_id = t.get("id")
                topic_name = t.get("name")
                tasks = t.get("tasks") or []
                for task in tasks:
                    if not isinstance(task, dict):
                        continue
                    task_id = task.get("id") or task.get("task_id")
                    if not module_id or not topic_id or not task_id:
                        continue
                    ref = f"{module_id}/{topic_id}/{task_id}"
                    items.append(
                        {
                            "ref": ref,
                            "module_id": module_id,
                            "module_name": module_name or module_id,
                            "topic_id": topic_id,
                            "topic_name": topic_name or topic_id,
                            "task_id": task_id,
                            "task_name": task.get("name") or task_id,
                            "task_type": task.get("type") or "unknown",
                            "subtype": task.get("subtype"),
                        }
                    )

        items.sort(
            key=lambda x: (
                str(x.get("module_name") or ""),
                str(x.get("topic_name") or ""),
                str(x.get("task_name") or ""),
            )
        )
        return jsonify({"ok": True, "items": items})
    except Exception as exc:
        logger.exception("[HTTP] Failed to build task catalog: %s", exc)
        return jsonify({"ok": False, "error": "task_catalog_failed"}), 500
