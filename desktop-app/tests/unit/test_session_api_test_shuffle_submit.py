import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock
import copy


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


def test_scattered_group_payload_collects_adjacent_queue_slots():
    controller = MagicMock()
    controller.current_session_id = "sess_1"
    controller.current_task_ref = "module/topic/test_a"
    controller.task_controller = MagicMock()
    controller.task_controller.difficulty_manager = None

    slot_a = SimpleNamespace(
        task_ref="module/topic/test_a",
        difficulty=1,
        is_retry=False,
        origin_iteration=None,
        display_mode="scattered",
        source_task_ref="module/topic/test_a",
        test_question_index=1,
    )
    slot_b = SimpleNamespace(
        task_ref="module/topic/test_b",
        difficulty=1,
        is_retry=False,
        origin_iteration=None,
        display_mode="scattered",
        source_task_ref="module/topic/test_b",
        test_question_index=0,
    )
    session = SimpleNamespace(
        id="sess_1",
        user_id="u1",
        complex_id="complex_1",
        iteration=1,
        current_task_index=1,
        queue=[slot_a, slot_b],
        test_shuffle={},
        ui_state=None,
    )
    session_manager = MagicMock()
    session_manager.get_session.return_value = session
    session_manager.session_repository = None

    def load_task(module_id, topic_id, task_id):
        if task_id == "test_a":
            return {
                "task_data": {
                    "type": "test",
                    "content": {
                        "questions": [
                            {"id": "a0", "text": "A0", "answers": [{"text": "x", "correct": True}]},
                            {"id": "a1", "text": "A1", "answers": [{"text": "y", "correct": True}]},
                        ]
                    },
                    "settings": {"shuffle_questions": False, "shuffle_answers": False},
                },
                "answer_key": {},
                "task_dir": None,
            }
        return {
            "task_data": {
                "type": "test",
                "content": {
                    "questions": [
                        {"id": "b0", "text": "B0", "answers": [{"text": "z", "correct": True}]},
                    ]
                },
                "settings": {"shuffle_questions": False, "shuffle_answers": False},
            },
            "answer_key": {},
            "task_dir": None,
        }

    storage = MagicMock()
    storage.load_task.side_effect = load_task

    api = SessionAPI(
        session_controller=controller,
        adaptive_session_manager=session_manager,
        complex_service=MagicMock(),
        storage_service=storage,
        statistics_service=MagicMock(),
    )

    group = api._resolve_scattered_test_group(session, 0)
    payload = api._build_scattered_test_group_payload("sess_1", session, group)

    assert len(group) == 2
    assert payload is not None
    questions = payload["task_data"]["content"]["questions"]
    assert [q["_split_source_task_ref"] for q in questions] == [
        "module/topic/test_a",
        "module/topic/test_b",
    ]
    assert [q["_split_source_question_index"] for q in questions] == [1, 0]
    assert payload["test_group_meta"]["sources"] == [
        "module/topic/test_a",
        "module/topic/test_b",
    ]
    assert payload["test_group_meta"]["slot_count"] == 2
    assert payload["queue"]["end_index"] == 1


def test_get_current_task_reapplies_scattered_filter_after_controller_task_reuse():
    controller = MagicMock()
    controller.current_session_id = "sess_1"
    controller.current_task_ref = "module/topic/test_a"
    controller.get_current_session_stats.return_value = {}

    def apply_scattered_filter(*, queued_task, task_data_full, context_label):
        payload = copy.deepcopy(task_data_full)
        task_data = payload["task_data"]
        questions = task_data["content"]["questions"]
        task_data["content"]["questions"] = [questions[int(queued_task.test_question_index)]]
        payload["task_data"] = task_data
        return payload

    controller._apply_test_scattered_filter.side_effect = apply_scattered_filter

    full_task_data = {
        "type": "test",
        "content": {
            "questions": [
                {"id": "q0", "text": "Q0"},
                {"id": "q1", "text": "Q1"},
                {"id": "q2", "text": "Q2"},
            ]
        },
    }
    task_obj = MagicMock()
    task_obj.full_id = "module/topic/test_a"
    task_obj.task_data = copy.deepcopy(full_task_data)
    controller.task_controller = MagicMock()
    controller.task_controller.current_task = task_obj
    controller.task_controller.difficulty_manager = None

    queued_task = SimpleNamespace(
        task_ref="module/topic/test_a",
        difficulty=1,
        is_retry=False,
        origin_iteration=None,
        display_mode=None,
        source_task_ref="module/topic/test_a",
        test_question_index=1,
    )
    session = SimpleNamespace(
        id="sess_1",
        user_id="u1",
        complex_id="complex_1",
        iteration=1,
        current_task_index=1,
        queue=[queued_task],
        completed_tasks=[],
        test_shuffle={},
        test_failed_subtests={},
        ui_state=None,
        paused=False,
        is_active=True,
    )

    session_manager = MagicMock()
    session_manager.get_session.return_value = session
    session_manager.session_repository = None
    session_manager._get_task_type.return_value = "test"
    session_manager._get_task_phase.return_value = 1

    storage = MagicMock()
    storage.load_task.return_value = {
        "task_data": copy.deepcopy(full_task_data),
        "answer_key": {},
        "task_dir": None,
    }

    api = SessionAPI(
        session_controller=controller,
        adaptive_session_manager=session_manager,
        complex_service=MagicMock(),
        storage_service=storage,
        statistics_service=MagicMock(),
    )

    payload = api.get_current_task("sess_1", user_id="u1")

    assert payload is not None
    questions = payload["task_data"]["content"]["questions"]
    assert [question["id"] for question in questions] == ["q1"]
    assert controller._apply_test_scattered_filter.call_args.kwargs["context_label"] == "session_api_final"
