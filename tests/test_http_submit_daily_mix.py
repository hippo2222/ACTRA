import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

# Import after sys.path tweak
import server  # type: ignore


class _DummySession:
    def __init__(self, session_id: str):
        self.id = session_id
        self.paused = False
        self.complex_id = "daily_mix"


class _DummyResult:
    def __init__(self, success: bool = True):
        self.success = success
        self.score = 1.0
        self.details = {"time_spent": 1}


class _DummySessionAPI:
    def __init__(self):
        self.last_submit = None

    def next_task(self, session_id: str):
        return {"ok": False, "error": "session_completed"}

    def get_session(self, session_id: str):
        return _DummySession(session_id)

    def get_current_task(self, session_id: str, auto_resume: bool = False):
        return {
            "task_ref": "m/t/task1",
            "task_data": {"type": "test", "content": {"prompt": "p"}},
            "queue": {"index": 0, "total": 1},
        }

    def submit_answer(self, session_id: str, task_id: str, user_input):
        self.last_submit = {"session_id": session_id, "task_id": task_id, "user_input": user_input}
        return _DummyResult(success=True)

    def _serialize_evaluation_result(self, result_obj, session_id: str, task_ref: str):
        return {"success": bool(getattr(result_obj, "success", False)), "details": {"time_spent": 1}}


class _MockAppContext:
    """Mock AppContextHeadless for testing."""
    def __init__(self, session_api):
        self.session_api = session_api
        self.user_id = "test_user"


@pytest.fixture(autouse=True)
def _patch_server(monkeypatch):
    dummy_api = _DummySessionAPI()
    # After refactoring, routes use context via routes._context
    import routes._context as ctx_module
    mock_ctx = _MockAppContext(dummy_api)
    monkeypatch.setattr(ctx_module, "_app_ctx", mock_ctx)
    monkeypatch.setattr(ctx_module, "_extra", {"calendar_service": None})
    return dummy_api


def test_submit_route_accepts_daily_mix_payload(client):
    payload = {"task_id": "task1", "user_input": {"mode": "text_errors", "selected_indices": [0]}}
    res = client.post("/api/session/sess/task/submit", json=payload)
    assert res.status_code == 200, res.get_json()
    data = res.get_json()
    assert data["ok"] is True
    assert data["result"]["success"] is True


def test_next_task_returns_session_completed(client):
    res = client.post("/api/session/sess/task/next")
    assert res.status_code == 410
    data = res.get_json()
    assert data == {"ok": False, "error": "session_completed"}


@pytest.fixture
def client():
    with server.app.test_client() as c:
        yield c
