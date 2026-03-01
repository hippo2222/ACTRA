"""Shared application context for all route modules.

This module acts as a bridge between server.py (which owns the global
AppContextHeadless instance and optional services) and the individual
Blueprint modules that need access to them.

Usage in server.py (after creating _headless_app_ctx):
    from routes._context import init_context
    init_context(_headless_app_ctx, ai_service=_ai_service, ...)

Usage in any Blueprint module:
    from routes._context import get_ctx, get_ai_service
    ctx = get_ctx()
    ctx.storage_service.load_modules()
"""

from typing import Any, Dict, Optional


_app_ctx: Any = None
_ai_service: Any = None
_file_processor: Any = None
_extra: Dict[str, Any] = {}


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
    """Return the global AppContextHeadless instance."""
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
