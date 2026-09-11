"""Task Import Studio API routes.

Endpoints:
- POST   /api/editor/studio/upload-document   - Extract text from document (PDF/DOCX/TXT) without AI dependencies
- GET    /api/editor/studio/prompts           - Canonical prompt templates for external AI
- GET    /api/editor/studio/sessions          - List recent studio sessions (max 3, FIFO)
- POST   /api/editor/studio/sessions          - Save studio session
- DELETE /api/editor/studio/sessions/<id>     - Delete studio session
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, Optional

from flask import Blueprint, jsonify, request

from persistence.hosted_studio_session_repository import HostedStudioSessionRepository
from routes._context import get_ctx, get_extra, get_file_processor, set_extra
from services.ai_generation_service import (
    _GENERATION_PROMPTS,
    build_studio_analysis_prompt,
    get_all_studio_prompts,
    get_studio_generation_prompt,
)

logger = logging.getLogger(__name__)

studio_bp = Blueprint("studio", __name__)


def _get_studio_session_repo() -> HostedStudioSessionRepository:
    repo = get_extra("studio_session_repository")
    if repo is not None:
        return repo

    ctx = get_ctx()
    dsn = ""
    fallback_dir: Optional[Path] = None
    if ctx is not None:
        settings = getattr(ctx, "persistence_runtime", None)
        if settings is not None:
            dsn = getattr(settings, "postgres_dsn", "")
            try:
                fallback_dir = settings.users_runtime_root()
            except Exception:
                fallback_dir = None
        if fallback_dir is None:
            data_dir = getattr(ctx, "data_dir", None)
            if data_dir:
                fallback_dir = Path(str(data_dir)) / "studio_sessions"

    repo = HostedStudioSessionRepository(dsn=dsn, fallback_dir=fallback_dir)
    try:
        repo.ensure_schema()
    except Exception as exc:
        logger.warning("[StudioRoutes] Failed to ensure schema for StudioSessionRepository: %s", exc)

    set_extra("studio_session_repository", repo)
    return repo


# ---------------------------------------------------------------------------
# 1. Document Upload (Extraction without AI)
# ---------------------------------------------------------------------------


@studio_bp.route("/api/editor/studio/upload-document", methods=["POST"])
def studio_upload_document() -> Any:
    """Extract text from uploaded document (PDF, DOCX, TXT) without AI configuration or quota checks."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_studio"}), 403

    if "file" not in request.files:
        return jsonify({"ok": False, "error": "file_required"}), 400

    file = request.files["file"]
    if not file or not file.filename:
        return jsonify({"ok": False, "error": "file_required"}), 400

    try:
        file_bytes = file.read()
    except Exception as exc:
        logger.warning("[Studio] Failed to read uploaded file: %s", exc)
        return jsonify({"ok": False, "error": "file_read_error", "message": str(exc)}), 400

    fp = get_file_processor()
    if fp is None:
        try:
            from services.file_processor import FileProcessor
            fp = FileProcessor()
        except Exception as exc:
            logger.error("[Studio] Failed to instantiate FileProcessor: %s", exc)
            return jsonify({"ok": False, "error": "file_processor_unavailable"}), 500

    result = fp.process_file(file_bytes, file.filename)
    if not result.ok:
        code = result.error_code or "extraction_failed"
        status_code = 400
        if code in {"server_missing_library", "extraction_failed"}:
            status_code = 500
        return jsonify({
            "ok": False,
            "error": code,
            "message": result.error_message or code,
        }), status_code

    return jsonify({
        "ok": True,
        "extracted_text": result.extracted_text,
        "word_count": result.word_count,
        "file_info": result.file_info,
        "warnings": result.warnings or [],
    })


# ---------------------------------------------------------------------------
# 2. Canonical Prompts for External AI
# ---------------------------------------------------------------------------


@studio_bp.route("/api/editor/studio/prompts", methods=["GET"])
def studio_get_prompts() -> Any:
    """Return canonical prompt templates for external AI agents."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_studio"}), 403

    prompt_type = str(request.args.get("type", "analysis") or "analysis").strip().lower()
    task_type = str(request.args.get("task_type", "") or "").strip().upper()
    lang = str(request.args.get("lang", "ru") or "ru").strip().lower()

    if prompt_type == "analysis":
        prompt_text = build_studio_analysis_prompt(target_language=lang)
        return jsonify({
            "ok": True,
            "prompt_type": "analysis",
            "prompt": prompt_text,
            "language": lang,
        })

    if prompt_type == "generation":
        if task_type:
            prompt_text = get_studio_generation_prompt(task_type)
            if not prompt_text:
                return jsonify({
                    "ok": False,
                    "error": "task_type_not_found",
                    "supported_types": list(_GENERATION_PROMPTS.keys()),
                }), 404
            return jsonify({
                "ok": True,
                "prompt_type": "generation",
                "task_type": task_type,
                "prompt": prompt_text,
                "language": lang,
            })
        return jsonify({
            "ok": True,
            "prompt_type": "generation",
            "prompts": dict(_GENERATION_PROMPTS),
            "supported_types": list(_GENERATION_PROMPTS.keys()),
            "language": lang,
        })

    if prompt_type == "all":
        all_prompts = get_all_studio_prompts(target_language=lang)
        return jsonify({
            "ok": True,
            "prompt_type": "all",
            "language": lang,
            **all_prompts,
        })

    return jsonify({
        "ok": False,
        "error": "invalid_prompt_type",
        "supported_prompt_types": ["analysis", "generation", "all"],
    }), 400


# ---------------------------------------------------------------------------
# 3. Studio Session History (PostgreSQL max 3 FIFO)
# ---------------------------------------------------------------------------


@studio_bp.route("/api/editor/studio/sessions", methods=["GET"])
def studio_list_sessions() -> Any:
    """List recent studio analysis sessions for current user (max 3)."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_studio"}), 403

    try:
        limit = int(request.args.get("limit", 3))
    except (TypeError, ValueError):
        limit = 3
    limit = max(1, min(10, limit))

    repo = _get_studio_session_repo()
    sessions = repo.list_sessions(user_id=ctx.user_id, limit=limit)
    return jsonify({
        "ok": True,
        "sessions": sessions,
    })


@studio_bp.route("/api/editor/studio/sessions", methods=["POST"])
def studio_save_session() -> Any:
    """Save or update studio analysis session with FIFO rotation (retains up to 3)."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_studio"}), 403

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "invalid_json_payload"}), 400

    repo = _get_studio_session_repo()
    try:
        saved = repo.save_session(user_id=ctx.user_id, payload=payload)
        return jsonify({
            "ok": True,
            "session": saved,
        })
    except Exception as exc:
        logger.exception("[StudioRoutes] Failed to save studio session: %s", exc)
        return jsonify({
            "ok": False,
            "error": "save_session_failed",
            "message": str(exc),
        }), 500


@studio_bp.route("/api/editor/studio/sessions/<session_id>", methods=["DELETE"])
def studio_delete_session(session_id: str) -> Any:
    """Delete a studio session belonging to the current user."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_studio"}), 403

    clean_id = str(session_id or "").strip()
    if not clean_id:
        return jsonify({"ok": False, "error": "session_id_required"}), 400

    repo = _get_studio_session_repo()
    deleted = repo.delete_session(user_id=ctx.user_id, session_id=clean_id)
    return jsonify({
        "ok": True,
        "deleted": deleted,
    })
