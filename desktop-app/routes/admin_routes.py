"""Admin-only hosted routes for account management."""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from flask import Blueprint, jsonify, request

from routes._context import (
    current_user_is_hosted_admin,
    get_authenticated_hosted_user,
    get_authenticated_user_id,
    get_ctx,
    is_hosted_web_runtime,
)

logger = logging.getLogger(__name__)

admin_bp = Blueprint("admin", __name__)


def _admin_disabled_response() -> Any:
    return jsonify({"ok": False, "error": "admin_api_disabled"}), 404


def _authentication_required_response() -> Any:
    return jsonify({"ok": False, "error": "authentication_required"}), 401


def _admin_required_response() -> Any:
    return jsonify({"ok": False, "error": "admin_required"}), 403


def _require_admin_user() -> tuple[Optional[Any], Optional[str], Optional[Any]]:
    if not is_hosted_web_runtime():
        return None, None, _admin_disabled_response()

    actor_user_id = str(get_authenticated_user_id() or "").strip()
    if not actor_user_id:
        return None, None, _authentication_required_response()

    actor = get_authenticated_hosted_user()
    if actor is None:
        return None, None, _authentication_required_response()
    if not current_user_is_hosted_admin():
        return None, None, _admin_required_response()
    return actor, actor_user_id, None


def _serialize_admin_user(user: Any) -> Dict[str, Any]:
    return {
        "user_id": str(getattr(user, "user_id", "") or "").strip(),
        "name": str(getattr(user, "name", "") or "").strip(),
        "login": str(getattr(user, "login", "") or "").strip() or None,
        "email": str(getattr(user, "email", "") or "").strip() or None,
        "role": str(getattr(user, "role", "") or "").strip().lower() or "user",
        "plan": str(getattr(user, "plan", "") or "").strip().lower() or "free",
        "created_at": str(getattr(user, "created_at", "") or "").strip(),
    }


@admin_bp.route("/api/admin/users", methods=["GET"])
def admin_list_users() -> Any:
    _actor, _actor_user_id, rejection = _require_admin_user()
    if rejection is not None:
        return rejection

    query = str(request.args.get("query") or "").strip()
    user_service = get_ctx().user_service
    search_users = getattr(user_service, "search_users", None)
    users = search_users(query) if callable(search_users) else user_service.get_all_users()
    return jsonify(
        {
            "ok": True,
            "query": query,
            "users": [_serialize_admin_user(user) for user in users],
        }
    )


@admin_bp.route("/api/admin/users/<user_id>/plan", methods=["PATCH"])
def admin_update_user_plan(user_id: str) -> Any:
    _actor, actor_user_id, rejection = _require_admin_user()
    if rejection is not None:
        return rejection

    payload = request.get_json(silent=True) or {}
    if "role" in payload:
        return jsonify({"ok": False, "error": "role_update_forbidden"}), 400

    plan = str(payload.get("plan") or "").strip().lower()
    if plan not in {"free", "premium"}:
        return jsonify({"ok": False, "error": "invalid_plan"}), 400

    user_service = get_ctx().user_service
    setter = getattr(user_service, "set_user_plan", None)
    if not callable(setter):
        logger.error("[HTTP][ADMIN] User service does not support plan updates")
        return jsonify({"ok": False, "error": "plan_update_unavailable"}), 500

    try:
        updated_user = setter(user_id, plan, actor_user_id=actor_user_id)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc) or "invalid_plan"}), 400

    if updated_user is None:
        return jsonify({"ok": False, "error": "user_not_found"}), 404

    return jsonify({"ok": True, "user": _serialize_admin_user(updated_user)})
