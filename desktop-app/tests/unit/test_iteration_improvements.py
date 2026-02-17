"""
Unit tests for Phase 2 (Iteration Timing Tracking) and Phase 3 (Iteration Mismatch Protection).

Tests cover:
- Phase 2: iteration_timestamps field, timestamp recording, duration calculation
- Phase 3: expected_iteration validation, mismatch detection, backward compatibility
"""

import sys
from pathlib import Path
from datetime import datetime, timedelta
from unittest.mock import MagicMock
import pytest

# Add desktop-app to PYTHONPATH
DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

import services.adaptive_session_manager as asm
from services.adaptive_session_manager import AdaptiveSessionManager
from task_system.core.models.complex_models import (
    Complex,
    ComplexSettings,
    ComplexSession,
    SessionTaskResult,
    ExtendedSessionResultSummary,
    QueuedTask
)


@pytest.fixture
def mock_services():
    complex_service = MagicMock()
    user_progress = MagicMock()
    difficulty_manager = MagicMock()
    return complex_service, user_progress, difficulty_manager


@pytest.fixture
def session_manager(mock_services, monkeypatch):
    # Make shuffle and random deterministic
    monkeypatch.setattr(asm.random, "shuffle", lambda seq: None)
    monkeypatch.setattr(asm.random, "randint", lambda a, b: a)
    monkeypatch.setattr(asm.random, "choice", lambda seq: seq[0] if seq else None)
    return AdaptiveSessionManager(*mock_services)


def _setup_complex(complex_service, tasks):
    complex_obj = Complex(
        id="c1",
        name="Test",
        tasks=tasks,
        settings=ComplexSettings(adaptive_difficulty=True, escalation_on_success=True),
    )
    complex_service.get_complex.return_value = complex_obj
    return complex_obj


def _wire_task_meta(session_manager, difficulty_manager, task_refs, levels):
    session_manager.task_meta_cache.update({ref: "test" for ref in task_refs})
    difficulty_manager.get_available_levels.side_effect = lambda task_type, task_ref: levels
    session_manager._check_task_file_exists = lambda task_ref: True


# ============================================================================
# PHASE 2: ITERATION TIMING TRACKING TESTS
# ============================================================================

def test_complex_session_has_iteration_timestamps_field():
    """Phase 2: ComplexSession model has iteration_timestamps field."""
    session = ComplexSession(
        id="test",
        complex_id="c1",
        user_id="user1",
        start_time=datetime.utcnow(),
        version=1,
        iteration=1
    )
    
    # Field should exist and be empty dict by default
    assert hasattr(session, 'iteration_timestamps')
    assert isinstance(session.iteration_timestamps, dict)
    assert len(session.iteration_timestamps) == 0


def test_extended_summary_has_iteration_durations_field():
    """Phase 2: ExtendedSessionResultSummary has iteration_durations field."""
    summary = ExtendedSessionResultSummary(
        session_id="test",
        complex_id="c1",
        user_id="user1",
        start_time=datetime.utcnow(),
        end_time=datetime.utcnow(),
        total_iterations=2,
        tasks_mastered_count=5,
        tasks_failed_count=1,
        difficulty_progression=[1.0, 1.5],
        total_tasks=10,
        successful_tasks_count=9
    )
    
    # Field should exist and be empty list by default
    assert hasattr(summary, 'iteration_durations')
    assert isinstance(summary.iteration_durations, list)
    assert len(summary.iteration_durations) == 0


def test_start_session_initializes_iteration_timestamps(session_manager, mock_services):
    """Phase 2: start_session() initializes iteration_timestamps for first iteration."""
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task1", "task2"]
    _setup_complex(complex_service, tasks)
    _wire_task_meta(session_manager, difficulty_manager, tasks, [1, 2])
    
    session = session_manager.start_session("c1", "user1", start_iteration=1)
    
    # Iteration 1 should have start timestamp
    assert 1 in session.iteration_timestamps
    assert 'start' in session.iteration_timestamps[1]
    assert 'end' in session.iteration_timestamps[1]
    assert session.iteration_timestamps[1]['start'] is not None
    assert session.iteration_timestamps[1]['end'] is None  # Not finished yet


def test_generate_next_iteration_records_timestamps(session_manager, mock_services):
    """Phase 2: _generate_next_iteration() records end time for current and start time for next."""
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task1", "task2"]
    complex_obj = _setup_complex(complex_service, tasks)
    _wire_task_meta(session_manager, difficulty_manager, tasks, [1, 2])
    
    session = session_manager.start_session("c1", "user1")
    
    # Complete iteration 1
    t1 = session_manager.get_next_task(session.id)
    t2 = session_manager.get_next_task(session.id)
    session_manager.submit_result(session.id, {"task_ref": t1["task_ref"], "success": True, "difficulty": 1})
    session_manager.submit_result(session.id, {"task_ref": t2["task_ref"], "success": True, "difficulty": 1})
    
    # Trigger iteration 2 generation
    session_manager.get_next_task(session.id)
    
    # Iteration 1 should have end timestamp
    assert session.iteration_timestamps[1]['end'] is not None
    
    # Iteration 2 should have start timestamp
    assert 2 in session.iteration_timestamps
    assert session.iteration_timestamps[2]['start'] is not None
    assert session.iteration_timestamps[2]['end'] is None


def test_generate_session_summary_calculates_iteration_durations(session_manager, mock_services):
    """Phase 2: _generate_session_summary() calculates iteration_durations from timestamps."""
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task1"]
    complex_obj = _setup_complex(complex_service, tasks)
    _wire_task_meta(session_manager, difficulty_manager, tasks, [1])
    
    session = session_manager.start_session("c1", "user1")
    
    # Manually set timestamps for testing
    start1 = datetime(2024, 1, 1, 10, 0, 0)
    end1 = datetime(2024, 1, 1, 10, 5, 30)  # 5.5 minutes = 330 seconds
    
    session.iteration_timestamps[1] = {'start': start1, 'end': end1}
    
    # Complete task
    t1 = session_manager.get_next_task(session.id)
    session_manager.submit_result(session.id, {"task_ref": t1["task_ref"], "success": True, "difficulty": 1})
    
    # End session
    summary = session_manager.end_session(session.id)
    
    # Check iteration_durations
    assert hasattr(summary, 'iteration_durations')
    assert len(summary.iteration_durations) == 1
    assert summary.iteration_durations[0] == 330.0


def test_iteration_durations_handles_incomplete_iterations(session_manager, mock_services):
    """Phase 2: iteration_durations contains None for incomplete iterations."""
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task1", "task2"]
    complex_obj = _setup_complex(complex_service, tasks)
    _wire_task_meta(session_manager, difficulty_manager, tasks, [1, 2])
    
    session = session_manager.start_session("c1", "user1")
    
    # Set timestamps for iteration 1 (complete)
    session.iteration_timestamps[1] = {
        'start': datetime(2024, 1, 1, 10, 0, 0),
        'end': datetime(2024, 1, 1, 10, 5, 0)
    }
    
    # Set timestamps for iteration 2 (incomplete - no end)
    session.iteration_timestamps[2] = {
        'start': datetime(2024, 1, 1, 10, 5, 0),
        'end': None
    }
    
    # Add completed tasks
    session.completed_tasks = [
        SessionTaskResult(task_ref="task1", success=True, time_spent=100, difficulty=1, iteration_index=1),
        SessionTaskResult(task_ref="task2", success=True, time_spent=120, difficulty=1, iteration_index=1),
    ]
    
    summary = session_manager._generate_session_summary(session)
    
    # Only iteration 1 should have duration, iteration 2 should be None
    assert len(summary.iteration_durations) == 1
    assert summary.iteration_durations[0] == 300.0  # 5 minutes


def test_backward_compatibility_old_sessions_without_timestamps(session_manager, mock_services):
    """Phase 2: Old sessions without iteration_timestamps work correctly."""
    complex_service, _, difficulty_manager = mock_services
    
    # Setup mocks
    session_manager._get_task_type = lambda ref: "test"
    difficulty_manager.get_available_levels.return_value = [1, 2]
    
    # Create session without iteration_timestamps (simulating old session)
    session = ComplexSession(
        id="old_session",
        complex_id="c1",
        user_id="user1",
        start_time=datetime.utcnow(),
        version=1,
        iteration=2
    )
    
    # iteration_timestamps should be empty dict (default)
    assert session.iteration_timestamps == {}
    
    # Should not crash when generating summary
    session.completed_tasks = [
        SessionTaskResult(task_ref="task1", success=True, time_spent=100, difficulty=1, iteration_index=1),
    ]
    
    summary = session_manager._generate_session_summary(session)
    
    # iteration_durations should contain None for iteration without timestamp data
    assert len(summary.iteration_durations) == 1
    assert summary.iteration_durations[0] is None  # No timestamp data for iteration 1


# ============================================================================
# PHASE 3: ITERATION MISMATCH PROTECTION TESTS
# ============================================================================

def test_submit_result_accepts_expected_iteration(session_manager, mock_services):
    """Phase 3: submit_result() accepts expected_iteration parameter."""
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task1"]
    _setup_complex(complex_service, tasks)
    _wire_task_meta(session_manager, difficulty_manager, tasks, [1, 2])
    
    session = session_manager.start_session("c1", "user1")
    t1 = session_manager.get_next_task(session.id)
    
    # Submit with expected_iteration
    result = session_manager.submit_result(session.id, {
        "task_ref": t1["task_ref"],
        "success": True,
        "difficulty": 1,
        "expected_iteration": 1  # ← NEW parameter
    })
    
    # Result should be assigned to iteration 1
    assert result.iteration_index == 1


def test_submit_result_uses_expected_iteration_on_mismatch(session_manager, mock_services):
    """Phase 3: submit_result() uses expected_iteration when it differs from current."""
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task1"]
    _setup_complex(complex_service, tasks)
    _wire_task_meta(session_manager, difficulty_manager, tasks, [1, 2])
    
    session = session_manager.start_session("c1", "user1")
    t1 = session_manager.get_next_task(session.id)
    
    # Simulate network delay: session moved to iteration 2
    session.iteration = 2
    
    # Submit with expected_iteration=1 (original iteration)
    result = session_manager.submit_result(session.id, {
        "task_ref": t1["task_ref"],
        "success": True,
        "difficulty": 1,
        "expected_iteration": 1  # ← Client's iteration
    })
    
    # Result should use client's iteration (1), not server's (2)
    assert result.iteration_index == 1


def test_submit_result_logs_mismatch_warning(session_manager, mock_services, caplog):
    """Phase 3: submit_result() logs warning when iteration mismatch detected."""
    import logging
    caplog.set_level(logging.WARNING)
    
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task1"]
    _setup_complex(complex_service, tasks)
    _wire_task_meta(session_manager, difficulty_manager, tasks, [1, 2])
    
    session = session_manager.start_session("c1", "user1")
    t1 = session_manager.get_next_task(session.id)
    
    # Simulate mismatch
    session.iteration = 2
    
    session_manager.submit_result(session.id, {
        "task_ref": t1["task_ref"],
        "success": True,
        "difficulty": 1,
        "expected_iteration": 1
    })
    
    # Check for warning log
    assert any("ITERATION MISMATCH DETECTED" in record.message for record in caplog.records)


def test_submit_result_tracks_mismatch_count(session_manager, mock_services):
    """Phase 3: submit_result() increments mismatch counter."""
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task1", "task2"]
    _setup_complex(complex_service, tasks)
    _wire_task_meta(session_manager, difficulty_manager, tasks, [1, 2])
    
    session = session_manager.start_session("c1", "user1")
    t1 = session_manager.get_next_task(session.id)
    t2 = session_manager.get_next_task(session.id)
    
    # First mismatch
    session.iteration = 2
    session_manager.submit_result(session.id, {
        "task_ref": t1["task_ref"],
        "success": True,
        "difficulty": 1,
        "expected_iteration": 1
    })
    
    assert hasattr(session_manager, 'iteration_mismatch_count')
    assert session_manager.iteration_mismatch_count == 1
    
    # Second mismatch
    session_manager.submit_result(session.id, {
        "task_ref": t2["task_ref"],
        "success": True,
        "difficulty": 1,
        "expected_iteration": 1
    })
    
    assert session_manager.iteration_mismatch_count == 2


def test_submit_result_no_mismatch_when_iterations_match(session_manager, mock_services):
    """Phase 3: submit_result() does not log warning when iterations match."""
    import logging
    
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task1"]
    _setup_complex(complex_service, tasks)
    _wire_task_meta(session_manager, difficulty_manager, tasks, [1, 2])
    
    session = session_manager.start_session("c1", "user1")
    t1 = session_manager.get_next_task(session.id)
    
    # Submit with matching iteration
    session_manager.submit_result(session.id, {
        "task_ref": t1["task_ref"],
        "success": True,
        "difficulty": 1,
        "expected_iteration": 1  # Matches session.iteration
    })
    
    # No mismatch counter should be created
    assert not hasattr(session_manager, 'iteration_mismatch_count')


def test_submit_result_backward_compatible_without_expected_iteration(session_manager, mock_services):
    """Phase 3: submit_result() works without expected_iteration (old clients)."""
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task1"]
    _setup_complex(complex_service, tasks)
    _wire_task_meta(session_manager, difficulty_manager, tasks, [1, 2])
    
    session = session_manager.start_session("c1", "user1")
    t1 = session_manager.get_next_task(session.id)
    
    # Submit WITHOUT expected_iteration (old behavior)
    result = session_manager.submit_result(session.id, {
        "task_ref": t1["task_ref"],
        "success": True,
        "difficulty": 1
        # No expected_iteration
    })
    
    # Should use current session.iteration
    assert result.iteration_index == session.iteration


def test_submit_result_handles_none_expected_iteration(session_manager, mock_services):
    """Phase 3: submit_result() handles None as expected_iteration gracefully."""
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task1"]
    _setup_complex(complex_service, tasks)
    _wire_task_meta(session_manager, difficulty_manager, tasks, [1, 2])
    
    session = session_manager.start_session("c1", "user1")
    t1 = session_manager.get_next_task(session.id)
    
    # Submit with explicit None
    result = session_manager.submit_result(session.id, {
        "task_ref": t1["task_ref"],
        "success": True,
        "difficulty": 1,
        "expected_iteration": None
    })
    
    # Should use current session.iteration
    assert result.iteration_index == session.iteration


# ============================================================================
# INTEGRATION TESTS (PHASE 2 + PHASE 3)
# ============================================================================

def test_full_session_with_timing_and_mismatch_protection(session_manager, mock_services):
    """Integration: Full session with both timing tracking and mismatch protection."""
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task1", "task2"]
    _setup_complex(complex_service, tasks)
    _wire_task_meta(session_manager, difficulty_manager, tasks, [1, 2])
    
    # Start session
    session = session_manager.start_session("c1", "user1")
    
    # Verify iteration 1 timestamp initialized
    assert 1 in session.iteration_timestamps
    assert session.iteration_timestamps[1]['start'] is not None
    
    # Complete iteration 1
    t1 = session_manager.get_next_task(session.id)
    t2 = session_manager.get_next_task(session.id)
    
    # Submit with expected_iteration
    session_manager.submit_result(session.id, {
        "task_ref": t1["task_ref"],
        "success": True,
        "difficulty": 1,
        "expected_iteration": 1
    })
    session_manager.submit_result(session.id, {
        "task_ref": t2["task_ref"],
        "success": True,
        "difficulty": 1,
        "expected_iteration": 1
    })
    
    # Move to iteration 2
    session_manager.get_next_task(session.id)
    
    # Verify iteration 1 has end timestamp
    assert session.iteration_timestamps[1]['end'] is not None
    
    # Verify iteration 2 has start timestamp
    assert 2 in session.iteration_timestamps
    assert session.iteration_timestamps[2]['start'] is not None
    
    # Complete iteration 2
    t3 = session_manager.get_next_task(session.id)
    t4 = session_manager.get_next_task(session.id)
    
    session_manager.submit_result(session.id, {
        "task_ref": t3["task_ref"],
        "success": True,
        "difficulty": 2,
        "expected_iteration": 2
    })
    session_manager.submit_result(session.id, {
        "task_ref": t4["task_ref"],
        "success": True,
        "difficulty": 2,
        "expected_iteration": 2
    })
    
    # End session
    summary = session_manager.end_session(session.id)
    
    # Verify iteration_durations calculated
    assert len(summary.iteration_durations) == 2
    assert all(d is not None for d in summary.iteration_durations)
