import sys
from pathlib import Path
from unittest.mock import MagicMock


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

from api.session_api import SessionAPI


class _EvalResult:
    def __init__(self) -> None:
        self.success = True
        self.score = 100.0
        self.details = {}


def test_submit_answer_remaps_shuffled_test_answer_indices():
    controller = MagicMock()
    controller.current_session_id = "sess_1"
    controller.current_task_ref = "module/topic/task_005"

    # Unshuffled task model loaded in controller: correct answer is original index 0.
    task_obj = MagicMock()
    task_obj.full_id = "module/topic/task_005"
    task_obj.task_data = {
        "type": "test",
        "content": {
            "questions": [
                {"id": 0, "answers": [{"correct": True}, {"correct": False}]},
                {"id": 1, "answers": [{"correct": True}, {"correct": False}]},
                {"id": 2, "answers": [{"correct": True}, {"correct": False}, {"correct": False}, {"correct": False}]},
            ]
        },
    }
    controller.task_controller = MagicMock()
    controller.task_controller.current_task = task_obj
    controller.submit_answer.return_value = _EvalResult()

    # Session shuffle says: for original question index 2, shuffled index 3 maps to original index 0.
    session = MagicMock()
    session.id = "sess_1"
    session.user_id = "u1"
    session.iteration = 1
    session.current_task_index = 0
    session.queue = [MagicMock(task_ref="module/topic/task_005")]
    session.test_shuffle = {
        "module/topic/task_005@1": {
            "question_order": [2, 0, 1],
            "answer_order_by_question": {
                "2": [3, 1, 2, 0],
            },
        }
    }

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

    user_input = {
        "answers": {"2": 3},
        "text_answers": {},
    }

    result = api.submit_answer("sess_1", "task_005", user_input)

    assert result is not None
    submitted_payload = controller.submit_answer.call_args[0][0]
    assert submitted_payload["answers"]["2"] == 0


def test_submit_answer_attaches_per_question_ui_in_shuffled_indices():
    controller = MagicMock()
    controller.current_session_id = "sess_1"
    controller.current_task_ref = "module/topic/task_005"

    task_obj = MagicMock()
    task_obj.full_id = "module/topic/task_005"
    task_obj.task_data = {
        "type": "test",
        "content": {
            "questions": [
                {"id": 0, "answers": [{"correct": True}, {"correct": False}]},
                {"id": 1, "answers": [{"correct": True}, {"correct": False}]},
                {"id": 2, "answers": [{"correct": True}, {"correct": False}, {"correct": False}, {"correct": False}]},
            ]
        },
    }
    controller.task_controller = MagicMock()
    controller.task_controller.current_task = task_obj

    eval_result = _EvalResult()
    eval_result.details = {
        "per_question": {
            "2": {
                "status": "correct",
                "correct_option_ids": [0],
                "user_option_ids": [0],
            }
        }
    }
    controller.submit_answer.return_value = eval_result

    session = MagicMock()
    session.id = "sess_1"
    session.user_id = "u1"
    session.iteration = 1
    session.current_task_index = 0
    session.queue = [MagicMock(task_ref="module/topic/task_005")]
    session.test_shuffle = {
        "module/topic/task_005@1": {
            "question_order": [2, 0, 1],
            "answer_order_by_question": {
                "2": [3, 1, 2, 0],
            },
        }
    }

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

    result = api.submit_answer("sess_1", "task_005", {"answers": {"2": 3}})

    assert result is not None
    assert result.details["per_question"]["2"]["correct_option_ids"] == [0]
    assert result.details["per_question_ui"]["2"]["correct_option_ids"] == [3]
    assert result.details["per_question_ui"]["2"]["user_option_ids"] == [3]
