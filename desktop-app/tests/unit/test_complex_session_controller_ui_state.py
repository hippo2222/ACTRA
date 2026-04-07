import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

from logic.complex_session_controller import ComplexSessionController
from task_system.core.models.complex_models import ComplexSession, QueuedTask
from services.task_evaluator_service import EvaluationResult


def make_session(current_task_index=1):
    return ComplexSession(
        id="session_1",
        complex_id="complex_1",
        user_id="user_1",
        start_time=datetime.utcnow(),
        iteration=1,
        current_task_index=current_task_index,
        queue=[
            QueuedTask(task_ref="m/t/task1", difficulty=1, is_retry=False, origin_iteration=None),
            QueuedTask(task_ref="m/t/task2", difficulty=1, is_retry=False, origin_iteration=None),
            QueuedTask(task_ref="m/t/task3", difficulty=1, is_retry=False, origin_iteration=None),
        ],
        completed_tasks=[],
        is_active=True,
    )


def test_load_current_task_prefers_advanced_index_over_stale_ui_state():
    session_manager = MagicMock()
    task_controller = MagicMock()
    storage_service = MagicMock()
    complex_service = MagicMock()

    session = make_session(current_task_index=1)
    session_manager.get_session.return_value = session
    storage_service.load_task.side_effect = [
        {"task_data": {"type": "test"}, "answer_key": {}},
    ]

    controller = ComplexSessionController(
        session_manager=session_manager,
        task_controller=task_controller,
        storage_service=storage_service,
        complex_service=complex_service,
    )
    controller.current_session_id = session.id
    controller.restore_ui_state = MagicMock(return_value={"task_ref": "m/t/task1"})
    controller.save_ui_state = MagicMock()

    controller._load_current_task()

    assert controller.current_task_ref == "m/t/task2"
    assert session.current_task_index == 1
    storage_service.load_task.assert_called_once_with("m", "t", "task2")
    task_controller.load_task.assert_called_once()


def test_restore_session_keeps_task_results_ui_state_for_reload_restore():
    session_manager = MagicMock()
    task_controller = MagicMock()
    storage_service = MagicMock()
    complex_service = MagicMock()

    session = make_session(current_task_index=1)
    session.ui_state = {
        "screen_type": "task_results",
        "task_ref": "m/t/task1",
        "evaluation_result": {"success": True},
    }

    session_manager.session_repository.load_session.return_value = session
    session_manager.restore_session = MagicMock()
    complex_service.get_complex.return_value = object()

    controller = ComplexSessionController(
        session_manager=session_manager,
        task_controller=task_controller,
        storage_service=storage_service,
        complex_service=complex_service,
    )
    controller._load_current_task = MagicMock()
    controller.clear_ui_state = MagicMock()

    restored = controller.restore_session("complex_1", "user_1")

    assert restored is True
    controller.clear_ui_state.assert_not_called()
    controller._load_current_task.assert_called_once()
    assert controller.current_session_id == session.id


def test_save_ui_state_task_persists_user_input_for_pause_restore():
    session_manager = MagicMock()
    task_controller = MagicMock()
    storage_service = MagicMock()
    complex_service = MagicMock()

    session = make_session(current_task_index=1)
    session_manager.get_session.return_value = session
    session_manager.session_repository = MagicMock()

    controller = ComplexSessionController(
        session_manager=session_manager,
        task_controller=task_controller,
        storage_service=storage_service,
        complex_service=complex_service,
    )
    controller.current_session_id = session.id

    user_input = {
        "levels": [
            {"level_id": "level_1", "blocks": ["wolf_a"]},
        ]
    }

    saved = controller.save_ui_state(
        "task",
        force=True,
        task_ref="m/t/task2",
        task_index=1,
        user_input=user_input,
    )

    assert saved is True
    assert session.ui_state["screen_type"] == "task"
    assert session.ui_state["task_ref"] == "m/t/task2"
    assert session.ui_state["task_index"] == 1
    assert session.ui_state["user_input"] == user_input


def test_load_current_task_filters_answer_key_for_test_partial_retry():
    session_manager = MagicMock()
    task_controller = MagicMock()
    storage_service = MagicMock()
    complex_service = MagicMock()

    session = make_session(current_task_index=1)
    session.test_failed_subtests = {"m/t/task2": [0, 2]}
    session.queue[1].is_retry = True
    session_manager.get_session.return_value = session
    storage_service.load_task.return_value = {
        "task_data": {
            "type": "test",
            "content": {
                "questions": [
                    {"id": "q1", "prompt": "one"},
                    {"id": "q2", "prompt": "two"},
                    {"id": "q3", "prompt": "three"},
                ]
            },
        },
        "answer_key": {
            "questions": [
                {"id": "q1", "answers": [{"text": "A", "correct": True}]},
                {"id": "q2", "answers": [{"text": "B", "correct": True}]},
                {"id": "q3", "answers": [{"text": "C", "correct": True}]},
            ]
        },
    }

    controller = ComplexSessionController(
        session_manager=session_manager,
        task_controller=task_controller,
        storage_service=storage_service,
        complex_service=complex_service,
    )
    controller.current_session_id = session.id

    controller._load_current_task()

    task_controller.load_task.assert_called_once()
    _, kwargs = task_controller.load_task.call_args
    filtered_task_data = kwargs["task_data"]
    filtered_answer_key = kwargs["answer_key"]

    task_question_ids = [item["id"] for item in filtered_task_data["content"]["questions"]]
    answer_question_ids = [item["id"] for item in filtered_answer_key["questions"]]
    original_indices = [
        item["_partial_retry_original_index"]
        for item in filtered_answer_key["questions"]
    ]

    assert task_question_ids == ["q1", "q3"]
    assert answer_question_ids == ["q1", "q3"]
    assert original_indices == [0, 2]


def test_load_next_task_filters_answer_key_for_test_partial_retry():
    session_manager = MagicMock()
    task_controller = MagicMock()
    storage_service = MagicMock()
    complex_service = MagicMock()

    session = make_session(current_task_index=0)
    session.test_failed_subtests = {"m/t/task2": [0, 2]}
    session.queue[1].is_retry = True
    session_manager.get_session.return_value = session
    session_manager.get_next_task.return_value = {
        "task_ref": "m/t/task2",
        "difficulty": 1,
        "is_retry": True,
        "index": 1,
        "total": len(session.queue),
        "iteration": session.iteration,
    }
    storage_service.load_task.return_value = {
        "task_data": {
            "type": "test",
            "content": {
                "questions": [
                    {"id": "q1", "prompt": "one"},
                    {"id": "q2", "prompt": "two"},
                    {"id": "q3", "prompt": "three"},
                ]
            },
        },
        "answer_key": {
            "questions": [
                {"id": "q1", "answers": [{"text": "A", "correct": True}]},
                {"id": "q2", "answers": [{"text": "B", "correct": True}]},
                {"id": "q3", "answers": [{"text": "C", "correct": True}]},
            ]
        },
    }

    controller = ComplexSessionController(
        session_manager=session_manager,
        task_controller=task_controller,
        storage_service=storage_service,
        complex_service=complex_service,
    )
    controller.current_session_id = session.id
    controller.save_ui_state = MagicMock()

    controller._load_next_task()

    task_controller.load_task.assert_called_once()
    _, kwargs = task_controller.load_task.call_args
    filtered_task_data = kwargs["task_data"]
    filtered_answer_key = kwargs["answer_key"]

    task_question_ids = [item["id"] for item in filtered_task_data["content"]["questions"]]
    answer_question_ids = [item["id"] for item in filtered_answer_key["questions"]]
    original_indices = [
        item["_partial_retry_original_index"]
        for item in filtered_answer_key["questions"]
    ]

    assert task_question_ids == ["q1", "q3"]
    assert answer_question_ids == ["q1", "q3"]
    assert original_indices == [0, 2]


def test_submit_answer_recomputes_stale_test_message_after_session_success():
    session_manager = MagicMock()
    task_controller = MagicMock()
    storage_service = MagicMock()
    complex_service = MagicMock()

    session = make_session(current_task_index=1)
    session_manager.get_session.return_value = session
    session_manager.submit_result.return_value = MagicMock(
        success=True,
        details={"task_type": "test"},
    )

    evaluation_result = EvaluationResult(
        success=False,
        message="❌ Введите текстовые ответы",
        metric="percent",
        details={"task_type": "test"},
    )
    task_controller.submit_answer.return_value = evaluation_result
    task_controller.is_task_loaded.return_value = True
    task_controller.current_task = MagicMock(task_type="test")

    controller = ComplexSessionController(
        session_manager=session_manager,
        task_controller=task_controller,
        storage_service=storage_service,
        complex_service=complex_service,
    )
    controller.current_session_id = session.id
    controller.current_task_ref = "m/t/task2"
    controller._current_task_iteration = 1
    controller.save_ui_state = MagicMock()

    result = controller.submit_answer({"answers": {"0": 1}})

    assert result is evaluation_result
    assert result.success is True
    assert result.message == "✅ Правильно!"
