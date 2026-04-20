from __future__ import annotations

import copy
import logging
import time
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from persistence.hosted_microcards_repository import HostedMicrocardsRepository
from persistence.hosted_microcards_review_repository import HostedMicrocardsReviewRepository
from persistence.postgres import PostgresUnavailableError
from persistence.runtime import PersistenceRuntimeSettings
from services.hosted_shadow_fallback import HostedShadowFallbackMixin
from services.microcards_analytics_service import MicrocardsAnalyticsService


class HostedMicrocardsAnalyticsService(HostedShadowFallbackMixin, MicrocardsAnalyticsService):
    """Hosted analytics service backed by Postgres microcards runtime documents."""

    hosted_service_contract = {
        "namespace": "hosted_microcards_runtime",
        "source_of_truth": "postgres",
        "hosted_ready": True,
        "surface_scope": "review_state_analytics",
    }

    def __init__(
        self,
        data_dir: str,
        *,
        persistence_settings: PersistenceRuntimeSettings,
        summary_cache_ttl_seconds: int = 180,
        dynamics_cache_ttl_seconds: int = 180,
    ) -> None:
        super().__init__(
            data_dir=data_dir,
            summary_cache_ttl_seconds=summary_cache_ttl_seconds,
            dynamics_cache_ttl_seconds=dynamics_cache_ttl_seconds,
        )
        self.persistence_settings = persistence_settings
        self.deck_repository = HostedMicrocardsRepository(self.persistence_settings.postgres_dsn)
        self.review_repository = HostedMicrocardsReviewRepository(self.persistence_settings.postgres_dsn)
        self._storage_ready = False
        self.logger = logging.getLogger(self.__class__.__name__)
        self._init_hosted_shadow_fallback_state()
        self._active_operation: Optional[str] = None

    @property
    def hosted_storage_ready(self) -> bool:
        return bool(self._storage_ready)

    def ensure_persistence_ready(self) -> None:
        if self._storage_ready:
            return
        self.deck_repository.ensure_schema()
        self.review_repository.ensure_schema()
        self._storage_ready = True

    def get_summary(
        self,
        *,
        user_id: str,
        force_refresh: bool = False,
        include_dynamics: bool = False,
        dynamics_days: int = 30,
    ) -> Dict[str, Any]:
        resolved_user_id = self._normalize_user_id(user_id)
        now_ts = time.time()
        payload: Optional[Dict[str, Any]] = None

        if not force_refresh:
            with self._lock:
                cached = self._summary_cache.get(resolved_user_id)
                if cached and (now_ts - cached[1]) < self._summary_cache_ttl_seconds:
                    payload = copy.deepcopy(cached[0])

        if payload is None:
            try:
                self.ensure_persistence_ready()
                self._active_operation = "microcards.analytics.summary"
                payload = self._build_summary_payload(resolved_user_id)
            except PostgresUnavailableError as exc:
                self._guard_shadow_read_fallback("microcards.analytics.summary", exc)
            finally:
                self._active_operation = None
            with self._lock:
                self._summary_cache[resolved_user_id] = (copy.deepcopy(payload), now_ts)

        if include_dynamics:
            payload["dynamics"] = self.get_dynamics(
                user_id=resolved_user_id,
                days=dynamics_days,
                force_refresh=force_refresh,
            )

        return payload

    def get_dynamics(
        self,
        *,
        user_id: str,
        days: int = 30,
        force_refresh: bool = False,
    ) -> List[Dict[str, Any]]:
        resolved_user_id = self._normalize_user_id(user_id)
        normalized_days = max(1, min(int(days or 30), 3650))
        cache_key = (resolved_user_id, normalized_days)
        now_ts = time.time()

        if not force_refresh:
            with self._lock:
                cached = self._dynamics_cache.get(cache_key)
                if cached and (now_ts - cached[1]) < self._dynamics_cache_ttl_seconds:
                    return copy.deepcopy(cached[0])

        try:
            self.ensure_persistence_ready()
            self._active_operation = "microcards.analytics.dynamics"
            events = self._load_review_events(resolved_user_id)
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("microcards.analytics.dynamics", exc)
        finally:
            self._active_operation = None

        aggregates = self._build_event_aggregates(
            events=events,
            today_iso=date.today().isoformat(),
        )
        daily_raw = aggregates["daily_breakdown"]
        day_keys = sorted(daily_raw.keys())
        if len(day_keys) > normalized_days:
            day_keys = day_keys[-normalized_days:]

        rows: List[Dict[str, Any]] = []
        for day_iso in day_keys:
            day_payload = daily_raw.get(day_iso) or {}
            reviews = int(day_payload.get("reviews") or 0)
            correct_reviews = int(day_payload.get("correct_reviews") or 0)
            time_spent_seconds = int(day_payload.get("time_spent_seconds") or 0)
            by_card_type = self._format_by_card_type(day_payload.get("by_card_type"))
            ratings_distribution = self._normalize_ratings_distribution(day_payload.get("ratings_distribution"))
            rows.append(
                {
                    "date": day_iso,
                    "reviews": reviews,
                    "correct_reviews": correct_reviews,
                    "correct_rate": 0.0 if reviews <= 0 else round(float(correct_reviews) / float(reviews), 3),
                    "time_spent_seconds": time_spent_seconds,
                    "by_card_type": by_card_type,
                    "ratings_distribution": ratings_distribution,
                }
            )

        with self._lock:
            self._dynamics_cache[cache_key] = (copy.deepcopy(rows), now_ts)
        return rows

    def _load_review_events(self, user_id: str) -> List[Dict[str, Any]]:
        payload = self.review_repository.get_document(user_id, "review_events")
        items = payload if isinstance(payload, list) else []
        return [item for item in items if isinstance(item, dict)]

    def _load_review_states(self, user_id: str) -> Dict[str, Dict[str, Any]]:
        payload = self.review_repository.get_document(user_id, "review_states")
        items = payload if isinstance(payload, dict) else {}
        out: Dict[str, Dict[str, Any]] = {}
        for card_id, state in items.items():
            if not isinstance(state, dict):
                continue
            clean_card_id = str(card_id or "").strip()
            if not clean_card_id:
                continue
            out[clean_card_id] = dict(state)
        return out

    def _load_decks(self) -> List[Dict[str, Any]]:
        return [
            deck
            for deck in self.deck_repository.list_decks(limit=500)
            if isinstance(deck, dict)
        ]
