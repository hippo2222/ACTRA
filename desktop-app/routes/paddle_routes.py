"""Paddle Billing API v2 routes for webhooks and frontend initialization."""

from __future__ import annotations

import logging
from typing import Any, Optional

from flask import Blueprint, jsonify, request

from routes._context import (
    get_authenticated_user_id,
    get_ctx,
    is_hosted_web_runtime,
)

logger = logging.getLogger(__name__)

paddle_bp = Blueprint("paddle", __name__)


def _current_user_id() -> str:
    if is_hosted_web_runtime():
        return str(get_authenticated_user_id() or "").strip()
    return str(getattr(get_ctx(), "user_id", "") or "").strip()


def _paddle_service() -> Any:
    ctx = get_ctx()
    service = getattr(ctx, "paddle_service", None)
    if service is None:
        from services.paddle_service import PaddleService
        service = PaddleService(
            billing_service=getattr(ctx, "billing_service", None),
            user_service=getattr(ctx, "user_service", None),
            data_dir=str(getattr(ctx, "data_dir", ".")),
        )
        setattr(ctx, "paddle_service", service)
    return service


@paddle_bp.route("/api/webhooks/paddle", methods=["POST"])
def paddle_webhook() -> Any:
    """Public webhook receiver for Paddle API v2 events."""
    raw_body = request.get_data()
    signature_header = request.headers.get("Paddle-Signature", "")

    paddle_svc = _paddle_service()

    if not paddle_svc.verify_signature(raw_body, signature_header):
        logger.warning("[HTTP] Invalid Paddle webhook signature.")
        return jsonify({"ok": False, "error": "invalid_signature"}), 400

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "invalid_json"}), 400

    try:
        result = paddle_svc.handle_webhook_event(payload)
        return jsonify(result), 200
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] Paddle webhook handler failed: %s", exc)
        return jsonify({"ok": False, "error": "webhook_processing_failed"}), 500


@paddle_bp.route("/api/billing/paddle/config", methods=["GET"])
def get_paddle_config() -> Any:
    """Return public Paddle configuration for frontend SDK (Paddle.js)."""
    user_id = _current_user_id()
    if not user_id or user_id == "guest":
        return jsonify({"ok": False, "error": "authentication_required"}), 401
    try:
        config = _paddle_service().get_public_config()
        return jsonify(config), 200
    except Exception as exc:
        logger.exception("[HTTP] Failed to get Paddle config: %s", exc)
        return jsonify({"ok": False, "error": "paddle_config_failed"}), 500
