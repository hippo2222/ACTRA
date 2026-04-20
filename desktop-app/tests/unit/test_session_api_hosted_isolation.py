import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock


ROOT_DIR = Path(__file__).resolve().parents[3]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from api.session_api import SessionAPI  # type: ignore
from task_system.core.models.complex_models import ComplexSession, QueuedTask


class DummyTaskController:
    def __init__(
        self,
        evaluator_service=None,
        progress_service=None,
        session_manager=None,
        difficulty_manager=None,
    ) -> None:
        self.evaluator_service = evaluator_service if evaluator_service is not None else object()
        self.progress_service = progress_service if progress_service is not None else object()
        self.session_manager = session_manager
        self.difficulty_manager = difficulty_manager
        self.current_task = type("Task", (), {"full_id": None})()

    def clear_task(self) -> None:
        self.current_task = type("Task", (), {"full_id": None})()


class DummyController:
    _sequence = 0

    def __init__(self, session_manager, task_controller, storage_service, complex_service) -> None:
        self.session_manager = session_manager
        self.task_controller = task_controller
        self.storage_service = storage_service
        self.complex_service = complex_service
        self.current_session_id = None
        self.current_task_ref = None
        self.on_task_changed = None
        self.on_session_completed = None
        self.on_iteration_completed = None
        self.on_complex_completed = None
        self.on_error = None

    def start_session(self, complex_id: str, user_id: str, start_iteration: int = 1) -> bool:
        type(self)._sequence += 1
        session_id = f"{user_id}-{complex_id}-{type(self)._sequence}"
        task_ref = f"module/topic/{complex_id}-task"
        self.current_session_id = session_id
        self.current_task_ref = task_ref

        self.session_manager.sessions[session_id] = ComplexSession(
            id=session_id,
            complex_id=complex_id,
            user_id=user_id,
            start_time=datetime.utcnow(),
            iteration=start_iteration,
            current_task_index=1,
            queue=[
                QueuedTask(
                    task_ref=task_ref,
                    difficulty=1,
                    is_retry=False,
                    origin_iteration=None,
                )
            ],
            completed_tasks=[],
            is_active=True,
        )
        return True

    def get_current_session_stats(self):
        return {}


class DummySessionManager:
    def __init__(self) -> None:
        self.sessions = {}
        self.session_repository = None

    def get_session(self, session_id: str):
        return self.sessions.get(session_id)

    def cancel_session(self, session_id: str, user_id: str = None):
        session = self.sessions.get(session_id)
        if session is None:
            return False
        session.is_active = False
        return True


class DummyComplexService:
    def get_complex(self, complex_id: str):
        return object()


def _make_api() -> SessionAPI:
    session_manager = DummySessionManager()
    prototype_controller = DummyController(
        session_manager=session_manager,
        task_controller=DummyTaskController(),
        storage_service=MagicMock(),
        complex_service=DummyComplexService(),
    )
    return SessionAPI(
        session_controller=prototype_controller,
        adaptive_session_manager=session_manager,
        complex_service=DummyComplexService(),
        storage_service=MagicMock(),
        statistics_service=MagicMock(),
        default_user_id="default-user",
    )


def test_hosted_runtime_uses_distinct_controllers_per_session(monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    api = _make_api()

    first = api.start_session("complex-a", user_id="user-a")
    second = api.start_session("complex-b", user_id="user-b")

    first_controller = api._hosted_session_controllers[first["session_id"]]
    second_controller = api._hosted_session_controllers[second["session_id"]]

    assert first["ok"] is True
    assert second["ok"] is True
    assert first_controller is not second_controller
    assert first_controller is not api._controller_prototype
    assert second_controller is not api._controller_prototype
    assert first_controller.current_session_id == first["session_id"]
    assert second_controller.current_session_id == second["session_id"]


def test_cancel_session_releases_hosted_controller(monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    api = _make_api()

    started = api.start_session("complex-a", user_id="user-a")
    session_id = started["session_id"]

    assert session_id in api._hosted_session_controllers

    result = api.cancel_session(session_id, user_id="user-a")

    assert result == {"ok": True}
    assert session_id not in api._hosted_session_controllers
