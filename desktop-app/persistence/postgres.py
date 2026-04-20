from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator, Optional


class PostgresUnavailableError(RuntimeError):
    """Raised when psycopg is unavailable or the DSN is missing."""


def _import_psycopg():
    try:
        import psycopg  # type: ignore

        return psycopg
    except Exception as exc:  # pragma: no cover - import depends on environment
        raise PostgresUnavailableError(f"psycopg_unavailable:{exc}") from exc


@contextmanager
def postgres_connection(dsn: Optional[str]) -> Iterator[object]:
    clean_dsn = str(dsn or "").strip()
    if not clean_dsn:
        raise PostgresUnavailableError("postgres_dsn_missing")

    psycopg = _import_psycopg()
    conn = psycopg.connect(clean_dsn)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

