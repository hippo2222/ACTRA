"""Microcards API V2 endpoints supporting FSRS planning, progressive levels and CSV/JSON import/export."""

import logging
import json
from flask import Blueprint, jsonify, request, Response
from routes._context import get_ctx
from services.microcards_service_v2 import MicrocardsServiceV2

logger = logging.getLogger(__name__)

microcards_v2_bp = Blueprint("microcards_v2", __name__)

def _get_svc() -> MicrocardsServiceV2:
    ctx = get_ctx()
    user_id = ctx.user_id if ctx else "default_user"
    data_dir = ctx.data_dir if ctx else "data"
    return MicrocardsServiceV2(data_dir=str(data_dir), user_id=user_id)

def _get_catalog_svc():
    ctx = get_ctx()
    return getattr(ctx, "catalog_service", None)

def _check_guest():
    ctx = get_ctx()
    if not ctx or ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    return None

# ── Decks CRUD ────────────────────────────────────────────────────────


def _read_import_text(req):
    """Extract raw import text + optional parser options from a multipart file or JSON body."""
    if "file" in req.files:
        f = req.files["file"]
        return f.read().decode("utf-8", errors="ignore"), None
    body = req.get_json(silent=True) or {}
    text = body.get("text") or req.data.decode("utf-8", errors="ignore")
    return text, body.get("options")

# ── Decks CRUD ────────────────────────────────────────────────────────

@microcards_v2_bp.route("/decks", methods=["GET"])
def list_decks():
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    try:
        limit = max(1, min(int(request.args.get("limit") or 100), 500))
    except Exception:
        limit = 100
        
    try:
        svc = _get_svc()
        decks = svc.list_decks(limit=limit)
        return jsonify({"ok": True, "items": decks})
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/decks list failed: %s", exc)
        return jsonify({"ok": False, "error": "list_failed"}), 500

@microcards_v2_bp.route("/decks", methods=["POST"])
def create_deck():
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    body = request.get_json(silent=True) or {}
    name = body.get("name")
    description = body.get("description", "")
    tags = body.get("tags") or []
    
    if not name:
        return jsonify({"ok": False, "error": "name_required"}), 400
        
    try:
        svc = _get_svc()
        deck = svc.create_deck(name=name, description=description, tags=tags)
        return jsonify({"ok": True, "deck": deck})
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/decks create failed: %s", exc)
        return jsonify({"ok": False, "error": "create_failed"}), 500

@microcards_v2_bp.route("/decks/<string:deck_id>", methods=["GET"])
def get_deck(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    try:
        svc = _get_svc()
        deck = svc.get_deck(deck_id)
        if not deck:
            return jsonify({"ok": False, "error": "deck_not_found"}), 404
        return jsonify({"ok": True, "deck": deck})
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/decks get failed: %s", exc)
        return jsonify({"ok": False, "error": "get_failed"}), 500

@microcards_v2_bp.route("/decks/<string:deck_id>", methods=["PATCH"])
def update_deck(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    body = request.get_json(silent=True) or {}
    name = body.get("name")
    description = body.get("description")
    tags = body.get("tags")
    
    try:
        svc = _get_svc()
        deck = svc.update_deck(deck_id=deck_id, name=name, description=description, tags=tags)
        return jsonify({"ok": True, "deck": deck})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/decks update failed: %s", exc)
        return jsonify({"ok": False, "error": "update_failed"}), 500

@microcards_v2_bp.route("/decks/<string:deck_id>", methods=["DELETE"])
def delete_deck(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    try:
        svc = _get_svc()
        deleted = svc.delete_deck(deck_id)
        if not deleted:
            return jsonify({"ok": False, "error": "deck_not_found"}), 404
        return jsonify({"ok": True})
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/decks delete failed: %s", exc)
        return jsonify({"ok": False, "error": "delete_failed"}), 500

# ── Cards CRUD ────────────────────────────────────────────────────────

@microcards_v2_bp.route("/decks/<string:deck_id>/cards", methods=["GET"])
def list_cards(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    try:
        svc = _get_svc()
        cards = svc.list_cards(deck_id)
        return jsonify({"ok": True, "items": cards})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/cards list failed: %s", exc)
        return jsonify({"ok": False, "error": "list_failed"}), 500

@microcards_v2_bp.route("/decks/<string:deck_id>/cards", methods=["POST"])
def create_card(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    body = request.get_json(silent=True) or {}
    front_text = body.get("front_text")
    back_text = body.get("back_text")
    hint = body.get("hint")
    front_image_url = body.get("front_image_url")
    back_image_url = body.get("back_image_url")
    
    if not front_text or not back_text:
        return jsonify({"ok": False, "error": "front_text_and_back_text_required"}), 400
        
    try:
        svc = _get_svc()
        card = svc.create_card(
            deck_id=deck_id,
            front_text=front_text,
            back_text=back_text,
            hint=hint,
            front_image_url=front_image_url,
            back_image_url=back_image_url
        )
        return jsonify({"ok": True, "card": card})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/cards create failed: %s", exc)
        return jsonify({"ok": False, "error": "create_failed"}), 500

@microcards_v2_bp.route("/decks/<string:deck_id>/cards/<string:card_id>", methods=["PATCH"])
def update_card(deck_id: str, card_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    body = request.get_json(silent=True) or {}
    front_text = body.get("front_text")
    back_text = body.get("back_text")
    hint = body.get("hint")
    front_image_url = body.get("front_image_url")
    back_image_url = body.get("back_image_url")
    status = body.get("status")
    
    try:
        svc = _get_svc()
        card = svc.update_card(
            deck_id=deck_id,
            card_id=card_id,
            front_text=front_text,
            back_text=back_text,
            hint=hint,
            front_image_url=front_image_url,
            back_image_url=back_image_url,
            status=status
        )
        return jsonify({"ok": True, "card": card})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/cards update failed: %s", exc)
        return jsonify({"ok": False, "error": "update_failed"}), 500

@microcards_v2_bp.route("/decks/<string:deck_id>/cards/<string:card_id>", methods=["DELETE"])
def delete_card(deck_id: str, card_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    try:
        svc = _get_svc()
        deleted = svc.delete_card(deck_id, card_id)
        if not deleted:
            return jsonify({"ok": False, "error": "card_not_found"}), 404
        return jsonify({"ok": True})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/cards delete failed: %s", exc)
        return jsonify({"ok": False, "error": "delete_failed"}), 500

@microcards_v2_bp.route("/decks/<string:deck_id>/cards/reorder", methods=["POST"])
def reorder_cards(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    body = request.get_json(silent=True) or {}
    card_ids = body.get("card_ids")
    if not isinstance(card_ids, list):
        return jsonify({"ok": False, "error": "card_ids_list_required"}), 400
        
    try:
        svc = _get_svc()
        deck = svc.reorder_cards(deck_id, card_ids)
        return jsonify({"ok": True, "deck": deck})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/cards reorder failed: %s", exc)
        return jsonify({"ok": False, "error": "reorder_failed"}), 500

# ── Session Management ────────────────────────────────────────────────

@microcards_v2_bp.route("/decks/<string:deck_id>/session/start", methods=["POST"])
def start_session(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    body = request.get_json(silent=True) or {}
    resume = body.get("resume", True)
    restart = body.get("restart", False)
    
    try:
        svc = _get_svc()
        session = svc.start_session(deck_id, resume=resume, restart=restart)
        return jsonify({"ok": True, "session": session})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/session start failed: %s", exc)
        return jsonify({"ok": False, "error": "session_start_failed"}), 500

@microcards_v2_bp.route("/session/<string:session_id>/answer", methods=["POST"])
def submit_answer(session_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    body = request.get_json(silent=True) or {}
    card_id = body.get("card_id")
    user_answer = body.get("user_answer", "")
    override = body.get("override", False)
    
    if not card_id:
        return jsonify({"ok": False, "error": "card_id_required"}), 400
        
    try:
        svc = _get_svc()
        result = svc.submit_answer(
            session_id=session_id,
            card_id=card_id,
            user_answer=user_answer,
            override=override
        )
        return jsonify({
            "ok": True,
            "is_correct": result["is_correct"],
            "card_state": result["card_state"],
            "session": result["session"],
            "expected_answer": result["expected_answer"]
        })
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/session answer failed: %s", exc)
        return jsonify({"ok": False, "error": "submit_answer_failed"}), 500

@microcards_v2_bp.route("/session/<string:session_id>/summary", methods=["GET"])
def get_session_summary(session_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    try:
        svc = _get_svc()
        summary = svc.get_session_summary(session_id)
        return jsonify({"ok": True, "session": summary})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/session summary failed: %s", exc)
        return jsonify({"ok": False, "error": "get_summary_failed"}), 500

# ── CSV / JSON Import and Export ──────────────────────────────────────

@microcards_v2_bp.route("/decks/<string:deck_id>/import/csv", methods=["POST"])
def import_csv(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
        
    csv_content = ""
    options = None
    if "file" in request.files:
        f = request.files["file"]
        csv_content = f.read().decode("utf-8", errors="ignore")
    else:
        body = request.get_json(silent=True) or {}
        csv_content = body.get("csv_content") or request.data.decode("utf-8", errors="ignore")
        options = body.get("options")

    if not csv_content.strip():
        return jsonify({"ok": False, "error": "csv_content_required"}), 400

    try:
        svc = _get_svc()
        result = svc.import_csv(deck_id, csv_content, options=options)
        return jsonify({"ok": True, "added_count": len(result["items"]),
                        "skipped_duplicates": result["skipped_duplicates"], "items": result["items"]})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/import csv failed: %s", exc)
        return jsonify({"ok": False, "error": "csv_import_failed"}), 500

@microcards_v2_bp.route("/decks/<string:deck_id>/import/json", methods=["POST"])
def import_json(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"ok": False, "error": "json_data_required"}), 400

    try:
        svc = _get_svc()
        result = svc.import_json(deck_id, body)
        return jsonify({"ok": True, "added_count": len(result["items"]),
                        "skipped_duplicates": result["skipped_duplicates"], "items": result["items"]})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/import json failed: %s", exc)
        return jsonify({"ok": False, "error": "json_import_failed"}), 500

@microcards_v2_bp.route("/decks/<string:deck_id>/import/txt_full", methods=["POST"])
def import_txt_full(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
        
    text_content, options = _read_import_text(request)
    if not text_content.strip():
        return jsonify({"ok": False, "error": "text_content_required"}), 400

    try:
        svc = _get_svc()
        result = svc.import_txt_full(deck_id, text_content, options=options)
        return jsonify({"ok": True, "added_count": len(result["items"]),
                        "skipped_duplicates": result["skipped_duplicates"], "items": result["items"]})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/import txt_full failed: %s", exc)
        return jsonify({"ok": False, "error": "txt_full_import_failed"}), 500

@microcards_v2_bp.route("/decks/<string:deck_id>/import/txt_simplified", methods=["POST"])
def import_txt_simplified(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
        
    text_content, options = _read_import_text(request)
    if not text_content.strip():
        return jsonify({"ok": False, "error": "text_content_required"}), 400

    try:
        svc = _get_svc()
        result = svc.import_txt_simplified(deck_id, text_content, options=options)
        return jsonify({"ok": True, "added_count": len(result["items"]),
                        "skipped_duplicates": result["skipped_duplicates"], "items": result["items"]})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/import txt_simplified failed: %s", exc)
        return jsonify({"ok": False, "error": "txt_simplified_import_failed"}), 500

@microcards_v2_bp.route("/decks/<string:deck_id>/import/test", methods=["POST"])
def import_test_format(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
        
    text_content, options = _read_import_text(request)
    if not text_content.strip():
        return jsonify({"ok": False, "error": "text_content_required"}), 400

    try:
        svc = _get_svc()
        result = svc.import_test(deck_id, text_content, options=options)
        return jsonify({"ok": True, "added_count": len(result["items"]),
                        "skipped_duplicates": result["skipped_duplicates"], "items": result["items"]})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/import test failed: %s", exc)
        return jsonify({"ok": False, "error": "test_import_failed"}), 500

@microcards_v2_bp.route("/decks/<string:deck_id>/import/analyze", methods=["POST"])
def import_analyze(deck_id: str):
    """Dry-run preview: parse content with given format/options, no cards are created."""
    guest_check = _check_guest()
    if guest_check:
        return guest_check

    body = request.get_json(silent=True) or {}
    fmt = body.get("format")
    content = body.get("content")
    options = body.get("options")
    if not fmt:
        return jsonify({"ok": False, "error": "format_required"}), 400
    if content is None or not str(content).strip():
        return jsonify({"ok": False, "error": "content_required"}), 400

    try:
        svc = _get_svc()
        result = svc.analyze_import(deck_id, fmt, content, options=options)
        return jsonify({"ok": True, "rows": result["rows"], "counts": result["counts"]})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/import analyze failed: %s", exc)
        return jsonify({"ok": False, "error": "analyze_failed"}), 500

@microcards_v2_bp.route("/decks/import/csv", methods=["POST"])
def import_csv_to_new_deck():
    guest_check = _check_guest()
    if guest_check:
        return guest_check
        
    csv_content = ""
    deck_name = request.form.get("name")
    
    if "file" in request.files:
        f = request.files["file"]
        csv_content = f.read().decode("utf-8", errors="ignore")
        if not deck_name:
            # strip extension
            filename = f.filename or "New CSV Deck"
            if "." in filename:
                deck_name = filename.rsplit(".", 1)[0]
            else:
                deck_name = filename
    else:
        body = request.get_json(silent=True) or {}
        csv_content = body.get("csv_content") or ""
        deck_name = body.get("name")
        
    if not csv_content.strip():
        return jsonify({"ok": False, "error": "csv_content_required"}), 400
    if not deck_name:
        deck_name = "Imported CSV Deck"
        
    try:
        svc = _get_svc()
        deck = svc.create_deck(name=deck_name)
        result = svc.import_csv(deck["id"], csv_content, dedup=False)
        return jsonify({"ok": True, "deck": deck, "added_count": len(result["items"]), "items": result["items"]})
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/import csv to new deck failed: %s", exc)
        return jsonify({"ok": False, "error": "csv_import_failed"}), 500

@microcards_v2_bp.route("/decks/<string:deck_id>/export/json", methods=["GET"])
def export_json(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    try:
        svc = _get_svc()
        data = svc.export_json(deck_id)
        response_payload = json.dumps(data, ensure_ascii=False, indent=2)
        return Response(
            response_payload,
            mimetype="application/json",
            headers={"Content-Disposition": f"attachment;filename=deck_{deck_id}.json"}
        )
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/export json failed: %s", exc)
        return jsonify({"ok": False, "error": "json_export_failed"}), 500

@microcards_v2_bp.route("/decks/<string:deck_id>/export/csv", methods=["GET"])
def export_csv(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    try:
        svc = _get_svc()
        csv_data = svc.export_csv(deck_id)
        return Response(
            csv_data,
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment;filename=deck_{deck_id}.csv"}
        )
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/export csv failed: %s", exc)
        return jsonify({"ok": False, "error": "csv_export_failed"}), 500

@microcards_v2_bp.route("/decks/<string:deck_id>/export/txt", methods=["GET"])
def export_txt(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    try:
        svc = _get_svc()
        txt_data = svc.export_txt(deck_id)
        return Response(
            txt_data,
            mimetype="text/plain; charset=utf-8",
            headers={"Content-Disposition": f"attachment;filename=deck_{deck_id}.txt"}
        )
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/export txt failed: %s", exc)
        return jsonify({"ok": False, "error": "txt_export_failed"}), 500

# ── Catalog Integration ───────────────────────────────────────────────

@microcards_v2_bp.route("/decks/<string:deck_id>/publish", methods=["POST"])
def publish_deck_to_catalog(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
        
    body = request.get_json(silent=True) or {}
    catalog_visibility = body.get("catalog_visibility")
    
    catalog_svc = _get_catalog_svc()
    if not catalog_svc:
        return jsonify({"ok": False, "error": "catalog_service_not_available"}), 503
        
    try:
        svc = _get_svc()
        deck = svc.get_deck(deck_id)
        if not deck:
            return jsonify({"ok": False, "error": "deck_not_found"}), 404
            
        publish_result = catalog_svc.publish_deck(
            deck_id=deck_id,
            deck_data=deck,
            requested_by_user_id=svc.user_id,
            catalog_visibility=catalog_visibility
        )
        
        # Update deck catalog item ID reference
        catalog_item_id = publish_result.get("item", {}).get("item_id")
        if catalog_item_id:
            deck = svc.update_deck(deck_id, catalog_item_id=catalog_item_id)
            
        return jsonify({"ok": True, "publish": publish_result, "deck": deck})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/publish failed: %s", exc)
        return jsonify({"ok": False, "error": "publish_failed"}), 500

@microcards_v2_bp.route("/catalog/<string:catalog_item_id>/import", methods=["POST"])
def import_deck_from_catalog(catalog_item_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
        
    catalog_svc = _get_catalog_svc()
    if not catalog_svc:
        return jsonify({"ok": False, "error": "catalog_service_not_available"}), 503
        
    try:
        svc = _get_svc()
        result = catalog_svc.add_item_to_library(catalog_item_id, requested_by_user_id=svc.user_id)
        snapshot = result.get("snapshot") or {}
        
        # Check if user already has this deck or if we should create a new one
        # Let's create a new deck copied from snapshot
        deck = svc.create_deck(
            name=snapshot.get("name") or "Imported Deck",
            description=snapshot.get("description") or "",
            tags=snapshot.get("tags") or [],
            catalog_item_id=catalog_item_id
        )
        
        # Import the cards from the snapshot
        cards = svc.import_json(deck["id"], snapshot)
        
        return jsonify({"ok": True, "deck": deck, "added_count": len(cards)})
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/catalog import failed: %s", exc)
        return jsonify({"ok": False, "error": "catalog_import_failed"}), 500

# ── Summary Statistics ────────────────────────────────────────────────

@microcards_v2_bp.route("/summary", methods=["GET"])
def get_v2_summary():
    guest_check = _check_guest()
    if guest_check:
        return guest_check
        
    try:
        svc = _get_svc()
        decks = svc.list_decks()
        total_decks = len(decks)
        total_cards = sum(d.get("card_count", 0) for d in decks)
        due_cards = sum(d.get("due_count", 0) for d in decks)
        new_cards = sum(d.get("new_count", 0) for d in decks)
        
        # Simple summary payload
        return jsonify({
            "ok": True,
            "total_decks": total_decks,
            "total_cards": total_cards,
            "due_cards": due_cards,
            "new_cards": new_cards
        })
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/summary failed: %s", exc)
        return jsonify({"ok": False, "error": "summary_failed"}), 500
