"""
Unit тесты для исправления конфликта формата activity.json (Проблема #1).

Проверяют:
1. Новый формат записи данных (словарь вместо числа)
2. Отсутствие TypeError при record + complete_session
3. Сохранение всех данных (не потеря информации)
4. Миграция старых данных если встретятся
"""

import pytest
import json
import tempfile
import sys
from pathlib import Path
from datetime import datetime, date, timedelta
from unittest.mock import Mock, patch, MagicMock

# Добавляем пути для импорта
desktop_app_path = Path(__file__).parent.parent.parent / "desktop-app"
sys.path.insert(0, str(desktop_app_path))

# Импортируем тестируемые классы
from services.calendar.calendar_service import CalendarService
from services.calendar.models import ComplexProgress, ComplexStatus


class TestActivityFormatUnification:
    """Тесты для унификации формата activity.json"""
    
    @pytest.fixture
    def temp_data_dir(self):
        """Создать временную папку для тестов"""
        with tempfile.TemporaryDirectory() as tmpdir:
            data_dir = Path(tmpdir)
            (data_dir / "user_calendar").mkdir(parents=True, exist_ok=True)
            yield str(data_dir)
    
    @pytest.fixture
    def calendar_service(self, temp_data_dir):
        """Создать экземпляр CalendarService"""
        service = CalendarService(
            data_dir=temp_data_dir,
            user_id="test_user",
            use_fsrs=False
        )
        return service
    
    def test_record_task_attempt_writes_dict(self, calendar_service):
        """
        Test 1: record_task_attempt должна писать словарь в activity.json
        
        ✓ ПРОВЕРЯЕТ: Что format правильный после первой попытки
        """
        # Arrange
        task_id = "task_001"
        complex_id = "complex_001"
        
        # Act
        result = calendar_service.record_task_attempt(
            task_id=task_id,
            complex_id=complex_id,
            user_grading=1,
            response_time_seconds=45
        )
        
        # Assert
        assert result["success"] is True
        
        # Проверяем что activity.json содержит словарь, а не число
        activity = calendar_service.get_activity_history()
        today_iso = date.today().isoformat()
        
        assert today_iso in activity
        assert isinstance(activity[today_iso], dict), "activity должна быть словарём"
        assert activity[today_iso]["tasks_attempted"] == 1
        assert activity[today_iso]["tasks_solved"] == 1
        assert activity[today_iso]["seconds_spent"] == 45
        assert activity[today_iso]["completion_percent"] == 0
        assert isinstance(activity[today_iso]["session_ids"], list)
    
    def test_complete_session_updates_dict_not_overwrites(self, calendar_service):
        """
        Test 2: complete_session должна обновлять словарь, а не перезаписывать его
        
        ✓ ПРОВЕРЯЕТ: Отсутствие TypeError и что данные от record_task_attempt сохраняются
        """
        # Arrange
        task_id = "task_001"
        complex_id = "complex_001"
        
        # Регистрируем сессию
        started = calendar_service.start_session("daily_mix")
        session_id = started["session_id"]
        
        # Сначала записываем попытку
        calendar_service.record_task_attempt(
            task_id=task_id,
            complex_id=complex_id,
            user_grading=1,
            response_time_seconds=45
        )
        
        # Act - завершаем сессию (не должно быть TypeError!)
        result = calendar_service.complete_session(
            session_id=session_id,
            tasks_completed=1,
            active_time_seconds=1200  # 20 минут
        )
        
        # Assert
        assert result["success"] is True
        assert "completion_percent" in result
        
        # Проверяем что данные от record_task_attempt сохранились
        activity = calendar_service.get_activity_history()
        today_iso = date.today().isoformat()
        
        assert isinstance(activity[today_iso], dict), "activity должна быть словарём"
        # Проверяем что старые данные не потеряны
        assert activity[today_iso]["tasks_attempted"] == 1, "tasks_attempted должна быть сохранена"
        assert activity[today_iso]["tasks_solved"] == 1, "tasks_solved должна быть сохранена"
        assert activity[today_iso]["seconds_spent"] == 45, "seconds_spent должна быть сохранена"
        # Проверяем что новые данные добавлены
        # completion_percent = 1200 / (30 * 60) * 100 = 1200 / 1800 * 100 = 66.67%
        assert 60 < activity[today_iso]["completion_percent"] < 70, f"completion_percent должна быть ~66%, получена {activity[today_iso]['completion_percent']}"
        assert session_id in activity[today_iso]["session_ids"]
    
    def test_no_type_error_on_workflow(self, calendar_service):
        """
        Test 3: Полный workflow - record + complete - не должно быть TypeError
        
        ✓ ПРОВЕРЯЕТ: Что конфликт формата fix работает
        """
        # Arrange - регистрируем сессию
        started = calendar_service.start_session("daily_mix")
        session_id = started["session_id"]
        
        # Act & Assert - ничего не должно упасть!
        try:
            # Запись попытки
            result1 = calendar_service.record_task_attempt(
                task_id="task_001",
                complex_id="complex_001",
                user_grading=1,
                response_time_seconds=45
            )
            assert result1["success"]
            
            # Завершение сессии
            result2 = calendar_service.complete_session(
                session_id=session_id,
                tasks_completed=1,
                active_time_seconds=1200
            )
            assert result2["success"]
            
        except TypeError as e:
            pytest.fail(f"TypeError не должна быть при нормальном workflow: {e}")
    
    def test_old_numeric_entries_are_sanitized_to_defaults(self, calendar_service):
        """
        Test 4: Старые числовые записи приводятся к дефолтному dict-формату.

        ✓ ПРОВЕРЯЕТ: Числа больше не трактуются как completion_percent.
        """
        # Arrange - создаём старый формат данных вручную
        # Используем дату близко к сегодня чтобы она была в истории
        old_activity = {}
        
        # Добавляем старые числовые данные
        for i in range(5, 0, -1):
            old_date = (date.today() - timedelta(days=i)).isoformat()
            old_activity[old_date] = 50 + i * 10  # 60, 70, 80, 90, 100
        
        # Сохраняем старый формат
        calendar_service._save_json(calendar_service.activity_path, old_activity)
        
        # Act - вызовем record_task_attempt который должен обнаружить и мигрировать
        today = date.today().isoformat()
        calendar_service.record_task_attempt(
            task_id="task_001",
            complex_id="complex_001",
            user_grading=1,
            response_time_seconds=45
        )
        
        # Assert - проверяем что старые числовые данные санитизируются
        activity = calendar_service.get_activity_history()

        # Проверяем что новая дата в правильном формате
        assert isinstance(activity[today], dict), f"{today} должна быть словарём"
        assert activity[today]["tasks_attempted"] >= 1, "tasks_attempted должна быть сохранена"

        for i in range(5, 0, -1):
            old_date = (date.today() - timedelta(days=i)).isoformat()
            assert isinstance(activity[old_date], dict), f"{old_date} должна быть словарём после санитизации"
            assert activity[old_date]["completion_percent"] == 0
            assert activity[old_date]["tasks_attempted"] == 0
    
    def test_multiple_tasks_in_one_day(self, calendar_service):
        """
        Test 5: Несколько задач в один день - счётчики должны инкрементироваться
        
        ✓ ПРОВЕРЯЕТ: Что данные накапливаются правильно
        """
        # Arrange
        complex_id = "complex_001"
        
        # Act - записываем несколько попыток
        for i in range(3):
            calendar_service.record_task_attempt(
                task_id=f"task_{i:03d}",
                complex_id=complex_id,
                user_grading=1,
                response_time_seconds=45
            )
        
        # Assert
        activity = calendar_service.get_activity_history()
        today_iso = date.today().isoformat()
        
        assert activity[today_iso]["tasks_attempted"] == 3
        assert activity[today_iso]["tasks_solved"] == 3
        assert activity[today_iso]["seconds_spent"] == 135  # 45 * 3
    
    def test_save_activity_method_uses_dict_format(self, calendar_service):
        """
        Test 6: save_activity() тоже должна использовать новый формат
        
        ✓ ПРОВЕРЯЕТ: Что вспомогательный метод тоже не конфликтует
        """
        # Arrange
        test_date = date.today()
        
        # Act
        result = calendar_service.save_activity(test_date, 80)
        
        # Assert
        assert result is True
        
        activity = calendar_service.get_activity_history()
        date_iso = test_date.isoformat()
        
        assert isinstance(activity[date_iso], dict)
        assert activity[date_iso]["completion_percent"] == 80
    
    def test_get_activity_for_heatmap_handles_dict_format(self, calendar_service):
        """
        Test 7: get_activity_for_heatmap должна работать с новым форматом
        
        ✓ ПРОВЕРЯЕТ: Что UI слой не сломается
        """
        # Arrange
        calendar_service.record_task_attempt(
            task_id="task_001",
            complex_id="complex_001",
            user_grading=1,
            response_time_seconds=45
        )
        
        # Act
        heatmap = calendar_service.get_activity_for_heatmap(days=7)
        
        # Assert
        assert len(heatmap) >= 7, f"heatmap должна содержать минимум 7 дней, получена {len(heatmap)}"
        today_heatmap = [h for h in heatmap if h.get("is_today")]
        assert len(today_heatmap) > 0, "Сегодняшний день должен быть в heatmap"
        assert today_heatmap[0]["tasks_attempted"] == 1
        assert today_heatmap[0]["tasks_solved"] == 1


class TestEdgeCases:
    """Тесты на edge cases"""
    
    @pytest.fixture
    def temp_data_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            data_dir = Path(tmpdir)
            (data_dir / "user_calendar").mkdir(parents=True, exist_ok=True)
            yield str(data_dir)
    
    @pytest.fixture
    def calendar_service(self, temp_data_dir):
        service = CalendarService(
            data_dir=temp_data_dir,
            user_id="test_user",
            use_fsrs=False
        )
        return service
    
    def test_zero_time_limit_no_division_by_zero(self, calendar_service):
        """
        Test 8: Если daily_time_limit_minutes = 0, не должно быть division by zero
        
        ✓ ПРОВЕРЯЕТ: Edge case при нулевом time limit
        """
        # Arrange - устанавливаем нулевой лимит времени
        settings = calendar_service.get_settings()
        settings.daily_time_limit_minutes = 0
        calendar_service.save_settings(settings)
        
        # Act - не должно быть exception
        try:
            calendar_service.complete_session(
                session_id="session_001",
                tasks_completed=1,
                active_time_seconds=1200
            )
        except ZeroDivisionError:
            pytest.fail("ZeroDivisionError не должна быть при нулевом time limit")
    
    def test_completion_percent_max_200(self, calendar_service):
        """
        Test 9: completion_percent не должна превышать 200%
        
        ✓ ПРОВЕРЯЕТ: Что capped на 200%
        """
        # Arrange
        settings = calendar_service.get_settings()
        settings.daily_time_limit_minutes = 30
        calendar_service.save_settings(settings)
        
        # Act - очень долгая сессия
        started = calendar_service.start_session("daily_mix")
        calendar_service.complete_session(
            session_id=started["session_id"],
            tasks_completed=1,
            active_time_seconds=20000  # 20000 / (30*60) * 100 = 1111%
        )
        
        # Assert
        activity = calendar_service.get_activity_history()
        today_iso = date.today().isoformat()
        
        assert activity[today_iso]["completion_percent"] <= 200


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
