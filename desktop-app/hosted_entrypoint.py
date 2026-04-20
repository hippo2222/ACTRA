"""Hosted web entrypoint for ACTRA.

Starts the Flask application without any desktop/webview bootstrap.
Prefers Waitress when available and falls back to Flask's builtin server
for local verification or incomplete environments.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

os.environ.setdefault("ACTRA_RUNTIME_MODE", "hosted_web")

from persistence.runtime import validate_hosted_persistence_contract
from server import FLASK_DEBUG_ENABLED, _headless_app_ctx, app, watchdog  # type: ignore


logger = logging.getLogger(__name__)


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(str(raw).strip())
    except Exception:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _resolve_host() -> str:
    return str(os.environ.get("ACTRA_BIND_HOST") or "0.0.0.0").strip() or "0.0.0.0"


def _resolve_port() -> int:
    port_raw: Optional[str] = os.environ.get("TRAINER_HTTP_PORT") or os.environ.get("PORT")
    if not port_raw:
        return 8000
    try:
        return int(str(port_raw).strip())
    except Exception:
        return 8000


def _validate_persistence_contract() -> None:
    strict = _env_bool("ACTRA_HOSTED_PERSISTENCE_STRICT", True)
    validate_hosted_persistence_contract(_headless_app_ctx.persistence_runtime, strict=strict)
    _headless_app_ctx.ensure_hosted_persistence_ready()


def main() -> None:
    host = _resolve_host()
    port = _resolve_port()
    waitress_threads = _env_int("ACTRA_WAITRESS_THREADS", 8)
    prefer_waitress = _env_bool("ACTRA_HOSTED_USE_WAITRESS", True)

    _validate_persistence_contract()

    watchdog.start()
    try:
        if prefer_waitress:
            try:
                from waitress import serve  # type: ignore

                logger.info(
                    "[HOSTED] Starting Waitress on %s:%s threads=%s runtime_mode=%s",
                    host,
                    port,
                    waitress_threads,
                    os.environ.get("ACTRA_RUNTIME_MODE"),
                )
                serve(app, host=host, port=port, threads=waitress_threads)
                return
            except ImportError:
                logger.warning(
                    "[HOSTED] waitress is not installed; falling back to Flask builtin server."
                )

        logger.warning(
            "[HOSTED] Running Flask builtin server on %s:%s. This is acceptable for verification, "
            "but hosted deployments should install waitress.",
            host,
            port,
        )
        app.run(host=host, port=port, debug=FLASK_DEBUG_ENABLED, threaded=True)
    finally:
        watchdog.stop()


if __name__ == "__main__":
    main()
