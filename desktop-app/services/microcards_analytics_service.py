"""
Microcards analytics service (M5).

Builds stable aggregate payloads for runtime/home/stats and keeps short-lived
in-memory caches with explicit invalidation hooks.
"""

from __future__ import annotations

import copy
import json
import logging
import time
from datetime import date, datetime
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple


def _utc_now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _safe_int(value: Any, *, minimum: int = 0) -> int:
    if isinstance(value, bool):
        parsed = 0
    else:
        try:
            parsed = int(value or 0)
        except Exception:
            parsed = 0
    if parsed < minimum:
        return minimum
    return parsed


def _safe_rate(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return round(float(numerator) / float(denominator), 3)


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            return parsed.replace(tzinfo=None)
        return parsed
    except Exception:
        return None


def _event_local_day_iso(event: Dict[str, Any]) -> Optional[str]:
    raw = str(event.get("reviewed_at") or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.date().isoformat()
        return parsed.astimezone().date().isoformat()
    except Exception:
        return None


class MicrocardsAnalyticsService:
    """Aggregates microcards summary + dynamics with user-scoped cache."""

    _RATING_KEYS: Tuple[str, ...] = ("again", "hard", "good", "easy")

    def __init__(
        self,
        data_dir: str,
        *,
        summary_cache_ttl_seconds: int = 180,
        dynamics_cache_ttl_seconds: int = 180,
    ) -> None:
        self.data_dir = Path(data_dir)
        self.logger = logging.getLogger(self.__class__.__name__)
        self._summary_cache_ttl_seconds = max(10, int(summary_cache_ttl_seconds or 180))
        self._dynamics_cache_ttl_seconds = max(10, int(dynamics_cache_ttl_seconds or 180))
        self._summary_cache: Dict[str, Tuple[Dict[str, Any], float]] = {}
        self._dynamics_cache: Dict[Tuple[str, int], Tuple[List[Dict[str, Any]], float]] = {}
        self._lock = Lock()

    def clear_cache(self, user_id: Optional[str] = None) -> None:
        """Clear cached summary/dynamics for one user or all users."""
        with self._lock:
            if user_id:
                resolved_user_id = self._normalize_user_id(user_id)
                self._summary_cache.pop(resolved_user_id, None)
                stale_keys = [key for key in self._dynamics_cache if key[0] == resolved_user_id]
                for key in stale_keys:
                    self._dynamics_cache.pop(key, None)
                return
            self._summary_cache.clear()
            self._dynamics_cache.clear()

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
            payload = self._build_summary_payload(resolved_user_id)
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

        events = self._load_review_events(resolved_user_id)
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
            reviews = _safe_int(day_payload.get("reviews"), minimum=0)
            correct_reviews = _safe_int(day_payload.get("correct_reviews"), minimum=0)
            time_spent_seconds = _safe_int(day_payload.get("time_spent_seconds"), minimum=0)
            by_card_type = self._format_by_card_type(day_payload.get("by_card_type"))
            ratings_distribution = self._normalize_ratings_distribution(day_payload.get("ratings_distribution"))
            rows.append(
                {
                    "date": day_iso,
                    "reviews": reviews,
                    "correct_reviews": correct_reviews,
                    "correct_rate": _safe_rate(correct_reviews, reviews),
                    "time_spent_seconds": time_spent_seconds,
                    "by_card_type": by_card_type,
                    "ratings_distribution": ratings_distribution,
                }
            )

        with self._lock:
            self._dynamics_cache[cache_key] = (copy.deepcopy(rows), now_ts)

        return rows

    def _build_summary_payload(self, user_id: str) -> Dict[str, Any]:
        events = self._load_review_events(user_id)
        today_iso = date.today().isoformat()
        aggregates = self._build_event_aggregates(events=events, today_iso=today_iso)
        queue_info = self._build_queue_summary(user_id)

        total_reviews = _safe_int(aggregates["totals"].get("reviews"), minimum=0)
        total_correct = _safe_int(aggregates["totals"].get("correct_reviews"), minimum=0)
        total_time = _safe_int(aggregates["totals"].get("time_spent_seconds"), minimum=0)
        today_reviews = _safe_int(aggregates["today"].get("reviews"), minimum=0)
        today_correct = _safe_int(aggregates["today"].get("correct_reviews"), minimum=0)
        today_time = _safe_int(aggregates["today"].get("time_spent_seconds"), minimum=0)

        return {
            "user_id": user_id,
            "generated_at": _utc_now_iso(),
            "totals": {
                "reviews": total_reviews,
                "correct_reviews": total_correct,
                "correct_rate": _safe_rate(total_correct, total_reviews),
                "time_spent_seconds": total_time,
                "decks_active": _safe_int(queue_info.get("decks_active"), minimum=0),
            },
            "today": {
                "reviews": today_reviews,
                "correct_reviews": today_correct,
                "correct_rate": _safe_rate(today_correct, today_reviews),
                "time_spent_seconds": today_time,
            },
            "queue_summary": queue_info.get("queue_summary") or {
                "decks_with_due": 0,
                "cards_due_total": 0,
                "cards_new_total": 0,
            },
            "by_card_type": self._format_by_card_type(aggregates.get("by_card_type")),
            "ratings_distribution": self._normalize_ratings_distribution(
                aggregates.get("ratings_distribution")
            ),
        }

    def _build_event_aggregates(self, *, events: List[Dict[str, Any]], today_iso: str) -> Dict[str, Any]:
        totals = {"reviews": 0, "correct_reviews": 0, "time_spent_seconds": 0}
        today = {"reviews": 0, "correct_reviews": 0, "time_spent_seconds": 0}
        ratings_distribution = {key: 0 for key in self._RATING_KEYS}
        by_card_type: Dict[str, Dict[str, int]] = {}
        daily_breakdown: Dict[str, Dict[str, Any]] = {}

        for event in events:
            if not isinstance(event, dict):
                continue

            details = event.get("details") if isinstance(event.get("details"), dict) else {}
            card_type = self._event_card_type(details)
            rating = self._event_rating(event.get("rating"))
            was_correct = bool(event.get("was_correct"))
            response_time_seconds = _safe_int(event.get("response_time_ms"), minimum=0) // 1000
            day_iso = _event_local_day_iso(event)

            totals["reviews"] += 1
            totals["time_spent_seconds"] += response_time_seconds
            if was_correct:
                totals["correct_reviews"] += 1

            if rating:
                ratings_distribution[rating] += 1

            by_type_row = by_card_type.setdefault(
                card_type,
                {"reviews": 0, "correct_reviews": 0, "perfect_reviews": 0},
            )
            by_type_row["reviews"] += 1
            if was_correct:
                by_type_row["correct_reviews"] += 1
            if card_type == "pair_match" and bool(details.get("is_perfect")):
                by_type_row["perfect_reviews"] += 1

            if day_iso:
                day_row = daily_breakdown.setdefault(
                    day_iso,
                    {
                        "reviews": 0,
                        "correct_reviews": 0,
                        "time_spent_seconds": 0,
                        "ratings_distribution": {key: 0 for key in self._RATING_KEYS},
                        "by_card_type": {},
                    },
                )
                day_row["reviews"] += 1
                day_row["time_spent_seconds"] += response_time_seconds
                if was_correct:
                    day_row["correct_reviews"] += 1
                if rating:
                    day_row["ratings_distribution"][rating] += 1
                day_type_row = day_row["by_card_type"].setdefault(
                    card_type,
                    {"reviews": 0, "correct_reviews": 0, "perfect_reviews": 0},
                )
                day_type_row["reviews"] += 1
                if was_correct:
                    day_type_row["correct_reviews"] += 1
                if card_type == "pair_match" and bool(details.get("is_perfect")):
                    day_type_row["perfect_reviews"] += 1

            if day_iso == today_iso:
                today["reviews"] += 1
                today["time_spent_seconds"] += response_time_seconds
                if was_correct:
                    today["correct_reviews"] += 1

        return {
            "totals": totals,
            "today": today,
            "by_card_type": by_card_type,
            "ratings_distribution": ratings_distribution,
            "daily_breakdown": daily_breakdown,
        }

    def _build_queue_summary(self, user_id: str) -> Dict[str, Any]:
        states = self._load_review_states(user_id)
        now = datetime.utcnow()
        decks_active = 0
        decks_with_due = 0
        cards_due_total = 0
        cards_new_total = 0

        for deck in self._load_decks():
            if not isinstance(deck, dict):
                continue
            deck_stats = self._deck_queue_stats(deck=deck, states=states, now=now)
            if deck_stats["cards_total"] > 0:
                decks_active += 1
            if deck_stats["cards_due"] > 0:
                decks_with_due += 1
            cards_due_total += deck_stats["cards_due"]
            cards_new_total += deck_stats["cards_new"]

        return {
            "decks_active": decks_active,
            "queue_summary": {
                "decks_with_due": decks_with_due,
                "cards_due_total": cards_due_total,
                "cards_new_total": cards_new_total,
            },
        }

    def _deck_queue_stats(self, *, deck: Dict[str, Any], states: Dict[str, Dict[str, Any]], now: datetime) -> Dict[str, int]:
        cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
        cards_total = 0
        cards_new = 0
        cards_due = 0

        for card in cards:
            if not isinstance(card, dict):
                continue
            card_status = str(card.get("status") or "active").strip().lower()
            if card_status == "archived":
                continue

            cards_total += 1
            card_id = str(card.get("id") or "").strip()
            state = states.get(card_id) if card_id else None
            state = state if isinstance(state, dict) else {}

            state_status = str(state.get("status") or "").strip().lower()
            if state_status == "suspended" or card_status == "suspended":
                continue

            due_at = _parse_iso_datetime(state.get("due_at"))
            is_new = (not state) or state_status in {"", "new"}
            if is_new:
                cards_new += 1
                if due_at is None or due_at <= now:
                    cards_due += 1
            else:
                if due_at is None or due_at <= now:
                    cards_due += 1

        return {
            "cards_total": cards_total,
            "cards_new": cards_new,
            "cards_due": cards_due,
        }

    def _normalize_user_id(self, user_id: Optional[str]) -> str:
        resolved = str(user_id or "").strip()
        return resolved or "default_user"

    def _event_card_type(self, details: Dict[str, Any]) -> str:
        card_type = str(details.get("card_type") or "").strip().lower()
        return card_type or "unknown"

    def _event_rating(self, rating_value: Any) -> Optional[str]:
        rating = str(rating_value or "").strip().lower()
        if rating in self._RATING_KEYS:
            return rating
        return None

    def _normalize_ratings_distribution(self, raw: Any) -> Dict[str, int]:
        payload = raw if isinstance(raw, dict) else {}
        return {key: _safe_int(payload.get(key), minimum=0) for key in self._RATING_KEYS}

    def _format_by_card_type(self, raw: Any) -> Dict[str, Dict[str, Any]]:
        payload = raw if isinstance(raw, dict) else {}
        out: Dict[str, Dict[str, Any]] = {}
        for card_type in sorted(payload.keys()):
            row = payload.get(card_type) if isinstance(payload.get(card_type), dict) else {}
            reviews = _safe_int(row.get("reviews"), minimum=0)
            correct_reviews = _safe_int(row.get("correct_reviews"), minimum=0)
            perfect_reviews = _safe_int(row.get("perfect_reviews"), minimum=0)

            out_row: Dict[str, Any] = {
                "reviews": reviews,
                "correct_rate": _safe_rate(correct_reviews, reviews),
            }
            if card_type == "pair_match":
                out_row["perfect_rate"] = _safe_rate(perfect_reviews, reviews)
            out[card_type] = out_row
        return out

    def _read_json_file(self, path: Path, default: Any) -> Any:
        if not path.exists():
            return default
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except Exception:
            self.logger.exception("Failed to read microcards analytics source %s", path)
            return default

    def _load_review_events(self, user_id: str) -> List[Dict[str, Any]]:
        payload = self._read_json_file(
            self.data_dir / "users" / user_id / "microcards" / "review_events.json",
            {"items": []},
        )
        items = payload.get("items") if isinstance(payload, dict) else []
        if not isinstance(items, list):
            return []
        return [item for item in items if isinstance(item, dict)]

    def _load_review_states(self, user_id: str) -> Dict[str, Dict[str, Any]]:
        payload = self._read_json_file(
            self.data_dir / "users" / user_id / "microcards" / "review_states.json",
            {"items": {}},
        )
        items = payload.get("items") if isinstance(payload, dict) else {}
        if not isinstance(items, dict):
            return {}

        out: Dict[str, Dict[str, Any]] = {}
        for card_id, state in items.items():
            if not isinstance(state, dict):
                continue
            normalized_card_id = str(card_id or "").strip()
            if not normalized_card_id:
                continue
            out[normalized_card_id] = dict(state)
        return out

    def _load_decks(self) -> List[Dict[str, Any]]:
        decks_root = self.data_dir / "microcards" / "decks"
        if not decks_root.exists():
            return []
        decks: List[Dict[str, Any]] = []
        for path in sorted(decks_root.glob("*.json"), key=lambda item: item.name):
            payload = self._read_json_file(path, None)
            if isinstance(payload, dict):
                decks.append(payload)
        return decks
