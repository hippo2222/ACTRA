"""Microcards API V2 endpoints supporting FSRS planning, progressive levels and CSV/JSON import/export."""

import logging
import json
from flask import Blueprint, jsonify, request, Response
from routes._context import get_ctx, get_extra
from services.microcards_service_v2 import MicrocardsServiceV2
from services.workspace_limits_service import PremiumArchivedContentError, WorkspaceLimitError

logger = logging.getLogger(__name__)


def _server_helpers() -> dict:
    """server.py-registered helpers (ai_run access, calendar orchestration).
    Empty in unit tests that mount the blueprint standalone."""
    try:
        helpers = get_extra("microcards_helpers")
        return helpers if isinstance(helpers, dict) else {}
    except Exception:
        return {}


def _notify_calendar_review(deck_id: str, card_id: str, review_event) -> None:
    """Calendar live integration for V2 reviews (plan M2).

    Fires once per SCHEDULED review (submit_answer emits review_event only on
    first attempts / overrides, never on mastery-cycle retries) and must never
    break the review flow itself."""
    if not isinstance(review_event, dict) or not review_event:
        return
    orchestrate = _server_helpers().get("orchestrate_microcards_review_post_submit")
    if not callable(orchestrate):
        return
    try:
        orchestrate(deck_id=str(deck_id or ""), card_id=str(card_id or ""),
                    review_result={"review_event": review_event})
    except Exception as exc:
        logger.warning("[HTTP] v2/microcards calendar live integration failed: %s", exc)

microcards_v2_bp = Blueprint("microcards_v2", __name__)

def _get_svc() -> MicrocardsServiceV2:
    ctx = get_ctx()
    user_id = ctx.user_id if ctx else "default_user"
    data_dir = ctx.data_dir if ctx else "data"
    svc = MicrocardsServiceV2(data_dir=str(data_dir), user_id=user_id)
    # Inject the catalog service so linked decks resolve their read-only cards.
    svc.catalog_service = getattr(ctx, "catalog_service", None) if ctx else None
    return svc

def _get_catalog_svc():
    ctx = get_ctx()
    return getattr(ctx, "catalog_service", None)

def _check_guest():
    ctx = get_ctx()
    if not ctx or ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    return None

# ── Premium plan limit / archive guards ───────────────────────────────
# Decks are a workspace entity like complexes: free plan caps own decks at 4
# and the total (own + linked-from-catalog) at 8; when Premium lapses above the
# cap, the newest decks become read-only "Premium archive". Each helper returns
# a 409 response tuple to return early, or None when the action is allowed.
# No-ops when the limits service is absent (unit tests mounting the blueprint
# standalone) or for Premium/admin users (the service resolves them unlimited).

def _limits_service():
    ctx = get_ctx()
    return getattr(ctx, "workspace_limits_service", None) if ctx else None


def _check_deck_create_limit():
    """Block a new OWN deck once own >= 4 or total >= 8 on the free plan."""
    service = _limits_service()
    if service is None:
        return None
    try:
        service.assert_can_create_workspace_entity(get_ctx().user_id, "deck")
        return None
    except WorkspaceLimitError as exc:
        return jsonify(exc.to_payload()), 409


def _check_linked_deck_limit():
    """Block importing a catalog deck once the library total would exceed 8."""
    service = _limits_service()
    if service is None:
        return None
    try:
        service.assert_can_add_linked_deck(get_ctx().user_id)
        return None
    except WorkspaceLimitError as exc:
        return jsonify(exc.to_payload()), 409


def _check_deck_archived(deck_id, action):
    """Block a mutating action on a deck that sits in the Premium archive.
    No scope filter, so an archived deck is caught whether it is own or linked."""
    service = _limits_service()
    if service is None:
        return None
    try:
        service.assert_entity_not_archived(get_ctx().user_id, "deck", deck_id, action=action)
        return None
    except PremiumArchivedContentError as exc:
        return jsonify(exc.to_payload()), 409


def _revoke_deck_publication_on_delete(svc, deck_id):
    """Author deletes their OWN published deck → mark the catalog publication as
    source-deleted so linked subscribers resolve it as revoked (parity with
    complex/theory source deletion). Best-effort: a catalog hiccup must not fail
    the deck deletion that already happened. Never call this for linked decks —
    those point at someone else's publication."""
    catalog_svc = _get_catalog_svc()
    handler = getattr(catalog_svc, "handle_workspace_source_deleted", None) if catalog_svc else None
    if not callable(handler):
        return None
    try:
        return handler(
            "flashcard_deck",
            owner_user_id=svc.user_id,
            source_workspace_id=deck_id,
            source_workspace_kind="flashcard_deck",
            reason="workspace_source_deleted",
        )
    except Exception as exc:
        logger.warning("[HTTP] v2/microcards deck publication revoke-on-delete failed: %s", exc)
        return None

def _decode_import_bytes(raw: bytes) -> str:
    """Decode uploaded text trying UTF-8 (incl. BOM) first, then common legacy
    Cyrillic encodings — many exported test banks are Windows-1251, not UTF-8.
    """
    if not raw:
        return ""
    if raw[:3] == b"\xef\xbb\xbf":
        return raw[3:].decode("utf-8", errors="replace")
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16", errors="replace")
    for enc in ("utf-8", "cp1251", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _read_import_text(req):
    """Extract raw import text + optional parser options from a multipart file or JSON body."""
    if "file" in req.files:
        f = req.files["file"]
        raw_opts = req.form.get("options")
        opts = None
        if raw_opts:
            try:
                opts = json.loads(raw_opts)
            except Exception:
                opts = None
        return _decode_import_bytes(f.read()), opts
    body = req.get_json(silent=True) or {}
    text = body.get("text")
    if text is None:
        text = _decode_import_bytes(req.data or b"")
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
        
    block = _check_deck_create_limit()
    if block:
        return block

    try:
        svc = _get_svc()
        deck = svc.create_deck(name=name, description=description, tags=tags)
        return jsonify({"ok": True, "deck": deck})
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/decks create failed: %s", exc)
        return jsonify({"ok": False, "error": "create_failed"}), 500

# ── Deck Records (stars + scores, server-side) ───────────────────────────

@microcards_v2_bp.route("/records", methods=["GET"])
def get_all_records():
    """Return all deck records for the current user (used to hydrate localStorage on load)."""
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    try:
        svc = _get_svc()
        records = svc.get_all_records()
        return jsonify({"ok": True, "records": records})
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/records get_all failed: %s", exc)
        return jsonify({"ok": False, "error": "get_records_failed"}), 500

@microcards_v2_bp.route("/records/<string:deck_id>", methods=["GET"])
def get_deck_record_route(deck_id: str):
    """Return record for one deck."""
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    try:
        svc = _get_svc()
        record = svc.get_deck_record(deck_id)
        return jsonify({"ok": True, "record": record})
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/records get failed: %s", exc)
        return jsonify({"ok": False, "error": "get_record_failed"}), 500

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
        
        # Active sessions per slot (review / run_l1 / run_l2) + legacy fields.
        actives = svc._get_active_sessions_for_deck(deck_id)
        deck["active_sessions"] = {
            slot: svc._session_summary_light(sess) for slot, sess in actives.items()
        }
        preferred = None
        for key in ("run_l1", "run_l2", "review"):
            if key in actives:
                preferred = actives[key]
                break
        if preferred is not None:
            light = svc._session_summary_light(preferred)
            deck["is_paused"] = True
            deck["paused_progress"] = f"{light['mastered']}/{light['unique_total']}"
            deck["active_session_id"] = light["session_id"]
            deck["active_session_level_mode"] = preferred.get("level_mode")
        else:
            deck["is_paused"] = False
            deck["paused_progress"] = None
            deck["active_session_id"] = None
            deck["active_session_level_mode"] = None

        # Run-based gate for level 2 (mirrors list_decks summaries)
        record = svc.get_deck_record(deck_id)
        deck["l1_progress"] = record.get("l1_progress")
        deck["l2_unlocked"] = record.get("l2_unlocked", False)
        deck["record"] = {k: record.get(k) for k in (
            "scoreL1", "starsL1", "sizeL1", "scoreL2", "starsL2", "sizeL2", "l1_run_completed")}

        return jsonify({"ok": True, "deck": deck})
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/decks get failed: %s", exc)
        return jsonify({"ok": False, "error": "get_failed"}), 500

@microcards_v2_bp.route("/decks/<string:deck_id>", methods=["PATCH"])
def update_deck(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    block = _check_deck_archived(deck_id, "edit")
    if block:
        return block
    body = request.get_json(silent=True) or {}
    name = body.get("name")
    description = body.get("description")
    tags = body.get("tags")
    direction = body.get("direction")

    try:
        svc = _get_svc()
        deck = svc.update_deck(deck_id=deck_id, name=name, description=description, tags=tags,
                               direction=direction)
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
        # Capture the publication link BEFORE deletion (a deleted deck can't be
        # looked up afterwards). Linked decks reference someone else's
        # publication — never cascade-delete those.
        existing = svc.get_deck(deck_id)
        catalog_item_id = (existing or {}).get("catalog_item_id")
        is_own_publication = bool(catalog_item_id) and not (existing or {}).get("linked")
        deleted = svc.delete_deck(deck_id)
        if not deleted:
            return jsonify({"ok": False, "error": "deck_not_found"}), 404
        source_delete = _revoke_deck_publication_on_delete(svc, deck_id) if is_own_publication else None
        payload = {"ok": True}
        if source_delete is not None:
            payload["catalog_source_delete"] = source_delete
        return jsonify(payload)
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
        cards = svc.list_cards_with_state(deck_id)
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
    block = _check_deck_archived(deck_id, "edit")
    if block:
        return block
    body = request.get_json(silent=True) or {}
    front_text = body.get("front_text")
    back_text = body.get("back_text")
    hint = body.get("hint")
    front_image_url = body.get("front_image_url")
    back_image_url = body.get("back_image_url")
    acceptable_answers = body.get("acceptable_answers")

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
            back_image_url=back_image_url,
            acceptable_answers=acceptable_answers,
            front_image_attribution=body.get("front_image_attribution"),
            back_image_attribution=body.get("back_image_attribution"),
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
    block = _check_deck_archived(deck_id, "edit")
    if block:
        return block
    body = request.get_json(silent=True) or {}
    front_text = body.get("front_text")
    back_text = body.get("back_text")
    hint = body.get("hint")
    front_image_url = body.get("front_image_url")
    back_image_url = body.get("back_image_url")
    status = body.get("status")
    acceptable_answers = body.get("acceptable_answers")

    # Attribution is sent only alongside an image change; omit otherwise so the
    # service leaves it untouched (uses an _UNSET sentinel).
    attr_kwargs = {}
    if "front_image_attribution" in body:
        attr_kwargs["front_image_attribution"] = body.get("front_image_attribution")
    if "back_image_attribution" in body:
        attr_kwargs["back_image_attribution"] = body.get("back_image_attribution")

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
            status=status,
            acceptable_answers=acceptable_answers,
            **attr_kwargs,
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
    block = _check_deck_archived(deck_id, "edit")
    if block:
        return block
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

# ── Image search & import (Openverse → own-origin asset) ──────────────

@microcards_v2_bp.route("/image-search", methods=["GET"])
def image_search():
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    from services import microcards_image_search as imgsvc
    query = request.args.get("q", "")
    try:
        page = int(request.args.get("page", 1))
    except (TypeError, ValueError):
        page = 1
    try:
        result = imgsvc.search_images(query, page=page)
        return jsonify({"ok": True, **result})
    except imgsvc.ImageSearchError as exc:
        logger.warning("[HTTP] image-search upstream failed: %s", exc)
        return jsonify({"ok": False, "error": "search_unavailable"}), 502
    except Exception as exc:
        logger.exception("[HTTP] image-search failed: %s", exc)
        return jsonify({"ok": False, "error": "search_failed"}), 500


@microcards_v2_bp.route("/image-proxy", methods=["GET"])
def image_proxy():
    """Stream a remote thumbnail through our origin so the CSP (img-src 'self')
    allows it in the search grid. SSRF-validated by the fetch helper."""
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    from services import microcards_image_search as imgsvc
    url = request.args.get("url", "")
    try:
        data, mime, _ext = imgsvc.fetch_image(url)
    except imgsvc.ImageFetchError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] image-proxy failed: %s", exc)
        return jsonify({"ok": False, "error": "proxy_failed"}), 500
    resp = Response(data, mimetype=mime)
    resp.headers["Cache-Control"] = "private, max-age=3600"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


@microcards_v2_bp.route("/decks/<string:deck_id>/image-import", methods=["POST"])
def image_import(deck_id: str):
    """Download a chosen image and store it as an own-origin asset; return its
    self-origin URL + attribution to put on a card. Blocked on linked decks."""
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    block = _check_deck_archived(deck_id, "edit")
    if block:
        return block
    import os
    import uuid
    from services import microcards_image_search as imgsvc

    body = request.get_json(silent=True) or {}
    url = body.get("url")
    if not url:
        return jsonify({"ok": False, "error": "url_required"}), 400

    svc = _get_svc()
    deck = svc.get_deck(deck_id)
    if not deck:
        return jsonify({"ok": False, "error": "deck_not_found"}), 404
    if deck.get("linked"):
        return jsonify({"ok": False, "error": "deck_is_linked_readonly"}), 403

    ctx = get_ctx()
    asset_service = getattr(ctx, "asset_service", None) if ctx else None
    if asset_service is None:
        return jsonify({"ok": False, "error": "asset_service_unavailable"}), 503

    try:
        data, _mime, ext = imgsvc.fetch_image(url)
    except imgsvc.ImageFetchError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    attribution = {
        k: body.get(k) for k in ("author", "license", "license_url", "source_page", "source")
        if body.get(k)
    }

    # The asset store only accepts source files inside a managed root, so stage
    # the download under data_dir (it is copied into the blob store on register).
    data_dir = str(getattr(ctx, "data_dir", "data"))
    staging_dir = os.path.join(data_dir, "microcards", "_import_staging")
    os.makedirs(staging_dir, exist_ok=True)
    tmp_path = os.path.join(staging_dir, f"{uuid.uuid4().hex}.{ext}")
    try:
        with open(tmp_path, "wb") as fh:
            fh.write(data)
        asset = asset_service.register_existing_file(
            tmp_path,
            owner_user_id=getattr(ctx, "user_id", None),
            visibility_scope="private_workspace",
            asset_kind="microcard_image",
            original_filename=f"microcard.{ext}",
            metadata={"attribution": attribution} if attribution else None,
        )
    except Exception as exc:
        logger.exception("[HTTP] image-import store failed: %s", exc)
        return jsonify({"ok": False, "error": "store_failed"}), 500
    finally:
        if tmp_path:
            try:
                os.remove(tmp_path)
            except OSError:
                pass

    asset_id = asset.get("asset_id")
    asset_url = asset.get("asset_url") or (asset_service.build_asset_url(asset_id) if asset_id else None)
    if not asset_url:
        return jsonify({"ok": False, "error": "store_failed"}), 500
    return jsonify({"ok": True, "asset_url": asset_url, "attribution": attribution or None})


@microcards_v2_bp.route("/decks/<string:deck_id>/cards/bulk-delete", methods=["POST"])
def bulk_delete_cards(deck_id: str):
    """Delete several cards at once; the response carries everything needed
    for an undo (cards + their original positions)."""
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    block = _check_deck_archived(deck_id, "edit")
    if block:
        return block
    body = request.get_json(silent=True) or {}
    card_ids = body.get("card_ids")
    if not isinstance(card_ids, list) or not card_ids:
        return jsonify({"ok": False, "error": "card_ids_required"}), 400
    try:
        svc = _get_svc()
        result = svc.delete_cards(deck_id, card_ids)
        return jsonify({"ok": True, "deleted": result["deleted"], "remaining": result["remaining"]})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/cards bulk-delete failed: %s", exc)
        return jsonify({"ok": False, "error": "bulk_delete_failed"}), 500


@microcards_v2_bp.route("/decks/<string:deck_id>/cards/bulk-restore", methods=["POST"])
def bulk_restore_cards(deck_id: str):
    """Undo of bulk-delete: re-insert the returned cards at their positions."""
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    block = _check_deck_archived(deck_id, "edit")
    if block:
        return block
    body = request.get_json(silent=True) or {}
    entries = body.get("entries")
    if not isinstance(entries, list) or not entries:
        return jsonify({"ok": False, "error": "entries_required"}), 400
    try:
        svc = _get_svc()
        result = svc.restore_cards(deck_id, entries)
        return jsonify({"ok": True, "restored": result["restored"], "total": result["total"]})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/cards bulk-restore failed: %s", exc)
        return jsonify({"ok": False, "error": "bulk_restore_failed"}), 500


@microcards_v2_bp.route("/decks/<string:deck_id>/cards/reorder", methods=["POST"])
def reorder_cards(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    block = _check_deck_archived(deck_id, "edit")
    if block:
        return block
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
    block = _check_deck_archived(deck_id, "start")
    if block:
        return block
    body = request.get_json(silent=True) or {}
    resume = body.get("resume", True)
    restart = body.get("restart", False)
    direction = body.get("direction")
    mode = body.get("mode")
    level_mode = body.get("level_mode")
    if level_mode is not None:
        try:
            level_mode = int(level_mode)
        except (ValueError, TypeError):
            level_mode = None

    try:
        svc = _get_svc()
        session = svc.start_session(deck_id, resume=resume, restart=restart, direction=direction,
                                    level_mode=level_mode, mode=mode)
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
        payload = {
            "ok": True,
            "is_correct": result["is_correct"],
            "card_state": result["card_state"],
            "session": result["session"],
            "expected_answer": result["expected_answer"],
            "first_attempt": result.get("first_attempt", True),
            "is_retry": result.get("is_retry", False),
        }
        if "deck_l1_progress" in result:
            payload["deck_l1_progress"] = result["deck_l1_progress"]
        if result.get("card_missing"):
            payload["card_missing"] = True
        # Calendar live integration (M2): one ping per scheduled review.
        _notify_calendar_review(
            (result.get("session") or {}).get("deck_id"), card_id, result.get("review_event")
        )
        return jsonify(payload)
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/session answer failed: %s", exc)
        return jsonify({"ok": False, "error": "submit_answer_failed"}), 500

@microcards_v2_bp.route("/session/<string:session_id>/pause", methods=["POST"])
def pause_session(session_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    try:
        svc = _get_svc()
        # Combo/SW already live server-side (scored per answer) — the body
        # carries nothing the server would trust.
        session = svc.pause_session(session_id=session_id)
        return jsonify({"ok": True, "session": session})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/session pause failed: %s", exc)
        return jsonify({"ok": False, "error": "session_pause_failed"}), 500

@microcards_v2_bp.route("/session/<string:session_id>/resume", methods=["POST"])
def resume_session(session_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    try:
        svc = _get_svc()
        session = svc.resume_session(session_id)
        return jsonify({"ok": True, "session": session})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/session resume failed: %s", exc)
        return jsonify({"ok": False, "error": "session_resume_failed"}), 500

@microcards_v2_bp.route("/session/<string:session_id>/abandon", methods=["POST"])
def abandon_session(session_id: str):
    """Exit without saving: a run rolls back to its last checkpoint (pause);
    a never-paused run or a review is discarded."""
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    try:
        svc = _get_svc()
        result = svc.abandon_session(session_id)
        return jsonify({"ok": True, "restored": result["restored"], "session": result["session"]})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/session abandon failed: %s", exc)
        return jsonify({"ok": False, "error": "session_abandon_failed"}), 500


@microcards_v2_bp.route("/session/<string:session_id>/finish", methods=["POST"])
def finish_session(session_id: str):
    """Close out a completed session: stars, score and combo are the
    server-tracked values — nothing is taken from the client."""
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    try:
        svc = _get_svc()
        result = svc.finish_session(session_id)
        return jsonify({"ok": True, "result": result})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/session finish failed: %s", exc)
        return jsonify({"ok": False, "error": "session_finish_failed"}), 500


@microcards_v2_bp.route("/session/<string:session_id>/discard", methods=["POST"])
def discard_session(session_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    try:
        svc = _get_svc()
        session = svc.discard_session(session_id)
        return jsonify({"ok": True, "session": session})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/session discard failed: %s", exc)
        return jsonify({"ok": False, "error": "session_discard_failed"}), 500


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
    block = _check_deck_archived(deck_id, "import")
    if block:
        return block
        
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
    block = _check_deck_archived(deck_id, "import")
    if block:
        return block
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
    block = _check_deck_archived(deck_id, "import")
    if block:
        return block
        
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
    block = _check_deck_archived(deck_id, "import")
    if block:
        return block
        
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

@microcards_v2_bp.route("/decks/<string:deck_id>/import/auto", methods=["POST"])
def import_auto(deck_id: str):
    """Detect the format from pasted content and import with the matching parser."""
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    block = _check_deck_archived(deck_id, "import")
    if block:
        return block

    text_content, options = _read_import_text(request)
    if not text_content.strip():
        return jsonify({"ok": False, "error": "text_content_required"}), 400

    try:
        svc = _get_svc()
        result = svc.import_auto(deck_id, text_content, options=options)
        return jsonify({"ok": True, "added_count": len(result["items"]),
                        "skipped_duplicates": result["skipped_duplicates"],
                        "detected_format": result.get("detected_format"), "items": result["items"]})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/import auto failed: %s", exc)
        return jsonify({"ok": False, "error": "auto_import_failed"}), 500

@microcards_v2_bp.route("/decks/<string:deck_id>/import/test", methods=["POST"])
def import_test_format(deck_id: str):
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    block = _check_deck_archived(deck_id, "import")
    if block:
        return block
        
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

def _load_analysis_rows_for_request(body: dict):
    """Shared prologue for the from-analysis endpoints: validate ai_run_id,
    load + sanitize the stored analysis, convert to importer rows (D2)."""
    from services.microcards_analysis_import import analysis_to_rows

    h = _server_helpers()
    # AI placeholder contract: while ai_mode is off, every AI-driven surface
    # answers with the same hidden-feature payload (carried over from V1).
    is_enabled = h.get("is_editor_feature_enabled")
    disabled_json = h.get("feature_disabled_json")
    if callable(is_enabled) and callable(disabled_json) and not is_enabled("ai_mode"):
        return None, None, disabled_json("ai_mode_in_progress", status_code=404)
    run_id = str(body.get("ai_run_id") or "").strip()
    if not run_id:
        return None, None, (jsonify({"ok": False, "error": "ai_run_id_required"}), 400)
    is_valid = h.get("is_valid_ai_run_id")
    if callable(is_valid) and not is_valid(run_id):
        return None, None, (jsonify({"ok": False, "error": "invalid_ai_run_id"}), 400)
    build_analysis = h.get("ai_run_build_reopen_analysis_response")
    if not callable(build_analysis):
        return None, None, (jsonify({"ok": False, "error": "analysis_helpers_unavailable"}), 503)
    analysis_payload = build_analysis(run_id, apply_feature_flags=False)
    if analysis_payload is None:
        return None, None, (jsonify({"ok": False, "error": "analysis_not_found"}), 404)
    sanitize = h.get("sanitize_analysis_for_microcards_backend")
    if callable(sanitize):
        analysis_payload = sanitize(analysis_payload)

    selector = body.get("selector") if isinstance(body.get("selector"), dict) else {}
    rows = analysis_to_rows(analysis_payload, selector)
    if not any(r.get("status") == "ok" for r in rows):
        return None, None, (jsonify({"ok": False, "error": "no_cards_in_selection"}), 400)
    return run_id, (selector, rows), None


@microcards_v2_bp.route("/decks/from-analysis", methods=["POST"])
def create_deck_from_analysis_v2():
    """Editor flow: build a V2 deck from a stored AI analysis (plan M1).
    Pair-match candidates are flattened into ordinary Q/A cards (D2)."""
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    body = request.get_json(silent=True) or {}
    run_id, loaded, error = _load_analysis_rows_for_request(body)
    if error:
        return error
    selector, rows = loaded
    block = _check_deck_create_limit()
    if block:
        return block
    try:
        from services.microcards_analysis_import import deck_name_for_analysis
        svc = _get_svc()
        name = deck_name_for_analysis(run_id, selector, body.get("name"))
        deck = svc.create_deck(name=name, description="", tags=["analysis"])
        result = svc._create_from_parsed(deck["id"], rows, dedup=True)
        deck = svc.get_deck(deck["id"])
        emit = _server_helpers().get("emit_theory_rollout_telemetry")
        if callable(emit):
            try:
                emit("microcards_deck_created_from_analysis",
                     ai_run_id=run_id, deck_id=deck.get("id"),
                     cards_total=len(deck.get("cards") or []))
            except Exception:
                pass
        return jsonify({
            "ok": True,
            "deck": deck,
            "deck_summary": {
                "id": deck.get("id"),
                "name": deck.get("name"),
                "cards_total": len(deck.get("cards") or []),
                "selector": selector,
            },
            "added_count": len(result["items"]),
            "skipped_duplicates": result.get("skipped_duplicates", 0),
        })
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/decks from-analysis failed: %s", exc)
        return jsonify({"ok": False, "error": "microcards_create_failed"}), 500


@microcards_v2_bp.route("/decks/<string:deck_id>/append-from-analysis", methods=["POST"])
def append_deck_from_analysis_v2(deck_id: str):
    """Editor flow: append analysis cards to an existing V2 deck (dedup on)."""
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    block = _check_deck_archived(deck_id, "import")
    if block:
        return block
    body = request.get_json(silent=True) or {}
    _run_id, loaded, error = _load_analysis_rows_for_request(body)
    if error:
        return error
    _selector, rows = loaded
    try:
        svc = _get_svc()
        result = svc._create_from_parsed(deck_id, rows, dedup=True)
        deck = svc.get_deck(deck_id)
        emit = _server_helpers().get("emit_theory_rollout_telemetry")
        if callable(emit):
            try:
                emit("microcards_deck_appended_from_analysis",
                     ai_run_id=_run_id, deck_id=deck_id,
                     added_count=len(result["items"]))
            except Exception:
                pass
        return jsonify({
            "ok": True,
            "deck_summary": {
                "id": deck_id,
                "name": (deck or {}).get("name"),
                "cards_total": len((deck or {}).get("cards") or []),
            },
            "added_count": len(result["items"]),
            "skipped_duplicates": result.get("skipped_duplicates", 0),
        })
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/decks append-from-analysis failed: %s", exc)
        return jsonify({"ok": False, "error": "microcards_append_failed"}), 500


@microcards_v2_bp.route("/decks/<string:deck_id>/import/file", methods=["POST"])
def import_binary_file(deck_id: str):
    """Import a binary upload (.apkg Anki export / .docx Word document)."""
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    block = _check_deck_archived(deck_id, "import")
    if block:
        return block
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "file_required"}), 400
    f = request.files["file"]
    fname = (f.filename or "").lower()
    raw_opts = request.form.get("options")
    try:
        options = json.loads(raw_opts) if raw_opts else None
    except Exception:
        options = None
    try:
        svc = _get_svc()
        result = svc.import_file(deck_id, fname, f.read(), options=options)
        return jsonify({"ok": True, "added_count": len(result["items"]),
                        "skipped_duplicates": result.get("skipped_duplicates", 0)})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/import file failed: %s", exc)
        return jsonify({"ok": False, "error": "file_import_failed"}), 500


@microcards_v2_bp.route("/import/analyze", methods=["POST"])
def import_analyze_deckless():
    """Deck-independent dry-run parse (editor text-import preview): same rows
    and counts as the deck-scoped analyze, just without duplicate marking."""
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    body = request.get_json(silent=True) or {}
    fmt = body.get("format") or "auto"
    content = body.get("content")
    if content is None or not str(content).strip():
        return jsonify({"ok": False, "error": "content_required"}), 400
    try:
        svc = _get_svc()
        detected = svc._detect_format(content) if str(fmt) == "auto" else str(fmt)
        parsed = svc._parse_by_format(fmt, content, body.get("options"))
        result = svc._preview_parsed({"cards": []}, parsed)
        return jsonify({"ok": True, "rows": result["rows"], "counts": result["counts"],
                        "detected_format": detected})
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/import analyze (deckless) failed: %s", exc)
        return jsonify({"ok": False, "error": "analyze_failed"}), 500


@microcards_v2_bp.route("/decks/<string:deck_id>/import/analyze", methods=["POST"])
def import_analyze(deck_id: str):
    """Dry-run preview: parse content with given format/options, no cards are created."""
    guest_check = _check_guest()
    if guest_check:
        return guest_check

    # Preview supports a multipart file upload too, so it decodes (e.g. cp1251)
    # exactly like the real import instead of relying on the browser reading text.
    if "file" in request.files:
        f = request.files["file"]
        raw_opts = request.form.get("options")
        try:
            options = json.loads(raw_opts) if raw_opts else None
        except Exception:
            options = None
        # Binary formats (.apkg / .docx) are routed by extension — the tab
        # selection doesn't matter for them.
        fname = (f.filename or "").lower()
        if fname.endswith(MicrocardsServiceV2.FILE_IMPORT_EXTENSIONS):
            try:
                svc = _get_svc()
                result = svc.analyze_file_import(deck_id, fname, f.read(), options=options)
                return jsonify({"ok": True, "rows": result["rows"], "counts": result["counts"],
                                "detected_format": result.get("detected_format"),
                                "hierarchy": result.get("hierarchy")})
            except LookupError as exc:
                return jsonify({"ok": False, "error": str(exc)}), 404
            except ValueError as exc:
                return jsonify({"ok": False, "error": str(exc)}), 400
            except Exception as exc:
                logger.exception("[HTTP] v2/microcards/import analyze (file) failed: %s", exc)
                return jsonify({"ok": False, "error": "analyze_failed"}), 500
        content = _decode_import_bytes(f.read())
        fmt = request.form.get("format")
    else:
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
        return jsonify({"ok": True, "rows": result["rows"], "counts": result["counts"],
                        "detected_format": result.get("detected_format"), "hierarchy": result.get("hierarchy")})
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
        
    block = _check_deck_create_limit()
    if block:
        return block

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
    block = _check_deck_archived(deck_id, "publish")
    if block:
        return block
        
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
        if deck.get("linked"):
            return jsonify({"ok": False, "error": "cannot_publish_linked_deck"}), 400

        publish_result = catalog_svc.publish_deck(
            deck_id=deck_id,
            deck_data=deck,
            requested_by_user_id=svc.user_id,
            catalog_visibility=catalog_visibility
        )
        
        # Denormalize catalog reference + visibility + access code onto the deck so
        # the UI shows the publication status without a separate catalog lookup.
        item = publish_result.get("item", {}) or {}
        catalog_item_id = item.get("item_id")
        if catalog_item_id:
            deck = svc.update_deck(
                deck_id,
                catalog_item_id=catalog_item_id,
                catalog_visibility=item.get("catalog_visibility"),
                access_code=(item.get("access_code") or ""),
            )

        return jsonify({"ok": True, "publish": publish_result, "deck": deck})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/publish failed: %s", exc)
        return jsonify({"ok": False, "error": "publish_failed"}), 500

@microcards_v2_bp.route("/catalog/import-by-code", methods=["POST"])
def import_deck_by_access_code():
    """Import a deck into the user's library by its catalog access code."""
    guest_check = _check_guest()
    if guest_check:
        return guest_check

    body = request.get_json(silent=True) or {}
    access_code = str(body.get("access_code") or "").strip()
    if not access_code:
        return jsonify({"ok": False, "error": "access_code_required"}), 400

    catalog_svc = _get_catalog_svc()
    if not catalog_svc:
        return jsonify({"ok": False, "error": "catalog_service_not_available"}), 503

    try:
        svc = _get_svc()
        resolved = catalog_svc.resolve_access_code(access_code, requested_by_user_id=svc.user_id)
        item = resolved.get("item") or {}
        item_id = item.get("item_id")
        if str(item.get("content_type") or "") != "flashcard_deck":
            return jsonify({"ok": False, "error": "not_a_flashcard_deck"}), 400

        existing = svc.find_deck_by_catalog_item_id(item_id)
        if existing:
            return jsonify({"ok": True, "deck": existing, "added_count": 0, "already_in_library": True})

        block = _check_linked_deck_limit()
        if block:
            return block

        result = catalog_svc.add_item_to_library(item_id, requested_by_user_id=svc.user_id, access_code=access_code)
        snapshot = result.get("snapshot") or {}
        # Add a read-only LINK (not a copy), like complex/theory library entries.
        deck = svc.create_linked_deck(
            item_id, snapshot,
            author_name=item.get("owner_display_name") or item.get("owner_user_id"),
            author_user_id=item.get("owner_user_id"),
            granted_access_code=access_code,
        )
        return jsonify({"ok": True, "deck": deck, "added_count": deck.get("card_count", 0),
                        "already_in_library": False, "linked": True})
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/catalog import-by-code failed: %s", exc)
        return jsonify({"ok": False, "error": "catalog_import_by_code_failed"}), 500

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
        # Don't create a duplicate if this catalog deck is already in the library.
        existing = svc.find_deck_by_catalog_item_id(catalog_item_id)
        if existing:
            return jsonify({"ok": True, "deck": existing, "added_count": 0, "already_in_library": True})

        block = _check_linked_deck_limit()
        if block:
            return block

        result = catalog_svc.add_item_to_library(catalog_item_id, requested_by_user_id=svc.user_id)
        snapshot = result.get("snapshot") or {}
        item = result.get("item") or {}

        # Add a read-only LINK (not a copy), like complex/theory library entries.
        deck = svc.create_linked_deck(
            catalog_item_id, snapshot,
            author_name=item.get("owner_display_name") or item.get("owner_user_id"),
            author_user_id=item.get("owner_user_id"),
        )
        return jsonify({"ok": True, "deck": deck, "added_count": deck.get("card_count", 0),
                        "already_in_library": False, "linked": True})
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/catalog import failed: %s", exc)
        return jsonify({"ok": False, "error": "catalog_import_failed"}), 500

@microcards_v2_bp.route("/catalog/<string:catalog_item_id>/library-status", methods=["GET"])
def catalog_deck_library_status(catalog_item_id: str):
    """Report whether the current user already imported this catalog deck."""
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    try:
        svc = _get_svc()
        deck = svc.find_deck_by_catalog_item_id(catalog_item_id)
        return jsonify({"ok": True, "already_in_library": bool(deck), "deck_id": deck.get("id") if deck else None})
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/catalog library-status failed: %s", exc)
        return jsonify({"ok": False, "error": "library_status_failed"}), 500

# ── Settings ──────────────────────────────────────────────────────────

@microcards_v2_bp.route("/settings", methods=["POST"])
def update_v2_settings():
    """Update the user-facing study settings (pace preset + daily goal)."""
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    body = request.get_json(silent=True) or {}
    try:
        svc = _get_svc()
        settings = svc.update_settings(
            daily_load=body.get("daily_load"),
            daily_goal=body.get("daily_goal"),
        )
        return jsonify({"ok": True, "settings": settings})
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/settings update failed: %s", exc)
        return jsonify({"ok": False, "error": "settings_update_failed"}), 500


@microcards_v2_bp.route("/settings", methods=["GET"])
def get_v2_settings():
    guest_check = _check_guest()
    if guest_check:
        return guest_check
    try:
        svc = _get_svc()
        return jsonify({"ok": True, "settings": svc.get_settings()})
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/settings get failed: %s", exc)
        return jsonify({"ok": False, "error": "settings_failed"}), 500

# Study settings are no longer user-configurable — every deck uses the universal
# defaults (MicrocardsServiceV2.DEFAULT_SETTINGS). The GET above stays so the
# frontend can hydrate them read-only; there is intentionally no PATCH endpoint.

# ── Summary Statistics ────────────────────────────────────────────────

@microcards_v2_bp.route("/analytics", methods=["GET"])
def get_v2_analytics():
    guest_check = _check_guest()
    if guest_check:
        return guest_check

    try:
        svc = _get_svc()
        data = svc.get_analytics()
        return jsonify({"ok": True, **data})
    except Exception as exc:
        logger.exception("[HTTP] v2/microcards/analytics failed: %s", exc)
        return jsonify({"ok": False, "error": "analytics_failed"}), 500

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
