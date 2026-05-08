"""Internal billing MVP routes for premium requests and admin activation."""

from __future__ import annotations

import logging
from typing import Any, Optional

from flask import Blueprint, jsonify, request

from routes._context import (
    current_user_is_hosted_admin,
    get_authenticated_user_id,
    get_ctx,
    is_hosted_web_runtime,
)

logger = logging.getLogger(__name__)

billing_bp = Blueprint("billing", __name__)


def _current_user_id() -> str:
    if is_hosted_web_runtime():
        return str(get_authenticated_user_id() or "").strip()
    return str(getattr(get_ctx(), "user_id", "") or "").strip()


def _auth_required() -> Any:
    return jsonify({"ok": False, "error": "authentication_required"}), 401


def _admin_required() -> Any:
    return jsonify({"ok": False, "error": "admin_required"}), 403


def _require_admin() -> tuple[Optional[str], Optional[Any]]:
    if is_hosted_web_runtime():
        actor_user_id = str(get_authenticated_user_id() or "").strip()
        if not actor_user_id:
            return None, _auth_required()
        if not current_user_is_hosted_admin():
            return None, _admin_required()
        return actor_user_id, None

    user_id = str(getattr(get_ctx(), "user_id", "") or "").strip()
    user = get_ctx().user_service.get_user(user_id) if user_id else None
    if str(getattr(user, "role", "") or "").strip().lower() != "admin":
        return None, _admin_required()
    return user_id, None


def _billing_service() -> Any:
    return get_ctx().billing_service


def _error_response(exc: Exception) -> Any:
    code = str(exc or "billing_failed").strip() or "billing_failed"
    status = {
        "authentication_required": 401,
        "admin_required": 403,
        "user_not_found": 404,
        "order_not_found": 404,
        "invalid_period_days": 400,
        "order_not_pending": 409,
    }.get(code, 400)
    return jsonify({"ok": False, "error": code}), status


@billing_bp.route("/api/billing/status", methods=["GET"])
def billing_status() -> Any:
    user_id = _current_user_id()
    if not user_id or user_id == "guest":
        return _auth_required()
    try:
        payload = _billing_service().get_status(user_id)
        status = 200 if payload.get("ok") else 404
        return jsonify(payload), status
    except Exception as exc:
        logger.exception("[HTTP] Billing status failed: %s", exc)
        return jsonify({"ok": False, "error": "billing_status_failed"}), 500


@billing_bp.route("/api/billing/orders", methods=["POST"])
def create_billing_order() -> Any:
    user_id = _current_user_id()
    if not user_id or user_id == "guest":
        return _auth_required()
    payload = request.get_json(silent=True) or {}
    try:
        order = _billing_service().create_order(user_id, payload.get("period_days"))
        return jsonify({"ok": True, "order": order}), 201
    except ValueError as exc:
        return _error_response(exc)
    except Exception as exc:
        logger.exception("[HTTP] Billing order creation failed: %s", exc)
        return jsonify({"ok": False, "error": "billing_order_failed"}), 500


@billing_bp.route("/api/admin/billing/orders", methods=["GET"])
def admin_list_billing_orders() -> Any:
    _actor_user_id, rejection = _require_admin()
    if rejection is not None:
        return rejection
    status = str(request.args.get("status") or "pending").strip().lower()
    try:
        orders = _billing_service().list_orders(status=status or None, limit=200)
        return jsonify({"ok": True, "orders": orders})
    except Exception as exc:
        logger.exception("[HTTP] Admin billing order list failed: %s", exc)
        return jsonify({"ok": False, "error": "admin_billing_orders_failed"}), 500


@billing_bp.route("/api/admin/billing/orders/<order_id>/activate", methods=["POST"])
def admin_activate_billing_order(order_id: str) -> Any:
    actor_user_id, rejection = _require_admin()
    if rejection is not None:
        return rejection
    try:
        payload = _billing_service().activate_order(order_id, admin_user_id=actor_user_id)
        return jsonify({"ok": True, **payload})
    except ValueError as exc:
        return _error_response(exc)
    except Exception as exc:
        logger.exception("[HTTP] Admin billing activation failed: %s", exc)
        return jsonify({"ok": False, "error": "admin_billing_activate_failed"}), 500


@billing_bp.route("/api/admin/billing/orders/<order_id>/cancel", methods=["POST"])
def admin_cancel_billing_order(order_id: str) -> Any:
    actor_user_id, rejection = _require_admin()
    if rejection is not None:
        return rejection
    try:
        payload = _billing_service().cancel_order(order_id, admin_user_id=actor_user_id)
        return jsonify({"ok": True, **payload})
    except ValueError as exc:
        return _error_response(exc)
    except Exception as exc:
        logger.exception("[HTTP] Admin billing cancellation failed: %s", exc)
        return jsonify({"ok": False, "error": "admin_billing_cancel_failed"}), 500


@billing_bp.route("/api/admin/users/<user_id>/premium/grant", methods=["POST"])
def admin_grant_user_premium(user_id: str) -> Any:
    actor_user_id, rejection = _require_admin()
    if rejection is not None:
        return rejection
    payload = request.get_json(silent=True) or {}
    try:
        result = _billing_service().grant_premium(
            user_id,
            payload.get("period_days"),
            admin_user_id=actor_user_id,
        )
        return jsonify({"ok": True, **result})
    except ValueError as exc:
        return _error_response(exc)
    except Exception as exc:
        logger.exception("[HTTP] Admin premium grant failed: %s", exc)
        return jsonify({"ok": False, "error": "admin_premium_grant_failed"}), 500
