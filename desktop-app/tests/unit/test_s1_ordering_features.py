import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# Добавляем desktop-app в PYTHONPATH, чтобы импортировать services.*
DESKTOP_APP_PATH = Path(__file__).resolve().parents[2] / "desktop-app"
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

from task_system.core.models.complex_models import Complex, ComplexSettings, ComplexSession, QueuedTask
from services.adaptive_session_manager import AdaptiveSessionManager


def test_smart_retry_respects_complex_settings(monkeypatch):
    complex_service = MagicMock()
    user_progress = MagicMock()
    difficulty_manager = MagicMock()

    mgr = AdaptiveSessionManager(complex_service, user_progress, difficulty_manager)

    # No file checks / metadata issues
    mgr._check_task_file_exists = lambda task_ref: True
    mgr._get_task_type = lambda ref: "test"
    mgr._rebalance_queue_tail = lambda *args, **kwargs: None

    complex_obj = Complex(
        id="c1",
        name="C",
        tasks=["m/t/task1", "m/t/task2"],
        settings=ComplexSettings(
            smart_retry_near_offset=0,
            smart_retry_near_jitter_max=0,
            smart_retry_max_copies_per_task=1,
            smart_retry_training_control_enabled=False,
        ),
    )
    complex_service.get_complex.return_value = complex_obj

    # Start session and set a predictable queue
    session = mgr.start_session("c1", "u1")
    session.queue = [
        QueuedTask(task_ref="m/t/task1", difficulty=2, is_retry=False, origin_iteration=None),
        QueuedTask(task_ref="m/t/task2", difficulty=1, is_retry=False, origin_iteration=None),
    ]
    session.current_task_index = 0

    # Act: insert retries for task1 at difficulty=2.
    mgr._add_failed_task_to_current_queue(session, "m/t/task1", 2)

    # Assert max_copies_per_task=1: only ONE retry copy should be inserted.
    retry_copies = [t for t in session.queue if t.task_ref == "m/t/task1" and t.is_retry]
    assert len(retry_copies) == 1

    # near_offset=0 => retry inserted at current_idx (0)
    assert session.queue[0].task_ref == "m/t/task1"
    assert session.queue[0].is_retry is True
    assert session.queue[0].difficulty == 2

    # training_control_enabled=False => no lvl-1 training retry should be produced
    assert all(t.difficulty == 2 for t in retry_copies)
