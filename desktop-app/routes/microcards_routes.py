"""Microcards editor API + rollout/telemetry routes.

Endpoints:
- GET    /api/editor/theory/rollout/status
- GET    /api/editor/theory/rollout/telemetry
- GET    /api/microcards/rollout/status
- GET    /api/microcards/rollout/telemetry
- POST   /api/microcards/runtime/telemetry
- GET    /api/microcards/summary
- GET    /api/editor/microcards/decks
- GET    /api/editor/microcards/decks/<deck_id>
- POST   /api/editor/microcards/decks/from-analysis
- POST   /api/editor/microcards/decks/<deck_id>/append-from-analysis
- GET    /api/editor/microcards/decks/<deck_id>/queue
- POST   /api/editor/microcards/review/submit
- POST   /api/editor/microcards/decks/create-manual
- POST   /api/editor/microcards/decks/<deck_id>/rename
- POST   /api/editor/microcards/decks/<deck_id>/archive
- DELETE /api/editor/microcards/decks/<deck_id>
- POST   /api/editor/microcards/decks/<deck_id>/cards
- PUT    /api/editor/microcards/decks/<deck_id>/cards/<card_id>
- DELETE /api/editor/microcards/decks/<deck_id>/cards/<card_id>
- POST   /api/editor/microcards/decks/<deck_id>/reorder-cards
- POST   /api/editor/microcards/import/parse-text
- POST   /api/editor/microcards/import/execute-text
"""

import logging
from typing import Any, Dict, Optional, Tuple

from flask import Blueprint, jsonify, request

from routes._context import get_ctx, get_extra

logger = logging.getLogger(__name__)

microcards_bp = Blueprint("microcards", __name__)


# ---------------------------------------------------------------------------
# Helper accessor – all heavy helpers live in server.py and are registered
# via set_extra("microcards_helpers", {...}) after they are defined.
# ---------------------------------------------------------------------------

def _mch() -> Dict[str, Any]:
    """Return the microcards helpers dict registered by server.py."""
    return get_extra("microcards_helpers")


# ---------------------------------------------------------------------------
# Theory rollout status/telemetry
# ---------------------------------------------------------------------------


@microcards_bp.route("/api/editor/theory/rollout/status", methods=["GET"])
def theory_rollout_status() -> Any:
    if get_ctx().user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_ai"}), 403
    include_telemetry = str(request.args.get("include_telemetry") or "").strip().lower() in {"1", "true", "yes", "on"}
    try:
        telemetry_limit = max(1, min(int(request.args.get("telemetry_limit") or 5000), 20000))
    except Exception:
        telemetry_limit = 5000
    payload = _mch()["build_theory_rollout_status_payload"](
        include_inventory=True,
        include_telemetry=include_telemetry,
        telemetry_limit=telemetry_limit,
    )
    return jsonify({"ok": True, "rollout": payload})


@microcards_bp.route("/api/editor/theory/rollout/telemetry", methods=["GET"])
def theory_rollout_telemetry() -> Any:
    if get_ctx().user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_ai"}), 403
    try:
        limit = max(1, min(int(request.args.get("limit") or 5000), 20000))
    except Exception:
        limit = 5000
    telemetry = _mch()["build_theory_rollout_telemetry_summary"](limit=limit)
    rollout = _mch()["build_theory_rollout_status_payload"](include_inventory=False, include_telemetry=False)
    return jsonify({"ok": True, "rollout": rollout, "telemetry": telemetry})


# ---------------------------------------------------------------------------
# M14: Microcards Productization Rollout endpoints
# ---------------------------------------------------------------------------


@microcards_bp.route("/api/microcards/rollout/status", methods=["GET"])
def microcards_prod_rollout_status() -> Any:
    if get_ctx().user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    include_telemetry = str(request.args.get("include_telemetry") or "").strip().lower() in {"1", "true", "yes", "on"}
    try:
        telemetry_limit = max(1, min(int(request.args.get("telemetry_limit") or 5000), 20000))
    except Exception:
        telemetry_limit = 5000
    payload = _mch()["build_microcards_prod_rollout_status_payload"](
        include_telemetry=include_telemetry,
        telemetry_limit=telemetry_limit,
    )
    return jsonify({"ok": True, "rollout": payload})


@microcards_bp.route("/api/microcards/rollout/telemetry", methods=["GET"])
def microcards_prod_rollout_telemetry() -> Any:
    if get_ctx().user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    try:
        limit = max(1, min(int(request.args.get("limit") or 5000), 20000))
    except Exception:
        limit = 5000
    telemetry = _mch()["build_microcards_prod_telemetry_summary"](limit=limit)
    rollout = _mch()["build_microcards_prod_rollout_status_payload"](include_telemetry=False)
    return jsonify({"ok": True, "rollout": rollout, "telemetry": telemetry})


@microcards_bp.route("/api/microcards/runtime/telemetry", methods=["POST"])
def microcards_runtime_telemetry() -> Any:
    if get_ctx().user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    payload = request.get_json(silent=True) or {}
    event_name = str(payload.get("event") or "").strip()
    allowed_events = {
        "microcards_runtime_opened",
        "microcards_runtime_session_started",
        "microcards_runtime_session_completed",
    }
    if event_name not in allowed_events:
        return jsonify({"ok": False, "error": "invalid_event"}), 400
    fields = payload.get("fields") if isinstance(payload.get("fields"), dict) else {}
    _mch()["emit_microcards_prod_telemetry"](event_name, **fields)
    return jsonify({"ok": True, "event": event_name})


@microcards_bp.route("/api/microcards/summary", methods=["GET"])
def microcards_summary() -> Any:
    ctx = get_ctx()
    h = _mch()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not h["is_editor_feature_enabled"]("microcards_mode"):
        return h["feature_disabled_json"]("microcards_mode_disabled", status_code=404)

    include_dynamics = str(request.args.get("include_dynamics") or "").strip().lower() in {"1", "true", "yes", "on"}
    force_refresh = str(request.args.get("force_refresh") or "").strip().lower() in {"1", "true", "yes", "on"}
    try:
        dynamics_days = max(1, min(int(request.args.get("days") or 30), 3650))
    except Exception:
        dynamics_days = 30

    try:
        user_id = ctx.user_id or "default_user"
        svc = h["microcards_analytics_service"]()
        payload = svc.get_summary(
            user_id=user_id,
            force_refresh=force_refresh,
            include_dynamics=include_dynamics,
            dynamics_days=dynamics_days,
        )
        payload["microcards_feature_flags"] = h["get_microcards_prod_feature_flags"]()
        return jsonify({"ok": True, **payload})
    except Exception as exc:
        logger.exception("[HTTP] microcards summary failed: %s", exc)
        return jsonify({"ok": False, "error": "microcards_summary_failed"}), 500


@microcards_bp.route("/api/editor/microcards/decks", methods=["GET"])
def microcards_list_decks() -> Any:
    ctx = get_ctx()
    h = _mch()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not h["is_editor_feature_enabled"]("microcards_mode"):
        return h["feature_disabled_json"]("microcards_mode_disabled", status_code=404)
    try:
        limit = max(1, min(int(request.args.get("limit") or 50), 200))
    except Exception:
        limit = 50
    try:
        svc = h["microcards_service"]()
        items = svc.list_decks(limit=limit)
        h["emit_theory_rollout_telemetry"](
            "microcards_decks_listed",
            items_count=len(items),
            limit=limit,
        )
        return jsonify({"ok": True, "items": items, "user_id": ctx.user_id})
    except Exception as exc:
        logger.exception("[HTTP] microcards/decks list failed: %s", exc)
        return jsonify({"ok": False, "error": "microcards_list_failed"}), 500


@microcards_bp.route("/api/editor/microcards/decks/<string:deck_id>", methods=["GET"])
def microcards_get_deck(deck_id: str) -> Any:
    ctx = get_ctx()
    h = _mch()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not h["is_editor_feature_enabled"]("microcards_mode"):
        return h["feature_disabled_json"]("microcards_mode_disabled", status_code=404)
    try:
        svc = h["microcards_service"]()
        deck = svc.get_deck(deck_id)
        if not isinstance(deck, dict):
            return jsonify({"ok": False, "error": "deck_not_found"}), 404
        h["emit_theory_rollout_telemetry"](
            "microcards_deck_opened",
            deck_id=deck_id,
            cards_total=len(deck.get("cards") or []) if isinstance(deck.get("cards"), list) else 0,
        )
        return jsonify({"ok": True, "deck": deck, "user_id": ctx.user_id})
    except Exception as exc:
        logger.exception("[HTTP] microcards/decks/%s get failed: %s", deck_id, exc)
        return jsonify({"ok": False, "error": "microcards_get_failed"}), 500


@microcards_bp.route("/api/editor/microcards/decks/from-analysis", methods=["POST"])
def microcards_create_deck_from_analysis() -> Any:
    ctx = get_ctx()
    h = _mch()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not h["is_editor_feature_enabled"]("microcards_mode"):
        return h["feature_disabled_json"]("microcards_mode_disabled", status_code=404)
    payload = request.get_json(silent=True) or {}
    run_id = str(payload.get("ai_run_id") or "").strip()
    if not run_id:
        return jsonify({"ok": False, "error": "ai_run_id_required"}), 400
    if not h["is_valid_ai_run_id"](run_id):
        return jsonify({"ok": False, "error": "invalid_ai_run_id"}), 400

    try:
        analysis_payload = h["ai_run_build_reopen_analysis_response"](run_id, apply_feature_flags=False)
        if analysis_payload is None:
            return jsonify({"ok": False, "error": "analysis_not_found"}), 404
        selector = payload.get("selector") if isinstance(payload.get("selector"), dict) else {}
        if bool(selector.get("pair_match_only")) and not h["is_editor_feature_enabled"]("microcards_pair_match"):
            return h["feature_disabled_json"]("microcards_pair_match_disabled", status_code=400)
        deck_name = payload.get("name")
        analysis_payload = h["sanitize_analysis_for_microcards_backend"](analysis_payload)
        svc = h["microcards_service"]()
        deck = svc.create_deck_from_analysis(
            analysis_payload,
            ai_run_id=run_id,
            selector=selector,
            deck_name=str(deck_name).strip() if isinstance(deck_name, str) else None,
        )
        h["invalidate_microcards_analytics_cache"](ctx.user_id or "default_user")
        cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
        pair_match_cards = sum(
            1
            for c in cards
            if isinstance(c, dict) and str(c.get("card_type") or "").strip().lower() == "pair_match"
        )
        h["emit_theory_rollout_telemetry"](
            "microcards_deck_created_from_analysis",
            ai_run_id=run_id,
            deck_id=deck.get("id"),
            cards_total=len(cards),
            pair_match_cards=pair_match_cards,
            selector_scope=(selector.get("scope") if isinstance(selector, dict) else None),
            pair_match_only=bool(selector.get("pair_match_only")) if isinstance(selector, dict) else False,
        )
        return jsonify(
            {
                "ok": True,
                "deck": deck,
                "deck_summary": {
                    "id": deck.get("id"),
                    "name": deck.get("name"),
                    "cards_total": len(deck.get("cards") or []),
                    "selector": deck.get("selector") or {},
                },
                "user_id": ctx.user_id,
            }
        )
    except Exception as exc:
        logger.exception("[HTTP] microcards/decks/from-analysis failed run_id=%s: %s", run_id, exc)
        return jsonify({"ok": False, "error": "microcards_create_failed"}), 500


@microcards_bp.route("/api/editor/microcards/decks/<string:deck_id>/append-from-analysis", methods=["POST"])
def microcards_append_to_deck_from_analysis(deck_id: str) -> Any:
    ctx = get_ctx()
    h = _mch()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not h["is_editor_feature_enabled"]("microcards_mode"):
        return h["feature_disabled_json"]("microcards_mode_disabled", status_code=404)
    payload = request.get_json(silent=True) or {}
    run_id = str(payload.get("ai_run_id") or "").strip()
    if not run_id:
        return jsonify({"ok": False, "error": "ai_run_id_required"}), 400
    if not h["is_valid_ai_run_id"](run_id):
        return jsonify({"ok": False, "error": "invalid_ai_run_id"}), 400
    try:
        analysis_payload = h["ai_run_build_reopen_analysis_response"](run_id, apply_feature_flags=False)
        if analysis_payload is None:
            return jsonify({"ok": False, "error": "analysis_not_found"}), 404
        selector = payload.get("selector") if isinstance(payload.get("selector"), dict) else {}
        if bool(selector.get("pair_match_only")) and not h["is_editor_feature_enabled"]("microcards_pair_match"):
            return h["feature_disabled_json"]("microcards_pair_match_disabled", status_code=400)
        analysis_payload = h["sanitize_analysis_for_microcards_backend"](analysis_payload)
        svc = h["microcards_service"]()
        result = svc.append_cards_from_analysis_to_deck(
            deck_id=deck_id,
            analysis_payload=analysis_payload,
            ai_run_id=run_id,
            selector=selector,
        )
        h["invalidate_microcards_analytics_cache"](ctx.user_id or "default_user")
        deck = result.get("deck") if isinstance(result.get("deck"), dict) else {}
        h["emit_theory_rollout_telemetry"](
            "microcards_deck_appended_from_analysis",
            ai_run_id=run_id,
            deck_id=deck_id,
            added_cards=int(result.get("added_cards") or 0),
            skipped_duplicates=int(result.get("skipped_duplicates") or 0),
            selector_scope=(selector.get("scope") if isinstance(selector, dict) else None),
            pair_match_only=bool(selector.get("pair_match_only")) if isinstance(selector, dict) else False,
        )
        return jsonify(
            {
                "ok": True,
                "deck": deck,
                "deck_summary": {
                    "id": deck.get("id"),
                    "name": deck.get("name"),
                    "cards_total": len(deck.get("cards") or []),
                    "selector": deck.get("selector") or {},
                },
                "added_cards": int(result.get("added_cards") or 0),
                "skipped_duplicates": int(result.get("skipped_duplicates") or 0),
                "user_id": ctx.user_id,
            }
        )
    except LookupError as exc:
        if str(exc) == "deck_not_found":
            return jsonify({"ok": False, "error": "deck_not_found"}), 404
        logger.warning("[HTTP] microcards append lookup failed deck_id=%s: %s", deck_id, exc)
        return jsonify({"ok": False, "error": "microcards_append_lookup_failed"}), 404
    except Exception as exc:
        logger.exception("[HTTP] microcards append failed deck_id=%s run_id=%s: %s", deck_id, run_id, exc)
        return jsonify({"ok": False, "error": "microcards_append_failed"}), 500


@microcards_bp.route("/api/editor/microcards/decks/<string:deck_id>/queue", methods=["GET"])
def microcards_get_deck_queue(deck_id: str) -> Any:
    ctx = get_ctx()
    h = _mch()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not h["is_editor_feature_enabled"]("microcards_mode"):
        return h["feature_disabled_json"]("microcards_mode_disabled", status_code=404)
    try:
        limit = max(1, min(int(request.args.get("limit") or 20), 100))
    except Exception:
        limit = 20
    restart = str(request.args.get("restart") or "").strip().lower() in {"1", "true", "yes", "on"}
    try:
        svc = h["microcards_service"]()
        queue_payload = svc.get_due_queue(deck_id, limit=limit, resume=True, restart=restart)
        session = queue_payload.get("session") if isinstance(queue_payload.get("session"), dict) else {}
        cursor_val = int(queue_payload.get("cursor") or 0)
        h["emit_theory_rollout_telemetry"](
            "microcards_queue_opened",
            deck_id=deck_id,
            limit=limit,
            restart=restart,
            resumed_session=bool(session.get("id")) and not restart and cursor_val > 0,
            cursor=cursor_val,
            queue_count=int(queue_payload.get("queue_count") or 0),
            current_card_type=(
                (queue_payload.get("current_card") or {}).get("card_type")
                if isinstance(queue_payload.get("current_card"), dict)
                else None
            ),
        )
        return jsonify({"ok": True, **queue_payload, "user_id": ctx.user_id})
    except LookupError as exc:
        if str(exc) == "deck_not_found":
            return jsonify({"ok": False, "error": "deck_not_found"}), 404
        logger.warning("[HTTP] microcards queue lookup failed deck_id=%s: %s", deck_id, exc)
        return jsonify({"ok": False, "error": "microcards_queue_lookup_failed"}), 404
    except Exception as exc:
        logger.exception("[HTTP] microcards/decks/%s/queue failed: %s", deck_id, exc)
        return jsonify({"ok": False, "error": "microcards_queue_failed"}), 500


@microcards_bp.route("/api/editor/microcards/review/submit", methods=["POST"])
def microcards_submit_review() -> Any:
    ctx = get_ctx()
    h = _mch()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not h["is_editor_feature_enabled"]("microcards_mode"):
        return h["feature_disabled_json"]("microcards_mode_disabled", status_code=404)
    payload = request.get_json(silent=True) or {}
    deck_id = str(payload.get("deck_id") or "").strip()
    card_id = str(payload.get("card_id") or "").strip()
    rating = str(payload.get("rating") or "").strip().lower()
    session_id = str(payload.get("session_id") or "").strip() or None
    if not deck_id:
        return jsonify({"ok": False, "error": "deck_id_required"}), 400
    if not card_id:
        return jsonify({"ok": False, "error": "card_id_required"}), 400
    if rating not in {"again", "hard", "good", "easy"}:
        return jsonify({"ok": False, "error": "invalid_rating"}), 400

    try:
        svc = h["microcards_service"]()
        result = svc.submit_review(
            deck_id=deck_id,
            card_id=card_id,
            rating=rating,
            session_id=session_id,
            response=payload.get("response"),
            response_time_ms=payload.get("response_time_ms") if isinstance(payload.get("response_time_ms"), int) else None,
        )
        try:
            h["orchestrate_microcards_review_post_submit"](
                deck_id=deck_id,
                card_id=card_id,
                review_result=result if isinstance(result, dict) else {},
            )
        except Exception as orchestration_exc:
            logger.warning(
                "[HTTP] M1 microcards post-submit orchestration failed (non-fatal): %s",
                orchestration_exc,
            )
        review_event = result.get("review_event") if isinstance(result.get("review_event"), dict) else {}
        details = review_event.get("details") if isinstance(review_event.get("details"), dict) else {}
        h["emit_theory_rollout_telemetry"](
            "microcards_review_submitted",
            deck_id=deck_id,
            card_id=card_id,
            rating=rating,
            card_type=details.get("card_type"),
            was_correct=review_event.get("was_correct"),
            partial_score=details.get("partial_score"),
            session_id=review_event.get("session_id"),
        )
        return jsonify({"ok": True, **result, "user_id": ctx.user_id})
    except LookupError as exc:
        if str(exc) == "deck_not_found":
            return jsonify({"ok": False, "error": "deck_not_found"}), 404
        if str(exc) == "card_not_found":
            return jsonify({"ok": False, "error": "card_not_found"}), 404
        if str(exc) == "session_not_found":
            return jsonify({"ok": False, "error": "session_not_found"}), 404
        logger.warning("[HTTP] microcards review lookup failed: %s", exc)
        return jsonify({"ok": False, "error": "microcards_review_lookup_failed"}), 404
    except ValueError as exc:
        err = str(exc)
        if err in {
            "session_deck_mismatch",
            "session_completed",
            "session_queue_exhausted",
            "session_card_mismatch",
        }:
            return jsonify({"ok": False, "error": err}), 409
        logger.warning("[HTTP] microcards review invalid submit: %s", exc)
        return jsonify({"ok": False, "error": "microcards_review_invalid_submit"}), 400
    except Exception as exc:
        logger.exception("[HTTP] microcards review submit failed: %s", exc)
        return jsonify({"ok": False, "error": "microcards_review_submit_failed"}), 500


# ── M11: Manual deck/card CRUD endpoints ──────────────────────────────


@microcards_bp.route("/api/editor/microcards/decks/create-manual", methods=["POST"])
def microcards_create_deck_manual() -> Any:
    ctx = get_ctx()
    h = _mch()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not h["is_editor_feature_enabled"]("microcards_mode"):
        return h["feature_disabled_json"]("microcards_mode_disabled", status_code=404)
    if not h["is_microcards_prod_feature_enabled"]("microcards_manual_editor"):
        return h["microcards_prod_feature_disabled_json"]("microcards_manual_editor_disabled", status_code=404)
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "name_required"}), 400
    tags = payload.get("tags") if isinstance(payload.get("tags"), list) else []
    target_language = str(payload.get("target_language") or "unknown").strip()
    try:
        svc = h["microcards_service"]()
        deck = svc.create_deck_manual(name=name, tags=tags, target_language=target_language)
        h["invalidate_microcards_analytics_cache"](ctx.user_id or "default_user")
        h["emit_theory_rollout_telemetry"](
            "microcards_manual_deck_created",
            deck_id=deck.get("id"),
            name=name,
        )
        h["emit_microcards_prod_telemetry"](
            "microcards_manual_deck_created",
            deck_id=deck.get("id"),
            name=name,
        )
        return jsonify({"ok": True, "deck": deck, "user_id": ctx.user_id})
    except Exception as exc:
        logger.exception("[HTTP] microcards create-manual failed: %s", exc)
        return jsonify({"ok": False, "error": "microcards_create_manual_failed"}), 500


@microcards_bp.route("/api/editor/microcards/decks/<string:deck_id>/rename", methods=["POST"])
def microcards_rename_deck(deck_id: str) -> Any:
    ctx = get_ctx()
    h = _mch()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not h["is_editor_feature_enabled"]("microcards_mode"):
        return h["feature_disabled_json"]("microcards_mode_disabled", status_code=404)
    if not h["is_microcards_prod_feature_enabled"]("microcards_manual_editor"):
        return h["microcards_prod_feature_disabled_json"]("microcards_manual_editor_disabled", status_code=404)
    payload = request.get_json(silent=True) or {}
    new_name = str(payload.get("name") or "").strip()
    if not new_name:
        return jsonify({"ok": False, "error": "name_required"}), 400
    try:
        svc = h["microcards_service"]()
        deck = svc.rename_deck(deck_id, new_name)
        return jsonify({"ok": True, "deck": deck, "user_id": ctx.user_id})
    except LookupError:
        return jsonify({"ok": False, "error": "deck_not_found"}), 404
    except Exception as exc:
        logger.exception("[HTTP] microcards rename failed deck_id=%s: %s", deck_id, exc)
        return jsonify({"ok": False, "error": "microcards_rename_failed"}), 500


@microcards_bp.route("/api/editor/microcards/decks/<string:deck_id>/archive", methods=["POST"])
def microcards_archive_deck(deck_id: str) -> Any:
    ctx = get_ctx()
    h = _mch()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not h["is_editor_feature_enabled"]("microcards_mode"):
        return h["feature_disabled_json"]("microcards_mode_disabled", status_code=404)
    if not h["is_microcards_prod_feature_enabled"]("microcards_manual_editor"):
        return h["microcards_prod_feature_disabled_json"]("microcards_manual_editor_disabled", status_code=404)
    payload = request.get_json(silent=True) or {}
    archive = payload.get("archive", True)
    try:
        svc = h["microcards_service"]()
        deck = svc.archive_deck(deck_id, archive=bool(archive))
        h["invalidate_microcards_analytics_cache"](ctx.user_id or "default_user")
        return jsonify({"ok": True, "deck": deck, "user_id": ctx.user_id})
    except LookupError:
        return jsonify({"ok": False, "error": "deck_not_found"}), 404
    except Exception as exc:
        logger.exception("[HTTP] microcards archive failed deck_id=%s: %s", deck_id, exc)
        return jsonify({"ok": False, "error": "microcards_archive_failed"}), 500


@microcards_bp.route("/api/editor/microcards/decks/<string:deck_id>", methods=["DELETE"])
def microcards_delete_deck(deck_id: str) -> Any:
    ctx = get_ctx()
    h = _mch()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not h["is_editor_feature_enabled"]("microcards_mode"):
        return h["feature_disabled_json"]("microcards_mode_disabled", status_code=404)
    if not h["is_microcards_prod_feature_enabled"]("microcards_manual_editor"):
        return h["microcards_prod_feature_disabled_json"]("microcards_manual_editor_disabled", status_code=404)
    try:
        svc = h["microcards_service"]()
        deleted = svc.delete_deck(deck_id)
        if not deleted:
            return jsonify({"ok": False, "error": "deck_not_found"}), 404
        h["invalidate_microcards_analytics_cache"](ctx.user_id or "default_user")
        return jsonify({"ok": True, "deleted": True, "user_id": ctx.user_id})
    except Exception as exc:
        logger.exception("[HTTP] microcards delete failed deck_id=%s: %s", deck_id, exc)
        return jsonify({"ok": False, "error": "microcards_delete_failed"}), 500


@microcards_bp.route("/api/editor/microcards/decks/<string:deck_id>/cards", methods=["POST"])
def microcards_create_card(deck_id: str) -> Any:
    ctx = get_ctx()
    h = _mch()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not h["is_editor_feature_enabled"]("microcards_mode"):
        return h["feature_disabled_json"]("microcards_mode_disabled", status_code=404)
    if not h["is_microcards_prod_feature_enabled"]("microcards_manual_editor"):
        return h["microcards_prod_feature_disabled_json"]("microcards_manual_editor_disabled", status_code=404)
    payload = request.get_json(silent=True) or {}
    card_type = str(payload.get("card_type") or "fact_recall").strip().lower()
    front_text = str(payload.get("front_text") or "").strip()
    tags = payload.get("tags") if isinstance(payload.get("tags"), list) else []
    difficulty_hint = str(payload.get("difficulty_hint") or "medium").strip()
    if not front_text:
        return jsonify({"ok": False, "error": "front_text_required"}), 400
    try:
        svc = h["microcards_service"]()
        if card_type == "pair_match":
            # M15: pair_match card creation
            pairs = payload.get("pairs")
            if not isinstance(pairs, list):
                return jsonify({"ok": False, "error": "pairs_required"}), 400
            card = svc.create_pair_match_card_manual(
                deck_id=deck_id,
                front_text=front_text,
                pairs=pairs,
                tags=tags,
                difficulty_hint=difficulty_hint,
            )
            h["invalidate_microcards_analytics_cache"](ctx.user_id or "default_user")
            h["emit_theory_rollout_telemetry"](
                "microcards_pair_match_card_created",
                deck_id=deck_id,
                card_id=card.get("id"),
            )
        else:
            back_text = str(payload.get("back_text") or "").strip()
            if not back_text:
                return jsonify({"ok": False, "error": "back_text_required"}), 400
            card = svc.create_card_manual(
                deck_id=deck_id,
                front_text=front_text,
                back_text=back_text,
                tags=tags,
                difficulty_hint=difficulty_hint,
            )
            h["invalidate_microcards_analytics_cache"](ctx.user_id or "default_user")
            h["emit_theory_rollout_telemetry"](
                "microcards_manual_card_created",
                deck_id=deck_id,
                card_id=card.get("id"),
            )
        return jsonify({"ok": True, "card": card, "user_id": ctx.user_id})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        err = str(exc)
        status = 409 if err == "duplicate_card" else 400
        return jsonify({"ok": False, "error": err}), status
    except Exception as exc:
        logger.exception("[HTTP] microcards create card failed deck_id=%s: %s", deck_id, exc)
        return jsonify({"ok": False, "error": "microcards_create_card_failed"}), 500


@microcards_bp.route("/api/editor/microcards/decks/<string:deck_id>/cards/<string:card_id>", methods=["PUT"])
def microcards_update_card(deck_id: str, card_id: str) -> Any:
    ctx = get_ctx()
    h = _mch()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not h["is_editor_feature_enabled"]("microcards_mode"):
        return h["feature_disabled_json"]("microcards_mode_disabled", status_code=404)
    if not h["is_microcards_prod_feature_enabled"]("microcards_manual_editor"):
        return h["microcards_prod_feature_disabled_json"]("microcards_manual_editor_disabled", status_code=404)
    payload = request.get_json(silent=True) or {}
    card_type = str(payload.get("card_type") or "").strip().lower()
    try:
        svc = h["microcards_service"]()
        # M15: pair_match card update with structured pairs
        if card_type == "pair_match" or "pairs" in payload:
            pm_kwargs: dict = {}
            if "front_text" in payload:
                pm_kwargs["front_text"] = str(payload["front_text"] or "").strip() or None
            if "pairs" in payload:
                pm_kwargs["pairs"] = payload["pairs"] if isinstance(payload["pairs"], list) else None
            if "tags" in payload:
                pm_kwargs["tags"] = payload["tags"] if isinstance(payload["tags"], list) else None
            if "difficulty_hint" in payload:
                pm_kwargs["difficulty_hint"] = str(payload["difficulty_hint"] or "").strip() or None
            if "status" in payload:
                pm_kwargs["status"] = str(payload["status"] or "").strip() or None
            card = svc.update_pair_match_card(deck_id=deck_id, card_id=card_id, **pm_kwargs)
            h["invalidate_microcards_analytics_cache"](ctx.user_id or "default_user")
            h["emit_theory_rollout_telemetry"](
                "microcards_pair_match_card_updated",
                deck_id=deck_id,
                card_id=card_id,
            )
        else:
            kwargs: dict = {}
            if "front_text" in payload:
                kwargs["front_text"] = str(payload["front_text"] or "").strip() or None
            if "back_text" in payload:
                kwargs["back_text"] = str(payload["back_text"] or "").strip() or None
            if "tags" in payload:
                kwargs["tags"] = payload["tags"] if isinstance(payload["tags"], list) else None
            if "difficulty_hint" in payload:
                kwargs["difficulty_hint"] = str(payload["difficulty_hint"] or "").strip() or None
            if "status" in payload:
                kwargs["status"] = str(payload["status"] or "").strip() or None
            card = svc.update_card(deck_id=deck_id, card_id=card_id, **kwargs)
            h["invalidate_microcards_analytics_cache"](ctx.user_id or "default_user")
        return jsonify({"ok": True, "card": card, "user_id": ctx.user_id})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        err = str(exc)
        status = 409 if err == "duplicate_card" else 400
        return jsonify({"ok": False, "error": err}), status
    except Exception as exc:
        logger.exception("[HTTP] microcards update card failed deck=%s card=%s: %s", deck_id, card_id, exc)
        return jsonify({"ok": False, "error": "microcards_update_card_failed"}), 500


@microcards_bp.route("/api/editor/microcards/decks/<string:deck_id>/cards/<string:card_id>", methods=["DELETE"])
def microcards_delete_card(deck_id: str, card_id: str) -> Any:
    ctx = get_ctx()
    h = _mch()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not h["is_editor_feature_enabled"]("microcards_mode"):
        return h["feature_disabled_json"]("microcards_mode_disabled", status_code=404)
    if not h["is_microcards_prod_feature_enabled"]("microcards_manual_editor"):
        return h["microcards_prod_feature_disabled_json"]("microcards_manual_editor_disabled", status_code=404)
    try:
        svc = h["microcards_service"]()
        svc.delete_card(deck_id, card_id)
        h["invalidate_microcards_analytics_cache"](ctx.user_id or "default_user")
        return jsonify({"ok": True, "deleted": True, "user_id": ctx.user_id})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] microcards delete card failed deck=%s card=%s: %s", deck_id, card_id, exc)
        return jsonify({"ok": False, "error": "microcards_delete_card_failed"}), 500


@microcards_bp.route("/api/editor/microcards/decks/<string:deck_id>/reorder-cards", methods=["POST"])
def microcards_reorder_cards(deck_id: str) -> Any:
    ctx = get_ctx()
    h = _mch()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not h["is_editor_feature_enabled"]("microcards_mode"):
        return h["feature_disabled_json"]("microcards_mode_disabled", status_code=404)
    if not h["is_microcards_prod_feature_enabled"]("microcards_manual_editor"):
        return h["microcards_prod_feature_disabled_json"]("microcards_manual_editor_disabled", status_code=404)
    payload = request.get_json(silent=True) or {}
    card_ids = payload.get("card_ids")
    if not isinstance(card_ids, list) or not card_ids:
        return jsonify({"ok": False, "error": "card_ids_required"}), 400
    try:
        svc = h["microcards_service"]()
        deck = svc.reorder_cards(deck_id, card_ids)
        return jsonify({
            "ok": True,
            "deck_summary": {
                "id": deck.get("id"),
                "name": deck.get("name"),
                "cards_total": len(deck.get("cards") or []),
            },
            "user_id": ctx.user_id,
        })
    except LookupError:
        return jsonify({"ok": False, "error": "deck_not_found"}), 404
    except Exception as exc:
        logger.exception("[HTTP] microcards reorder failed deck_id=%s: %s", deck_id, exc)
        return jsonify({"ok": False, "error": "microcards_reorder_failed"}), 500


# ── M12: Microcards text import endpoints ──────────────────────────────


@microcards_bp.route("/api/editor/microcards/import/parse-text", methods=["POST"])
def microcards_import_parse_text() -> Any:
    """Parse @MICROCARD text and return preview payload."""
    ctx = get_ctx()
    h = _mch()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not h["is_editor_feature_enabled"]("microcards_mode"):
        return h["feature_disabled_json"]("microcards_mode_disabled", status_code=404)
    if not h["is_microcards_prod_feature_enabled"]("microcards_text_import"):
        return h["microcards_prod_feature_disabled_json"]("microcards_text_import_disabled", status_code=404)
    if not h["PARSERS_AVAILABLE"]:
        return jsonify({"ok": False, "error": "parsers_not_available"}), 500

    payload = request.get_json(silent=True) or {}
    text = payload.get("text", "")
    if not text or not isinstance(text, str):
        return jsonify({"ok": False, "error": "text_required"}), 400

    try:
        parser = h["MicrocardParser"]()
        result = parser.parse_text(text)

        h["emit_theory_rollout_telemetry"](
            "microcards_text_import_parsed",
            total=result.get("summary", {}).get("total", 0),
            valid=result.get("summary", {}).get("valid", 0),
            errors=result.get("summary", {}).get("errors", 0),
        )
        h["emit_microcards_prod_telemetry"](
            "microcards_text_import_parsed",
            total=result.get("summary", {}).get("total", 0),
            valid=result.get("summary", {}).get("valid", 0),
            errors=result.get("summary", {}).get("errors", 0),
        )

        logger.info(
            "[HTTP] microcards/import/parse-text: total=%s valid=%s errors=%s",
            result.get("summary", {}).get("total", 0),
            result.get("summary", {}).get("valid", 0),
            result.get("summary", {}).get("errors", 0),
        )
        return jsonify(result)

    except Exception as exc:
        logger.exception("[HTTP] microcards import parse-text failed: %s", exc)
        h["emit_theory_rollout_telemetry"](
            "microcards_text_import_parse_error",
            error=str(exc)[:200],
        )
        h["emit_microcards_prod_telemetry"](
            "microcards_text_import_parse_error",
            error=str(exc)[:200],
        )
        return jsonify({"ok": False, "error": "microcards_parse_failed"}), 500


@microcards_bp.route("/api/editor/microcards/import/execute-text", methods=["POST"])
def microcards_import_execute_text() -> Any:
    """Execute microcards text import — create or append to deck."""
    ctx = get_ctx()
    h = _mch()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not h["is_editor_feature_enabled"]("microcards_mode"):
        return h["feature_disabled_json"]("microcards_mode_disabled", status_code=404)
    if not h["is_microcards_prod_feature_enabled"]("microcards_text_import"):
        return h["microcards_prod_feature_disabled_json"]("microcards_text_import_disabled", status_code=404)

    payload = request.get_json(silent=True) or {}
    items = payload.get("items")
    mode = str(payload.get("mode", "create_deck")).strip()
    target_deck_id = str(payload.get("target_deck_id") or "").strip() or None
    deck_name = str(payload.get("deck_name") or "").strip() or None
    target_language = str(payload.get("target_language") or "unknown").strip()

    if not isinstance(items, list) or not items:
        return jsonify({"ok": False, "error": "items_required"}), 400
    if mode not in ("create_deck", "append_to_deck"):
        return jsonify({"ok": False, "error": "invalid_mode"}), 400
    if mode == "append_to_deck" and not target_deck_id:
        return jsonify({"ok": False, "error": "target_deck_id_required"}), 400

    try:
        svc = h["microcards_service"]()
        result = svc.import_cards_from_parsed(
            parsed_items=items,
            mode=mode,
            target_deck_id=target_deck_id,
            deck_name=deck_name,
            target_language=target_language,
        )
        h["invalidate_microcards_analytics_cache"](ctx.user_id or "default_user")

        deck = result.get("deck") if isinstance(result.get("deck"), dict) else {}
        h["emit_theory_rollout_telemetry"](
            "microcards_text_import_executed",
            mode=mode,
            deck_id=deck.get("id"),
            added_cards=result.get("added_cards", 0),
            skipped_duplicates=result.get("skipped_duplicates", 0),
            skipped_errors=result.get("skipped_errors", 0),
        )
        h["emit_microcards_prod_telemetry"](
            "microcards_text_import_executed",
            mode=mode,
            deck_id=deck.get("id"),
            added_cards=result.get("added_cards", 0),
            skipped_duplicates=result.get("skipped_duplicates", 0),
            skipped_errors=result.get("skipped_errors", 0),
        )

        logger.info(
            "[HTTP] microcards/import/execute-text: mode=%s deck=%s added=%s dupes=%s errors=%s",
            mode,
            deck.get("id"),
            result.get("added_cards", 0),
            result.get("skipped_duplicates", 0),
            result.get("skipped_errors", 0),
        )
        return jsonify({
            "ok": True,
            "mode": mode,
            "deck_id": deck.get("id"),
            "deck_name": deck.get("name"),
            "added_cards": result.get("added_cards", 0),
            "skipped_duplicates": result.get("skipped_duplicates", 0),
            "skipped_errors": result.get("skipped_errors", 0),
            "user_id": ctx.user_id,
        })

    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] microcards import execute-text failed: %s", exc)
        return jsonify({"ok": False, "error": "microcards_execute_failed"}), 500
