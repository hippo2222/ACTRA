import sys
from pathlib import Path
from unittest.mock import MagicMock

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from api.session_api import SessionAPI  # type: ignore


class EvalResult:
    def __init__(self, success: bool = True):
        self.success = success
        self.score = 1.0
        self.details = {"time_spent": 1}


class DummyTaskController:
    def __init__(self):
        self.current_task = type("Task", (), {"full_id": None})

    def load_task(self, *args, **kwargs):  # pragma: no cover - not used in these tests
        pass

    def is_task_loaded(self):
        return bool(getattr(self.current_task, "full_id", None))

    def submit_answer(self, user_input):  # pragma: no cover - stubbed by controller wrapper
        return EvalResult()

    def clear_task(self):  # pragma: no cover
        self.current_task = type("Task", (), {"full_id": None})


class DummyController:
    def __init__(self):
        self.current_session_id = None
        self.current_task_ref = None
        self.task_controller = DummyTaskController()

    def _load_current_task(self):
        # Sync TaskController with the current task_ref
        self.task_controller.current_task.full_id = self.current_task_ref

    def submit_answer(self, user_input):
        return EvalResult()

    def next_task(self):  # pragma: no cover
        pass


class DummySession:
    def __init__(self, session_id: str, queue, current_task_index: int = 0, complex_id: str = "daily_mix"):
        self.id = session_id
        self.user_id = "test_user"
        self.queue = queue
        self.current_task_index = current_task_index
        self.complex_id = complex_id
        self.iteration = 1
        self.is_active = True
        self.completed_tasks = []
        self.paused = False
        self.paused_at = None


class DummySessionManager:
    def __init__(self, session):
        self._session = session
        self.session_repository = DummySessionRepository(self)
        self._active_sessions = {}

    def get_session(self, session_id: str):
        if session_id in self._active_sessions:
            return self._active_sessions[session_id]
        return self._session if self._session and self._session.id == session_id else None

    def resume_session(self, session_id: str, user_id: str):  # pragma: no cover
        return self.get_session(session_id)

    def submit_result(self, session_id: str, result: dict):  # pragma: no cover
        return type("SessionResult", (), {"success": result.get("success", True)})

    def save_session(self, session, user_id: str = "default_user"):  # pragma: no cover
        self._session = session
        self._active_sessions[session.id] = session


class DummySessionRepository:
    def __init__(self, manager: DummySessionManager):
        self.manager = manager

    def save_session(self, session, user_id: str = "default_user"):
        self.manager.save_session(session, user_id)


class DummyComplexService:
    def get_complex(self, complex_id):  # pragma: no cover
        return None


class DummyStorageService:
    def __init__(self, task_data_full):
        self._task_data_full = task_data_full

    def load_task(self, module_id: str, topic_id: str, task_id: str):
        return self._task_data_full


def _make_api_with_queue(task_ref: str):
    session = DummySession(
        "sess",
        queue=[
            type(
                "Queued",
                (),
                {
                    "task_ref": task_ref,
                    "difficulty": 1,
                    "is_retry": False,
                    "origin_iteration": None,
                },
            )
        ],
        current_task_index=1,
    )
    controller = DummyController()
    storage = DummyStorageService(
        {
            "task_data": {"type": "test", "content": {"prompt": "p"}},
            "answer_key": {},
            "task_dir": None,
        }
    )
    api = SessionAPI(
        controller,
        DummySessionManager(session),
        DummyComplexService(),
        storage,
        statistics_service=MagicMock(),
    )
    return api, controller


def test_submit_answer_recovers_task_ref_from_queue_daily_mix():
    task_ref = "m/t/task1"
    api, controller = _make_api_with_queue(task_ref)

    result = api.submit_answer("sess", "task1", {"mode": "text_errors"})

    assert result is not None
    assert controller.current_task_ref == task_ref
    assert controller.task_controller.current_task.full_id == task_ref


def test_submit_answer_web_fallback_uses_get_current_task_when_no_queue():
    task_ref = "m/t/task2"
    # Empty queue forces fallback chain to reach the new web fallback
    session = DummySession("sess", queue=[], current_task_index=0)
    controller = DummyController()
    storage = DummyStorageService(
        {
            "task_data": {"type": "test", "content": {"prompt": "p"}},
            "answer_key": {},
            "task_dir": None,
        }
    )
    api = SessionAPI(
        controller,
        DummySessionManager(session),
        DummyComplexService(),
        storage,
        statistics_service=MagicMock(),
    )

    # Force get_current_task to return a task_ref even when queue is empty
    def fake_get_current_task(session_id: str, auto_resume: bool = False):
        return {
            "task_ref": task_ref,
            "module_id": "m",
            "topic_id": "t",
            "task_id": "task2",
            "task_data": {"type": "test", "content": {"prompt": "p"}},
            "answer_key": {},
            "queue": {"index": 0, "total": 1},
        }

    api.get_current_task = fake_get_current_task  # type: ignore

    result = api.submit_answer("sess", "task2", {"mode": "text_errors"})

    assert result is not None
    assert controller.current_task_ref == task_ref
    assert controller.task_controller.current_task.full_id == task_ref


def test_submit_answer_aligns_controller_for_second_task():
    """Regression: second daily_mix task must load into controller before submit."""
    task_ref1 = "m/t/task1"
    task_ref2 = "m/t/task2"
    queue = [
        type("Queued", (), {"task_ref": task_ref1, "difficulty": 1, "is_retry": False, "origin_iteration": None}),
        type("Queued", (), {"task_ref": task_ref2, "difficulty": 1, "is_retry": False, "origin_iteration": None}),
    ]
    session = DummySession("sess", queue=queue, current_task_index=1)
    controller = DummyController()
    storage = DummyStorageService(
        {
            "task_data": {"type": "test", "content": {"prompt": "p"}},
            "answer_key": {},
            "task_dir": None,
        }
    )
    api = SessionAPI(
        controller,
        DummySessionManager(session),
        DummyComplexService(),
        storage,
        statistics_service=MagicMock(),
    )

    # Controller has no current_task_ref/task loaded; submit second task by task_id
    result = api.submit_answer("sess", "task2", {"mode": "text_choice", "selected_option_id": "opt"})

    assert result is not None
    assert controller.current_task_ref == task_ref2
    assert controller.task_controller.current_task.full_id == task_ref2


def test_start_custom_session_starts_from_first_task():
    """Ensure daily_mix session keeps current_task_index at 0 after first load."""
    # Arrange: two tasks, expect index remains 0 after start_custom_session
    controller = DummyController()
    storage = DummyStorageService(
        {
            "task_data": {"type": "test", "content": {"prompt": "p"}},
            "answer_key": {},
            "task_dir": None,
        }
    )
    session_manager = DummySessionManager(None)
    api = SessionAPI(
        controller,
        session_manager,
        DummyComplexService(),
        storage,
        statistics_service=MagicMock(),
    )

    res = api.start_custom_session(["m/t/task1", "m/t/task2"])
    session = session_manager._session

    assert res["ok"] is True
    assert session.current_task_index == 0
    # Controller may stay None in this dummy; important part: index not advanced


def test_daily_mix_does_not_finish_after_first_task_submit():
    """Regression: daily_mix must continue to second task, not finish after first submit."""
    task_ref1 = "m/t/task1"
    task_ref2 = "m/t/task2"
    queue = [
        type("Queued", (), {"task_ref": task_ref1, "difficulty": 1, "is_retry": False, "origin_iteration": None}),
        type("Queued", (), {"task_ref": task_ref2, "difficulty": 1, "is_retry": False, "origin_iteration": None}),
    ]
    session = DummySession("sess", queue=queue, current_task_index=0)
    controller = DummyController()
    storage = DummyStorageService(
        {
            "task_data": {"type": "test", "content": {"prompt": "p"}},
            "answer_key": {},
            "task_dir": None,
        }
    )
    session_manager = DummySessionManager(session)
    api = SessionAPI(
        controller,
        session_manager,
        DummyComplexService(),
        storage,
        statistics_service=MagicMock(),
    )

    # Submit first task
    result1 = api.submit_answer("sess", "task1", {"mode": "text_errors"})
    assert result1 is not None
    assert session.current_task_index == 0  # submit_result will advance later; here still 0

    # Simulate manager advancing index (submit_result normally does this)
    session.current_task_index = 1
    # Load next task
    api._controller.current_session_id = "sess"
    api._controller.current_task_ref = task_ref2
    api._controller._load_current_task()

    # Now submit second task should succeed (not treated as session complete)
    result2 = api.submit_answer("sess", "task2", {"mode": "text_errors"})
    assert result2 is not None
