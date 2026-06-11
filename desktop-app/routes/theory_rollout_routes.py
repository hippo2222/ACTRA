"""Theory rollout status/telemetry endpoints (P13).

Relocated from routes/microcards_routes.py when the legacy V1 microcards
surface was removed (docs/microcards_v1_editor_migration_plan.md, M5) —
these endpoints are about the THEORY rollout and never belonged there.

- GET /api/editor/theory/rollout/status
- GET /api/editor/theory/rollout/telemetry
"""

from __future__ import annotations

from typing import Any, Dict

from flask import Blueprint, jsonify, request

from routes._context import get_ctx, get_extra

theory_rollout_bp = Blueprint("theory_rollout", __name__)


def _helpers() -> Dict[str, Any]:
    """Heavy helpers live in server.py (registered via set_extra)."""
    return get_extra("microcards_helpers")


@theory_rollout_bp.route("/api/editor/theory/rollout/status", methods=["GET"])
def theory_rollout_status() -> Any:
    if get_ctx().user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_ai"}), 403
    include_telemetry = str(request.args.get("include_telemetry") or "").strip().lower() in {"1", "true", "yes", "on"}
    try:
        telemetry_limit = max(1, min(int(request.args.get("telemetry_limit") or 5000), 20000))
    except Exception:
        telemetry_limit = 5000
    payload = _helpers()["build_theory_rollout_status_payload"](
        include_inventory=True,
        include_telemetry=include_telemetry,
        telemetry_limit=telemetry_limit,
    )
    return jsonify({"ok": True, "rollout": payload})


@theory_rollout_bp.route("/api/editor/theory/rollout/telemetry", methods=["GET"])
def theory_rollout_telemetry() -> Any:
    if get_ctx().user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_ai"}), 403
    try:
        limit = max(1, min(int(request.args.get("limit") or 5000), 20000))
    except Exception:
        limit = 5000
    telemetry = _helpers()["build_theory_rollout_telemetry_summary"](limit=limit)
    rollout = _helpers()["build_theory_rollout_status_payload"](include_inventory=False, include_telemetry=False)
    return jsonify({"ok": True, "rollout": rollout, "telemetry": telemetry})
