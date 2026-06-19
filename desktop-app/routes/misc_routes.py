"""Miscellaneous app-level routes: welcome, legal, consent, network, update, feedback, evaluation."""

import logging
import os
from typing import Any, Dict

from flask import Blueprint, jsonify, request

from routes._context import get_authenticated_user_id, get_ctx, get_extra, is_hosted_web_runtime

logger = logging.getLogger(__name__)

misc_bp = Blueprint("misc", __name__)


def _env_bool(name: str, default: bool = False) -> bool:
    raw = str(os.environ.get(name) or "").strip().lower()
    if not raw:
        return bool(default)
    return raw in {"1", "true", "yes", "on"}


def _auth_providers_payload() -> Dict[str, Any]:
    google_enabled = (
        _env_bool("ACTRA_GOOGLE_AUTH_ENABLED", False)
        and bool(str(os.environ.get("ACTRA_GOOGLE_CLIENT_ID") or "").strip())
        and bool(str(os.environ.get("ACTRA_GOOGLE_CLIENT_SECRET") or "").strip())
    )
    return {
        "google": {
            "enabled": google_enabled,
            "configured": google_enabled,
            "hosted_domain": str(
                os.environ.get("ACTRA_GOOGLE_HOSTED_DOMAIN")
                or os.environ.get("ACTRA_GOOGLE_HD")
                or ""
            ).strip().lower(),
        }
    }


# ---------------------------------------------------------------------------
# Helper accessor
# ---------------------------------------------------------------------------

def _mh() -> Dict[str, Any]:
    """Return the misc helpers dict registered by server.py."""
    return get_extra("misc_helpers")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@misc_bp.route("/api/users/should-welcome", methods=["GET"])
def should_welcome() -> Any:
    """Determine whether the Welcome Screen should be shown and in which mode."""
    def _nocache(payload, status=200):
        r = jsonify(payload)
        r.status_code = status
        r.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        return r
    try:
        h = _mh()
        if is_hosted_web_runtime():
            user_id = get_authenticated_user_id()
            if user_id and h["user_service"].get_user(user_id):
                return _nocache(
                    {
                        "ok": True,
                        "show_welcome": False,
                        "mode": "authenticated",
                        "authenticated": True,
                        "auto_select_user_id": user_id,
                        "auth_providers": _auth_providers_payload(),
                    }
                )
            if user_id:
                from routes._context import logout_authenticated_user
                logout_authenticated_user()
            return _nocache(
                {
                    "ok": True,
                    "show_welcome": True,
                    "mode": "auth",
                    "authenticated": False,
                    "profiles": [],
                    "auth_providers": _auth_providers_payload(),
                }
            )
        user_service = h["user_service"]
        users = user_service.get_all_users()
        items = [u.to_api_dict() for u in users]

        if len(users) == 0:
            return _nocache(
                {
                    "ok": True,
                    "show_welcome": True,
                    "mode": "onboarding",
                    "profiles": [],
                }
            )

        if len(users) == 1:
            user = users[0]
            api_dict = user.to_api_dict()
            has_login_password = api_dict.get("has_password") and api_dict.get(
                "security_settings", {}
            ).get("require_password_on_login")
            if has_login_password:
                return _nocache(
                    {
                        "ok": True,
                        "show_welcome": True,
                        "mode": "login",
                        "profiles": [api_dict],
                    }
                )
            else:
                return _nocache(
                    {
                        "ok": True,
                        "show_welcome": False,
                        "auto_select_user_id": user.user_id,
                    }
                )

        return _nocache(
            {
                "ok": True,
                "show_welcome": True,
                "mode": "select",
                "profiles": items,
            }
        )
    except Exception as exc:
        logger.exception("[HTTP] should-welcome failed: %s", exc)
        return jsonify({"ok": False, "error": "should_welcome_failed"}), 500


@misc_bp.route("/api/legal/current", methods=["GET"])
def legal_current() -> Any:
    """Return current versions of legal documents."""
    try:
        h = _mh()
        manifest = h["load_legal_manifest"]()
        return jsonify({"ok": True, "documents": manifest})
    except Exception as exc:
        logger.exception("[HTTP] Failed to load legal current manifest: %s", exc)
        return jsonify({"ok": False, "error": "legal_load_failed"}), 500


@misc_bp.route("/api/legal/document/<string:doc_type>", methods=["GET"])
def legal_document(doc_type: str) -> Any:
    """Return legal document content and metadata."""
    if doc_type not in ("terms", "privacy", "refund"):
        return jsonify({"ok": False, "error": "document_not_found"}), 404

    try:
        h = _mh()
        manifest = h["load_legal_manifest"]()
        meta = manifest.get(doc_type) or {}
        
        lang = request.args.get("lang", "ru")
        if lang not in ("ru", "en", "uk"):
            lang = "ru"
        
        path = h["legal_doc_path"](doc_type, manifest=manifest, lang=lang)
        if path is None or not path.exists():
            return jsonify({"ok": False, "error": "document_not_found"}), 404

        content = path.read_text(encoding="utf-8")
        
        title = meta.get("title")
        if lang == "en" and meta.get("title_en"):
            title = meta["title_en"]
        elif lang == "uk" and meta.get("title_uk"):
            title = meta["title_uk"]
        
        return jsonify(
            {
                "ok": True,
                "document": {
                    "doc_type": doc_type,
                    "title": title,
                    "version": meta.get("version"),
                    "effective_at": meta.get("effective_at"),
                    "last_reviewed_at": meta.get("last_reviewed_at"),
                    "format": meta.get("format"),
                    "content": content,
                },
            }
        )
    except Exception as exc:
        logger.exception("[HTTP] Failed to load legal document %s: %s", doc_type, exc)
        return jsonify({"ok": False, "error": "document_load_failed"}), 500


@misc_bp.route("/api/consent/status", methods=["GET"])
def consent_status() -> Any:
    """Return current consent status for user (missing/outdated/up_to_date)."""
    try:
        h = _mh()
        ctx = get_ctx()
        if is_hosted_web_runtime():
            auth_user_id = get_authenticated_user_id()
            user_id = request.args.get("user_id")
            if auth_user_id and h["user_service"].get_user(auth_user_id):
                if user_id and user_id != auth_user_id:
                    return jsonify({"ok": False, "error": "forbidden"}), 403
                user_id = auth_user_id
            if not user_id:
                user_id = auth_user_id
            if not user_id:
                return jsonify({"ok": False, "error": "authentication_required"}), 401
        else:
            user_id = request.args.get("user_id") or ctx.user_id
            if not user_id:
                return jsonify({"ok": False, "error": "user_id_required"}), 400
        user = h["user_service"].get_user(user_id)
        if not user:
            return jsonify({"ok": False, "error": "user_not_found"}), 404

        status = h["get_consent_status"](user_id)
        return jsonify({"ok": True, **status})
    except Exception as exc:
        logger.exception("[HTTP] Failed to load consent status: %s", exc)
        return jsonify({"ok": False, "error": "consent_status_failed"}), 500


@misc_bp.route("/api/consent/accept", methods=["POST"])
def consent_accept() -> Any:
    """Persist user consent for current legal versions."""
    try:
        h = _mh()
        ctx = get_ctx()
        payload = request.get_json(silent=True) or {}
        if is_hosted_web_runtime():
            auth_user_id = get_authenticated_user_id()
            user_id = payload.get("user_id")
            if auth_user_id and h["user_service"].get_user(auth_user_id):
                if user_id and user_id != auth_user_id:
                    return jsonify({"ok": False, "error": "forbidden"}), 403
                user_id = auth_user_id
            if not user_id:
                user_id = auth_user_id
            if not user_id:
                return jsonify({"ok": False, "error": "authentication_required"}), 401
        else:
            user_id = payload.get("user_id") or ctx.user_id
            if not user_id:
                return jsonify({"ok": False, "error": "user_id_required"}), 400
        user = h["user_service"].get_user(user_id)
        if not user:
            return jsonify({"ok": False, "error": "user_not_found"}), 404

        consent_payload = h["extract_consent_payload"](payload)
        validation = h["validate_consent_payload"](consent_payload)
        if not validation.get("ok"):
            body: Dict[str, Any] = {"ok": False, "error": validation.get("error")}
            if validation.get("error") == "version_mismatch":
                body["required"] = validation.get("required")
                body["provided"] = validation.get("provided")
            return jsonify(body), int(validation.get("status_code", 400))

        saved = h["write_user_consent"](
            user_id,
            consent_payload["terms_version"],
            consent_payload["privacy_version"],
            consent_payload["refund_version"],
            source=str(payload.get("source") or "user_action"),
        )
        return jsonify(
            {
                "ok": True,
                "consent_id": saved.get("consent_id"),
                "accepted_at": saved.get("accepted_at"),
            }
        )
    except Exception as exc:
        logger.exception("[HTTP] Failed to accept consent: %s", exc)
        return jsonify({"ok": False, "error": "consent_accept_failed"}), 500


@misc_bp.route("/api/network/status", methods=["GET"])
def network_status() -> Any:
    """Return connectivity info for offline-first UX hints."""
    try:
        h = _mh()
        internet_online = h["get_cached_internet_connectivity"](force=False, allow_stale=True)
        feedback_settings = h["feedback_email_settings"]()
        feedback_missing = h["validate_feedback_email_settings"](
            feedback_settings, require_recipients=True
        )
        feedback_delivery_configured = (
            bool(feedback_settings.get("enabled")) and not feedback_missing
        )
        manifest_url = h["update_manifest_url"]()
        updates_configured = bool(h["env_bool"]("ACTRA_UPDATE_CHECK_ENABLED", True) and manifest_url)
        updates_requires_internet = (
            bool(updates_configured) and h["manifest_url_requires_internet"](manifest_url)
        )

        return jsonify(
            {
                "ok": True,
                "offline_first": True,
                "internet_online": internet_online,
                "feedback_delivery": {
                    "configured": feedback_delivery_configured,
                    "available_now": feedback_delivery_configured and internet_online,
                    "requires_internet": True,
                    "missing_config": feedback_missing,
                },
                "updates": {
                    "configured": updates_configured,
                    "available_now": updates_configured
                    and (internet_online or not updates_requires_internet),
                    "requires_internet": updates_requires_internet,
                },
            }
        )
    except Exception as exc:
        logger.exception("[HTTP] Failed to resolve network status: %s", exc)
        return jsonify({"ok": False, "error": "network_status_failed"}), 500


@misc_bp.route("/api/update/check", methods=["GET"])
def update_check() -> Any:
    """Check whether a newer app version is available."""
    try:
        h = _mh()
        force_raw = str(request.args.get("force") or "").strip().lower()
        force = force_raw in {"1", "true", "yes", "on"}
        result = h["build_update_status"](force=force)
        return jsonify({"ok": True, **result})
    except Exception as exc:
        logger.exception("[HTTP] Failed to check updates: %s", exc)
        return jsonify({"ok": False, "error": "update_check_failed"}), 500


@misc_bp.route("/api/feedback/options", methods=["GET"])
def feedback_options() -> Any:
    h = _mh()
    return jsonify(
        {"ok": True, "types": list(h["FEEDBACK_TYPES"]), "severity": list(h["FEEDBACK_SEVERITIES"])}
    )


@misc_bp.route("/api/feedback/test-email", methods=["POST"])
def feedback_test_email() -> Any:
    """Send test email for feedback SMTP channel."""
    try:
        h = _mh()
        payload = request.get_json(silent=True) or {}
        to_email = str(payload.get("to_email") or "").strip() or None
        subject = str(payload.get("subject") or "").strip() or None
        body = str(payload.get("body") or "").strip() or None

        status = h["send_feedback_test_email"](to_email=to_email, subject=subject, body=body)
        if status.get("sent"):
            return jsonify({"ok": True, **status})

        reason = str(status.get("reason") or "send_failed")
        status_code = 400 if reason in {"disabled", "not_configured"} else 502
        return jsonify({"ok": False, **status}), status_code
    except Exception as exc:
        logger.exception("[HTTP] Failed to send feedback test email: %s", exc)
        return jsonify({"ok": False, "error": "feedback_test_email_failed"}), 500


@misc_bp.route("/api/feedback/retry-pending", methods=["POST"])
def feedback_retry_pending() -> Any:
    """Retry email delivery for previously queued feedback tickets."""
    try:
        h = _mh()
        payload = request.get_json(silent=True) or {}
        requested_limit = payload.get("limit", 5)
        try:
            limit = int(requested_limit)
        except Exception:
            limit = 5
        limit = max(1, min(limit, 50))

        summary = h["retry_pending_feedback_notifications"](limit=limit)
        return jsonify({"ok": True, **summary})
    except Exception as exc:
        logger.exception("[HTTP] Failed to retry pending feedback notifications: %s", exc)
        return jsonify({"ok": False, "error": "feedback_retry_failed"}), 500


@misc_bp.route("/api/feedback", methods=["POST"])
def feedback_submit() -> Any:
    """Submit feedback ticket from active/existing user."""
    try:
        h = _mh()
        ctx = get_ctx()
        payload = request.get_json(silent=True) or {}
        if is_hosted_web_runtime():
            user_id = get_authenticated_user_id()
            if not user_id:
                return jsonify({"ok": False, "error": "authentication_required"}), 401
        else:
            user_id = payload.get("user_id") or ctx.user_id
        if not user_id:
            return jsonify({"ok": False, "error": "user_id_required"}), 400
        user = h["user_service"].get_user(user_id)
        if not user:
            return jsonify({"ok": False, "error": "user_not_found"}), 404

        ticket = h["build_feedback_ticket"](payload, user_id=user_id)
        h["save_feedback_ticket"](ticket)
        if h["get_cached_internet_connectivity"](force=False):
            email_status = h["notify_feedback_via_email"](ticket, user)
        else:
            email_status = {"sent": False, "reason": "offline"}
        h["update_feedback_delivery_fields"](ticket, email_status)
        h["save_feedback_ticket"](ticket)
        return (
            jsonify(
                {
                    "ok": True,
                    "ticket_id": ticket["ticket_id"],
                    "email_notification": email_status,
                }
            ),
            201,
        )
    except ValueError as ve:
        return jsonify({"ok": False, "error": str(ve)}), 400
    except Exception as exc:
        logger.exception("[HTTP] Failed to save feedback: %s", exc)
        return jsonify({"ok": False, "error": "feedback_submit_failed"}), 500


@misc_bp.route("/api/evaluation/messages", methods=["GET"])
def get_evaluation_messages() -> Any:
    """Return all evaluation messages for frontend usage."""
    from services.evaluation_messages import MESSAGES

    return jsonify(MESSAGES)
