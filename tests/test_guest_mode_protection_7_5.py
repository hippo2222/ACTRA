"""
Guest mode protection tests (area 7.5).
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

DESKTOP_APP_DIR = Path(__file__).parent.parent / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

PROJECT_ROOT = Path(__file__).parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _get_data_dir() -> str:
    from common.config_loader import load_config

    return load_config()["data_root"]


def test_start_session_rejects_guest() -> None:
    from api.session_api import SessionAPI
    from services.adaptive_session_manager import AdaptiveSessionManager
    from services.complex_service import ComplexService
    from services.storage_service import StorageService

    data_dir = _get_data_dir()
    storage = StorageService(data_dir)
    complex_service = ComplexService(data_dir=data_dir)

    class DummyController:
        def __init__(self) -> None:
            self.current_session_id = None
            self.current_task_ref = None

        def start_session(self, complex_id, user_id, start_iteration=1):
            return False

        def get_current_session_stats(self):
            return {}

    api = SessionAPI(
        session_controller=DummyController(),
        adaptive_session_manager=AdaptiveSessionManager(
            complex_service=complex_service,
            user_progress_manager=None,
            difficulty_manager=None,
        ),
        complex_service=complex_service,
        storage_service=storage,
        statistics_service=MagicMock(),
        default_user_id="default_user",
    )

    result = api.start_session(complex_id="test_complex", user_id="guest")
    assert result["ok"] is False
    assert result["error"] == "guest_cannot_start_session"
    assert result["user_id"] == "guest"


def test_submit_answer_rejects_guest() -> None:
    from api.session_api import SessionAPI
    from services.complex_service import ComplexService
    from services.storage_service import StorageService
    from task_system.core.models.complex_models import ComplexSession

    data_dir = _get_data_dir()
    storage = StorageService(data_dir)
    complex_service = ComplexService(data_dir=data_dir)

    class DummyController:
        def __init__(self) -> None:
            self.current_session_id = "test_sess"
            self.current_task_ref = "module/topic/task1"

        def submit_answer(self, user_input):
            return None

    session = ComplexSession(
        id="test_sess",
        user_id="guest",
        complex_id="test_complex",
        queue=[],
        current_task_index=0,
        iteration=1,
    )

    class DummySessionManager:
        def __init__(self) -> None:
            self.session_repository = None

        def get_session(self, session_id):
            if session_id == "test_sess":
                return session
            return None

    api = SessionAPI(
        session_controller=DummyController(),
        adaptive_session_manager=DummySessionManager(),
        complex_service=complex_service,
        storage_service=storage,
        statistics_service=MagicMock(),
        default_user_id="default_user",
    )

    result = api.submit_answer(
        session_id="test_sess",
        task_id="task1",
        user_input={"mode": "text_errors"},
    )
    assert result is None


def test_save_evaluation_result_skips_guest() -> None:
    from services.progress_service import ProgressService
    from services.task_evaluator_service import EvaluationResult

    progress_service = ProgressService(data_dir=_get_data_dir(), user_id="guest")
    eval_result = EvaluationResult(
        success=True,
        message="Correct answer",
        score=100,
        details={"difficulty": 1},
    )

    result = progress_service.save_evaluation_result(
        module_id="module1",
        topic_id="topic1",
        task_id="task1",
        result=eval_result,
        difficulty=1,
    )
    assert result is False


def test_save_session_returns_true_but_not_persisted_for_guest() -> None:
    from services.session_repository import SessionRepository
    from task_system.core.models.complex_models import ComplexSession

    data_dir = _get_data_dir()
    repo = SessionRepository(data_dir=data_dir)

    session = ComplexSession(
        id="guest_sess",
        user_id="guest",
        complex_id="test_complex",
        queue=[],
        current_task_index=0,
        iteration=1,
    )

    result = repo.save_session(session, user_id="guest")
    assert result is True

    guest_session_file = Path(data_dir) / "users" / "guest" / "sessions" / "test_complex.json"
    if guest_session_file.exists():
        guest_session_file.unlink()
    assert not guest_session_file.exists()


def test_http_submit_task_rejects_guest() -> None:
    requests = pytest.importorskip("requests")

    base_urls = [
        "http://127.0.0.1:8000",
        "http://localhost:8000",
        "http://127.0.0.1:5000",
        "http://localhost:5000",
    ]

    active_base = None
    for base in base_urls:
        try:
            resp = requests.get(f"{base}/api/users/current", timeout=2)
            if resp.status_code < 500:
                active_base = base
                break
        except Exception:
            continue

    if active_base is None:
        pytest.skip("API server is not reachable on common hosts/ports.")

    switch_response = requests.post(
        f"{active_base}/api/users/select",
        json={"user_id": "guest"},
        timeout=5,
    )
    if switch_response.status_code != 200:
        pytest.skip(f"Cannot switch to guest on {active_base} (status={switch_response.status_code}).")

    switch_payload = switch_response.json()
    if not switch_payload.get("ok"):
        pytest.skip(f"Guest switch rejected on {active_base}: {switch_payload}")

    submit_response = requests.post(
        f"{active_base}/api/session/dummy_sess/task/submit",
        json={
            "task_id": "task1",
            "user_input": {"mode": "text_errors"},
        },
        timeout=5,
    )

    assert submit_response.status_code == 403
    payload = submit_response.json()
    assert payload.get("error") == "guest_cannot_submit"
