import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

from api.session_api import SessionAPI


def _queued_task(task_ref, *, difficulty=1):
    return SimpleNamespace(
        task_ref=task_ref,
        difficulty=difficulty,
        is_retry=False,
        origin_iteration=None,
        retry_variant=None,
    )


def test_next_task_does_not_complete_session_on_iteration_rollover_with_single_task_queue():
    session = SimpleNamespace(
        id="sess_1",
        user_id="u1",
        complex_id="complex_1",
        iteration=2,
        current_task_index=0,
        queue=[_queued_task("module/topic/task_001", difficulty=2)],
        completed_tasks=[
            SimpleNamespace(
                task_ref="module/topic/task_001",
                iteration_index=1,
                success=True,
                difficulty=1,
            )
        ],
        is_active=True,
        ui_state={},
        paused=False,
        paused_at=None,
    )

    controller = MagicMock()
    controller.current_session_id = "sess_1"
    controller.current_task_ref = "module/topic/task_001"
    controller.next_task = MagicMock()
    controller.task_controller = MagicMock()
    controller.task_controller.current_task = None
    controller.get_current_session_stats.return_value = {}

    session_manager = MagicMock()
    session_manager.get_session.return_value = session
    session_manager.session_repository = None

    storage_service = MagicMock()
    storage_service.load_task.return_value = {
        "task_dir": "D:/tmp/task",
        "task_data": {
            "type": "test",
            "content": {
                "question": "Q",
                "answers": [],
            },
        },
        "answer_key": {},
    }

    api = SessionAPI(
        session_controller=controller,
        adaptive_session_manager=session_manager,
        complex_service=MagicMock(),
        storage_service=storage_service,
        statistics_service=MagicMock(),
    )

    result = api.next_task("sess_1")

    assert result is not None
    assert result["task_ref"] == "module/topic/task_001"
    assert result["task_id"] == "task_001"
    assert result["iteration"] == 2
    assert result["difficulty"] == 2


def test_next_task_rejects_unchecked_current_task_from_task_screen():
    session = SimpleNamespace(
        id="sess_1",
        user_id="u1",
        complex_id="complex_1",
        iteration=1,
        current_task_index=1,
        queue=[_queued_task("module/topic/task_001", difficulty=1)],
        completed_tasks=[],
        is_active=True,
        ui_state={
            "screen_type": "task",
            "task_ref": "module/topic/task_001",
            "task_index": 0,
        },
        paused=False,
        paused_at=None,
    )

    controller = MagicMock()
    controller.current_session_id = "sess_1"
    controller.current_task_ref = "module/topic/task_001"
    controller.next_task = MagicMock()
    controller.task_controller = MagicMock()
    controller.task_controller.current_task = None
    controller.get_current_session_stats.return_value = {}

    session_manager = MagicMock()
    session_manager.get_session.return_value = session
    session_manager.session_repository = None

    api = SessionAPI(
        session_controller=controller,
        adaptive_session_manager=session_manager,
        complex_service=MagicMock(),
        storage_service=MagicMock(),
        statistics_service=MagicMock(),
    )

    result = api.next_task("sess_1")

    assert result == {"ok": False, "error": "task_not_checked"}
    controller.next_task.assert_not_called()
