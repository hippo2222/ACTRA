import sys
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from api.session_api import SessionAPI  # type: ignore
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
