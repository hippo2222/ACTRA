"""
Unit tests for MicrocardsAnalyticsService — T12 coverage plan.

Covers:
- Pure helpers: _safe_int, _safe_rate, _parse_iso_datetime, _event_local_day_iso
- _normalize_user_id, _event_card_type, _event_rating
- _normalize_ratings_distribution, _format_by_card_type
- _build_event_aggregates
- _deck_queue_stats
- Cache: clear_cache, get_summary caching, get_dynamics caching
- _load_review_events, _load_review_states, _load_decks
- get_summary / get_dynamics integration
"""

import sys
import os
import json
import pytest
from datetime import datetime, date
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.microcards_analytics_service import (
    MicrocardsAnalyticsService,
    _safe_int,
    _safe_rate,
    _parse_iso_datetime,
    _event_local_day_iso,
)


@pytest.fixture
def svc(tmp_path):
    return MicrocardsAnalyticsService(data_dir=str(tmp_path))


# ═══════════════════════════════════════════════════════════════════
# Pure helpers
# ═══════════════════════════════════════════════════════════════════


class TestSafeInt:
    def test_int(self):
        assert _safe_int(5) == 5

    def test_string(self):
        assert _safe_int("10") == 10

    def test_none(self):
        assert _safe_int(None) == 0

    def test_bool(self):
        assert _safe_int(True) == 0

    def test_minimum(self):
        assert _safe_int(-5, minimum=0) == 0

    def test_invalid(self):
        assert _safe_int("abc") == 0


class TestSafeRate:
    def test_normal(self):
        assert _safe_rate(3, 10) == 0.3

    def test_zero_denominator(self):
        assert _safe_rate(5, 0) == 0.0

    def test_negative_denominator(self):
        assert _safe_rate(5, -1) == 0.0


class TestParseIsoDatetime:
    def test_valid(self):
        result = _parse_iso_datetime("2024-01-15T10:30:00Z")
        assert result is not None
        assert result.year == 2024

    def test_none(self):
        assert _parse_iso_datetime(None) is None

    def test_empty(self):
        assert _parse_iso_datetime("") is None

    def test_invalid(self):
        assert _parse_iso_datetime("not-a-date") is None


class TestEventLocalDayIso:
    def test_valid(self):
        event = {"reviewed_at": "2024-06-15T10:00:00Z"}
        result = _event_local_day_iso(event)
        assert result is not None
        assert "2024" in result

    def test_missing(self):
        assert _event_local_day_iso({}) is None

    def test_invalid(self):
        assert _event_local_day_iso({"reviewed_at": "bad"}) is None


# ═══════════════════════════════════════════════════════════════════
# Instance helpers
# ═══════════════════════════════════════════════════════════════════


class TestNormalizeUserId:
    def test_normal(self, svc):
        assert svc._normalize_user_id("user1") == "user1"

    def test_none(self, svc):
        assert svc._normalize_user_id(None) == "default_user"

    def test_empty(self, svc):
        assert svc._normalize_user_id("  ") == "default_user"


class TestEventCardType:
    def test_normal(self, svc):
        assert svc._event_card_type({"card_type": "fact_recall"}) == "fact_recall"

    def test_empty(self, svc):
        assert svc._event_card_type({}) == "unknown"


class TestEventRating:
    def test_valid(self, svc):
        assert svc._event_rating("good") == "good"
        assert svc._event_rating("again") == "again"

    def test_invalid(self, svc):
        assert svc._event_rating("invalid") is None

    def test_none(self, svc):
        assert svc._event_rating(None) is None


class TestNormalizeRatingsDistribution:
    def test_normal(self, svc):
        result = svc._normalize_ratings_distribution({"again": 2, "good": 5})
        assert result["again"] == 2
        assert result["good"] == 5
        assert result["hard"] == 0
        assert result["easy"] == 0

    def test_none(self, svc):
        result = svc._normalize_ratings_distribution(None)
        assert all(v == 0 for v in result.values())


class TestFormatByCardType:
    def test_normal(self, svc):
        raw = {
            "fact_recall": {"reviews": 10, "correct_reviews": 8, "perfect_reviews": 0},
            "pair_match": {"reviews": 5, "correct_reviews": 3, "perfect_reviews": 2},
        }
        result = svc._format_by_card_type(raw)
        assert result["fact_recall"]["reviews"] == 10
        assert result["fact_recall"]["correct_rate"] == 0.8
        assert "perfect_rate" not in result["fact_recall"]
        assert result["pair_match"]["perfect_rate"] == 0.4

    def test_none(self, svc):
        assert svc._format_by_card_type(None) == {}


# ═══════════════════════════════════════════════════════════════════
# _build_event_aggregates
# ═══════════════════════════════════════════════════════════════════


class TestBuildEventAggregates:
    def test_empty(self, svc):
        result = svc._build_event_aggregates(events=[], today_iso="2024-06-15")
        assert result["totals"]["reviews"] == 0
        assert result["today"]["reviews"] == 0

    def test_with_events(self, svc):
        events = [
            {
                "reviewed_at": "2024-06-15T10:00:00Z",
                "rating": "good",
                "was_correct": True,
                "response_time_ms": 5000,
                "details": {"card_type": "fact_recall"},
            },
            {
                "reviewed_at": "2024-06-15T11:00:00Z",
                "rating": "again",
                "was_correct": False,
                "response_time_ms": 3000,
                "details": {"card_type": "fact_recall"},
            },
        ]
        result = svc._build_event_aggregates(events=events, today_iso="2024-06-15")
        assert result["totals"]["reviews"] == 2
        assert result["totals"]["correct_reviews"] == 1
        assert result["ratings_distribution"]["good"] == 1
        assert result["ratings_distribution"]["again"] == 1


# ═══════════════════════════════════════════════════════════════════
# _deck_queue_stats
# ═══════════════════════════════════════════════════════════════════


class TestDeckQueueStats:
    def test_empty_deck(self, svc):
        result = svc._deck_queue_stats(deck={"cards": []}, states={}, now=datetime.utcnow())
        assert result == {"cards_total": 0, "cards_new": 0, "cards_due": 0}

    def test_new_cards_are_due(self, svc):
        deck = {"cards": [{"id": "c1", "status": "active"}, {"id": "c2", "status": "active"}]}
        result = svc._deck_queue_stats(deck=deck, states={}, now=datetime.utcnow())
        assert result["cards_total"] == 2
        assert result["cards_new"] == 2
        assert result["cards_due"] == 2

    def test_archived_excluded(self, svc):
        deck = {"cards": [{"id": "c1", "status": "archived"}]}
        result = svc._deck_queue_stats(deck=deck, states={}, now=datetime.utcnow())
        assert result["cards_total"] == 0

    def test_suspended_excluded(self, svc):
        deck = {"cards": [{"id": "c1", "status": "active"}]}
        states = {"c1": {"status": "suspended"}}
        result = svc._deck_queue_stats(deck=deck, states=states, now=datetime.utcnow())
        assert result["cards_due"] == 0


# ═══════════════════════════════════════════════════════════════════
# Cache
# ═══════════════════════════════════════════════════════════════════


class TestCache:
    def test_clear_all(self, svc):
        svc._summary_cache["u1"] = ({}, 0)
        svc._dynamics_cache[("u1", 30)] = ([], 0)
        svc.clear_cache()
        assert len(svc._summary_cache) == 0
        assert len(svc._dynamics_cache) == 0

    def test_clear_user(self, svc):
        svc._summary_cache["u1"] = ({}, 0)
        svc._summary_cache["u2"] = ({}, 0)
        svc._dynamics_cache[("u1", 30)] = ([], 0)
        svc.clear_cache(user_id="u1")
        assert "u1" not in svc._summary_cache
        assert "u2" in svc._summary_cache
        assert ("u1", 30) not in svc._dynamics_cache


# ═══════════════════════════════════════════════════════════════════
# File I/O
# ═══════════════════════════════════════════════════════════════════


class TestFileIO:
    def test_load_review_events_empty(self, svc):
        assert svc._load_review_events("user1") == []

    def test_load_review_events_with_data(self, svc, tmp_path):
        events_dir = tmp_path / "users" / "user1" / "microcards"
        events_dir.mkdir(parents=True)
        (events_dir / "review_events.json").write_text(
            json.dumps({"items": [{"reviewed_at": "2024-01-01T00:00:00Z"}]}),
            encoding="utf-8",
        )
        result = svc._load_review_events("user1")
        assert len(result) == 1

    def test_load_review_states_empty(self, svc):
        assert svc._load_review_states("user1") == {}

    def test_load_decks_empty(self, svc):
        assert svc._load_decks() == []

    def test_load_decks_with_file(self, svc, tmp_path):
        decks_dir = tmp_path / "microcards" / "decks"
        decks_dir.mkdir(parents=True)
        (decks_dir / "deck1.json").write_text(
            json.dumps({"id": "d1", "cards": []}), encoding="utf-8"
        )
        result = svc._load_decks()
        assert len(result) == 1


# ═══════════════════════════════════════════════════════════════════
# get_summary / get_dynamics integration
# ═══════════════════════════════════════════════════════════════════


class TestGetSummary:
    def test_basic(self, svc):
        result = svc.get_summary(user_id="user1")
        assert result["user_id"] == "user1"
        assert "totals" in result
        assert "today" in result
        assert result["totals"]["reviews"] == 0

    def test_cached(self, svc):
        r1 = svc.get_summary(user_id="user1")
        r2 = svc.get_summary(user_id="user1")
        assert r1["generated_at"] == r2["generated_at"]

    def test_force_refresh(self, svc):
        svc.get_summary(user_id="user1")
        r2 = svc.get_summary(user_id="user1", force_refresh=True)
        assert "totals" in r2

    def test_include_dynamics(self, svc):
        result = svc.get_summary(user_id="user1", include_dynamics=True)
        assert "dynamics" in result
        assert isinstance(result["dynamics"], list)


class TestGetDynamics:
    def test_empty(self, svc):
        result = svc.get_dynamics(user_id="user1", days=30)
        assert result == []

    def test_with_events(self, svc, tmp_path):
        events_dir = tmp_path / "users" / "user1" / "microcards"
        events_dir.mkdir(parents=True)
        today = date.today().isoformat()
        events = [
            {
                "reviewed_at": f"{today}T10:00:00",
                "rating": "good",
                "was_correct": True,
                "response_time_ms": 2000,
                "details": {"card_type": "fact_recall"},
            }
        ]
        (events_dir / "review_events.json").write_text(
            json.dumps({"items": events}), encoding="utf-8"
        )
        result = svc.get_dynamics(user_id="user1", days=7)
        assert len(result) >= 1
        assert result[0]["reviews"] >= 1
