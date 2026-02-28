"""
Unit tests for microcards_backfill — T11 coverage plan.

Covers:
- Pure helpers: _safe_int, _parse_iso_datetime, _event_local_day_iso
- _event_sort_key, _event_is_pair_match, _event_pair_match_is_perfect
- _event_response_time_seconds, _empty_microcards_counters
- _read_json_file, _write_json_file
- reduce_microcards_review_events
"""

import sys
import os
import json
import pytest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.calendar.microcards_backfill import (
    _safe_int,
    _parse_iso_datetime,
    _event_local_day_iso,
    _event_sort_key,
    _event_is_pair_match,
    _event_pair_match_is_perfect,
    _event_response_time_seconds,
    _empty_microcards_counters,
    _read_json_file,
    _write_json_file,
    reduce_microcards_review_events,
    MICROCARDS_COUNTER_FIELDS,
)


# ═══════════════════════════════════════════════════════════════════
# _safe_int
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


# ═══════════════════════════════════════════════════════════════════
# _parse_iso_datetime
# ═══════════════════════════════════════════════════════════════════


class TestParseIsoDatetime:
    def test_valid_utc(self):
        result = _parse_iso_datetime("2024-06-15T10:30:00Z")
        assert result is not None
        assert result.year == 2024

    def test_valid_no_tz(self):
        result = _parse_iso_datetime("2024-06-15T10:30:00")
        assert result is not None

    def test_none(self):
        assert _parse_iso_datetime(None) is None

    def test_empty(self):
        assert _parse_iso_datetime("") is None

    def test_invalid(self):
        assert _parse_iso_datetime("not-a-date") is None


# ═══════════════════════════════════════════════════════════════════
# _event_local_day_iso
# ═══════════════════════════════════════════════════════════════════


class TestEventLocalDayIso:
    def test_valid(self):
        event = {"reviewed_at": "2024-06-15T10:00:00"}
        result = _event_local_day_iso(event)
        assert result == "2024-06-15"

    def test_missing(self):
        assert _event_local_day_iso({}) is None

    def test_invalid(self):
        assert _event_local_day_iso({"reviewed_at": "bad"}) is None


# ═══════════════════════════════════════════════════════════════════
# _event_sort_key
# ═══════════════════════════════════════════════════════════════════


class TestEventSortKey:
    def test_valid_event(self):
        event = {"reviewed_at": "2024-06-15T10:00:00", "id": "evt1"}
        key = _event_sort_key(event)
        assert key[0] == 0  # valid time

    def test_invalid_time(self):
        event = {"reviewed_at": "bad", "id": "evt2"}
        key = _event_sort_key(event)
        assert key[0] == 1  # invalid time

    def test_missing_time(self):
        key = _event_sort_key({})
        assert key[0] == 1


# ═══════════════════════════════════════════════════════════════════
# _event_is_pair_match / _event_pair_match_is_perfect
# ═══════════════════════════════════════════════════════════════════


class TestEventPairMatch:
    def test_is_pair_match(self):
        event = {"details": {"card_type": "pair_match"}}
        assert _event_is_pair_match(event) is True

    def test_not_pair_match(self):
        event = {"details": {"card_type": "fact_recall"}}
        assert _event_is_pair_match(event) is False

    def test_no_details(self):
        assert _event_is_pair_match({}) is False

    def test_perfect(self):
        event = {"details": {"card_type": "pair_match", "is_perfect": True}}
        assert _event_pair_match_is_perfect(event) is True

    def test_not_perfect(self):
        event = {"details": {"card_type": "pair_match", "is_perfect": False}}
        assert _event_pair_match_is_perfect(event) is False

    def test_not_pair_match_not_perfect(self):
        event = {"details": {"card_type": "fact_recall", "is_perfect": True}}
        assert _event_pair_match_is_perfect(event) is False


# ═══════════════════════════════════════════════════════════════════
# _event_response_time_seconds
# ═══════════════════════════════════════════════════════════════════


class TestEventResponseTime:
    def test_normal(self):
        assert _event_response_time_seconds({"response_time_ms": 5000}) == 5

    def test_zero(self):
        assert _event_response_time_seconds({}) == 0

    def test_sub_second(self):
        assert _event_response_time_seconds({"response_time_ms": 500}) == 0


# ═══════════════════════════════════════════════════════════════════
# _empty_microcards_counters
# ═══════════════════════════════════════════════════════════════════


class TestEmptyCounters:
    def test_has_all_fields(self):
        counters = _empty_microcards_counters()
        for field in MICROCARDS_COUNTER_FIELDS:
            assert field in counters
            assert counters[field] == 0


# ═══════════════════════════════════════════════════════════════════
# File I/O
# ═══════════════════════════════════════════════════════════════════


class TestFileIO:
    def test_read_missing(self, tmp_path):
        result = _read_json_file(tmp_path / "missing.json", {"default": True})
        assert result == {"default": True}

    def test_read_valid(self, tmp_path):
        path = tmp_path / "data.json"
        path.write_text(json.dumps({"key": "value"}), encoding="utf-8")
        result = _read_json_file(path, {})
        assert result["key"] == "value"

    def test_read_corrupt(self, tmp_path):
        path = tmp_path / "bad.json"
        path.write_text("{bad", encoding="utf-8")
        result = _read_json_file(path, {"fallback": True})
        assert result == {"fallback": True}

    def test_write(self, tmp_path):
        path = tmp_path / "sub" / "out.json"
        _write_json_file(path, {"written": True})
        assert path.exists()
        data = json.loads(path.read_text(encoding="utf-8"))
        assert data["written"] is True


# ═══════════════════════════════════════════════════════════════════
# reduce_microcards_review_events
# ═══════════════════════════════════════════════════════════════════


class TestReduceEvents:
    def test_empty(self):
        result = reduce_microcards_review_events([])
        assert result["totals"]["microcards_reviews"] == 0
        assert result["days"] == {}

    def test_single_event(self):
        events = [
            {
                "reviewed_at": "2024-06-15T10:00:00",
                "was_correct": True,
                "response_time_ms": 3000,
                "details": {"card_type": "fact_recall"},
            }
        ]
        result = reduce_microcards_review_events(events)
        assert result["totals"]["microcards_reviews"] == 1
        assert result["totals"]["microcards_correct"] == 1
        assert result["totals"]["microcards_seconds_spent"] == 3
        assert "2024-06-15" in result["days"]

    def test_pair_match_perfect(self):
        events = [
            {
                "reviewed_at": "2024-06-15T10:00:00",
                "was_correct": True,
                "response_time_ms": 2000,
                "details": {"card_type": "pair_match", "is_perfect": True},
            }
        ]
        result = reduce_microcards_review_events(events)
        assert result["totals"]["microcards_pair_match_reviews"] == 1
        assert result["totals"]["microcards_pair_match_perfect"] == 1

    def test_invalid_events_tracked(self):
        events = [
            {"reviewed_at": "", "was_correct": True},
            {"reviewed_at": "2024-06-15T10:00:00", "was_correct": False, "response_time_ms": 1000},
        ]
        result = reduce_microcards_review_events(events)
        assert result["totals"]["microcards_reviews"] == 1
        assert len(result["invalid_event_refs"]) == 1

    def test_multiple_days(self):
        events = [
            {"reviewed_at": "2024-06-15T10:00:00", "was_correct": True, "response_time_ms": 1000},
            {"reviewed_at": "2024-06-16T10:00:00", "was_correct": False, "response_time_ms": 2000},
        ]
        result = reduce_microcards_review_events(events)
        assert result["totals"]["microcards_reviews"] == 2
        assert len(result["days"]) == 2

    def test_non_dict_events_filtered(self):
        events = ["bad", None, {"reviewed_at": "2024-06-15T10:00:00", "was_correct": True}]
        result = reduce_microcards_review_events(events)
        assert result["totals"]["microcards_reviews"] == 1
