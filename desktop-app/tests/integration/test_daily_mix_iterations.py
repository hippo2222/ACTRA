"""
Integration-style test for daily_mix multi-iteration using pure fakes (no real services imports).
"""

import sys
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from task_system.core.models.complex_models import Complex, ComplexSession, QueuedTask, SessionTaskResult

# Local fakes to avoid importing desktop-app services in this test
class FakeComplexService:
    def __init__(self, complex_map):
        self._map = complex_map
    def get_complex(self, complex_id: str):
        return self._map.get(complex_id)

class FakeSessionRepository:
    def __init__(self):
        self.saved = {}
    def save_session(self, session: ComplexSession, user_id: str) -> bool:
        self.saved[session.id] = session.copy(deep=True)
        return True

class FakeStorageService:
    def __init__(self, payload):
        self._payload = payload
    def load_task(self, module_id: str, topic_id: str, task_id: str):
        key = f"{module_id}/{topic_id}/{task_id}"
        return self._payload[key]

class FakeDifficultyManager:
    def get_available_levels(self, task_type: str, task_ref: str):
        return [1]

class FakeTaskController:
    def __init__(self):
        self.current_task = None
    def clear_task(self):
        self.current_task = None
    def is_task_loaded(self):
        return True
    def load_task(self, *args, **kwargs):
        self.current_task = SimpleNamespace(full_id=kwargs.get("task_id"), task_id=kwargs.get("task_id"))

class FakeAdaptiveSessionManager:
    def __init__(self, complex_service, storage_service, session_repository, difficulty_manager):
        self.complex_service = complex_service
        self.storage_service = storage_service
        self.session_repository = session_repository
        self.difficulty_manager = difficulty_manager
        self._active_sessions = {}
        self.generated = False
    def get_session(self, session_id):
        return self._active_sessions.get(session_id)
    def _generate_next_iteration(self, session: ComplexSession, complex_obj: Complex):
        self.generated = True
        session.iteration += 1
        session.queue = [QueuedTask(task_ref="new/module/topic/task", difficulty=1, is_retry=False, origin_iteration=session.iteration)]
        session.current_task_index = 0
    def get_next_task(self, session_id):
        # not used in this test
        return None
    def submit_result(self, *args, **kwargs):
        return SimpleNamespace(success=True)
    def skip_task(self, *args, **kwargs):
        return None
    def get_iteration_summary(self, session_id: str, iteration: int):
        return SimpleNamespace(iteration=iteration, total_tasks=1, successful_tasks=1, failed_tasks=0, success_rate=1.0)

from logic.complex_session_controller import ComplexSessionController

class StubController(ComplexSessionController):
    def clear_ui_state(self): return None
    def restore_ui_state(self): return None
    def save_ui_state(self, *args, **kwargs): return None


@pytest.fixture()
def daily_mix_iter_env():
    task_refs = ["mod/topic/task1", "mod/topic/task2"]
    storage_payload = {
        "mod/topic/task1": {"task_data": {"type": "test", "content": {}}, "answer_key": {}},
        "mod/topic/task2": {"task_data": {"type": "test", "content": {}}, "answer_key": {}},
        "new/module/topic/task": {"task_data": {"type": "test", "content": {}}, "answer_key": {}},
    }
    complex_obj = Complex(id="daily_mix", name="Daily Mix", description="Synthetic", tasks=task_refs)
    complex_service = FakeComplexService({"daily_mix": complex_obj})
    repo = FakeSessionRepository()
    storage = FakeStorageService(storage_payload)
    difficulty = FakeDifficultyManager()
    manager = FakeAdaptiveSessionManager(complex_service=complex_service, storage_service=storage, session_repository=repo, difficulty_manager=difficulty)
    task_controller = FakeTaskController()
    controller = StubController(session_manager=manager, task_controller=task_controller, storage_service=storage, complex_service=complex_service)
    controller.current_session_id = "s1"
    return task_refs, manager, controller


def test_daily_mix_completes_when_queue_exhausted(daily_mix_iter_env):
    """daily_mix — простая линейная очередь без генерации итераций.
    Когда current_task_index >= len(queue), сессия завершается."""
    task_refs, manager, controller = daily_mix_iter_env

    session = ComplexSession(
        id="s1",
        complex_id="daily_mix",
        user_id="u1",
        start_time=datetime.utcnow(),
        iteration=1,
        current_task_index=2,
        queue=[
            QueuedTask(task_ref=task_refs[0], difficulty=1, is_retry=False, origin_iteration=1),
            QueuedTask(task_ref=task_refs[1], difficulty=1, is_retry=False, origin_iteration=1),
        ],
        completed_tasks=[
            SessionTaskResult(task_ref=task_refs[0], success=True, time_spent=1, difficulty=1, iteration_index=1),
            SessionTaskResult(task_ref=task_refs[1], success=True, time_spent=1, difficulty=1, iteration_index=1),
        ],
        skip_counts={},
        is_active=True,
    )
    manager._active_sessions["s1"] = session

    completed_flag = {"called": False}
    controller.on_session_completed = lambda s: completed_flag.__setitem__("called", True)
    controller.on_iteration_completed = lambda summary: None

    controller._load_next_task()

    # daily_mix не генерирует следующую итерацию — просто завершается
    assert manager.generated is False
    assert controller.current_session_id is None  # сброшен после завершения
    assert controller.current_task_ref is None
