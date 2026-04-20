from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from persistence.postgres import postgres_connection


class HostedMicrocardsRepository:
    """Postgres-backed storage for shared microcards deck documents."""

    def __init__(self, dsn: str) -> None:
        self._dsn = str(dsn or "").strip()

    def ensure_schema(self) -> None:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_hosted_microcards_decks (
                        deck_id TEXT PRIMARY KEY,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TEXT NOT NULL
                    )
                    """
                )

    def count_decks(self) -> int:
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM actra_hosted_microcards_decks")
                row = cur.fetchone()
        try:
            return int(row[0]) if row else 0
        except Exception:
            return 0

    def list_decks(self, *, limit: int = 100) -> List[Dict[str, Any]]:
        normalized_limit = max(1, min(int(limit or 100), 500))
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_hosted_microcards_decks
                    ORDER BY updated_at DESC, deck_id DESC
                    LIMIT %s
                    """,
                    (normalized_limit,),
                )
                rows = cur.fetchall() or []
        decks: List[Dict[str, Any]] = []
        for row in rows:
            payload = self._json_value(row[0] if row else None)
            if isinstance(payload, dict):
                decks.append(payload)
        return decks

    def get_deck(self, deck_id: str) -> Optional[Dict[str, Any]]:
        clean_deck_id = str(deck_id or "").strip()
        if not clean_deck_id:
            return None
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload
                    FROM actra_hosted_microcards_decks
                    WHERE deck_id = %s
                    LIMIT 1
                    """,
                    (clean_deck_id,),
                )
                row = cur.fetchone()
        payload = self._json_value(row[0]) if row else None
        return payload if isinstance(payload, dict) else None

    def upsert_deck(self, deck: Dict[str, Any], *, updated_at: str) -> None:
        clean_deck_id = str(deck.get("id") or "").strip()
        if not clean_deck_id:
            raise ValueError("deck_id is required")
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_microcards_decks (deck_id, payload, updated_at)
                    VALUES (%s, %s::jsonb, %s)
                    ON CONFLICT (deck_id) DO UPDATE
                    SET
                        payload = EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        clean_deck_id,
                        json.dumps(deck, ensure_ascii=False),
                        str(updated_at or "").strip(),
                    ),
                )

    def import_deck_if_absent(self, deck: Dict[str, Any], *, updated_at: str) -> None:
        clean_deck_id = str(deck.get("id") or "").strip()
        if not clean_deck_id:
            return
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO actra_hosted_microcards_decks (deck_id, payload, updated_at)
                    VALUES (%s, %s::jsonb, %s)
                    ON CONFLICT (deck_id) DO NOTHING
                    """,
                    (
                        clean_deck_id,
                        json.dumps(deck, ensure_ascii=False),
                        str(updated_at or "").strip(),
                    ),
                )

    def delete_deck(self, deck_id: str) -> bool:
        clean_deck_id = str(deck_id or "").strip()
        if not clean_deck_id:
            return False
        with postgres_connection(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM actra_hosted_microcards_decks WHERE deck_id = %s",
                    (clean_deck_id,),
                )
                deleted = int(cur.rowcount or 0)
        return deleted > 0

    @staticmethod
    def _json_value(value: Any) -> Optional[Any]:
        if isinstance(value, (dict, list)):
            return value
        if isinstance(value, str):
            try:
                return json.loads(value)
            except Exception:
                return None
        return None
