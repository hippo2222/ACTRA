"""
Unit tests for TaskController — T27 coverage plan.

Covers:
- Task dataclass (full_id, time_spent)
- TaskState enum
- TaskController init
- load_task (normal, with DifficultyManager, error cases)
- _determine_difficulty_level (explicit, from progress, from DM, fallback)
- submit_answer (normal, no task, evaluation error, progress save error)
- skip_task, reset_task, clear_task
- Getters: get_current_task, get_task_state, is_task_loaded, etc.
- get_task_summary
"""

import sys
import os
import pytest
from unittest.mock import MagicMock, patch, PropertyMock
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from logic.task_controller import TaskController, Task, TaskState
from services.task_evaluator_service import EvaluationResult
from task_system.core.exceptions import TaskLoadError, EvaluationError


def _make_ctrl(with_dm=False, with_sm=False):
    evaluator = MagicMock()
    progress = MagicMock()
    progress.get_task_progress.return_value = None
    dm = MagicMock() if with_dm else None
    sm = MagicMock() if with_sm else None
    if dm:
        dm.get_initial_level.return_value = 1
        dm.enhance_task_for_level.side_effect = lambda td, **kw: td
    ctrl = TaskController(
        evaluator_service=evaluator,
        progress_service=progress,
        session_manager=sm,
        difficulty_manager=dm,
    )
    return ctrl


def _task_data():
    return {"type": "click", "content": {}}


def _answer_key():
    return {"targets": []}


# ═══════════════════════════════════════════════════════════════════
# Task dataclass
# ═══════════════════════════════════════════════════════════════════


class TestTaskDataclass:
    def test_full_id(self):
        t = Task(module_id="m1", topic_id="t1", task_id="tk1",
                 task_type="click", task_data={}, answer_key={})
        assert t.full_id == "m1/t1/tk1"

    def test_time_spent(self):
        t = Task(module_id="m1", topic_id="t1", task_id="tk1",
                 task_type="click", task_data={}, answer_key={})
        assert t.time_spent >= 0


# ═══════════════════════════════════════════════════════════════════
# TaskState
# ═══════════════════════════════════════════════════════════════════


class TestTaskState:
    def test_values(self):
        assert TaskState.NOT_STARTED.value == "not_started"
        assert TaskState.IN_PROGRESS.value == "in_progress"
        assert TaskState.COMPLETED.value == "completed"
        assert TaskState.FAILED.value == "failed"
        assert TaskState.SKIPPED.value == "skipped"


# ═══════════════════════════════════════════════════════════════════
# Init
# ═══════════════════════════════════════════════════════════════════


class TestInit:
    def test_defaults(self):
        ctrl = _make_ctrl()
        assert ctrl.current_task is None
        assert ctrl.task_state == TaskState.NOT_STARTED
        assert ctrl.current_difficulty_level is None


# ═══════════════════════════════════════════════════════════════════
# load_task
# ═══════════════════════════════════════════════════════════════════


class TestLoadTask:
    def test_basic(self):
        ctrl = _make_ctrl()
        task = ctrl.load_task("m1", "t1", "tk1", _task_data(), _answer_key())
        assert task.full_id == "m1/t1/tk1"
        assert task.task_type == "click"
        assert ctrl.task_state == TaskState.IN_PROGRESS

    def test_with_difficulty_manager(self):
        ctrl = _make_ctrl(with_dm=True)
        task = ctrl.load_task("m1", "t1", "tk1", _task_data(), _answer_key())
        assert task is not None
        ctrl.difficulty_manager.enhance_task_for_level.assert_called_once()

    def test_dm_error_fallback(self):
        ctrl = _make_ctrl(with_dm=True)
        ctrl.difficulty_manager.enhance_task_for_level.side_effect = RuntimeError("fail")
        task = ctrl.load_task("m1", "t1", "tk1", _task_data(), _answer_key())
        assert task is not None
        assert ctrl.current_difficulty_level == 1

    def test_type_from_content(self):
        ctrl = _make_ctrl()
        td = {"type": "", "content": {"type": "draw"}}
        task = ctrl.load_task("m1", "t1", "tk1", td, _answer_key())
        assert task.task_type == "draw"

    def test_enhanced_flag(self):
        ctrl = _make_ctrl(with_dm=True)
        td = {"type": "click", "_difficulty_enhanced": True, "_difficulty_level": 2}
        ctrl.difficulty_manager.enhance_task_for_level.side_effect = lambda td, **kw: td
        task = ctrl.load_task("m1", "t1", "tk1", td, _answer_key())
        assert ctrl.current_difficulty_level == 2


# ═══════════════════════════════════════════════════════════════════
# _determine_difficulty_level
# ═══════════════════════════════════════════════════════════════════


class TestDetermineDifficultyLevel:
    def test_explicit(self):
        ctrl = _make_ctrl()
        ctrl._explicit_difficulty_level = 3
        level = ctrl._determine_difficulty_level("m1", "t1", "tk1", _task_data())
        assert level == 3
        assert ctrl._explicit_difficulty_level is None  # reset after use

    def test_from_progress(self):
        ctrl = _make_ctrl()
        ctrl.progress_service.get_task_progress.return_value = {"current_difficulty": 2}
        level = ctrl._determine_difficulty_level("m1", "t1", "tk1", _task_data())
        assert level == 2

    def test_from_dm(self):
        ctrl = _make_ctrl(with_dm=True)
        ctrl.difficulty_manager.get_initial_level.return_value = 1
        level = ctrl._determine_difficulty_level("m1", "t1", "tk1", _task_data())
        assert level == 1

    def test_fallback_settings(self):
        ctrl = _make_ctrl()
        td = {"type": "click", "settings": {"difficulty": 2}}
        level = ctrl._determine_difficulty_level("m1", "t1", "tk1", td)
        assert level == 2

    def test_fallback_default(self):
        ctrl = _make_ctrl()
        level = ctrl._determine_difficulty_level("m1", "t1", "tk1", _task_data())
        assert level == 1


# ═══════════════════════════════════════════════════════════════════
# submit_answer
# ═══════════════════════════════════════════════════════════════════


class TestSubmitAnswer:
    def test_no_task_raises(self):
        ctrl = _make_ctrl()
        with pytest.raises(RuntimeError, match="No task loaded"):
            ctrl.submit_answer({"x": 1})

    def test_success(self):
        ctrl = _make_ctrl()
        ctrl.load_task("m1", "t1", "tk1", _task_data(), _answer_key())
        ctrl.evaluator_service.evaluate_task.return_value = EvaluationResult(
            success=True, score=100.0, message="ok", details={}
        )
        result = ctrl.submit_answer({"x": 1})
        assert result.success is True
        assert ctrl.task_state == TaskState.COMPLETED

    def test_failure(self):
        ctrl = _make_ctrl()
        ctrl.load_task("m1", "t1", "tk1", _task_data(), _answer_key())
        ctrl.evaluator_service.evaluate_task.return_value = EvaluationResult(
            success=False, score=0.0, message="fail", details={}
        )
        result = ctrl.submit_answer({"x": 1})
        assert result.success is False
        assert ctrl.task_state == TaskState.FAILED

    def test_saves_progress(self):
        ctrl = _make_ctrl()
        ctrl.load_task("m1", "t1", "tk1", _task_data(), _answer_key())
        ctrl.evaluator_service.evaluate_task.return_value = EvaluationResult(
            success=True, score=100.0, message="ok", details={}
        )
        ctrl.submit_answer({"x": 1})
        ctrl.progress_service.save_evaluation_result.assert_called_once()

    def test_progress_save_error_no_crash(self):
        ctrl = _make_ctrl()
        ctrl.load_task("m1", "t1", "tk1", _task_data(), _answer_key())
        ctrl.evaluator_service.evaluate_task.return_value = EvaluationResult(
            success=True, score=100.0, message="ok", details={}
        )
        ctrl.progress_service.save_evaluation_result.side_effect = RuntimeError("fail")
        result = ctrl.submit_answer({"x": 1})
        assert result.success is True  # still returns result

    def test_records_session(self):
        ctrl = _make_ctrl(with_sm=True)
        ctrl.load_task("m1", "t1", "tk1", _task_data(), _answer_key())
        ctrl.evaluator_service.evaluate_task.return_value = EvaluationResult(
            success=True, score=100.0, message="ok", details={}
        )
        ctrl.submit_answer({"x": 1})
        ctrl.session_manager.record_task_result.assert_called_once()

    def test_adds_difficulty_to_details(self):
        ctrl = _make_ctrl()
        ctrl.load_task("m1", "t1", "tk1", _task_data(), _answer_key())
        ctrl.evaluator_service.evaluate_task.return_value = EvaluationResult(
            success=True, score=100.0, message="ok", details=None
        )
        result = ctrl.submit_answer({"x": 1})
        assert "difficulty" in result.details
        assert "time_spent" in result.details
        assert "task_type" in result.details


# ═══════════════════════════════════════════════════════════════════
# skip / reset / clear
# ═══════════════════════════════════════════════════════════════════


class TestStateManagement:
    def test_skip_no_task(self):
        ctrl = _make_ctrl()
        with pytest.raises(RuntimeError):
            ctrl.skip_task()

    def test_skip(self):
        ctrl = _make_ctrl()
        ctrl.load_task("m1", "t1", "tk1", _task_data(), _answer_key())
        assert ctrl.skip_task() is True
        assert ctrl.task_state == TaskState.SKIPPED

    def test_reset_no_task(self):
        ctrl = _make_ctrl()
        with pytest.raises(RuntimeError):
            ctrl.reset_task()

    def test_reset(self):
        ctrl = _make_ctrl()
        ctrl.load_task("m1", "t1", "tk1", _task_data(), _answer_key())
        assert ctrl.reset_task() is True
        assert ctrl.task_state == TaskState.IN_PROGRESS
        ctrl.progress_service.reset_task_progress.assert_called_once()

    def test_reset_progress_error_no_crash(self):
        ctrl = _make_ctrl()
        ctrl.load_task("m1", "t1", "tk1", _task_data(), _answer_key())
        ctrl.progress_service.reset_task_progress.side_effect = RuntimeError("fail")
        assert ctrl.reset_task() is True

    def test_clear(self):
        ctrl = _make_ctrl()
        ctrl.load_task("m1", "t1", "tk1", _task_data(), _answer_key())
        ctrl.clear_task()
        assert ctrl.current_task is None
        assert ctrl.task_state == TaskState.NOT_STARTED


# ═══════════════════════════════════════════════════════════════════
# Getters
# ═══════════════════════════════════════════════════════════════════


class TestGetters:
    def test_get_current_task(self):
        ctrl = _make_ctrl()
        assert ctrl.get_current_task() is None
        ctrl.load_task("m1", "t1", "tk1", _task_data(), _answer_key())
        assert ctrl.get_current_task() is not None

    def test_get_task_state(self):
        ctrl = _make_ctrl()
        assert ctrl.get_task_state() == TaskState.NOT_STARTED

    def test_is_task_loaded(self):
        ctrl = _make_ctrl()
        assert ctrl.is_task_loaded() is False
        ctrl.load_task("m1", "t1", "tk1", _task_data(), _answer_key())
        assert ctrl.is_task_loaded() is True

    def test_is_task_completed(self):
        ctrl = _make_ctrl()
        assert ctrl.is_task_completed() is False

    def test_is_task_in_progress(self):
        ctrl = _make_ctrl()
        assert ctrl.is_task_in_progress() is False
        ctrl.load_task("m1", "t1", "tk1", _task_data(), _answer_key())
        assert ctrl.is_task_in_progress() is True


# ═══════════════════════════════════════════════════════════════════
# get_task_summary
# ═══════════════════════════════════════════════════════════════════


class TestGetTaskSummary:
    def test_no_task(self):
        ctrl = _make_ctrl()
        summary = ctrl.get_task_summary()
        assert summary["loaded"] is False

    def test_with_task(self):
        ctrl = _make_ctrl()
        ctrl.load_task("m1", "t1", "tk1", _task_data(), _answer_key())
        summary = ctrl.get_task_summary()
        assert summary["loaded"] is True
        assert summary["full_id"] == "m1/t1/tk1"
        assert summary["task_id"] == "tk1"
        assert summary["task_type"] == "click"
