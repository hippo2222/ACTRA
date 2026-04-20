"""Hosted asset routes for server-backed media references."""

import logging
from typing import Any

from flask import Blueprint, jsonify, send_file

from routes._context import get_ctx, is_hosted_web_runtime

logger = logging.getLogger(__name__)

assets_bp = Blueprint("assets", __name__)


@assets_bp.route("/api/assets/<string:asset_id>/content", methods=["GET"])
def serve_asset_content(asset_id: str) -> Any:
    ctx = get_ctx()
    asset_service = getattr(ctx, "asset_service", None)
    if asset_service is None:
        return jsonify({"ok": False, "error": "asset_service_not_available"}), 503

    asset = asset_service.get_asset(asset_id)
    if asset is None:
        return jsonify({"ok": False, "error": "asset_not_found"}), 404

    if is_hosted_web_runtime():
        user_id = getattr(ctx, "user_id", None)
        if str(user_id or "").strip() == "guest":
            return jsonify({"ok": False, "error": "authentication_required"}), 401
        if not asset_service.can_access_asset(asset, user_id=user_id):
            return jsonify({"ok": False, "error": "asset_forbidden"}), 403

    target = asset_service.resolve_asset_file(asset_id)
    if target is None:
        logger.warning("[HTTP] Asset metadata exists but file is missing: %s", asset_id)
        return jsonify({"ok": False, "error": "asset_file_missing"}), 404

    resp = send_file(
        str(target),
        mimetype=str(asset.get("mime_type") or None) or None,
        download_name=str(asset.get("original_filename") or target.name),
        conditional=True,
    )
    resp.headers["Cache-Control"] = "private, max-age=3600"
    return resp
