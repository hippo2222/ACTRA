"""Storage backends for the microcards V2 stack.

The V2 service historically kept everything in JSON files under data_dir:
  - global deck documents:   data/microcards/decks/<deck_id>.json
  - per-user documents:      data/users/<uid>/microcards/<kind file>.json

This module puts that IO behind one small interface with two backends:

  * FileMicrocardsStorage     — the historical layout, byte-compatible.
                                Default for desktop/dev runs.
  * PostgresMicrocardsStorage — JSONB documents in two tables; selected in the
                                hosted runtime when ACTRA_POSTGRES_DSN is set.
                                Document payloads are stored AS-IS (including
                                their schema_version envelopes), so migrating
                                is a verbatim copy in either direction.

Resolution lives in resolve_microcards_storage(); besides the service itself
it is used by read-only consumers of the same data (M5 analytics, calendar
backfill) so every reader sees the same source of truth.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from persistence.postgres import postgres_connection

# Per-user document kinds and their historical file names.
USER_DOC_FILES: Dict[str, str] = {
    "states": "review_states.json",
    "settings": "settings.json",
    "events": "review_events.json",
    "records": "deck_records.json",
    "sessions": "review_sessions.json",
}

DECKS_TABLE = "actra_microcards_v2_decks"
USER_DOCS_TABLE = "actra_microcards_v2_user_docs"


def _read_json(path: Path, default: Any) -> Any:
    try:
        if not path.exists():
            return default
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    tmp.replace(path)


class FileMicrocardsStorage:
    """Historical JSON-file layout (desktop / development default)."""

    backend_name = "files"

    def __init__(self, data_dir: Any) -> None:
        self.data_dir = Path(data_dir)

    # ── deck documents ────────────────────────────────────────────────
    def _deck_path(self, deck_id: str) -> Path:
        return self.data_dir / "microcards" / "decks" / f"{deck_id}.json"

    def get_deck_doc(self, deck_id: str) -> Optional[Dict[str, Any]]:
        doc = _read_json(self._deck_path(deck_id), None)
        return doc if isinstance(doc, dict) else None

    def put_deck_doc(self, deck_id: str, payload: Dict[str, Any]) -> None:
        _write_json(self._deck_path(deck_id), payload)

    def delete_deck_doc(self, deck_id: str) -> bool:
        path = self._deck_path(deck_id)
        if path.exists():
            path.unlink()
            return True
        return False

    def list_deck_docs(self, owner_user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        root = self.data_dir / "microcards" / "decks"
        if not root.exists():
            return []
        docs: List[Dict[str, Any]] = []
        for p in root.glob("*.json"):
            doc = _read_json(p, None)
            if not isinstance(doc, dict):
                continue
            if owner_user_id is not None and str(doc.get("created_by_user_id") or "") != str(owner_user_id):
                continue
            docs.append(doc)
        return docs

    # ── per-user documents ────────────────────────────────────────────
    def _user_doc_path(self, user_id: str, kind: str) -> Path:
        return self.data_dir / "users" / str(user_id) / "microcards" / USER_DOC_FILES[kind]

    def get_user_doc(self, user_id: str, kind: str, default: Any = None) -> Any:
        return _read_json(self._user_doc_path(user_id, kind), default)

    def put_user_doc(self, user_id: str, kind: str, payload: Any) -> None:
        _write_json(self._user_doc_path(user_id, kind), payload)

    def delete_user_docs(self, user_id: str) -> int:
        removed = 0
        for kind in USER_DOC_FILES:
            path = self._user_doc_path(user_id, kind)
            if path.exists():
                path.unlink()
                removed += 1
        return removed


class PostgresMicrocardsStorage:
    """JSONB documents in Postgres (hosted runtime source of truth)."""

    backend_name = "postgres"
    _schema_ready = False

    def __init__(self, dsn: str) -> None:
        self._dsn = str(dsn or "").strip()

    def ensure_schema(self) -> None:
        if PostgresMicrocardsStorage._schema_ready:
            return
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    CREATE TABLE IF NOT EXISTS {DECKS_TABLE} (
                        deck_id TEXT PRIMARY KEY,
                        owner_user_id TEXT,
                        payload JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
                cur.execute(
                    f"""
                    CREATE TABLE IF NOT EXISTS {USER_DOCS_TABLE} (
                        user_id TEXT NOT NULL,
                        kind TEXT NOT NULL,
                        payload JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        PRIMARY KEY (user_id, kind)
                    )
                    """
                )
                cur.execute(
                    f"CREATE INDEX IF NOT EXISTS {DECKS_TABLE}_owner_idx ON {DECKS_TABLE} (owner_user_id)"
                )
        PostgresMicrocardsStorage._schema_ready = True

    @staticmethod
    def _json_value(value: Any) -> Any:
        if isinstance(value, (dict, list)):
            return value
        if isinstance(value, str):
            try:
                return json.loads(value)
            except ValueError:
                return None
        return value

    # ── deck documents ────────────────────────────────────────────────
    def get_deck_doc(self, deck_id: str) -> Optional[Dict[str, Any]]:
        self.ensure_schema()
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(f"SELECT payload FROM {DECKS_TABLE} WHERE deck_id = %s", (str(deck_id),))
                row = cur.fetchone()
        doc = self._json_value(row[0]) if row else None
        return doc if isinstance(doc, dict) else None

    def put_deck_doc(self, deck_id: str, payload: Dict[str, Any]) -> None:
        self.ensure_schema()
        owner = str(payload.get("created_by_user_id") or "")
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    INSERT INTO {DECKS_TABLE} (deck_id, owner_user_id, payload, updated_at)
                    VALUES (%s, %s, %s::jsonb, now())
                    ON CONFLICT (deck_id)
                    DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id,
                                  payload = EXCLUDED.payload,
                                  updated_at = now()
                    """,
                    (str(deck_id), owner, json.dumps(payload, ensure_ascii=False)),
                )

    def delete_deck_doc(self, deck_id: str) -> bool:
        self.ensure_schema()
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(f"DELETE FROM {DECKS_TABLE} WHERE deck_id = %s", (str(deck_id),))
                return bool(cur.rowcount)

    def list_deck_docs(self, owner_user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        self.ensure_schema()
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                if owner_user_id is None:
                    cur.execute(f"SELECT payload FROM {DECKS_TABLE}")
                else:
                    cur.execute(
                        f"SELECT payload FROM {DECKS_TABLE} WHERE owner_user_id = %s",
                        (str(owner_user_id),),
                    )
                rows = cur.fetchall()
        docs = []
        for (raw,) in rows:
            doc = self._json_value(raw)
            if isinstance(doc, dict):
                docs.append(doc)
        return docs

    # ── per-user documents ────────────────────────────────────────────
    def get_user_doc(self, user_id: str, kind: str, default: Any = None) -> Any:
        self.ensure_schema()
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT payload FROM {USER_DOCS_TABLE} WHERE user_id = %s AND kind = %s",
                    (str(user_id), str(kind)),
                )
                row = cur.fetchone()
        if not row:
            return default
        value = self._json_value(row[0])
        return default if value is None else value

    def put_user_doc(self, user_id: str, kind: str, payload: Any) -> None:
        self.ensure_schema()
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    INSERT INTO {USER_DOCS_TABLE} (user_id, kind, payload, updated_at)
                    VALUES (%s, %s, %s::jsonb, now())
                    ON CONFLICT (user_id, kind)
                    DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
                    """,
                    (str(user_id), str(kind), json.dumps(payload, ensure_ascii=False)),
                )

    def delete_user_docs(self, user_id: str) -> int:
        self.ensure_schema()
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(f"DELETE FROM {USER_DOCS_TABLE} WHERE user_id = %s", (str(user_id),))
                return int(cur.rowcount or 0)

    def delete_decks_owned_by(self, user_id: str) -> int:
        self.ensure_schema()
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(f"DELETE FROM {DECKS_TABLE} WHERE owner_user_id = %s", (str(user_id),))
                return int(cur.rowcount or 0)


def _is_hosted_runtime() -> bool:
    return str(os.environ.get("ACTRA_RUNTIME_MODE") or "").strip().lower() == "hosted_web"


def resolve_microcards_storage(data_dir: Any) -> PostgresMicrocardsStorage | FileMicrocardsStorage:
    """Pick the backend for this process: Postgres in hosted runs, files otherwise.

    Every consumer of microcards V2 data (service, analytics, backfill) must go
    through this resolver so they agree on the source of truth."""
    dsn = str(os.environ.get("ACTRA_POSTGRES_DSN") or "").strip()
    if _is_hosted_runtime() and dsn:
        return PostgresMicrocardsStorage(dsn)
    return FileMicrocardsStorage(data_dir)
