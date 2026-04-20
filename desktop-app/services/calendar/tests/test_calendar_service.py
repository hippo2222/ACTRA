"""
Tests for Calendar Service.

Тестирует:
- HealthScore расчёты
- Scheduler логику
- CalendarService интеграцию
"""

import pytest
import tempfile
import shutil
from datetime import datetime, date, timedelta
from pathlib import Path

from flask import Flask

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from api.calendar_api import create_calendar_routes
from services.calendar.models import (
    ComplexProgress,
    TaskAttempt,
    Session,
    UserCalendarSettings,
    ComplexStatus,
    SessionType,
    ScheduleMode,
    TaskType,
)
from services.calendar.health_score_service import HealthScoreService
from services.calendar.scheduler_service import SchedulerService
from services.calendar.notification_service import NotificationService
from services.calendar.calendar_service import CalendarService


class TestHealthScoreService:
    """Тесты для HealthScoreService."""
    
    def setup_method(self):
        self.service = HealthScoreService(use_fsrs=False)
    
    def test_decay_health_zero_days(self):
        """0 дней = 100% здоровья."""
        health = self.service.calculate_decay_health(0)
        assert health == 1.0
    
    def test_decay_health_7_days(self):
        """7 дней ≈ 35% здоровья."""
        health = self.service.calculate_decay_health(7)
        assert 0.30 < health < 0.40
    
    def test_decay_health_14_days(self):
        """14 дней ≈ 12% здоровья."""
        health = self.service.calculate_decay_health(14)
        assert 0.10 < health < 0.15
    
    def test_is_critical(self):
        """Проверка критического состояния."""
        assert self.service.is_critical(0.64) is True
        assert self.service.is_critical(0.65) is False
        assert self.service.is_critical(0.66) is False
    
    def test_get_review_priority(self):
        """Приоритет = 1 - health."""
        assert self.service.get_review_priority(1.0) == 0.0
        assert self.service.get_review_priority(0.5) == 0.5
        assert self.service.get_review_priority(0.0) == 1.0
    
    def test_infer_confidence(self):
        """Инферирование confidence из grading."""
        assert self.service.infer_confidence_from_grading(1) == 3
        assert self.service.infer_confidence_from_grading(0) == 1
    
    def test_estimate_recovery_time(self):
        """Оценка времени на восстановление."""
        # 65% → 90% = 25% gap = ~12.5 минут
        minutes = self.service.estimate_recovery_time(0.65, 0.90)
        assert 10 <= minutes <= 15
        
        # Уже выше цели
        assert self.service.estimate_recovery_time(0.95, 0.90) == 0


class TestHealthScoreFSRS:
    """Тесты для FSRS модели."""
    
    def setup_method(self):
        self.service = HealthScoreService(use_fsrs=True)
    
    def test_stability_calculation(self):
        """Стабильность растёт с высокими ratings."""
        initial = 1.0
        
        # Высокие ratings (5,5,5) увеличивают стабильность
        high_ratings = [5, 5, 5]
        stability_high = self.service.calculate_stability(initial, high_ratings)
        
        # Низкие ratings (1,1,1) уменьшают стабильность
        low_ratings = [1, 1, 1]
        stability_low = self.service.calculate_stability(initial, low_ratings)
        
        assert stability_high > initial
        assert stability_low < initial
    
    def test_retrievability_calculation(self):
        """Retrievability падает со временем."""
        stability = 10.0  # 10 дней
        
        r_0 = self.service.calculate_retrievability(0, stability)
        r_10 = self.service.calculate_retrievability(10, stability)
        r_20 = self.service.calculate_retrievability(20, stability)
        
        assert r_0 == 1.0
        assert 0.45 < r_10 < 0.55  # ~50% при days == stability
        assert r_20 < r_10


class TestSchedulerService:
    """Тесты для SchedulerService."""
    
    def setup_method(self):
        self.service = SchedulerService()
    
    def test_daily_mix_size_20_min(self):
        """20 минут → 2-3 задачи."""
        count = self.service.calculate_daily_mix_size(20)
        assert 2 <= count <= 4
    
    def test_daily_mix_size_30_min(self):
        """30 минут → 3-4 задачи."""
        count = self.service.calculate_daily_mix_size(30)
        assert 3 <= count <= 5
    
    def test_daily_mix_size_45_min(self):
        """45 минут → 5-6 задач."""
        count = self.service.calculate_daily_mix_size(45)
        assert 4 <= count <= 7
    
    def test_select_review_tasks_empty(self):
        """Нет пройденных комплексов → пустой список."""
        progress = [
            ComplexProgress(complex_id="c1", user_id="u1", status=ComplexStatus.NEW)
        ]
        tasks = self.service.select_review_tasks(progress, {}, 5)
        assert tasks == []
    
    def test_select_review_tasks_prioritizes_low_health(self):
        """Низкий health = высокий приоритет."""
        progress = [
            ComplexProgress(
                complex_id="c1", user_id="u1",
                status=ComplexStatus.IN_PROGRESS,
                health_score=0.9
            ),
            ComplexProgress(
                complex_id="c2", user_id="u1",
                status=ComplexStatus.IN_PROGRESS,
                health_score=0.3  # Критический
            ),
        ]
        task_pool = {
            "c1": [{"task_id": "t1", "complex_name": "Complex 1"}],
            "c2": [{"task_id": "t2", "complex_name": "Complex 2"}],
        }
        
        tasks = self.service.select_review_tasks(progress, task_pool, 2)
        
        # Первая задача должна быть из c2 (низкий health)
        assert len(tasks) == 2
        assert tasks[0].complex_id == "c2"
    
    def test_structure_daily_mix(self):
        """Структура: разминка → основная → закрепление."""
        from services.calendar.models import ScheduledTask
        
        tasks = [
            ScheduledTask(task_id="t1", complex_id="c1", task_type=TaskType.MAIN),
            ScheduledTask(task_id="t2", complex_id="c1", task_type=TaskType.WARMUP),
            ScheduledTask(task_id="t3", complex_id="c1", task_type=TaskType.CONSOLIDATION),
            ScheduledTask(task_id="t4", complex_id="c1", task_type=TaskType.MAIN),
        ]
        
        structured = self.service.structure_daily_mix(tasks)
        
        # Разминка должна быть первой
        assert structured[0].task_type == TaskType.WARMUP


class TestNotificationService:
    """Тесты для NotificationService."""
    
    def setup_method(self):
        self.service = NotificationService()
    
    def test_health_drop_notification(self):
        """Уведомление о падении здоровья."""
        progress = [
            ComplexProgress(
                complex_id="c1", user_id="u1",
                status=ComplexStatus.IN_PROGRESS,
                health_score=0.60  # Критический
            ),
        ]
        settings = UserCalendarSettings(user_id="u1")
        
        notifications = self.service.generate_notifications(
            user_id="u1",
            settings=settings,
            all_progress=progress,
            complex_names={"c1": "Нейрорадиология"},
        )
        
        assert len(notifications) >= 1
        assert notifications[0].type.value == "health_drop"
        assert "Нейрорадиология" in notifications[0].title
    
    def test_health_drop_notification_skips_orphaned_complex(self):
        """Health-drop notification should not be created for stale progress records."""
        progress = [
            ComplexProgress(
                complex_id="orphan_complex", user_id="u1",
                status=ComplexStatus.IN_PROGRESS,
                health_score=0.40
            ),
        ]
        settings = UserCalendarSettings(user_id="u1")

        notifications = self.service.generate_notifications(
            user_id="u1",
            settings=settings,
            all_progress=progress,
            complex_names={"c1": "Known Complex"},
        )

        health_notifications = [n for n in notifications if n.type.value == "health_drop"]
        assert health_notifications == []

    def test_streak_milestone(self):
        """Уведомление о milestone streak."""
        settings = UserCalendarSettings(user_id="u1", streak_days=7)
        
        notifications = self.service.generate_notifications(
            user_id="u1",
            settings=settings,
            all_progress=[],
        )
        
        streak_notif = [n for n in notifications if n.type.value == "streak_milestone"]
        assert len(streak_notif) == 1
        assert "Неделя" in streak_notif[0].title
    
    def test_mode_suggestion_at_30_days(self):
        """Предложение гибкого режима после 30 дней."""
        settings = UserCalendarSettings(
            user_id="u1",
            streak_days=30,
            schedule_mode=ScheduleMode.DAILY,
        )
        
        notifications = self.service.generate_notifications(
            user_id="u1",
            settings=settings,
            all_progress=[],
        )
        
        mode_notif = [n for n in notifications if n.type.value == "mode_suggestion"]
        assert len(mode_notif) == 1
        assert "3–4 раза в неделю" in mode_notif[0].message


class TestCalendarServiceIntegration:
    """Интеграционные тесты для CalendarService."""
    
    def setup_method(self):
        self.temp_dir = tempfile.mkdtemp()
        self.service = CalendarService(
            data_dir=self.temp_dir,
            user_id="test_user",
        )
    
    def teardown_method(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_settings_default(self):
        """Настройки по умолчанию."""
        settings = self.service.get_settings()
        
        assert settings.user_id == "test_user"
        assert settings.daily_time_limit_minutes == 30
        assert settings.schedule_mode == ScheduleMode.DAILY
        assert settings.streak_days == 0
    
    def test_update_time_limit(self):
        """Обновление лимита времени."""
        result = self.service.update_time_limit(45)
        
        assert result["success"] is True
        
        settings = self.service.get_settings()
        assert settings.daily_time_limit_minutes == 45
    
    def test_switch_schedule_mode(self):
        """Переключение режима (flexible removed — always stays DAILY)."""
        result = self.service.switch_schedule_mode("flexible")
        
        assert result["success"] is True
        
        settings = self.service.get_settings()
        assert settings.schedule_mode == ScheduleMode.DAILY
    
    def test_complex_progress_crud(self):
        """CRUD операции с прогрессом комплекса."""
        # Create
        progress = ComplexProgress(
            complex_id="test_complex",
            user_id="test_user",
            status=ComplexStatus.IN_PROGRESS,
            health_score=0.85,
        )
        self.service.save_complex_progress(progress)
        
        # Read
        loaded = self.service.get_complex_progress("test_complex")
        assert loaded is not None
        assert loaded.health_score == 0.85
        
        # Update
        loaded.health_score = 0.70
        self.service.save_complex_progress(loaded)
        
        reloaded = self.service.get_complex_progress("test_complex")
        assert reloaded.health_score == 0.70

    def test_first_attempt_marks_in_progress_and_exposes_current_complex(self):
        """Первая попытка ставит статус in_progress и даёт main_focus в API today."""

        class StubComplex:
            def __init__(self):
                self.id = "c1"
                self.name = "Test Complex"
                self.status = "in_progress"
                self.tasks = [{"task_id": "t1", "duration": 150}]

            def get(self, key, default=None):
                return getattr(self, key, default)

        class StubComplexService:
            def __init__(self):
                self.complexes = [StubComplex()]

            def get_all_complexes(self):
                return self.complexes

        # Регистрируем API с подставленным сервисом комплексов
        app = Flask(__name__)
        create_calendar_routes(app, self.service, complex_service=StubComplexService())

        # До первой попытки прогресса нет
        assert self.service.get_complex_progress("c1") is None

        # Фиксируем первую попытку задачи комплекса
        self.service.record_task_attempt(
            task_id="t1",
            complex_id="c1",
            user_grading=1,
            response_time_seconds=5,
        )

        # Прогресс создан и помечен in_progress
        progress = self.service.get_complex_progress("c1")
        assert progress is not None
        assert progress.status == ComplexStatus.IN_PROGRESS

        # API /today возвращает main_focus по текущему комплексу
        with app.test_client() as client:
            resp = client.get("/api/calendar/today")
            assert resp.status_code == 200
            data = resp.get_json()

        assert data.get("success") is True
        daily_plan = data.get("daily_plan") or {}
        assert daily_plan.get("main_focus") is not None
        assert daily_plan["main_focus"].get("complex_id") == "c1"
        assert daily_plan.get("main_focus_complex_name") in {"Test Complex", "c1"}
    
    def test_freeze_complex(self):
        """Заморозка комплекса."""
        # Сначала создаём прогресс
        progress = ComplexProgress(
            complex_id="freeze_test",
            user_id="test_user",
            status=ComplexStatus.IN_PROGRESS,
        )
        self.service.save_complex_progress(progress)
        
        # Замораживаем
        result = self.service.freeze_complex("freeze_test", days=30)
        
        assert result["success"] is True
        
        loaded = self.service.get_complex_progress("freeze_test")
        assert loaded.status == ComplexStatus.FROZEN
        assert loaded.frozen_until is not None

    def test_freeze_requires_in_progress(self):
        """Нельзя заморозить комплекс, который ещё не активирован (NEW)."""
        progress = ComplexProgress(
            complex_id="freeze_new",
            user_id="test_user",
            status=ComplexStatus.NEW,
        )
        self.service.save_complex_progress(progress)

        result = self.service.freeze_complex("freeze_new", days=30)
        assert result["success"] is False
        assert result.get("error") == "complex_not_active"
    
    def test_record_task_attempt(self):
        """Запись попытки задачи."""
        result = self.service.record_task_attempt(
            task_id="task_1",
            complex_id="complex_1",
            user_grading=1,
            response_time_seconds=45.5,
        )
        
        assert result["success"] is True
        
        progress = self.service.get_complex_progress("complex_1")
        assert progress is not None
        assert progress.total_attempts == 1
        assert progress.total_tasks_completed == 1
        assert progress.status == ComplexStatus.IN_PROGRESS

    def test_first_failed_attempt_does_not_activate_complex(self):
        """Первая неуспешная попытка не должна активировать комплекс."""
        result = self.service.record_task_attempt(
            task_id="task_1",
            complex_id="complex_fail_first",
            user_grading=0,
            response_time_seconds=10,
        )

        assert result["success"] is True

        progress = self.service.get_complex_progress("complex_fail_first")
        assert progress is not None
        assert progress.total_attempts == 1
        assert progress.total_tasks_completed == 0
        assert progress.status == ComplexStatus.NEW

        # После первой успешной попытки активируется
        self.service.record_task_attempt(
            task_id="task_2",
            complex_id="complex_fail_first",
            user_grading=1,
            response_time_seconds=10,
        )
        progress = self.service.get_complex_progress("complex_fail_first")
        assert progress.status == ComplexStatus.IN_PROGRESS
    
    def test_session_flow(self):
        """Полный цикл сессии."""
        # Начинаем
        start_result = self.service.start_session(
            session_type="daily_mix",
        )
        
        assert "session_id" in start_result
        session_id = start_result["session_id"]
        
        # Завершаем
        complete_result = self.service.complete_session(
            session_id=session_id,
            tasks_completed=5,
            active_time_seconds=600,
        )
        
        assert complete_result["success"] is True
        assert complete_result["streak_days"] == 1
    
    def test_get_today_plan(self):
        """Получение плана на сегодня."""
        # Создаём прогресс
        progress = ComplexProgress(
            complex_id="c1",
            user_id="test_user",
            status=ComplexStatus.IN_PROGRESS,
            health_score=0.60,
            last_reviewed_at=datetime.now() - timedelta(days=5),
        )
        self.service.save_complex_progress(progress)
        
        # Получаем план
        task_pool = {
            "c1": [
                {"task_id": "t1", "complex_name": "Test Complex", "duration": 150},
                {"task_id": "t2", "complex_name": "Test Complex", "duration": 150},
            ]
        }
        
        result = self.service.get_today_plan(
            task_pool=task_pool,
            complex_names={"c1": "Test Complex"},
        )
        
        assert "daily_plan" in result
        assert "notifications" in result
        assert "health_summary" in result
        assert "schedule_strip" in result
    
    def test_health_summary_hides_orphaned_complex_progress(self):
        """Health summary should skip stale progress records without a live complex."""
        known = ComplexProgress(
            complex_id="known_complex",
            user_id="test_user",
            status=ComplexStatus.IN_PROGRESS,
            health_score=0.60,
        )
        orphan = ComplexProgress(
            complex_id="orphan_complex",
            user_id="test_user",
            status=ComplexStatus.IN_PROGRESS,
            health_score=0.20,
        )

        summary = self.service._build_health_summary(
            [known, orphan],
            {"known_complex": "Known Complex"},
        )

        assert [item["complex_id"] for item in summary.complexes] == ["known_complex"]
        assert summary.critical_count == 1
        assert summary.overall_health == pytest.approx(0.60)

    def test_schedule_strip_hides_orphaned_complex_progress(self):
        """Schedule strip should not expose stale complex ids as visible task names."""
        known = ComplexProgress(
            complex_id="known_complex",
            user_id="test_user",
            status=ComplexStatus.IN_PROGRESS,
            health_score=0.60,
            last_reviewed_at=datetime.now() - timedelta(days=3),
        )
        orphan = ComplexProgress(
            complex_id="orphan_complex",
            user_id="test_user",
            status=ComplexStatus.IN_PROGRESS,
            health_score=0.20,
            last_reviewed_at=datetime.now() - timedelta(days=5),
        )

        schedule = self.service.scheduler_service.build_schedule_strip(
            user_id="test_user",
            days_count=3,
            schedule_mode=ScheduleMode.DAILY.value,
            activity_history={},
            available_minutes=30,
            all_progress=[known, orphan],
            task_pool={"known_complex": [{"task_id": "t1", "complex_name": "Known Complex"}]},
            complex_names={"known_complex": "Known Complex"},
        )

        today_plan = next(day for day in schedule if day.is_today)
        task_names = [task["name"] for task in today_plan.all_tasks]

        assert task_names == ["Known Complex"]
        assert "orphan_complex" not in task_names

    def test_schedule_strip_stays_empty_when_only_orphaned_progress_exists(self):
        """If no live complex progress remains, the UI should receive an empty schedule state."""
        orphan = ComplexProgress(
            complex_id="orphan_complex",
            user_id="test_user",
            status=ComplexStatus.IN_PROGRESS,
            health_score=0.20,
            last_reviewed_at=datetime.now() - timedelta(days=5),
        )

        schedule = self.service.scheduler_service.build_schedule_strip(
            user_id="test_user",
            days_count=3,
            schedule_mode=ScheduleMode.DAILY.value,
            activity_history={},
            available_minutes=30,
            all_progress=[orphan],
            task_pool={"known_complex": [{"task_id": "t1", "complex_name": "Known Complex"}]},
            complex_names={"known_complex": "Known Complex"},
        )

        today_plan = next(day for day in schedule if day.is_today)

        assert today_plan.all_tasks == []
        assert today_plan.tasks == []

    def test_activity_heatmap(self):
        """Данные для heatmap."""
        # Сохраняем активность
        today = date.today()
        self.service.save_activity(today, 100)
        self.service.save_activity(today - timedelta(days=1), 80)
        
        # Получаем данные
        activity = self.service.get_activity_for_heatmap(days=7)
        
        assert len(activity) > 0
        
        today_entry = [a for a in activity if a["is_today"]]
        assert len(today_entry) == 1
        assert today_entry[0]["completion_percent"] == 100


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
