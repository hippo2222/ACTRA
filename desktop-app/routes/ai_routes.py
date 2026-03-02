"""AI Generation API routes.

Endpoints:
- GET    /api/editor/ai/status
- POST   /api/editor/ai/analyze
- GET    /api/editor/ai/analyses
- GET    /api/editor/ai/analyses/<run_id>
- GET    /api/editor/ai/analyses/<run_id>/coverage
- POST   /api/editor/ai/upload
- POST   /api/editor/ai/generate
"""

import logging
import re
import time
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


# ---------------------------------------------------------------------------
# Helper accessor for ai_generate
# ---------------------------------------------------------------------------

def _genh() -> Dict[str, Any]:
    """Return the ai_generate helpers dict registered by server.py."""
    return get_extra("ai_generate_helpers")


# ---------------------------------------------------------------------------
# POST /api/editor/ai/generate
# ---------------------------------------------------------------------------


@ai_bp.route("/api/editor/ai/generate", methods=["POST"])
def ai_generate() -> Any:
    """Phase 2: Generate tasks of selected types."""
    h = _genh()
    _ai_service = h["ai_service"]
    PARSERS_AVAILABLE = h["PARSERS_AVAILABLE"]
    _headless_app_ctx = h["headless_app_ctx"]
    TestImportParser = h["TestImportParser"]
    OpenAnswerParser = h["OpenAnswerParser"]
    SequenceParser = h["SequenceParser"]
    ClickTextParser = h["ClickTextParser"]
    ClickWordsParser = h["ClickWordsParser"]
    _validate_with_task_type = h["validate_with_task_type"]
    _source_grounding_info_from_preview = h["source_grounding_info_from_preview"]
    _semantic_duplicate_info_from_preview = h["semantic_duplicate_info_from_preview"]
    _annotate_task_preview_source_grounding = h["annotate_task_preview_source_grounding"]
    _annotate_semantic_duplicate_candidates = h["annotate_semantic_duplicate_candidates"]
    _compact_ai_unit_contexts = h["compact_ai_unit_contexts"]
    _plan_ai_generation_subrequests = h["plan_ai_generation_subrequests"]
    _postprocess_ai_generate_results = h["postprocess_ai_generate_results"]
    _stable_json_hash = h["stable_json_hash"]
    _extract_task_preview_signature = h["extract_task_preview_signature"]
    _safe_ai_run_id = h["safe_ai_run_id"]
    _guess_language_code = h["guess_language_code"]
    _normalize_output_language_request = h["normalize_output_language_request"]
    _ai_run_merge_manifest = h["ai_run_merge_manifest"]
    _ai_run_write_artifact = h["ai_run_write_artifact"]
    _utc_now_iso = h["utc_now_iso"]

    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_ai"}), 403
    if _ai_service is None or not _ai_service.is_configured:
        return jsonify({
            "ok": False,
            "error": "ai_unavailable",
            "message": "Сервис ИИ-генерации недоступен.",
        }), 503
    if not PARSERS_AVAILABLE:
        return jsonify({"ok": False, "error": "parsers_not_available"}), 500

    payload = request.get_json(silent=True) or {}
    material = payload.get("material", "")
    tasks_to_generate = payload.get("tasks_to_generate", [])
    ai_run_id = _safe_ai_run_id(payload.get("ai_run_id"))

    if not material or not isinstance(material, str):
        return jsonify({"ok": False, "error": "material_required"}), 400
    if not tasks_to_generate or not isinstance(tasks_to_generate, list):
        return jsonify({"ok": False, "error": "tasks_to_generate_required"}), 400

    material_language = _guess_language_code(material)
    output_language_pref = _normalize_output_language_request(payload, material_language)

    # Map task_type -> parser class
    _PARSER_MAP = {
        "TEST": TestImportParser,
        "OPEN_ANSWER": OpenAnswerParser,
        "SEQUENCE": SequenceParser,
        "CLICK_TEXT": ClickTextParser,
        "CLICK_WORDS": ClickWordsParser,
    }

    # Map task_type -> marker for parse_text
    _MARKER_MAP = {
        "TEST": "@TEST",
        "OPEN_ANSWER": "@OPEN_ANSWER",
        "SEQUENCE": "@SEQUENCE",
        "CLICK_TEXT": "@CLICK_TEXT",
        "CLICK_WORDS": "@CLICK_WORDS",
    }

    def _parse_ai_response_for_type(task_type_local: str, raw_response_local: str) -> tuple:
        parser_cls_local = _PARSER_MAP[task_type_local]
        marker_local = _MARKER_MAP[task_type_local]
        parsed_local = []
        parser_local = None
        parse_errors_local: List[str] = []
        try:
            parser_local = parser_cls_local()
            text_to_parse_local = raw_response_local or ""
            if marker_local not in text_to_parse_local:
                text_to_parse_local = f"{marker_local}\n{text_to_parse_local}"
            parsed_local = parser_local.parse_text(text_to_parse_local)
            if getattr(parser_local, "errors", None):
                parse_errors_local.extend(parser_local.errors)
        except Exception as parse_exc_local:
            logger.error("[HTTP] ai/generate parse %s failed: %s", task_type_local, parse_exc_local)
            parse_errors_local.append(f"Ошибка парсинга {task_type_local}: {str(parse_exc_local)}")
        return parsed_local, parser_local, parse_errors_local

    def _build_ai_preview_tasks(
        task_type_local: str,
        parsed_tasks_local: List[Dict[str, Any]],
        parser_local: Any,
        index_base_local: int = 0,
    ) -> List[Dict[str, Any]]:
        preview_tasks_local: List[Dict[str, Any]] = []
        parser_warnings_local = getattr(parser_local, "warnings", []) if parser_local is not None else []
        for i_local, task_local in enumerate(parsed_tasks_local):
            task_data_local = task_local.get("data", {})
            validation_issues_local = []

            for w in parser_warnings_local or []:
                if w.get("index", 0) != i_local:
                    continue
                if task_type_local == "TEST" and w.get("code") == "multiple_correct":
                    continue
                validation_issues_local.append({
                    "severity": w.get("severity", "warning"),
                    "message": w.get("message", ""),
                    "field": w.get("code", "unknown"),
                })

            try:
                validation_issues_local.extend(_validate_with_task_type(task_local.get("type", "unknown"), task_data_local))
            except Exception as validator_exc_local:
                logger.warning(
                    "[HTTP] ai/generate validation failed for %s #%s: %s",
                    task_type_local,
                    i_local,
                    validator_exc_local,
                )
                validation_issues_local.append({
                    "severity": "warning",
                    "message": f"Validation check failed: {validator_exc_local}",
                    "field": "validation_runtime",
                })

            status_local = "valid"
            if any(v.get("severity") == "error" for v in validation_issues_local):
                status_local = "error"
            elif validation_issues_local:
                status_local = "warning"

            preview_tasks_local.append({
                "index": index_base_local + i_local,
                "type": task_local.get("type", "unknown"),
                "name": task_local.get("name", f"Task #{i_local + 1}"),
                "prompt": task_local.get("prompt", ""),
                "data": task_data_local,
                "status": status_local,
                "validation_issues": validation_issues_local,
            })
        return preview_tasks_local

    def _preview_sort_key(task_type_local: str, preview_local: Dict[str, Any]) -> tuple:
        status_rank = {"valid": 0, "warning": 1, "error": 2}
        issues_local = preview_local.get("validation_issues") or []
        issue_fields = [str(v.get("field") or "") for v in issues_local if isinstance(v, dict)]
        critical_click_words = {"error_spans_count_high", "error_spans_count_low", "unbalanced_brackets"}
        critical_count = sum(1 for field in issue_fields if field in critical_click_words)
        grounding_info_local = _source_grounding_info_from_preview(preview_local) or {}
        semantic_dup_info_local = _semantic_duplicate_info_from_preview(preview_local) or {}
        grounding_weak_local = bool(grounding_info_local.get("weak"))
        semantic_dup_local = bool(semantic_dup_info_local.get("candidate"))
        try:
            grounding_score_local = float(grounding_info_local.get("score", 0.0) or 0.0)
        except Exception:
            grounding_score_local = 0.0
        try:
            semantic_dup_score_local = float(semantic_dup_info_local.get("score", 0.0) or 0.0)
        except Exception:
            semantic_dup_score_local = 0.0
        return (
            status_rank.get(str(preview_local.get("status") or "warning"), 1),
            critical_count if task_type_local == "CLICK_WORDS" else 0,
            1 if semantic_dup_local else 0,
            semantic_dup_score_local if semantic_dup_local else 0.0,
            1 if grounding_weak_local else 0,
            -grounding_score_local,
            len(issues_local),
            len(str(preview_local.get("prompt") or "")),
        )

    def _reindex_previews(previews_local: List[Dict[str, Any]], index_base_local: int) -> None:
        for offset_local, preview_local in enumerate(previews_local):
            if isinstance(preview_local, dict):
                preview_local["index"] = index_base_local + offset_local

    def _annotate_previews_source_grounding(
        previews_local: List[Dict[str, Any]],
        unit_contexts_local: List[Dict[str, Any]],
        *,
        task_type_hint_local: Optional[str] = None,
    ) -> None:
        if not isinstance(previews_local, list) or not unit_contexts_local:
            return
        for preview_local in previews_local:
            if not isinstance(preview_local, dict):
                continue
            task_type_preview_local = str(task_type_hint_local or preview_local.get("type") or "")
            _annotate_task_preview_source_grounding(
                preview_local,
                unit_contexts_local,
                task_type=task_type_preview_local,
            )

    def _count_weak_source_grounding_tasks(previews_local: List[Dict[str, Any]]) -> int:
        count_local = 0
        for preview_local in previews_local or []:
            grounding_local = _source_grounding_info_from_preview(preview_local) or {}
            if bool(grounding_local.get("weak")):
                count_local += 1
        return count_local

    def _annotate_previews_semantic_duplicates(previews_local: List[Dict[str, Any]], task_type_local: str) -> Dict[str, int]:
        if not isinstance(previews_local, list) or len(previews_local) < 2:
            return {"groups": 0, "tasks_marked": 0}
        return _annotate_semantic_duplicate_candidates(previews_local, task_type=task_type_local)

    def _count_semantic_duplicate_tasks(previews_local: List[Dict[str, Any]]) -> int:
        count_local = 0
        for preview_local in previews_local or []:
            dup_local = _semantic_duplicate_info_from_preview(preview_local) or {}
            if bool(dup_local.get("candidate")):
                count_local += 1
        return count_local

    def _has_remaining_providers_after(
        provider_name_local: Optional[str],
        preferred_provider_names_local: Optional[List[str]] = None,
    ) -> bool:
        if not provider_name_local:
            return False
        iter_chain_fn = getattr(_ai_service, "_iter_provider_chain", None)
        if not callable(iter_chain_fn):
            return False
        try:
            remaining = iter_chain_fn(
                start_after_provider=provider_name_local,
                preferred_provider_names=preferred_provider_names_local,
            )
            return bool(remaining)
        except Exception:
            return False

    def _provider_preferences_for_task_type(task_type_local: str) -> Optional[List[str]]:
        """Prefer stricter-format models first for parser-sensitive generation types."""
        task_type_norm = str(task_type_local or "").upper()
        # Arcee has shown better format discipline for parser-sensitive generation
        # (especially SEQUENCE and CLICK_WORDS) in benchmark runs.
        if task_type_norm in {"SEQUENCE", "CLICK_WORDS"}:
            return ["openrouter:3", "openrouter:2"]
        return None

    def _build_generate_format_repair_hint(task_type_local: str, expected_count_local: int) -> str:
        if task_type_local == "CLICK_TEXT":
            return (
                f"Format recovery mode. Return exactly {expected_count_local} @CLICK_TEXT blocks and no extra text. "
                "Each block must use strict syntax only: @CLICK_TEXT, then one line starting with # (question), "
                "then 3-6 answer lines starting with + or -. No Markdown, no prose, no numbering."
            )
        if task_type_local == "CLICK_WORDS":
            return (
                f"Format recovery mode. Return exactly {expected_count_local} @CLICK_WORDS blocks and no extra text. "
                "Use strict @CLICK_WORDS syntax only with matched [ ] markers for erroneous tokens."
            )
        if task_type_local == "SEQUENCE":
            return (
                f"Format recovery mode. Return exactly {expected_count_local} @SEQUENCE blocks and no extra text. "
                "Use strict parser syntax only: @SEQUENCE, one # line, at least 3 lines like 'element_1: ...', "
                "then one or more lines like 'level_1: element_1, element_2'. Levels must reference existing element_X IDs only."
            )
        if task_type_local == "TEST":
            return (
                f"Format recovery mode. Return exactly {expected_count_local} @TEST blocks and no extra text. "
                "Use strict parser syntax only (@TEST, # title, ? question, answer lines with + or -)."
            )
        if task_type_local == "OPEN_ANSWER":
            return (
                f"Format recovery mode. Return exactly {expected_count_local} @OPEN_ANSWER blocks and no extra text. "
                "Use strict parser syntax only."
            )
        return f"Format recovery mode. Return exactly {expected_count_local} blocks in strict parser syntax only."

    def _parse_probe_score(parsed_local: List[Dict[str, Any]], parse_errors_local: List[str]) -> tuple:
        return (
            len(parsed_local),
            -len(parse_errors_local),
        )

    def _generate_raw_with_parse_escalation(
        task_type_local: str,
        count_local: int,
        edu_units_local: List[Dict[str, Any]],
        *,
        extra_instructions_local: Optional[str] = None,
        preferred_provider_names_local: Optional[List[str]] = None,
    ) -> tuple:
        def _probe_test_repair_issue_count(previews_local: List[Dict[str, Any]]) -> int:
            count_bad_local = 0
            for preview_local in previews_local or []:
                if not isinstance(preview_local, dict):
                    continue
                issue_fields_local = {
                    str(issue.get("field") or "")
                    for issue in (preview_local.get("validation_issues") or [])
                    if isinstance(issue, dict)
                }
                has_issue_local = bool(issue_fields_local & {"questions", "no_correct_answer", "no_answers", "empty_question"})

                if not has_issue_local:
                    data_local = preview_local.get("data") or {}
                    questions_local = data_local.get("questions") if isinstance(data_local, dict) else None
                    if not isinstance(questions_local, list) or not questions_local:
                        has_issue_local = True
                    else:
                        for q_local in questions_local:
                            if not isinstance(q_local, dict):
                                has_issue_local = True
                                break
                            answers_local = q_local.get("answers") or []
                            if not isinstance(answers_local, list) or not answers_local:
                                has_issue_local = True
                                break
                            correct_flags_local = [
                                bool(a.get("correct", a.get("is_correct", False)))
                                for a in answers_local
                                if isinstance(a, dict)
                            ]
                            if not correct_flags_local or not any(correct_flags_local) or all(correct_flags_local):
                                has_issue_local = True
                                break
                if has_issue_local:
                    count_bad_local += 1
            return count_bad_local

        def _probe_sequence_repair_issue_count(previews_local: List[Dict[str, Any]]) -> int:
            count_bad_local = 0
            target_fields_local = {
                "elements",
                "levels",
                "duplicate_element_id",
                "too_few_elements",
                "unused_element",
                "too_many_levels",
            }
            for preview_local in previews_local or []:
                if not isinstance(preview_local, dict):
                    continue
                issue_fields_local = {
                    str(issue.get("field") or "")
                    for issue in (preview_local.get("validation_issues") or [])
                    if isinstance(issue, dict)
                }
                has_issue_local = bool(issue_fields_local & target_fields_local)
                if not has_issue_local:
                    data_local = preview_local.get("data") or {}
                    if not isinstance(data_local, dict):
                        has_issue_local = True
                    else:
                        elements_local = data_local.get("elements") or {}
                        levels_local = data_local.get("levels") or {}
                        if not elements_local or not levels_local:
                            has_issue_local = True
                        elif hasattr(elements_local, "__len__") and len(elements_local) < 3:
                            has_issue_local = True
                if has_issue_local:
                    count_bad_local += 1
            return count_bad_local

        raw_response_local, provider_name_local = _ai_service.generate_tasks(
            material,
            task_type_local,
            count_local,
            edu_units_local,
            target_language_override=output_language_pref.get("effective"),
            extra_instructions=extra_instructions_local,
            preferred_provider_names=preferred_provider_names_local,
        )
        chain_local = list(_ai_service.consume_last_provider_chain_attempts())

        parsed_probe_local, parser_probe_local, parse_probe_errors_local = _parse_ai_response_for_type(
            task_type_local,
            raw_response_local or "",
        )
        expected_count_local = max(1, int(count_local or 1))
        probe_preview_local: List[Dict[str, Any]] = []
        probe_repair_issue_count_local = 0
        probe_sequence_issue_count_local = 0
        if task_type_local == "TEST":
            probe_preview_local = _build_ai_preview_tasks(task_type_local, parsed_probe_local, parser_probe_local, index_base_local=0)
            probe_repair_issue_count_local = _probe_test_repair_issue_count(probe_preview_local)
        elif task_type_local == "SEQUENCE":
            probe_preview_local = _build_ai_preview_tasks(task_type_local, parsed_probe_local, parser_probe_local, index_base_local=0)
            probe_sequence_issue_count_local = _probe_sequence_repair_issue_count(probe_preview_local)

        needs_escalation = (
            bool(parse_probe_errors_local)
            or len(parsed_probe_local) < expected_count_local
            or (task_type_local == "TEST" and probe_repair_issue_count_local > 0)
            or (task_type_local == "SEQUENCE" and probe_sequence_issue_count_local > 0)
        )

        if not needs_escalation or not _has_remaining_providers_after(
            provider_name_local,
            preferred_provider_names_local=preferred_provider_names_local,
        ):
            return raw_response_local, provider_name_local, chain_local

        format_hint_local = _build_generate_format_repair_hint(task_type_local, expected_count_local)
        if extra_instructions_local:
            escalation_extra_local = f"{extra_instructions_local} {format_hint_local}"
        else:
            escalation_extra_local = format_hint_local

        try:
            escalated_raw_local, escalated_provider_name_local = _ai_service.generate_tasks(
                material,
                task_type_local,
                count_local,
                edu_units_local,
                target_language_override=output_language_pref.get("effective"),
                extra_instructions=escalation_extra_local,
                start_after_provider=provider_name_local,
                preferred_provider_names=preferred_provider_names_local,
            )
            chain_local.extend(_ai_service.consume_last_provider_chain_attempts())
        except Exception:
            chain_local.extend(_ai_service.consume_last_provider_chain_attempts())
            return raw_response_local, provider_name_local, chain_local

        escalated_parsed_local, escalated_parser_local, escalated_parse_errors_local = _parse_ai_response_for_type(
            task_type_local,
            escalated_raw_local or "",
        )
        escalated_repair_issue_count_local = 0
        escalated_sequence_issue_count_local = 0
        if task_type_local == "TEST":
            escalated_preview_local = _build_ai_preview_tasks(
                task_type_local,
                escalated_parsed_local,
                escalated_parser_local,
                index_base_local=0,
            )
            escalated_repair_issue_count_local = _probe_test_repair_issue_count(escalated_preview_local)
        elif task_type_local == "SEQUENCE":
            escalated_preview_local = _build_ai_preview_tasks(
                task_type_local,
                escalated_parsed_local,
                escalated_parser_local,
                index_base_local=0,
            )
            escalated_sequence_issue_count_local = _probe_sequence_repair_issue_count(escalated_preview_local)

        initial_score_local = (
            *_parse_probe_score(parsed_probe_local, parse_probe_errors_local),
            -probe_repair_issue_count_local if task_type_local == "TEST" else 0,
            -probe_sequence_issue_count_local if task_type_local == "SEQUENCE" else 0,
        )
        escalated_score_local = (
            *_parse_probe_score(escalated_parsed_local, escalated_parse_errors_local),
            -escalated_repair_issue_count_local if task_type_local == "TEST" else 0,
            -escalated_sequence_issue_count_local if task_type_local == "SEQUENCE" else 0,
        )

        if escalated_score_local > initial_score_local:
            return escalated_raw_local, escalated_provider_name_local, chain_local

        return raw_response_local, provider_name_local, chain_local

    # ── Main generation loop ──────────────────────────────────────────
    results = []
    total_generated = 0
    total_valid = 0
    total_warnings = 0
    total_errors = 0
    by_type = {}

    for task_spec in tasks_to_generate:
        task_type = task_spec.get("task_type", "")
        count = task_spec.get("count", 3)
        edu_units = task_spec.get("educational_units", [])
        task_type_provider_preferences = _provider_preferences_for_task_type(task_type)
        edu_unit_ids = [
            u.get("id")
            for u in (edu_units if isinstance(edu_units, list) else [])
            if isinstance(u, dict) and u.get("id") is not None
        ]
        edu_unit_contexts = _compact_ai_unit_contexts(edu_units, max_units=10)

        if task_type not in _PARSER_MAP:
            results.append({
                "task_type": task_type,
                "status": "error",
                "error": f"Unknown task type: {task_type}",
                "tasks": [],
                "parsing_errors": [f"Неизвестный тип задания: {task_type}"],
                "generation_time_ms": 0,
                "educational_unit_ids": edu_unit_ids,
            })
            total_errors += 1
            continue

        subrequests = _plan_ai_generation_subrequests(task_type, count, edu_units)
        start_time = time.time()
        provider_name = None
        raw_chunks: List[str] = []
        parsing_errors = []
        subrequest_failures = 0
        provider_chain_attempts: List[Dict[str, Any]] = []

        for sub_idx, sub in enumerate(subrequests):
            sub_count = max(1, int(sub.get("count") or 1))
            sub_units = sub.get("educational_units") or []
            try:
                sub_raw_response, sub_provider_name, sub_chain_attempts = _generate_raw_with_parse_escalation(
                    task_type,
                    sub_count,
                    sub_units,
                    extra_instructions_local=None,
                    preferred_provider_names_local=task_type_provider_preferences,
                )
                if sub_provider_name and provider_name is None:
                    provider_name = sub_provider_name
                provider_chain_attempts.extend(sub_chain_attempts)
                if isinstance(sub_raw_response, str) and sub_raw_response.strip():
                    raw_chunks.append(sub_raw_response)
            except Exception as gen_exc:
                provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                subrequest_failures += 1
                logger.error(
                    "[HTTP] ai/generate %s subrequest %d/%d failed: %s",
                    task_type,
                    sub_idx + 1,
                    len(subrequests),
                    gen_exc,
                )
                parsing_errors.append(
                    f"Ошибка генерации {task_type} (part {sub_idx + 1}/{len(subrequests)}): {str(gen_exc)}"
                )

        if not raw_chunks:
            results.append({
                "task_type": task_type,
                "status": "error",
                "error": "all_subrequests_failed",
                "tasks": [],
                "parsing_errors": parsing_errors or [f"Ошибка генерации {task_type}"],
                "generation_time_ms": int((time.time() - start_time) * 1000),
                "educational_unit_ids": edu_unit_ids,
                "subrequest_count": len(subrequests),
                "provider_chain_attempts": provider_chain_attempts,
            })
            total_errors += 1
            continue

        raw_response = "\n\n".join(raw_chunks)
        requested_count = max(1, int(count or 1))

        # Parse the LLM response through the appropriate parser
        parsed_tasks, parser, parse_errors_local = _parse_ai_response_for_type(task_type, raw_response)
        if parse_errors_local:
            parsing_errors.extend(parse_errors_local)
        preview_tasks = _build_ai_preview_tasks(task_type, parsed_tasks, parser, index_base_local=0)
        _annotate_previews_source_grounding(preview_tasks, edu_unit_contexts, task_type_hint_local=task_type)

        repair_attempted = False
        repair_subrequest_count = 0

        def _valid_count(previews_local: List[Dict[str, Any]]) -> int:
            return sum(1 for p in previews_local if str(p.get("status") or "") == "valid")

        def _count_click_words_repair_issue_tasks(previews_local: List[Dict[str, Any]]) -> int:
            target_fields = {"error_spans_count_high", "error_spans_count_low", "unbalanced_brackets"}
            count_local = 0
            for p in previews_local:
                has_repair_issue = False
                for issue in (p.get("validation_issues") or []):
                    if str(issue.get("field") or "") in target_fields:
                        has_repair_issue = True
                        break
                if has_repair_issue:
                    count_local += 1
            return count_local

        def _has_click_words_repair_issues(previews_local: List[Dict[str, Any]]) -> bool:
            return _count_click_words_repair_issue_tasks(previews_local) > 0

        def _sequence_task_has_repairable_issues(preview_local: Dict[str, Any]) -> bool:
            if not isinstance(preview_local, dict):
                return False
            issue_fields_local = {
                str(issue.get("field") or "")
                for issue in (preview_local.get("validation_issues") or [])
                if isinstance(issue, dict)
            }
            if issue_fields_local & {
                "elements",
                "levels",
                "duplicate_element_id",
                "too_few_elements",
                "unused_element",
                "too_many_levels",
            }:
                return True
            if str(preview_local.get("status") or "") == "error":
                return True
            data_local = preview_local.get("data") or {}
            if not isinstance(data_local, dict):
                return True
            elements_local = data_local.get("elements") or {}
            levels_local = data_local.get("levels") or {}
            if not elements_local or not levels_local:
                return True
            if hasattr(elements_local, "__len__") and len(elements_local) < 3:
                return True
            return False

        def _count_sequence_repair_issue_tasks(previews_local: List[Dict[str, Any]]) -> int:
            return sum(1 for p in previews_local if _sequence_task_has_repairable_issues(p))

        def _test_task_has_repairable_issues(preview_local: Dict[str, Any]) -> bool:
            if not isinstance(preview_local, dict):
                return False

            issue_fields_local = {
                str(issue.get("field") or "")
                for issue in (preview_local.get("validation_issues") or [])
                if isinstance(issue, dict)
            }
            if issue_fields_local & {"questions", "no_correct_answer", "no_answers", "empty_question"}:
                return True

            data_local = preview_local.get("data") or {}
            if not isinstance(data_local, dict):
                return False
            questions_local = data_local.get("questions") or []
            if not isinstance(questions_local, list):
                return True

            for q_local in questions_local:
                if not isinstance(q_local, dict):
                    return True
                q_text_local = str(q_local.get("text") or "").strip()
                if not q_text_local:
                    return True
                answers_local = q_local.get("answers") or []
                if not isinstance(answers_local, list) or not answers_local:
                    return True

                normalized_answer_texts: List[str] = []
                correct_flags_local: List[bool] = []
                for ans_local in answers_local:
                    if not isinstance(ans_local, dict):
                        continue
                    ans_text_local = str(ans_local.get("text") or "").strip()
                    if not ans_text_local:
                        return True
                    normalized_answer_texts.append(re.sub(r"\s+", " ", ans_text_local).lower())
                    correct_flags_local.append(bool(ans_local.get("correct", ans_local.get("is_correct", False))))

                if not correct_flags_local:
                    return True
                if not any(correct_flags_local):
                    return True
                if all(correct_flags_local):
                    return True
                if len(set(normalized_answer_texts)) < len(normalized_answer_texts):
                    return True

            return False

        def _count_test_repair_issue_tasks(previews_local: List[Dict[str, Any]]) -> int:
            return sum(1 for p in previews_local if _test_task_has_repairable_issues(p))

        repair_count = 0
        if task_type == "CLICK_WORDS":
            current_valid_count = _valid_count(preview_tasks)
            if current_valid_count < requested_count and (
                _has_click_words_repair_issues(preview_tasks)
                or len(preview_tasks) != requested_count
                or bool(parsing_errors)
            ):
                repair_count = max(1, requested_count - current_valid_count)
        elif task_type == "TEST":
            current_valid_count = _valid_count(preview_tasks)
            test_issue_count = _count_test_repair_issue_tasks(preview_tasks)
            if test_issue_count > 0 or current_valid_count < requested_count or bool(parsing_errors):
                repair_count = max(1, min(requested_count, max(test_issue_count, requested_count - current_valid_count)))
        elif task_type == "CLICK_TEXT":
            current_valid_count = _valid_count(preview_tasks)
            if current_valid_count < requested_count and (
                len(preview_tasks) < requested_count
                or bool(parsing_errors)
            ):
                repair_count = max(1, requested_count - current_valid_count)
        elif task_type == "SEQUENCE":
            current_valid_count = _valid_count(preview_tasks)
            sequence_issue_count = _count_sequence_repair_issue_tasks(preview_tasks)
            if sequence_issue_count > 0 or current_valid_count < requested_count or bool(parsing_errors):
                repair_count = max(
                    1,
                    min(requested_count, max(sequence_issue_count, requested_count - current_valid_count)),
                )

        if repair_count > 0:
            repair_attempted = True
            if task_type == "CLICK_WORDS":
                repair_hint = (
                    f"Repair mode. Return exactly {repair_count} @CLICK_WORDS blocks and no extra blocks. "
                    "Each block must contain exactly 2-4 bracketed factual errors. "
                    "Use matched [ ] brackets only and wrap minimal erroneous token(s)."
                )
            elif task_type == "TEST":
                repair_hint = (
                    f"Repair mode. Return exactly {repair_count} @TEST blocks and no extra blocks. "
                    "Strict parser syntax only: @TEST, one # title line, one or more ? question lines, and answer lines prefixed with + or -. "
                    "Every question must have at least 2 answers, at least one correct (+) and at least one incorrect (-). "
                    "Avoid duplicate answer texts and trivial distractors."
                )
            elif task_type == "CLICK_TEXT":
                repair_hint = (
                    f"Repair mode. Return exactly {repair_count} @CLICK_TEXT blocks and no extra blocks. "
                    "Strict syntax only: @CLICK_TEXT, one # question line, then 3-6 answer lines prefixed with + or -. "
                    "No prose, no Markdown, no numbered lists."
                )
            else:
                repair_hint = (
                    f"Repair mode. Return exactly {repair_count} @SEQUENCE blocks and no extra blocks. "
                    "Use strict parser syntax only: @SEQUENCE, one # line, at least 3 element_X lines, then level_X lines "
                    "that reference only existing element_X IDs. Include the ordering principle in the # line. No prose or Markdown."
                )
            try:
                repair_raw_response, repair_provider_name, repair_chain_attempts = _generate_raw_with_parse_escalation(
                    task_type,
                    repair_count,
                    edu_units,
                    extra_instructions_local=repair_hint,
                    preferred_provider_names_local=task_type_provider_preferences,
                )
                repair_subrequest_count += 1
                if repair_provider_name and provider_name is None:
                    provider_name = repair_provider_name
                provider_chain_attempts.extend(repair_chain_attempts)
                repair_parsed_tasks, repair_parser, repair_parse_errors = _parse_ai_response_for_type(
                    task_type,
                    repair_raw_response or "",
                )
                if repair_parse_errors:
                    parsing_errors.extend([f"[repair-pass] {e}" for e in repair_parse_errors])
                repair_preview_tasks = _build_ai_preview_tasks(task_type, repair_parsed_tasks, repair_parser, index_base_local=0)
                _annotate_previews_source_grounding(repair_preview_tasks, edu_unit_contexts, task_type_hint_local=task_type)
                preview_tasks.extend(repair_preview_tasks)
            except Exception as repair_exc:
                provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                logger.warning("[HTTP] ai/generate repair-pass %s failed: %s", task_type, repair_exc)
                parsing_errors.append(f"Repair-pass failed for {task_type}: {str(repair_exc)}")

        if preview_tasks and (task_type in {"CLICK_WORDS", "SEQUENCE", "TEST"} or len(preview_tasks) > requested_count):
            preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))

        if len(preview_tasks) > requested_count:
            dropped_count = len(preview_tasks) - requested_count
            preview_tasks = preview_tasks[:requested_count]
            parsing_errors.append(
                f"Overgeneration trimmed for {task_type}: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
            )

        # Iterative fill for CLICK_WORDS:
        # if model still under-produces valid tasks after initial repair, try a few additional rounds.
        if task_type == "CLICK_WORDS":
            max_click_words_fill_rounds = 2
            fill_round = 0
            previous_valid_count = _valid_count(preview_tasks)
            while fill_round < max_click_words_fill_rounds and previous_valid_count < requested_count:
                fill_round += 1
                repair_attempted = True
                fill_count = max(1, requested_count - previous_valid_count)
                fill_hint = (
                    f"Iterative fill repair round {fill_round}. Return exactly {fill_count} @CLICK_WORDS blocks and no extra blocks. "
                    "Strict parser-safe syntax only. Each block must contain exactly 2-4 bracketed factual errors, "
                    "with matched [ ] markers around minimal erroneous token(s). Prefer short, clean tasks."
                )
                try:
                    fill_raw_response, fill_provider_name, fill_chain_attempts = _generate_raw_with_parse_escalation(
                        task_type,
                        fill_count,
                        edu_units,
                        extra_instructions_local=fill_hint,
                        preferred_provider_names_local=task_type_provider_preferences,
                    )
                    repair_subrequest_count += 1
                    if fill_provider_name and provider_name is None:
                        provider_name = fill_provider_name
                    provider_chain_attempts.extend(fill_chain_attempts)
                    fill_parsed_tasks, fill_parser, fill_parse_errors = _parse_ai_response_for_type(
                        task_type,
                        fill_raw_response or "",
                    )
                    if fill_parse_errors:
                        parsing_errors.extend([f"[iterative-repair-{fill_round}] {e}" for e in fill_parse_errors])
                    fill_preview_tasks = _build_ai_preview_tasks(task_type, fill_parsed_tasks, fill_parser, index_base_local=0)
                    _annotate_previews_source_grounding(fill_preview_tasks, edu_unit_contexts, task_type_hint_local=task_type)
                    if fill_preview_tasks:
                        preview_tasks.extend(fill_preview_tasks)
                        preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
                        if len(preview_tasks) > requested_count:
                            dropped_count = len(preview_tasks) - requested_count
                            preview_tasks = preview_tasks[:requested_count]
                            parsing_errors.append(
                                f"Overgeneration trimmed for {task_type} after iterative repair {fill_round}: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
                            )
                    new_valid_count = _valid_count(preview_tasks)
                    if new_valid_count <= previous_valid_count:
                        parsing_errors.append(
                            f"Iterative repair {fill_round} made no valid-progress for {task_type} (valid {new_valid_count}/{requested_count})."
                        )
                        break
                    previous_valid_count = new_valid_count
                except Exception as fill_exc:
                    provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                    logger.warning("[HTTP] ai/generate iterative repair-pass %s failed: %s", task_type, fill_exc)
                    parsing_errors.append(f"Iterative repair-pass failed for {task_type} (round {fill_round}): {str(fill_exc)}")
                    break

        # Iterative fill for SEQUENCE:
        # if model still under-produces valid tasks after initial repair, retry with stricter parser-aware format hints.
        if task_type == "SEQUENCE":
            max_sequence_fill_rounds = 2
            sequence_fill_round = 0
            previous_valid_count = _valid_count(preview_tasks)
            while sequence_fill_round < max_sequence_fill_rounds and previous_valid_count < requested_count:
                sequence_fill_round += 1
                repair_attempted = True
                fill_count = max(1, requested_count - previous_valid_count)
                sequence_fill_hint = (
                    f"Iterative fill repair round {sequence_fill_round}. Return exactly {fill_count} @SEQUENCE blocks and no extra blocks. "
                    "Strict parser syntax only: @SEQUENCE, one # line, at least 3 lines 'element_N: text', and one or more "
                    "lines 'level_N: element_1, element_2'. Levels must reference only declared element_N IDs. No prose or Markdown."
                )
                try:
                    seq_fill_raw_response, seq_fill_provider_name, seq_fill_chain_attempts = _generate_raw_with_parse_escalation(
                        task_type,
                        fill_count,
                        edu_units,
                        extra_instructions_local=sequence_fill_hint,
                        preferred_provider_names_local=task_type_provider_preferences,
                    )
                    repair_subrequest_count += 1
                    if seq_fill_provider_name and provider_name is None:
                        provider_name = seq_fill_provider_name
                    provider_chain_attempts.extend(seq_fill_chain_attempts)
                    seq_fill_parsed_tasks, seq_fill_parser, seq_fill_parse_errors = _parse_ai_response_for_type(
                        task_type,
                        seq_fill_raw_response or "",
                    )
                    if seq_fill_parse_errors:
                        parsing_errors.extend([f"[iterative-sequence-{sequence_fill_round}] {e}" for e in seq_fill_parse_errors])
                    seq_fill_preview_tasks = _build_ai_preview_tasks(task_type, seq_fill_parsed_tasks, seq_fill_parser, index_base_local=0)
                    _annotate_previews_source_grounding(seq_fill_preview_tasks, edu_unit_contexts, task_type_hint_local=task_type)
                    if seq_fill_preview_tasks:
                        preview_tasks.extend(seq_fill_preview_tasks)
                        preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
                        if len(preview_tasks) > requested_count:
                            dropped_count = len(preview_tasks) - requested_count
                            preview_tasks = preview_tasks[:requested_count]
                            parsing_errors.append(
                                f"Overgeneration trimmed for {task_type} after iterative repair {sequence_fill_round}: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
                            )
                    new_valid_count = _valid_count(preview_tasks)
                    if new_valid_count <= previous_valid_count:
                        parsing_errors.append(
                            f"Iterative repair {sequence_fill_round} made no valid-progress for {task_type} (valid {new_valid_count}/{requested_count})."
                        )
                        break
                    previous_valid_count = new_valid_count
                except Exception as seq_fill_exc:
                    provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                    logger.warning("[HTTP] ai/generate iterative repair-pass %s failed: %s", task_type, seq_fill_exc)
                    parsing_errors.append(f"Iterative repair-pass failed for {task_type} (round {sequence_fill_round}): {str(seq_fill_exc)}")
                    break

        # Iterative fill for TEST:
        # replace invalid/broken tests until valid-count is restored or progress stops.
        if task_type == "TEST":
            max_test_fill_rounds = 2
            test_fill_round = 0
            previous_valid_count = _valid_count(preview_tasks)
            while test_fill_round < max_test_fill_rounds and previous_valid_count < requested_count:
                test_fill_round += 1
                repair_attempted = True
                test_issue_count = _count_test_repair_issue_tasks(preview_tasks)
                fill_count = max(1, min(requested_count, max(test_issue_count, requested_count - previous_valid_count)))
                test_fill_hint = (
                    f"Iterative fill repair round {test_fill_round}. Return exactly {fill_count} @TEST blocks and no extra blocks. "
                    "Strict parser syntax only: @TEST, one # title line, one or more ? question lines, and answer lines starting with + or -. "
                    "Each question must have at least one correct (+) and at least one incorrect (-) answer, and no duplicate answer texts. "
                    "Use plausible distractors and avoid trivial duplicates."
                )
                try:
                    test_fill_raw_response, test_fill_provider_name, test_fill_chain_attempts = _generate_raw_with_parse_escalation(
                        task_type,
                        fill_count,
                        edu_units,
                        extra_instructions_local=test_fill_hint,
                        preferred_provider_names_local=task_type_provider_preferences,
                    )
                    repair_subrequest_count += 1
                    if test_fill_provider_name and provider_name is None:
                        provider_name = test_fill_provider_name
                    provider_chain_attempts.extend(test_fill_chain_attempts)
                    test_fill_parsed_tasks, test_fill_parser, test_fill_parse_errors = _parse_ai_response_for_type(
                        task_type,
                        test_fill_raw_response or "",
                    )
                    if test_fill_parse_errors:
                        parsing_errors.extend([f"[iterative-test-{test_fill_round}] {e}" for e in test_fill_parse_errors])
                    test_fill_preview_tasks = _build_ai_preview_tasks(task_type, test_fill_parsed_tasks, test_fill_parser, index_base_local=0)
                    _annotate_previews_source_grounding(test_fill_preview_tasks, edu_unit_contexts, task_type_hint_local=task_type)
                    if test_fill_preview_tasks:
                        preview_tasks.extend(test_fill_preview_tasks)
                        preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
                        if len(preview_tasks) > requested_count:
                            dropped_count = len(preview_tasks) - requested_count
                            preview_tasks = preview_tasks[:requested_count]
                            parsing_errors.append(
                                f"Overgeneration trimmed for {task_type} after iterative repair {test_fill_round}: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
                            )
                    new_valid_count = _valid_count(preview_tasks)
                    if new_valid_count <= previous_valid_count:
                        parsing_errors.append(
                            f"Iterative repair {test_fill_round} made no valid-progress for {task_type} (valid {new_valid_count}/{requested_count})."
                        )
                        break
                    previous_valid_count = new_valid_count
                except Exception as test_fill_exc:
                    provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                    logger.warning("[HTTP] ai/generate iterative repair-pass %s failed: %s", task_type, test_fill_exc)
                    parsing_errors.append(f"Iterative repair-pass failed for {task_type} (round {test_fill_round}): {str(test_fill_exc)}")
                    break

        # Cleanup layer for TEST:
        # even when requested count is met, replace remaining repairable test tasks.
        if task_type == "TEST" and len(preview_tasks) == requested_count:
            remaining_test_repairable = _count_test_repair_issue_tasks(preview_tasks)
            if remaining_test_repairable > 0:
                repair_attempted = True
                cleanup_test_count = max(1, min(requested_count, remaining_test_repairable))
                cleanup_test_hint = (
                    f"Cleanup repair mode. Return exactly {cleanup_test_count} @TEST blocks and no extra blocks. "
                    "Strict parser syntax only. Every question must include at least one + and one -, with non-empty texts and no duplicate answers. "
                    "Prioritize correctness and parser-valid structure over complexity."
                )
                try:
                    cleanup_test_raw, cleanup_test_provider, cleanup_test_chain = _generate_raw_with_parse_escalation(
                        task_type,
                        cleanup_test_count,
                        edu_units,
                        extra_instructions_local=cleanup_test_hint,
                        preferred_provider_names_local=task_type_provider_preferences,
                    )
                    repair_subrequest_count += 1
                    if cleanup_test_provider and provider_name is None:
                        provider_name = cleanup_test_provider
                    provider_chain_attempts.extend(cleanup_test_chain)
                    cleanup_test_parsed, cleanup_test_parser, cleanup_test_parse_errors = _parse_ai_response_for_type(
                        task_type,
                        cleanup_test_raw or "",
                    )
                    if cleanup_test_parse_errors:
                        parsing_errors.extend([f"[repair-pass-test-cleanup] {e}" for e in cleanup_test_parse_errors])
                    cleanup_test_previews = _build_ai_preview_tasks(task_type, cleanup_test_parsed, cleanup_test_parser, index_base_local=0)
                    _annotate_previews_source_grounding(cleanup_test_previews, edu_unit_contexts, task_type_hint_local=task_type)
                    if cleanup_test_previews:
                        preview_tasks.extend(cleanup_test_previews)
                        preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
                        if len(preview_tasks) > requested_count:
                            dropped_count = len(preview_tasks) - requested_count
                            preview_tasks = preview_tasks[:requested_count]
                            parsing_errors.append(
                                f"Overgeneration trimmed for {task_type} after cleanup repair: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
                            )
                except Exception as cleanup_test_exc:
                    provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                    logger.warning("[HTTP] ai/generate cleanup repair-pass %s failed: %s", task_type, cleanup_test_exc)
                    parsing_errors.append(f"Cleanup repair-pass failed for {task_type}: {str(cleanup_test_exc)}")

        # Cleanup layer for SEQUENCE:
        # even when requested count is met, replace parser-valid but validator-weak sequence tasks.
        if task_type == "SEQUENCE" and len(preview_tasks) == requested_count:
            remaining_sequence_repairable = _count_sequence_repair_issue_tasks(preview_tasks)
            if remaining_sequence_repairable > 0:
                repair_attempted = True
                cleanup_sequence_count = max(1, min(requested_count, remaining_sequence_repairable))
                cleanup_sequence_hint = (
                    f"Cleanup repair mode. Return exactly {cleanup_sequence_count} @SEQUENCE blocks and no extra blocks. "
                    "Strict parser syntax only: @SEQUENCE, one # line, at least 3 element_N lines, and level_N lines "
                    "using only declared element_N IDs. Use all elements in levels and avoid duplicate element IDs."
                )
                try:
                    cleanup_sequence_raw, cleanup_sequence_provider, cleanup_sequence_chain = _generate_raw_with_parse_escalation(
                        task_type,
                        cleanup_sequence_count,
                        edu_units,
                        extra_instructions_local=cleanup_sequence_hint,
                        preferred_provider_names_local=task_type_provider_preferences,
                    )
                    repair_subrequest_count += 1
                    if cleanup_sequence_provider and provider_name is None:
                        provider_name = cleanup_sequence_provider
                    provider_chain_attempts.extend(cleanup_sequence_chain)
                    cleanup_sequence_parsed, cleanup_sequence_parser, cleanup_sequence_parse_errors = _parse_ai_response_for_type(
                        task_type,
                        cleanup_sequence_raw or "",
                    )
                    if cleanup_sequence_parse_errors:
                        parsing_errors.extend([f"[repair-pass-sequence-cleanup] {e}" for e in cleanup_sequence_parse_errors])
                    cleanup_sequence_previews = _build_ai_preview_tasks(
                        task_type,
                        cleanup_sequence_parsed,
                        cleanup_sequence_parser,
                        index_base_local=0,
                    )
                    _annotate_previews_source_grounding(cleanup_sequence_previews, edu_unit_contexts, task_type_hint_local=task_type)
                    if cleanup_sequence_previews:
                        preview_tasks.extend(cleanup_sequence_previews)
                        preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
                        if len(preview_tasks) > requested_count:
                            dropped_count = len(preview_tasks) - requested_count
                            preview_tasks = preview_tasks[:requested_count]
                            parsing_errors.append(
                                f"Overgeneration trimmed for {task_type} after cleanup repair: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
                            )
                except Exception as cleanup_sequence_exc:
                    provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                    logger.warning("[HTTP] ai/generate cleanup repair-pass %s failed: %s", task_type, cleanup_sequence_exc)
                    parsing_errors.append(f"Cleanup repair-pass failed for {task_type}: {str(cleanup_sequence_exc)}")

        # Second cleanup layer for CLICK_WORDS:
        # even when the requested count is already met, try replacing remaining warning tasks.
        if task_type == "CLICK_WORDS" and len(preview_tasks) == requested_count:
            remaining_repairable = _count_click_words_repair_issue_tasks(preview_tasks)
            if remaining_repairable > 0:
                repair_attempted = True
                cleanup_repair_count = max(1, min(requested_count, remaining_repairable))
                cleanup_hint = (
                    f"Cleanup repair mode. Return exactly {cleanup_repair_count} @CLICK_WORDS blocks and no extra blocks. "
                    "Fix common parser/validator issues: use exactly 2-4 bracketed factual errors, matched [ ] only, "
                    "and wrap minimal erroneous token(s). Prioritize syntactically clean tasks over complexity."
                )
                try:
                    cleanup_raw_response, cleanup_provider_name, cleanup_chain_attempts = _generate_raw_with_parse_escalation(
                        task_type,
                        cleanup_repair_count,
                        edu_units,
                        extra_instructions_local=cleanup_hint,
                        preferred_provider_names_local=task_type_provider_preferences,
                    )
                    repair_subrequest_count += 1
                    if cleanup_provider_name and provider_name is None:
                        provider_name = cleanup_provider_name
                    provider_chain_attempts.extend(cleanup_chain_attempts)
                    cleanup_parsed_tasks, cleanup_parser, cleanup_parse_errors = _parse_ai_response_for_type(
                        task_type,
                        cleanup_raw_response or "",
                    )
                    if cleanup_parse_errors:
                        parsing_errors.extend([f"[repair-pass-2] {e}" for e in cleanup_parse_errors])
                    cleanup_previews = _build_ai_preview_tasks(task_type, cleanup_parsed_tasks, cleanup_parser, index_base_local=0)
                    _annotate_previews_source_grounding(cleanup_previews, edu_unit_contexts, task_type_hint_local=task_type)
                    preview_tasks.extend(cleanup_previews)
                    if preview_tasks:
                        preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
                    if len(preview_tasks) > requested_count:
                        dropped_count = len(preview_tasks) - requested_count
                        preview_tasks = preview_tasks[:requested_count]
                        parsing_errors.append(
                            f"Overgeneration trimmed for {task_type} after cleanup repair: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
                        )
                except Exception as cleanup_exc:
                    provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                    logger.warning("[HTTP] ai/generate cleanup repair-pass %s failed: %s", task_type, cleanup_exc)
                    parsing_errors.append(f"Cleanup repair-pass failed for {task_type}: {str(cleanup_exc)}")

        # Iterative cleanup for CLICK_WORDS warning tasks:
        # if count is already met but repairable warning-tasks remain (e.g. too many error spans),
        # keep attempting targeted replacements for a few rounds.
        if task_type == "CLICK_WORDS" and len(preview_tasks) == requested_count:
            max_click_words_cleanup_rounds = 2
            cleanup_round = 0
            previous_repairable_count = _count_click_words_repair_issue_tasks(preview_tasks)
            previous_valid_count = _valid_count(preview_tasks)
            while cleanup_round < max_click_words_cleanup_rounds and previous_repairable_count > 0:
                cleanup_round += 1
                repair_attempted = True
                iterative_cleanup_count = max(1, min(requested_count, previous_repairable_count))
                iterative_cleanup_hint = (
                    f"Iterative cleanup round {cleanup_round}. Return exactly {iterative_cleanup_count} @CLICK_WORDS blocks and no extra blocks. "
                    "Strict parser-safe syntax only. Each block must contain exactly 2-4 bracketed factual errors (never more than 4), "
                    "with matched [ ] markers and minimal erroneous token spans. Prefer short, clear tasks."
                )
                try:
                    iterative_cleanup_raw, iterative_cleanup_provider, iterative_cleanup_chain = _generate_raw_with_parse_escalation(
                        task_type,
                        iterative_cleanup_count,
                        edu_units,
                        extra_instructions_local=iterative_cleanup_hint,
                        preferred_provider_names_local=task_type_provider_preferences,
                    )
                    repair_subrequest_count += 1
                    if iterative_cleanup_provider and provider_name is None:
                        provider_name = iterative_cleanup_provider
                    provider_chain_attempts.extend(iterative_cleanup_chain)
                    iterative_cleanup_parsed, iterative_cleanup_parser, iterative_cleanup_parse_errors = _parse_ai_response_for_type(
                        task_type,
                        iterative_cleanup_raw or "",
                    )
                    if iterative_cleanup_parse_errors:
                        parsing_errors.extend([f"[repair-pass-click-words-cleanup-{cleanup_round}] {e}" for e in iterative_cleanup_parse_errors])
                    iterative_cleanup_previews = _build_ai_preview_tasks(
                        task_type,
                        iterative_cleanup_parsed,
                        iterative_cleanup_parser,
                        index_base_local=0,
                    )
                    _annotate_previews_source_grounding(iterative_cleanup_previews, edu_unit_contexts, task_type_hint_local=task_type)
                    if iterative_cleanup_previews:
                        preview_tasks.extend(iterative_cleanup_previews)
                        preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
                        if len(preview_tasks) > requested_count:
                            dropped_count = len(preview_tasks) - requested_count
                            preview_tasks = preview_tasks[:requested_count]
                            parsing_errors.append(
                                f"Overgeneration trimmed for {task_type} after iterative cleanup {cleanup_round}: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
                            )
                    new_repairable_count = _count_click_words_repair_issue_tasks(preview_tasks)
                    new_valid_count = _valid_count(preview_tasks)
                    if new_repairable_count >= previous_repairable_count and new_valid_count <= previous_valid_count:
                        parsing_errors.append(
                            f"Iterative CLICK_WORDS cleanup {cleanup_round} made no quality progress ({new_valid_count} valid, {new_repairable_count} repairable warnings)."
                        )
                        break
                    previous_repairable_count = new_repairable_count
                    previous_valid_count = new_valid_count
                except Exception as iterative_cleanup_exc:
                    provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                    logger.warning("[HTTP] ai/generate iterative cleanup %s failed: %s", task_type, iterative_cleanup_exc)
                    parsing_errors.append(
                        f"Iterative cleanup failed for {task_type} (round {cleanup_round}): {str(iterative_cleanup_exc)}"
                    )
                    break

        # Generic source-grounding cleanup:
        # when count is met but some tasks are weakly grounded in selected educational units, try replacing them.
        if len(preview_tasks) == requested_count and task_type in {"TEST", "CLICK_TEXT", "OPEN_ANSWER", "CLICK_WORDS", "SEQUENCE"}:
            weak_grounding_count = _count_weak_source_grounding_tasks(preview_tasks)
            if weak_grounding_count > 0:
                repair_attempted = True
                grounding_cleanup_count = max(1, min(requested_count, weak_grounding_count, 3))
                grounding_cleanup_hint = (
                    f"Source-grounding cleanup mode. Return exactly {grounding_cleanup_count} {('@' + task_type)} blocks and no extra blocks. "
                    "Ground every task strictly in the listed educational units and evidence snippets. "
                    "Reuse exact source anchors where applicable (numbers, dates, named categories, threshold terms) and avoid adding external details."
                )
                try:
                    grounding_cleanup_raw, grounding_cleanup_provider, grounding_cleanup_chain = _generate_raw_with_parse_escalation(
                        task_type,
                        grounding_cleanup_count,
                        edu_units,
                        extra_instructions_local=grounding_cleanup_hint,
                        preferred_provider_names_local=task_type_provider_preferences,
                    )
                    repair_subrequest_count += 1
                    if grounding_cleanup_provider and provider_name is None:
                        provider_name = grounding_cleanup_provider
                    provider_chain_attempts.extend(grounding_cleanup_chain)
                    grounding_cleanup_parsed, grounding_cleanup_parser, grounding_cleanup_parse_errors = _parse_ai_response_for_type(
                        task_type,
                        grounding_cleanup_raw or "",
                    )
                    if grounding_cleanup_parse_errors:
                        parsing_errors.extend([f"[repair-pass-grounding] {e}" for e in grounding_cleanup_parse_errors])
                    grounding_cleanup_previews = _build_ai_preview_tasks(
                        task_type,
                        grounding_cleanup_parsed,
                        grounding_cleanup_parser,
                        index_base_local=0,
                    )
                    _annotate_previews_source_grounding(grounding_cleanup_previews, edu_unit_contexts, task_type_hint_local=task_type)
                    if grounding_cleanup_previews:
                        preview_tasks.extend(grounding_cleanup_previews)
                        preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
                        if len(preview_tasks) > requested_count:
                            dropped_count = len(preview_tasks) - requested_count
                            preview_tasks = preview_tasks[:requested_count]
                            parsing_errors.append(
                                f"Overgeneration trimmed for {task_type} after grounding cleanup: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
                            )
                except Exception as grounding_cleanup_exc:
                    provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                    logger.warning("[HTTP] ai/generate source-grounding cleanup %s failed: %s", task_type, grounding_cleanup_exc)
                    parsing_errors.append(f"Source-grounding cleanup failed for {task_type}: {str(grounding_cleanup_exc)}")

        # Generic semantic-duplicate cleanup:
        # when count is met but tasks are too similar, try replacing duplicate-like tasks.
        if len(preview_tasks) == requested_count and task_type in {"TEST", "CLICK_TEXT", "OPEN_ANSWER", "CLICK_WORDS", "SEQUENCE"}:
            _annotate_previews_semantic_duplicates(preview_tasks, task_type)
            semantic_dup_count = _count_semantic_duplicate_tasks(preview_tasks)
            if semantic_dup_count > 0:
                repair_attempted = True
                semantic_cleanup_count = max(1, min(requested_count, semantic_dup_count, 3))
                semantic_cleanup_hint = (
                    f"Diversity cleanup mode. Return exactly {semantic_cleanup_count} {('@' + task_type)} blocks and no extra blocks. "
                    "Avoid semantic duplicates of each other: do not repeat the same fact, wording pattern, or identical answer logic. "
                    "Prefer different educational units and different cognitive operations (definition vs comparison vs mechanism vs rule vs numeric fact) "
                    "while staying strictly grounded in the listed educational units/evidence."
                )
                try:
                    semantic_cleanup_raw, semantic_cleanup_provider, semantic_cleanup_chain = _generate_raw_with_parse_escalation(
                        task_type,
                        semantic_cleanup_count,
                        edu_units,
                        extra_instructions_local=semantic_cleanup_hint,
                        preferred_provider_names_local=task_type_provider_preferences,
                    )
                    repair_subrequest_count += 1
                    if semantic_cleanup_provider and provider_name is None:
                        provider_name = semantic_cleanup_provider
                    provider_chain_attempts.extend(semantic_cleanup_chain)
                    semantic_cleanup_parsed, semantic_cleanup_parser, semantic_cleanup_parse_errors = _parse_ai_response_for_type(
                        task_type,
                        semantic_cleanup_raw or "",
                    )
                    if semantic_cleanup_parse_errors:
                        parsing_errors.extend([f"[repair-pass-semantic] {e}" for e in semantic_cleanup_parse_errors])
                    semantic_cleanup_previews = _build_ai_preview_tasks(
                        task_type,
                        semantic_cleanup_parsed,
                        semantic_cleanup_parser,
                        index_base_local=0,
                    )
                    _annotate_previews_source_grounding(semantic_cleanup_previews, edu_unit_contexts, task_type_hint_local=task_type)
                    if semantic_cleanup_previews:
                        preview_tasks.extend(semantic_cleanup_previews)
                        _annotate_previews_semantic_duplicates(preview_tasks, task_type)
                        preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
                        if len(preview_tasks) > requested_count:
                            dropped_count = len(preview_tasks) - requested_count
                            preview_tasks = preview_tasks[:requested_count]
                            parsing_errors.append(
                                f"Overgeneration trimmed for {task_type} after semantic cleanup: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
                            )
                except Exception as semantic_cleanup_exc:
                    provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                    logger.warning("[HTTP] ai/generate semantic cleanup %s failed: %s", task_type, semantic_cleanup_exc)
                    parsing_errors.append(f"Semantic cleanup failed for {task_type}: {str(semantic_cleanup_exc)}")

        if repair_attempted and len(preview_tasks) < requested_count:
            parsing_errors.append(
                f"Repair-pass incomplete for {task_type}: requested {requested_count}, obtained {len(preview_tasks)}."
            )

        if preview_tasks:
            _annotate_previews_semantic_duplicates(preview_tasks, task_type)
            preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
            if len(preview_tasks) > requested_count:
                preview_tasks = preview_tasks[:requested_count]

        gen_time_ms = int((time.time() - start_time) * 1000)
        _reindex_previews(preview_tasks, total_generated)

        task_count = len(preview_tasks)
        total_generated += task_count
        by_type[task_type.lower()] = task_count

        results.append({
            "task_type": task_type,
            "status": "success" if preview_tasks else "error",
            "provider_used": provider_name if preview_tasks else None,
            "provider_chain_attempts": provider_chain_attempts,
            "tasks": preview_tasks,
            "parsing_errors": parsing_errors,
            "generation_time_ms": gen_time_ms,
            "educational_unit_ids": edu_unit_ids,
            "educational_units_context": edu_unit_contexts,
            "subrequest_count": len(subrequests) + repair_subrequest_count,
            "repair_pass_attempted": repair_attempted,
            "repair_subrequest_count": repair_subrequest_count,
        })

    quality_summary = _postprocess_ai_generate_results(
        material,
        results,
        expected_output_language=output_language_pref.get("effective"),
    )

    total_generated = 0
    total_valid = 0
    total_warnings = 0
    total_errors = 0
    by_type = {}
    for result in results:
        result_task_type = str(result.get("task_type", "")).lower()
        result_tasks = result.get("tasks", []) if isinstance(result.get("tasks"), list) else []
        if result_task_type:
            by_type[result_task_type] = by_type.get(result_task_type, 0) + len(result_tasks)
        total_generated += len(result_tasks)
        if result.get("status") == "error" and not result_tasks:
            total_errors += 1
        for t in result_tasks:
            status = t.get("status", "valid")
            if status == "error":
                total_errors += 1
            elif status == "warning":
                total_warnings += 1
            else:
                total_valid += 1

    response = {
        "ok": True,
        "ai_run_id": ai_run_id,
        "material_language": material_language,
        "output_language_mode": output_language_pref.get("mode"),
        "requested_output_language": output_language_pref.get("requested"),
        "effective_output_language": output_language_pref.get("effective"),
        "output_language_warning": output_language_pref.get("translation_warning"),
        "results": results,
        "provider_chain_attempts": [
            attempt
            for r in results
            if isinstance(r, dict)
            for attempt in (r.get("provider_chain_attempts") or [])
        ],
        "summary": {
            "total_generated": total_generated,
            "total_valid": total_valid,
            "total_warnings": total_warnings,
            "total_errors": total_errors,
            "by_type": by_type,
            "quality": quality_summary,
        },
        "parsing_errors": [],
    }

    try:
        active_provider = getattr(_ai_service, "_active_provider", None)
        provider_model = getattr(active_provider, "model", None) if active_provider else None
        _ai_run_merge_manifest(
            ai_run_id,
            {
                "phase": "generated",
                "provider_model": provider_model,
                "material_language": material_language,
                "output_language_mode": output_language_pref.get("mode"),
                "requested_output_language": output_language_pref.get("requested"),
                "effective_output_language": output_language_pref.get("effective"),
                "generation_summary": response.get("summary"),
            },
        )
        _ai_run_write_artifact(
            ai_run_id,
            "generation",
            {
                "run_id": ai_run_id,
                "created_at": _utc_now_iso(),
                "provider_model": provider_model,
                "material_stats": {
                    "word_count": len(material.split()),
                    "char_count": len(material),
                    "language": material_language,
                },
                "language_preferences": output_language_pref,
                "request": {
                    "tasks_to_generate": [
                        {
                            "task_type": spec.get("task_type"),
                            "count": spec.get("count"),
                            "educational_unit_ids": [
                                u.get("id")
                                for u in (spec.get("educational_units") or [])
                                if isinstance(u, dict)
                            ],
                        }
                        for spec in tasks_to_generate
                        if isinstance(spec, dict)
                    ],
                },
                "summary": response.get("summary"),
                "results": [
                    {
                        "task_type": r.get("task_type"),
                        "status": r.get("status"),
                        "provider_used": r.get("provider_used"),
                        "provider_chain_attempts": r.get("provider_chain_attempts") or [],
                        "educational_unit_ids": r.get("educational_unit_ids") or [],
                        "educational_units_context": r.get("educational_units_context") or [],
                        "generation_time_ms": r.get("generation_time_ms"),
                        "parsing_errors": r.get("parsing_errors") or [],
                        "tasks": [
                            {
                                "name": t.get("name"),
                                "type": t.get("type"),
                                "status": t.get("status"),
                                "hash": _stable_json_hash(_extract_task_preview_signature(t)),
                                "validation_issues": t.get("validation_issues") or [],
                                "ai_meta": t.get("ai_meta") if isinstance(t.get("ai_meta"), dict) else None,
                            }
                            for t in (r.get("tasks") or [])
                            if isinstance(t, dict)
                        ],
                    }
                    for r in results
                    if isinstance(r, dict)
                ],
            },
        )
    except Exception:
        logger.exception("[HTTP] Failed to persist ai-run generation artifact: %s", ai_run_id)

    logger.info(
        "[HTTP] ai/generate: total=%d valid=%d warnings=%d errors=%d types=%s",
        total_generated, total_valid, total_warnings, total_errors,
        list(by_type.keys()),
    )

    return jsonify(response)
