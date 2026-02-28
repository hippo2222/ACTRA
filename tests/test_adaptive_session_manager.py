"""
Unit tests for AdaptiveSessionManager — T5 coverage plan.

Covers:
- Static helpers: _split_task_ref, _is_error_detection_metadata
- _get_task_phase logic
- _group_tasks_into_chunks
- _accumulate_pause_time
- Session lifecycle: start, pause, resume, cancel, get, end
- skip_task rules
- get_next_task basics
- submit_result basics
"""

import sys
import os
import pytest
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch, PropertyMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.adaptive_session_manager import AdaptiveSessionManager
from task_system.core.models.complex_models import (
    Complex,
    ComplexSession,
    ComplexSettings,
    SessionTaskResult,
    QueuedTask,
)


# ─── Mock factories ───────────────────────────────────────────────


def _mock_complex(complex_id="c1", tasks=None, chains=None, name="Test"):
    c = MagicMock(spec=Complex)
    c.id = complex_id
    c.name = name
    c.tasks = tasks or []
    c.chains = chains or []
    settings = MagicMock(spec=ComplexSettings)
    settings.adaptive_difficulty = True
    settings.escalation_on_success = True
    c.settings = settings
    return c


def _mock_deps():
    cs = MagicMock()
    upm = MagicMock()
    dm = MagicMock()
    dm.get_available_levels.return_value = [1, 2, 3]
    dm.get_smart_retry_config.return_value = {
        "near_offset": 2,
        "near_jitter_max": 0,
        "max_copies": 5,
        "training_control_enabled": True,
    }
    ss = MagicMock()
    sr = MagicMock()
    return cs, upm, dm, ss, sr


def _make_mgr(complex_obj=None, task_file_exists=True):
    cs, upm, dm, ss, sr = _mock_deps()
    if complex_obj:
        cs.get_complex.return_value = complex_obj
    mgr = AdaptiveSessionManager(cs, upm, dm, ss, sr)
    # Patch _check_task_file_exists to avoid FS dependency
    mgr._check_task_file_exists = MagicMock(return_value=task_file_exists)
    # Default _get_task_type returns "click"
    mgr._get_task_type = MagicMock(return_value="click")
    return mgr


def _make_session(session_id="s1", complex_id="c1", user_id="u1", tasks_in_queue=None):
    session = ComplexSession(
        id=session_id,
        complex_id=complex_id,
        user_id=user_id,
        start_time=datetime.utcnow(),
        version=1,
        iteration=1,
    )
    if tasks_in_queue:
        session.queue = [
            QueuedTask(task_ref=t, difficulty=1, is_retry=False) for t in tasks_in_queue
        ]
    return session


# ═══════════════════════════════════════════════════════════════════
# Static helpers
# ═══════════════════════════════════════════════════════════════════


class TestSplitTaskRef:
    def test_valid(self):
        assert AdaptiveSessionManager._split_task_ref("mod/topic/task") == ("mod", "topic", "task")

    def test_empty(self):
        assert AdaptiveSessionManager._split_task_ref("") == (None, None, None)

    def test_too_few_parts(self):
        assert AdaptiveSessionManager._split_task_ref("mod/topic") == (None, None, None)

    def test_extra_parts(self):
        m, t, tk = AdaptiveSessionManager._split_task_ref("mod/topic/sub/task")
        assert m == "mod"
        assert t == "topic"
        assert tk == "task"


class TestIsErrorDetection:
    def test_subtype(self):
        assert AdaptiveSessionManager._is_error_detection_metadata({"subtype": "error_detection"}) is True

    def test_mode_text_errors(self):
        assert AdaptiveSessionManager._is_error_detection_metadata({"mode": "text_errors"}) is True

    def test_mode_text_choice(self):
        assert AdaptiveSessionManager._is_error_detection_metadata({"mode": "text_choice"}) is True

    def test_normal_task(self):
        assert AdaptiveSessionManager._is_error_detection_metadata({"subtype": "click"}) is False

    def test_none(self):
        assert AdaptiveSessionManager._is_error_detection_metadata(None) is False

    def test_not_dict(self):
        assert AdaptiveSessionManager._is_error_detection_metadata("bad") is False


# ═══════════════════════════════════════════════════════════════════
# _get_task_phase
# ═══════════════════════════════════════════════════════════════════


class TestGetTaskPhase:
    def setup_method(self):
        self.mgr = _make_mgr()
        # Use the real _get_task_phase but mock _load_task_metadata
        self.mgr._get_task_phase = AdaptiveSessionManager._get_task_phase.__get__(self.mgr)
        self.mgr._load_task_metadata = MagicMock(return_value={})

    def test_click_level1_warmup(self):
        assert self.mgr._get_task_phase("click", 1) == 0

    def test_click_level2_main(self):
        assert self.mgr._get_task_phase("click", 2) == 1

    def test_click_level3_main(self):
        assert self.mgr._get_task_phase("click", 3) == 1

    def test_draw_level1_main(self):
        assert self.mgr._get_task_phase("draw", 1) == 1

    def test_open_answer_finisher(self):
        assert self.mgr._get_task_phase("open_answer", 1) == 2

    def test_sequence_level1_warmup(self):
        assert self.mgr._get_task_phase("sequence_assembly", 1) == 0

    def test_sequence_level3_finisher(self):
        assert self.mgr._get_task_phase("sequence_assembly", 3) == 2

    def test_test_level1_warmup(self):
        assert self.mgr._get_task_phase("test", 1) == 0

    def test_test_level2_main(self):
        assert self.mgr._get_task_phase("test", 2) == 1

    def test_unknown_default(self):
        assert self.mgr._get_task_phase("unknown_type", 5) == 1


# ═══════════════════════════════════════════════════════════════════
# _group_tasks_into_chunks
# ═══════════════════════════════════════════════════════════════════


class TestGroupTasksIntoChunks:
    def setup_method(self):
        self.mgr = _make_mgr()
        self.mgr._group_tasks_into_chunks = AdaptiveSessionManager._group_tasks_into_chunks.__get__(self.mgr)

    def test_no_chains(self):
        tasks = [QueuedTask(task_ref=f"t{i}", difficulty=1) for i in range(3)]
        chunks = self.mgr._group_tasks_into_chunks(tasks, [])
        assert len(chunks) == 3
        assert all(len(c) == 1 for c in chunks)

    def test_with_chain(self):
        tasks = [
            QueuedTask(task_ref="a", difficulty=1),
            QueuedTask(task_ref="b", difficulty=1),
            QueuedTask(task_ref="c", difficulty=1),
        ]
        chains = [["a", "b"]]
        chunks = self.mgr._group_tasks_into_chunks(tasks, chains)
        # a and b should be in one chunk, c alone
        chain_chunk = [c for c in chunks if len(c) == 2]
        assert len(chain_chunk) == 1
        refs = [t.task_ref for t in chain_chunk[0]]
        assert refs == ["a", "b"]

    def test_empty_tasks(self):
        assert self.mgr._group_tasks_into_chunks([], []) == []


# ═══════════════════════════════════════════════════════════════════
# _accumulate_pause_time
# ═══════════════════════════════════════════════════════════════════


class TestAccumulatePauseTime:
    def test_no_pause(self):
        session = _make_session()
        session.paused_at = None
        AdaptiveSessionManager._accumulate_pause_time(session)
        assert (session.total_pause_seconds or 0) == 0

    def test_with_pause(self):
        session = _make_session()
        session.paused_at = datetime.utcnow() - timedelta(seconds=10)
        session.total_pause_seconds = 5.0
        session.iteration_timestamps = {1: {"start": datetime.utcnow() - timedelta(minutes=5), "end": None}}
        AdaptiveSessionManager._accumulate_pause_time(session)
        assert session.total_pause_seconds >= 14.0  # ~5 + ~10


# ═══════════════════════════════════════════════════════════════════
# Session lifecycle
# ═══════════════════════════════════════════════════════════════════


class TestSessionLifecycle:
    def test_start_session(self):
        comp = _mock_complex(tasks=["mod/topic/task1"])
        mgr = _make_mgr(complex_obj=comp)
        session = mgr.start_session("c1", "u1")
        assert session.complex_id == "c1"
        assert session.user_id == "u1"
        assert session.is_active is True
        assert session.id in mgr._active_sessions

    def test_start_session_complex_not_found(self):
        mgr = _make_mgr()
        mgr.complex_service.get_complex.return_value = None
        with pytest.raises(ValueError, match="Complex not found"):
            mgr.start_session("bad_id", "u1")

    def test_get_session(self):
        mgr = _make_mgr()
        session = _make_session()
        mgr._active_sessions["s1"] = session
        assert mgr.get_session("s1") is session
        assert mgr.get_session("nonexistent") is None

    def test_restore_session(self):
        mgr = _make_mgr()
        session = _make_session()
        mgr.restore_session(session)
        assert mgr.get_session("s1") is session

    def test_pause_session(self):
        mgr = _make_mgr()
        session = _make_session()
        mgr._active_sessions["s1"] = session
        mgr.pause_session("s1")
        assert session.paused is True
        assert session.paused_at is not None

    def test_pause_session_not_found(self):
        mgr = _make_mgr()
        mgr.pause_session("nonexistent")  # should not raise

    def test_resume_session_in_memory(self):
        mgr = _make_mgr()
        session = _make_session()
        session.paused = True
        session.paused_at = datetime.utcnow() - timedelta(seconds=5)
        session.total_pause_seconds = 0
        session.iteration_timestamps = {1: {"start": datetime.utcnow(), "end": None}}
        mgr._active_sessions["s1"] = session
        result = mgr.resume_session("s1", "u1")
        assert result is session
        assert session.paused is False

    def test_resume_session_from_repo(self):
        mgr = _make_mgr()
        session = _make_session()
        session.paused = True
        session.paused_at = datetime.utcnow()
        session.total_pause_seconds = 0
        session.iteration_timestamps = {1: {"start": datetime.utcnow(), "end": None}}
        mgr.session_repository.load_session_by_session_id.return_value = session
        result = mgr.resume_session("s1", "u1")
        assert result is session
        assert "s1" in mgr._active_sessions

    def test_resume_session_not_found(self):
        mgr = _make_mgr()
        mgr.session_repository.load_session_by_session_id.return_value = None
        assert mgr.resume_session("s1", "u1") is None

    def test_cancel_session(self):
        mgr = _make_mgr()
        session = _make_session()
        mgr._active_sessions["s1"] = session
        assert mgr.cancel_session("s1") is True
        assert "s1" not in mgr._active_sessions
        assert session.is_active is False

    def test_cancel_session_not_found(self):
        mgr = _make_mgr()
        mgr.session_repository.load_session_by_session_id.side_effect = Exception("fail")
        assert mgr.cancel_session("bad", user_id="u1") is False

    def test_end_session(self):
        mgr = _make_mgr()
        session = _make_session()
        session.completed_tasks = [
            SessionTaskResult(task_ref="mod/topic/t1", success=True, time_spent=30, difficulty=1, iteration_index=1),
        ]
        mgr._active_sessions["s1"] = session
        # Mock _generate_session_summary
        mgr._generate_session_summary = MagicMock(return_value=MagicMock())
        summary = mgr.end_session("s1")
        assert summary is not None
        assert session.is_active is False
        assert session.end_time is not None

    def test_end_session_not_found(self):
        mgr = _make_mgr()
        assert mgr.end_session("bad") is None


# ═══════════════════════════════════════════════════════════════════
# skip_task
# ═══════════════════════════════════════════════════════════════════


class TestSkipTask:
    def _setup_session_with_queue(self, mgr, task_refs):
        session = _make_session(tasks_in_queue=task_refs)
        session.current_task_index = 1  # simulate get_next_task already called once
        session.skip_counts = {}
        mgr._active_sessions["s1"] = session
        return session

    def test_skip_moves_to_end(self):
        mgr = _make_mgr()
        session = self._setup_session_with_queue(mgr, ["t1", "t2", "t3"])
        result = mgr.skip_task("s1", "t1")
        assert result["ok"] is True
        assert session.queue[-1].task_ref == "t1"

    def test_skip_retry_forbidden(self):
        mgr = _make_mgr()
        session = _make_session()
        session.queue = [
            QueuedTask(task_ref="t1", difficulty=1, is_retry=True),
            QueuedTask(task_ref="t2", difficulty=1),
        ]
        session.current_task_index = 1
        session.skip_counts = {}
        mgr._active_sessions["s1"] = session
        result = mgr.skip_task("s1", "t1")
        assert result["ok"] is False
        assert result["reason"] == "retry_cannot_be_skipped"

    def test_skip_last_task_forbidden(self):
        mgr = _make_mgr()
        session = _make_session(tasks_in_queue=["t1"])
        session.current_task_index = 1
        session.skip_counts = {}
        mgr._active_sessions["s1"] = session
        result = mgr.skip_task("s1", "t1")
        assert result["ok"] is False
        assert result["reason"] == "last_task_cannot_be_skipped"

    def test_skip_limit_reached(self):
        mgr = _make_mgr()
        session = self._setup_session_with_queue(mgr, ["t1", "t2", "t3"])
        session.skip_counts = {"t1": 2}
        result = mgr.skip_task("s1", "t1")
        assert result["ok"] is False
        assert result["reason"] == "skip_limit_reached"

    def test_skip_session_not_found(self):
        mgr = _make_mgr()
        result = mgr.skip_task("bad_session", "t1")
        assert result["ok"] is False


# ═══════════════════════════════════════════════════════════════════
# get_next_task
# ═══════════════════════════════════════════════════════════════════


class TestGetNextTask:
    def test_returns_next(self):
        mgr = _make_mgr()
        session = _make_session(tasks_in_queue=["mod/topic/t1", "mod/topic/t2"])
        session.current_task_index = 0
        mgr._active_sessions["s1"] = session
        result = mgr.get_next_task("s1")
        assert result is not None
        assert result["task_ref"] == "mod/topic/t1"
        assert result["index"] == 0

    def test_session_not_found(self):
        mgr = _make_mgr()
        assert mgr.get_next_task("bad") is None

    def test_inactive_session(self):
        mgr = _make_mgr()
        session = _make_session(tasks_in_queue=["t1"])
        session.is_active = False
        mgr._active_sessions["s1"] = session
        assert mgr.get_next_task("s1") is None

    def test_broken_task_skipped(self):
        mgr = _make_mgr()
        # First task file doesn't exist, second does
        mgr._check_task_file_exists = MagicMock(side_effect=[False, True])
        session = _make_session(tasks_in_queue=["broken/t/t1", "mod/t/t2"])
        session.current_task_index = 0
        mgr._active_sessions["s1"] = session
        result = mgr.get_next_task("s1")
        assert result is not None
        assert result["task_ref"] == "mod/t/t2"
        assert "broken/t/t1" in session.broken_tasks


# ═══════════════════════════════════════════════════════════════════
# submit_result
# ═══════════════════════════════════════════════════════════════════


class TestSubmitResult:
    def test_success(self):
        mgr = _make_mgr()
        session = _make_session(tasks_in_queue=["mod/topic/t1"])
        session.current_task_index = 1
        mgr._active_sessions["s1"] = session
        result = mgr.submit_result("s1", {
            "task_ref": "mod/topic/t1",
            "success": True,
            "time_spent": 30,
            "difficulty": 1,
        })
        assert result.success is True
        assert result.task_ref == "mod/topic/t1"
        assert len(session.completed_tasks) == 1

    def test_failure_adds_retry(self):
        mgr = _make_mgr()
        session = _make_session(tasks_in_queue=["mod/topic/t1", "mod/topic/t2"])
        session.current_task_index = 1
        mgr._active_sessions["s1"] = session
        # Restore real _add_failed_task_to_current_queue
        mgr._add_failed_task_to_current_queue = AdaptiveSessionManager._add_failed_task_to_current_queue.__get__(mgr)
        mgr._get_task_phase = MagicMock(return_value=1)
        mgr.complex_service.get_complex.return_value = _mock_complex()
        result = mgr.submit_result("s1", {
            "task_ref": "mod/topic/t1",
            "success": False,
            "time_spent": 10,
            "difficulty": 1,
        })
        assert result.success is False
        # Retry copies should have been added
        retry_count = sum(1 for t in session.queue if t.is_retry and t.task_ref == "mod/topic/t1")
        assert retry_count >= 1

    def test_inactive_session(self):
        mgr = _make_mgr()
        session = _make_session()
        session.is_active = False
        mgr._active_sessions["s1"] = session
        with pytest.raises(ValueError, match="Session not found"):
            mgr.submit_result("s1", {"task_ref": "t1", "success": True})

    def test_iteration_mismatch_uses_expected(self):
        mgr = _make_mgr()
        session = _make_session(tasks_in_queue=["mod/topic/t1"])
        session.iteration = 3
        session.current_task_index = 1
        mgr._active_sessions["s1"] = session
        result = mgr.submit_result("s1", {
            "task_ref": "mod/topic/t1",
            "success": True,
            "time_spent": 10,
            "difficulty": 1,
            "expected_iteration": 2,
        })
        assert result.iteration_index == 2
