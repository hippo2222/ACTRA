import sys
import copy
from pathlib import Path
from typing import Any, Dict, List

import pytest


# Гарантируем, что desktop-app в sys.path для импорта SessionAPI
ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from api.session_api import SessionAPI  # type: ignore


class DummyQueuedTask:
    def __init__(self, task_ref: str, difficulty: int = 1, is_retry: bool = False) -> None:
        self.task_ref = task_ref
        self.difficulty = difficulty
        self.is_retry = is_retry
        self.origin_iteration = None


class DummySession:
    def __init__(self, session_id: str, iteration: int = 1) -> None:
        self.id = session_id
        self.user_id = "test_user"
        self.complex_id = "test_complex"
        self.iteration = iteration
        self.queue: List[DummyQueuedTask] = []
        self.current_task_index: int = 0
        self.test_shuffle: Dict[str, Any] = {}
        self.test_failed_subtests: Dict[str, List[int]] = {}
        self.paused = False
        self.paused_at = None
        self.is_active = True
        self.completed_tasks: List[Any] = []


class DummyController:
    """Минимальный контроллер, который нужен SessionAPI."""

    def __init__(self, session_id: str, task_ref: str) -> None:
        self.current_session_id = session_id
        self.current_task_ref = task_ref

    def get_current_session_stats(self) -> Dict[str, Any]:  # pragma: no cover - не принципиально
        return {}


class DummyAdaptiveSessionManager:
    """Заглушка AdaptiveSessionManager с одним методом get_session."""

    def __init__(self, session: DummySession) -> None:
        self._session = session

    def get_session(self, session_id: str) -> DummySession | None:
        if self._session.id == session_id:
            return self._session
        return None


class DummyComplexService:
    pass


class DummyStorageService:
    def __init__(self, task_data_full: Dict[str, Any]) -> None:
        self._task_data_full = task_data_full

    def load_task(self, module_id: str, topic_id: str, task_id: str) -> Dict[str, Any]:
        # В этих тестах не важно, какие именно идентификаторы переданы
        return self._task_data_full


class DummyStatisticsService:
    pass


def _build_test_task() -> Dict[str, Any]:
    """Базовый JSON теста в формате, близком к data/modules/.../task.json."""
    return {
        "task_data": {
            "type": "test",
            "content": {
                "type": "test",
                "questions": [
                    {
                        "id": 1,
                        "text": "Q1",
                        "answers": [
                            {"text": "a1", "correct": False},
                            {"text": "a2", "correct": True},
                            {"text": "a3", "correct": False},
                        ],
                    },
                    {
                        "id": 2,
                        "text": "Q2",
                        "answers": [
                            {"text": "b1", "correct": True},
                            {"text": "b2", "correct": False},
                        ],
                    },
                    {
                        "id": 3,
                        "text": "Q3",
                        "answers": [
                            {"text": "c1", "correct": False},
                            {"text": "c2", "correct": True},
                        ],
                    },
                ],
            },
            "settings": {
                "shuffle_questions": True,
                "shuffle_answers": True,
            },
        },
        "answer_key": {},
        "task_dir": None,
    }


def _make_session_api(task_data_full: Dict[str, Any], *, session_id: str, task_ref: str, iteration: int = 1,
                      is_retry: bool = False) -> tuple[SessionAPI, DummySession]:
    session = DummySession(session_id=session_id, iteration=iteration)
    session.queue = [DummyQueuedTask(task_ref, difficulty=1, is_retry=is_retry)]
    # current_task_index указывает на "следующий" слот, поэтому для единственного задания == 1
    session.current_task_index = 1

    controller = DummyController(session_id=session_id, task_ref=task_ref)
    adaptive_manager = DummyAdaptiveSessionManager(session)
    complex_service = DummyComplexService()
    storage = DummyStorageService(task_data_full)
    statistics = DummyStatisticsService()

    api = SessionAPI(controller, adaptive_manager, complex_service, storage, statistics)
    return api, session


def test_shuffle_is_stable_between_calls() -> None:
    """Один и тот же тест в рамках одной итерации должен иметь стабильный порядок
    вопросов и вариантов при многократных вызовах get_current_task.

    Мы не проверяем конкретный порядок (он случайный), только стабильность и
    то, что permutation сохраняется в сессии.
    """
    session_id = "s1"
    task_ref = "module/topic/task_test_001"
    task_data_full = _build_test_task()

    api, session = _make_session_api(task_data_full, session_id=session_id, task_ref=task_ref, iteration=1)

    result1 = api.get_current_task(session_id)
    snapshot1 = copy.deepcopy(result1["task_data"]["content"]["questions"])
    result2 = api.get_current_task(session_id)
    snapshot2 = copy.deepcopy(result2["task_data"]["content"]["questions"])
    snapshot1_after_second_call = copy.deepcopy(
        result1["task_data"]["content"]["questions"]
    )

    def _shape(questions: List[Dict[str, Any]]) -> List[tuple[int, List[str]]]:
        out: List[tuple[int, List[str]]] = []
        for q in questions:
            qid = int(q["id"])
            answers = [str(a.get("text", "")) for a in (q.get("answers") or [])]
            out.append((qid, answers))
        return out

    shape1 = _shape(snapshot1)
    shape2 = _shape(snapshot2)
    shape1_after = _shape(snapshot1_after_second_call)

    # Оба вызова должны давать идентичный порядок вопросов и вариантов ответа.
    assert shape1 == shape2
    # Повторный вызов не должен мутировать уже выданный результат.
    assert shape1_after == shape1
    # Набор вопросов не меняется
    assert {qid for qid, _ in shape1} == {1, 2, 3}

    # В сессии должна появиться permutation для пары (task_ref, iteration)
    key = f"{task_ref}@1"
    assert key in session.test_shuffle
    entry = session.test_shuffle[key]
    order = entry["question_order"]
    assert len(order) == 3
    assert set(order) == {0, 1, 2}


def test_partial_retry_uses_shuffled_indices() -> None:
    """При partial-retry индексы failed_subtests относятся к уже перемешанному
    списку вопросов. Мы фиксируем permutation в сессии и проверяем, что
    SessionAPI режет questions по этим индексам.
    """
    session_id = "s2"
    task_ref = "module/topic/task_test_002"

    task_data_full = _build_test_task()

    api, session = _make_session_api(task_data_full, session_id=session_id, task_ref=task_ref, iteration=1,
                                     is_retry=True)

    # Фиксируем permutation в сессии вручную, чтобы не зависеть от random.
    # Исходный порядок id: [1, 2, 3] -> хотим порядок [3, 1, 2]
    session.test_shuffle = {
        f"{task_ref}@1": {
            "question_order": [2, 0, 1],  # индексы исходного массива
            "answer_order_by_question": {},  # порядок ответов здесь не важен
        }
    }

    # Считаем, что пользователь провалил вопрос с индексом 1 в ПЕРЕМЕШАННОМ списке,
    # т.е. это должен быть вопрос с id == 1 (шаги:
    # оригинал [1,2,3] -> permutation [3(id=3), 1(id=1), 2(id=2)]).
    session.test_failed_subtests = {
        task_ref: [1],
    }

    result = api.get_current_task(session_id)
    questions = result["task_data"]["content"]["questions"]

    # Должен остаться ровно один вопрос
    assert len(questions) == 1
    # И это именно вопрос с id == 1 (тот, что был на позиции 1 после shuffle)
    assert questions[0]["id"] == 1


def test_new_iteration_has_separate_permutation() -> None:
    """Для одной и той же сессии и task_ref при смене iteration должна
    создаваться отдельная permutation, а старая запись оставаться нетронутой.

    Мы эмулируем две последовательные итерации в одной сессии:
    - iteration=1 -> вызываем get_current_task(), создаётся permutation для ключа "@1";
    - iteration=2 -> обновляем поле iteration и снова вызываем get_current_task(),
      создаётся permutation для ключа "@2".
    Затем убеждаемся, что в session.test_shuffle есть обе записи и что изменение
    одной не влияет на другую.
    """
    session_id = "s3"
    task_ref = "module/topic/task_test_003"
    task_data_full = _build_test_task()

    # Создаём сессию вручную, чтобы иметь возможность менять iteration
    session = DummySession(session_id=session_id, iteration=1)
    session.queue = [DummyQueuedTask(task_ref, difficulty=1, is_retry=False)]
    session.current_task_index = 1

    controller = DummyController(session_id=session_id, task_ref=task_ref)
    adaptive_manager = DummyAdaptiveSessionManager(session)
    complex_service = DummyComplexService()
    storage = DummyStorageService(task_data_full)
    statistics = DummyStatisticsService()

    api = SessionAPI(controller, adaptive_manager, complex_service, storage, statistics)

    # Итерация 1
    _ = api.get_current_task(session_id)
    key_iter1 = f"{task_ref}@1"
    assert key_iter1 in session.test_shuffle

    # Сохраняем ссылку на permutation первой итерации
    entry_iter1 = session.test_shuffle[key_iter1]
    orig_order_iter1 = list(entry_iter1["question_order"])

    # Переходим на итерацию 2 в той же сессии
    session.iteration = 2

    # Новый вызов get_current_task должен создать отдельную запись
    _ = api.get_current_task(session_id)
    key_iter2 = f"{task_ref}@2"

    # В сессии должна появиться permutation для пары (task_ref, iteration)
    key = f"{task_ref}@1"
    assert key in session.test_shuffle
    entry = session.test_shuffle[key]
    order = entry["question_order"]
    assert len(order) == 3
    assert set(order) == {0, 1, 2}


def test_partial_retry_uses_shuffled_indices() -> None:
    """При partial-retry индексы failed_subtests относятся к уже перемешанному
    списку вопросов. Мы фиксируем permutation в сессии и проверяем, что
    SessionAPI режет questions по этим индексам.
    """
    session_id = "s2"
    task_ref = "module/topic/task_test_002"

    task_data_full = _build_test_task()

    api, session = _make_session_api(task_data_full, session_id=session_id, task_ref=task_ref, iteration=1,
                                     is_retry=True)

    # Фиксируем permutation в сессии вручную, чтобы не зависеть от random.
    # Исходный порядок id: [1, 2, 3] -> хотим порядок [3, 1, 2]
    session.test_shuffle = {
        f"{task_ref}@1": {
            "question_order": [2, 0, 1],  # индексы исходного массива
            "answer_order_by_question": {},  # порядок ответов здесь не важен
        }
    }

    # Считаем, что пользователь провалил вопрос с индексом 1 в ПЕРЕМЕШАННОМ списке,
    # т.е. это должен быть вопрос с id == 1 (шаги:
    # оригинал [1,2,3] -> permutation [3(id=3), 1(id=1), 2(id=2)]).
    session.test_failed_subtests = {
        task_ref: [1],
    }

    result = api.get_current_task(session_id)
    questions = result["task_data"]["content"]["questions"]

    # Должен остаться ровно один вопрос
    assert len(questions) == 1
    # И это именно вопрос с id == 1 (тот, что был на позиции 1 после shuffle)
    assert questions[0]["id"] == 1


def test_new_iteration_has_separate_permutation() -> None:
    """Для одной и той же сессии и task_ref при смене iteration должна
    создаваться отдельная permutation, а старая запись оставаться нетронутой.

    Мы эмулируем две последовательные итерации в одной сессии:
    - iteration=1 -> вызываем get_current_task(), создаётся permutation для ключа "@1";
    - iteration=2 -> обновляем поле iteration и снова вызываем get_current_task(),
      создаётся permutation для ключа "@2".
    Затем убеждаемся, что в session.test_shuffle есть обе записи и что изменение
    одной не влияет на другую.
    """
    session_id = "s3"
    task_ref = "module/topic/task_test_003"
    task_data_full = _build_test_task()

    # Создаём сессию вручную, чтобы иметь возможность менять iteration
    session = DummySession(session_id=session_id, iteration=1)
    session.queue = [DummyQueuedTask(task_ref, difficulty=1, is_retry=False)]
    session.current_task_index = 1

    controller = DummyController(session_id=session_id, task_ref=task_ref)
    adaptive_manager = DummyAdaptiveSessionManager(session)
    complex_service = DummyComplexService()
    storage = DummyStorageService(task_data_full)
    statistics = DummyStatisticsService()

    api = SessionAPI(controller, adaptive_manager, complex_service, storage, statistics)

    # Итерация 1
    _ = api.get_current_task(session_id)
    key_iter1 = f"{task_ref}@1"
    assert key_iter1 in session.test_shuffle

    # Сохраняем ссылку на permutation первой итерации
    entry_iter1 = session.test_shuffle[key_iter1]
    orig_order_iter1 = list(entry_iter1["question_order"])

    # Переходим на итерацию 2 в той же сессии
    session.iteration = 2

    # Новый вызов get_current_task должен создать отдельную запись
    _ = api.get_current_task(session_id)
    key_iter2 = f"{task_ref}@2"
    assert key_iter2 in session.test_shuffle

    entry_iter2 = session.test_shuffle[key_iter2]
    assert "question_order" in entry_iter2

    # Меняем порядок во второй итерации и убеждаемся, что первая не изменилась
    entry_iter2["question_order"].reverse()
    assert entry_iter1["question_order"] == orig_order_iter1


# ---------------------------------------------------------------------------
# Тесты для фикса: scattered отображается группами соседних queue-slots.
# ---------------------------------------------------------------------------

class DummyScatteredSlot:
    """Имитирует QueuedTask с display_mode='scattered'."""

    def __init__(self, source_ref: str, q_index: int, difficulty: int = 1) -> None:
        self.task_ref = source_ref
        self.source_task_ref = source_ref
        self.display_mode = "scattered"
        self.test_question_index = q_index
        self.difficulty = difficulty
        self.is_retry = False
        self.origin_iteration = None


def _make_api_for_boundary() -> SessionAPI:
    """SessionAPI без реальной сессии — нужен только для вызова приватного метода."""
    from unittest.mock import MagicMock
    controller = MagicMock()
    adaptive = MagicMock()
    complex_service = MagicMock()
    storage = MagicMock()
    statistics = MagicMock()
    return SessionAPI(controller, adaptive, complex_service, storage, statistics)


def test_scattered_group_collects_adjacent_source_boundary_slots() -> None:
    """Соседние scattered-слоты могут образовать один TestUI payload."""
    api = _make_api_for_boundary()

    session = DummySession("boundary_test")
    session.queue = [
        DummyScatteredSlot("m/t/test_A", 0),
        DummyScatteredSlot("m/t/test_A", 1),
        DummyScatteredSlot("m/t/test_B", 0),  # ← другой источник
        DummyScatteredSlot("m/t/test_B", 1),
    ]

    group = api._resolve_scattered_test_group(session, 0)

    assert len(group) == 4
    assert [idx for idx, _ in group] == [0, 1, 2, 3]
    assert [getattr(slot, "source_task_ref", None) for _, slot in group] == [
        "m/t/test_A",
        "m/t/test_A",
        "m/t/test_B",
        "m/t/test_B",
    ]


def test_scattered_group_collects_full_scattered_run() -> None:
    """Если подряд идут только scattered-слоты, они образуют один TestUI payload."""
    api = _make_api_for_boundary()

    session = DummySession("single_source_test")
    session.queue = [
        DummyScatteredSlot("m/t/test_A", index)
        for index in range(8)
    ]

    group = api._resolve_scattered_test_group(session, 0)
    assert len(group) == 8
    assert [idx for idx, _ in group] == list(range(8))


def test_scattered_group_mid_queue_collects_adjacent_requested_run() -> None:
    """Работает корректно если scattered-run начинается не в нулевой позиции."""
    api = _make_api_for_boundary()

    session = DummySession("mid_queue_test")
    # Позиции: 0=click, 1=scattered_A, 2=scattered_A, 3=scattered_B, 4=scattered_B
    class DummyClick:
        task_ref = "m/t/click_1"
        display_mode = None
        source_task_ref = None
        test_question_index = None
        difficulty = 1
        is_retry = False
        origin_iteration = None

    session.queue = [
        DummyClick(),
        DummyScatteredSlot("m/t/test_A", 0),
        DummyScatteredSlot("m/t/test_A", 1),
        DummyScatteredSlot("m/t/test_B", 0),
        DummyScatteredSlot("m/t/test_B", 1),
    ]

    group = api._resolve_scattered_test_group(session, 1)
    assert len(group) == 4
    assert [idx for idx, _ in group] == [1, 2, 3, 4]
    assert [getattr(slot, "source_task_ref", None) for _, slot in group] == [
        "m/t/test_A",
        "m/t/test_A",
        "m/t/test_B",
        "m/t/test_B",
    ]
