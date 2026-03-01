"""AI Generation API routes (smaller endpoints).

Endpoints:
- GET    /api/editor/ai/status
- POST   /api/editor/ai/analyze
- GET    /api/editor/ai/analyses
- GET    /api/editor/ai/analyses/<run_id>
- GET    /api/editor/ai/analyses/<run_id>/coverage
- POST   /api/editor/ai/upload

NOTE: POST /api/editor/ai/generate remains in server.py due to its size
and deep helper dependencies.  It will be moved after helpers are
extracted to a dedicated module (Phase 10b).
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

from flask import Blueprint, jsonify, request

from routes._context import get_ai_service, get_ctx, get_extra, get_file_processor

logger = logging.getLogger(__name__)

ai_bp = Blueprint("ai", __name__)


# ---------------------------------------------------------------------------
# Helper accessor
# ---------------------------------------------------------------------------

def _ah() -> Dict[str, Any]:
    """Return the ai helpers dict registered by server.py."""
    return get_extra("ai_helpers")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@ai_bp.route("/api/editor/ai/status", methods=["GET"])
def ai_status() -> Any:
    """Check AI provider availability and daily limits."""
    svc = get_ai_service()
    h = _ah()
    if svc is None or not svc.is_configured:
        return jsonify(h["attach_editor_feature_flags"]({
            "ok": True,
            "ai_available": False,
            "active_provider": None,
            "providers": {},
            "daily_limit": {
                "files_remaining": 0,
                "max_files_per_day": 3,
                "resets_at": None,
            },
        }))
    try:
        user_id = get_ctx().user_id or "default_user"
        result = svc.get_status(user_id)
        return jsonify(h["attach_editor_feature_flags"](result if isinstance(result, dict) else {"ok": True}))
    except Exception as exc:
        logger.exception("[HTTP] ai/status error: %s", exc)
        return jsonify(h["attach_editor_feature_flags"]({"ok": False, "error": "status_check_failed"})), 500


@ai_bp.route("/api/editor/ai/analyze", methods=["POST"])
def ai_analyze() -> Any:
    """Phase 1: Analyze material and return recommendations."""
    ctx = get_ctx()
    svc = get_ai_service()
    h = _ah()
    provider_chain_attempts: Any = []

    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_ai"}), 403
    if svc is None or not svc.is_configured:
        return jsonify(h["attach_editor_feature_flags"]({
            "ok": False,
            "error": "ai_unavailable",
            "provider_chain_attempts": provider_chain_attempts,
            "fallback": "manual",
            "message": "Извините, сервис ИИ-генерации временно недоступен. "
                       "Пожалуйста, попробуйте позже или воспользуйтесь ручным режимом.",
        })), 503

    payload = request.get_json(silent=True) or {}
    material = payload.get("material", "")
    requested_run_id = payload.get("ai_run_id")
    source_file_info = payload.get("source_file_info")
    if source_file_info is not None and not isinstance(source_file_info, dict):
        source_file_info = None

    if not material or not isinstance(material, str):
        return jsonify({"ok": False, "error": "material_required"}), 400

    material = material.strip()
    if len(material) > svc.max_text_length:
        return jsonify({
            "ok": False,
            "error": "material_too_long",
            "message": f"Текст слишком длинный ({len(material)} символов). "
                       f"Максимум — {svc.max_text_length} символов.",
        }), 400

    word_count = len(material.split())
    if word_count < 50:
        return jsonify({
            "ok": False,
            "error": "material_too_short",
            "message": "Слишком мало текста для анализа. Нужно хотя бы 50 слов учебного материала.",
        }), 400

    material_language = h["guess_language_code"](material)
    output_language_pref = h["normalize_output_language_request"](payload, material_language)

    try:
        ai_run_id = h["safe_ai_run_id"](requested_run_id)
        analysis_result, provider_name = svc.analyze_material(
            material,
            target_language_override=output_language_pref.get("effective"),
        )
        provider_chain_attempts = svc.consume_last_provider_chain_attempts()
        if output_language_pref.get("translation_warning"):
            warnings = list(analysis_result.warnings or [])
            if output_language_pref["translation_warning"] not in warnings:
                warnings.append(output_language_pref["translation_warning"])
            analysis_result.warnings = warnings
        analysis_result.target_language = output_language_pref.get("effective") or analysis_result.target_language
        active_provider = getattr(svc, "_active_provider", None)
        provider_model = getattr(active_provider, "model", None) if active_provider else None
        try:
            h["ai_run_merge_manifest"](
                ai_run_id,
                {
                    "phase": "analyzed",
                    "material_language": material_language,
                    "output_language_mode": output_language_pref.get("mode"),
                    "requested_output_language": output_language_pref.get("requested"),
                    "effective_output_language": output_language_pref.get("effective"),
                    "material_word_count": word_count,
                    "provider_used": provider_name,
                    "provider_model": provider_model,
                    "provider_chain_attempts": provider_chain_attempts,
                    "source_file_info": source_file_info,
                    "source_file_name": (
                        (source_file_info or {}).get("name")
                        or (source_file_info or {}).get("filename")
                    ),
                },
            )
            h["ai_run_write_artifact"](
                ai_run_id,
                "analysis",
                {
                    "run_id": ai_run_id,
                    "created_at": h["utc_now_iso"](),
                    "provider_used": provider_name,
                    "provider_model": provider_model,
                    "provider_chain_attempts": provider_chain_attempts,
                    "material_stats": {
                        "word_count": word_count,
                        "char_count": len(material),
                        "language": material_language,
                    },
                    "language_preferences": output_language_pref,
                    "result": analysis_result.to_dict(),
                },
            )
        except Exception:
            logger.exception("[HTTP] Failed to persist ai-run analysis artifact: %s", ai_run_id)
        response = h["sanitize_analysis_response_for_client"]({
            "ok": True,
            "ai_run_id": ai_run_id,
            "provider_used": provider_name,
            "provider_model": provider_model,
            "provider_chain_attempts": provider_chain_attempts,
            "material_language": material_language,
            "output_language_mode": output_language_pref.get("mode"),
            "requested_output_language": output_language_pref.get("requested"),
            "effective_output_language": output_language_pref.get("effective"),
            "output_language_warning": output_language_pref.get("translation_warning"),
            **analysis_result.to_dict(),
        })
        logger.info(
            "[HTTP] ai/analyze: provider=%s units=%d recommendations=%d",
            provider_name,
            len(analysis_result.educational_units),
            len(analysis_result.recommendations),
        )
        h["emit_theory_rollout_telemetry"](
            "analysis_analyze_success",
            ai_run_id=ai_run_id,
            provider_used=provider_name,
            provider_model=provider_model,
            material_language=material_language,
            output_language=output_language_pref.get("effective"),
            **h["analysis_rollout_quality_fields"](response),
        )
        return jsonify(response)

    except h["AnalysisParseError"] as ve:
        logger.warning("[HTTP] ai/analyze parse failed: %s", ve)
        provider_chain_attempts = svc.consume_last_provider_chain_attempts()
        try:
            h["ai_run_merge_manifest"](
                ai_run_id,
                {
                    "phase": "analysis_parse_failed",
                    "provider_used": getattr(ve, "provider_name", None),
                    "provider_chain_attempts": provider_chain_attempts,
                    "parse_error": str(ve),
                },
            )
            h["ai_run_write_artifact"](
                ai_run_id,
                "analysis_parse_error",
                {
                    "run_id": ai_run_id,
                    "created_at": h["utc_now_iso"](),
                    "provider_used": getattr(ve, "provider_name", None),
                    "error": str(ve),
                    "provider_chain_attempts": provider_chain_attempts,
                    "raw_response_preview": (getattr(ve, "raw_text", "") or "")[:4000],
                    "raw_response": getattr(ve, "raw_text", "") or "",
                    "material_stats": {
                        "word_count": word_count,
                        "char_count": len(material),
                        "language": h["guess_language_code"](material),
                    },
                },
            )
        except Exception:
            logger.exception("[HTTP] Failed to persist ai-run analysis parse-error artifact: %s", ai_run_id)
        return jsonify({
            "ok": False,
            "error": "analysis_parse_failed",
            "provider_chain_attempts": provider_chain_attempts,
            "message": "Не удалось обработать ответ ИИ.",
        }), 502

    except ValueError as ve:
        logger.warning("[HTTP] ai/analyze parse failed: %s", ve)
        provider_chain_attempts = svc.consume_last_provider_chain_attempts()
        return jsonify({
            "ok": False,
            "error": "analysis_parse_failed",
            "provider_chain_attempts": provider_chain_attempts,
            "message": "Не удалось обработать ответ ИИ.",
        }), 502

    except RuntimeError as re_:
        logger.error("[HTTP] ai/analyze all providers failed: %s", re_)
        provider_chain_attempts = svc.consume_last_provider_chain_attempts()
        return jsonify({
            "ok": False,
            "error": "ai_unavailable",
            "provider_chain_attempts": provider_chain_attempts,
            "fallback": "manual",
            "message": "Извините, сервис ИИ-генерации временно недоступен. "
                       "Пожалуйста, попробуйте позже или воспользуйтесь ручным режимом.",
        }), 503

    except Exception as exc:
        logger.exception("[HTTP] ai/analyze unexpected error: %s", exc)
        provider_chain_attempts = svc.consume_last_provider_chain_attempts()
        return jsonify({"ok": False, "error": "analysis_failed", "provider_chain_attempts": provider_chain_attempts}), 500


@ai_bp.route("/api/editor/ai/analyses", methods=["GET"])
def ai_list_analyses() -> Any:
    """List persisted theory analyses (ai_run artifacts with analysis.json)."""
    ctx = get_ctx()
    h = _ah()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_ai"}), 403

    try:
        limit_raw = str(request.args.get("limit", "20") or "20").strip()
        try:
            limit = int(limit_raw)
        except ValueError:
            limit = 20
        limit = max(1, min(100, limit))

        rows: List[Tuple[str, Dict[str, Any]]] = []
        root = h["ai_runs_root"]()
        for run_dir in root.iterdir():
            if not run_dir.is_dir():
                continue
            run_id = run_dir.name
            if not h["is_valid_ai_run_id"](run_id):
                continue

            analysis_artifact = h["read_json_file"](run_dir / "analysis.json")
            if not isinstance(analysis_artifact, dict):
                continue
            result = analysis_artifact.get("result")
            if not isinstance(result, dict):
                continue

            manifest = h["read_json_file"](run_dir / "run.json") or {}
            if not isinstance(manifest, dict):
                manifest = {}
            material_stats = analysis_artifact.get("material_stats")
            if not isinstance(material_stats, dict):
                material_stats = {}
            lang_prefs = analysis_artifact.get("language_preferences")
            if not isinstance(lang_prefs, dict):
                lang_prefs = {}

            row = {
                "ai_run_id": run_id,
                "phase": manifest.get("phase") or "analyzed",
                "created_at": analysis_artifact.get("created_at") or manifest.get("created_at"),
                "updated_at": manifest.get("updated_at") or analysis_artifact.get("created_at"),
                "provider_used": analysis_artifact.get("provider_used") or manifest.get("provider_used"),
                "provider_model": analysis_artifact.get("provider_model") or manifest.get("provider_model"),
                "material_language": material_stats.get("language") or manifest.get("material_language"),
                "material_word_count": material_stats.get("word_count") or manifest.get("material_word_count"),
                "material_char_count": material_stats.get("char_count"),
                "output_language_mode": lang_prefs.get("mode") or manifest.get("output_language_mode"),
                "effective_output_language": (
                    lang_prefs.get("effective") or manifest.get("effective_output_language")
                ),
                "requested_output_language": (
                    lang_prefs.get("requested") or manifest.get("requested_output_language")
                ),
                "source_file_name": (
                    manifest.get("source_file_name")
                    or ((manifest.get("source_file_info") or {}).get("name") if isinstance(manifest.get("source_file_info"), dict) else None)
                ),
                "has_analysis": True,
                "analysis_schema_version": result.get("analysis_schema_version"),
                "report_blocks_version": result.get("report_blocks_version"),
                "units_count": len(result.get("educational_units") or []),
                "recommendations_count": len(result.get("recommendations") or []),
                "learning_chunks_count": len(result.get("learning_chunks") or []),
                "authoring_routes_count": len(result.get("authoring_routes") or []),
                "future_capabilities_count": len(result.get("future_capabilities") or []),
                "microcards_candidates_count": len(result.get("microcards_candidates") or []),
                "warnings_count": len(result.get("warnings") or []),
                "human_summary": result.get("human_summary"),
            }
            sort_key = str(row.get("updated_at") or row.get("created_at") or "")
            rows.append((sort_key, row))

        rows.sort(key=lambda item: (item[0], item[1].get("ai_run_id") or ""), reverse=True)
        return jsonify({"ok": True, "items": [row for _, row in rows[:limit]]})
    except Exception as exc:
        logger.exception("[HTTP] ai/analyses list error: %s", exc)
        return jsonify({"ok": False, "error": "ai_runs_list_failed"}), 500


@ai_bp.route("/api/editor/ai/analyses/<run_id>", methods=["GET"])
def ai_get_analysis_run(run_id: str) -> Any:
    """Reopen a persisted theory analysis by ai_run_id."""
    ctx = get_ctx()
    h = _ah()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_ai"}), 403
    if not h["is_valid_ai_run_id"](run_id):
        return jsonify({"ok": False, "error": "invalid_ai_run_id"}), 400

    try:
        payload = h["ai_run_build_reopen_analysis_response"](run_id)
        if payload is None:
            return jsonify({"ok": False, "error": "analysis_not_found"}), 404
        h["emit_theory_rollout_telemetry"](
            "analysis_payload_served",
            ai_run_id=run_id,
            source="reopen",
            **h["analysis_rollout_quality_fields"](payload),
        )
        return jsonify(payload)
    except Exception as exc:
        logger.exception("[HTTP] ai/analyses open error run_id=%s: %s", run_id, exc)
        return jsonify({"ok": False, "error": "analysis_reopen_failed"}), 500


@ai_bp.route("/api/editor/ai/analyses/<run_id>/coverage", methods=["GET"])
def ai_get_analysis_topic_coverage(run_id: str) -> Any:
    """Coverage + grounding summary for one editor topic against a selected ai_run analysis."""
    ctx = get_ctx()
    h = _ah()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_ai"}), 403
    if not h["is_editor_feature_enabled"]("analysis_coverage_in_editor"):
        return h["feature_disabled_json"]("analysis_coverage_disabled", status_code=404)
    if not h["is_valid_ai_run_id"](run_id):
        return jsonify({"ok": False, "error": "invalid_ai_run_id"}), 400

    module_id = str(request.args.get("module_id") or "").strip()
    topic_id = str(request.args.get("topic_id") or "").strip()
    if not module_id:
        return jsonify({"ok": False, "error": "module_id_required"}), 400
    if not topic_id:
        return jsonify({"ok": False, "error": "topic_id_required"}), 400

    try:
        payload = h["build_ai_analysis_topic_coverage_response"](run_id, module_id, topic_id)
        if payload is None:
            return jsonify({"ok": False, "error": "analysis_not_found"}), 404
        summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
        h["emit_theory_rollout_telemetry"](
            "analysis_coverage_served",
            ai_run_id=run_id,
            module_id=module_id,
            topic_id=topic_id,
            tasks_total=summary.get("tasks_total"),
            tasks_linked_in_scope=summary.get("tasks_linked_in_scope"),
            must_cover_units_uncovered=summary.get("must_cover_units_uncovered"),
            weak_grounding_tasks=summary.get("weak_grounding_tasks"),
        )
        return jsonify(payload)
    except ValueError as exc:
        # StorageService may raise on invalid ids.
        logger.warning("[HTTP] ai/analyses coverage invalid ids run_id=%s: %s", run_id, exc)
        return jsonify({"ok": False, "error": "invalid_topic_ref"}), 400
    except LookupError as exc:
        if str(exc) == "topic_not_found":
            return jsonify({"ok": False, "error": "topic_not_found"}), 404
        logger.warning("[HTTP] ai/analyses coverage lookup failed run_id=%s: %s", run_id, exc)
        return jsonify({"ok": False, "error": "coverage_lookup_failed"}), 404
    except Exception as exc:
        logger.exception("[HTTP] ai/analyses coverage error run_id=%s: %s", run_id, exc)
        return jsonify({"ok": False, "error": "analysis_coverage_failed"}), 500


@ai_bp.route("/api/editor/ai/upload", methods=["POST"])
def ai_upload() -> Any:
    """Upload a file (PDF/DOCX/TXT) and extract text via FileProcessor."""
    ctx = get_ctx()
    svc = get_ai_service()
    fp = get_file_processor()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_ai"}), 403
    if svc is None or not svc.is_configured:
        return jsonify({"ok": False, "error": "ai_unavailable"}), 503
    if fp is None:
        return jsonify({"ok": False, "error": "file_processor_unavailable"}), 500

    user_id = ctx.user_id or "default_user"

    # Check daily limit
    allowed, remaining, max_files = svc.check_daily_limit(user_id)
    if not allowed:
        return jsonify({
            "ok": False,
            "error": "daily_limit_exceeded",
            "message": f"Вы уже загрузили {max_files} файлов сегодня — это максимум на сутки. "
                       "Лимит обновится завтра в 00:00.",
        }), 429

    if "file" not in request.files:
        return jsonify({"ok": False, "error": "file_required"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"ok": False, "error": "file_required"}), 400

    file_bytes = file.read()
    result = fp.process_file(file_bytes, file.filename)

    if not result.ok:
        # Map error codes to HTTP status codes
        _ERROR_STATUS = {
            "file_too_large": 400,
            "unsupported_format": 400,
            "file_empty": 400,
            "no_text_layer": 400,
            "too_few_words": 400,
            "server_missing_library": 500,
            "extraction_failed": 500,
        }
        status = _ERROR_STATUS.get(result.error_code, 400)
        return jsonify({
            "ok": False,
            "error": result.error_code,
            "message": result.error_message,
        }), status

    # Increment daily counter
    svc.increment_daily_usage(user_id)

    logger.info(
        "[HTTP] ai/upload: file=%s format=%s size=%sMB words=%d",
        file.filename,
        result.file_info.get("format", "?"),
        result.file_info.get("size_mb", "?"),
        result.word_count,
    )

    return jsonify({
        "ok": True,
        "extracted_text": result.extracted_text,
        "word_count": result.word_count,
        "file_info": result.file_info,
        "warnings": result.warnings,
    })
