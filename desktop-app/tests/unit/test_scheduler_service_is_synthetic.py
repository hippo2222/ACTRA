"""
Тесты для проверки функционала is_synthetic флага в scheduler_service.

Проверяет что:
1. all_tasks_detailed содержит флаг is_synthetic=False для реальных комплексов
2. Schedule strip корректно содержит задачи с флагом
"""

import pytest
from datetime import date, timedelta
from unittest.mock import Mock, MagicMock, patch

from services.calendar.scheduler_service import SchedulerService
from services.calendar.models import (
    DayPlan, ComplexProgress, ComplexStatus, MasteryCategory, DayStatus
)


@pytest.fixture
def scheduler_service():
    """Создаёт экземпляр SchedulerService для тестов."""
    return SchedulerService()


@pytest.fixture
def mock_complex_progress():
    """Создаёт mock объект ComplexProgress."""
    progress = Mock(spec=ComplexProgress)
    progress.complex_id = "python_basics"
    progress.status = ComplexStatus.IN_PROGRESS
    progress.health_score = 75
    progress.last_reviewed_at = date.today() - timedelta(days=1)
    progress.needs_review_on_date = Mock(return_value=True)
    progress.get_mastery_category = Mock(return_value=MasteryCategory.NEEDS_PRACTICE)
    progress.get_next_review_date = Mock(return_value=date.today())
    return progress


def test_all_tasks_detailed_has_is_synthetic_flag(scheduler_service, mock_complex_progress):
    """
    ✓ Проверяет, что all_tasks_detailed содержит is_synthetic=False.
    
    CRITICAL: Это новый флаг, который фронтенд использует для фильтрации.
    """
    user_id = "test_user"
    days_count = 5
    schedule_mode = "daily"
    activity_history = {}
    available_minutes = 60
    all_progress = [mock_complex_progress]
    task_pool = {
        "python_basics": [
            {"id": "task1", "name": "Task 1"},
            {"id": "task2", "name": "Task 2"},
        ]
    }
    complex_names = {"python_basics": "Python Basics"}
    
    # Act
    schedule = scheduler_service.build_schedule_strip(
        user_id=user_id,
        days_count=days_count,
        schedule_mode=schedule_mode,
        activity_history=activity_history,
        available_minutes=available_minutes,
        all_progress=all_progress,
        task_pool=task_pool,
        complex_names=complex_names,
    )
    
    # Assert
    today_plan = next((s for s in schedule if s.is_today), None)
    assert today_plan is not None, "Should have today's plan"
    assert len(today_plan.all_tasks) > 0, "Should have tasks in all_tasks"
    
    # Ключевая проверка: флаг должен быть
    for task in today_plan.all_tasks:
        assert "is_synthetic" in task, f"Task {task} should have is_synthetic key"
        assert task["is_synthetic"] is False, f"Real task should have is_synthetic=False, got {task['is_synthetic']}"


def test_daily_mix_excluded_from_schedule_strip(scheduler_service):
    """
    ✓ Проверяет, что daily_mix комплекс исключён из schedule_strip.
    
    daily_mix фильтруется на бэкенде, поэтому не должна быть в all_tasks.
    """
    # Создаём daily_mix прогресс
    daily_mix_progress = Mock(spec=ComplexProgress)
    daily_mix_progress.complex_id = "daily_mix"
    daily_mix_progress.status = ComplexStatus.IN_PROGRESS
    daily_mix_progress.health_score = 50
    daily_mix_progress.needs_review_on_date = Mock(return_value=True)
    daily_mix_progress.get_mastery_category = Mock(return_value=MasteryCategory.NEEDS_PRACTICE)
    daily_mix_progress.get_next_review_date = Mock(return_value=date.today())
    
    real_progress = Mock(spec=ComplexProgress)
    real_progress.complex_id = "python_basics"
    real_progress.status = ComplexStatus.IN_PROGRESS
    real_progress.health_score = 75
    real_progress.needs_review_on_date = Mock(return_value=True)
    real_progress.get_mastery_category = Mock(return_value=MasteryCategory.NEEDS_PRACTICE)
    real_progress.get_next_review_date = Mock(return_value=date.today())
    
    task_pool = {
        "python_basics": [{"id": "task1", "name": "Task 1"}],
        "daily_mix": [{"id": "dm1", "name": "Daily Mix Task"}],
    }
    complex_names = {
        "python_basics": "Python Basics",
        "daily_mix": "Daily Mix",
    }
    
    # Act
    schedule = scheduler_service.build_schedule_strip(
        user_id="test_user",
        days_count=1,
        schedule_mode="daily",
        activity_history={},
        available_minutes=60,
        all_progress=[daily_mix_progress, real_progress],
        task_pool=task_pool,
        complex_names=complex_names,
    )
    
    # Assert
    today_plan = next((s for s in schedule if s.is_today), None)
    assert today_plan is not None
    
    # daily_mix должна быть отсеяна
    task_names = [t["name"] for t in today_plan.all_tasks]
    assert "Daily Mix" not in task_names, "daily_mix should be excluded from schedule_strip"
    assert "Python Basics" in task_names, "Real tasks should be included"


def test_all_tasks_detailed_contains_required_fields(scheduler_service, mock_complex_progress):
    """
    ✓ Проверяет, что all_tasks содержит все необходимые поля.
    
    Фронтенд ожидает: complex_id, name, is_completed, health_score, is_synthetic
    """
    all_progress = [mock_complex_progress]
    task_pool = {"python_basics": [{"id": "task1", "name": "Task 1"}]}
    complex_names = {"python_basics": "Python Basics"}
    
    # Act
    schedule = scheduler_service.build_schedule_strip(
        user_id="test_user",
        days_count=1,
        schedule_mode="daily",
        activity_history={},
        available_minutes=60,
        all_progress=all_progress,
        task_pool=task_pool,
        complex_names=complex_names,
    )
    
    # Assert
    today_plan = next((s for s in schedule if s.is_today), None)
    assert today_plan is not None
    assert len(today_plan.all_tasks) > 0
    
    required_fields = {"complex_id", "name", "is_completed", "health_score", "is_synthetic"}
    for task in today_plan.all_tasks:
        assert isinstance(task, dict), f"Task should be dict, got {type(task)}"
        for field in required_fields:
            assert field in task, f"Task {task} missing field: {field}"
            
        # Проверяем типы
        assert isinstance(task["complex_id"], str), f"complex_id should be str"
        assert isinstance(task["name"], str), f"name should be str"
        assert isinstance(task["is_completed"], bool), f"is_completed should be bool"
        assert isinstance(task["health_score"], (int, float)), f"health_score should be numeric"
        assert isinstance(task["is_synthetic"], bool), f"is_synthetic should be bool"


def test_is_synthetic_false_for_real_complexes(scheduler_service):
    """
    ✓ Проверяет, что все реальные комплексы имеют is_synthetic=False.
    """
    complexes = [
        {"id": "math", "name": "Mathematics"},
        {"id": "english", "name": "English"},
        {"id": "history", "name": "History"},
    ]
    
    progress_list = []
    for i, comp in enumerate(complexes):
        progress = Mock(spec=ComplexProgress)
        progress.complex_id = comp["id"]
        progress.status = ComplexStatus.IN_PROGRESS
        progress.health_score = 50 + i * 10
        progress.needs_review_on_date = Mock(return_value=True)
        progress.get_mastery_category = Mock(return_value=MasteryCategory.NEEDS_PRACTICE)
        progress.get_next_review_date = Mock(return_value=date.today())
        progress_list.append(progress)
    
    task_pool = {c["id"]: [{"id": f"{c['id']}_t1", "name": "Task 1"}] for c in complexes}
    complex_names = {c["id"]: c["name"] for c in complexes}
    
    # Act
    schedule = scheduler_service.build_schedule_strip(
        user_id="test_user",
        days_count=1,
        schedule_mode="daily",
        activity_history={},
        available_minutes=60,
        all_progress=progress_list,
        task_pool=task_pool,
        complex_names=complex_names,
    )
    
    # Assert
    today_plan = next((s for s in schedule if s.is_today), None)
    assert today_plan is not None
    
    for task in today_plan.all_tasks:
        assert task["is_synthetic"] is False, (
            f"Real complex {task['complex_id']} should have is_synthetic=False"
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
