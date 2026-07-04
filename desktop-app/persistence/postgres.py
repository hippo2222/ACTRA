from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator, Optional
import threading


class PostgresUnavailableError(RuntimeError):
    """Raised when psycopg is unavailable or the DSN is missing."""


# Global cache for connection pools by DSN
_POOLS: dict[str, Any] = {}
_POOLS_LOCK = threading.Lock()


def _import_psycopg() -> Any:
    try:
        import importlib
        return importlib.import_module("psycopg")
    except Exception as exc:  # pragma: no cover
        raise PostgresUnavailableError(f"psycopg_unavailable:{exc}") from exc


def _get_or_create_pool(dsn: str) -> Any:
    global _POOLS
    with _POOLS_LOCK:
        if dsn in _POOLS:
            return _POOLS[dsn]
        try:
            import importlib
            psycopg_pool = importlib.import_module("psycopg_pool")
            pool = psycopg_pool.ConnectionPool(
                conninfo=dsn,
                min_size=1,
                max_size=10,
                open=True,
                name="actra_pool"
            )
            _POOLS[dsn] = pool
            return pool
        except Exception:
            # Fallback if psycopg_pool is not available in environment
            return None


@contextmanager
def postgres_connection(dsn: Optional[str]) -> Iterator[Any]:
    clean_dsn = str(dsn or "").strip()
    if not clean_dsn:
        raise PostgresUnavailableError("postgres_dsn_missing")

    psycopg = _import_psycopg()
    pool = _get_or_create_pool(clean_dsn)

    if pool is not None:
        try:
            with pool.connection() as conn:
                yield conn
        except Exception as exc:
            raise PostgresUnavailableError(f"postgres_pool_connection_failed:{exc}") from exc
    else:
        # Fallback to single-use connection if psycopg_pool is not present
        try:
            conn = psycopg.connect(clean_dsn)
        except Exception as exc:
            raise PostgresUnavailableError(f"postgres_connect_failed:{exc}") from exc
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
