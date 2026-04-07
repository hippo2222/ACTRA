import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from services import adaptive_session_manager as asm
from services.adaptive_session_manager import AdaptiveSessionManager
from task_system.core.models.complex_models import Complex, ComplexSettings


class _FakeComplexService:
    def __init__(self, complex_obj: Complex):
        self._complex = complex_obj

    def get_complex(self, complex_id: str) -> Complex:
        return self._complex


class _FakeUserProgressManager:
    def __init__(self) -> None:
        self.saved_attempts: List[Dict[str, Any]] = []

    def save_attempt(self, **kwargs: Any) -> None:  # pragma: no cover - simple recorder
        self.saved_attempts.append(kwargs)


class _FakeDifficultyManager:
    def get_available_levels(self, task_type: str, task_ref: str) -> List[int]:  # pragma: no cover
        return [1, 2]


class _FakeStorageService:
    def __init__(self, task_map: Dict[str, Dict[str, Any]]):
        self._task_map = task_map

    def load_task(self, module_id: str, topic_id: str, task_id: str) -> Dict[str, Any]:
        key = f"{module_id}/{topic_id}/{task_id}"
        if key not in self._task_map:
            raise FileNotFoundError(key)
        return self._task_map[key]


class _InMemorySessionRepository:
    def __init__(self) -> None:
        self.saved: Dict[str, Any] = {}

    def save_session(self, session, user_id: str) -> None:  # pragma: no cover - no-op persistence
        self.saved[session.id] = session.copy(deep=True)

    def delete_session(self, complex_id: str, user_id: str) -> None:  # pragma: no cover
        pass


@pytest.fixture(autouse=True)
def deterministic_random(monkeypatch):
    monkeypatch.setattr(asm.random, "shuffle", lambda seq: None)
    monkeypatch.setattr(asm.random, "randint", lambda a, b: a)
    monkeypatch.setattr(asm.random, "choice", lambda seq: seq[0] if seq else None)


def _make_storage_payload(
    subtype: str | None = None,
    mode: str = "image_click",
) -> Dict[str, Any]:
    content: Dict[str, Any] = {"type": "click", "mode": mode}
    if subtype:
        content["subtype"] = subtype
    return {
        "task_data": {
            "type": "click",
            "content": content,
        },
        "metadata": {"type": "click", **({"subtype": subtype} if subtype else {})},
    }


def test_error_detection_appears_only_after_all_tasks_max(monkeypatch):
    tasks = [
        "module/topic/task_regular_a",
        "module/topic/task_regular_b",
        "module/topic/task_error",
    ]
    complex_obj = Complex(
        id="complex_error_detection",
        name="Error Detection Flow",
        tasks=tasks,
        settings=ComplexSettings(adaptive_difficulty=True, escalation_on_success=True),
    )

    storage_service = _FakeStorageService(
        {
            tasks[0]: _make_storage_payload(),
            tasks[1]: _make_storage_payload(),
            tasks[2]: _make_storage_payload(subtype="error_detection", mode="text_errors"),
        }
    )

    manager = AdaptiveSessionManager(
        complex_service=_FakeComplexService(complex_obj),
        user_progress_manager=_FakeUserProgressManager(),
        difficulty_manager=_FakeDifficultyManager(),
        storage_service=storage_service,
        session_repository=_InMemorySessionRepository(),
    )
    manager._check_task_file_exists = lambda _: True

    session = manager.start_session(complex_obj.id, "user1")
    session_id = session.id

    observed: List[tuple[int, str, int]] = []

    while True:
        task = manager.get_next_task(session_id)
        if not task:
            break
        observed.append((task["iteration"], task["task_ref"], task["difficulty"]))
        manager.submit_result(
            session_id,
            {
                "task_ref": task["task_ref"],
                "success": True,
                "difficulty": task["difficulty"],
                "time_spent": 5,
            },
        )

    # Для этого фикстурного комплекса максимальная сложность обычных заданий = 2,
    # поэтому финальной плановой итерацией становится вторая:
    # 1) обычные задания на стартовой сложности,
    # 2) все задания комплекса на их максимальной сложности, включая error_detection.
    assert len(observed) == 5

    iter1 = [entry for entry in observed if entry[0] == 1]
    iter2 = [entry for entry in observed if entry[0] == 2]

    assert {ref for _, ref, _ in iter1} == {tasks[0], tasks[1]}
    assert all(difficulty == 1 for _, _, difficulty in iter1)

    assert {ref for _, ref, _ in iter2} == set(tasks)
    iter2_by_ref = {ref: difficulty for _, ref, difficulty in iter2}
    assert iter2_by_ref[tasks[0]] == 2
    assert iter2_by_ref[tasks[1]] == 2
    assert iter2_by_ref[tasks[2]] == 2

    # После выполнения финальной полной итерации сессия должна завершиться
    assert manager.get_session(session_id) is None or not session.is_active
    assert not session.error_detection_tasks
    assert getattr(session, "_should_show_final_results", False)


def test_error_detection_words_no_retry_on_success(monkeypatch):
    """
    Проверяем, что text_errors/error_detection задание не дублируется в очередь при успешном прохождении.
    """
    tasks = ["module/topic/task_error"]
    complex_obj = Complex(
        id="complex_error_detection_single",
        name="Error Detection Single",
        tasks=tasks,
        settings=ComplexSettings(adaptive_difficulty=True, escalation_on_success=True),
    )

    storage_service = _FakeStorageService(
        {
            tasks[0]: _make_storage_payload(subtype="error_detection", mode="text_errors"),
        }
    )

    manager = AdaptiveSessionManager(
        complex_service=_FakeComplexService(complex_obj),
        user_progress_manager=_FakeUserProgressManager(),
        difficulty_manager=_FakeDifficultyManager(),
        storage_service=storage_service,
        session_repository=_InMemorySessionRepository(),
    )
    manager._check_task_file_exists = lambda _: True

    session = manager.start_session(complex_obj.id, "user1")
    session_id = session.id

    task = manager.get_next_task(session_id)
    assert task is not None
    assert task["task_ref"] == tasks[0]

    # Эмулируем успешное выполнение
    manager.submit_result(
        session_id,
        {
            "task_ref": task["task_ref"],
            "success": True,
            "difficulty": task["difficulty"],
            "time_spent": 5,
        },
    )

    # После успеха не должно появиться дополнительных копий; очередь не растёт
    queue_refs = [qt.task_ref for qt in session.queue]
    assert queue_refs.count(tasks[0]) == 1

    # Следующего задания нет, сессия завершается/деактивируется
    nxt = manager.get_next_task(session_id)
    assert nxt is None
    # В репозитории сессия может быть удалена; если осталась, она не должна быть активной
    persisted = manager.get_session(session_id)
    if persisted:
        assert getattr(persisted, "is_active", False) is False
