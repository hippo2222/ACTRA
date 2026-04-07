"""
Unit tests for ComplexSessionController — T14 coverage plan.

Covers:
- Init and default state
- start_session success/failure
- _handle_session_completion
- get_current_session_stats
- save_ui_state / restore_ui_state / clear_ui_state
- _serialize_evaluation_result
- _get_session_iteration
- next_task with skip logic
- _handle_complex_completion
"""

import sys
import os
import pytest
from unittest.mock import MagicMock, patch, PropertyMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from logic.complex_session_controller import ComplexSessionController


# ─── Mock factories ───────────────────────────────────────────────


def _mock_session(sid="sess1", iteration=1, queue_len=3, current_idx=0, is_active=True,
                  complex_id="complex1", user_id="user1"):
    session = MagicMock()
    session.id = sid
    session.iteration = iteration
    session.current_task_index = current_idx
    session.is_active = is_active
    session.complex_id = complex_id
    session.user_id = user_id
    session.ui_state = None
    session.completed_tasks = []

    queue = []
    for i in range(queue_len):
        qt = MagicMock()
        qt.task_ref = f"mod/topic/task{i}"
        qt.difficulty = 1
        qt.is_retry = False
        queue.append(qt)
    session.queue = queue
    return session


def _make_ctrl():
    sm = MagicMock()
    tc = MagicMock()
    tc.current_difficulty_level = 1
    tc.is_task_loaded.return_value = True
    ss = MagicMock()
    cs = MagicMock()
    ctrl = ComplexSessionController(sm, tc, ss, cs)
    return ctrl


# ═══════════════════════════════════════════════════════════════════
# Init
# ═══════════════════════════════════════════════════════════════════


class TestInit:
    def test_defaults(self):
        ctrl = _make_ctrl()
        assert ctrl.current_session_id is None
        assert ctrl.current_task_ref is None
        assert ctrl._current_task_iteration is None
        assert ctrl._last_shown_iteration is None
        assert ctrl.on_task_changed is None
        assert ctrl.on_session_completed is None


# ═══════════════════════════════════════════════════════════════════
# start_session
# ═══════════════════════════════════════════════════════════════════


class TestStartSession:
    def test_success(self):
        ctrl = _make_ctrl()
        session = _mock_session()
        ctrl.session_manager.start_session.return_value = session
        ctrl.session_manager.get_session.return_value = session
        ctrl.session_manager.get_next_task.return_value = {
            "task_ref": "mod/topic/task0", "difficulty": 1
        }
        ctrl.storage_service.load_task.return_value = {
            "task_data": {"type": "click"}, "answer_key": {}
        }

        result = ctrl.start_session("complex1", "user1")
        assert result is True
        assert ctrl.current_session_id == "sess1"

    def test_failure(self):
        ctrl = _make_ctrl()
        ctrl.session_manager.start_session.side_effect = RuntimeError("fail")
        error_called = []
        ctrl.on_error = lambda msg: error_called.append(msg)

        result = ctrl.start_session("complex1", "user1")
        assert result is False
        assert len(error_called) == 1


# ═══════════════════════════════════════════════════════════════════
# _handle_session_completion
# ═══════════════════════════════════════════════════════════════════


class TestHandleSessionCompletion:
    def test_clears_state(self):
        ctrl = _make_ctrl()
        session = _mock_session()
        ctrl.current_session_id = "sess1"
        ctrl.current_task_ref = "mod/topic/task0"
        ctrl.session_manager.get_session.return_value = session

        completed = []
        ctrl.on_session_completed = lambda s: completed.append(s)

        ctrl._handle_session_completion()
        assert ctrl.current_session_id is None
        assert ctrl.current_task_ref is None
        ctrl.task_controller.clear_task.assert_called_once()
        assert len(completed) == 1

    def test_no_callback(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        ctrl.session_manager.get_session.return_value = _mock_session()
        ctrl.on_session_completed = None
        ctrl._handle_session_completion()  # should not raise


# ═══════════════════════════════════════════════════════════════════
# get_current_session_stats
# ═══════════════════════════════════════════════════════════════════


class TestGetSessionStats:
    def test_no_session(self):
        ctrl = _make_ctrl()
        assert ctrl.get_current_session_stats() == {}

    def test_session_not_found(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        ctrl.session_manager.get_session.return_value = None
        assert ctrl.get_current_session_stats() == {}

    def test_with_session(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        session = _mock_session(queue_len=5, current_idx=2)
        ctrl.session_manager.get_session.return_value = session

        stats = ctrl.get_current_session_stats()
        assert stats["current_iter"] == 1
        assert stats["total_in_queue"] == 5
        assert stats["task_number_in_iteration"] == 2
        assert "progress" in stats

    def test_index_zero(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        session = _mock_session(queue_len=3, current_idx=0)
        ctrl.session_manager.get_session.return_value = session

        stats = ctrl.get_current_session_stats()
        assert stats["task_number_in_iteration"] == 1

    def test_empty_queue(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        session = _mock_session(queue_len=0)
        ctrl.session_manager.get_session.return_value = session

        stats = ctrl.get_current_session_stats()
        assert stats["task_number_in_iteration"] == 0


# ═══════════════════════════════════════════════════════════════════
# save_ui_state / restore_ui_state / clear_ui_state
# ═══════════════════════════════════════════════════════════════════


class TestUIState:
    def test_save_no_session(self):
        ctrl = _make_ctrl()
        assert ctrl.save_ui_state("task") is False

    def test_save_and_restore(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        ctrl.current_task_ref = "mod/topic/t1"
        session = _mock_session()
        ctrl.session_manager.get_session.return_value = session

        result = ctrl.save_ui_state("task", task_ref="mod/topic/t1")
        assert result is True
        assert session.ui_state is not None
        assert session.ui_state["screen_type"] == "task"

    def test_restore_no_session(self):
        ctrl = _make_ctrl()
        assert ctrl.restore_ui_state() is None

    def test_restore_with_state(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        session = _mock_session()
        session.ui_state = {"screen_type": "task", "task_ref": "mod/topic/t1"}
        ctrl.session_manager.get_session.return_value = session

        state = ctrl.restore_ui_state()
        assert state["screen_type"] == "task"

    def test_restore_no_ui_state(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        session = _mock_session()
        session.ui_state = None
        ctrl.session_manager.get_session.return_value = session
        assert ctrl.restore_ui_state() is None

    def test_clear_no_session(self):
        ctrl = _make_ctrl()
        assert ctrl.clear_ui_state() is False

    def test_clear_success(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        session = _mock_session()
        session.ui_state = {"screen_type": "task"}
        ctrl.session_manager.get_session.return_value = session

        result = ctrl.clear_ui_state()
        assert result is True
        assert session.ui_state is None

    def test_save_iteration_results(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        session = _mock_session()
        ctrl.session_manager.get_session.return_value = session

        result = ctrl.save_ui_state("iteration_results", iteration_number=2)
        assert result is True
        assert session.ui_state["screen_type"] == "iteration_results"
        assert session.ui_state["iteration_number"] == 2

    def test_save_iteration_results_missing_number(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        session = _mock_session()
        ctrl.session_manager.get_session.return_value = session

        result = ctrl.save_ui_state("iteration_results")
        assert result is False

    def test_save_task_no_ref(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        ctrl.current_task_ref = None
        session = _mock_session()
        ctrl.session_manager.get_session.return_value = session

        result = ctrl.save_ui_state("task")
        assert result is False

    def test_save_debounce_skip_duplicate(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        ctrl.current_task_ref = "mod/topic/t1"
        session = _mock_session()
        ctrl.session_manager.get_session.return_value = session

        ctrl.save_ui_state("task", task_ref="mod/topic/t1")
        # Second call with same state should still return True
        result = ctrl.save_ui_state("task", task_ref="mod/topic/t1")
        assert result is True

    def test_save_task_with_explicit_index_does_not_advance_progress_by_default(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        ctrl.current_task_ref = "mod/topic/task0"
        session = _mock_session(queue_len=3, current_idx=0)
        ctrl.session_manager.get_session.return_value = session

        result = ctrl.save_ui_state("task", task_ref="mod/topic/task0", task_index=0)

        assert result is True
        assert session.ui_state["task_index"] == 0
        assert session.current_task_index == 0

    def test_save_task_with_explicit_index_can_advance_progress_when_requested(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        ctrl.current_task_ref = "mod/topic/task0"
        session = _mock_session(queue_len=3, current_idx=0)
        ctrl.session_manager.get_session.return_value = session

        result = ctrl.save_ui_state(
            "task",
            task_ref="mod/topic/task0",
            task_index=0,
            sync_progress=True,
        )

        assert result is True
        assert session.ui_state["task_index"] == 0
        assert session.current_task_index == 1

    def test_save_task_persists_view_state(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        ctrl.current_task_ref = "mod/topic/task0"
        session = _mock_session(queue_len=2, current_idx=0)
        ctrl.session_manager.get_session.return_value = session

        result = ctrl.save_ui_state(
            "task",
            task_ref="mod/topic/task0",
            task_index=0,
            view_state={"zoom": 1.5, "panX": 10, "panY": 20},
        )

        assert result is True
        assert session.ui_state["view_state"] == {
            "zoom": 1.5,
            "panX": 10,
            "panY": 20,
        }


# ═══════════════════════════════════════════════════════════════════
# _serialize_evaluation_result
# ═══════════════════════════════════════════════════════════════════


class TestSerializeEvalResult:
    def test_dict_passthrough(self):
        ctrl = _make_ctrl()
        d = {"success": True, "message": "ok"}
        assert ctrl._serialize_evaluation_result(d) == d

    def test_object(self):
        ctrl = _make_ctrl()
        obj = MagicMock()
        obj.success = True
        obj.message = "ok"
        obj.details = {"score": 100}
        result = ctrl._serialize_evaluation_result(obj)
        assert result["success"] is True
        assert result["message"] == "ok"
        assert result["details"]["score"] == 100

    def test_no_attrs(self):
        ctrl = _make_ctrl()
        result = ctrl._serialize_evaluation_result(object())
        assert isinstance(result, dict)


# ═══════════════════════════════════════════════════════════════════
# _get_session_iteration
# ═══════════════════════════════════════════════════════════════════


class TestGetSessionIteration:
    def test_none(self):
        ctrl = _make_ctrl()
        assert ctrl._get_session_iteration(None) is None

    def test_iteration_attr(self):
        ctrl = _make_ctrl()
        session = MagicMock()
        session.iteration = 3
        assert ctrl._get_session_iteration(session) == 3

    def test_fallback(self):
        ctrl = _make_ctrl()
        session = MagicMock(spec=[])
        session.current_iteration = 5
        assert ctrl._get_session_iteration(session) == 5


# ═══════════════════════════════════════════════════════════════════
# next_task
# ═══════════════════════════════════════════════════════════════════


class TestNextTask:
    def test_calls_load_next(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = None
        with patch.object(ctrl, "_load_next_task") as mock_load:
            ctrl.next_task()
            mock_load.assert_called_once()

    def test_skip_unanswered_task(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        ctrl.current_task_ref = "mod/topic/task0"
        session = _mock_session()
        session.completed_tasks = []  # no results
        ctrl.session_manager.get_session.return_value = session
        ctrl.session_manager.skip_task.return_value = {"ok": True}

        with patch.object(ctrl, "_load_next_task"):
            ctrl.next_task()
            ctrl.session_manager.skip_task.assert_called_once_with("sess1", "mod/topic/task0")

    def test_retry_copy_requires_its_own_submission(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        ctrl.current_task_ref = "mod/topic/task0"
        ctrl._current_queue_index = 2
        ctrl._current_task_iteration = 1

        session = _mock_session(queue_len=3, current_idx=3)
        session.queue[2].task_ref = "mod/topic/task0"
        session.queue[2].is_retry = True
        session.completed_tasks = [
            MagicMock(task_ref="mod/topic/task0", iteration_index=1),
        ]
        ctrl.session_manager.get_session.return_value = session
        ctrl.session_manager.skip_task.return_value = {
            "ok": False,
            "reason": "retry_cannot_be_skipped",
        }

        errors = []
        ctrl.on_error = lambda msg: errors.append(msg)

        with patch.object(ctrl, "_load_next_task") as mock_load:
            ctrl.next_task()

        ctrl.session_manager.skip_task.assert_called_once_with("sess1", "mod/topic/task0")
        mock_load.assert_not_called()
        assert errors
        assert "retry_cannot_be_skipped" in errors[0]

    def test_persists_iteration_results_state_before_callback(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        session = _mock_session(iteration=1, queue_len=2, current_idx=2)
        ctrl.session_manager.get_session.return_value = session
        ctrl.complex_service.get_complex.return_value = MagicMock()

        def _generate_next_iteration(current_session, _complex_obj):
            current_session.iteration = 2

        ctrl.session_manager._generate_next_iteration.side_effect = _generate_next_iteration

        summary = MagicMock()
        summary.iteration = 1
        summary.total_tasks = 2
        summary.successful_tasks = 2
        summary.failed_tasks = 0
        summary.success_rate = 1.0
        ctrl.session_manager.get_iteration_summary.return_value = summary

        completed = []
        ctrl.on_iteration_completed = lambda payload: completed.append(payload)

        with patch.object(ctrl, "clear_ui_state") as mock_clear:
            ctrl._load_next_task()

        assert session.ui_state["screen_type"] == "iteration_results"
        assert session.ui_state["iteration_number"] == 1
        mock_clear.assert_not_called()
        assert completed == [summary]


# ═══════════════════════════════════════════════════════════════════
# _handle_complex_completion
# ═══════════════════════════════════════════════════════════════════


class TestHandleComplexCompletion:
    def test_calls_callback(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        session = _mock_session()
        session._final_summary = {"total": 10}
        ctrl.session_manager.get_session.return_value = session

        completed = []
        ctrl.on_complex_completed = lambda s: completed.append(s)
        ctrl._handle_complex_completion()
        assert len(completed) == 1
        assert completed[0]["total"] == 10

    def test_no_session_falls_back(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        ctrl.session_manager.get_session.return_value = None

        with patch.object(ctrl, "_handle_session_completion") as mock_handle:
            ctrl._handle_complex_completion()
            mock_handle.assert_called_once()

    def test_no_callback_falls_back(self):
        ctrl = _make_ctrl()
        ctrl.current_session_id = "sess1"
        session = _mock_session()
        ctrl.session_manager.get_session.return_value = session
        ctrl.on_complex_completed = None

        with patch.object(ctrl, "_handle_session_completion") as mock_handle:
            ctrl._handle_complex_completion()
            mock_handle.assert_called_once()
