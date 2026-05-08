"""
Тесты для блока "Расписание" календаря.

Проверяем:
1. Построение расписания с реальными данными задач
2. Отслеживание активности при выполнении задач
3. Корректность статусов дней (missed/completed/planned)
4. Режимы расписания (daily/flexible)
5. Обработку ошибок и пустых данных
"""

import pytest
import sys
from pathlib import Path
from datetime import date, timedelta, datetime

# Add desktop-app to path
sys.path.insert(0, str(Path(__file__).parent.parent / "desktop-app"))

from services.calendar.calendar_service import CalendarService
from services.calendar.scheduler_service import SchedulerService
from services.calendar.models import ComplexStatus, DayStatus


@pytest.fixture
def calendar_service(tmp_path):
    """Создать CalendarService с временными файлами."""
    service = CalendarService(
        user_id="test_user",
        data_dir=str(tmp_path)
    )
    return service


@pytest.fixture
def sample_task_pool():
    """Пример пула задач."""
    return {
        "complex_1": [
            {"task_id": "task_1", "complex_name": "Комплекс 1", "duration": 120},
            {"task_id": "task_2", "complex_name": "Комплекс 1", "duration": 150},
            {"task_id": "task_3", "complex_name": "Комплекс 1", "duration": 180},
        ],
        "complex_2": [
            {"task_id": "task_4", "complex_name": "Комплекс 2", "duration": 100},
            {"task_id": "task_5", "complex_name": "Комплекс 2", "duration": 140},
        ],
    }


class TestScheduleStripWithRealData:
    """Тесты построения расписания с реальными данными."""
    
    def test_schedule_strip_includes_real_task_counts(self, calendar_service, sample_task_pool):
        """Расписание должно содержать реальные данные о задачах."""
        # Активируем комплексы
        calendar_service.record_task_attempt(
            task_id="task_1",
            complex_id="complex_1",
            user_grading=1,
            response_time_seconds=120,
        )
        calendar_service.record_task_attempt(
            task_id="task_4",
            complex_id="complex_2",
            user_grading=1,
            response_time_seconds=100,
        )
        
        # Получаем расписание
        settings = calendar_service.get_settings()
        settings.daily_time_limit_minutes = 30
        calendar_service.save_settings(settings)
        
        all_progress = calendar_service.get_all_progress()
        activity = calendar_service.get_activity_history()
        
        schedule = calendar_service.scheduler_service.build_schedule_strip(
            user_id="test_user",
            days_count=4,
            schedule_mode="daily",
            activity_history=activity,
            available_minutes=30,
            all_progress=all_progress,
            task_pool=sample_task_pool,
        )
        
        assert len(schedule) == 5  # -1 (вчера) + 4 дня
        
        # Проверяем сегодня
        today_plan = next(d for d in schedule if d.is_today)
        assert len(today_plan.tasks) > 0
        
        # Задачи должны содержать реальные данные (только комплексы, без Daily Mix)
        tasks_text = " ".join(today_plan.tasks)
        assert "Daily Mix" not in tasks_text
        # Ожидаем, что будут показаны человекочитаемые имена реальных комплексов
        assert any(name in tasks_text for name in ["Комплекс 1", "Комплекс 2"])
    
    def test_schedule_strip_without_data_uses_fallback(self, calendar_service):
        """Без данных расписание использует упрощённый формат."""
        settings = calendar_service.get_settings()
        activity = calendar_service.get_activity_history()
        
        schedule = calendar_service.scheduler_service.build_schedule_strip(
            user_id="test_user",
            days_count=4,
            schedule_mode="daily",
            activity_history=activity,
            available_minutes=30,
            all_progress=None,  # Нет данных
            task_pool=None,
        )
        
        assert len(schedule) == 5
        
        # Проверяем сегодня
        today_plan = next(d for d in schedule if d.is_today)
        assert len(today_plan.tasks) > 0
        assert "Daily Mix" in today_plan.tasks
    
    def test_schedule_calculates_time_correctly(self, calendar_service, sample_task_pool):
        """Расписание правильно рассчитывает время на задачи."""
        # Активируем комплекс
        calendar_service.record_task_attempt(
            task_id="task_1",
            complex_id="complex_1",
            user_grading=1,
            response_time_seconds=120,
        )
        
        settings = calendar_service.get_settings()
        settings.daily_time_limit_minutes = 45  # 45 минут
        calendar_service.save_settings(settings)
        
        all_progress = calendar_service.get_all_progress()
        activity = calendar_service.get_activity_history()
        
        schedule = calendar_service.scheduler_service.build_schedule_strip(
            user_id="test_user",
            days_count=4,
            schedule_mode="daily",
            activity_history=activity,
            available_minutes=45,
            all_progress=all_progress,
            task_pool=sample_task_pool,
        )
        
        today_plan = next(d for d in schedule if d.is_today)
        
        # Проверяем, что есть и Daily Mix, и Основной фокус
        assert len(today_plan.tasks) >= 1
        
        # Future days should not be mechanically filled when no review is due.
        future_days = [d for d in schedule if d.is_future]
        for day in future_days:
            if day.status == DayStatus.PLANNED:
                assert "Daily Mix" not in day.tasks


class TestActivityTracking:
    """Тесты отслеживания активности."""
    
    def test_activity_updates_on_task_completion(self, calendar_service):
        """Активность обновляется при выполнении задачи."""
        settings = calendar_service.get_settings()
        settings.daily_time_limit_minutes = 30
        calendar_service.save_settings(settings)
        
        # Выполняем задачу
        calendar_service.record_task_attempt(
            task_id="task_1",
            complex_id="complex_1",
            user_grading=1,
            response_time_seconds=150,  # 2.5 минуты
        )
        
        # Проверяем активность
        activity = calendar_service.get_activity_history()
        today_iso = date.today().isoformat()
        
        assert today_iso in activity
        assert activity[today_iso]["tasks_attempted"] == 1
        assert activity[today_iso]["tasks_solved"] == 1
        assert activity[today_iso]["completion_percent"] == 0
    
    def test_activity_accumulates_during_day(self, calendar_service):
        """Активность накапливается в течение дня."""
        settings = calendar_service.get_settings()
        settings.daily_time_limit_minutes = 30
        calendar_service.save_settings(settings)
        
        # Выполняем несколько задач
        for i in range(3):
            calendar_service.record_task_attempt(
                task_id=f"task_{i}",
                complex_id="complex_1",
                user_grading=1,
                response_time_seconds=150,
            )
        
        activity = calendar_service.get_activity_history()
        today_iso = date.today().isoformat()
        
        assert activity[today_iso]["tasks_attempted"] == 3
        assert activity[today_iso]["tasks_solved"] == 3
        assert activity[today_iso]["seconds_spent"] == 450
        assert activity[today_iso]["completion_percent"] == 0
    
    def test_activity_caps_at_200_percent(self, calendar_service):
        """Активность не превышает 200%."""
        settings = calendar_service.get_settings()
        settings.daily_time_limit_minutes = 30
        calendar_service.save_settings(settings)
        
        # Выполняем много задач
        started = calendar_service.start_session(session_type="daily_mix")
        session_id = started["session_id"]
        for i in range(50):
            calendar_service.record_task_attempt(
                task_id=f"task_{i}",
                complex_id="complex_1",
                user_grading=1,
                response_time_seconds=150,
            )
        calendar_service.complete_session(
            session_id=session_id,
            tasks_completed=50,
            active_time_seconds=20000,
        )
        
        activity = calendar_service.get_activity_history()
        today_iso = date.today().isoformat()
        
        assert activity[today_iso]["completion_percent"] <= 200
    
    def test_failed_tasks_dont_add_activity(self, calendar_service):
        """Неуспешные задачи не добавляют активность."""
        settings = calendar_service.get_settings()
        settings.daily_time_limit_minutes = 30
        calendar_service.save_settings(settings)
        
        # Выполняем неуспешную задачу
        calendar_service.record_task_attempt(
            task_id="task_1",
            complex_id="complex_1",
            user_grading=0,  # Неуспешно
            response_time_seconds=150,
        )
        
        activity = calendar_service.get_activity_history()
        today_iso = date.today().isoformat()
        
        assert today_iso in activity
        assert activity[today_iso]["tasks_attempted"] == 1
        assert activity[today_iso]["tasks_solved"] == 0
        assert activity[today_iso]["completion_percent"] == 0


class TestDayStatuses:
    """Тесты статусов дней."""
    
    def test_yesterday_marked_as_missed_without_activity(self, calendar_service):
        """Вчера помечается как пропущенный без активности."""
        activity = calendar_service.get_activity_history()
        
        schedule = calendar_service.scheduler_service.build_schedule_strip(
            user_id="test_user",
            days_count=4,
            schedule_mode="daily",
            activity_history=activity,
            available_minutes=30,
        )
        
        yesterday = next(d for d in schedule if d.date == date.today() - timedelta(days=1))
        assert yesterday.status == DayStatus.MISSED
        assert "Пропущено" in yesterday.badges
    
    def test_yesterday_marked_as_completed_with_activity(self, calendar_service):
        """Вчера помечается как выполненный при наличии активности."""
        # Добавляем активность за вчера
        yesterday_iso = (date.today() - timedelta(days=1)).isoformat()
        calendar_service.save_activity(date.today() - timedelta(days=1), 80)
        
        activity = calendar_service.get_activity_history()
        
        schedule = calendar_service.scheduler_service.build_schedule_strip(
            user_id="test_user",
            days_count=4,
            schedule_mode="daily",
            activity_history=activity,
            available_minutes=30,
        )
        
        yesterday = next(d for d in schedule if d.date == date.today() - timedelta(days=1))
        assert yesterday.status == DayStatus.COMPLETED
    
    def test_today_always_planned(self, calendar_service):
        """Сегодня всегда имеет статус planned."""
        activity = calendar_service.get_activity_history()
        
        schedule = calendar_service.scheduler_service.build_schedule_strip(
            user_id="test_user",
            days_count=4,
            schedule_mode="daily",
            activity_history=activity,
            available_minutes=30,
        )
        
        today = next(d for d in schedule if d.is_today)
        assert today.status == DayStatus.PLANNED


class TestScheduleModes:
    """Тесты режимов расписания."""
    
    def test_daily_mode_plans_all_days(self, calendar_service):
        """В ежедневном режиме все дни планируются."""
        activity = calendar_service.get_activity_history()
        
        schedule = calendar_service.scheduler_service.build_schedule_strip(
            user_id="test_user",
            days_count=7,
            schedule_mode="daily",
            activity_history=activity,
            available_minutes=30,
        )
        
        # Все будущие дни должны быть planned
        future_days = [d for d in schedule if d.is_future]
        for day in future_days:
            assert day.status == DayStatus.PLANNED


class TestSessionCompletion:
    """Тесты завершения сессии и обновления активности."""
    
    def test_complete_session_updates_activity(self, calendar_service):
        """Завершение сессии обновляет активность."""
        # Начинаем сессию
        start_result = calendar_service.start_session(session_type="daily_mix")
        session_id = start_result["session_id"]
        
        # Завершаем сессию
        complete_result = calendar_service.complete_session(
            session_id=session_id,
            tasks_completed=5,
            active_time_seconds=900,  # 15 минут
        )
        
        assert complete_result["success"]
        assert complete_result["completion_percent"] > 0
        
        # Проверяем активность
        activity = calendar_service.get_activity_history()
        today_iso = date.today().isoformat()
        assert today_iso in activity
        assert activity[today_iso]["completion_percent"] > 0
    
    def test_complete_session_updates_streak(self, calendar_service):
        """Завершение сессии обновляет streak."""
        # Начинаем и завершаем сессию
        start_result = calendar_service.start_session(session_type="daily_mix")
        session_id = start_result["session_id"]
        
        complete_result = calendar_service.complete_session(
            session_id=session_id,
            tasks_completed=5,
            active_time_seconds=900,
        )
        
        assert complete_result["streak_days"] >= 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
