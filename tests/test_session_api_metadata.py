import sys
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from api.session_api import SessionAPI  # type: ignore
from task_system.core.models.complex_models import SessionTaskResult
from tests.unit.helpers import load_task_evaluator_service

TaskEvaluatorService = load_task_evaluator_service()


class DummyQueuedTask:
    def __init__(self, task_ref: str, difficulty: int = 1) -> None:
        self.task_ref = task_ref
        self.difficulty = difficulty
        self.is_retry = False
        self.origin_iteration = None


class DummySession:
    def __init__(self, session_id: str, iteration: int = 1) -> None:
        self.id = session_id
        self.user_id = "test_user"
        self.complex_id = "test_complex"
        self.iteration = iteration
        self.is_active = True
        self.queue: List[DummyQueuedTask] = []
        self.current_task_index: int = 0
        self.completed_tasks: List[Any] = []
        self.test_shuffle: Dict[str, Any] = {}
        self.test_failed_subtests: Dict[str, List[int]] = {}
        self.paused = False
        self.paused_at = None


class DummyTaskControllerWrapper:
    def __init__(self, full_id: str, task_data: Dict[str, Any]) -> None:
        self.current_task = type("Task", (), {"full_id": full_id, "task_data": task_data})


class DummyController:
    def __init__(self, session_id: str, task_ref: str, enhanced_task: Optional[Dict[str, Any]] = None) -> None:
        self.current_session_id = session_id
        self.current_task_ref = task_ref
        if enhanced_task:
            self.task_controller = DummyTaskControllerWrapper(task_ref, enhanced_task)
        else:
            self.task_controller = None

    def get_current_session_stats(self) -> Dict[str, Any]:  # pragma: no cover
        return {}


class DummyAdaptiveSessionManager:
    def __init__(self, session: DummySession) -> None:
        self._session = session

    def get_session(self, session_id: str) -> Optional[DummySession]:
        return self._session if self._session.id == session_id else None

    def pause_session(self, session_id: str) -> None:
        if self._session.id == session_id:
            self._session.paused = True

    def resume_session(self, session_id: str, user_id: str) -> Optional[DummySession]:
        if self._session.id == session_id and self._session.user_id == user_id:
            self._session.paused = False
            return self._session
        return None


class DummyComplexService:
    pass


class DummyStorageService:
    def __init__(self, task_data_full: Dict[str, Any]) -> None:
        self._task_data_full = task_data_full

    def load_task(self, module_id: str, topic_id: str, task_id: str) -> Dict[str, Any]:
        return self._task_data_full


def _make_api(task_data_full: Dict[str, Any], *, session_id: str = "sess", task_ref: str = "module/topic/task") -> SessionAPI:
    session = DummySession(session_id=session_id, iteration=1)
    session.queue = [DummyQueuedTask(task_ref, difficulty=1)]
    session.current_task_index = 1
    controller = DummyController(session_id, task_ref)
    api = SessionAPI(
        controller,
        DummyAdaptiveSessionManager(session),
        DummyComplexService(),
        DummyStorageService(task_data_full),
        statistics_service=MagicMock(),
    )
    return api


def test_get_current_task_preserves_metadata_snapshot() -> None:
    task_ref = "m/t/task_draw"
    task_data_full = {
        "task_data": {
            "type": "draw",
            "content": {
                "prompt": "Original prompt",
                "settings": {"success_threshold": 2},
                "additionalInfo": {"type": "text", "text": "legacy"},
            },
        },
        "answer_key": {},
        "task_dir": None,
    }
    api = _make_api(task_data_full, task_ref=task_ref)
    result = api.get_current_task("sess")
    content = result["task_data"]["content"]

    assert content["prompt"] == "Original prompt"
    assert content["settings"]["success_threshold"] == 2
    assert content["additionalInfo"] == {"type": "text", "text": "legacy"}


def test_controller_enhanced_task_overrides_storage_version() -> None:
    task_ref = "m/t/task_click"
    storage_task = {
        "task_data": {
            "type": "click",
            "content": {
                "prompt": "Storage prompt",
                "settings": {},
                "requires_drawing": False,
            },
        },
        "answer_key": {},
        "task_dir": None,
    }
    enhanced_task = {
        "type": "click",
        "content": {
            "prompt": "Enhanced prompt",
            "settings": {"success_threshold": 3},
            "additionalInfo": {"type": "image", "images": ["a.png"]},
            "requires_drawing": True,
        },
    }
    session = DummySession(session_id="sess", iteration=1)
    session.queue = [DummyQueuedTask(task_ref)]
    session.current_task_index = 1

    controller = DummyController("sess", task_ref, enhanced_task=enhanced_task)
    api = SessionAPI(
        controller,
        DummyAdaptiveSessionManager(session),
        DummyComplexService(),
        DummyStorageService(storage_task),
        statistics_service=MagicMock(),
    )

    result = api.get_current_task("sess")
    content = result["task_data"]["content"]
    assert content["prompt"] == "Enhanced prompt"
    assert content["settings"]["success_threshold"] == 3
    assert content["additionalInfo"]["images"] == ["a.png"]
    assert content["requires_drawing"] is True


def test_sequence_current_task_preserves_prompt_and_name_from_flattened_controller_data() -> None:
    task_ref = "m/t/task_sequence"
    storage_task = {
        "task_data": {
            "type": "sequence_assembly",
            "content": {
                "prompt": "Storage prompt",
                "elements": [
                    {"id": "elem_1", "text": "A"},
                    {"id": "elem_2", "text": "B"},
                ],
                "levels": [
                    {"level_id": "level_1", "level_name": "Step 1", "blocks": ["elem_1", "elem_2"]},
                ],
            },
            "meta": {"name": "Тест Задание Последовательность"},
        },
        "answer_key": {},
        "task_dir": None,
    }
    enhanced_task = {
        "type": "sequence_assembly",
        "task_type": "sequence_assembly",
        "prompt": "Опишите правильную последовательность наложения электродов при снятии ЭКГ",
        "elements": [
            {"id": "elem_1", "text": "Красный"},
            {"id": "elem_2", "text": "Желтый"},
        ],
        "levels": [
            {"level_id": "level_1", "label": "Левая рука", "slots": ["elem_1", "elem_2"]},
        ],
        "settings": {"level_order_matters": True},
    }
    session = DummySession(session_id="sess", iteration=1)
    session.queue = [DummyQueuedTask(task_ref)]
    session.current_task_index = 1

    controller = DummyController("sess", task_ref, enhanced_task=enhanced_task)
    api = SessionAPI(
        controller,
        DummyAdaptiveSessionManager(session),
        DummyComplexService(),
        DummyStorageService(storage_task),
        statistics_service=MagicMock(),
    )

    payload = api.get_current_task("sess")

    assert payload is not None
    assert payload["task_data"]["prompt"] == (
        "Опишите правильную последовательность наложения электродов при снятии ЭКГ"
    )
    assert payload["task_data"]["name"] == "Тест Задание Последовательность"
    assert payload["task_data"]["meta"]["name"] == "Тест Задание Последовательность"
    assert payload["task_name"] == "Тест Задание Последовательность"


def test_session_api_roundtrip_with_requires_drawing_flag() -> None:
    task_ref = "m/t/task_click_draw"
    storage_task = {
        "task_data": {
            "type": "click",
            "content": {
                "prompt": "Storage prompt",
                "settings": {},
                "requires_drawing": False,
            },
        },
        "answer_key": {
            "targets": [
                {
                    "shape": "polygon",
                    "points": [[0, 0], [10, 0], [10, 10]],
                    "label": "A",
                }
            ]
        },
        "task_dir": None,
    }
    enhanced_task = {
        "type": "click",
        "content": {
            "prompt": "Enhanced prompt",
            "settings": {"success_threshold": 2},
            "additionalInfo": {"type": "combined", "text": "Hint", "images": ["a.png"]},
            "requires_drawing": True,
            "requires_labels": True,
            "mode": "draw_and_label",
        },
    }
    session = DummySession(session_id="sess", iteration=1)
    session.queue = [DummyQueuedTask(task_ref)]
    session.current_task_index = 1

    controller = DummyController("sess", task_ref, enhanced_task=enhanced_task)
    api = SessionAPI(
        controller,
        DummyAdaptiveSessionManager(session),
        DummyComplexService(),
        DummyStorageService(storage_task),
        statistics_service=MagicMock(),
    )

    payload = api.get_current_task("sess")
    assert payload is not None

    content = payload["task_data"]["content"]
    assert content["requires_drawing"] is True
    assert content["prompt"] == "Enhanced prompt"

    # Симулируем правки UI
    content["prompt"] = "UI-modified prompt"
    content.setdefault("settings", {})["success_threshold"] = 4

    evaluator = TaskEvaluatorService()
    user_input = {"drawing": [], "labels": []}
    result = evaluator.evaluate_click_task(
        user_input, storage_task["answer_key"], payload["task_data"]
    )

    assert result.details.get("level") == 3
    assert result.details.get("stage") == "drawing"
    assert payload["task_data"]["content"]["prompt"] == "UI-modified prompt"
    assert payload["task_data"]["content"]["settings"]["success_threshold"] == 4


def test_draw_task_roundtrip_preserves_multiple_additional_images() -> None:
    task_ref = "m/t/task_draw_multi"
    task_data_full = {
        "task_data": {
            "type": "draw",
            "settings": {"success_threshold": 1},
            "content": {
                "prompt": "Draw prompt",
                "requires_labels": False,
                "additionalInfo": {
                    "type": "combined",
                    "text": "Hint text",
                    "images": ["img1.png", "img2.png", "img3.png"],
                },
            },
        },
        "answer_key": {
            "targets": [
                {
                    "shape": "polygon",
                    "points": [[0, 0], [10, 0], [10, 10]],
                }
            ]
        },
        "task_dir": None,
    }

    api = _make_api(task_data_full, session_id="sess_draw", task_ref=task_ref)
    payload = api.get_current_task("sess_draw")
    content = payload["task_data"]["content"]

    assert content["additionalInfo"]["images"] == ["img1.png", "img2.png", "img3.png"]

    # UI modifies the first image and truncates to the allowed amount
    content["additionalInfo"]["images"][0] = "updated.png"
    content["additionalInfo"]["images"] = content["additionalInfo"]["images"][:3]

    evaluator = TaskEvaluatorService()
    user_input = {
        "polygons": [
            {"points": [[0, 0], [10, 0], [10, 10]]},
        ]
    }
    result = evaluator.evaluate_draw_task(
        user_input, payload["answer_key"], payload["task_data"]
    )

    assert result.success is True
    assert content["additionalInfo"]["images"][0] == "updated.png"


def test_draw_task_requires_labels_roundtrip() -> None:
    task_ref = "m/t/task_draw_labels"
    task_data_full = {
        "task_data": {
            "type": "draw",
            "content": {
                "prompt": "Label draw prompt",
                "requires_labels": True,
                "requires_drawing": True,
                "additionalInfo": {"type": "text", "text": "Remember names"},
            },
            "settings": {"success_threshold": 2},
        },
        "answer_key": {
            "targets": [
                {
                    "shape": "polygon",
                    "points": [[0, 0], [10, 0], [10, 10]],
                    "label": "Печень",
                },
                {
                    "shape": "polygon",
                    "points": [[20, 20], [30, 20], [30, 30]],
                    "label": "Селезёнка",
                },
            ]
        },
        "task_dir": None,
    }

    api = _make_api(task_data_full, session_id="sess_draw_labels", task_ref=task_ref)
    payload = api.get_current_task("sess_draw_labels")

    payload["task_data"]["content"]["prompt"] = "Updated label prompt"
    payload["task_data"]["content"]["additionalInfo"]["text"] = "Updated info"

    evaluator = TaskEvaluatorService()
    user_input = {
        "polygons": [
            {"points": [[0, 0], [10, 0], [10, 10]]},
            {"points": [[20, 20], [30, 20], [30, 30]]},
        ],
        "labels_polygons": ["Печень", "Селезёнка"],
    }

    result = evaluator.evaluate_draw_task(
        user_input, payload["answer_key"], payload["task_data"]
    )
    assert result.success is True
    content = payload["task_data"]["content"]
    assert content["prompt"] == "Updated label prompt"
    assert content["additionalInfo"]["text"] == "Updated info"


def test_pause_session_persists_current_slot_even_without_user_input() -> None:
    task_ref = "m/t/task_pause"
    task_data_full = {
        "task_data": {
            "type": "click",
            "content": {
                "prompt": "Prompt",
                "settings": {},
            },
        },
        "answer_key": {},
        "task_dir": None,
    }

    session = DummySession(session_id="sess_pause", iteration=1)
    session.queue = [DummyQueuedTask(task_ref, difficulty=1)]
    session.current_task_index = 1

    controller = MagicMock()
    controller.current_session_id = None
    controller.current_task_ref = None
    controller.task_controller = None
    controller.save_ui_state = MagicMock()

    api = SessionAPI(
        controller,
        DummyAdaptiveSessionManager(session),
        DummyComplexService(),
        DummyStorageService(task_data_full),
        statistics_service=MagicMock(),
    )

    api.pause_session("sess_pause")

    controller.save_ui_state.assert_called_once()
    call_args = controller.save_ui_state.call_args
    assert call_args.args[0] == "task"
    assert call_args.kwargs["force"] is True
    assert call_args.kwargs["task_ref"] == task_ref
    assert call_args.kwargs["task_index"] == 0
    assert session.paused is True


def test_pause_session_forwards_view_state_to_controller() -> None:
    task_ref = "m/t/task_pause_view"
    task_data_full = {
        "task_data": {
            "type": "click",
            "content": {
                "prompt": "Prompt",
                "settings": {},
            },
        },
        "answer_key": {},
        "task_dir": None,
    }

    session = DummySession(session_id="sess_pause_view", iteration=1)
    session.queue = [DummyQueuedTask(task_ref, difficulty=1)]
    session.current_task_index = 1

    controller = MagicMock()
    controller.current_session_id = None
    controller.current_task_ref = None
    controller.task_controller = None
    controller.save_ui_state = MagicMock()

    api = SessionAPI(
        controller,
        DummyAdaptiveSessionManager(session),
        DummyComplexService(),
        DummyStorageService(task_data_full),
        statistics_service=MagicMock(),
    )

    api.pause_session(
        "sess_pause_view",
        view_state={"zoom": 1.5, "panX": 12, "panY": 24},
    )

    controller.save_ui_state.assert_called_once()
    call_args = controller.save_ui_state.call_args
    assert call_args.kwargs["view_state"] == {
        "zoom": 1.5,
        "panX": 12,
        "panY": 24,
    }


def test_get_current_task_returns_restored_view_state() -> None:
    task_ref = "m/t/task_restore_view"
    task_data_full = {
        "task_data": {
            "type": "sequence_assembly",
            "content": {
                "prompt": "Prompt",
                "elements": [],
                "levels": [],
                "settings": {},
            },
        },
        "answer_key": {},
        "task_dir": None,
    }

    session = DummySession(session_id="sess_restore_view", iteration=1)
    session.queue = [DummyQueuedTask(task_ref, difficulty=1)]
    session.current_task_index = 1
    session.ui_state = {
        "screen_type": "task",
        "task_ref": task_ref,
        "task_index": 0,
        "view_state": {
            "selected_available_id": "elem_2",
            "scroll_positions": {"availableTop": 30, "levelsTop": 40},
        },
    }

    controller = DummyController("sess_restore_view", task_ref)
    api = SessionAPI(
        controller,
        DummyAdaptiveSessionManager(session),
        DummyComplexService(),
        DummyStorageService(task_data_full),
        statistics_service=MagicMock(),
    )

    payload = api.get_current_task("sess_restore_view")

    assert payload["restored_view_state"] == {
        "selected_available_id": "elem_2",
        "scroll_positions": {"availableTop": 30, "levelsTop": 40},
    }


def test_pause_resume_draft_clears_stale_restored_evaluation_result() -> None:
    task_ref = "m/t/task_pause_restore"
    task_data_full = {
        "task_data": {
            "type": "sequence_assembly",
            "content": {
                "prompt": "Prompt",
                "elements": [],
                "levels": [],
                "settings": {},
            },
        },
        "answer_key": {},
        "task_dir": None,
    }

    session = DummySession(session_id="sess_pause_restore", iteration=1)
    session.queue = [DummyQueuedTask(task_ref, difficulty=1)]
    session.current_task_index = 1
    session.ui_state = {
        "screen_type": "task_results",
        "task_ref": task_ref,
        "task_index": 0,
        "user_input": {"answer": "old checked answer"},
        "view_state": {"comparison_view": "reference"},
        "evaluation_result": {"success": False, "message": "Old result"},
    }

    controller = MagicMock()
    controller.current_session_id = None
    controller.current_task_ref = None
    controller.task_controller = None

    def _save_ui_state(screen_type: str, **kwargs: Any) -> bool:
        next_ui_state = {
            "screen_type": screen_type,
            "task_ref": kwargs.get("task_ref"),
            "task_index": kwargs.get("task_index"),
        }
        if "user_input" in kwargs:
            next_ui_state["user_input"] = kwargs.get("user_input")
        if "view_state" in kwargs:
            next_ui_state["view_state"] = kwargs.get("view_state")
        if "evaluation_result" in kwargs:
            next_ui_state["evaluation_result"] = kwargs.get("evaluation_result")
        session.ui_state = next_ui_state
        return True

    controller.save_ui_state = MagicMock(side_effect=_save_ui_state)

    api = SessionAPI(
        controller,
        DummyAdaptiveSessionManager(session),
        DummyComplexService(),
        DummyStorageService(task_data_full),
        statistics_service=MagicMock(),
    )

    paused_user_input = {
        "levels": [{"level_id": "level_1", "blocks": ["wolf_a"]}],
    }
    paused_view_state = {
        "selected_available_id": "wolf_a",
        "scroll_positions": {"availableTop": 10, "levelsTop": 20},
    }

    api.pause_session(
        "sess_pause_restore",
        user_input=paused_user_input,
        view_state=paused_view_state,
    )
    resumed = api.resume_session("sess_pause_restore")
    payload = api.get_current_task("sess_pause_restore")

    assert resumed is session
    assert session.ui_state["screen_type"] == "task"
    assert session.ui_state["user_input"] == paused_user_input
    assert session.ui_state["view_state"] == paused_view_state
    assert "evaluation_result" not in session.ui_state
    assert payload["restored_user_input"] == paused_user_input
    assert payload["restored_view_state"] == paused_view_state
    assert payload["restored_evaluation_result"] is None


def test_get_current_task_ignores_stale_ui_state_for_later_retry_slot() -> None:
    task_ref = "m/t/task_retry"
    other_task_ref = "m/t/task_other"
    task_data_full = {
        "task_data": {
            "type": "sequence_assembly",
            "content": {
                "prompt": "Prompt",
                "elements": [],
                "levels": [],
                "settings": {},
            },
        },
        "answer_key": {},
        "task_dir": None,
    }

    session = DummySession(session_id="sess_retry_state", iteration=1)
    session.queue = [
        DummyQueuedTask(task_ref, difficulty=1),
        DummyQueuedTask(other_task_ref, difficulty=1),
        DummyQueuedTask(task_ref, difficulty=1),
    ]
    session.queue[2].is_retry = True
    session.current_task_index = 3
    session.ui_state = {
        "screen_type": "task_results",
        "task_ref": task_ref,
        "task_index": 0,
        "user_input": {"answer": "stale"},
        "view_state": {"scrollTop": 120},
        "evaluation_result": {"success": False, "message": "Old result"},
    }

    controller = DummyController("sess_retry_state", task_ref)
    api = SessionAPI(
        controller,
        DummyAdaptiveSessionManager(session),
        DummyComplexService(),
        DummyStorageService(task_data_full),
        statistics_service=MagicMock(),
    )

    payload = api.get_current_task("sess_retry_state")

    assert payload["queue"]["index"] == 2
    assert payload["is_retry"] is True
    assert payload["restored_user_input"] is None
    assert payload["restored_view_state"] is None
    assert payload["restored_evaluation_result"] is None


def test_get_current_task_ignores_stale_ui_state_from_previous_iteration() -> None:
    task_ref = "m/t/task_prev_iteration"
    task_data_full = {
        "task_data": {
            "type": "test",
            "content": {
                "questions": [],
            },
        },
        "answer_key": {},
        "task_dir": None,
    }

    session = DummySession(session_id="sess_prev_iteration_state", iteration=2)
    session.queue = [DummyQueuedTask(task_ref, difficulty=1)]
    session.current_task_index = 1
    session.ui_state = {
        "screen_type": "task_results",
        "task_ref": task_ref,
        "task_index": 0,
        "iteration": 1,
        "user_input": {"answer": "old answer from iteration 1"},
        "view_state": {"scrollTop": 120},
        "evaluation_result": {"success": False, "message": "Old result from iteration 1"},
    }

    controller = DummyController("sess_prev_iteration_state", task_ref)
    api = SessionAPI(
        controller,
        DummyAdaptiveSessionManager(session),
        DummyComplexService(),
        DummyStorageService(task_data_full),
        statistics_service=MagicMock(),
    )

    payload = api.get_current_task("sess_prev_iteration_state")

    assert payload["iteration"] == 2
    assert payload["restored_user_input"] is None
    assert payload["restored_view_state"] is None
    assert payload["restored_evaluation_result"] is None


def test_get_current_task_does_not_restore_previous_result_for_retry_copy() -> None:
    task_ref = "m/t/task_retry_result"
    other_task_ref = "m/t/task_other"
    task_data_full = {
        "task_data": {
            "type": "test",
            "content": {
                "questions": [],
            },
        },
        "answer_key": {},
        "task_dir": None,
    }

    session = DummySession(session_id="sess_retry_result", iteration=1)
    session.queue = [
        DummyQueuedTask(task_ref, difficulty=1),
        DummyQueuedTask(other_task_ref, difficulty=1),
        DummyQueuedTask(task_ref, difficulty=1),
    ]
    session.queue[2].is_retry = True
    session.current_task_index = 3
    session.completed_tasks = [
        SessionTaskResult(
            task_ref=task_ref,
            success=False,
            time_spent=12,
            difficulty=1,
            iteration_index=1,
            score=0.0,
            details={"source": "first_attempt"},
        )
    ]

    controller = DummyController("sess_retry_result", task_ref)
    api = SessionAPI(
        controller,
        DummyAdaptiveSessionManager(session),
        DummyComplexService(),
        DummyStorageService(task_data_full),
        statistics_service=MagicMock(),
    )

    payload = api.get_current_task("sess_retry_result")

    assert payload["queue"]["index"] == 2
    assert payload["is_retry"] is True
    assert payload["restored_evaluation_result"] is None


def test_save_task_ui_state_persists_active_task_snapshot() -> None:
    task_ref = "m/t/task_autosave"
    task_data_full = {
        "task_data": {
            "type": "open_answer",
            "content": {
                "prompt": "Prompt",
            },
        },
        "answer_key": {},
        "task_dir": None,
    }

    session = DummySession(session_id="sess_autosave", iteration=1)
    session.queue = [DummyQueuedTask(task_ref, difficulty=1)]
    session.current_task_index = 1

    controller = MagicMock()
    controller.current_session_id = None
    controller.current_task_ref = None
    controller.task_controller = None
    controller.save_ui_state = MagicMock()

    api = SessionAPI(
        controller,
        DummyAdaptiveSessionManager(session),
        DummyComplexService(),
        DummyStorageService(task_data_full),
        statistics_service=MagicMock(),
    )

    result = api.save_task_ui_state(
        "sess_autosave",
        task_ref=task_ref,
        task_index=0,
        user_input={"answer": "draft"},
        view_state={"scrollTop": 16},
    )

    assert result["ok"] is True
    controller.save_ui_state.assert_called_once()
    call_args = controller.save_ui_state.call_args
    assert call_args.args[0] == "task"
    assert call_args.kwargs["task_ref"] == task_ref
    assert call_args.kwargs["task_index"] == 0
    assert call_args.kwargs["user_input"] == {"answer": "draft"}
    assert call_args.kwargs["view_state"] == {"scrollTop": 16}


def test_save_task_ui_state_rejects_stale_task_snapshot() -> None:
    stale_task_ref = "m/t/task_old"
    active_task_ref = "m/t/task_new"
    task_data_full = {
        "task_data": {
            "type": "open_answer",
            "content": {
                "prompt": "Prompt",
            },
        },
        "answer_key": {},
        "task_dir": None,
    }

    session = DummySession(session_id="sess_stale_autosave", iteration=1)
    session.queue = [
        DummyQueuedTask(stale_task_ref, difficulty=1),
        DummyQueuedTask(active_task_ref, difficulty=1),
    ]
    session.current_task_index = 2

    controller = MagicMock()
    controller.current_session_id = None
    controller.current_task_ref = None
    controller.task_controller = None
    controller.save_ui_state = MagicMock()

    api = SessionAPI(
        controller,
        DummyAdaptiveSessionManager(session),
        DummyComplexService(),
        DummyStorageService(task_data_full),
        statistics_service=MagicMock(),
    )

    result = api.save_task_ui_state(
        "sess_stale_autosave",
        task_ref=stale_task_ref,
        task_index=0,
        user_input={"answer": "outdated"},
    )

    assert result["ok"] is False
    assert result["error"] == "stale_task"
    assert result["active_task_ref"] == active_task_ref
    assert result["active_task_index"] == 1
    controller.save_ui_state.assert_not_called()


def test_enrich_task_data_uses_canonical_asset_content_url() -> None:
    task_data_full = {
        "task_data": {
            "type": "test",
            "content": {
                "questions": [
                    {
                        "id": "q_asset",
                        "text": "Pick the image",
                        "image_asset_id": "asset_question_1",
                        "answers": [
                            {"text": "", "image_asset_id": "asset_answer_1", "correct": True},
                        ],
                    }
                ],
            },
        },
        "answer_key": {},
        "task_dir": None,
    }

    api = _make_api(task_data_full)
    task_data = task_data_full["task_data"]
    api._enrich_task_data_for_web(task_data, None)

    question = task_data["content"]["questions"][0]
    answer = question["answers"][0]

    assert question["image_url"] == "/api/assets/asset_question_1/content"
    assert answer["image_url"] == "/api/assets/asset_answer_1/content"


def test_enrich_task_data_preserves_three_question_image_refs() -> None:
    task_data_full = {
        "task_data": {
            "type": "test",
            "content": {
                "questions": [
                    {
                        "id": "q_multi_asset",
                        "text": "Compare the images",
                        "images": [
                            {"asset_id": "asset_question_1", "path": "legacy/one.png"},
                            {"asset_url": "/api/assets/asset_question_2/content"},
                            "legacy/question-three.png",
                            {"asset_id": "asset_question_4"},
                        ],
                        "answers": [
                            {"text": "A", "correct": True},
                            {"text": "B", "correct": False},
                        ],
                    }
                ],
            },
        },
        "answer_key": {},
        "task_dir": None,
    }

    api = _make_api(task_data_full)
    task_data = task_data_full["task_data"]
    api._enrich_task_data_for_web(task_data, None)

    question = task_data["content"]["questions"][0]

    assert question["image_url"] == "/api/assets/asset_question_1/content"
    assert question["image_asset_id"] == "asset_question_1"
    assert question["images"] == [
        {
            "path": "legacy/one.png",
            "asset_id": "asset_question_1",
            "asset_url": "/api/assets/asset_question_1/content",
        },
        {"asset_url": "/api/assets/asset_question_2/content"},
        {"path": "legacy/question-three.png"},
    ]


def test_enrich_task_data_prefers_asset_refs_over_legacy_image_path() -> None:
    task_data_full = {
        "task_data": {
            "type": "test",
            "content": {
                "questions": [
                    {
                        "id": "q_asset_and_path",
                        "text": "Pick the image",
                        "image_asset_id": "asset_question_2",
                        "image_path": "legacy/question.png",
                        "answers": [
                            {
                                "text": "",
                                "image_asset_id": "asset_answer_2",
                                "image_path": "legacy/answer.png",
                                "correct": True,
                            },
                        ],
                    }
                ],
            },
        },
        "answer_key": {},
        "task_dir": None,
    }

    api = _make_api(task_data_full)
    task_data = task_data_full["task_data"]
    api._enrich_task_data_for_web(task_data, None)

    question = task_data["content"]["questions"][0]
    answer = question["answers"][0]

    assert question["image_url"] == "/api/assets/asset_question_2/content"
    assert answer["image_url"] == "/api/assets/asset_answer_2/content"


def test_enrich_click_task_promotes_canonical_image_url_into_content_image() -> None:
    task_data_full = {
        "task_data": {
            "type": "click",
            "content": {
                "prompt": "Click the image",
                "image_asset_id": "asset_click_1",
            },
        },
        "answer_key": {},
        "task_dir": None,
    }

    api = _make_api(task_data_full)
    task_data = task_data_full["task_data"]
    api._enrich_task_data_for_web(task_data, None)

    assert task_data["image_url"] == "/api/assets/asset_click_1/content"
    assert task_data["image"] == "/api/assets/asset_click_1/content"
    assert task_data["content"]["image_url"] == "/api/assets/asset_click_1/content"
    assert task_data["content"]["image"] == "/api/assets/asset_click_1/content"


def test_enrich_click_task_converts_local_image_asset_bridge_into_canonical_asset_url(
    monkeypatch,
) -> None:
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")

    task_data_full = {
        "task_data": {
            "type": "click",
            "content": {
                "prompt": "Click the image",
                "image": "/api/local-image?asset_id=asset_click_bridge",
            },
        },
        "answer_key": {},
        "task_dir": None,
    }

    api = _make_api(task_data_full)
    task_data = task_data_full["task_data"]
    api._enrich_task_data_for_web(task_data, None)

    assert task_data["image_url"] == "/api/assets/asset_click_bridge/content"
    assert task_data["image"] == "/api/assets/asset_click_bridge/content"
    assert task_data["content"]["image_url"] == "/api/assets/asset_click_bridge/content"
    assert task_data["content"]["image"] == "/api/assets/asset_click_bridge/content"


def test_enrich_task_data_hosted_strips_path_only_media_refs(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")

    task_data_full = {
        "task_data": {
            "type": "test",
            "content": {
                "questions": [
                    {
                        "id": "q_path_only",
                        "text": "Hosted question",
                        "image_path": "legacy/question.png",
                        "answers": [
                            {
                                "text": "",
                                "image_path": "legacy/answer.png",
                                "correct": True,
                            },
                        ],
                    }
                ],
            },
        },
        "answer_key": {},
        "task_dir": str(tmp_path),
    }

    api = _make_api(task_data_full)
    task_data = task_data_full["task_data"]
    api._enrich_task_data_for_web(task_data, str(tmp_path))

    question = task_data["content"]["questions"][0]
    answer = question["answers"][0]

    assert "image_url" not in question
    assert "image_path" not in question
    assert "image_url" not in answer
    assert "image_path" not in answer
