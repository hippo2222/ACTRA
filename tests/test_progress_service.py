"""
Unit tests for ProgressService — T20 coverage plan.

Covers:
- Init and switch_user
- save_evaluation_result (normal, guest, details extraction)
- save_detailed_attempt (normal, guest, invalid difficulty)
- save_task_result (normal, guest, kwargs)
- get_task_history, get_task_progress
- get_overall_statistics (v3.0, v2.0, error)
- is_task_completed, get_attempts_count
- reset_task_progress, remove_last_attempt
- export_progress, get_progress_summary
- get_mistake_bank (v3.0)
- get_mistakes_for_task
"""

import sys
import os
import pytest
from unittest.mock import MagicMock, patch, PropertyMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.progress_service import ProgressService
from services.task_evaluator_service import EvaluationResult


def _make_svc(user_id="user1"):
    with patch("services.progress_service.UserProgressManager") as MockUPM:
        mock_pm = MagicMock()
        MockUPM.return_value = mock_pm
        svc = ProgressService(data_dir="/tmp/test", user_id=user_id)
        svc.progress_manager = mock_pm
    return svc


def _eval_result(success=True, score=100.0, details=None):
    return EvaluationResult(
        success=success,
        score=score,
        message="ok" if success else "fail",
        details=details or {},
    )


# ═══════════════════════════════════════════════════════════════════
# Init / switch_user
# ═══════════════════════════════════════════════════════════════════


class TestInit:
    def test_init(self):
        svc = _make_svc()
        assert svc.user_id == "user1"

    def test_switch_user(self):
        svc = _make_svc()
        svc.switch_user("user2")
        assert svc.user_id == "user2"
        svc.progress_manager.switch_user.assert_called_once_with("user2")


# ═══════════════════════════════════════════════════════════════════
# save_evaluation_result
# ═══════════════════════════════════════════════════════════════════


class TestSaveEvaluationResult:
    def test_basic(self):
        svc = _make_svc()
        svc.progress_manager.save_attempt.return_value = True
        result = _eval_result()
        assert svc.save_evaluation_result("m1", "t1", "tk1", result) is True
        svc.progress_manager.save_attempt.assert_called_once()

    def test_guest_blocked(self):
        svc = _make_svc(user_id="guest")
        result = _eval_result()
        assert svc.save_evaluation_result("m1", "t1", "tk1", result) is False

    def test_extracts_difficulty_from_details(self):
        svc = _make_svc()
        svc.progress_manager.save_attempt.return_value = True
        result = _eval_result(details={"difficulty": 3, "time_spent": 120})
        svc.save_evaluation_result("m1", "t1", "tk1", result)
        call_kwargs = svc.progress_manager.save_attempt.call_args[1]
        assert call_kwargs["difficulty"] == 3
        assert call_kwargs["time_spent"] == 120

    def test_extracts_complex_id_iteration(self):
        svc = _make_svc()
        svc.progress_manager.save_attempt.return_value = True
        result = _eval_result(details={"complex_id": "c1", "iteration": 2})
        svc.save_evaluation_result("m1", "t1", "tk1", result)
        call_kwargs = svc.progress_manager.save_attempt.call_args[1]
        assert call_kwargs["complex_id"] == "c1"
        assert call_kwargs["iteration"] == 2

    def test_exception_returns_false(self):
        svc = _make_svc()
        svc.progress_manager.save_attempt.side_effect = RuntimeError("fail")
        result = _eval_result()
        assert svc.save_evaluation_result("m1", "t1", "tk1", result) is False


# ═══════════════════════════════════════════════════════════════════
# save_detailed_attempt
# ═══════════════════════════════════════════════════════════════════


class TestSaveDetailedAttempt:
    def test_basic(self):
        svc = _make_svc()
        svc.progress_manager.save_attempt.return_value = True
        assert svc.save_detailed_attempt("m1", "t1", "tk1", difficulty=2, success=True) is True

    def test_guest_blocked(self):
        svc = _make_svc(user_id="guest")
        assert svc.save_detailed_attempt("m1", "t1", "tk1", difficulty=1, success=True) is False

    def test_invalid_difficulty(self):
        svc = _make_svc()
        assert svc.save_detailed_attempt("m1", "t1", "tk1", difficulty=0, success=True) is False
        assert svc.save_detailed_attempt("m1", "t1", "tk1", difficulty=4, success=True) is False


# ═══════════════════════════════════════════════════════════════════
# save_task_result
# ═══════════════════════════════════════════════════════════════════


class TestSaveTaskResult:
    def test_basic(self):
        svc = _make_svc()
        svc.progress_manager.save_attempt.return_value = True
        assert svc.save_task_result("m1", "t1", "tk1", success=True) is True

    def test_guest_blocked(self):
        svc = _make_svc(user_id="guest")
        assert svc.save_task_result("m1", "t1", "tk1", success=True) is False

    def test_with_kwargs(self):
        svc = _make_svc()
        svc.progress_manager.save_attempt.return_value = True
        svc.save_task_result("m1", "t1", "tk1", success=True, complex_id="c1", iteration=3)
        call_kwargs = svc.progress_manager.save_attempt.call_args[1]
        assert call_kwargs["complex_id"] == "c1"
        assert call_kwargs["iteration"] == 3


# ═══════════════════════════════════════════════════════════════════
# get_task_history / get_task_progress
# ═══════════════════════════════════════════════════════════════════


class TestGetProgress:
    def test_get_task_history(self):
        svc = _make_svc()
        svc.progress_manager.get_task_history.return_value = {"attempts": []}
        result = svc.get_task_history("m1", "t1", "tk1")
        assert result == {"attempts": []}

    def test_get_task_history_error(self):
        svc = _make_svc()
        svc.progress_manager.get_task_history.side_effect = RuntimeError("fail")
        assert svc.get_task_history("m1", "t1", "tk1") is None

    def test_get_task_progress_v3(self):
        svc = _make_svc()
        svc.progress_manager.get_task_history.return_value = {
            "attempts": [{"success": True}],
            "meta": {"total_attempts": 1, "success_rate": 1.0},
            "current_difficulty": 2,
            "mastery_level": "intermediate",
        }
        result = svc.get_task_progress("m1", "t1", "tk1")
        assert result["completed"] is True
        assert result["attempts_count"] == 1
        assert result["current_difficulty"] == 2

    def test_get_task_progress_v2(self):
        svc = _make_svc()
        svc.progress_manager.get_task_history.return_value = {
            "attempts": [{"success": True}],
            "current_difficulty": 1,
        }
        result = svc.get_task_progress("m1", "t1", "tk1")
        assert result["completed"] is True

    def test_get_task_progress_none(self):
        svc = _make_svc()
        svc.progress_manager.get_task_history.return_value = None
        assert svc.get_task_progress("m1", "t1", "tk1") is None


# ═══════════════════════════════════════════════════════════════════
# get_overall_statistics
# ═══════════════════════════════════════════════════════════════════


class TestOverallStatistics:
    def test_v3(self):
        svc = _make_svc()
        svc.progress_manager.get_progress_data.return_value = {
            "version": "3.0",
            "global_stats": {"total_attempts": 10, "total_time_seconds": 600},
            "task_history": {
                "m1/t1/tk1": {"meta": {"success_rate": 0.8}, "attempts": []},
                "m1/t1/tk2": {"meta": {"success_rate": 0.0}, "attempts": []},
            },
        }
        result = svc.get_overall_statistics()
        assert result["total_tasks_completed"] == 1
        assert result["total_attempts"] == 10
        assert result["total_time_spent"] == 600

    def test_v2(self):
        svc = _make_svc()
        svc.progress_manager.get_progress_data.return_value = {
            "version": "2.0",
            "task_history": {
                "m1/t1/tk1": {"attempts": [
                    {"success": True, "time_spent": 30},
                    {"success": False, "time_spent": 20},
                ]},
            },
        }
        result = svc.get_overall_statistics()
        assert result["total_tasks_completed"] == 1
        assert result["total_attempts"] == 2
        assert result["total_time_spent"] == 50

    def test_error(self):
        svc = _make_svc()
        svc.progress_manager.get_progress_data.side_effect = RuntimeError("fail")
        result = svc.get_overall_statistics()
        assert result["total_tasks_completed"] == 0


# ═══════════════════════════════════════════════════════════════════
# Utilities
# ═══════════════════════════════════════════════════════════════════


class TestUtilities:
    def test_is_task_completed_true(self):
        svc = _make_svc()
        svc.progress_manager.get_task_history.return_value = {
            "attempts": [{"success": True}],
            "meta": {"success_rate": 1.0, "total_attempts": 1},
        }
        assert svc.is_task_completed("m1", "t1", "tk1") is True

    def test_is_task_completed_false(self):
        svc = _make_svc()
        svc.progress_manager.get_task_history.return_value = None
        assert svc.is_task_completed("m1", "t1", "tk1") is False

    def test_get_attempts_count(self):
        svc = _make_svc()
        svc.progress_manager.get_all_attempts.return_value = [1, 2, 3]
        assert svc.get_attempts_count("m1", "t1", "tk1") == 3

    def test_reset_task_progress(self):
        svc = _make_svc()
        svc.progress_manager.reset_task_history.return_value = True
        assert svc.reset_task_progress("m1", "t1", "tk1") is True

    def test_reset_task_progress_error(self):
        svc = _make_svc()
        svc.progress_manager.reset_task_history.side_effect = RuntimeError("fail")
        assert svc.reset_task_progress("m1", "t1", "tk1") is False

    def test_remove_last_attempt(self):
        svc = _make_svc()
        svc.progress_manager.remove_last_attempt.return_value = True
        assert svc.remove_last_attempt("m1", "t1", "tk1") is True

    def test_remove_last_attempt_error(self):
        svc = _make_svc()
        svc.progress_manager.remove_last_attempt.side_effect = RuntimeError("fail")
        assert svc.remove_last_attempt("m1", "t1", "tk1") is False

    def test_export_progress(self):
        svc = _make_svc()
        svc.progress_manager.get_progress_data.return_value = {"version": "3.0"}
        assert svc.export_progress() == {"version": "3.0"}

    def test_get_progress_summary(self):
        svc = _make_svc()
        svc.progress_manager.get_progress_data.return_value = {
            "version": "2.0", "task_history": {}
        }
        summary = svc.get_progress_summary()
        assert "Progress Summary" in summary


# ═══════════════════════════════════════════════════════════════════
# get_mistake_bank
# ═══════════════════════════════════════════════════════════════════


class TestMistakeBank:
    def test_v3_with_failures(self):
        svc = _make_svc()
        svc.progress_manager.get_progress_data.return_value = {
            "version": "3.0",
            "mistake_bank": [],
            "task_history": {
                "m1/t1/tk1": {
                    "attempts": [
                        {"success": False, "timestamp": "2024-01-01", "difficulty": 1},
                        {"success": False, "timestamp": "2024-01-02", "difficulty": 2},
                    ]
                },
                "m1/t1/tk2": {
                    "attempts": [
                        {"success": True, "timestamp": "2024-01-01"},
                    ]
                },
            },
        }
        result = svc.get_mistake_bank()
        assert len(result) == 1
        assert result[0]["task"] == "tk1"
        assert result[0]["fail_count"] == 2

    def test_v2_empty(self):
        svc = _make_svc()
        svc.progress_manager.get_progress_data.return_value = {
            "version": "2.0", "mistake_bank": [], "task_history": {}
        }
        assert svc.get_mistake_bank() == []

    def test_get_mistakes_for_task(self):
        svc = _make_svc()
        svc.progress_manager.get_mistakes_for_task.return_value = [{"error": "test"}]
        result = svc.get_mistakes_for_task("m1", "t1", "tk1")
        assert len(result) == 1
