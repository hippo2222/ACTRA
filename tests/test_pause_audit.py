"""
Regression tests for pause/resume mechanism audit fixes.

Covers:
- BUG-1: Docstring accuracy (not testable, verified manually)
- BUG-2: cancel_session fallback to file
- BUG-3: delete_complex cleans up session file (integration-level, tested via repo)
- BUG-4: total_pause_seconds accumulation + duration subtraction
- BUG-5: GET /task returns paused flag without auto-resume
- BUG-6: load_all_sessions single-pass loading
- MISSING-2: cleanup_stale_sessions
- MISSING-3: paused_session_exists guard on start
- MISSING-4: iteration_timestamps adjustment on resume
"""

import json
import time
import pytest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch
from typing import Optional

from task_system.core.models.complex_models import (
    ComplexSession,
    QueuedTask,
    SessionTaskResult,
    COMPLEX_SESSION_VERSION,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_session(
    session_id: str = "sess-1",
    complex_id: str = "c1",
    user_id: str = "user1",
    paused: bool = False,
    paused_at: Optional[datetime] = None,
    total_pause_seconds: float = 0.0,
    iteration: int = 1,
    is_active: bool = True,
) -> ComplexSession:
    session = ComplexSession(
        id=session_id,
        complex_id=complex_id,
        user_id=user_id,
        iteration=iteration,
        version=COMPLEX_SESSION_VERSION,
        is_active=is_active,
        paused=paused,
        paused_at=paused_at,
        total_pause_seconds=total_pause_seconds,
    )
    session.iteration_timestamps = {
        iteration: {"start": datetime.utcnow() - timedelta(minutes=10)}
    }
    return session


def _make_repo(tmp_path):
    """Create a real SessionRepository rooted in tmp_path."""
    from services.session_repository import SessionRepository
    return SessionRepository(data_dir=str(tmp_path))


def _make_manager(tmp_path, tasks=None):
    """Create a minimal AdaptiveSessionManager with a real repo."""
    from services.session_repository import SessionRepository
    from services.adaptive_session_manager import AdaptiveSessionManager

    repo = SessionRepository(data_dir=str(tmp_path))

    complex_service = MagicMock()
    complex_obj = MagicMock()
    complex_obj.tasks = tasks or ["mod/topic/t1"]
    complex_obj.settings = MagicMock()
    complex_obj.settings.adaptive_difficulty = True
    complex_obj.settings.escalation_on_success = True
    complex_service.get_complex.return_value = complex_obj

    difficulty_manager = MagicMock()
    difficulty_manager.get_available_levels.return_value = [1, 2, 3]

    user_progress_manager = MagicMock()

    mgr = AdaptiveSessionManager(
        complex_service=complex_service,
        user_progress_manager=user_progress_manager,
        difficulty_manager=difficulty_manager,
        session_repository=repo,
    )
    return mgr, repo


# ===========================================================================
# BUG-4: total_pause_seconds tracking
# ===========================================================================

class TestBug4TotalPauseSeconds:
    """BUG-4: ComplexSession.total_pause_seconds field exists and is accumulated."""

    def test_field_exists_default_zero(self):
        session = _make_session()
        assert hasattr(session, "total_pause_seconds")
        assert session.total_pause_seconds == 0.0

    def test_accumulate_pause_time_adds_delta(self):
        from services.adaptive_session_manager import AdaptiveSessionManager

        session = _make_session(
            paused=True,
            paused_at=datetime.utcnow() - timedelta(seconds=120),
        )
        AdaptiveSessionManager._accumulate_pause_time(session)
        assert session.total_pause_seconds >= 119  # at least ~120s minus timing jitter

    def test_accumulate_pause_time_noop_when_not_paused(self):
        from services.adaptive_session_manager import AdaptiveSessionManager

        session = _make_session(paused=False, paused_at=None)
        AdaptiveSessionManager._accumulate_pause_time(session)
        assert session.total_pause_seconds == 0.0

    def test_resume_accumulates_pause(self, tmp_path):
        mgr, repo = _make_manager(tmp_path)

        session = _make_session(
            paused=True,
            paused_at=datetime.utcnow() - timedelta(seconds=60),
        )
        mgr._active_sessions[session.id] = session
        repo.save_session(session, session.user_id)

        resumed = mgr.resume_session(session.id, session.user_id)
        assert resumed is not None
        assert resumed.total_pause_seconds >= 59
        assert resumed.paused is False
        assert resumed.paused_at is None

    def test_duration_subtracts_pause(self, tmp_path):
        """_generate_session_summary should produce iteration_durations that
        exclude pause time (since iteration_timestamps.start is shifted by
        _accumulate_pause_time on resume)."""
        mgr, repo = _make_manager(tmp_path)

        # Simulate: iteration started 15 min ago, paused for 5 min,
        # then resumed (which shifted start forward by 5 min).
        iter_start = datetime.utcnow() - timedelta(minutes=10)  # already shifted
        iter_end = datetime.utcnow()

        session = _make_session(total_pause_seconds=300.0)  # 5 min pause
        session.start_time = datetime.utcnow() - timedelta(minutes=15)
        session.end_time = datetime.utcnow()
        session.iteration_timestamps = {
            1: {"start": iter_start, "end": iter_end}
        }
        session.completed_tasks = [
            SessionTaskResult(
                task_ref="mod/topic/t1",
                success=True,
                score=100,
                time_spent=10,
                difficulty=1,
                iteration_index=1,
                details={},
            )
        ]
        mgr._active_sessions[session.id] = session

        summary = mgr._generate_session_summary(session)
        # iteration_durations[0] should be ~10 min (600s), not 15 min
        assert len(summary.iteration_durations) >= 1
        dur = summary.iteration_durations[0]
        assert dur is not None
        assert dur <= 11 * 60  # at most ~11 min (with jitter)
        assert dur >= 9 * 60   # at least ~9 min


# ===========================================================================
# BUG-2: cancel_session fallback to file
# ===========================================================================

class TestBug2CancelFallback:
    """cancel_session should load from file when session not in memory."""

    def test_cancel_from_memory(self, tmp_path):
        mgr, repo = _make_manager(tmp_path)
        session = _make_session()
        mgr._active_sessions[session.id] = session
        repo.save_session(session, session.user_id)

        result = mgr.cancel_session(session.id, user_id=session.user_id)
        assert result is True
        assert session.id not in mgr._active_sessions
        # File should be deleted
        assert repo.load_session(session.complex_id, session.user_id) is None

    def test_cancel_from_file_after_restart(self, tmp_path):
        mgr, repo = _make_manager(tmp_path)
        session = _make_session(paused=True, paused_at=datetime.utcnow())
        # Save to file but do NOT put in _active_sessions (simulates restart)
        repo.save_session(session, session.user_id)
        assert session.id not in mgr._active_sessions

        result = mgr.cancel_session(session.id, user_id=session.user_id)
        assert result is True
        # File should be deleted
        assert repo.load_session(session.complex_id, session.user_id) is None

    def test_cancel_not_found_anywhere(self, tmp_path):
        mgr, repo = _make_manager(tmp_path)
        result = mgr.cancel_session("nonexistent", user_id="user1")
        assert result is False

    def test_cancel_removes_only_requested_session_when_complex_matches(self, tmp_path):
        mgr, repo = _make_manager(tmp_path)
        session_a = _make_session(session_id="sess-a", complex_id="same-complex")
        session_b = _make_session(session_id="sess-b", complex_id="same-complex")
        repo.save_session(session_a, session_a.user_id)
        repo.save_session(session_b, session_b.user_id)

        result = mgr.cancel_session(session_a.id, user_id=session_a.user_id)

        assert result is True
        assert repo.load_session_by_session_id(session_a.user_id, session_a.id) is None
        assert repo.load_session_by_session_id(session_b.user_id, session_b.id) is not None


# ===========================================================================
# BUG-3: delete_complex cleans up session (tested at repo level)
# ===========================================================================

class TestBug3DeleteCleansSession:
    """Deleting a complex should remove corresponding session file."""

    def test_session_file_removed(self, tmp_path):
        repo = _make_repo(tmp_path)
        session = _make_session(complex_id="cplx-to-delete")
        repo.save_session(session, session.user_id)

        # Verify file exists
        loaded = repo.load_session("cplx-to-delete", session.user_id)
        assert loaded is not None

        # Simulate what delete_complex_endpoint now does
        repo.delete_session("cplx-to-delete", session.user_id)
        assert repo.load_session("cplx-to-delete", session.user_id) is None


# ===========================================================================
# BUG-6: load_all_sessions
# ===========================================================================

class TestBug6LoadAllSessions:
    """SessionRepository.load_all_sessions returns full ComplexSession objects."""

    def test_load_all_returns_sessions(self, tmp_path):
        repo = _make_repo(tmp_path)
        s1 = _make_session(session_id="s1", complex_id="c1")
        s2 = _make_session(session_id="s2", complex_id="c2")
        repo.save_session(s1, s1.user_id)
        repo.save_session(s2, s2.user_id)

        sessions = repo.load_all_sessions("user1")
        assert len(sessions) == 2
        ids = {s.id for s in sessions}
        assert "s1" in ids
        assert "s2" in ids

    def test_load_all_empty_dir(self, tmp_path):
        repo = _make_repo(tmp_path)
        sessions = repo.load_all_sessions("user_no_sessions")
        assert sessions == []


# ===========================================================================
# MISSING-2: cleanup_stale_sessions
# ===========================================================================

class TestMissing2StaleCleanup:
    """cleanup_stale_sessions removes paused sessions older than N days."""

    def test_removes_old_paused_session(self, tmp_path):
        repo = _make_repo(tmp_path)
        old_session = _make_session(
            paused=True,
            paused_at=datetime.utcnow() - timedelta(days=45),
        )
        repo.save_session(old_session, old_session.user_id)

        removed = repo.cleanup_stale_sessions("user1", max_pause_days=30)
        assert removed == 1
        assert repo.load_session(old_session.complex_id, old_session.user_id) is None

    def test_keeps_recent_paused_session(self, tmp_path):
        repo = _make_repo(tmp_path)
        recent = _make_session(
            paused=True,
            paused_at=datetime.utcnow() - timedelta(days=5),
        )
        repo.save_session(recent, recent.user_id)

        removed = repo.cleanup_stale_sessions("user1", max_pause_days=30)
        assert removed == 0
        assert repo.load_session(recent.complex_id, recent.user_id) is not None

    def test_keeps_non_paused_session(self, tmp_path):
        repo = _make_repo(tmp_path)
        active = _make_session(paused=False)
        repo.save_session(active, active.user_id)

        removed = repo.cleanup_stale_sessions("user1", max_pause_days=30)
        assert removed == 0


# ===========================================================================
# MISSING-3: paused_session_exists guard
# ===========================================================================

class TestMissing3PausedSessionGuard:
    """Start session should detect existing paused session in repo."""

    def test_paused_session_detected(self, tmp_path):
        repo = _make_repo(tmp_path)
        paused = _make_session(
            paused=True,
            paused_at=datetime.utcnow() - timedelta(hours=1),
        )
        repo.save_session(paused, paused.user_id)

        existing = repo.load_session(paused.complex_id, paused.user_id)
        assert existing is not None
        assert existing.paused is True
        assert existing.is_active is True


# ===========================================================================
# MISSING-4: iteration_timestamps adjustment
# ===========================================================================

class TestMissing4IterationTimestampAdjustment:
    """Resume should shift iteration start forward by pause duration."""

    def test_iteration_start_shifted(self):
        from services.adaptive_session_manager import AdaptiveSessionManager

        pause_duration = 120  # 2 minutes
        original_start = datetime.utcnow() - timedelta(minutes=15)

        session = _make_session(
            paused=True,
            paused_at=datetime.utcnow() - timedelta(seconds=pause_duration),
            iteration=1,
        )
        session.iteration_timestamps = {
            1: {"start": original_start, "end": None}
        }

        AdaptiveSessionManager._accumulate_pause_time(session)

        new_start = session.iteration_timestamps[1]["start"]
        shift = (new_start - original_start).total_seconds()
        # The start should have shifted forward by roughly pause_duration
        assert shift >= pause_duration - 2  # allow 2s jitter
        assert shift <= pause_duration + 2

    def test_completed_iteration_not_shifted(self):
        """If iteration already has an end timestamp, start should not be shifted."""
        from services.adaptive_session_manager import AdaptiveSessionManager

        original_start = datetime.utcnow() - timedelta(minutes=30)
        original_end = datetime.utcnow() - timedelta(minutes=5)

        session = _make_session(
            paused=True,
            paused_at=datetime.utcnow() - timedelta(seconds=60),
            iteration=1,
        )
        session.iteration_timestamps = {
            1: {"start": original_start, "end": original_end}
        }

        AdaptiveSessionManager._accumulate_pause_time(session)

        # Start should NOT be shifted because end is already set
        assert session.iteration_timestamps[1]["start"] == original_start
        assert session.iteration_timestamps[1]["end"] == original_end


# ===========================================================================
# BUG-5: GET /task returns paused flag (unit-level contract test)
# ===========================================================================

class TestBug5PausedFlagContract:
    """When session is paused, get_session returns paused=True."""

    def test_paused_session_flag(self, tmp_path):
        mgr, repo = _make_manager(tmp_path)
        session = _make_session()
        mgr._active_sessions[session.id] = session

        mgr.pause_session(session.id)

        s = mgr.get_session(session.id)
        assert s is not None
        assert s.paused is True
        assert s.paused_at is not None


# ===========================================================================
# Integration: pause → resume round-trip preserves data
# ===========================================================================

class TestPauseResumeRoundTrip:
    """Full pause → resume → verify state is consistent."""

    def test_round_trip_in_memory(self, tmp_path):
        mgr, repo = _make_manager(tmp_path)
        session = _make_session()
        session.queue = [QueuedTask(task_ref="mod/topic/t1", difficulty=1)]
        session.current_task_index = 0
        mgr._active_sessions[session.id] = session

        # Pause
        mgr.pause_session(session.id)
        assert session.paused is True

        # Simulate delay
        session.paused_at = datetime.utcnow() - timedelta(seconds=30)

        # Resume
        resumed = mgr.resume_session(session.id, session.user_id)
        assert resumed is not None
        assert resumed.paused is False
        assert resumed.total_pause_seconds >= 29
        assert resumed.queue[0].task_ref == "mod/topic/t1"
        assert resumed.current_task_index == 0

    def test_round_trip_from_file(self, tmp_path):
        mgr, repo = _make_manager(tmp_path)
        session = _make_session()
        session.queue = [QueuedTask(task_ref="mod/topic/t1", difficulty=1)]
        mgr._active_sessions[session.id] = session

        # Pause and remove from memory (simulates restart)
        mgr.pause_session(session.id)
        session.paused_at = datetime.utcnow() - timedelta(seconds=45)
        repo.save_session(session, session.user_id)
        del mgr._active_sessions[session.id]

        # Resume from file
        resumed = mgr.resume_session(session.id, session.user_id)
        assert resumed is not None
        assert resumed.paused is False
        assert resumed.total_pause_seconds >= 44
        assert session.id in mgr._active_sessions


# ===========================================================================
# Serialization: total_pause_seconds persists to JSON
# ===========================================================================

class TestPauseSecondsSerialization:
    """total_pause_seconds is saved and loaded correctly from JSON."""

    def test_save_and_load(self, tmp_path):
        repo = _make_repo(tmp_path)
        session = _make_session(total_pause_seconds=123.45)
        repo.save_session(session, session.user_id)

        loaded = repo.load_session(session.complex_id, session.user_id)
        assert loaded is not None
        assert abs(loaded.total_pause_seconds - 123.45) < 0.01
