import sys
from pathlib import Path
from unittest.mock import MagicMock

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from api.session_api import SessionAPI  # type: ignore


class DummyController:
    def __init__(self) -> None:
        self.current_session_id = None
        self.captured_user_id = None

    def start_session(self, complex_id: str, user_id: str, start_iteration: int = 1) -> bool:
        self.captured_user_id = user_id
        self.current_session_id = "session-default-user"
        return True

    def get_current_session_stats(self):
        return {}


class DummySession:
    def __init__(self, user_id: str) -> None:
        self.user_id = user_id
        self.iteration = 1
        self.complex_id = "complex-x"
        self.queue = []
        self.current_task_index = 0


class DummySessionManager:
    def __init__(self, controller: DummyController) -> None:
        self.controller = controller

    def get_session(self, session_id: str):
        return DummySession(self.controller.captured_user_id or "unknown")


def test_session_api_default_user_id_setter_updates_internal_default():
    controller = DummyController()
    api = SessionAPI(
        controller,
        DummySessionManager(controller),
        MagicMock(),
        MagicMock(),
        statistics_service=MagicMock(),
        default_user_id="user_initial",
    )

    assert api.default_user_id == "user_initial"

    api.default_user_id = "user_switched"
    result = api.start_session("complex-x")

    assert api.default_user_id == "user_switched"
    assert controller.captured_user_id == "user_switched"
    assert result["ok"] is True
    assert result["user_id"] == "user_switched"
