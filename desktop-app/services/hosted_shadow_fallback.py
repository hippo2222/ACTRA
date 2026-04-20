from __future__ import annotations

from typing import Any

from persistence.runtime import HOSTED_SHADOW_WRITE_FALLBACK_ENV


class HostedShadowReadFallbackDisabledError(RuntimeError):
    """Raised when hosted runtime refuses to serve stale shadow reads for a surface."""

    def __init__(self, operation: str, *, reason: str = "") -> None:
        self.operation = str(operation or "").strip()
        self.reason = str(reason or "").strip()
        message = f"hosted_shadow_read_fallback_disabled:{self.operation or 'unknown_operation'}"
        if self.reason:
            message = f"{message}:{self.reason}"
        super().__init__(message)


class HostedShadowWriteFallbackDisabledError(RuntimeError):
    """Raised when hosted runtime blocks legacy shadow writes without explicit opt-in."""

    def __init__(self, operation: str, *, reason: str = "") -> None:
        self.operation = str(operation or "").strip()
        self.reason = str(reason or "").strip()
        message = f"hosted_shadow_write_fallback_disabled:{self.operation or 'unknown_operation'}"
        if self.reason:
            message = f"{message}:{self.reason}"
        super().__init__(message)


class HostedShadowFallbackMixin:
    """Track hosted shadow fallback state and guard write fallbacks by policy."""

    persistence_settings: Any
    logger: Any

    def _init_hosted_shadow_fallback_state(self) -> None:
        self._shadow_fallback_active = False
        self._shadow_read_fallback_blocked = False
        self._shadow_write_fallback_blocked = False

    @property
    def hosted_shadow_fallback_active(self) -> bool:
        return bool(getattr(self, "_shadow_fallback_active", False))

    @property
    def hosted_shadow_read_fallback_blocked(self) -> bool:
        return bool(getattr(self, "_shadow_read_fallback_blocked", False))

    @property
    def hosted_shadow_write_fallback_blocked(self) -> bool:
        return bool(getattr(self, "_shadow_write_fallback_blocked", False))

    @property
    def hosted_shadow_write_fallback_enabled(self) -> bool:
        settings = getattr(self, "persistence_settings", None)
        return bool(getattr(settings, "hosted_shadow_write_fallback_enabled", True))

    def _log_shadow_read_fallback(self, operation: str, exc: Exception) -> None:
        self._shadow_fallback_active = True
        self.logger.warning(
            "[HOSTED][DEV-FALLBACK] %s is using legacy filesystem shadow because Postgres is unavailable: %s",
            operation,
            exc,
        )

    def _guard_shadow_read_fallback(self, operation: str, exc: Exception) -> None:
        self._shadow_fallback_active = True
        self._shadow_read_fallback_blocked = True
        self.logger.error(
            "[HOSTED][DEGRADED] Blocked legacy filesystem shadow read for %s because Postgres is unavailable: %s",
            operation,
            exc,
        )
        raise HostedShadowReadFallbackDisabledError(operation, reason=str(exc))

    def _guard_shadow_write_fallback(self, operation: str, exc: Exception) -> None:
        self._shadow_fallback_active = True
        if self.hosted_shadow_write_fallback_enabled:
            self.logger.warning(
                "[HOSTED][DEV-FALLBACK] %s is using legacy filesystem shadow write because Postgres is unavailable: %s",
                operation,
                exc,
            )
            return
        self._shadow_write_fallback_blocked = True
        self.logger.error(
            "[HOSTED][DEGRADED] Blocked legacy filesystem shadow write for %s because Postgres is unavailable and %s is not enabled: %s",
            operation,
            HOSTED_SHADOW_WRITE_FALLBACK_ENV,
            exc,
        )
        raise HostedShadowWriteFallbackDisabledError(operation, reason=str(exc))
