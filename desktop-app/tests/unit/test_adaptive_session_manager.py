import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# Добавляем desktop-app в PYTHONPATH, чтобы импортировать services.*
DESKTOP_APP_PATH = Path(__file__).resolve().parents[2] / "desktop-app"
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

import services.adaptive_session_manager as asm
from services.adaptive_session_manager import AdaptiveSessionManager
from task_system.core.models.complex_models import Complex, ComplexSettings, SessionTaskResult


@pytest.fixture
def mock_services():
    complex_service = MagicMock()
    user_progress = MagicMock()
    difficulty_manager = MagicMock()
    return complex_service, user_progress, difficulty_manager


@pytest.fixture
def session_manager(mock_services, monkeypatch):
    # Сделать шифл и рандом детерминированными для предсказуемых очередей
    monkeypatch.setattr(asm.random, "shuffle", lambda seq: None)
    monkeypatch.setattr(asm.random, "randint", lambda a, b: a)
    monkeypatch.setattr(asm.random, "choice", lambda seq: seq[0] if seq else None)
    return AdaptiveSessionManager(*mock_services)


def _setup_complex(complex_service, tasks):
    complex_obj = Complex(
        id="c1",
        name="Test",
        tasks=tasks,
        settings=ComplexSettings(adaptive_difficulty=True, escalation_on_success=True),
    )
    complex_service.get_complex.return_value = complex_obj
    return complex_obj


def _wire_task_meta(session_manager, difficulty_manager, task_refs, levels):
    # Все задания считаем одного типа, с одинаковыми доступными уровнями
    session_manager.task_meta_cache.update({ref: "open_answer" for ref in task_refs})
    difficulty_manager.get_available_levels.side_effect = lambda task_type, task_ref: levels
    # Отключаем проверку файлов
    session_manager._check_task_file_exists = lambda task_ref: True


def test_iteration_includes_all_tasks_and_escalates_success(session_manager, mock_services):
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task1", "task2"]
    _setup_complex(complex_service, tasks)
    _wire_task_meta(session_manager, difficulty_manager, tasks, [1, 2, 3])

    session = session_manager.start_session("c1", "user1")

    # Итерация 1: оба задания на уровне 1
    t1 = session_manager.get_next_task(session.id)
    t2 = session_manager.get_next_task(session.id)
    assert {t1["task_ref"], t2["task_ref"]} == set(tasks)
    assert t1["difficulty"] == 1 and t2["difficulty"] == 1

    # Отправляем успехи
    session_manager.submit_result(session.id, {"task_ref": t1["task_ref"], "success": True, "difficulty": 1})
    session_manager.submit_result(session.id, {"task_ref": t2["task_ref"], "success": True, "difficulty": 1})

    # Очередь итерации 2 должна содержать ВСЕ задания, с повышенной сложностью до 2
    next_task = session_manager.get_next_task(session.id)  # триггер генерации итерации 2 и возврат первого задания
    assert session.iteration == 2
    assert len(session.queue) == 2
    assert all(q.difficulty == 2 for q in session.queue)
    assert next_task["difficulty"] == 2
    assert next_task["task_ref"] in tasks


def test_mixed_allowed_difficulties_follow_global_iteration_layers(session_manager, mock_services):
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task_full", "task_sparse"]
    _setup_complex(complex_service, tasks)

    session_manager._check_task_file_exists = lambda _: True
    session_manager._get_task_type = lambda _ref: "click"
    difficulty_manager.get_available_levels.side_effect = (
        lambda _task_type, task_ref: [1, 2, 3] if task_ref == "task_full" else [1, 3]
    )
    session_manager._load_task_metadata = lambda _ref: {}

    session = session_manager.start_session("c1", "user1")

    first = session_manager.get_next_task(session.id)
    second = session_manager.get_next_task(session.id)
    assert {first["task_ref"], second["task_ref"]} == set(tasks)
    assert first["difficulty"] == 1
    assert second["difficulty"] == 1

    session_manager.submit_result(session.id, {"task_ref": first["task_ref"], "success": True, "difficulty": 1})
    session_manager.submit_result(session.id, {"task_ref": second["task_ref"], "success": True, "difficulty": 1})

    second_round = [session_manager.get_next_task(session.id), session_manager.get_next_task(session.id)]
    assert session.iteration == 2
    assert {queued.task_ref: queued.difficulty for queued in session.queue} == {
        "task_full": 2,
        "task_sparse": 1,
    }
    assert {task["task_ref"]: task["difficulty"] for task in second_round} == {
        "task_full": 2,
        "task_sparse": 1,
    }

    for task in second_round:
        session_manager.submit_result(
            session.id,
            {"task_ref": task["task_ref"], "success": True, "difficulty": task["difficulty"]},
        )

    final_task = session_manager.get_next_task(session.id)
    assert session.iteration == 3
    queue_by_ref = {queued.task_ref: queued.difficulty for queued in session.queue}
    assert queue_by_ref == {
        "task_full": 3,
        "task_sparse": 3,
    }
    assert final_task["task_ref"] in tasks
    assert final_task["difficulty"] == 3


def test_inherently_single_level_task_carries_forward_on_later_iterations(session_manager, mock_services):
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task_full", "task_open"]
    _setup_complex(complex_service, tasks)

    session_manager._check_task_file_exists = lambda _: True
    session_manager._get_task_type = lambda ref: "click" if ref == "task_full" else "open_answer"
    difficulty_manager.get_available_levels.side_effect = (
        lambda _task_type, task_ref: [1, 2, 3] if task_ref == "task_full" else [1]
    )
    session_manager._load_task_metadata = lambda _ref: {}

    session = session_manager.start_session("c1", "user1")

    first_round = [session_manager.get_next_task(session.id), session_manager.get_next_task(session.id)]
    assert {task["task_ref"] for task in first_round} == set(tasks)
    assert {task["difficulty"] for task in first_round} == {1}

    for task in first_round:
        session_manager.submit_result(
            session.id,
            {"task_ref": task["task_ref"], "success": True, "difficulty": task["difficulty"]},
        )

    second_round = [session_manager.get_next_task(session.id), session_manager.get_next_task(session.id)]
    assert session.iteration == 2
    assert {queued.task_ref: queued.difficulty for queued in session.queue} == {
        "task_full": 2,
        "task_open": 1,
    }

    for task in second_round:
        session_manager.submit_result(
            session.id,
            {"task_ref": task["task_ref"], "success": True, "difficulty": task["difficulty"]},
        )

    session_manager.get_next_task(session.id)
    assert session.iteration == 3
    assert {queued.task_ref: queued.difficulty for queued in session.queue} == {
        "task_full": 3,
        "task_open": 1,
    }


def test_inherently_two_level_task_stays_on_max_level_in_later_iterations(session_manager, mock_services):
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task_full", "task_test"]
    _setup_complex(complex_service, tasks)

    session_manager._check_task_file_exists = lambda _: True
    session_manager._get_task_type = lambda ref: "click" if ref == "task_full" else "test"
    difficulty_manager.get_available_levels.side_effect = (
        lambda _task_type, task_ref: [1, 2, 3] if task_ref == "task_full" else [1, 2]
    )
    session_manager._load_task_metadata = lambda _ref: {}

    session = session_manager.start_session("c1", "user1")

    first_round = [session_manager.get_next_task(session.id), session_manager.get_next_task(session.id)]
    for task in first_round:
        session_manager.submit_result(
            session.id,
            {"task_ref": task["task_ref"], "success": True, "difficulty": task["difficulty"]},
        )

    second_round = [session_manager.get_next_task(session.id), session_manager.get_next_task(session.id)]
    assert session.iteration == 2
    assert {queued.task_ref: queued.difficulty for queued in session.queue} == {
        "task_full": 2,
        "task_test": 2,
    }

    for task in second_round:
        session_manager.submit_result(
            session.id,
            {"task_ref": task["task_ref"], "success": True, "difficulty": task["difficulty"]},
        )

    session_manager.get_next_task(session.id)
    assert session.iteration == 3
    assert {queued.task_ref: queued.difficulty for queued in session.queue} == {
        "task_full": 3,
        "task_test": 2,
    }


def test_explicit_single_allowed_level_two_carries_forward_after_first_visibility(session_manager, mock_services):
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task_full", "task_mid"]
    _setup_complex(complex_service, tasks)

    session_manager._check_task_file_exists = lambda _: True
    session_manager._get_task_type = lambda _ref: "click"
    difficulty_manager.get_available_levels.side_effect = (
        lambda _task_type, task_ref: [1, 2, 3] if task_ref == "task_full" else [2]
    )
    session_manager._load_task_metadata = lambda _ref: {}

    session = session_manager.start_session("c1", "user1")

    first_task = session_manager.get_next_task(session.id)
    assert session.iteration == 1
    assert first_task["task_ref"] == "task_full"
    assert first_task["difficulty"] == 1

    session_manager.submit_result(session.id, {"task_ref": "task_full", "success": True, "difficulty": 1})

    second_round = [session_manager.get_next_task(session.id), session_manager.get_next_task(session.id)]
    assert session.iteration == 2
    assert {queued.task_ref: queued.difficulty for queued in session.queue} == {
        "task_full": 2,
        "task_mid": 2,
    }

    for task in second_round:
        session_manager.submit_result(
            session.id,
            {"task_ref": task["task_ref"], "success": True, "difficulty": task["difficulty"]},
        )

    final_round = [session_manager.get_next_task(session.id), session_manager.get_next_task(session.id)]
    assert session.iteration == 3
    assert {queued.task_ref: queued.difficulty for queued in session.queue} == {
        "task_full": 3,
        "task_mid": 2,
    }
    assert {task["task_ref"]: task["difficulty"] for task in final_round} == {
        "task_full": 3,
        "task_mid": 2,
    }


def test_failed_task_retries_shown_in_same_iteration(session_manager, mock_services):
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task1", "task2"]
    _setup_complex(complex_service, tasks)
    _wire_task_meta(session_manager, difficulty_manager, tasks, [1, 2])

    session = session_manager.start_session("c1", "user1")

    # Берём первое задание и заваливаем его
    first = session_manager.get_next_task(session.id)
    session_manager.submit_result(session.id, {"task_ref": first["task_ref"], "success": False, "difficulty": first["difficulty"]})
    
    # После ошибки две retry-копии должны появиться в текущей итерации,
    # но могут быть разнесены (не обязательно сразу подряд).
    second = session_manager.get_next_task(session.id)
    t3 = session_manager.get_next_task(session.id)
    t4 = session_manager.get_next_task(session.id)

    # Второе исходное задание должно быть доступно
    assert second["task_ref"] == "task2"

    # Две оставшиеся задачи должны быть retry-копиями первого
    assert {t3["task_ref"], t4["task_ref"]} == {first["task_ref"]}
    assert t3["is_retry"] and t4["is_retry"]


def test_smart_retry_respects_complex_settings(session_manager, mock_services):
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task1"]
    _setup_complex(complex_service, tasks)
    _wire_task_meta(session_manager, difficulty_manager, tasks, [1])  # максимум 1

    session = session_manager.start_session("c1", "user1")
    first = session_manager.get_next_task(session.id)
    session_manager.submit_result(session.id, {"task_ref": first["task_ref"], "success": True, "difficulty": 1})

    # Следующий вызов должен завершить комплекс (все на максимуме)
    next_task = session_manager.get_next_task(session.id)
    assert next_task is None
    assert session.is_active is False
    assert getattr(session, "_should_show_final_results", False) is True


def test_incomplete_iteration_does_not_complete_complex(session_manager, mock_services):
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task1", "task2"]
    _setup_complex(complex_service, tasks)
    _wire_task_meta(session_manager, difficulty_manager, tasks, [1, 2])

    session = session_manager.start_session("c1", "user1")
    # эмулируем завершение очереди итерации 1 с одним результатом
    session.iteration = 1
    session.queue = []
    session.current_task_index = 2  # как будто прошли оба задания
    # Результат только по первому заданию в итерации 1
    session.completed_tasks.append(
        SessionTaskResult(task_ref="task1", success=True, time_spent=1, difficulty=1, iteration_index=1)
    )

    # Генерация следующей итерации должна создать очередь и не завершить комплекс
    complex_obj = complex_service.get_complex.return_value
    session_manager._generate_next_iteration(session, complex_obj)

    assert session.is_active is True
    assert not getattr(session, "_should_show_final_results", False)
    # Новая очередь должна содержать оба задания
    assert len(session.queue) == 2


def test_generate_initial_queue_defers_error_detection_until_iteration_three(session_manager, mock_services):
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task_regular", "task_error"]
    complex_obj = _setup_complex(complex_service, tasks)

    session_manager._check_task_file_exists = lambda _: True
    session_manager._get_task_type = lambda ref: "click"
    difficulty_manager.get_available_levels.side_effect = lambda _type, _ref: [1, 2]

    def fake_metadata(task_ref):
        if task_ref == "task_error":
            return {"subtype": "error_detection"}
        return {}

    session_manager._load_task_metadata = fake_metadata

    session = session_manager.start_session("c1", "user1")
    session_manager._generate_initial_queue(session, complex_obj, target_iteration=1)

    assert session.error_detection_tasks == ["task_error"]
    queue_refs = [t.task_ref for t in session.queue]
    assert "task_regular" in queue_refs
    assert "task_error" not in queue_refs


def test_generate_next_iteration_adds_error_detection_on_iteration_three(session_manager, mock_services):
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task_regular", "task_error"]
    complex_obj = _setup_complex(complex_service, tasks)

    session_manager._check_task_file_exists = lambda _: True
    session_manager._get_task_type = lambda ref: "click"
    difficulty_manager.get_available_levels.side_effect = lambda _type, _ref: [1, 2]

    def fake_metadata(task_ref):
        if task_ref == "task_error":
            return {"subtype": "error_detection"}
        return {}

    session_manager._load_task_metadata = fake_metadata

    session = session_manager.start_session("c1", "user1")
    session.iteration = 2  # upcoming_iteration == 3
    session.queue = []
    session.current_task_index = 0
    session.error_detection_tasks = ["task_error"]
    session.completed_tasks = [
        SessionTaskResult(
            task_ref="task_regular",
            success=True,
            time_spent=1,
            difficulty=2,
            iteration_index=2,
        )
    ]

    session_manager._generate_next_iteration(session, complex_obj)

    queue_refs = [t.task_ref for t in session.queue]
    assert queue_refs[-1] == "task_error"
    assert session.error_detection_tasks == []
    assert any(t.task_ref == "task_error" and t.difficulty == 3 for t in session.queue)


def test_generate_next_iteration_activates_error_detection_when_next_pass_reaches_max(session_manager, mock_services):
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task_regular", "task_error"]
    complex_obj = _setup_complex(complex_service, tasks)

    session_manager._check_task_file_exists = lambda _: True
    session_manager._get_task_type = lambda ref: "click"
    difficulty_manager.get_available_levels.side_effect = lambda _type, _ref: [1, 2]

    def fake_metadata(task_ref):
        if task_ref == "task_error":
            return {"subtype": "error_detection"}
        return {}

    session_manager._load_task_metadata = fake_metadata

    session = session_manager.start_session("c1", "user1")
    session.iteration = 2
    session.queue = []
    session.current_task_index = 0
    session.error_detection_tasks = ["task_error"]
    session.completed_tasks = [
        SessionTaskResult(
            task_ref="task_regular",
            success=True,
            time_spent=1,
            difficulty=1,  # not max
            iteration_index=2,
        )
    ]

    assert (
        session_manager._all_other_tasks_at_max(session, complex_obj, "task_error")
        is False
    )

    session_manager._generate_next_iteration(session, complex_obj)

    queue_by_ref = {t.task_ref: t.difficulty for t in session.queue}
    assert queue_by_ref == {
        "task_regular": 2,
        "task_error": 3,
    }
    assert session.error_detection_tasks == []


def test_planned_final_iteration_is_forced_to_three_when_error_detection_exists(session_manager, mock_services):
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task_regular", "task_error"]
    complex_obj = _setup_complex(complex_service, tasks)

    session_manager._check_task_file_exists = lambda _: True
    session_manager._get_task_type = lambda ref: "click"
    difficulty_manager.get_available_levels.side_effect = lambda _type, _ref: [1, 2]

    def fake_metadata(task_ref):
        if task_ref == "task_error":
            return {"subtype": "error_detection"}
        return {}

    session_manager._load_task_metadata = fake_metadata

    session = session_manager.start_session("c1", "user1")

    assert session_manager._get_planned_final_iteration(session, complex_obj) == 3


def test_get_task_phase_returns_finisher_for_error_detection(session_manager, mock_services):
    session_manager._load_task_metadata = lambda ref: {"subtype": "error_detection"}
    phase = session_manager._get_task_phase("click", 1, task_ref="task_error")
    assert phase == 2


def test_load_task_metadata_uses_storage_and_cache():
    complex_service = MagicMock()
    user_progress = MagicMock()
    difficulty_manager = MagicMock()
    storage_service = MagicMock()

    storage_service.load_task.return_value = {
        "task_data": {
            "type": "click",
            "content": {"mode": "text_errors"},
            "subtype": "error_detection",
        },
        "metadata": {"type": "click"},
    }

    mgr = AdaptiveSessionManager(
        complex_service, user_progress, difficulty_manager, storage_service=storage_service
    )

    meta_first = mgr._load_task_metadata("module/topic/task1")
    meta_second = mgr._load_task_metadata("module/topic/task1")

    assert meta_first["type"] == "click"
    assert meta_first["subtype"] == "error_detection"
    assert meta_first["mode"] == "text_errors"
    assert meta_second == meta_first
    storage_service.load_task.assert_called_once()


def test_generate_initial_queue_raises_on_all_broken_files(session_manager, mock_services):
    """Все файлы битые - должно выбросить ValueError."""
    from datetime import datetime
    from task_system.core.models.complex_models import ComplexSession
    
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task1", "task2", "task3"]
    complex_obj = _setup_complex(complex_service, tasks)
    
    # Все файлы не существуют
    session_manager._check_task_file_exists = lambda _: False
    session_manager._get_task_type = lambda ref: "test"
    difficulty_manager.get_available_levels.side_effect = lambda _type, _ref: [1, 2]
    session_manager._load_task_metadata = lambda ref: {}
    
    session = ComplexSession(
        id="test_session",
        complex_id="c1",
        user_id="user1",
        start_time=datetime.utcnow(),
        version=1,
        iteration=1
    )
    
    with pytest.raises(ValueError) as exc_info:
        session_manager._generate_initial_queue(session, complex_obj, target_iteration=1)
    
    assert "все задания" in str(exc_info.value).lower()
    assert "недоступны" in str(exc_info.value).lower()
    assert len(session.broken_tasks) == 3


def test_generate_initial_queue_raises_on_empty_complex(session_manager, mock_services):
    """Комплекс без заданий - должно выбросить ValueError."""
    from datetime import datetime
    from task_system.core.models.complex_models import ComplexSession
    
    complex_service, _, _ = mock_services
    complex_obj = _setup_complex(complex_service, tasks=[])  # Пустой список
    
    session = ComplexSession(
        id="test_session",
        complex_id="c1",
        user_id="user1",
        start_time=datetime.utcnow(),
        version=1,
        iteration=1
    )
    
    with pytest.raises(ValueError) as exc_info:
        session_manager._generate_initial_queue(session, complex_obj, target_iteration=1)
    
    assert "не содержит заданий" in str(exc_info.value).lower()


def test_error_detection_stays_deferred_until_iteration_3_even_if_regular_max_is_2(session_manager, mock_services):
    """Error_detection остаётся отложенным до итерации 3 даже если обычные задания достигают max=2."""
    from datetime import datetime
    from task_system.core.models.complex_models import ComplexSession
    
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task_regular", "task_error"]
    complex_obj = _setup_complex(complex_service, tasks)
    
    session_manager._check_task_file_exists = lambda _: True
    session_manager._get_task_type = lambda ref: "test"
    
    # Максимальная сложность = 2
    difficulty_manager.get_available_levels.side_effect = lambda _type, _ref: [1, 2]
    
    def fake_metadata(task_ref):
        if task_ref == "task_error":
            return {"subtype": "error_detection"}
        return {}
    
    session_manager._load_task_metadata = fake_metadata
    
    session = ComplexSession(
        id="test_session",
        complex_id="c1",
        user_id="user1",
        start_time=datetime.utcnow(),
        version=1,
        iteration=2
    )
    session.error_detection_tasks = ["task_error"]
    
    # task_regular на max difficulty (2) и успешно пройден
    session.completed_tasks = [
        SessionTaskResult(
            task_ref="task_regular",
            success=True,
            time_spent=1,
            difficulty=2,
            iteration_index=1
        )
    ]
    
    session_manager._generate_initial_queue(session, complex_obj, target_iteration=2)
    
    queue_refs = [t.task_ref for t in session.queue]
    assert "task_regular" in queue_refs
    assert "task_error" not in queue_refs
    assert session.error_detection_tasks == ["task_error"]


def test_generate_next_iteration_replays_all_tasks_until_final_iteration(session_manager, mock_services):
    complex_service, _, difficulty_manager = mock_services
    tasks = ["task_l3", "task_l2", "task_l1", "task_error"]
    complex_obj = _setup_complex(complex_service, tasks)

    session_manager._check_task_file_exists = lambda _: True

    def fake_type(task_ref):
        if task_ref == "task_l1":
            return "open_answer"
        return "click"

    def fake_levels(_task_type, task_ref):
        if task_ref == "task_l1":
            return [1]
        if task_ref == "task_l2":
            return [1, 2]
        return [1, 2, 3]

    def fake_metadata(task_ref):
        if task_ref == "task_error":
            return {"subtype": "error_detection"}
        return {}

    session_manager._get_task_type = fake_type
    difficulty_manager.get_available_levels.side_effect = fake_levels
    session_manager._load_task_metadata = fake_metadata

    session = session_manager.start_session("c1", "user1")
    session.iteration = 2
    session.queue = []
    session.current_task_index = 0
    session.error_detection_tasks = ["task_error"]
    session.completed_tasks = [
        SessionTaskResult(task_ref="task_l3", success=True, time_spent=1, difficulty=2, iteration_index=2),
        SessionTaskResult(task_ref="task_l2", success=True, time_spent=1, difficulty=2, iteration_index=2),
        SessionTaskResult(task_ref="task_l1", success=True, time_spent=1, difficulty=1, iteration_index=2),
    ]

    session_manager._generate_next_iteration(session, complex_obj)

    queue_by_ref = {task.task_ref: task.difficulty for task in session.queue}
    assert queue_by_ref == {
        "task_l3": 3,
        "task_l2": 2,
        "task_l1": 1,
        "task_error": 3,
    }


def test_balance_chunks_by_type_distributes_types(session_manager, mock_services):
    """Типы заданий чередуются внутри фазы."""
    from task_system.core.models.complex_models import QueuedTask
    
    # Создаем chunks разных типов
    test_chunks = [
        [QueuedTask(task_ref="test1", difficulty=1, is_retry=False)],
        [QueuedTask(task_ref="test2", difficulty=1, is_retry=False)],
        [QueuedTask(task_ref="test3", difficulty=1, is_retry=False)],
    ]
    click_chunks = [
        [QueuedTask(task_ref="click1", difficulty=1, is_retry=False)],
        [QueuedTask(task_ref="click2", difficulty=1, is_retry=False)],
    ]
    draw_chunks = [
        [QueuedTask(task_ref="draw1", difficulty=1, is_retry=False)],
    ]
    
    all_chunks = test_chunks + click_chunks + draw_chunks
    
    # Настраиваем типы
    session_manager._get_task_type = lambda ref: (
        "test" if ref.startswith("test") else
        "click" if ref.startswith("click") else
        "draw"
    )
    
    # Балансируем
    result = session_manager._balance_chunks_by_type(all_chunks, seed_base="test_seed", phase_id=1)
    
    # Проверяем, что все задания присутствуют
    result_refs = [t.task_ref for t in result]
    assert len(result_refs) == 6
    
    # Проверяем, что типы чередуются (не более 3 подряд одного типа)
    types = [session_manager._get_task_type(ref) for ref in result_refs]
    max_consecutive = 1
    current_consecutive = 1
    for i in range(1, len(types)):
        if types[i] == types[i-1]:
            current_consecutive += 1
            max_consecutive = max(max_consecutive, current_consecutive)
        else:
            current_consecutive = 1
    
    # С window_size=3 максимум может быть 3 подряд
    assert max_consecutive <= 3


def test_balance_preserves_phase_order(session_manager, mock_services):
    """Балансировка не нарушает порядок фаз."""
    from task_system.core.models.complex_models import QueuedTask
    
    complex_service, _, difficulty_manager = mock_services
    tasks = ["test1", "click1", "test2", "draw1"]
    complex_obj = _setup_complex(complex_service, tasks)
    
    session_manager._check_task_file_exists = lambda _: True
    session_manager._load_task_metadata = lambda ref: {}
    
    # test1, test2 - warmup (L1)
    # click1 - main (L2)
    # draw1 - main (L1)
    def get_type(ref):
        if ref.startswith("test"):
            return "test"
        elif ref.startswith("click"):
            return "click"
        else:
            return "draw"
    
    session_manager._get_task_type = get_type
    difficulty_manager.get_available_levels.side_effect = lambda _type, _ref: [1, 2, 3]
    
    # Создаем chunks
    chunks = [
        [QueuedTask(task_ref="test1", difficulty=1, is_retry=False)],  # Phase 0
        [QueuedTask(task_ref="click1", difficulty=2, is_retry=False)],  # Phase 1
        [QueuedTask(task_ref="test2", difficulty=1, is_retry=False)],  # Phase 0
        [QueuedTask(task_ref="draw1", difficulty=1, is_retry=False)],   # Phase 1
    ]
    
    result = session_manager._sort_chunks_by_phase(chunks, seed_base="test_seed")
    
    # Проверяем порядок фаз
    result_refs = [t.task_ref for t in result]
    types = [get_type(ref) for ref in result_refs]
    difficulties = [t.difficulty for t in result]
    
    # Первые два должны быть из Phase 0 (warmup) - test L1
    warmup_count = sum(1 for i, d in enumerate(difficulties) if d == 1 and types[i] == "test")
    assert warmup_count == 2
    
    # Остальные из Phase 1 (main)
    assert len(result_refs) == 4


def test_balance_single_type_just_shuffles(session_manager, mock_services):
    """Если только один тип - просто shuffle."""
    from task_system.core.models.complex_models import QueuedTask
    
    # Все chunks одного типа
    chunks = [
        [QueuedTask(task_ref=f"test{i}", difficulty=1, is_retry=False)]
        for i in range(5)
    ]
    
    session_manager._get_task_type = lambda ref: "test"
    
    result = session_manager._balance_chunks_by_type(chunks, seed_base="test_seed", phase_id=1)
    
    # Проверяем, что все задания присутствуют
    result_refs = [t.task_ref for t in result]
    assert len(result_refs) == 5
    assert all(ref.startswith("test") for ref in result_refs)


def test_get_next_task_recursion_protection(session_manager, mock_services):
    """Защита от бесконечной рекурсии при множественных битых заданиях."""
    from datetime import datetime
    from task_system.core.models.complex_models import ComplexSession, QueuedTask
    
    complex_service, _, difficulty_manager = mock_services
    tasks = [f"task{i}" for i in range(10)]
    complex_obj = _setup_complex(complex_service, tasks)
    
    # Создаем сессию вручную с уже существующей очередью
    session = ComplexSession(
        id="test_session",
        complex_id="c1",
        user_id="user1",
        start_time=datetime.utcnow(),
        version=1,
        iteration=1
    )
    
    # Создаем очередь из 10 заданий
    session.queue = [
        QueuedTask(task_ref=f"task{i}", difficulty=1, is_retry=False)
        for i in range(10)
    ]
    session.current_task_index = 0
    
    # Добавляем сессию в активные
    session_manager._active_sessions[session.id] = session
    
    # Все файлы не существуют - будет рекурсия
    session_manager._check_task_file_exists = lambda _: False
    
    # Попытка получить следующее задание должна завершиться gracefully
    # после достижения лимита рекурсии (100)
    result = session_manager.get_next_task(session.id)
    
    # Должен вернуть None (сессия завершена из-за превышения лимита)
    assert result is None
    # Сессия должна быть неактивна
    assert session.is_active is False
    # Все задания должны быть в broken_tasks
    assert len(session.broken_tasks) >= 10
