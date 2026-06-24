from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator, Optional


class PostgresUnavailableError(RuntimeError):
    """Raised when psycopg is unavailable or the DSN is missing."""


def _import_psycopg() -> Any:
    try:
        import importlib

        return importlib.import_module("psycopg")
    except Exception as exc:  # pragma: no cover - import depends on environment
        raise PostgresUnavailableError(f"psycopg_unavailable:{exc}") from exc


@contextmanager
def postgres_connection(dsn: Optional[str]) -> Iterator[Any]:
    clean_dsn = str(dsn or "").strip()
    if not clean_dsn:
        raise PostgresUnavailableError("postgres_dsn_missing")

    psycopg = _import_psycopg()
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

