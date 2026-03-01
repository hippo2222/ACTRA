"""Theories API routes.

Endpoints:
- GET    /api/theories                                          - List theories
- POST   /api/theories                                          - Create theory
- GET    /api/theories/<id>                                     - Get theory
- POST   /api/theories/<id>/copy                                - Clone theory
- PUT    /api/theories/<id>                                     - Update theory
- POST   /api/theories/<id>/upload-image                        - Upload image
- GET    /api/theories/<id>/history                              - Version history
- POST   /api/theories/<id>/restore/<snapshot_timestamp>        - Restore snapshot
"""

import logging
from typing import Any, Dict

from flask import Blueprint, jsonify, request

from services.theory_service import (  # type: ignore
    TheoryConflictError,
    TheoryNotFoundError,
    TheoryValidationError,
)

from routes._context import get_ctx

logger = logging.getLogger(__name__)

theories_bp = Blueprint("theories", __name__)


@theories_bp.route("/api/theories", methods=["GET"])
def list_theories() -> Any:
    query = request.args.get("query")
    try:
        items = get_ctx().theory_service.list_theories(query=query)
        return jsonify({"ok": True, "items": items})
    except Exception as exc:
        logger.exception("[HTTP] Failed to list theories: %s", exc)
        return jsonify({"ok": False, "error": "theories_load_failed"}), 500


@theories_bp.route("/api/theories", methods=["POST"])
def create_theory() -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403

    payload = request.get_json(silent=True) or {}
    try:
        item = ctx.theory_service.create_theory(payload)
        return jsonify({"ok": True, "item": item}), 200
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] Failed to create theory: %s", exc)
        return jsonify({"ok": False, "error": "theory_create_failed"}), 500


@theories_bp.route("/api/theories/<string:theory_id>", methods=["GET"])
def get_theory(theory_id: str) -> Any:
    try:
        item = get_ctx().theory_service.get_theory(theory_id, include_delta=True)
        return jsonify({"ok": True, "item": item})
    except TheoryNotFoundError:
        return jsonify({"ok": False, "error": "theory_not_found"}), 404
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] Failed to get theory %s: %s", theory_id, exc)
        return jsonify({"ok": False, "error": "theory_load_failed"}), 500


@theories_bp.route("/api/theories/<string:theory_id>/copy", methods=["POST"])
def copy_theory(theory_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403

    payload = request.get_json(silent=True) or {}
    title = payload.get("title")
    try:
        item = ctx.theory_service.clone_theory(theory_id, title=title)
        return jsonify({"ok": True, "item": item})
    except TheoryNotFoundError:
        return jsonify({"ok": False, "error": "theory_not_found"}), 404
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] Failed to copy theory %s: %s", theory_id, exc)
        return jsonify({"ok": False, "error": "theory_copy_failed"}), 500


@theories_bp.route("/api/theories/<string:theory_id>", methods=["PUT"])
def update_theory(theory_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403

    payload = request.get_json(silent=True) or {}
    expected_version = payload.get("expected_version")
    updates: Dict[str, Any] = {}
    for field in ("title", "delta", "images"):
        if field in payload:
            updates[field] = payload.get(field)

    try:
        if not updates:
            item = ctx.theory_service.get_theory(theory_id, include_delta=True)
        else:
            item = ctx.theory_service.update_theory(
                theory_id,
                updates,
                expected_version=expected_version,
            )
        return jsonify({"ok": True, "item": item})
    except TheoryConflictError as exc:
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "version_conflict",
                    "details": {
                        "message": str(exc),
                        "current_version": exc.current_version,
                        "expected_version": exc.expected_version,
                    },
                }
            ),
            409,
        )
    except TheoryNotFoundError:
        return jsonify({"ok": False, "error": "theory_not_found"}), 404
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] Failed to update theory %s: %s", theory_id, exc)
        return jsonify({"ok": False, "error": "theory_update_failed"}), 500


@theories_bp.route("/api/theories/<string:theory_id>/upload-image", methods=["POST"])
def upload_theory_image(theory_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403

    if "file" not in request.files:
        return jsonify({"ok": False, "error": "file_required"}), 400

    try:
        result = ctx.theory_service.add_image(theory_id, request.files["file"])
        return jsonify({"ok": True, **result}), 200
    except TheoryNotFoundError:
        return jsonify({"ok": False, "error": "theory_not_found"}), 404
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] Failed to upload theory image %s: %s", theory_id, exc)
        return jsonify({"ok": False, "error": "theory_image_upload_failed"}), 500


@theories_bp.route("/api/theories/<string:theory_id>/history", methods=["GET"])
def get_theory_history(theory_id: str) -> Any:
    try:
        history = get_ctx().theory_service.get_history(theory_id)
        return jsonify({"ok": True, "history": history})
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] Failed to load theory history %s: %s", theory_id, exc)
        return jsonify({"ok": False, "error": "theory_history_failed"}), 500


@theories_bp.route("/api/theories/<string:theory_id>/restore/<string:snapshot_timestamp>", methods=["POST"])
def restore_theory(theory_id: str, snapshot_timestamp: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403

    try:
        item = ctx.theory_service.restore_from_history(theory_id, snapshot_timestamp)
        return jsonify({"ok": True, "item": item})
    except TheoryNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        logger.exception(
            "[HTTP] Failed to restore theory %s from %s: %s",
            theory_id,
            snapshot_timestamp,
            exc,
        )
        return jsonify({"ok": False, "error": "theory_restore_failed"}), 500
