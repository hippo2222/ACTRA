from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

from persistence.hosted_microcards_repository import HostedMicrocardsRepository
from persistence.hosted_microcards_review_repository import HostedMicrocardsReviewRepository
from persistence.postgres import PostgresUnavailableError
from persistence.runtime import PersistenceRuntimeSettings
from services.hosted_shadow_fallback import HostedShadowFallbackMixin
from services.microcards_service import MicrocardsService, _read_json, _s, _utc_now_iso


class HostedMicrocardsService(HostedShadowFallbackMixin, MicrocardsService):
    """Hosted microcards service with Postgres-backed deck documents only."""

    hosted_service_contract = {
        "namespace": "hosted_microcards_runtime",
        "source_of_truth": "postgres",
        "hosted_ready": True,
        "surface_scope": "deck_documents_review_state",
    }

    def __init__(
        self,
        *,
        data_dir: str,
        user_id: Optional[str],
        persistence_settings: PersistenceRuntimeSettings,
    ) -> None:
        super().__init__(data_dir=data_dir, user_id=user_id)
        self.persistence_settings = persistence_settings
        self.repository = HostedMicrocardsRepository(self.persistence_settings.postgres_dsn)
        self.review_repository = HostedMicrocardsReviewRepository(self.persistence_settings.postgres_dsn)
        self._storage_ready = False
        self.logger = logging.getLogger(self.__class__.__name__)
        self._init_hosted_shadow_fallback_state()

    @property
    def hosted_storage_ready(self) -> bool:
        return bool(self._storage_ready)

    def ensure_persistence_ready(self) -> None:
        if self._storage_ready:
            return
        self.repository.ensure_schema()
        self.review_repository.ensure_schema()
        self._storage_ready = True

    def get_deck(self, deck_id: str) -> Optional[Dict[str, Any]]:
        clean_deck_id = _s(deck_id)
        if not clean_deck_id:
            return None
        try:
            self.ensure_persistence_ready()
            return self.repository.get_deck(clean_deck_id)
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("microcards.decks.get", exc)

    def list_decks(self, limit: int = 100) -> List[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
            decks = self.repository.list_decks(limit=limit)
            states = self._read_states()
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("microcards.decks.list", exc)
        rows: List[Tuple[str, Dict[str, Any]]] = []
        for deck in decks:
            if not isinstance(deck, dict):
                continue
            deck_id = _s(deck.get("id"))
            if not deck_id:
                continue
            meta = deck.get("meta") if isinstance(deck.get("meta"), dict) else {}
            row = {
                "id": deck_id,
                "schema_version": deck.get("schema_version"),
                "name": deck.get("name") or deck_id,
                "analysis_id": deck.get("analysis_id"),
                "target_language": deck.get("target_language"),
                "selector": deck.get("selector") if isinstance(deck.get("selector"), dict) else {},
                "settings": deck.get("settings") if isinstance(deck.get("settings"), dict) else {},
                "meta": meta,
                "ownership": self._deck_ownership(deck, meta),
                "stats": self._deck_user_stats(deck, states),
            }
            sort_key = _s(meta.get("updated_at")) or _s(meta.get("created_at"))
            rows.append((sort_key, row))
        rows.sort(key=lambda item: (item[0], item[1]["id"]), reverse=True)
        normalized_limit = max(1, min(int(limit or 100), 500))
        return [row for _, row in rows[:normalized_limit]]

    def _write_deck(self, deck: Dict[str, Any]) -> None:
        if not isinstance(deck, dict):
            return
        deck_id = _s(deck.get("id"))
        if not deck_id:
            return
        meta = deck.get("meta") if isinstance(deck.get("meta"), dict) else {}
        meta["updated_at"] = _utc_now_iso()
        deck["meta"] = meta
        cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
        deck["cards"] = cards
        deck["card_ids"] = [_s(card.get("id")) for card in cards if isinstance(card, dict) and _s(card.get("id"))]
        try:
            self.ensure_persistence_ready()
            self.repository.upsert_deck(deck, updated_at=_s(meta.get("updated_at")) or _utc_now_iso())
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("microcards.decks.write", exc)
            MicrocardsService._write_deck(self, deck)

    def delete_deck(self, deck_id: str) -> bool:
        clean_deck_id = _s(deck_id)
        if not clean_deck_id:
            return False
        try:
            self.ensure_persistence_ready()
            return self.repository.delete_deck(clean_deck_id)
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("microcards.decks.delete", exc)
            return MicrocardsService.delete_deck(self, clean_deck_id)

    def _read_states(self) -> Dict[str, Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
            payload = self.review_repository.get_document(self.user_id, "review_states")
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("microcards.review.states.read", exc)
        items = payload if isinstance(payload, dict) else {}
        out: Dict[str, Dict[str, Any]] = {}
        for card_id, state in items.items():
            if not isinstance(state, dict):
                continue
            clean_card_id = str(card_id or "").strip()
            if clean_card_id:
                out[clean_card_id] = dict(state)
        return out

    def _write_states(self, states: Dict[str, Dict[str, Any]]) -> None:
        payload = dict(states or {})
        try:
            self.ensure_persistence_ready()
            self.review_repository.write_document(
                self.user_id,
                "review_states",
                payload,
                updated_at=_utc_now_iso(),
            )
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("microcards.review.states.write", exc)
            MicrocardsService._write_states(self, states)

    def _append_event(self, event: Dict[str, Any]) -> None:
        try:
            self.ensure_persistence_ready()
            payload = self.review_repository.get_document(self.user_id, "review_events")
            items = payload if isinstance(payload, list) else []
            items = [item for item in items if isinstance(item, dict)]
            items.append(dict(event))
            if len(items) > 5000:
                items = items[-5000:]
            self.review_repository.write_document(
                self.user_id,
                "review_events",
                items,
                updated_at=_utc_now_iso(),
            )
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("microcards.review.events.append", exc)
            MicrocardsService._append_event(self, event)

    def _read_sessions(self) -> Dict[str, Any]:
        try:
            self.ensure_persistence_ready()
            payload = self.review_repository.get_document(self.user_id, "review_sessions")
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("microcards.review.sessions.read", exc)
        payload = payload if isinstance(payload, dict) else {}
        active_by_deck = payload.get("active_by_deck")
        items = payload.get("items")
        if not isinstance(active_by_deck, dict):
            active_by_deck = {}
        if not isinstance(items, dict):
            items = {}
        return {
            "schema_version": "1.0",
            "user_id": self.user_id,
            "updated_at": payload.get("updated_at"),
            "active_by_deck": active_by_deck,
            "items": items,
        }

    def _write_sessions(self, payload: Dict[str, Any]) -> None:
        normalized = self._read_sessions()
        if isinstance(payload, dict):
            normalized.update(payload)
        normalized["schema_version"] = "1.0"
        normalized["user_id"] = self.user_id
        normalized["updated_at"] = _utc_now_iso()
        if not isinstance(normalized.get("active_by_deck"), dict):
            normalized["active_by_deck"] = {}
        if not isinstance(normalized.get("items"), dict):
            normalized["items"] = {}
        try:
            self.ensure_persistence_ready()
            self.review_repository.write_document(
                self.user_id,
                "review_sessions",
                normalized,
                updated_at=_utc_now_iso(),
            )
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("microcards.review.sessions.write", exc)
            MicrocardsService._write_sessions(self, payload)
