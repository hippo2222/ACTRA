"""Hosted auth routes for request-scoped user sessions."""

import logging
from datetime import datetime
import threading
import time
from typing import Any, Dict, Optional

from flask import Blueprint, jsonify, request

from routes._context import (
    get_authenticated_identity_source,
    get_authenticated_login_at,
    get_authenticated_user_id,
    get_ctx,
    get_extra,
    is_hosted_web_runtime,
    login_authenticated_user,
    logout_authenticated_user,
)

logger = logging.getLogger(__name__)

auth_bp = Blueprint("auth", __name__)

_AUTH_RATE_LIMITS: Dict[str, Dict[str, int]] = {
    "register": {"limit": 10, "window_seconds": 60},
    "login": {"limit": 8, "window_seconds": 60},
    "resend_verification": {"limit": 6, "window_seconds": 60},
    "verify_email": {"limit": 12, "window_seconds": 60},
    "forgot_password": {"limit": 6, "window_seconds": 60},
    "reset_password": {"limit": 6, "window_seconds": 60},
}
_AUTH_RATE_LIMIT_STATE: Dict[str, list[float]] = {}
_AUTH_RATE_LIMIT_LOCK = threading.RLock()


def _h(name: str) -> Any:
    helpers = get_extra("server_helpers", {})
    return helpers[name]


def _client_fingerprint() -> str:
    forwarded = str(request.headers.get("X-Forwarded-For") or "").strip()
    if forwarded:
        return str(forwarded.split(",")[0]).strip() or "unknown"
    real_ip = str(request.headers.get("X-Real-IP") or "").strip()
    if real_ip:
        return real_ip
    return str(request.remote_addr or "unknown").strip() or "unknown"


def _rate_limit_response(retry_after_seconds: int) -> Any:
    retry_after = max(1, int(retry_after_seconds or 1))
    return (
        jsonify(
            {
                "ok": False,
                "error": "too_many_requests",
                "message": "Слишком много попыток. Подождите немного и попробуйте снова.",
                "retry_after_seconds": retry_after,
            }
        ),
        429,
        {"Retry-After": str(retry_after)},
    )


def _apply_auth_rate_limit(scope: str) -> Optional[Any]:
    config = _AUTH_RATE_LIMITS.get(str(scope or "").strip())
    if not config:
        return None

    limit = int(config.get("limit", 0) or 0)
    window_seconds = int(config.get("window_seconds", 0) or 0)
    if limit <= 0 or window_seconds <= 0:
        return None

    subject_key = _client_fingerprint()
    user_service = getattr(get_ctx(), "user_service", None)
    limiter = getattr(user_service, "consume_rate_limit", None)
    if callable(limiter):
        try:
            verdict = limiter(
                str(scope or "").strip(),
                subject_key,
                limit=limit,
                window_seconds=window_seconds,
            )
            if not bool((verdict or {}).get("allowed", True)):
                return _rate_limit_response(int((verdict or {}).get("retry_after_seconds") or 1))
            return None
        except Exception:
            logger.exception("[HTTP] Shared auth rate limit failed for scope %s; falling back to process-local limiter", scope)

    bucket = f"{scope}:{subject_key}"
    now = time.monotonic()
    with _AUTH_RATE_LIMIT_LOCK:
        attempts = [
            stamp
            for stamp in _AUTH_RATE_LIMIT_STATE.get(bucket, [])
            if now - stamp < float(window_seconds)
        ]
        if len(attempts) >= limit:
            oldest = attempts[0] if attempts else now
            retry_after = max(1, int(window_seconds - (now - oldest)) + 1)
            _AUTH_RATE_LIMIT_STATE[bucket] = attempts
            return _rate_limit_response(retry_after)
        attempts.append(now)
        _AUTH_RATE_LIMIT_STATE[bucket] = attempts
    return None


def _invalid_credentials_response() -> Any:
    return (
        jsonify(
            {
                "ok": False,
                "error": "invalid_credentials",
                "message": "Неверный логин, email или пароль.",
            }
        ),
        401,
    )


def _registration_conflict_response() -> Any:
    return (
        jsonify(
            {
                "ok": False,
                "error": "registration_conflict",
                "message": "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0430\u043a\u043a\u0430\u0443\u043d\u0442 \u0441 \u0443\u043a\u0430\u0437\u0430\u043d\u043d\u044b\u043c\u0438 \u0434\u0430\u043d\u043d\u044b\u043c\u0438. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043b\u043e\u0433\u0438\u043d \u0438 email \u0438\u043b\u0438 \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0432\u043e\u0439\u0442\u0438.",
            }
        ),
        409,
    )


def _concealed_verification_response() -> Any:
    return jsonify(
        {
            "ok": True,
            "requested": True,
            "message": "Если аккаунт существует и почта ещё не подтверждена, мы отправили новое письмо со ссылкой.",
            "verification_email": {"sent": False, "concealed": True},
        }
    )


def _concealed_password_reset_response() -> Any:
    return jsonify(
        {
            "ok": True,
            "requested": True,
            "message": "Если аккаунт с таким логином или email существует, мы отправили письмо со ссылкой для сброса пароля.",
            "password_reset_email": {"sent": False, "concealed": True},
        }
    )


def _find_user_by_identifier(identifier: str) -> Optional[Any]:
    clean_identifier = str(identifier or "").strip()
    if not clean_identifier:
        return None

    ctx = get_ctx()
    user_service = ctx.user_service

    finder = getattr(user_service, "find_user_by_identifier", None)
    if callable(finder):
        user = finder(clean_identifier)
        if user is not None:
            return user

    direct = user_service.get_user(clean_identifier)
    if direct is not None:
        return direct

    lowered = clean_identifier.lower()
    for user in user_service.get_all_users():
        if str(getattr(user, "login", "") or "").strip().lower() == lowered:
            return user
        if str(getattr(user, "email", "") or "").strip().lower() == lowered:
            return user
        if str(user.name or "").strip().lower() == lowered:
            return user
    return None


def _validation_error_response(code: str) -> Any:
    messages = {
        "name_required": "Введите отображаемое имя.",
        "name_too_short": "Отображаемое имя слишком короткое.",
        "name_too_long": "Отображаемое имя слишком длинное.",
        "invalid_name": "Отображаемое имя содержит недопустимые символы.",
        "duplicate_name": "Это имя уже используется.",
        "login_required": "Введите логин.",
        "invalid_login": "Логин должен быть длиной 3-32 символа и содержать только латиницу, цифры, '.', '-' или '_'.",
        "login_already_exists": "Этот логин уже занят.",
        "email_required": "Введите email.",
        "invalid_email": "Введите корректный email.",
        "email_already_exists": "Этот email уже используется.",
        "invalid_password": "Пароль должен содержать минимум 8 символов.",
    }
    return (
        jsonify({"ok": False, "error": code, "message": messages.get(code, code)}),
        400,
    )


def _serialize_auth_user(user: Any) -> Dict[str, Any]:
    payload = user.to_api_dict()
    auth_source = get_authenticated_identity_source()
    payload["authenticated"] = True
    payload["login_at"] = get_authenticated_login_at()
    payload["auth_source"] = auth_source
    payload["development_bridge"] = auth_source == "dev_bridge"
    return payload


def _verification_delivery_error(status: Dict[str, Any]) -> Any:
    reason = str((status or {}).get("reason") or "verification_send_failed").strip() or "verification_send_failed"
    code_map = {
        "already_verified": 409,
        "email_missing": 400,
        "disabled": 503,
        "not_configured": 503,
        "missing_base_url": 503,
        "send_failed": 502,
        "issue_failed": 500,
    }
    return jsonify({"ok": False, "error": reason, "verification_email": status}), code_map.get(reason, 500)


def _password_reset_delivery_error(status: Dict[str, Any]) -> Any:
    reason = str((status or {}).get("reason") or "password_reset_send_failed").strip() or "password_reset_send_failed"
    code_map = {
        "email_missing": 400,
        "disabled": 503,
        "not_configured": 503,
        "missing_base_url": 503,
        "send_failed": 502,
        "issue_failed": 500,
    }
    return jsonify({"ok": False, "error": reason, "password_reset_email": status}), code_map.get(reason, 500)


@auth_bp.route("/api/auth/register", methods=["POST"])
def register_auth_user() -> Any:
    """Create a user profile intended for hosted auth and log in immediately."""
    try:
        payload = request.get_json(silent=True) or {}
        name = str(payload.get("name") or "").strip()
        login = str(payload.get("login") or "").strip()
        email = str(payload.get("email") or "").strip()
        password = str(payload.get("password") or "")
        avatar_seed = str(payload.get("avatar_seed") or "").strip() or None

        limited = _apply_auth_rate_limit("register")
        if limited is not None:
            return limited

        if not name:
            return jsonify({"ok": False, "error": "name_required"}), 400
        if is_hosted_web_runtime() and not login:
            return _validation_error_response("login_required")
        if is_hosted_web_runtime() and not email:
            return _validation_error_response("email_required")
        if is_hosted_web_runtime() and not password:
            return jsonify({"ok": False, "error": "password_required"}), 400

        consent_payload = _h("extract_consent_payload")(payload)
        legacy_implicit_consent = not _h("has_explicit_consent_payload")(payload)
        if legacy_implicit_consent:
            required_versions = _h("required_consent_versions")()
            consent_payload = {
                "accepted": True,
                "terms_version": required_versions["terms_version"],
                "privacy_version": required_versions["privacy_version"],
            }

        validation = _h("validate_consent_payload")(consent_payload)
        if not validation.get("ok"):
            body: Dict[str, Any] = {"ok": False, "error": validation.get("error")}
            if validation.get("error") == "version_mismatch":
                body["required"] = validation.get("required")
                body["provided"] = validation.get("provided")
            return jsonify(body), int(validation.get("status_code", 400))

        user_service = get_ctx().user_service
        creator = getattr(user_service, "create_auth_user", None)
        if callable(creator):
            user = creator(
                name=name,
                login=login,
                email=email,
                password=password,
                avatar_seed=avatar_seed,
            )
        else:
            user = user_service.create_user(name)
            if avatar_seed:
                user.avatar_seed = avatar_seed
            if login:
                user.login = login
            if email:
                user.email = email
            if password:
                return jsonify({"ok": False, "error": "auth_register_unavailable"}), 501
            if avatar_seed or login or email:
                if not user_service.update_user(user):
                    return jsonify({"ok": False, "error": "user_update_failed"}), 500

        _h("write_user_consent")(
            user.user_id,
            consent_payload["terms_version"],
            consent_payload["privacy_version"],
            source="auth_register",
        )
        verification_email = _h("issue_auth_verification_email")(
            user,
            request_base_url=request.host_url,
        )
        login_authenticated_user(user.user_id)
        refreshed_user = get_ctx().user_service.get_user(user.user_id) or user
        return jsonify(
            {
                "ok": True,
                "user": _serialize_auth_user(refreshed_user),
                "verification_email": verification_email,
            }
        ), 201
    except ValueError as exc:
        logger.warning("[HTTP] Auth register validation error: %s", exc)
        code = str(exc).strip()
        if code in {"login_already_exists", "email_already_exists"}:
            return _registration_conflict_response()
        return _validation_error_response(code)
    except Exception as exc:
        logger.exception("[HTTP] Auth register failed: %s", exc)
        return jsonify({"ok": False, "error": "auth_register_failed"}), 500


@auth_bp.route("/api/auth/login", methods=["POST"])
def login_auth_user() -> Any:
    """Authenticate a hosted user by existing profile id or profile name."""
    try:
        payload = request.get_json(silent=True) or {}
        identifier = str(
            payload.get("identifier")
            or payload.get("user_id")
            or payload.get("name")
            or ""
        ).strip()
        password = str(payload.get("password") or "")

        if not identifier:
            return jsonify({"ok": False, "error": "identifier_required"}), 400
        limited = _apply_auth_rate_limit("login")
        if limited is not None:
            return limited

        user = _find_user_by_identifier(identifier)
        if user is None:
            return _invalid_credentials_response()

        if not user.password_hash:
            return _invalid_credentials_response()
        if not password:
            return _invalid_credentials_response()
        if not get_ctx().user_service.verify_password(user.user_id, password):
            return _invalid_credentials_response()

        login_authenticated_user(user.user_id)
        return jsonify({"ok": True, "user": _serialize_auth_user(user)})
    except Exception as exc:
        logger.exception("[HTTP] Auth login failed: %s", exc)
        return jsonify({"ok": False, "error": "auth_login_failed"}), 500


@auth_bp.route("/api/auth/resend-verification", methods=["POST"])
def resend_auth_verification_email() -> Any:
    """Re-issue verification email for the current hosted account."""
    try:
        payload = request.get_json(silent=True) or {}
        user = None
        limited = _apply_auth_rate_limit("resend_verification")
        if limited is not None:
            return limited

        current_user_id = get_authenticated_user_id()
        if current_user_id:
            user = get_ctx().user_service.get_user(current_user_id)
        else:
            identifier = str(payload.get("identifier") or "").strip()
            if not identifier:
                return jsonify({"ok": False, "error": "identifier_required"}), 400
            user = _find_user_by_identifier(identifier)
            if user is not None and not bool(getattr(user, "email_verified_at", None)):
                try:
                    _h("issue_auth_verification_email")(user, request_base_url=request.host_url)
                except Exception:
                    logger.exception("[HTTP] Concealed resend verification send failed for identifier flow")
            return _concealed_verification_response()

        if user is None:
            return jsonify({"ok": False, "error": "authentication_required"}), 401

        if bool(getattr(user, "email_verified_at", None)):
            return jsonify(
                {
                    "ok": True,
                    "already_verified": True,
                    "user": _serialize_auth_user(user),
                    "verification_email": {"sent": False, "reason": "already_verified"},
                }
            )

        status = _h("issue_auth_verification_email")(user, request_base_url=request.host_url)
        if not bool(status.get("sent")):
            return _verification_delivery_error(status)

        refreshed_user = get_ctx().user_service.get_user(user.user_id) or user
        return jsonify(
            {
                "ok": True,
                "user": _serialize_auth_user(refreshed_user),
                "verification_email": status,
            }
        )
    except Exception as exc:
        logger.exception("[HTTP] Auth resend verification failed: %s", exc)
        return jsonify({"ok": False, "error": "auth_resend_verification_failed"}), 500


@auth_bp.route("/api/auth/verify-email", methods=["GET", "POST"])
def verify_auth_email() -> Any:
    """Confirm email verification token and activate the verified status."""
    try:
        payload = request.get_json(silent=True) or {}
        token = str(request.args.get("token") or payload.get("token") or "").strip()
        purpose = str(request.args.get("purpose") or payload.get("purpose") or "verify_email").strip() or "verify_email"
        if not token:
            return jsonify({"ok": False, "error": "token_required"}), 400
        if purpose not in {"verify_email", "change_email"}:
            return jsonify({"ok": False, "error": "invalid_purpose"}), 400
        limited = _apply_auth_rate_limit("verify_email")
        if limited is not None:
            return limited

        user_service = get_ctx().user_service
        token_payload = user_service.get_email_verification_token(token, purpose=purpose, include_used=False)
        if token_payload is None:
            used_payload = user_service.get_email_verification_token(token, purpose=purpose, include_used=True)
            if used_payload and used_payload.get("used_at"):
                return jsonify({"ok": False, "error": "token_already_used"}), 409
            return jsonify({"ok": False, "error": "invalid_or_expired_token"}), 400

        user = user_service.get_user(str(token_payload.get("user_id") or "").strip())
        if user is None:
            return jsonify({"ok": False, "error": "user_not_found"}), 404

        token_email = str(token_payload.get("email") or "").strip().lower()
        if purpose == "change_email":
            current_email = str(getattr(user, "pending_email", "") or "").strip().lower()
        else:
            current_email = str(getattr(user, "email", "") or "").strip().lower()
        if not current_email or current_email != token_email:
            return jsonify({"ok": False, "error": "email_changed"}), 409

        consumed = user_service.consume_email_verification_token(token, purpose=purpose)
        if consumed is None:
            return jsonify({"ok": False, "error": "invalid_or_expired_token"}), 400

        if purpose == "change_email":
            if not user_service.confirm_pending_email_change(user.user_id):
                return jsonify({"ok": False, "error": "confirm_pending_email_failed"}), 500
        else:
            if not user_service.mark_email_as_verified(user.user_id):
                return jsonify({"ok": False, "error": "verify_email_failed"}), 500

        refreshed_user = user_service.get_user(user.user_id) or user
        login_authenticated_user(refreshed_user.user_id)
        return jsonify(
            {
                "ok": True,
                "verified": True,
                "purpose": purpose,
                "email_changed": purpose == "change_email",
                "user": _serialize_auth_user(refreshed_user),
                "verification": {
                    "token_id": consumed.get("token_id"),
                    "verified_at": getattr(refreshed_user, "email_verified_at", None),
                },
            }
        )
    except Exception as exc:
        logger.exception("[HTTP] Auth verify email failed: %s", exc)
        return jsonify({"ok": False, "error": "auth_verify_email_failed"}), 500


@auth_bp.route("/api/auth/forgot-password", methods=["POST"])
def forgot_auth_password() -> Any:
    """Issue a password reset email for an existing hosted account."""
    try:
        payload = request.get_json(silent=True) or {}
        identifier = str(payload.get("identifier") or payload.get("email") or "").strip()
        if not identifier:
            return jsonify({"ok": False, "error": "identifier_required"}), 400
        limited = _apply_auth_rate_limit("forgot_password")
        if limited is not None:
            return limited

        user = _find_user_by_identifier(identifier)
        if user is not None:
            try:
                _h("issue_auth_password_reset_email")(user, request_base_url=request.host_url)
            except Exception:
                logger.exception("[HTTP] Concealed forgot password send failed")
        return _concealed_password_reset_response()
    except Exception as exc:
        logger.exception("[HTTP] Auth forgot password failed: %s", exc)
        return jsonify({"ok": False, "error": "auth_forgot_password_failed"}), 500


@auth_bp.route("/api/auth/reset-password", methods=["POST"])
def reset_auth_password() -> Any:
    """Reset password using a password reset token."""
    try:
        payload = request.get_json(silent=True) or {}
        token = str(payload.get("token") or "").strip()
        new_password = str(payload.get("new_password") or "")
        if not token:
            return jsonify({"ok": False, "error": "token_required"}), 400
        if len(new_password) < 8:
            return jsonify({"ok": False, "error": "invalid_password"}), 400
        limited = _apply_auth_rate_limit("reset_password")
        if limited is not None:
            return limited

        user_service = get_ctx().user_service
        token_payload = user_service.get_email_verification_token(
            token,
            purpose="reset_password",
            include_used=False,
        )
        if token_payload is None:
            used_payload = user_service.get_email_verification_token(
                token,
                purpose="reset_password",
                include_used=True,
            )
            if used_payload and used_payload.get("used_at"):
                return jsonify({"ok": False, "error": "token_already_used"}), 409
            return jsonify({"ok": False, "error": "invalid_or_expired_token"}), 400

        user = user_service.get_user(str(token_payload.get("user_id") or "").strip())
        if user is None:
            return jsonify({"ok": False, "error": "user_not_found"}), 404

        token_email = str(token_payload.get("email") or "").strip().lower()
        current_email = str(getattr(user, "email", "") or "").strip().lower()
        if not current_email or current_email != token_email:
            return jsonify({"ok": False, "error": "email_changed"}), 409

        consumed = user_service.consume_email_verification_token(
            token,
            purpose="reset_password",
        )
        if consumed is None:
            return jsonify({"ok": False, "error": "invalid_or_expired_token"}), 400

        setter = getattr(user_service, "set_password", None)
        if callable(setter):
            refreshed_user = setter(user.user_id, new_password)
        else:
            import bcrypt

            user.password_hash = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            security_settings = dict(getattr(user, "security_settings", {}) or {})
            security_settings["require_password_on_login"] = True
            user.security_settings = security_settings
            if not user_service.update_user(user):
                return jsonify({"ok": False, "error": "reset_password_failed"}), 500
            refreshed_user = user_service.get_user(user.user_id) or user

        login_authenticated_user(refreshed_user.user_id)
        return jsonify(
            {
                "ok": True,
                "password_reset": True,
                "user": _serialize_auth_user(refreshed_user),
                "reset": {
                    "token_id": consumed.get("token_id"),
                    "reset_at": datetime.utcnow().isoformat() + "Z",
                },
            }
        )
    except ValueError as exc:
        reason = str(exc or "reset_password_failed").strip() or "reset_password_failed"
        status = 400 if reason == "invalid_password" else 404 if reason == "user_not_found" else 500
        return jsonify({"ok": False, "error": reason}), status
    except RuntimeError as exc:
        reason = str(exc or "reset_password_failed").strip() or "reset_password_failed"
        return jsonify({"ok": False, "error": reason}), 500
    except Exception as exc:
        logger.exception("[HTTP] Auth reset password failed: %s", exc)
        return jsonify({"ok": False, "error": "auth_reset_password_failed"}), 500


@auth_bp.route("/api/auth/logout", methods=["POST"])

def logout_auth_user() -> Any:
    """Logout current hosted session."""
    try:
        logout_authenticated_user()
        return jsonify({"ok": True})
    except Exception as exc:
        logger.exception("[HTTP] Auth logout failed: %s", exc)
        return jsonify({"ok": False, "error": "auth_logout_failed"}), 500


@auth_bp.route("/api/auth/me", methods=["GET"])
def auth_me() -> Any:
    """Return current hosted auth session user."""
    try:
        user_id = get_authenticated_user_id()
        if not user_id:
            return jsonify({"ok": True, "authenticated": False, "user": None}), 200

        user = get_ctx().user_service.get_user(user_id)
        if user is None:
            logout_authenticated_user()
            return jsonify({"ok": False, "error": "auth_user_not_found"}), 401

        auth_source = get_authenticated_identity_source()
        return jsonify(
            {
                "ok": True,
                "authenticated": True,
                "auth_source": auth_source,
                "development_bridge": auth_source == "dev_bridge",
                "user": _serialize_auth_user(user),
            }
        )
    except Exception as exc:
        logger.exception("[HTTP] Auth me failed: %s", exc)
        return jsonify({"ok": False, "error": "auth_me_failed"}), 500
