import sys
from pathlib import Path
from datetime import date, datetime, timedelta

import pytest


# Make desktop-app importable (folder name contains a hyphen)
ROOT = Path(__file__).resolve().parents[2]
DESKTOP_APP = ROOT / "desktop-app"
if str(DESKTOP_APP) not in sys.path:
    sys.path.append(str(DESKTOP_APP))

from services.calendar.scheduler_service import SchedulerService  # type: ignore
from services.calendar.models import (  # type: ignore
    ComplexProgress,
    ComplexStatus,
    DailyPlan,
    DayStatus,
    ScheduledTask,
    TaskType,
)


@pytest.fixture
def scheduler():
    return SchedulerService()


def test_build_schedule_strip_includes_date_fields_and_flags(scheduler):
    days_count = 3  # yesterday, today, tomorrow, +1 future (i=2)
    activity_history = {}  # no activity -> yesterday is missed

    schedule = scheduler.build_schedule_strip(
        user_id="user1",
        days_count=days_count,
        schedule_mode="daily",
        activity_history=activity_history,
        available_minutes=30,
    )

    # range(-1, days_count) => days_count + 1 entries
    assert len(schedule) == days_count + 1

    today_iso = date.today().isoformat()

    yesterday = schedule[0]
    today = schedule[1]
    tomorrow = schedule[2]

    # Basic field presence
    for day in schedule:
        assert day.day_num > 0
        assert day.month
        assert day.date.isoformat()

    # Flags
    assert yesterday.is_today is False
    assert yesterday.is_future is False
    assert today.is_today is True
    assert today.is_future is False
    assert tomorrow.is_future is True

    # Statuses and badges
    assert yesterday.status == DayStatus.MISSED
    assert "Пропущено" in yesterday.badges
    assert today.status == DayStatus.PLANNED
    assert "Daily Mix" in today.tasks
    assert "Основной фокус" in today.tasks

    # Future day should be planned or rest day (weekend in flexible mode would be rest)
    assert tomorrow.status in {DayStatus.PLANNED, DayStatus.REST_DAY}
    assert "Daily Mix" in tomorrow.tasks


def test_schedule_strip_spaces_single_weak_complex_across_week(scheduler):
    progress = [
        ComplexProgress(
            complex_id="anatomy",
            user_id="user1",
            status=ComplexStatus.IN_PROGRESS,
            health_score=0.62,
            last_reviewed_at=None,
        )
    ]

    schedule = scheduler.build_schedule_strip(
        user_id="user1",
        days_count=7,
        schedule_mode="daily",
        activity_history={},
        available_minutes=30,
        all_progress=progress,
        task_pool={"anatomy": [{"task_id": "a1", "complex_name": "Anatomy"}]},
        complex_names={"anatomy": "Anatomy"},
    )

    today = date.today()
    planned_offsets = [
        (day.date - today).days
        for day in schedule
        if not day.is_future or day.date >= today
        if day.all_tasks
    ]

    assert planned_offsets == [0, 1, 3, 6]


def test_schedule_strip_does_not_fill_week_when_review_not_due(scheduler):
    progress = [
        ComplexProgress(
            complex_id="stable",
            user_id="user1",
            status=ComplexStatus.MASTERED,
            health_score=0.98,
            last_reviewed_at=datetime.now() - timedelta(days=1),
        )
    ]

    schedule = scheduler.build_schedule_strip(
        user_id="user1",
        days_count=7,
        schedule_mode="daily",
        activity_history={},
        available_minutes=30,
        all_progress=progress,
        task_pool={"stable": [{"task_id": "s1", "complex_name": "Stable"}]},
        complex_names={"stable": "Stable"},
    )

    future_and_today = [day for day in schedule if day.date >= date.today()]
    assert all(not day.tasks and not day.all_tasks for day in future_and_today)


def test_schedule_strip_pushes_overloaded_reviews_to_later_days(scheduler):
    progress = [
        ComplexProgress(
            complex_id=f"critical_{idx}",
            user_id="user1",
            status=ComplexStatus.IN_PROGRESS,
            health_score=0.3,
            last_reviewed_at=datetime.now() - timedelta(days=1),
        )
        for idx in range(6)
    ]

    schedule = scheduler.build_schedule_strip(
        user_id="user1",
        days_count=2,
        schedule_mode="daily",
        activity_history={},
        available_minutes=30,
        all_progress=progress,
        task_pool={
            f"critical_{idx}": [{"task_id": f"c{idx}", "complex_name": f"C{idx}"}]
            for idx in range(6)
        },
        complex_names={f"critical_{idx}": f"C{idx}" for idx in range(6)},
    )

    today = next(day for day in schedule if day.is_today)
    tomorrow = next(day for day in schedule if day.date == date.today() + timedelta(days=1))

    assert len(today.all_tasks) == 4
    assert len(tomorrow.all_tasks) == 4


def test_daily_plan_to_dict_keeps_main_focus_frontend_aliases():
    main_focus = ScheduledTask(
        task_id="task-1",
        complex_id="complex-1",
        complex_name="Комплекс 1",
        task_type=TaskType.MAIN,
        priority=1.0,
        estimated_duration_seconds=600,
    )
    plan = DailyPlan(
        date=date(2026, 4, 5),
        daily_mix=[main_focus],
        main_focus=main_focus,
        main_focus_complex_name="Комплекс 1",
        main_focus_tasks_count=4,
        total_estimated_minutes=30,
        daily_mix_estimated_minutes=10,
        main_focus_estimated_minutes=20,
    )

    payload = plan.to_dict()

    assert payload["main_focus_complex_name"] == "Комплекс 1"
    assert payload["main_focus_name"] == "Комплекс 1"
    assert payload["main_focus_tasks_count"] == 4
    assert payload["main_focus_count"] == 4
    assert payload["main_focus_estimated_minutes"] == 20
    assert payload["main_focus_minutes"] == 20


# ✅ НОВЫЕ ТЕСТЫ ДЛЯ ИСПРАВЛЕНИЙ ОБЛАСТИ 6.2

class TestProblem1Interleaving:
    """Тесты для Проблемы #1: Защита от бесконечного цикла интерливинга."""
    
    def test_interleaving_with_asymmetric_distribution(self, scheduler):
        """Тест: интерливинг с асимметричным распределением задач."""
        from services.calendar.models import ScheduledTask, TaskType
        
        # Создаём асимметричное распределение: A=1, B=1, C=1, но запрашиваем 10
        tasks_a = [ScheduledTask(
            task_id="a1", complex_id="A", complex_name="Complex A",
            task_type=TaskType.MAIN, priority=1.0, estimated_duration_seconds=150
        )]
        tasks_b = [ScheduledTask(
            task_id="b1", complex_id="B", complex_name="Complex B",
            task_type=TaskType.MAIN, priority=0.9, estimated_duration_seconds=150
        )]
        tasks_c = [ScheduledTask(
            task_id="c1", complex_id="C", complex_name="Complex C",
            task_type=TaskType.MAIN, priority=0.8, estimated_duration_seconds=150
        )]
        
        all_tasks = tasks_a + tasks_b + tasks_c
        
        # Когда уникальных задач меньше цели, не дублируем их: старт сессии
        # работает с уникальными task_refs.
        result = scheduler._apply_interleaving(all_tasks, count=10)
        
        assert len(result) == 3, f"Expected 3 unique tasks, got {len(result)}"
        assert all(isinstance(t, ScheduledTask) for t in result)
    
    def test_interleaving_single_complex_remaining(self, scheduler):
        """Тест: когда остаётся один комплекс, берём без ограничений."""
        from services.calendar.models import ScheduledTask, TaskType
        
        # Создаём задачи: A=3, B=0, C=0 (остаётся только A)
        tasks = [
            ScheduledTask(
                task_id=f"a{i}", complex_id="A", complex_name="Complex A",
                task_type=TaskType.MAIN, priority=1.0, estimated_duration_seconds=150
            )
            for i in range(1, 4)
        ]
        
        # Не дублируем задачи одного комплекса, если реальных задач меньше цели.
        result = scheduler._apply_interleaving(tasks, count=5)
        
        assert len(result) == 3
        assert all(t.complex_id == "A" for t in result)


class TestProblem2MinimumTime:
    """Тесты для Проблемы #2: Проверка минимального требуемого времени."""
    
    def test_insufficient_time_raises_error(self, scheduler):
        """Тест: недостаточное время должно вызвать ValueError."""
        from services.calendar.models import ComplexProgress, ComplexStatus
        
        # Создаём прогресс
        progress = [ComplexProgress(
            complex_id="test_complex",
            user_id="user1",
            status=ComplexStatus.IN_PROGRESS,
            health_score=0.5,
        )]
        
        # ✅ НОВАЯ ВАЛИДАЦИЯ: 5 минут < 10 минут (минимум) → должен выбросить ValueError
        with pytest.raises(ValueError, match="Недостаточно времени"):
            scheduler.build_daily_plan(
                user_id="user1",
                available_minutes=5,  # ❌ Недостаточно
                all_progress=progress,
                task_pool={"test_complex": []}
            )
    
    def test_minimum_time_accepted(self, scheduler):
        """Тест: минимум 10 минут принимается без ошибок."""
        from services.calendar.models import ComplexProgress, ComplexStatus
        
        progress = [ComplexProgress(
            complex_id="test_complex",
            user_id="user1",
            status=ComplexStatus.IN_PROGRESS,
            health_score=0.5,
        )]
        
        # ✅ 10 минут = минимум → должно работать
        plan = scheduler.build_daily_plan(
            user_id="user1",
            available_minutes=10,  # ✅ Соответствует минимуму
            all_progress=progress,
            task_pool={"test_complex": []}
        )
        
        assert plan is not None
    
    def test_various_time_boundaries(self, scheduler):
        """Тест: граничные условия времени."""
        from services.calendar.models import ComplexProgress, ComplexStatus
        
        progress = [ComplexProgress(
            complex_id="test_complex",
            user_id="user1",
            status=ComplexStatus.IN_PROGRESS,
            health_score=0.5,
        )]
        
        # ❌ 8 минут - ниже минимума
        with pytest.raises(ValueError):
            scheduler.build_daily_plan(
                user_id="user1",
                available_minutes=8,
                all_progress=progress,
                task_pool={"test_complex": []}
            )
        
        # ✅ 10 минут - минимум
        plan = scheduler.build_daily_plan(
            user_id="user1",
            available_minutes=10,
            all_progress=progress,
            task_pool={"test_complex": []}
        )
        assert plan is not None
        
        # ✅ 15 минут - выше минимума
        plan = scheduler.build_daily_plan(
            user_id="user1",
            available_minutes=15,
            all_progress=progress,
            task_pool={"test_complex": []}
        )
        assert plan is not None


class TestProblem3UnifiedPadding:
    """Тесты для Проблемы #3: Унификация логики дублирования."""
    
    def test_pad_tasks_to_count(self, scheduler):
        """Тест: унифицированный метод дублирования."""
        from services.calendar.models import ScheduledTask, TaskType
        
        # Создаём 3 задачи
        tasks = [
            ScheduledTask(
                task_id=f"task{i}", complex_id="C", complex_name="Complex",
                task_type=TaskType.MAIN, priority=1.0, estimated_duration_seconds=150
            )
            for i in range(1, 4)
        ]
        
        # Не дополняем до 7 дубликатами: план должен отражать реальные задачи.
        result = scheduler._pad_tasks_to_count(tasks, 7)
        
        assert len(result) == 3
        assert result == tasks
    
    def test_pad_tasks_already_sufficient(self, scheduler):
        """Тест: если задач достаточно, не дублируем."""
        from services.calendar.models import ScheduledTask, TaskType
        
        tasks = [
            ScheduledTask(
                task_id=f"task{i}", complex_id="C", complex_name="Complex",
                task_type=TaskType.MAIN, priority=1.0, estimated_duration_seconds=150
            )
            for i in range(1, 6)
        ]
        
        # ✅ Уже 5 задач, запрашиваем 5 → нет дублирования
        result = scheduler._pad_tasks_to_count(tasks, 5)
        
        assert len(result) == 5
        assert result == tasks
    
    def test_pad_empty_tasks(self, scheduler):
        """Тест: пустой список остаётся пустым."""
        result = scheduler._pad_tasks_to_count([], 5)
        assert result == []


if __name__ == "__main__":
    pytest.main([__file__])
