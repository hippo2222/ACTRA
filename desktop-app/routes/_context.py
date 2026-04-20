"""Shared application context for route modules.

This module bridges the single server-owned ``AppContextHeadless`` with the
request lifecycle. In hosted runtime we expose a request-aware view of
``ctx.user_id`` backed by the auth session cookie instead of the process-wide
mutable current user.
"""

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional

from flask import g, has_request_context, request, session


_app_ctx: Any = None
_ai_service: Any = None
_file_processor: Any = None
_extra: Dict[str, Any] = {}
_AUTH_USER_ID_SESSION_KEY = "auth_user_id"
_AUTH_LOGIN_AT_SESSION_KEY = "auth_login_at"
_AUTH_DEV_BRIDGE_SUPPRESSED_SESSION_KEY = "auth_dev_bridge_suppressed"
_HOSTED_DEV_AUTH_BRIDGE_ENV = "ACTRA_HOSTED_DEV_AUTH_BRIDGE"
_LOCALHOST_HOSTS = {"127.0.0.1", "localhost", "::1"}


class _RequestAppContextProxy:
    """Request-aware wrapper over the shared app context.

    Most route modules only need ``ctx.user_id`` plus delegated access to the
    shared services. In hosted runtime ``user_id`` must come from the current
    browser session; everything else keeps delegating to the shared context.
    """

    def __init__(self, app_ctx: Any) -> None:
        object.__setattr__(self, "_app_ctx", app_ctx)

    def __getattr__(self, name: str) -> Any:
        if name == "user_id":
            return get_current_user_id()
        if name == "calendar_service":
            return _get_request_scoped_calendar_service(object.__getattribute__(self, "_app_ctx"))
        return getattr(object.__getattribute__(self, "_app_ctx"), name)

    def __setattr__(self, name: str, value: Any) -> None:
        if name == "user_id":
            setattr(object.__getattribute__(self, "_app_ctx"), name, value)
            return
        setattr(object.__getattribute__(self, "_app_ctx"), name, value)


class RequestBoundCtxServiceProxy:
    """Resolve a ctx-owned service lazily for the active request."""

    def __init__(self, service_name: str) -> None:
        self._service_name = service_name

    def _resolve(self) -> Any:
        ctx = get_ctx()
        if ctx is None:
            raise RuntimeError(f"App context is not initialized for {self._service_name}")
        return getattr(ctx, self._service_name)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._resolve(), name)

    def __repr__(self) -> str:
        return f"<RequestBoundCtxServiceProxy service_name={self._service_name!r}>"


def is_hosted_web_runtime() -> bool:
    raw = str(os.environ.get("ACTRA_RUNTIME_MODE") or "").strip().lower()
    return raw == "hosted_web"


def is_hosted_dev_auth_bridge_enabled() -> bool:
    if not is_hosted_web_runtime():
        return False
    raw = str(os.environ.get(_HOSTED_DEV_AUTH_BRIDGE_ENV) or "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _is_localhost_request() -> bool:
    if not has_request_context():
        return False
    host = str(getattr(request, "host", "") or "").split(":", 1)[0].strip().lower()
    return host in _LOCALHOST_HOSTS


def _get_hosted_dev_bridge_user_id() -> Optional[str]:
    """Return legacy current user as a temporary hosted dev bridge.

    This helper is intentionally limited to explicit local development. It must
    never become the default hosted identity model; request-scoped auth session
    remains the target architecture.
    """
    if not (is_hosted_dev_auth_bridge_enabled() and _is_localhost_request()):
        return None
    if bool(session.get(_AUTH_DEV_BRIDGE_SUPPRESSED_SESSION_KEY)):
        return None

    candidate = str(getattr(_app_ctx, "user_id", "") or "").strip()
    if candidate and candidate not in {"guest", "default_user"}:
        return candidate

    user_service = getattr(_app_ctx, "user_service", None)
    if user_service is None:
        user_service = None

    if user_service is not None:
        try:
            candidate = str(user_service.get_last_user_id() or "").strip()
        except Exception:
            candidate = ""

        if candidate and candidate not in {"guest", "default_user"}:
            return candidate

    # Transitional local-dev fallback: hosted storage no longer persists
    # last_user_id, but local development may still carry the legacy app_state.
    data_dir = getattr(_app_ctx, "data_dir", None)
    if data_dir:
        try:
            app_state_path = Path(str(data_dir)) / "app_state.json"
            if app_state_path.exists():
                payload = json.loads(app_state_path.read_text(encoding="utf-8"))
                candidate = str(payload.get("last_user_id") or "").strip()
                if candidate and candidate not in {"guest", "default_user"}:
                    return candidate
        except Exception:
            return None
    return None


def get_authenticated_identity_source() -> Optional[str]:
    """Return hosted identity source for the current request."""
    if not (is_hosted_web_runtime() and has_request_context()):
        return None
    user_id = str(session.get(_AUTH_USER_ID_SESSION_KEY) or "").strip()
    if user_id:
        return "auth_session"
    if _get_hosted_dev_bridge_user_id():
        return "dev_bridge"
    return None


def get_authenticated_user_id() -> Optional[str]:
    """Return authenticated hosted user id from the current request session."""
    if not (is_hosted_web_runtime() and has_request_context()):
        return None
    user_id = str(session.get(_AUTH_USER_ID_SESSION_KEY) or "").strip()
    if user_id:
        return user_id
    return _get_hosted_dev_bridge_user_id()


def get_authenticated_hosted_user() -> Optional[Any]:
    """Return current hosted authenticated user object when available."""
    user_id = get_authenticated_user_id()
    if not user_id:
        return None
    ctx = get_ctx()
    user_service = getattr(ctx, "user_service", None) if ctx is not None else None
    if user_service is None:
        return None
    try:
        return user_service.get_user(user_id)
    except Exception:
        return None


def current_user_is_hosted_admin() -> bool:
    """Return True when the current hosted session belongs to an admin user."""
    user = get_authenticated_hosted_user()
    if user is None:
        return False
    return str(getattr(user, "role", "") or "").strip().lower() == "admin"


def get_current_user_id(*, guest_if_missing: bool = True) -> str:
    """Resolve current user id for the active request/runtime."""
    if is_hosted_web_runtime():
        hosted_user_id = get_authenticated_user_id()
        if hosted_user_id:
            return hosted_user_id
        return "guest" if guest_if_missing else ""
    return str(getattr(_app_ctx, "user_id", "") or "").strip()


def _get_request_scoped_calendar_service(app_ctx: Any) -> Any:
    """Return a CalendarService instance bound to the current request user."""
    base_calendar = getattr(app_ctx, "calendar_service", None)
    if base_calendar is None or not has_request_context():
        return base_calendar

    user_id = get_current_user_id()
    cached_service = getattr(g, "_actra_calendar_service", None)
    cached_user_id = getattr(g, "_actra_calendar_service_user_id", None)
    if cached_service is not None and cached_user_id == user_id:
        return cached_service

    use_fsrs = bool(getattr(getattr(base_calendar, "health_service", None), "use_fsrs", False))

    from services.calendar import CalendarService

    scoped_service = CalendarService(
        data_dir=str(getattr(app_ctx, "data_dir", "")),
        user_id=user_id or "guest",
        use_fsrs=use_fsrs,
        persistence_settings=getattr(app_ctx, "persistence_runtime", None),
    )
    g._actra_calendar_service = scoped_service
    g._actra_calendar_service_user_id = user_id
    return scoped_service


def login_authenticated_user(user_id: str) -> None:
    """Persist hosted auth identity into the Flask session."""
    if not has_request_context():
        raise RuntimeError("login_authenticated_user requires request context")
    clean_user_id = str(user_id or "").strip()
    if not clean_user_id:
        raise ValueError("user_id is required")
    session[_AUTH_USER_ID_SESSION_KEY] = clean_user_id
    session[_AUTH_LOGIN_AT_SESSION_KEY] = str(_extra.get("utc_now_iso", lambda: "")() or "")
    session.pop(_AUTH_DEV_BRIDGE_SUPPRESSED_SESSION_KEY, None)
    session.permanent = True


def logout_authenticated_user() -> None:
    """Clear hosted auth identity from the Flask session."""
    if not has_request_context():
        return
    session.pop(_AUTH_USER_ID_SESSION_KEY, None)
    session.pop(_AUTH_LOGIN_AT_SESSION_KEY, None)
    if is_hosted_dev_auth_bridge_enabled():
        session[_AUTH_DEV_BRIDGE_SUPPRESSED_SESSION_KEY] = True


def get_authenticated_login_at() -> Optional[str]:
    """Return hosted auth login timestamp from the current session."""
    if not (is_hosted_web_runtime() and has_request_context()):
        return None
    value = str(session.get(_AUTH_LOGIN_AT_SESSION_KEY) or "").strip()
    return value or None


def init_context(
    app_ctx: Any,
    *,
    ai_service: Any = None,
    file_processor: Any = None,
    **kwargs: Any,
) -> None:
    """Initialize the shared context.  Called once from server.py."""
    global _app_ctx, _ai_service, _file_processor, _extra
    _app_ctx = app_ctx
    _ai_service = ai_service
    _file_processor = file_processor
    _extra = dict(kwargs)


def get_ctx() -> Any:
    """Return the shared context, wrapped with request-aware user_id when possible."""
    if _app_ctx is None:
        return None
    if has_request_context():
        return _RequestAppContextProxy(_app_ctx)
    return _app_ctx


def get_base_ctx() -> Any:
    """Return the underlying shared app context without request-aware wrapping."""
    return _app_ctx


def get_ai_service() -> Optional[Any]:
    """Return the AIGenerationService instance (or None)."""
    return _ai_service


def get_file_processor() -> Optional[Any]:
    """Return the FileProcessor instance (or None)."""
    return _file_processor


def get_extra(key: str, default: Any = None) -> Any:
    """Return an extra value stored during init_context."""
    return _extra.get(key, default)


def set_extra(key: str, value: Any) -> None:
    """Store an extra value after init_context has been called."""
    _extra[key] = value
