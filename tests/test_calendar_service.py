"""
Unit tests for CalendarService helpers and core methods — T23 coverage plan.

Covers:
- _normalize_activity_entry (dict, numeric legacy, negative, missing fields)
- _empty_activity_entry
- CalendarService init, switch_user
- _load_json / _save_json
- load/save settings, activity, rest days
"""

import sys
import os
import json
import pytest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.calendar.calendar_service import (
    _normalize_activity_entry,
    _empty_activity_entry,
    CalendarService,
)


# ═══════════════════════════════════════════════════════════════════
# _normalize_activity_entry
# ═══════════════════════════════════════════════════════════════════


class TestNormalizeActivityEntry:
    def test_empty_dict(self):
        result = _normalize_activity_entry({})
        assert result["tasks_attempted"] == 0
        assert result["microcards_reviews"] == 0
        assert result["activity_attempts_total"] == 0
        assert result["activity_sources"]["tasks"]["attempts"] == 0

    def test_with_values(self):
        result = _normalize_activity_entry({
            "tasks_attempted": 5,
            "tasks_solved": 3,
            "seconds_spent": 120,
            "microcards_reviews": 10,
            "microcards_correct": 8,
            "microcards_seconds_spent": 60,
        })
        assert result["tasks_attempted"] == 5
        assert result["activity_attempts_total"] == 15  # 5+10
        assert result["activity_success_total"] == 11  # 3+8
        assert result["activity_seconds_spent_total"] == 180  # 120+60

    def test_legacy_numeric(self):
        result = _normalize_activity_entry(42)
        assert result["tasks_attempted"] == 0
        assert result["completion_percent"] == 0

    def test_negative_values_clamped(self):
        result = _normalize_activity_entry({"tasks_attempted": -5})
        assert result["tasks_attempted"] == 0

    def test_none_values(self):
        result = _normalize_activity_entry({"tasks_attempted": None})
        assert result["tasks_attempted"] == 0

    def test_invalid_session_ids(self):
        result = _normalize_activity_entry({"session_ids": "not_a_list"})
        assert result["session_ids"] == []

    def test_streak_and_rest(self):
        result = _normalize_activity_entry({"streak_active": True, "rest_day": True})
        assert result["streak_active"] is True
        assert result["rest_day"] is True

    def test_streak_falsy(self):
        result = _normalize_activity_entry({"streak_active": 0})
        assert result["streak_active"] is False

    def test_pair_match_fields(self):
        result = _normalize_activity_entry({
            "microcards_pair_match_reviews": 5,
            "microcards_pair_match_perfect": 3,
        })
        assert result["microcards_pair_match_reviews"] == 5
        assert result["microcards_pair_match_perfect"] == 3


# ═══════════════════════════════════════════════════════════════════
# _empty_activity_entry
# ═══════════════════════════════════════════════════════════════════


class TestEmptyActivityEntry:
    def test_returns_normalized(self):
        result = _empty_activity_entry()
        assert result["tasks_attempted"] == 0
        assert "activity_sources" in result
        assert result["activity_sources"]["tasks"]["attempts"] == 0


# ═══════════════════════════════════════════════════════════════════
# CalendarService init / switch_user
# ═══════════════════════════════════════════════════════════════════


@pytest.fixture
def svc(tmp_path):
    return CalendarService(data_dir=str(tmp_path), user_id="user1")


class TestInit:
    def test_creates_dir(self, tmp_path):
        svc = CalendarService(data_dir=str(tmp_path), user_id="user1")
        assert (tmp_path / "user_calendar" / "user1").is_dir()

    def test_switch_user(self, svc, tmp_path):
        svc.switch_user("user2")
        assert svc.user_id == "user2"
        assert (tmp_path / "user_calendar" / "user2").is_dir()


# ═══════════════════════════════════════════════════════════════════
# _load_json / _save_json
# ═══════════════════════════════════════════════════════════════════


class TestJsonIO:
    def test_load_missing(self, svc):
        result = svc._load_json(Path("/nonexistent.json"), default={"x": 1})
        assert result == {"x": 1}

    def test_load_valid(self, svc):
        path = svc.calendar_dir / "test.json"
        path.write_text(json.dumps({"key": "value"}), encoding="utf-8")
        result = svc._load_json(path)
        assert result["key"] == "value"

    def test_save_and_load(self, svc):
        path = svc.calendar_dir / "out.json"
        svc._save_json(path, {"saved": True})
        result = svc._load_json(path)
        assert result["saved"] is True


# ═══════════════════════════════════════════════════════════════════
# Settings
# ═══════════════════════════════════════════════════════════════════


class TestSettings:
    def test_load_default_settings(self, svc):
        settings = svc.get_settings()
        assert settings is not None
        assert hasattr(settings, "schedule_mode") or isinstance(settings, dict)


# ═══════════════════════════════════════════════════════════════════
# Activity
# ═══════════════════════════════════════════════════════════════════


class TestActivity:
    def test_load_empty_activity(self, svc):
        result = svc.get_activity_history(days=30)
        assert isinstance(result, dict)

    def test_save_activity(self, svc):
        from datetime import date
        result = svc.save_activity(date(2024, 6, 15), 80)
        assert result is True
        activity = svc.get_activity_history(days=365)
        assert "2024-06-15" in activity


# ═══════════════════════════════════════════════════════════════════
# Rest days
# ═══════════════════════════════════════════════════════════════════


class TestRestDays:
    def test_load_empty(self, svc):
        result = svc.get_rest_days()
        assert isinstance(result, (list, dict))
