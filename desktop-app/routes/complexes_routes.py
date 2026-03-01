"""Complexes CRUD API routes.

Endpoints:
- POST   /api/complexes                                          - Create complex
- PUT    /api/complexes/<id>                                     - Update complex
- DELETE /api/complexes/<id>                                     - Delete complex
- GET    /api/complexes/<id>/autosave                            - Get autosave
- POST   /api/complexes/<id>/autosave                            - Save autosave
- DELETE /api/complexes/<id>/autosave                            - Delete autosave
- GET    /api/complexes/<id>/history                              - Version history
- POST   /api/complexes/<id>/restore/<snapshot_timestamp>        - Restore snapshot
"""

import json
import logging
import os
import uuid
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify, request

from api.complexes_api import validate_and_normalize_create_payload
from services.complex_service import ConflictError  # type: ignore
from services.theory_service import TheoryNotFoundError  # type: ignore

from routes._context import get_ctx

logger = logging.getLogger(__name__)

complexes_bp = Blueprint("complexes", __name__)


@complexes_bp.route("/api/complexes", methods=["POST"])
def create_complex() -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    payload = request.get_json(silent=True) or {}

    try:
        complex_id = payload.get("id")
        normalized: Optional[Dict[str, Any]] = None
        errors: List[Dict[str, Any]] = []

        if complex_id is None:
            complex_id = str(uuid.uuid4())
        elif not isinstance(complex_id, str) or not complex_id.strip():
            errors.append({"field": "id", "reason": "id_must_be_string"})

        normalized_candidate, validation_errors = validate_and_normalize_create_payload(payload)
        if normalized_candidate is not None:
            normalized = normalized_candidate
        errors.extend(validation_errors)

        if normalized is None:
            return (
                jsonify({"ok": False, "error": "validation_error", "details": {"errors": errors}}),
                400,
            )

        missing_tasks = []
        for tr in normalized["tasks"]:
            parts = tr.split("/")
            module_id, topic_id, task_id = parts[0], parts[1], parts[-1]
            try:
                task_full = ctx.storage_service.load_task(
                    module_id, topic_id, task_id
                )
            except Exception:
                task_full = None
            if not task_full:
                missing_tasks.append(tr)

        if missing_tasks:
            for tr in missing_tasks:
                errors.append({"field": "tasks", "reason": "task_not_found", "value": tr})

        theory_link = normalized.get("theory_link")
        if isinstance(theory_link, dict):
            theory_id = theory_link.get("theory_id")
            if isinstance(theory_id, str) and theory_id.strip():
                try:
                    ctx.theory_service.get_theory(
                        theory_id.strip(), include_delta=False
                    )
                except TheoryNotFoundError:
                    errors.append(
                        {
                            "field": "theory_link",
                            "reason": "theory_not_found",
                            "value": theory_id,
                        }
                    )
                except Exception as exc:
                    logger.warning("[HTTP] Theory lookup failed for %s: %s", theory_id, exc)
                    errors.append(
                        {
                            "field": "theory_link",
                            "reason": "theory_lookup_failed",
                            "value": theory_id,
                        }
                    )

        if errors:
            return (
                jsonify({"ok": False, "error": "validation_error", "details": {"errors": errors}}),
                400,
            )

        complex_data = {
            "id": complex_id,
            "name": normalized["name"],
            "description": normalized["description"],
            "tasks": normalized["tasks"],
            "chains": normalized["chains"],
            "settings": normalized["settings"],
            "theory_link": normalized.get("theory_link"),
        }

        created = ctx.complex_service.create_complex(complex_data)
        obj = created.dict()
        obj["created_at"] = (
            obj.get("created_at").isoformat() if obj.get("created_at") is not None else None
        )
        obj["updated_at"] = (
            obj.get("updated_at").isoformat() if obj.get("updated_at") is not None else None
        )
        return jsonify({"ok": True, "item": obj}), 200
    except Exception as exc:
        logger.exception("[HTTP] Failed to create complex: %s", exc)
        return jsonify({"ok": False, "error": "complex_create_failed"}), 500


@complexes_bp.route("/api/complexes/<string:complex_id>", methods=["PUT"])
def update_complex(complex_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    payload = request.get_json(silent=True) or {}
    try:
        # Extract expected_version from payload before validation
        expected_version = payload.pop("expected_version", None)

        normalized, errors = validate_and_normalize_create_payload(payload)
        if normalized is None:
            return (
                jsonify({"ok": False, "error": "validation_error", "details": {"errors": errors}}),
                400,
            )

        # Optional: check if complex exists
        existing = ctx.complex_service.get_complex(complex_id)
        if not existing:
            return jsonify({"ok": False, "error": "complex_not_found"}), 404

        theory_link = normalized.get("theory_link")
        if isinstance(theory_link, dict):
            theory_id = theory_link.get("theory_id")
            if isinstance(theory_id, str) and theory_id.strip():
                try:
                    ctx.theory_service.get_theory(
                        theory_id.strip(), include_delta=False
                    )
                except TheoryNotFoundError:
                    return (
                        jsonify(
                            {
                                "ok": False,
                                "error": "validation_error",
                                "details": {
                                    "errors": [
                                        {
                                            "field": "theory_link",
                                            "reason": "theory_not_found",
                                            "value": theory_id,
                                        }
                                    ]
                                },
                            }
                        ),
                        400,
                    )

        # Update with version check
        updated = ctx.complex_service.update_complex(
            complex_id, normalized, expected_version=expected_version
        )

        obj = updated.dict()
        obj["created_at"] = (
            obj.get("created_at").isoformat() if obj.get("created_at") is not None else None
        )
        obj["updated_at"] = (
            obj.get("updated_at").isoformat() if obj.get("updated_at") is not None else None
        )
        return jsonify({"ok": True, "item": obj})

    except ConflictError as exc:
        # Handle version conflict
        logger.warning(f"Version conflict for complex {complex_id}: {exc}")
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

    except Exception as exc:
        logger.exception("[HTTP] Failed to update complex %s: %s", complex_id, exc)
        return jsonify({"ok": False, "error": "complex_update_failed"}), 500


@complexes_bp.route("/api/complexes/<string:complex_id>", methods=["DELETE"])
def delete_complex_endpoint(complex_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        deleted = ctx.complex_service.delete_complex(complex_id)
        if not deleted:
            return jsonify({"ok": False, "error": "complex_not_found"}), 404

        # BUG-3 fix: удаляем файл паузированной сессии для этого комплекса
        try:
            user_id = ctx.user_id
            session_api = ctx.session_api
            sm = getattr(session_api, "_session_manager", None)
            if sm and sm.session_repository:
                sm.session_repository.delete_session(complex_id, user_id)
                logger.info("[HTTP] Cleaned up session file for deleted complex %s", complex_id)
        except Exception:
            logger.warning(
                "[HTTP] Failed to clean up session file for complex %s", complex_id, exc_info=True
            )

        return jsonify({"ok": True})
    except Exception as exc:
        logger.exception("[HTTP] Failed to delete complex %s: %s", complex_id, exc)
        return jsonify({"ok": False, "error": "complex_delete_failed"}), 500


@complexes_bp.route("/api/complexes/<string:complex_id>/autosave", methods=["GET"])
def get_complex_autosave(complex_id: str) -> Any:
    try:
        autosave_path = (
            get_ctx().complex_service.complexes_dir / f"{complex_id}.autosave.json"
        )
        if not autosave_path.exists():
            return jsonify({"ok": False, "error": "autosave_not_found"}), 404

        with open(autosave_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return jsonify({"ok": True, "item": data})
    except Exception as exc:
        logger.exception("[HTTP] Failed to get autosave for %s: %s", complex_id, exc)
        return jsonify({"ok": False, "error": "autosave_load_failed"}), 500


@complexes_bp.route("/api/complexes/<string:complex_id>/autosave", methods=["POST"])
def save_complex_autosave(complex_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    payload = request.get_json(silent=True) or {}
    try:
        # Check if complex exists
        if not ctx.complex_service.get_complex(complex_id):
            return jsonify({"ok": False, "error": "complex_not_found"}), 404

        # We don't strictly validate autosave payload to allow saving partial/invalid drafts
        autosave_path = (
            ctx.complex_service.complexes_dir / f"{complex_id}.autosave.json"
        )

        # Add id to payload if not present
        if "id" not in payload:
            payload["id"] = complex_id

        with open(autosave_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        return jsonify({"ok": True})
    except Exception as exc:
        logger.exception("[HTTP] Failed to save autosave for %s: %s", complex_id, exc)
        return jsonify({"ok": False, "error": "autosave_save_failed"}), 500


@complexes_bp.route("/api/complexes/<string:complex_id>/autosave", methods=["DELETE"])
def delete_complex_autosave(complex_id: str) -> Any:
    if get_ctx().user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        autosave_path = (
            get_ctx().complex_service.complexes_dir / f"{complex_id}.autosave.json"
        )
        if autosave_path.exists():
            os.remove(autosave_path)
        return jsonify({"ok": True})
    except Exception as exc:
        logger.exception("[HTTP] Failed to delete autosave for %s: %s", complex_id, exc)
        return jsonify({"ok": False, "error": "autosave_delete_failed"}), 500


@complexes_bp.route("/api/complexes/<string:complex_id>/history", methods=["GET"])
def get_complex_history(complex_id: str) -> Any:
    """Получить историю изменений комплекса."""
    try:
        history = get_ctx().complex_service.get_complex_history(complex_id)
        return jsonify({"ok": True, "history": history})
    except Exception as exc:
        logger.exception(f"Failed to get history for complex {complex_id}: {exc}")
        return jsonify({"ok": False, "error": "history_fetch_failed"}), 500


@complexes_bp.route(
    "/api/complexes/<string:complex_id>/restore/<string:snapshot_timestamp>", methods=["POST"]
)
def restore_complex_from_history(complex_id: str, snapshot_timestamp: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    """Восстановить комплекс из исторического snapshot."""
    try:
        restored = ctx.complex_service.restore_from_history(
            complex_id, snapshot_timestamp
        )

        obj = restored.dict()
        if obj.get("created_at"):
            obj["created_at"] = obj.get("created_at").isoformat()
        if obj.get("updated_at"):
            obj["updated_at"] = obj.get("updated_at").isoformat()

        return jsonify({"ok": True, "item": obj})
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception(f"Failed to restore complex {complex_id}: {exc}")
        return jsonify({"ok": False, "error": "restore_failed"}), 500
