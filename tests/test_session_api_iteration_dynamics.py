import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from unittest.mock import MagicMock

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from api.session_api import SessionAPI  # type: ignore
from task_system.core.models.complex_models import ComplexSession, ExtendedSessionResultSummary, SessionTaskResult


class DummyController:
    current_session_id: Optional[str] = None
    current_task_ref: Optional[str] = None
    task_controller = None


class DummySessionManager:
    def __init__(self, session: ComplexSession, summary: ExtendedSessionResultSummary):
        self._session = session
        self._summary = summary

    def end_session(self, session_id: str):
        if session_id != self._session.id:
            return None
        return self._summary

    def get_session(self, session_id: str):
        if session_id != self._session.id:
            return None
        return self._session


class DummyComplexService:
    def get_complex(self, complex_id: str):  # pragma: no cover
        return None


class DummyStorageService:
    def load_task(self, module_id: str, topic_id: str, task_id: str):  # pragma: no cover
        return {"task_data": {"type": "test"}, "answer_key": {}, "task_dir": None}


class DictOnlySummary:
    def __init__(self, payload):
        self._payload = payload

    def dict(self):
        return dict(self._payload)


def test_final_results_includes_iterations_dynamics_payload():
    now = datetime.utcnow()
    session = ComplexSession(id="sess", complex_id="c1", user_id="u1")
    session.completed_tasks = [
        SessionTaskResult(
            task_ref="m/t/1",
            success=False,
            time_spent=1,
            difficulty=1,
            iteration_index=1,
            timestamp=now,
            details={},
        ),
        SessionTaskResult(
            task_ref="m/t/2",
            success=True,
            time_spent=1,
            difficulty=1,
            iteration_index=1,
            timestamp=now + timedelta(seconds=5),
            details={},
        ),
        SessionTaskResult(
            task_ref="m/t/3",
            success=True,
            time_spent=1,
            difficulty=1,
            iteration_index=2,
            timestamp=now + timedelta(seconds=10),
            details={},
        ),
    ]

    summary = ExtendedSessionResultSummary(
        session_id="sess",
        complex_id="c1",
        user_id="u1",
        start_time=now,
        end_time=now + timedelta(minutes=1),
        total_iterations=2,
        tasks_mastered_count=0,
        tasks_failed_count=1,
        difficulty_progression=[1.0, 1.0],
        total_tasks=3,
        successful_tasks_count=2,
    )

    api = SessionAPI(
        DummyController(),
        DummySessionManager(session, summary),
        DummyComplexService(),
        DummyStorageService(),
        statistics_service=MagicMock(),
    )

    data = api.get_final_results("sess")
    assert isinstance(data, dict)
    assert "iterations" in data

    iterations = data["iterations"]
    assert isinstance(iterations, list)
    assert len(iterations) == 2

    it1 = iterations[0]
    it2 = iterations[1]
    assert it1["iteration"] == 1
    assert it1["total_tasks"] == 2
    assert it1["failed_tasks"] == 1
    assert it1["successful_tasks"] == 1

    assert it2["iteration"] == 2
    assert it2["total_tasks"] == 1
    assert it2["failed_tasks"] == 0
    assert it2["successful_tasks"] == 1


def test_final_results_falls_back_to_single_iteration_for_legacy_results_without_iteration_index():
    now = datetime.utcnow()
    session = ComplexSession(id="sess", complex_id="c1", user_id="u1")
    session.completed_tasks = [
        SessionTaskResult(
            task_ref="m/t/1",
            success=False,
            time_spent=1,
            difficulty=1,
            iteration_index=0,
            timestamp=now,
            details={},
        ),
        SessionTaskResult(
            task_ref="m/t/2",
            success=True,
            time_spent=1,
            difficulty=1,
            iteration_index=0,
            timestamp=now + timedelta(seconds=5),
            details={},
        ),
    ]

    summary = ExtendedSessionResultSummary(
        session_id="sess",
        complex_id="c1",
        user_id="u1",
        start_time=now,
        end_time=now + timedelta(minutes=1),
        total_iterations=1,
        tasks_mastered_count=0,
        tasks_failed_count=1,
        difficulty_progression=[1.0],
        total_tasks=2,
        successful_tasks_count=1,
    )

    api = SessionAPI(
        DummyController(),
        DummySessionManager(session, summary),
        DummyComplexService(),
        DummyStorageService(),
        statistics_service=MagicMock(),
    )

    data = api.get_final_results("sess")
    assert isinstance(data, dict)
    assert "iterations" in data

    iterations = data["iterations"]
    assert isinstance(iterations, list)
    assert len(iterations) == 1
    assert iterations[0]["iteration"] == 1
    assert iterations[0]["total_tasks"] == 2
    assert iterations[0]["failed_tasks"] == 1
    assert iterations[0]["successful_tasks"] == 1


def test_final_results_rebuilds_empty_iterations_and_problem_tasks_payloads():
    now = datetime.utcnow()
    session = ComplexSession(id="sess", complex_id="c1", user_id="u1")
    session.completed_tasks = [
        SessionTaskResult(
            task_ref="m/t/1",
            success=False,
            time_spent=1,
            difficulty=1,
            iteration_index=1,
            timestamp=now,
            details={},
        ),
        SessionTaskResult(
            task_ref="m/t/2",
            success=True,
            time_spent=1,
            difficulty=1,
            iteration_index=2,
            timestamp=now + timedelta(seconds=5),
            details={},
        ),
    ]

    summary = DictOnlySummary(
        {
            "session_id": "sess",
            "complex_id": "c1",
            "user_id": "u1",
            "start_time": now,
            "end_time": now + timedelta(minutes=1),
            "total_iterations": 2,
            "tasks_mastered_count": 0,
            "tasks_failed_count": 1,
            "difficulty_progression": [1.0, 1.0],
            "total_tasks": 2,
            "successful_tasks_count": 1,
            "iterations": [],
            "problem_tasks": [],
        }
    )

    api = SessionAPI(
        DummyController(),
        DummySessionManager(session, summary),
        DummyComplexService(),
        DummyStorageService(),
        statistics_service=MagicMock(),
    )

    data = api.get_final_results("sess")
    assert isinstance(data, dict)
    assert isinstance(data.get("iterations"), list)
    assert len(data["iterations"]) == 2
    assert isinstance(data.get("problem_tasks"), list)
    assert len(data["problem_tasks"]) == 1
    assert data["problem_tasks"][0]["task_ref"] == "m/t/1"
    assert data["problem_tasks"][0]["errors"] == 1
