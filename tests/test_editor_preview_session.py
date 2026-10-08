import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from api.session_api import SessionAPI  # type: ignore


class DummyTask:
    def __init__(self, full_id=None):
        self.full_id = full_id
        self.task_data = {"_difficulty_level": 1}


class DummyTaskController:
    def __init__(self):
        self.current_task = DummyTask(None)
        self._explicit_difficulty_level = 1

    def load_task(self, module_id, topic_id, task_id, task_data, answer_key):
        self.current_task = DummyTask(f"{module_id}/{topic_id}/{task_id}")

    def is_task_loaded(self):
        return bool(getattr(self.current_task, "full_id", None))


class DummyController:
    def __init__(self):
        self.current_session_id = None
        self.current_task_ref = None
        self.task_controller = DummyTaskController()

    def _load_current_task(self):
        if self.current_task_ref:
            self.task_controller.current_task.full_id = self.current_task_ref


class DummySessionRepo:
    def __init__(self):
        self.sessions = {}

    def save_session(self, session, user_id):
        self.sessions[session.id] = session

    def load_session(self, session_id, user_id=None):
        return self.sessions.get(session_id)

    def load_all_sessions(self, user_id=None):
        return list(self.sessions.values())


class DummySessionManager:
    def __init__(self):
        self._active_sessions = {}
        self.session_repository = DummySessionRepo()

    def get_session(self, session_id):
        return self._active_sessions.get(session_id) or self.session_repository.load_session(session_id)

    def end_session(self, session_id):
        mock_summary = MagicMock()
        mock_summary.complex_id = "task_preview"
        data_dict = {"complex_id": "task_preview", "results": []}
        mock_summary.dict = MagicMock(return_value=data_dict)
        mock_summary.model_dump = MagicMock(return_value=data_dict)
        return mock_summary

    def cancel_session(self, session_id, user_id=None):
        if session_id in self._active_sessions:
            self._active_sessions[session_id].is_active = False
            del self._active_sessions[session_id]
        sess = self.session_repository.load_session(session_id)
        if sess:
            sess.is_active = False
            return True
        return False


class DummyComplexService:
    def __init__(self):
        self._complexes_cache = {}

    def get_complex(self, complex_id):
        return self._complexes_cache.get(complex_id)


class DummyStorageService:
    def __init__(self):
        self.tasks = {
            ("mod1", "top1", "task1"): {
                "task_data": {"id": "task1", "type": "test", "name": "Task 1"},
                "answer_key": {"answer": "A"},
            },
            ("mod2", "top2", "task2"): {
                "task_data": {"id": "task2", "type": "test", "name": "Task 2"},
                "answer_key": {"answer": "B"},
            },
            ("mod3", "top3", "task3"): {
                "task_data": {
                    "id": "task3",
                    "type": "click",
                    "name": "Task 3 (Click)",
                    "settings": {"allowed_difficulties": [3]},
                },
                "answer_key": {},
            },
        }

    def load_task(self, module_id, topic_id, task_id):
        return self.tasks.get((module_id, topic_id, task_id))


@pytest.fixture
def session_api_fixture():
    controller = DummyController()
    session_manager = DummySessionManager()
    complex_service = DummyComplexService()
    storage_service = DummyStorageService()
    statistics_service = MagicMock()

    api = SessionAPI(
        session_controller=controller,
        adaptive_session_manager=session_manager,
        complex_service=complex_service,
        storage_service=storage_service,
        statistics_service=statistics_service,
        default_user_id="user_123",
    )
    return api, controller, session_manager, statistics_service


def test_start_preview_session(session_api_fixture):
    api, controller, manager, _ = session_api_fixture

    res = api.start_preview_session(
        task_refs=["mod1/top1/task1", "mod2/top2/task2"],
        user_id="user_123",
        source_context={"module_id": "mod1", "topic_id": "top1"},
    )

    assert res["ok"] is True
    assert res["complex_id"] == "task_preview"
    assert res["is_preview"] is True
    assert res["queue"]["total"] == 2
    assert res["queue"]["index"] == 0

    session_id = res["session_id"]
    active = api.get_active_preview_session("user_123")
    assert active is not None
    assert active.id == session_id
    assert active.complex_id == "task_preview"
    assert active.is_preview is True
    assert active.source_context == {"module_id": "mod1", "topic_id": "top1"}


def test_preview_session_invalidation(session_api_fixture):
    api, controller, manager, _ = session_api_fixture

    res = api.start_preview_session(
        task_refs=["mod1/top1/task1"],
        user_id="user_123",
    )
    session_id = res["session_id"]
    sess = api.get_session(session_id, user_id="user_123")

    # Simulate UI state and cached task
    controller.task_controller.current_task.full_id = "mod1/top1/task1"
    sess.ui_state = {"task_ref": "mod1/top1/task1", "user_input": {"val": 42}}
    sess.paused = True

    # Invalidate task
    invalidated = api.invalidate_task_preview("mod1/top1/task1", user_id="user_123")
    assert invalidated is True

    # Check that cache was cleared and modified flag set
    assert controller.task_controller.current_task is None
    assert sess.ui_state is None
    assert sess.task_modified is True

    # Invalidate non-existent task
    not_found = api.invalidate_task_preview("other/mod/task", user_id="user_123")
    assert not_found is False


def test_preview_session_restart(session_api_fixture):
    api, controller, manager, _ = session_api_fixture

    res = api.start_preview_session(
        task_refs=["mod1/top1/task1", "mod2/top2/task2"],
        user_id="user_123",
    )
    session_id = res["session_id"]
    sess = api.get_session(session_id, user_id="user_123")

    # Move session forward and mark paused/modified
    sess.current_task_index = 1
    sess.completed_tasks = [{"task_ref": "mod1/top1/task1", "success": True}]
    sess.paused = True
    sess.task_modified = True

    # Restart
    restart_res = api.restart_preview_session(session_id, user_id="user_123")
    assert restart_res["ok"] is True
    assert restart_res["current_task_index"] == 0

    assert sess.current_task_index == 0
    assert len(sess.completed_tasks) == 0
    assert sess.paused is False
    assert sess.task_modified is False


def test_preview_session_statistics_isolation(session_api_fixture):
    api, controller, manager, stats_service = session_api_fixture

    res = api.start_preview_session(
        task_refs=["mod1/top1/task1"],
        user_id="user_123",
    )
    session_id = res["session_id"]
    sess = api.get_session(session_id, user_id="user_123")

    # Mock controller.get_session_summary
    mock_summary = MagicMock()
    mock_summary.complex_id = "task_preview"
    controller.get_session_summary = MagicMock(return_value=mock_summary)

    # Call get_final_results
    with patch.object(api, "_ensure_runtime_complex_available", return_value=True):
        final_res = api.get_final_results(session_id, user_id="user_123")

    # Ensure update_complex_stats was NOT called
    stats_service.update_complex_stats.assert_not_called()
    assert final_res["is_preview"] is True
    assert final_res["complex_id"] == "task_preview"


def test_preview_session_validation_not_found(session_api_fixture):
    api, controller, manager, _ = session_api_fixture

    res = api.start_preview_session(
        task_refs=["non_existent/topic/task"],
        user_id="user_123",
    )
    assert res["ok"] is False
    assert res["error"] == "tasks_not_found"


def test_preview_session_respects_allowed_difficulties(session_api_fixture):
    api, controller, manager, _ = session_api_fixture
    mock_dm = MagicMock()
    mock_dm.get_initial_level.return_value = 3
    controller.task_controller.difficulty_manager = mock_dm

    res = api.start_preview_session(
        task_refs=["mod3/top3/task3"],
        user_id="user_123",
    )
    assert res["ok"] is True
    session_id = res["session_id"]
    sess = api.get_session(session_id, user_id="user_123")
    assert len(sess.queue) == 1
    assert sess.queue[0].difficulty == 3
    mock_dm.get_initial_level.assert_called_once()


def test_preview_session_with_explicit_difficulty(session_api_fixture):
    api, controller, manager, _ = session_api_fixture
    mock_dm = MagicMock()
    mock_dm.get_available_levels.return_value = [2, 3]
    mock_dm.normalize_requested_level.return_value = 2
    controller.task_controller.difficulty_manager = mock_dm

    res = api.start_preview_session(
        task_refs=["mod3/top3/task3"],
        user_id="user_123",
        difficulty=2,
    )
    assert res["ok"] is True
    session_id = res["session_id"]
    sess = api.get_session(session_id, user_id="user_123")
    assert len(sess.queue) == 1
    assert sess.queue[0].difficulty == 2


def test_preview_session_normalizes_invalid_difficulty(session_api_fixture):
    api, controller, manager, _ = session_api_fixture
    mock_dm = MagicMock()
    mock_dm.get_available_levels.return_value = [3]
    mock_dm.normalize_requested_level.return_value = 3
    controller.task_controller.difficulty_manager = mock_dm

    res = api.start_preview_session(
        task_refs=["mod3/top3/task3"],
        user_id="user_123",
        difficulty=1,
    )
    assert res["ok"] is True
    session_id = res["session_id"]
    sess = api.get_session(session_id, user_id="user_123")
    assert len(sess.queue) == 1
    assert sess.queue[0].difficulty == 3

