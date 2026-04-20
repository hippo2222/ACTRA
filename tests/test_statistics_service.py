"""
Unit tests for StatisticsService — T3 coverage plan.

Covers:
- Pure helpers: _safe_int, _safe_float, _safe_rate
- Instance helpers: _normalize_ratings_distribution, _empty_microcards_overall_payload,
  _has_learning_activity, _extract_microcards_day_metrics, _extract_task_type
- Streak computation: _compute_activity_streak_metrics
- Complex statistics: load/save round-trip, update_complex_stats, get_recent_sessions
- Cache management: clear_cache, _on_progress_updated
- _extended_to_recent_summary conversion
- aggregate_statistics with mock ProgressService
- get_weak_areas with mock ProgressService
"""

import sys
import os
import json
import time
import pytest
from datetime import datetime, date, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from persistence.postgres import PostgresUnavailableError
from persistence.runtime import PersistenceRuntimeSettings
from services.hosted_shadow_fallback import (
    HostedShadowReadFallbackDisabledError,
    HostedShadowWriteFallbackDisabledError,
)
from services.statistics_service import StatisticsService, _safe_int, _safe_float, _safe_rate
from task_system.core.models.complex_models import ExtendedSessionResultSummary, RecentSessionSummary


# ─── Helpers ───────────────────────────────────────────────────────


def _make_progress_service(user_id="test_user", task_history=None, complex_completions=None):
    """Create a mock ProgressService with controllable progress_data."""
    ps = MagicMock()
    ps.user_id = user_id
    ps.progress_manager = MagicMock()
    ps.progress_manager.get_progress_data.return_value = {
        "task_history": task_history or {},
        "complex_completions": complex_completions or [],
    }
    return ps


def _make_svc(tmp_path, user_id="test_user", task_history=None, complex_completions=None):
    """Build StatisticsService with mocked dependencies and real data_dir."""
    ps = _make_progress_service(user_id, task_history, complex_completions)
    svc = StatisticsService(ps, data_dir=str(tmp_path))
    # Prevent lazy microcards init from importing real modules
    svc._microcards_analytics_service = False
    return svc


def _build_hosted_settings(tmp_path: Path) -> PersistenceRuntimeSettings:
    return PersistenceRuntimeSettings(
        runtime_mode="hosted_web",
        data_root=tmp_path,
        state_root=tmp_path / "runtime_state",
        postgres_dsn="",
        s3_endpoint="",
        s3_bucket="",
        s3_access_key="",
        s3_secret_key="",
        hosted_contract_errors=["missing_env:ACTRA_POSTGRES_DSN"],
    )


class _FakeHostedComplexStatisticsRepository:
    def __init__(self):
        self.payloads = {}
        self.ensure_schema_calls = 0

    def ensure_schema(self):
        self.ensure_schema_calls += 1

    def get_statistics(self, user_id: str):
        return self.payloads.get(user_id)

    def write_statistics(self, user_id: str, payload, *, updated_at: str):
        self.payloads[user_id] = dict(payload)


class _UnavailableHostedComplexStatisticsRepository:
    def ensure_schema(self):
        raise PostgresUnavailableError("postgres_dsn_missing")

    def get_statistics(self, user_id: str):
        raise PostgresUnavailableError("postgres_dsn_missing")

    def write_statistics(self, user_id: str, payload, *, updated_at: str):
        raise PostgresUnavailableError("postgres_dsn_missing")


class _FakeHostedCalendarRepository:
    def __init__(self):
        self.payloads = {}

    def get_document(self, user_id: str, doc_kind: str):
        return self.payloads.get((user_id, doc_kind))


class _UnavailableHostedCalendarRepository:
    def get_document(self, user_id: str, doc_kind: str):
        raise PostgresUnavailableError("postgres_dsn_missing")


# ═══════════════════════════════════════════════════════════════════
# Pure helpers
# ═══════════════════════════════════════════════════════════════════


class TestSafeInt:
    def test_normal(self):
        assert _safe_int(5) == 5

    def test_string(self):
        assert _safe_int("10") == 10

    def test_none(self):
        assert _safe_int(None) == 0

    def test_bad_string(self):
        assert _safe_int("abc") == 0

    def test_minimum_clamp(self):
        assert _safe_int(-5, minimum=0) == 0

    def test_float_truncated(self):
        assert _safe_int(3.9) == 3


class TestSafeFloat:
    def test_normal(self):
        assert _safe_float(1.5) == 1.5

    def test_string(self):
        assert _safe_float("2.5") == 2.5

    def test_none(self):
        assert _safe_float(None) == 0.0

    def test_bad_string(self):
        assert _safe_float("xyz") == 0.0

    def test_minimum_clamp(self):
        assert _safe_float(-1.0, minimum=0.0) == 0.0


class TestSafeRate:
    def test_normal(self):
        assert _safe_rate(3, 4) == 0.75

    def test_zero_denominator(self):
        assert _safe_rate(5, 0) == 0.0

    def test_negative_denominator(self):
        assert _safe_rate(1, -1) == 0.0

    def test_rounding(self):
        assert _safe_rate(1, 3) == 0.333


# ═══════════════════════════════════════════════════════════════════
# Instance helpers
# ═══════════════════════════════════════════════════════════════════


class TestNormalizeRatingsDistribution:
    def test_normal(self, tmp_path):
        svc = _make_svc(tmp_path)
        result = svc._normalize_ratings_distribution({"again": 1, "hard": 2, "good": 3, "easy": 4})
        assert result == {"again": 1, "hard": 2, "good": 3, "easy": 4}

    def test_empty(self, tmp_path):
        svc = _make_svc(tmp_path)
        result = svc._normalize_ratings_distribution({})
        assert result == {"again": 0, "hard": 0, "good": 0, "easy": 0}

    def test_not_dict(self, tmp_path):
        svc = _make_svc(tmp_path)
        result = svc._normalize_ratings_distribution("bad")
        assert result == {"again": 0, "hard": 0, "good": 0, "easy": 0}


class TestEmptyMicrocardsPayload:
    def test_structure(self, tmp_path):
        svc = _make_svc(tmp_path)
        p = svc._empty_microcards_overall_payload()
        assert p["reviews_total"] == 0
        assert p["correct_rate"] == 0.0
        assert p["decks_active"] == 0
        assert "ratings_distribution" in p


class TestHasLearningActivity:
    def test_dict_with_attempts(self, tmp_path):
        svc = _make_svc(tmp_path)
        assert svc._has_learning_activity({"activity_attempts_total": 5}) is True

    def test_dict_with_legacy_attempts(self, tmp_path):
        svc = _make_svc(tmp_path)
        assert svc._has_learning_activity({"tasks_attempted": 3}) is True

    def test_dict_with_microcards(self, tmp_path):
        svc = _make_svc(tmp_path)
        assert svc._has_learning_activity({"microcards_reviews": 2}) is True

    def test_dict_with_completion(self, tmp_path):
        svc = _make_svc(tmp_path)
        assert svc._has_learning_activity({"completion_percent": 50}) is True

    def test_dict_empty(self, tmp_path):
        svc = _make_svc(tmp_path)
        assert svc._has_learning_activity({}) is False

    def test_int_positive(self, tmp_path):
        svc = _make_svc(tmp_path)
        assert svc._has_learning_activity(5) is True

    def test_int_zero(self, tmp_path):
        svc = _make_svc(tmp_path)
        assert svc._has_learning_activity(0) is False

    def test_none(self, tmp_path):
        svc = _make_svc(tmp_path)
        assert svc._has_learning_activity(None) is False


class TestExtractMicrocardsDayMetrics:
    def test_normal(self, tmp_path):
        svc = _make_svc(tmp_path)
        result = svc._extract_microcards_day_metrics({
            "microcards_reviews": 10,
            "microcards_correct": 8,
            "microcards_seconds_spent": 300,
        })
        assert result["reviews"] == 10
        assert result["correct_reviews"] == 8
        assert result["time_spent_seconds"] == 300

    def test_not_dict(self, tmp_path):
        svc = _make_svc(tmp_path)
        result = svc._extract_microcards_day_metrics("bad")
        assert result == {"reviews": 0, "correct_reviews": 0, "time_spent_seconds": 0}


class TestExtractTaskType:
    def test_no_repository(self, tmp_path):
        svc = _make_svc(tmp_path)
        svc.module_repository = None
        assert svc._extract_task_type("mod/topic/task") == "unknown"

    def test_bad_format(self, tmp_path):
        svc = _make_svc(tmp_path)
        svc.module_repository = MagicMock()
        assert svc._extract_task_type("bad_ref") == "unknown"

    def test_found(self, tmp_path):
        svc = _make_svc(tmp_path)
        mock_task = MagicMock()
        mock_task.task_type = "click"
        repo = MagicMock()
        repo.get_task.return_value = mock_task
        svc.module_repository = repo
        assert svc._extract_task_type("mod/topic/task") == "click"

    def test_exception(self, tmp_path):
        svc = _make_svc(tmp_path)
        repo = MagicMock()
        repo.get_task.side_effect = Exception("fail")
        svc.module_repository = repo
        assert svc._extract_task_type("mod/topic/task") == "unknown"


# ═══════════════════════════════════════════════════════════════════
# Complex statistics file I/O
# ═══════════════════════════════════════════════════════════════════


class TestComplexStatisticsIO:
    def test_load_empty(self, tmp_path):
        svc = _make_svc(tmp_path)
        assert svc._load_complex_statistics("user1") == {}

    def test_save_and_load(self, tmp_path):
        svc = _make_svc(tmp_path)
        data = {"complex_1": {"aggregated": {"attempts": 5, "wins": 3, "success_rate": 0.6}, "recent_sessions": []}}
        assert svc._save_complex_statistics("user1", data) is True
        loaded = svc._load_complex_statistics("user1")
        assert loaded["complex_1"]["aggregated"]["attempts"] == 5

    def test_get_complex_statistics(self, tmp_path):
        svc = _make_svc(tmp_path)
        svc._save_complex_statistics("user1", {"c1": {"aggregated": {}, "recent_sessions": []}})
        result = svc.get_complex_statistics("user1")
        assert "c1" in result

    def test_load_corrupt_json(self, tmp_path):
        svc = _make_svc(tmp_path)
        user_dir = tmp_path / "users" / "user1"
        user_dir.mkdir(parents=True)
        (user_dir / "complex_statistics.json").write_text("{bad", encoding="utf-8")
        assert svc._load_complex_statistics("user1") == {}

    def test_hosted_round_trip_uses_repository_source_of_truth(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
        svc = StatisticsService(
            _make_progress_service(),
            data_dir=str(tmp_path),
            persistence_settings=_build_hosted_settings(tmp_path),
        )
        svc._microcards_analytics_service = False
        svc._complex_statistics_repository = _FakeHostedComplexStatisticsRepository()

        data = {"complex_1": {"aggregated": {"attempts": 5, "wins": 3, "success_rate": 0.6}, "recent_sessions": []}}
        assert svc._save_complex_statistics("user1", data) is True

        loaded = svc._load_complex_statistics("user1")

        assert loaded == data
        assert svc.hosted_storage_ready is True
        assert not (tmp_path / "users" / "user1" / "complex_statistics.json").exists()

    def test_hosted_write_blocks_shadow_fallback_by_default(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
        monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)

        svc = StatisticsService(
            _make_progress_service(),
            data_dir=str(tmp_path),
            persistence_settings=_build_hosted_settings(tmp_path),
        )
        svc._microcards_analytics_service = False
        svc._complex_statistics_repository = _UnavailableHostedComplexStatisticsRepository()

        with pytest.raises(HostedShadowWriteFallbackDisabledError) as exc_info:
            svc._save_complex_statistics("user1", {"complex_1": {"aggregated": {}, "recent_sessions": []}})

        assert exc_info.value.operation == "statistics._save_complex_statistics"
        assert svc.hosted_shadow_fallback_active is True
        assert svc.hosted_shadow_write_fallback_blocked is True

    def test_hosted_read_blocks_shadow_when_postgres_unavailable(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
        monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)

        svc = StatisticsService(
            _make_progress_service(),
            data_dir=str(tmp_path),
            persistence_settings=_build_hosted_settings(tmp_path),
        )
        svc._microcards_analytics_service = False
        svc._complex_statistics_repository = _UnavailableHostedComplexStatisticsRepository()

        user_dir = tmp_path / "users" / "user1"
        user_dir.mkdir(parents=True)
        (user_dir / "complex_statistics.json").write_text(
            json.dumps({"complex_shadow": {"aggregated": {}, "recent_sessions": []}}, ensure_ascii=False),
            encoding="utf-8",
        )

        with pytest.raises(HostedShadowReadFallbackDisabledError) as exc_info:
            svc._load_complex_statistics("user1")

        assert exc_info.value.operation == "statistics._load_complex_statistics"
        assert svc.hosted_shadow_fallback_active is True
        assert svc.hosted_shadow_read_fallback_blocked is True

    def test_hosted_load_returns_empty_when_repository_is_empty(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")

        svc = StatisticsService(
            _make_progress_service(),
            data_dir=str(tmp_path),
            persistence_settings=_build_hosted_settings(tmp_path),
        )
        svc._microcards_analytics_service = False
        fake_repo = _FakeHostedComplexStatisticsRepository()
        svc._complex_statistics_repository = fake_repo

        user_dir = tmp_path / "users" / "user1"
        user_dir.mkdir(parents=True)
        shadow_payload = {"complex_shadow": {"aggregated": {"attempts": 2}, "recent_sessions": []}}
        (user_dir / "complex_statistics.json").write_text(
            json.dumps(shadow_payload, ensure_ascii=False),
            encoding="utf-8",
        )

        loaded = svc._load_complex_statistics("user1")

        assert loaded == {}
        assert fake_repo.get_statistics("user1") is None


# ═══════════════════════════════════════════════════════════════════
# update_complex_stats
# ═══════════════════════════════════════════════════════════════════


class TestUpdateComplexStats:
    def _make_recent_summary(self, session_id="s1"):
        return RecentSessionSummary(
            session_id=session_id,
            end_time=datetime.now(),
            duration_seconds=120,
            success_rate=0.8,
            total_tasks=10,
            mastered_tasks=8,
            failed_tasks=2,
            total_iterations=1,
        )

    def test_first_update(self, tmp_path):
        svc = _make_svc(tmp_path)
        summary = self._make_recent_summary()
        assert svc.update_complex_stats(summary, "user1", complex_id="c1") is True
        stats = svc._load_complex_statistics("user1")
        assert stats["c1"]["aggregated"]["attempts"] == 10
        assert stats["c1"]["aggregated"]["wins"] == 8  # int(0.8 * 10)
        assert len(stats["c1"]["recent_sessions"]) == 1

    def test_multiple_updates_aggregate(self, tmp_path):
        svc = _make_svc(tmp_path)
        svc.update_complex_stats(self._make_recent_summary("s1"), "user1", complex_id="c1")
        svc.update_complex_stats(self._make_recent_summary("s2"), "user1", complex_id="c1")
        stats = svc._load_complex_statistics("user1")
        assert stats["c1"]["aggregated"]["attempts"] == 20
        assert len(stats["c1"]["recent_sessions"]) == 2

    def test_recent_sessions_capped_at_20(self, tmp_path):
        svc = _make_svc(tmp_path)
        for i in range(25):
            svc.update_complex_stats(self._make_recent_summary(f"s{i}"), "user1", complex_id="c1")
        stats = svc._load_complex_statistics("user1")
        assert len(stats["c1"]["recent_sessions"]) == 20

    def test_no_complex_id_for_recent_summary(self, tmp_path):
        svc = _make_svc(tmp_path)
        summary = self._make_recent_summary()
        assert svc.update_complex_stats(summary, "user1", complex_id=None) is False

    def test_extended_summary(self, tmp_path):
        svc = _make_svc(tmp_path)
        ext = ExtendedSessionResultSummary(
            session_id="es1",
            complex_id="c1",
            user_id="user1",
            start_time=datetime.now() - timedelta(minutes=5),
            end_time=datetime.now(),
            total_tasks=10,
            successful_tasks_count=7,
            tasks_mastered_count=6,
            tasks_failed_count=3,
            total_iterations=2,
            difficulty_progression=[1.0, 1.5],
        )
        assert svc.update_complex_stats(ext, "user1") is True
        stats = svc._load_complex_statistics("user1")
        assert stats["c1"]["aggregated"]["wins"] == 7

    def test_hosted_update_raises_when_shadow_read_is_blocked(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
        monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)

        svc = StatisticsService(
            _make_progress_service(),
            data_dir=str(tmp_path),
            persistence_settings=_build_hosted_settings(tmp_path),
        )
        svc._microcards_analytics_service = False
        svc._complex_statistics_repository = _UnavailableHostedComplexStatisticsRepository()

        with pytest.raises(HostedShadowReadFallbackDisabledError) as exc_info:
            svc.update_complex_stats(self._make_recent_summary(), "user1", complex_id="c1")

        assert exc_info.value.operation == "statistics._load_complex_statistics"


# ═══════════════════════════════════════════════════════════════════
# get_recent_sessions
# ═══════════════════════════════════════════════════════════════════


class TestGetRecentSessions:
    def test_empty(self, tmp_path):
        svc = _make_svc(tmp_path)
        assert svc.get_recent_sessions("user1") == []

    def test_from_multiple_complexes(self, tmp_path):
        svc = _make_svc(tmp_path)
        now = datetime.now()
        data = {
            "c1": {
                "aggregated": {},
                "recent_sessions": [
                    {"session_id": "s1", "end_time": (now - timedelta(hours=2)).isoformat(), "total_tasks": 5},
                ],
            },
            "c2": {
                "aggregated": {},
                "recent_sessions": [
                    {"session_id": "s2", "end_time": now.isoformat(), "total_tasks": 3},
                ],
            },
        }
        svc._save_complex_statistics("user1", data)
        sessions = svc.get_recent_sessions("user1", limit=10)
        assert len(sessions) == 2
        # Most recent first
        assert sessions[0]["session_id"] == "s2"
        # complex_id injected
        assert sessions[0]["complex_id"] == "c2"

    def test_limit(self, tmp_path):
        svc = _make_svc(tmp_path)
        now = datetime.now()
        sessions_list = [
            {"session_id": f"s{i}", "end_time": (now - timedelta(hours=i)).isoformat()}
            for i in range(5)
        ]
        data = {"c1": {"aggregated": {}, "recent_sessions": sessions_list}}
        svc._save_complex_statistics("user1", data)
        assert len(svc.get_recent_sessions("user1", limit=3)) == 3


# ═══════════════════════════════════════════════════════════════════
# _extended_to_recent_summary
# ═══════════════════════════════════════════════════════════════════


class TestExtendedToRecentSummary:
    def test_conversion(self, tmp_path):
        svc = _make_svc(tmp_path)
        start = datetime(2024, 1, 1, 10, 0, 0)
        end = datetime(2024, 1, 1, 10, 5, 0)
        ext = ExtendedSessionResultSummary(
            session_id="es1",
            complex_id="c1",
            user_id="test_user",
            start_time=start,
            end_time=end,
            total_tasks=10,
            successful_tasks_count=7,
            tasks_mastered_count=6,
            tasks_failed_count=3,
            total_iterations=2,
            difficulty_progression=[1.0],
        )
        recent = svc._extended_to_recent_summary(ext)
        assert recent.session_id == "es1"
        assert recent.duration_seconds == 300
        assert recent.success_rate == 0.7
        assert recent.total_tasks == 10
        assert recent.mastered_tasks == 6
        assert recent.failed_tasks == 3

    def test_zero_tasks(self, tmp_path):
        svc = _make_svc(tmp_path)
        now = datetime.now()
        ext = ExtendedSessionResultSummary(
            session_id="es1",
            complex_id="c1",
            user_id="test_user",
            start_time=now,
            end_time=now,
            total_tasks=0,
            successful_tasks_count=0,
            tasks_mastered_count=0,
            tasks_failed_count=0,
            total_iterations=0,
            difficulty_progression=[],
        )
        recent = svc._extended_to_recent_summary(ext)
        assert recent.duration_seconds == 0
        assert recent.success_rate == 0.0


# ═══════════════════════════════════════════════════════════════════
# Cache management
# ═══════════════════════════════════════════════════════════════════


class TestCacheManagement:
    def test_clear_cache_all(self, tmp_path):
        svc = _make_svc(tmp_path)
        svc._cache["stats_user1_None"] = ({"data": 1}, time.time())
        svc._time_dynamics_cache[("user1", 30, 3)] = ([{"d": 1}], time.time())
        svc.clear_cache()
        assert len(svc._cache) == 0
        assert len(svc._time_dynamics_cache) == 0

    def test_clear_cache_user(self, tmp_path):
        svc = _make_svc(tmp_path)
        svc._cache["stats_user1_None"] = ({"data": 1}, time.time())
        svc._cache["stats_user2_None"] = ({"data": 2}, time.time())
        svc._time_dynamics_cache[("user1", 30, 3)] = ([], time.time())
        svc.clear_cache("user1")
        assert "stats_user1_None" not in svc._cache
        assert "stats_user2_None" in svc._cache
        assert ("user1", 30, 3) not in svc._time_dynamics_cache

    def test_on_progress_updated(self, tmp_path):
        svc = _make_svc(tmp_path)
        svc._cache["stats_user1_None"] = ({}, time.time())
        svc._cache["stats_user1_7"] = ({}, time.time())
        svc._cache["stats_other_None"] = ({}, time.time())
        svc._time_dynamics_cache[("user1", 30, 3)] = ([], time.time())
        svc._on_progress_updated("user1")
        assert "stats_user1_None" not in svc._cache
        assert "stats_user1_7" not in svc._cache
        assert "stats_other_None" in svc._cache
        assert ("user1", 30, 3) not in svc._time_dynamics_cache

    def test_set_module_repository_clears_cache(self, tmp_path):
        svc = _make_svc(tmp_path)
        svc._cache["stats_user1_None"] = ({}, time.time())
        svc.set_module_repository(MagicMock())
        assert len(svc._cache) == 0


# ═══════════════════════════════════════════════════════════════════
# Streak computation
# ═══════════════════════════════════════════════════════════════════


class TestStreakComputation:
    def test_no_activity(self, tmp_path):
        svc = _make_svc(tmp_path)
        result = svc._compute_activity_streak_metrics("user1")
        assert result == {"activity_streak_days": 0, "activity_streak_best": 0}

    def test_consecutive_days(self, tmp_path):
        svc = _make_svc(tmp_path)
        today = date.today()
        activity = {}
        for i in range(5):
            d = today - timedelta(days=i)
            activity[d.isoformat()] = {"activity_attempts_total": 3}
        # Write activity file
        cal_dir = tmp_path / "user_calendar" / "user1"
        cal_dir.mkdir(parents=True)
        (cal_dir / "activity.json").write_text(json.dumps(activity), encoding="utf-8")
        result = svc._compute_activity_streak_metrics("user1")
        assert result["activity_streak_days"] == 5
        assert result["activity_streak_best"] == 5

    def test_streak_with_gap(self, tmp_path):
        svc = _make_svc(tmp_path)
        today = date.today()
        activity = {
            today.isoformat(): {"activity_attempts_total": 1},
            (today - timedelta(days=1)).isoformat(): {"activity_attempts_total": 1},
            # gap of 1 day
            (today - timedelta(days=3)).isoformat(): {"activity_attempts_total": 1},
            (today - timedelta(days=4)).isoformat(): {"activity_attempts_total": 1},
            (today - timedelta(days=5)).isoformat(): {"activity_attempts_total": 1},
        }
        cal_dir = tmp_path / "user_calendar" / "user1"
        cal_dir.mkdir(parents=True)
        (cal_dir / "activity.json").write_text(json.dumps(activity), encoding="utf-8")
        result = svc._compute_activity_streak_metrics("user1")
        assert result["activity_streak_days"] == 2  # today + yesterday
        assert result["activity_streak_best"] == 3  # 3-day run earlier

    def test_old_streak_broken(self, tmp_path):
        svc = _make_svc(tmp_path)
        today = date.today()
        # Activity only 5 days ago
        activity = {
            (today - timedelta(days=5)).isoformat(): {"activity_attempts_total": 1},
        }
        cal_dir = tmp_path / "user_calendar" / "user1"
        cal_dir.mkdir(parents=True)
        (cal_dir / "activity.json").write_text(json.dumps(activity), encoding="utf-8")
        result = svc._compute_activity_streak_metrics("user1")
        assert result["activity_streak_days"] == 0  # too old
        assert result["activity_streak_best"] == 1


# ═══════════════════════════════════════════════════════════════════
# aggregate_statistics with mock
# ═══════════════════════════════════════════════════════════════════


class TestAggregateStatistics:
    def test_empty_history(self, tmp_path):
        svc = _make_svc(tmp_path)
        result = svc.aggregate_statistics("test_user")
        assert result["total_tasks_attempted"] == 0
        assert result["success_rate"] == 0.0
        assert result["tasks_mastered"] == 0

    def test_with_attempts(self, tmp_path):
        now = datetime.now().isoformat()
        history = {
            "mod/topic/task1": {
                "attempts": [
                    {"success": True, "time_spent": 60, "timestamp": now},
                    {"success": False, "time_spent": 30, "timestamp": now},
                ]
            },
            "mod/topic/task2": {
                "attempts": [
                    {"success": True, "time_spent": 45, "timestamp": now, "score": 85.0},
                ]
            },
        }
        svc = _make_svc(tmp_path, task_history=history)
        result = svc.aggregate_statistics("test_user")
        assert result["total_tasks_attempted"] == 3
        assert result["total_tasks_completed"] == 2
        assert result["tasks_mastered"] == 2
        assert result["total_time_spent"] == 135
        assert result["success_rate"] == pytest.approx(2 / 3, abs=0.01)

    def test_caching(self, tmp_path):
        svc = _make_svc(tmp_path)
        r1 = svc.aggregate_statistics("test_user")
        r2 = svc.aggregate_statistics("test_user")
        assert r1 is r2  # same object from cache

    def test_force_refresh(self, tmp_path):
        svc = _make_svc(tmp_path)
        r1 = svc.aggregate_statistics("test_user")
        r2 = svc.aggregate_statistics("test_user", force_refresh=True)
        assert r1 is not r2

    def test_learning_sources_present(self, tmp_path):
        svc = _make_svc(tmp_path)
        result = svc.aggregate_statistics("test_user")
        assert "learning_sources" in result
        assert "tasks" in result["learning_sources"]
        assert "microcards" in result["learning_sources"]
        assert "combined" in result["learning_sources"]

    def test_hosted_overall_stats_raise_degraded_when_progress_storage_is_unavailable(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")

        progress_service = _make_progress_service()
        progress_service.progress_manager.hosted_storage_ready = False
        progress_service.progress_manager.ensure_hosted_persistence_ready.side_effect = PostgresUnavailableError(
            "postgres_dsn_missing"
        )

        svc = StatisticsService(
            progress_service,
            data_dir=str(tmp_path),
            persistence_settings=_build_hosted_settings(tmp_path),
        )
        svc._microcards_analytics_service = False

        with pytest.raises(HostedShadowReadFallbackDisabledError) as exc_info:
            svc.aggregate_statistics("test_user")

        assert exc_info.value.operation == "statistics._load_progress_data"


class TestHostedTimeDynamics:
    def test_hosted_time_dynamics_use_calendar_repository_source_of_truth(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
        today_iso = date.today().isoformat()
        task_history = {
            "mod/topic/task1": {
                "attempts": [
                    {"success": True, "time_spent": 120, "timestamp": f"{today_iso}T10:00:00"},
                ]
            }
        }
        progress_service = _make_progress_service(user_id="test_user", task_history=task_history)
        progress_service.progress_manager.hosted_storage_ready = True

        svc = StatisticsService(
            progress_service,
            data_dir=str(tmp_path),
            persistence_settings=_build_hosted_settings(tmp_path),
        )
        svc._microcards_analytics_service = False
        fake_calendar_repo = _FakeHostedCalendarRepository()
        fake_calendar_repo.payloads[("test_user", "activity")] = {
            today_iso: {
                "microcards_reviews": 5,
                "microcards_correct": 4,
                "microcards_seconds_spent": 300,
            }
        }
        svc._calendar_repository = fake_calendar_repo

        shadow_dir = tmp_path / "user_calendar" / "test_user"
        shadow_dir.mkdir(parents=True)
        (shadow_dir / "activity.json").write_text(
            json.dumps(
                {
                    today_iso: {
                        "microcards_reviews": 99,
                        "microcards_correct": 99,
                        "microcards_seconds_spent": 999,
                    }
                }
            ),
            encoding="utf-8",
        )

        result = svc.get_time_dynamics("test_user", days=1, force_refresh=True)

        assert result[-1]["date"] == today_iso
        assert result[-1]["microcards_reviews"] == 5
        assert result[-1]["microcards_study_minutes"] == 5

    def test_hosted_time_dynamics_raise_degraded_when_calendar_storage_is_unavailable(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
        today_iso = date.today().isoformat()
        task_history = {
            "mod/topic/task1": {
                "attempts": [
                    {"success": True, "time_spent": 60, "timestamp": f"{today_iso}T09:00:00"},
                ]
            }
        }
        progress_service = _make_progress_service(user_id="test_user", task_history=task_history)
        progress_service.progress_manager.hosted_storage_ready = True

        svc = StatisticsService(
            progress_service,
            data_dir=str(tmp_path),
            persistence_settings=_build_hosted_settings(tmp_path),
        )
        svc._microcards_analytics_service = False
        svc._calendar_repository = _UnavailableHostedCalendarRepository()

        shadow_dir = tmp_path / "user_calendar" / "test_user"
        shadow_dir.mkdir(parents=True)
        (shadow_dir / "activity.json").write_text(
            json.dumps({today_iso: {"microcards_reviews": 42}}),
            encoding="utf-8",
        )

        with pytest.raises(HostedShadowReadFallbackDisabledError) as exc_info:
            svc.get_time_dynamics("test_user", days=1, force_refresh=True)

        assert exc_info.value.operation == "statistics._load_calendar_activity"


# ═══════════════════════════════════════════════════════════════════
# get_weak_areas
# ═══════════════════════════════════════════════════════════════════


class TestGetWeakAreas:
    def test_no_history(self, tmp_path):
        svc = _make_svc(tmp_path)
        assert svc.get_weak_areas("test_user") == []

    def test_weak_area_detected(self, tmp_path):
        history = {
            "mod/weak_topic/task1": {
                "attempts": [
                    {"success": False},
                    {"success": False},
                    {"success": True},
                ]
            },
        }
        svc = _make_svc(tmp_path, task_history=history)
        areas = svc.get_weak_areas("test_user", threshold=0.5)
        assert len(areas) == 1
        assert areas[0]["topic"] == "weak_topic"
        assert areas[0]["success_rate"] == pytest.approx(1 / 3, abs=0.01)

    def test_strong_area_excluded(self, tmp_path):
        history = {
            "mod/strong_topic/task1": {
                "attempts": [
                    {"success": True},
                    {"success": True},
                ]
            },
        }
        svc = _make_svc(tmp_path, task_history=history)
        areas = svc.get_weak_areas("test_user", threshold=0.7)
        assert len(areas) == 0

    def test_sorted_by_rate(self, tmp_path):
        history = {
            "mod/topic_a/task1": {
                "attempts": [{"success": False}, {"success": False}, {"success": True}]  # 0.333
            },
            "mod/topic_b/task1": {
                "attempts": [{"success": True}, {"success": False}]  # 0.5
            },
        }
        svc = _make_svc(tmp_path, task_history=history)
        areas = svc.get_weak_areas("test_user", threshold=0.7)
        assert len(areas) == 2
        assert areas[0]["success_rate"] < areas[1]["success_rate"]


# ═══════════════════════════════════════════════════════════════════
# _read_json_file
# ═══════════════════════════════════════════════════════════════════


class TestReadJsonFile:
    def test_existing_file(self, tmp_path):
        svc = _make_svc(tmp_path)
        f = tmp_path / "test.json"
        f.write_text('{"a": 1}', encoding="utf-8")
        assert svc._read_json_file(f, {}) == {"a": 1}

    def test_missing_file(self, tmp_path):
        svc = _make_svc(tmp_path)
        assert svc._read_json_file(tmp_path / "nope.json", []) == []

    def test_corrupt_file(self, tmp_path):
        svc = _make_svc(tmp_path)
        f = tmp_path / "bad.json"
        f.write_text("{bad", encoding="utf-8")
        assert svc._read_json_file(f, "default") == "default"
