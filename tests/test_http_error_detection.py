import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

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
        self.task_payload = None

    def get_session(self, session_id: str):
        return _DummySession(session_id)

    def get_current_task(self, session_id: str, auto_resume: bool = False):
        # task_payload may be set per test
        return self.task_payload

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
    # Need to patch the global _app_ctx with our mock
    import routes._context as ctx_module
    mock_ctx = _MockAppContext(dummy_api)
    monkeypatch.setattr(ctx_module, "_app_ctx", mock_ctx)
    monkeypatch.setattr(ctx_module, "_extra", {"calendar_service": None})
    return dummy_api


@pytest.fixture
def client():
    with server.app.test_client() as c:
        yield c


def test_error_detection_text_choice_converts_to_spans(client, _patch_server):
    dummy_api = _patch_server
    dummy_api.task_payload = {
        "task_ref": "m/t/task_click",
        "task_data": {
            "type": "click",
            "content": {
                "mode": "text_choice",
                "prompt": "p",
                "reference_spans": [{"start": 0, "end": 5}],
                "error_spans": [{"start": 0, "end": 5}],
            },
        },
        "queue": {"index": 0, "total": 1},
    }

    payload = {
        "task_id": "task_click",
        "user_input": {"mode": "text_choice", "selected_option_id": "opt1", "selected_option_ids": ["opt1"]},
    }
    res = client.post("/api/session/sess/task/submit", json=payload)
    assert res.status_code == 200, res.get_json()
    data = res.get_json()
    assert data["ok"] is True
    # server should have injected spans from reference_spans
    assert dummy_api.last_submit is not None
    spans = dummy_api.last_submit["user_input"].get("spans")
    assert spans == [{"start": 0, "end": 5}]


def test_error_detection_text_errors_payload_passes_validation(client, _patch_server):
    dummy_api = _patch_server
    dummy_api.task_payload = {
        "task_ref": "m/t/task_click_err",
        "task_data": {
            "type": "click",
            "content": {
                "mode": "click",
                "prompt": "p",
                "error_spans": [{"start": 1, "end": 3}],
            },
        },
        "queue": {"index": 0, "total": 1},
    }

    payload = {"task_id": "task_click_err", "user_input": {"mode": "text_errors", "selected_indices": [0]}}
    res = client.post("/api/session/sess/task/submit", json=payload)
    assert res.status_code == 200, res.get_json()
    data = res.get_json()
    assert data["ok"] is True
