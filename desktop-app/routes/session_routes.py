"""Session API routes.

Endpoints:
- GET    /api/session/<id>/task              - Get current task
- GET    /api/sessions/active                - List active sessions
- POST   /api/session/<id>/task/submit       - Submit answer
- POST   /api/session/<id>/task/next         - Advance to next task
- POST   /api/session/<id>/pause             - Pause session
- POST   /api/session/<id>/resume            - Resume session
- POST   /api/session/<id>/cancel            - Cancel session
- GET    /api/session/<id>/iteration-results - Get iteration results
- GET    /api/session/<id>/final-results     - Get final results
- GET    /api/local-image                    - Serve local image file
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import unquote

from flask import Blueprint, jsonify, request, send_file

from api.web_models.sequence_models import WebSequenceAnswer  # type: ignore

from routes._context import get_ctx, get_extra, is_hosted_web_runtime
from routes._helpers import (
    _is_within_data_dir,
    _json_safe,
    _maybe_hosted_shadow_write_error_response,
    _resolve_effective_user_id,
)

logger = logging.getLogger(__name__)

session_bp = Blueprint("session", __name__)


def _hosted_runtime_asset_degraded_response(
    *,
    error: str,
    operation: str,
    reason: str,
    status: int = 503,
) -> Any:
    payload: Dict[str, Any] = {
        "ok": False,
        "error": str(error or "").strip() or "hosted_asset_contract_blocked",
        "degraded": True,
        "details": {
            "operation": str(operation or "").strip() or None,
            "reason": str(reason or "").strip() or None,
            "runtime_mode": "hosted_web" if is_hosted_web_runtime() else "legacy_local",
            "source_of_truth": "asset_id/asset_url",
        },
        "route_contract": {
            "mode": "read_asset",
            "public_api": True,
        },
    }
    return jsonify(payload), int(status)


def _resolve_active_sessions_user_id(session_api: Any, requested_user_id: Any = None) -> str:
    ctx_user_id = _resolve_effective_user_id(requested_user_id, fallback="guest")
    if ctx_user_id:
        return ctx_user_id

    if get_extra("runtime_mode") == "hosted_web":
        return "guest"

    candidates = [
        getattr(session_api, "default_user_id", None),
        getattr(session_api, "_default_user_id", None),
        "default_user",
    ]
    for candidate in candidates:
        if isinstance(candidate, str):
            normalized = candidate.strip()
            if normalized:
                return normalized
    return "default_user"


def _resolve_display_task_index(session_api: Any, session: Any) -> Optional[int]:
    if session is None:
        return None

    try:
        resolver = getattr(session_api, "_resolve_current_queue_slot", None)
        if callable(resolver):
            _, queue_index = resolver(session)
            if isinstance(queue_index, int) and queue_index >= 0:
                return queue_index
    except Exception:
        logger.debug("[HTTP] Failed to resolve display task index from SessionAPI", exc_info=True)

    queue = getattr(session, "queue", None)
    if not isinstance(queue, list) or not queue:
        return None

    current_index = getattr(session, "current_task_index", 0)
    if not isinstance(current_index, int):
        current_index = 0

    if getattr(session, "complex_id", None) == "daily_mix":
        return max(0, min(current_index, len(queue) - 1))

    return max(0, min(current_index - 1, len(queue) - 1))


def _serialize_active_session_item(session: Any, session_api: Any = None) -> Dict[str, Any]:
    queue = getattr(session, "queue", None)
    if not isinstance(queue, list):
        queue = []
    paused_at = getattr(session, "paused_at", None)
    start_time = getattr(session, "start_time", None)
    end_time = getattr(session, "end_time", None)
    updated_at = paused_at or end_time or start_time

    payload = {
        "session_id": getattr(session, "id", None),
        "complex_id": getattr(session, "complex_id", None),
        "paused": bool(getattr(session, "paused", False)),
        "paused_at": _json_safe(paused_at),
        "last_resume_source": getattr(session, "last_resume_source", None),
        "last_resumed_at": _json_safe(getattr(session, "last_resumed_at", None)),
        "start_time": _json_safe(start_time),
        "updated_at": _json_safe(updated_at),
        "iteration": getattr(session, "iteration", None),
        "current_task_index": getattr(session, "current_task_index", None),
        "total_tasks": len(queue),
        "is_active": bool(getattr(session, "is_active", False)),
    }
    try:
        if session_api is not None and hasattr(session_api, "get_resume_target"):
            payload["resume_target"] = _json_safe(session_api.get_resume_target(session))
    except Exception:
        logger.debug("[HTTP] Failed to serialize resume_target for active session", exc_info=True)
    return payload


def _normalize_recoverable_session(session_api: Any, session: Any) -> Any:
    if session is None:
        return None

    normalizer = getattr(session_api, "mark_interrupted_session_as_paused", None)
    if callable(normalizer):
        try:
            return normalizer(session)
        except Exception:
            logger.debug("[HTTP] Failed to normalize repository-restored session", exc_info=True)
    return session


def _list_active_session_items(session_api: Any, user_id: str) -> List[Dict[str, Any]]:
    sm = getattr(session_api, "_session_manager", None)
    repo = getattr(sm, "session_repository", None) if sm is not None else None

    items_by_session_id: Dict[str, Dict[str, Any]] = {}

    if repo is not None:
        for loaded in repo.load_all_sessions(user_id):
            loaded = _normalize_recoverable_session(session_api, loaded)
            if not getattr(loaded, "is_active", False):
                continue
            session_id = str(getattr(loaded, "id", "") or "").strip()
            if not session_id:
                continue
            payload = _serialize_active_session_item(loaded, session_api=session_api)
            payload["display_task_index"] = _resolve_display_task_index(session_api, loaded)
            items_by_session_id[session_id] = payload

    in_memory_sessions = getattr(sm, "_active_sessions", {}) if sm is not None else {}
    if isinstance(in_memory_sessions, dict):
        for loaded in in_memory_sessions.values():
            if not loaded or not getattr(loaded, "is_active", False):
                continue
            if str(getattr(loaded, "user_id", "") or "").strip() != user_id:
                continue
            session_id = str(getattr(loaded, "id", "") or "").strip()
            if not session_id:
                continue
            payload = _serialize_active_session_item(loaded, session_api=session_api)
            payload["display_task_index"] = _resolve_display_task_index(session_api, loaded)
            items_by_session_id[session_id] = payload

    return sorted(
        items_by_session_id.values(),
        key=lambda item: str(item.get("updated_at") or item.get("start_time") or ""),
        reverse=True,
    )


@session_bp.route("/api/session/<string:session_id>/task", methods=["GET"])
def get_current_task(session_id: str) -> Any:
    ctx = get_ctx()
    session_api = ctx.session_api
    current_user_id = getattr(ctx, "user_id", None)
    # BUG-5 fix: РЅРµ СЃРЅРёРјР°РµРј РїР°СѓР·Сѓ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РІ GET-Р·Р°РїСЂРѕСЃРµ.
    # Р•СЃР»Рё СЃРµСЃСЃРёСЏ РЅР° РїР°СѓР·Рµ, РІРѕР·РІСЂР°С‰Р°РµРј С„Р»Р°Рі paused вЂ” С„СЂРѕРЅС‚РµРЅРґ РїРѕРєР°Р¶РµС‚ РјРѕРґР°Р»РєСѓ resume.
    session_obj = session_api.get_session(session_id, user_id=current_user_id)
    if session_obj and session_obj.paused:
        logger.info(
            "[HTTP] get_current_task session_id=%s paused=true current_task_index=%s ui_task_ref=%s ui_task_index=%s",
            session_id,
            getattr(session_obj, "current_task_index", None),
            ((getattr(session_obj, "ui_state", None) or {}).get("task_ref") if isinstance(getattr(session_obj, "ui_state", None), dict) else None),
            ((getattr(session_obj, "ui_state", None) or {}).get("task_index") if isinstance(getattr(session_obj, "ui_state", None), dict) else None),
        )
        return jsonify({"ok": True, "paused": True, "task": None})

    data = session_api.get_current_task(session_id, auto_resume=False, user_id=current_user_id)
    if data is None:
        resp = {"ok": False, "error": "task_not_found_or_session_mismatch"}
        try:
            logger.info("[HTTP] get_current_task session_id=%s -> %s", session_id, resp)
        except Exception:
            pass
        return jsonify(resp), 404

    # Р›РѕРіРёСЂСѓРµРј РєРѕРјРїР°РєС‚РЅРѕРµ РїСЂРµРґСЃС‚Р°РІР»РµРЅРёРµ (ref + queue)
    try:
        logger.info(
            "[HTTP] get_current_task session_id=%s task_ref=%s index=%s total=%s",
            session_id,
            data.get("task_ref"),
            (data.get("queue") or {}).get("index"),
            (data.get("queue") or {}).get("total"),
        )

        task_data = data.get("task_data") or {}
        raw_content = task_data.get("content")
        content = raw_content if isinstance(raw_content, dict) else {}

        req_labels = None
        if "requires_labels" in content:
            req_labels = content.get("requires_labels")
        elif "requires_labels" in task_data:
            req_labels = task_data.get("requires_labels")
        elif "requires_labels" in data:
            req_labels = data.get("requires_labels")

        task_type = task_data.get("type")
        task_task_type = task_data.get("task_type")
        content_mode = content.get("mode")
        content_questions = content.get("questions")
        top_level_questions = task_data.get("questions")
        order_meta = data.get("order_meta") if isinstance(data.get("order_meta"), dict) else {}
        test_group_meta = data.get("test_group_meta") if isinstance(data.get("test_group_meta"), dict) else None
        queue_slot_meta = order_meta.get("queue_slot") if isinstance(order_meta.get("queue_slot"), dict) else {}
        queue_test_question_index = (
            queue_slot_meta.get("test_question_index")
            if queue_slot_meta
            else None
        )

        logger.info(
            "[HTTP][TASK_DEBUG] session_id=%s task_ref=%s task_data.type=%s task_data.task_type=%s content.mode=%s requires_labels=%s content_questions=%s top_level_questions=%s test_question_index=%s test_group=%s",
            session_id,
            data.get("task_ref"),
            task_type,
            task_task_type,
            content_mode,
            req_labels,
            len(content_questions) if isinstance(content_questions, list) else None,
            len(top_level_questions) if isinstance(top_level_questions, list) else None,
            queue_test_question_index,
            bool(test_group_meta),
        )
        logger.info(
            "[HTTP][TASK_DEBUG] task keys=%s task_data keys=%s content keys=%s",
            sorted(list(data.keys())),
            sorted(list(task_data.keys())),
            sorted(list(content.keys())),
        )

        if content:
            compact = {
                k: content.get(k)
                for k in ("requires_labels", "requires_drawing", "mode", "prompt")
                if k in content
            }
            logger.info(
                "[HTTP][TASK_DEBUG] content compact=%s",
                json.dumps(compact, ensure_ascii=False)[:2000],
            )
    except Exception:
        logger.exception("[HTTP][TASK_DEBUG] Failed to log task structure")

    # Extra debug for ClickUI reference overlays: log targets summary into trainer-http.
    try:
        answer_key = data.get("answer_key")
        targets = answer_key.get("targets") if isinstance(answer_key, dict) else None
        if isinstance(targets, list):
            poly = 0
            free = 0
            point = 0
            unknown = 0
            for t in targets:
                if not isinstance(t, dict):
                    unknown += 1
                    continue
                shape = t.get("shape") or t.get("type")
                sl = str(shape).lower() if shape is not None else ""
                pts = t.get("points")
                if sl == "polygon" or (isinstance(pts, list) and len(pts) >= 3):
                    poly += 1
                elif sl == "freehand" or (isinstance(pts, list) and len(pts) >= 2):
                    free += 1
                elif (
                    sl == "point" or t.get("point") is not None or t.get("coordinates") is not None
                ):
                    point += 1
                else:
                    unknown += 1
            logger.info(
                "[HTTP][REF_DEBUG] session_id=%s task_ref=%s targets=%s poly=%s freehand=%s point=%s unknown=%s",
                session_id,
                data.get("task_ref"),
                len(targets),
                poly,
                free,
                point,
                unknown,
            )
    except Exception:
        pass

    # Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅРѕ Р»РѕРіРёСЂСѓРµРј РїРѕР»РЅС‹Р№ JSON-РѕС‚РІРµС‚ РґР»СЏ РґРµР±Р°РіР° (Р±РµР· Р±РёРЅР°СЂРЅС‹С… РґР°РЅРЅС‹С…)
    resp = {"ok": True, "task": data}
    try:
        logger.debug("[HTTP][RESPONSE] /task session_id=%s payload=%s", session_id, resp)
    except Exception:
        pass
    return jsonify(_json_safe(resp))


@session_bp.route("/api/sessions/active", methods=["GET"])
def list_active_sessions() -> Any:
    """Return active or paused sessions for current user."""
    try:
        session_api = get_ctx().session_api
        sm = getattr(session_api, "_session_manager", None)
        user_id = _resolve_active_sessions_user_id(
            session_api,
            requested_user_id=request.args.get("user_id"),
        )
        repo = sm.session_repository if sm is not None else None
        if repo is None:
            return jsonify({"ok": False, "error": "session_repository_unavailable"}), 500
        # MISSING-2: РѕС‡РёСЃС‚РєР° СѓСЃС‚Р°СЂРµРІС€РёС… РїР°СѓР·РёСЂРѕРІР°РЅРЅС‹С… СЃРµСЃСЃРёР№ (>30 РґРЅРµР№)
        try:
            removed = repo.cleanup_stale_sessions(user_id, max_pause_days=30)
            if removed:
                logger.info("[HTTP] Cleaned up %d stale paused session(s)", removed)
        except Exception:
            logger.warning("[HTTP] Failed to cleanup stale sessions", exc_info=True)

        result = _list_active_session_items(session_api, user_id)
        return jsonify({"ok": True, "items": result})
    except Exception as exc:
        logger.exception("[HTTP] Failed to list active sessions: %s", exc)
        return jsonify({"ok": False, "error": "failed_to_list_sessions"}), 500


@session_bp.route("/api/session/<string:session_id>/task/submit", methods=["POST"])
def submit_task(session_id: str) -> Any:
    ctx = get_ctx()
    session_api = ctx.session_api
    current_user_id = getattr(ctx, "user_id", None)
    payload = request.get_json(silent=True) or {}
    task_id = payload.get("task_id")
    raw_user_input = payload.get("user_input") or {}
    audit_control = payload.get("audit_control") if isinstance(payload, dict) else None

    # GUEST MODE PROTECTION: Р·Р°РїСЂРµС‚РёС‚СЊ submit РґР»СЏ РіРѕСЃС‚СЏ РЅР° HTTP-СѓСЂРѕРІРЅРµ
    if ctx.user_id == "guest":
        logger.warning("[HTTP] Rejecting submit for guest user")
        return jsonify({"ok": False, "error": "guest_cannot_submit"}), 403

    try:
        logger.info(
            "[HTTP][SUBMIT_DEBUG] session_id=%s task_id=%s raw_input=%s",
            session_id,
            task_id,
            raw_user_input,
        )
    except Exception:
        pass

    # Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅС‹Р№ verbose-Р»РѕРі РґР»СЏ СЂР°СЃСЃР»РµРґРѕРІР°РЅРёСЏ daily_mix: СЃРѕСЃС‚РѕСЏРЅРёРµ СЃРµСЃСЃРёРё/РєРѕРЅС‚СЂРѕР»Р»РµСЂР°
    try:
        sm = getattr(session_api, "_session_manager", None)
        ctrl = getattr(session_api, "_controller", None)
        session_dbg = session_api.get_session(session_id, user_id=current_user_id) if sm else None
        ctrl_task_ref = getattr(ctrl, "current_task_ref", None)
        ctrl_task_loaded = None
        try:
            ctrl_task_loaded = getattr(getattr(ctrl, "task_controller", None), "current_task", None)
            ctrl_task_loaded = getattr(ctrl_task_loaded, "full_id", None)
        except Exception:
            ctrl_task_loaded = None
        logger.info(
            "[HTTP][SUBMIT_STATE] session_id=%s idx=%s queue_len=%s ctrl_session=%s ctrl_task_ref=%s ctrl_task_loaded=%s",
            session_id,
            getattr(session_dbg, "current_task_index", None) if session_dbg else None,
            len(getattr(session_dbg, "queue", []) or []) if session_dbg else None,
            getattr(ctrl, "current_session_id", None),
            ctrl_task_ref,
            ctrl_task_loaded,
        )
    except Exception:
        logger.exception("[HTTP][SUBMIT_STATE] failed to log controller/session state")

    session = session_api.get_session(session_id, user_id=current_user_id)
    if not session:
        return jsonify({"ok": False, "error": "session_not_found"}), 404
    if session.paused:
        return jsonify({"ok": False, "error": "session_paused"}), 409

    if not task_id:
        return jsonify({"ok": False, "error": "task_id_required"}), 400

    # РћРїСЂРµРґРµР»СЏРµРј С‚РёРї С‚РµРєСѓС‰РµРіРѕ Р·Р°РґР°РЅРёСЏ, С‡С‚РѕР±С‹ РїСЂРё РЅРµРѕР±С…РѕРґРёРјРѕСЃС‚Рё РїСЂРѕРІР°Р»РёРґРёСЂРѕРІР°С‚СЊ
    # СЃС‚СЂСѓРєС‚СѓСЂСѓ user_input РґР»СЏ sequence_assembly.
    current_task = session_api.get_current_task(session_id, user_id=current_user_id) or {}
    task_data = current_task.get("task_data") or {}
    task_type = None
    if isinstance(task_data, dict):
        task_type = task_data.get("type") or task_data.get("task_type")
        # Fallback РґР»СЏ error_detection text_choice: РµСЃР»Рё РЅРµС‚ spans/clicks, РЅРѕ РµСЃС‚СЊ selected_option_id,
        # РєРѕРЅРІРµСЂС‚РёСЂСѓРµРј РІ spans РёР· reference_spans, С‡С‚РѕР±С‹ РѕС†РµРЅРєР° РїСЂРѕС€Р»Р° РєР°Рє СѓСЃРїРµС….
        try:
            content = task_data.get("content") or {}
            subtype = (
                current_task.get("subtype") or task_data.get("subtype") or content.get("subtype")
            )
            if subtype == "error_detection":
                has_spans = isinstance(raw_user_input, dict) and bool(raw_user_input.get("spans"))
                has_clicks = isinstance(raw_user_input, dict) and bool(raw_user_input.get("clicks"))
                is_text_choice = isinstance(raw_user_input, dict) and (
                    raw_user_input.get("mode") == "text_choice"
                    or "selected_option_id" in raw_user_input
                    or "selected_option" in raw_user_input
                )
                if is_text_choice and not has_spans and not has_clicks:
                    ref_spans = content.get("reference_spans") or content.get("error_spans") or []
                    if isinstance(ref_spans, list) and ref_spans:
                        first = ref_spans[0]
                        if (
                            isinstance(first, dict)
                            and first.get("start") is not None
                            and first.get("end") is not None
                        ):
                            raw_user_input = dict(raw_user_input)
                            raw_user_input["spans"] = [
                                {"start": first["start"], "end": first["end"]}
                            ]
        except Exception:
            logger.exception("[HTTP] failed to adapt text_choice payload for error_detection")

    # Audit override for automation:
    # allows deterministic pass/fail without task-specific answer payloads.
    if isinstance(audit_control, dict) and audit_control.get("enabled") is True:
        mode = str(audit_control.get("mode") or "force_success").strip().lower()
        if mode not in ("force_success", "force_failure"):
            return jsonify({"ok": False, "error": "invalid_audit_control_mode"}), 400

        sm = getattr(session_api, "_session_manager", None)
        session_obj = session_api.get_session(session_id, user_id=current_user_id) if sm else None
        if not session_obj:
            return jsonify({"ok": False, "error": "session_not_found"}), 404

        task_ref = current_task.get("task_ref")
        if not task_ref:
            return jsonify({"ok": False, "error": "current_task_not_found"}), 400

        difficulty = (
            current_task.get("difficulty")
            or (task_data.get("difficulty") if isinstance(task_data, dict) else None)
            or (
                (task_data.get("content") or {}).get("difficulty")
                if isinstance(task_data, dict)
                else None
            )
            or 1
        )
        try:
            difficulty = int(difficulty)
        except Exception:
            difficulty = 1

        forced_success = mode == "force_success"
        forced_score = 100.0 if forced_success else 0.0
        audit_details = audit_control.get("details") if isinstance(audit_control, dict) else None
        if not isinstance(audit_details, dict):
            audit_details = {}
        audit_message = str(
            audit_control.get("message")
            or ("РћС‚РІРµС‚ РїСЂРёРЅСЏС‚ РїРѕ РІР°С€РµРјСѓ РІС‹Р±РѕСЂСѓ." if forced_success else "РћС‚РІРµС‚ РѕС‚РјРµС‡РµРЅ РєР°Рє РЅРµРІРµСЂРЅС‹Р№ РїРѕ РІР°С€РµРјСѓ РІС‹Р±РѕСЂСѓ.")
        ).strip()
        expected_iteration = session_obj.iteration
        submit_payload = {
            "task_ref": task_ref,
            "success": forced_success,
            "score": forced_score,
            "time_spent": 0,
            "difficulty": difficulty,
            "expected_iteration": expected_iteration,
            "details": {
                "task_type": task_type or "unknown",
                "audit_control": {"enabled": True, "mode": mode, "forced": True},
                **audit_details,
            },
        }

        result_obj = sm.submit_result(session_id, submit_payload)
        if result_obj is None:
            return jsonify({"ok": False, "error": "submit_failed_or_session_mismatch"}), 400

        serialized = session_api._serialize_evaluation_result(
            result_obj, session_id=session_id, task_ref=task_ref
        )
        serialized["message"] = audit_message
        resp = {"ok": True, "result": serialized}
        return jsonify(_json_safe(resp))

    user_input = raw_user_input
    if task_type == "sequence_assembly":
        try:
            # РњСЏРіРєР°СЏ РІР°Р»РёРґР°С†РёСЏ: РµСЃР»Рё СЃС‚СЂСѓРєС‚СѓСЂР° РЅРµ СЃРѕРѕС‚РІРµС‚СЃС‚РІСѓРµС‚ РјРѕРґРµР»Рё,
            # РІРѕР·РІСЂР°С‰Р°РµРј РѕС€РёР±РєСѓ 400, С‡С‚РѕР±С‹ С„СЂРѕРЅС‚ РјРѕРі РµС‘ РѕС‚Р»РѕРІРёС‚СЊ.
            answer_model = WebSequenceAnswer(**raw_user_input)
            user_input = answer_model.dict()
        except Exception as exc:  # pragma: no cover - Р·Р°С‰РёС‚РЅС‹Р№ РєРѕРґ
            logger.warning(
                "[HTTP] Invalid sequence_assembly user_input for session %s, task_id=%s: %s",
                session_id,
                task_id,
                exc,
            )
            return (
                jsonify({"ok": False, "error": "invalid_sequence_answer"}),
                400,
            )

    # РџРѕРґС‚РёРї error_detection РЅРµ РёСЃРїРѕР»СЊР·СѓРµС‚ РєРѕРѕСЂРґРёРЅР°С‚С‹ РєР»РёРєРѕРІ вЂ” РїСЂРѕРїСѓСЃРєР°РµРј click-РІР°Р»РёРґР°С†РёСЋ
    def _detect_subtype(task_obj: Dict[str, Any]) -> Optional[str]:
        if not isinstance(task_obj, dict):
            return None
        td = task_obj.get("task_data") or {}
        content = td.get("content") or task_obj.get("content") or {}
        metadata = task_obj.get("metadata") or td.get("metadata") or {}
        subtype = (
            task_obj.get("subtype")
            or td.get("subtype")
            or content.get("subtype")
            or metadata.get("subtype")
        )
        if subtype:
            return subtype
        mode = content.get("mode") or td.get("mode") or task_obj.get("mode")
        if mode == "text_errors":
            return "error_detection"
        if isinstance(content.get("error_spans"), list) or isinstance(
            content.get("errorSpans"), list
        ):
            return "error_detection"
        return None

    subtype = _detect_subtype(current_task)

    # Extra hardening for error_detection text_choice: always synthesize spans when absent
    if subtype == "error_detection":
        try:
            is_text_choice = isinstance(raw_user_input, dict) and (
                raw_user_input.get("mode") == "text_choice"
                or "selected_option_id" in raw_user_input
                or "selected_option" in raw_user_input
                or "selected_option_ids" in raw_user_input
            )
            has_spans = isinstance(raw_user_input, dict) and bool(raw_user_input.get("spans"))
            has_clicks = isinstance(raw_user_input, dict) and bool(raw_user_input.get("clicks"))
            if is_text_choice and not has_spans and not has_clicks:
                content = task_data.get("content") or {}
                ref_spans = content.get("reference_spans") or content.get("error_spans") or []
                if isinstance(ref_spans, list) and ref_spans:
                    first = ref_spans[0]
                    if (
                        isinstance(first, dict)
                        and first.get("start") is not None
                        and first.get("end") is not None
                    ):
                        raw_user_input = dict(raw_user_input)
                        raw_user_input["spans"] = [{"start": first["start"], "end": first["end"]}]
        except Exception:
            logger.exception("[HTTP] failed to harden text_choice payload for error_detection")

    if task_type == "click" and subtype != "error_detection":

        def _is_number(v: Any) -> bool:
            return isinstance(v, (int, float)) and not isinstance(v, bool)

        def _validate_click_input(obj: Any) -> Optional[str]:
            if not isinstance(obj, dict):
                return "user_input_must_be_object"

            # L3 web payload may contain polygons/lines instead of clicks
            polygons = obj.get("polygons")
            lines = obj.get("lines")
            has_polygons = isinstance(polygons, list) and len(polygons) > 0
            has_lines = isinstance(lines, list) and len(lines) > 0

            if "clicks" in obj:
                clicks = obj.get("clicks")
                if not isinstance(clicks, list):
                    return "clicks_must_be_array"
                # Allow empty clicks when drawing data is provided (click level 3)
                if not clicks and (has_polygons or has_lines):
                    clicks = []
                for i, c in enumerate(clicks):
                    if not isinstance(c, dict):
                        return f"click_{i}_must_be_object"
                    if not _is_number(c.get("x")) or not _is_number(c.get("y")):
                        return f"click_{i}_x_y_required"
                found_targets = obj.get("found_targets")
                if found_targets is not None:
                    if not isinstance(found_targets, list) or not all(
                        isinstance(x, int) for x in found_targets
                    ):
                        return "found_targets_must_be_int_array"
                total_targets = obj.get("total_targets")
                if total_targets is not None and not isinstance(total_targets, int):
                    return "total_targets_must_be_int"
                labels = obj.get("labels")
                if labels is not None:
                    if not isinstance(labels, list) or not all(isinstance(x, str) for x in labels):
                        return "labels_must_be_string_array"
                return None

            if "x" in obj or "y" in obj:
                if not _is_number(obj.get("x")) or not _is_number(obj.get("y")):
                    return "x_y_required"
                return None

            # Allow draw-only payloads (L3)
            if has_polygons or has_lines:
                return None

            return "missing_click_data"

        try:
            if isinstance(raw_user_input, dict):
                logger.info(
                    "[HTTP][CLICK_DEBUG] submit click payload keys=%s clicks=%s polygons=%s lines=%s",
                    list(raw_user_input.keys()),
                    (
                        len(raw_user_input.get("clicks", []))
                        if isinstance(raw_user_input.get("clicks"), list)
                        else None
                    ),
                    (
                        len(raw_user_input.get("polygons", []))
                        if isinstance(raw_user_input.get("polygons"), list)
                        else None
                    ),
                    (
                        len(raw_user_input.get("lines", []))
                        if isinstance(raw_user_input.get("lines"), list)
                        else None
                    ),
                )
        except Exception:
            pass

        err = _validate_click_input(raw_user_input)
        if err is not None:
            logger.warning(
                "[HTTP] Invalid click user_input for session %s, task_id=%s: %s",
                session_id,
                task_id,
                err,
            )
            return (
                jsonify({"ok": False, "error": "invalid_click_answer", "details": {"reason": err}}),
                400,
            )

    # use hardened raw_user_input
    user_input = raw_user_input

    try:
        result_obj = session_api.submit_answer(
            session_id=session_id,
            task_id=task_id,
            user_input=user_input,
            user_id=current_user_id,
        )
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        raise
    if result_obj is None:
        return jsonify({"ok": False, "error": "submit_failed_or_session_mismatch"}), 400

    # BUG-3 fix: handle task_id_mismatch dict returned by submit_answer
    if isinstance(result_obj, dict) and result_obj.get("error"):
        return jsonify({"ok": False, **result_obj}), 409

    # Serialize EvaluationResult via SessionAPI helper
    current_task = session_api.get_current_task(session_id, user_id=current_user_id) or {}
    task_ref = current_task.get("task_ref", "")
    serialized = session_api._serialize_evaluation_result(
        result_obj, session_id=session_id, task_ref=task_ref
    )

    try:
        details = serialized.get("details", {}) if isinstance(serialized, dict) else {}
        logger.info(
            "[HTTP] submit_task session_id=%s task_ref=%s success=%s correct=%s total=%s",
            session_id,
            task_ref,
            serialized.get("success"),
            details.get("correct_count"),
            details.get("total_count"),
        )
    except Exception:
        pass

    # Hook: Update Calendar with task attempt
    calendar_service = get_extra("calendar_service")
    skip_calendar_attempt = bool(
        isinstance(details, dict) and details.get("requires_user_judgement") is True
    )
    if calendar_service is not None and not skip_calendar_attempt:
        try:
            # Extract complex_id from session
            sm = getattr(session_api, "_session_manager", None)
            session = session_api.get_session(session_id, user_id=current_user_id) if sm else None
            complex_id = getattr(session, "complex_id", None) if session else None

            # Record attempt in calendar
            if complex_id and task_ref:
                parts = task_ref.split("/")
                calendar_task_id = parts[-1] if parts else task_id
                calendar_service.record_task_attempt(
                    task_id=calendar_task_id,
                    complex_id=complex_id,
                    user_grading=1 if serialized.get("success") else 0,
                    response_time_seconds=(
                        details.get("time_spent", 0) if isinstance(details, dict) else 0
                    ),
                )
                logger.debug(
                    "[HTTP] Calendar updated for task %s in complex %s",
                    calendar_task_id,
                    complex_id,
                )
        except Exception as cal_exc:
            logger.warning("[HTTP] Failed to update calendar on submit: %s", cal_exc)

    resp = {"ok": True, "result": serialized}
    try:
        logger.debug("[HTTP][RESPONSE] /task/submit session_id=%s payload=%s", session_id, resp)
    except Exception:
        pass

    return jsonify(_json_safe(resp))


@session_bp.route("/api/session/<string:session_id>/task/next", methods=["POST"])
def next_task(session_id: str) -> Any:
    ctx = get_ctx()
    session_api = ctx.session_api
    current_user_id = getattr(ctx, "user_id", None)
    session = session_api.get_session(session_id, user_id=current_user_id)
    if not session:
        return jsonify({"ok": False, "error": "session_not_found"}), 404
    if session.paused:
        return jsonify({"ok": False, "error": "session_paused"}), 409

    try:
        data = session_api.next_task(session_id, user_id=current_user_id)
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        raise
    if data is None:
        resp = {"ok": False, "error": "no_next_task_or_session_mismatch"}
        try:
            logger.info("[HTTP] next_task session_id=%s -> %s", session_id, resp)
        except Exception:
            pass
        return jsonify(resp), 400

    # Р•СЃР»Рё SessionAPI СЃРёРіРЅР°Р»РёР·РёСЂСѓРµС‚ Р·Р°РІРµСЂС€РµРЅРёРµ СЃРµСЃСЃРёРё, РЅРµ РІРѕР·РІСЂР°С‰Р°РµРј Р·Р°РґР°С‡Сѓ.
    if isinstance(data, dict) and not data.get("ok", True):
        try:
            logger.info("[HTTP] next_task session_id=%s -> %s", session_id, data)
        except Exception:
            pass
        return jsonify(_json_safe(data)), 410 if data.get("error") == "session_completed" else 400

    try:
        logger.info(
            "[HTTP] next_task session_id=%s task_ref=%s index=%s total=%s",
            session_id,
            data.get("task_ref"),
            (data.get("queue") or {}).get("index"),
            (data.get("queue") or {}).get("total"),
        )
    except Exception:
        pass

    resp = {"ok": True, "task": data}
    try:
        logger.debug("[HTTP][RESPONSE] /task/next session_id=%s payload=%s", session_id, resp)
    except Exception:
        pass
    return jsonify(_json_safe(resp))


@session_bp.route("/api/session/<string:session_id>/pause", methods=["POST"])
def pause_session(session_id: str) -> Any:
    ctx = get_ctx()
    session_api = ctx.session_api
    payload = request.get_json(silent=True) or {}
    requested_user_id = _resolve_effective_user_id(
        payload.get("user_id") if isinstance(payload, dict) else None,
        fallback="guest",
    )
    user_input = payload.get("user_input") if isinstance(payload, dict) else None
    evaluation_result = payload.get("evaluation_result") if isinstance(payload, dict) else None
    view_state = payload.get("view_state") if isinstance(payload, dict) else None
    task_ref = payload.get("task_ref") if isinstance(payload, dict) else None
    task_index = payload.get("task_index") if isinstance(payload, dict) else None
    resume_target = payload.get("resume_target") if isinstance(payload, dict) else None
    if not isinstance(user_input, dict):
        user_input = None
    if not isinstance(evaluation_result, dict):
        evaluation_result = None
    if not isinstance(view_state, dict):
        view_state = None
    if not isinstance(resume_target, dict):
        resume_target = None
    if not isinstance(task_ref, str) or not task_ref.strip():
        task_ref = None
    if not isinstance(task_index, int):
        task_index = None
    session = session_api.get_session(session_id, user_id=requested_user_id)
    if not session:
        return jsonify({"ok": False, "error": "session_not_found"}), 404
    if session.paused:
        return jsonify({"ok": True, "paused": True, "paused_at": _json_safe(session.paused_at)})

    logger.info(
        "[HTTP] pause_session session_id=%s task_ref=%s task_index=%s has_user_input=%s has_view_state=%s has_evaluation=%s",
        session_id,
        task_ref,
        task_index,
        bool(user_input),
        bool(view_state),
        bool(evaluation_result),
    )

    try:
        session_api.pause_session(
            session_id,
            user_id=requested_user_id,
            user_input=user_input,
            evaluation_result=evaluation_result,
            view_state=view_state,
            task_ref=task_ref,
            task_index=task_index,
            resume_target=resume_target,
        )
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        raise
    session = session_api.get_session(session_id, user_id=requested_user_id)
    return jsonify({"ok": True, "paused": True, "paused_at": _json_safe(session.paused_at)})


@session_bp.route("/api/session/<string:session_id>/ui-state", methods=["POST"])
def save_task_ui_state(session_id: str) -> Any:
    ctx = get_ctx()
    session_api = ctx.session_api
    current_user_id = getattr(ctx, "user_id", None)
    payload = request.get_json(silent=True) or {}
    user_input = payload.get("user_input") if isinstance(payload, dict) else None
    evaluation_result = payload.get("evaluation_result") if isinstance(payload, dict) else None
    view_state = payload.get("view_state") if isinstance(payload, dict) else None
    task_ref = payload.get("task_ref") if isinstance(payload, dict) else None
    task_index = payload.get("task_index") if isinstance(payload, dict) else None

    if not isinstance(user_input, dict):
        user_input = None
    if not isinstance(evaluation_result, dict):
        evaluation_result = None
    if not isinstance(view_state, dict):
        view_state = None
    if not isinstance(task_ref, str) or not task_ref.strip():
        task_ref = None
    if not isinstance(task_index, int):
        task_index = None

    try:
        result = session_api.save_task_ui_state(
            session_id,
            task_ref=task_ref,
            task_index=task_index,
            user_input=user_input,
            evaluation_result=evaluation_result,
            view_state=view_state,
            user_id=current_user_id,
        )
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        raise

    if not result.get("ok"):
        error = result.get("error")
        if error == "session_not_found":
            return jsonify(result), 404
        if error in {"session_paused", "stale_task"}:
            return jsonify(result), 409
        return jsonify(result), 400

    return jsonify(result)


@session_bp.route("/api/session/<string:session_id>/resume", methods=["POST"])
def resume_session(session_id: str) -> Any:
    session_api = get_ctx().session_api
    payload = request.get_json(silent=True) or {}
    requested_user_id = _resolve_effective_user_id(
        payload.get("user_id") if isinstance(payload, dict) else None,
        fallback="guest",
    )
    resume_source = payload.get("source") if isinstance(payload, dict) else None
    if not isinstance(resume_source, str) or not resume_source.strip():
        resume_source = "http_resume"
    else:
        resume_source = resume_source.strip()
    try:
        session = session_api.resume_session(
            session_id,
            user_id=requested_user_id,
            source=resume_source,
        )
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        raise
    if not session:
        return jsonify({"ok": False, "error": "session_not_found"}), 404
    resume_target = session_api.get_resume_target(session)
    logger.info(
        "[HTTP] resume_session session_id=%s source=%s current_task_index=%s ui_task_ref=%s ui_task_index=%s resume_target=%s",
        session_id,
        resume_source,
        getattr(session, "current_task_index", None),
        ((getattr(session, "ui_state", None) or {}).get("task_ref") if isinstance(getattr(session, "ui_state", None), dict) else None),
        ((getattr(session, "ui_state", None) or {}).get("task_index") if isinstance(getattr(session, "ui_state", None), dict) else None),
        resume_target,
    )
    return jsonify({"ok": True, "paused": False, "resume_target": _json_safe(resume_target)})


@session_bp.route("/api/session/<string:session_id>/cancel", methods=["POST"])
def cancel_session(session_id: str) -> Any:
    payload = request.get_json(silent=True) or {}
    requested_user_id = _resolve_effective_user_id(
        payload.get("user_id") if isinstance(payload, dict) else None,
        fallback="guest",
    )
    try:
        data = get_ctx().session_api.cancel_session(session_id, user_id=requested_user_id)
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        raise
    status = 200 if data.get("ok") else 400
    return jsonify(_json_safe(data)), status


@session_bp.route("/api/session/<string:session_id>/iteration-results", methods=["GET"])
def get_iteration_results(session_id: str) -> Any:
    ctx = get_ctx()
    session_api = ctx.session_api
    current_user_id = getattr(ctx, "user_id", None)
    requested_iteration = request.args.get("iteration")
    try:
        iteration_number = int(requested_iteration) if requested_iteration is not None else None
    except Exception:
        iteration_number = None
    data = session_api.get_iteration_results(
        session_id,
        iteration_number=iteration_number,
        user_id=current_user_id,
    )
    if data is None:
        resp = {"ok": False, "error": "iteration_results_not_found"}
        try:
            logger.info("[HTTP] iteration-results session_id=%s -> %s", session_id, resp)
        except Exception:
            pass
        return jsonify(resp), 404

    # Add has_next_iteration so web S1 can decide S2 vs S3 without calling /final-results.
    try:
        sm = getattr(session_api, "_session_manager", None)
        session = session_api.get_session(session_id, user_id=current_user_id) if sm is not None else None
        has_next_iteration = False
        if session is not None:
            q = getattr(session, "queue", None)
            if isinstance(q, list) and len(q) > 0:
                has_next_iteration = True
        if isinstance(data, dict) and "has_next_iteration" not in data:
            data["has_next_iteration"] = has_next_iteration
    except Exception:
        pass

    resp = {"ok": True, "results": data}
    try:
        logger.debug(
            "[HTTP][RESPONSE] /iteration-results session_id=%s payload=%s", session_id, resp
        )
    except Exception:
        pass
    return jsonify(_json_safe(resp))


@session_bp.route("/api/session/<string:session_id>/final-results", methods=["GET"])
def get_final_results(session_id: str) -> Any:
    ctx = get_ctx()
    try:
        data = ctx.session_api.get_final_results(session_id, user_id=getattr(ctx, "user_id", None))
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        raise
    if data is None:
        return jsonify({"ok": False, "error": "final_results_not_found"}), 404
    return jsonify({"ok": True, "results": data})


@session_bp.route("/api/local-image", methods=["GET"])
def serve_local_image() -> Any:
    """Serve an image file from the trainer data directory for web UI.

    The client passes a "path" query parameter which may be:
    - an absolute filesystem path;
    - a path relative to the data_dir configured for the app.

    For safety we restrict serving files to be under data_dir when using
    relative paths. Absolute paths are allowed as-is for local dev.
    """

    raw_path = request.args.get("path")
    asset_id = str(request.args.get("asset_id") or "").strip()
    if not raw_path and not asset_id:
        return jsonify({"ok": False, "error": "path_required"}), 400

    try:
        ctx = get_ctx()
        if asset_id:
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
                return jsonify({"ok": False, "error": "asset_file_missing"}), 404
            resp = send_file(str(target))
            resp.headers["Cache-Control"] = "private, max-age=3600"
            return resp

        if is_hosted_web_runtime():
            return _hosted_runtime_asset_degraded_response(
                error="hosted_asset_path_blocked",
                operation="runtime.local_image.path_lookup",
                reason="asset_id_or_asset_url_required_in_hosted_runtime",
            )

        normalized = unquote(raw_path)
        normalized = normalized.replace("\\\\", "\\")
        p = Path(normalized)

        def _find_image_in_data_dir(basename: str) -> Optional[Path]:
            """Search for image by filename in common directories first, then limited rglob."""
            data_dir = ctx.data_dir
            # Fast path: check common image directories first
            for subdir in ("images", "modules"):
                candidate_dir = data_dir / subdir
                if candidate_dir.is_dir():
                    for match in candidate_dir.rglob(basename):
                        if match.is_file():
                            return match.resolve()
            # Slow fallback: limited rglob on full data_dir
            count = 0
            for match in data_dir.rglob(basename):
                if match.is_file():
                    return match.resolve()
                count += 1
                if count >= 20:
                    break
            return None

        if p.is_absolute():
            target = p.resolve()

            if not target.exists() or not target.is_file():
                found_abs = _find_image_in_data_dir(p.name)
                if found_abs is not None:
                    target = found_abs
        else:
            candidate = (ctx.data_dir / normalized).resolve()
            if candidate.exists() and candidate.is_file():
                target = candidate
            else:
                found = _find_image_in_data_dir(p.name)
                if found is None:
                    return jsonify({"ok": False, "error": "image_not_found"}), 404
                target = found

        if not target.exists() or not target.is_file():
            logger.info(
                "[HTTP] local-image not found: raw=%s normalized=%s resolved=%s",
                raw_path,
                normalized,
                target,
            )
            return jsonify({"ok": False, "error": "image_not_found"}), 404

        if not _is_within_data_dir(target):
            logger.warning(
                "[HTTP] local-image rejected path outside data_dir: raw=%s resolved=%s",
                raw_path,
                target,
            )
            return jsonify({"ok": False, "error": "image_not_found"}), 404

        logger.debug(
            "[HTTP] local-image serve: raw=%s normalized=%s resolved=%s",
            raw_path,
            normalized,
            target,
        )
        resp = send_file(str(target))
        resp.headers["Cache-Control"] = "private, max-age=3600"
        return resp
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("[HTTP] Failed to serve local image: %s", exc)
        return jsonify({"ok": False, "error": "image_serve_failed"}), 500
