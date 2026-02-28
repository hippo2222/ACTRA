"""
Integration tests — real services, real file I/O, NO mocks on core paths.

Covers:
  1. ProgressService → StatisticsService  (save attempts → aggregate → weak areas)
  2. TaskController → TaskEvaluatorService → ProgressService (full eval chain)
  3. UserService → ProgressService  (multi-user data isolation)
  4. EventBus cross-service cache invalidation
  5. CalendarService → StatisticsService streak computation
"""

import sys
import os
import json
import time
import pytest
from pathlib import Path
from datetime import datetime, date, timedelta

# ── path setup ──────────────────────────────────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_PROJECT_ROOT / "desktop-app"))
sys.path.insert(0, str(_PROJECT_ROOT))

from services.progress_service import ProgressService
from services.statistics_service import StatisticsService
from services.task_evaluator_service import TaskEvaluatorService, EvaluationResult
from services.user_service import UserService
from services.event_bus import EventBus
from logic.task_controller import TaskController, TaskState

try:
    from services.calendar.calendar_service import CalendarService
    CALENDAR_AVAILABLE = True
except ImportError:
    CALENDAR_AVAILABLE = False
    CalendarService = None


# ═══════════════════════════════════════════════════════════════════
# Shared fixtures
# ═══════════════════════════════════════════════════════════════════


@pytest.fixture
def data_dir(tmp_path):
    """Isolated data directory for every test."""
    d = tmp_path / "data"
    d.mkdir()
    (d / "users").mkdir()
    return d


@pytest.fixture
def event_bus():
    return EventBus()


@pytest.fixture
def progress_svc(data_dir, event_bus):
    return ProgressService(
        data_dir=str(data_dir),
        user_id="alice",
        event_bus=event_bus,
    )


@pytest.fixture
def stats_svc(progress_svc, data_dir, event_bus):
    svc = StatisticsService(
        progress_service=progress_svc,
        data_dir=str(data_dir),
        event_bus=event_bus,
    )
    # Disable lazy microcards init (not needed for integration tests)
    svc._microcards_analytics_service = False
    return svc


@pytest.fixture
def evaluator():
    return TaskEvaluatorService(config={"evaluators": {}, "ui_components": {}})


@pytest.fixture
def user_svc(data_dir):
    return UserService(data_dir=str(data_dir))


# ═══════════════════════════════════════════════════════════════════
# 1. ProgressService → StatisticsService
# ═══════════════════════════════════════════════════════════════════


class TestProgressToStatistics:
    """Save real attempts via ProgressService, then aggregate with StatisticsService."""

    def test_single_attempt_aggregates(self, progress_svc, stats_svc):
        ok = progress_svc.save_task_result(
            module_id="mod1", topic_id="topic1", task_id="t1",
            success=True, difficulty=1, time_spent=60,
        )
        assert ok is True

        stats = stats_svc.aggregate_statistics("alice", force_refresh=True)
        assert stats["total_tasks_attempted"] == 1
        assert stats["total_tasks_completed"] == 1
        assert stats["success_rate"] == 1.0
        assert stats["total_time_spent"] == 60

    def test_mixed_attempts_rate(self, progress_svc, stats_svc):
        progress_svc.save_task_result("m", "t", "t1", success=True, time_spent=30)
        progress_svc.save_task_result("m", "t", "t2", success=False, time_spent=20)
        progress_svc.save_task_result("m", "t", "t3", success=True, time_spent=40)

        stats = stats_svc.aggregate_statistics("alice", force_refresh=True)
        assert stats["total_tasks_attempted"] == 3
        assert stats["total_tasks_completed"] == 2
        assert abs(stats["success_rate"] - 2 / 3) < 0.01
        assert stats["total_time_spent"] == 90

    def test_weak_areas_detected(self, progress_svc, stats_svc):
        # Topic A: 1 success out of 4 attempts → 25% rate
        for i in range(4):
            progress_svc.save_task_result(
                "mod", "weak_topic", f"task_{i}",
                success=(i == 0), time_spent=10,
            )
        # Topic B: all success → 100% rate
        for i in range(3):
            progress_svc.save_task_result(
                "mod", "strong_topic", f"task_{i}",
                success=True, time_spent=10,
            )

        weak = stats_svc.get_weak_areas("alice", threshold=0.5)
        topics = [w["topic"] for w in weak]
        assert "weak_topic" in topics
        assert "strong_topic" not in topics

    def test_multiple_attempts_same_task(self, progress_svc, stats_svc):
        # First attempt: fail. Second: success.
        progress_svc.save_task_result("m", "t", "t1", success=False, time_spent=20)
        progress_svc.save_task_result("m", "t", "t1", success=True, time_spent=30)

        stats = stats_svc.aggregate_statistics("alice", force_refresh=True)
        assert stats["total_tasks_attempted"] == 2
        assert stats["tasks_mastered"] == 1  # at least one success for task

    def test_progress_persists_to_disk(self, data_dir, event_bus):
        # Create, save, then re-open from scratch
        ps1 = ProgressService(str(data_dir), user_id="alice", event_bus=event_bus)
        ps1.save_task_result("m", "t", "t1", success=True, time_spent=60)

        # New ProgressService instance reading from same dir
        ps2 = ProgressService(str(data_dir), user_id="alice", event_bus=event_bus)
        data = ps2.progress_manager.get_progress_data()
        assert "m/t/t1" in data["task_history"]
        assert len(data["task_history"]["m/t/t1"]["attempts"]) >= 1


# ═══════════════════════════════════════════════════════════════════
# 2. TaskController → Evaluator → ProgressService (full chain)
# ═══════════════════════════════════════════════════════════════════


class TestFullEvalChain:
    """Load task → evaluate with real evaluator → verify progress saved."""

    def test_test_task_correct_answer(self, evaluator, progress_svc):
        ctrl = TaskController(
            evaluator_service=evaluator,
            progress_service=progress_svc,
        )
        task_data = {
            "type": "test",
            "content": {
                "type": "test",
                "questions": [
                    {
                        "question": "Столица Франции?",
                        "answers": [
                            {"text": "Берлин", "correct": False},
                            {"text": "Париж", "correct": True},
                            {"text": "Мадрид", "correct": False},
                            {"text": "Рим", "correct": False},
                        ],
                    }
                ],
            },
        }
        answer_key = {}

        task = ctrl.load_task("mod", "topic", "test01", task_data, answer_key)
        assert ctrl.task_state == TaskState.IN_PROGRESS

        user_input = {"answers": {"0": 1}}  # index 1 = Париж = correct
        result = ctrl.submit_answer(user_input)
        assert result.success is True
        assert ctrl.task_state == TaskState.COMPLETED

        # Verify progress was actually persisted
        data = progress_svc.progress_manager.get_progress_data()
        assert "mod/topic/test01" in data["task_history"]

    def test_test_task_wrong_answer(self, evaluator, progress_svc):
        ctrl = TaskController(
            evaluator_service=evaluator,
            progress_service=progress_svc,
        )
        task_data = {
            "type": "test",
            "content": {
                "type": "test",
                "questions": [
                    {
                        "question": "2 + 2 = ?",
                        "answers": [
                            {"text": "3", "correct": False},
                            {"text": "4", "correct": True},
                            {"text": "5", "correct": False},
                        ],
                    }
                ],
            },
        }
        task = ctrl.load_task("mod", "topic", "test02", task_data, {})
        result = ctrl.submit_answer({"answers": {"0": 0}})  # index 0 = "3" = wrong
        assert result.success is False
        assert ctrl.task_state == TaskState.FAILED

    def test_open_answer_correct(self, evaluator, progress_svc):
        ctrl = TaskController(
            evaluator_service=evaluator,
            progress_service=progress_svc,
        )
        task_data = {
            "type": "open_answer",
            "content": {
                "type": "open_answer",
                "question": "Назовите орган, фильтрующий кровь",
                "keywords": ["печень"],
            },
        }
        task = ctrl.load_task("mod", "topic", "oa01", task_data, {})
        result = ctrl.submit_answer({"answer": "Печень фильтрует кровь"})
        assert result.success is True

    def test_skip_and_reset(self, evaluator, progress_svc):
        ctrl = TaskController(
            evaluator_service=evaluator,
            progress_service=progress_svc,
        )
        task_data = {"type": "test", "content": {"type": "test", "questions": [
            {"question": "Q?", "answers": [{"text": "A", "correct": True}, {"text": "B", "correct": False}]}
        ]}}
        ctrl.load_task("mod", "t", "skip01", task_data, {})
        assert ctrl.skip_task() is True
        assert ctrl.task_state == TaskState.SKIPPED

        assert ctrl.reset_task() is True
        assert ctrl.task_state == TaskState.IN_PROGRESS

    def test_eval_then_statistics(self, evaluator, progress_svc, stats_svc):
        """Full flow: evaluate tasks via controller, then check stats."""
        ctrl = TaskController(
            evaluator_service=evaluator,
            progress_service=progress_svc,
        )
        # Solve 3 test tasks
        for i in range(3):
            td = {
                "type": "test",
                "content": {"type": "test", "questions": [
                    {"question": f"Q{i}?", "answers": [{"text": "Right", "correct": True}, {"text": "Wrong", "correct": False}]}
                ]},
            }
            ctrl.load_task("mod", "topic", f"task_{i}", td, {})
            ctrl.submit_answer({"answers": {"0": 0}})  # index 0 = Right = correct

        stats = stats_svc.aggregate_statistics("alice", force_refresh=True)
        assert stats["total_tasks_attempted"] == 3
        assert stats["total_tasks_completed"] == 3
        assert stats["success_rate"] == 1.0


# ═══════════════════════════════════════════════════════════════════
# 3. UserService → ProgressService (multi-user isolation)
# ═══════════════════════════════════════════════════════════════════


class TestMultiUserIsolation:
    """Verify that user data does not leak between profiles."""

    def test_create_users_and_isolate_progress(self, data_dir, event_bus, user_svc):
        # Create two users
        alice = user_svc.create_user("Alice")
        bob = user_svc.create_user("Bob")
        assert alice.user_id != bob.user_id

        # Save progress for Alice
        ps = ProgressService(str(data_dir), user_id=alice.user_id, event_bus=event_bus)
        ps.save_task_result("m", "t", "task1", success=True, time_spent=60)

        # Switch to Bob
        ps.switch_user(bob.user_id)
        bob_data = ps.progress_manager.get_progress_data()
        assert bob_data.get("task_history", {}) == {}  # Bob has no progress

        # Switch back to Alice
        ps.switch_user(alice.user_id)
        alice_data = ps.progress_manager.get_progress_data()
        assert "m/t/task1" in alice_data["task_history"]

    def test_statistics_per_user(self, data_dir, event_bus, user_svc):
        alice = user_svc.create_user("Alice")
        bob = user_svc.create_user("Bob")

        ps = ProgressService(str(data_dir), user_id=alice.user_id, event_bus=event_bus)
        ps.save_task_result("m", "t", "t1", success=True, time_spent=30)
        ps.save_task_result("m", "t", "t2", success=True, time_spent=40)

        ps.switch_user(bob.user_id)
        ps.save_task_result("m", "t", "t1", success=False, time_spent=10)

        stats = StatisticsService(ps, data_dir=str(data_dir), event_bus=event_bus)
        stats._microcards_analytics_service = False

        bob_stats = stats.aggregate_statistics(bob.user_id, force_refresh=True)
        assert bob_stats["total_tasks_attempted"] == 1
        assert bob_stats["success_rate"] == 0.0

        alice_stats = stats.aggregate_statistics(alice.user_id, force_refresh=True)
        assert alice_stats["total_tasks_attempted"] == 2
        assert alice_stats["success_rate"] == 1.0

    def test_last_user_id_roundtrip(self, user_svc):
        alice = user_svc.create_user("Alice")
        user_svc.save_last_user_id(alice.user_id)
        assert user_svc.get_last_user_id() == alice.user_id

    def test_guest_not_saved_as_last(self, user_svc):
        user_svc.save_last_user_id("guest")
        assert user_svc.get_last_user_id() == ""


# ═══════════════════════════════════════════════════════════════════
# 4. EventBus cross-service cache invalidation
# ═══════════════════════════════════════════════════════════════════


class TestEventBusCrossService:
    """Verify that progress updates automatically invalidate statistics cache."""

    def test_cache_invalidated_on_progress_event(self, progress_svc, stats_svc, event_bus):
        # Prime the cache
        stats1 = stats_svc.aggregate_statistics("alice")
        assert stats1["total_tasks_attempted"] == 0

        # Save progress (this should trigger 'progress_updated' event)
        progress_svc.save_task_result("m", "t", "t1", success=True, time_spent=30)

        # Publish the event manually (as the real app does)
        event_bus.publish("progress_updated", user_id="alice")

        # Cache should be invalidated; new stats should reflect the change
        stats2 = stats_svc.aggregate_statistics("alice")
        assert stats2["total_tasks_attempted"] == 1

    def test_unrelated_user_cache_not_invalidated(self, progress_svc, stats_svc, event_bus):
        # Save for alice
        progress_svc.save_task_result("m", "t", "t1", success=True, time_spent=30)
        stats_svc.aggregate_statistics("alice", force_refresh=True)

        # Inject cache for bob manually
        stats_svc._cache["stats_bob_None"] = ({"total_tasks_attempted": 999}, time.time())

        # Invalidate alice only
        event_bus.publish("progress_updated", user_id="alice")

        # Bob's cache should still be there
        assert "stats_bob_None" in stats_svc._cache

    def test_multiple_subscribers(self, event_bus):
        received = []
        event_bus.subscribe("test_event", lambda **kw: received.append("a"))
        event_bus.subscribe("test_event", lambda **kw: received.append("b"))
        event_bus.publish("test_event")
        assert received == ["a", "b"]


# ═══════════════════════════════════════════════════════════════════
# 5. CalendarService → StatisticsService (streak computation)
# ═══════════════════════════════════════════════════════════════════


@pytest.mark.skipif(not CALENDAR_AVAILABLE, reason="CalendarService not available")
class TestCalendarStreakIntegration:
    """Verify that calendar activity feeds into statistics streak metrics."""

    def test_activity_streak_from_calendar(self, data_dir, progress_svc, stats_svc):
        # Write calendar activity for alice for the last 3 days
        cal_dir = data_dir / "user_calendar" / "alice"
        cal_dir.mkdir(parents=True, exist_ok=True)
        today = date.today()
        activity = {}
        for i in range(3):
            d = today - timedelta(days=i)
            activity[d.isoformat()] = {"activity_attempts_total": 5}
        (cal_dir / "activity.json").write_text(
            json.dumps(activity, ensure_ascii=False), encoding="utf-8"
        )

        stats = stats_svc.aggregate_statistics("alice", force_refresh=True)
        assert stats["activity_streak_days"] == 3
        assert stats["activity_streak_best"] == 3

    def test_broken_streak(self, data_dir, progress_svc, stats_svc):
        cal_dir = data_dir / "user_calendar" / "alice"
        cal_dir.mkdir(parents=True, exist_ok=True)
        today = date.today()
        # Activity only 5 days ago
        activity = {
            (today - timedelta(days=5)).isoformat(): {"activity_attempts_total": 1},
        }
        (cal_dir / "activity.json").write_text(
            json.dumps(activity, ensure_ascii=False), encoding="utf-8"
        )

        stats = stats_svc.aggregate_statistics("alice", force_refresh=True)
        assert stats["activity_streak_days"] == 0  # streak is broken

    def test_calendar_service_save_and_read(self, data_dir):
        cal = CalendarService(data_dir=str(data_dir), user_id="alice")
        today = date.today()
        result = cal.save_activity(today, 80)
        assert result is True

        history = cal.get_activity_history(days=30)
        assert isinstance(history, dict)
        assert today.isoformat() in history


# ═══════════════════════════════════════════════════════════════════
# 6. End-to-end: Create user → solve tasks → check stats → verify streaks
# ═══════════════════════════════════════════════════════════════════


class TestEndToEnd:
    """Full user journey: create profile → solve tasks → view statistics."""

    def test_full_journey(self, data_dir, event_bus, user_svc):
        # 1. Create user
        user = user_svc.create_user("Тестовый Пользователь")
        assert user.name == "Тестовый Пользователь"

        # 2. Init services for this user
        ps = ProgressService(str(data_dir), user_id=user.user_id, event_bus=event_bus)
        evaluator = TaskEvaluatorService(config={"evaluators": {}, "ui_components": {}})
        ctrl = TaskController(evaluator_service=evaluator, progress_service=ps)
        stats = StatisticsService(ps, data_dir=str(data_dir), event_bus=event_bus)
        stats._microcards_analytics_service = False

        # 3. Solve some test tasks (correct answers)
        for i in range(5):
            td = {
                "type": "test",
                "content": {"type": "test", "questions": [
                    {"question": f"Q{i}?", "answers": [{"text": "Right", "correct": True}, {"text": "Wrong", "correct": False}]}
                ]},
            }
            ctrl.load_task("anatomy", "liver", f"task_{i}", td, {})
            result = ctrl.submit_answer({"answers": {"0": 0}})  # index 0 = Right
            assert result.success is True

        # 4. Fail one task
        td_fail = {
            "type": "test",
            "content": {"type": "test", "questions": [
                {"question": "Hard?", "answers": [{"text": "A", "correct": False}, {"text": "B", "correct": True}]}
            ]},
        }
        ctrl.load_task("anatomy", "liver", "task_hard", td_fail, {})
        fail_result = ctrl.submit_answer({"answers": {"0": 0}})  # index 0 = A = wrong
        assert fail_result.success is False

        # 5. Check statistics
        user_stats = stats.aggregate_statistics(user.user_id, force_refresh=True)
        assert user_stats["total_tasks_attempted"] == 6
        assert user_stats["total_tasks_completed"] == 5
        assert abs(user_stats["success_rate"] - 5 / 6) < 0.01

        # 6. Verify the user profile is persisted
        reloaded = user_svc.get_user(user.user_id)
        assert reloaded is not None
        assert reloaded.name == "Тестовый Пользователь"

        # 7. Verify progress persistence across service restart
        ps2 = ProgressService(str(data_dir), user_id=user.user_id, event_bus=event_bus)
        data = ps2.progress_manager.get_progress_data()
        history = data.get("task_history", {})
        assert len(history) == 6  # 5 correct + 1 failed (different task_ids)

    def test_guest_mode_blocks_saves(self, data_dir, event_bus):
        """Guest user should NOT persist progress."""
        ps = ProgressService(str(data_dir), user_id="guest", event_bus=event_bus)
        ok = ps.save_task_result("m", "t", "t1", success=True, time_spent=60)
        assert ok is False  # guest mode blocks save
