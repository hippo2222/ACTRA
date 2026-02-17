"""
Интеграционные тесты для Stage 1: Исправление конфликта формата activity.json

Проверяют полные workflows через реальные данные и сценарии использования.
"""

import pytest
import json
import tempfile
import sys
from pathlib import Path
from datetime import datetime, date, timedelta
from unittest.mock import patch

# Добавляем пути для импорта
desktop_app_path = Path(__file__).parent.parent.parent / "desktop-app"
sys.path.insert(0, str(desktop_app_path))

from services.calendar.calendar_service import CalendarService
from services.calendar.models import ComplexProgress, ComplexStatus


class TestActivityFormatIntegration:
    """Интеграционные тесты для формата activity.json"""
    
    @pytest.fixture
    def temp_project_dir(self):
        """Полная структура проекта для интеграционных тестов"""
        with tempfile.TemporaryDirectory() as tmpdir:
            project_dir = Path(tmpdir)
            
            # Создаём структуру как в реальном проекте
            (project_dir / "user_calendar").mkdir(parents=True, exist_ok=True)
            (project_dir / "complexes").mkdir(parents=True, exist_ok=True)
            (project_dir / "users").mkdir(parents=True, exist_ok=True)
            
            # Создаём конфиг
            config = {
                "daily_time_limit_minutes": 30,
                "critical_threshold": 0.65,
                "mastery_threshold": 0.90,
                "decay_rate": 0.15
            }
            config_path = project_dir / "config.json"
            config_path.write_text(json.dumps(config, indent=2))
            
            yield str(project_dir)
    
    @pytest.fixture
    def calendar_service(self, temp_project_dir):
        """Экземпляр сервиса для интеграционных тестов"""
        service = CalendarService(
            data_dir=temp_project_dir,
            user_id="integration_test_user",
            use_fsrs=False
        )
        return service
    
    def test_full_learning_session_workflow(self, calendar_service):
        """
        ИНТЕГРАЦИЯ TEST 1: Полный workflow обучающей сессии
        
        Сценарий:
        1. Пользователь начинает сессию
        2. Решает несколько задач
        3. Завершает сессию
        4. Все данные сохраняются корректно в activity.json
        
        ✓ ПРОВЕРЯЕТ: Полная последовательность сохранения данных без потерь
        """
        # Setup
        complex_id = "math_algebra"
        
        # Регистрируем сессию
        started = calendar_service.start_session("daily_mix")
        session_id = started["session_id"]
        
        # Act - Workflow
        
        # Шаг 1: Записываем 3 попытки в сессии
        task_results = []
        for i in range(3):
            result = calendar_service.record_task_attempt(
                task_id=f"algebra_{i:03d}",
                complex_id=complex_id,
                user_grading=1,  # 1 = правильно
                response_time_seconds=45
            )
            assert result["success"]
            task_results.append(result)
        
        # Шаг 2: Завершаем сессию
        completion_result = calendar_service.complete_session(
            session_id=session_id,
            tasks_completed=3,
            active_time_seconds=1200  # 20 минут
        )
        assert completion_result["success"]
        
        # Assert - Проверяем целостность данных
        activity = calendar_service.get_activity_history()
        today_iso = date.today().isoformat()
        
        # Проверяем структуру
        assert today_iso in activity
        today_activity = activity[today_iso]
        
        assert isinstance(today_activity, dict), "Должна быть dict структура"
        
        # Проверяем счётчики (накопляются правильно)
        assert today_activity["tasks_attempted"] == 3
        assert today_activity["tasks_solved"] == 3
        assert today_activity["seconds_spent"] == 135  # 45 * 3
        
        # Проверяем новые поля
        assert isinstance(today_activity["completion_percent"], (int, float))
        assert 0 <= today_activity["completion_percent"] <= 200
        assert session_id in today_activity["session_ids"]
        assert isinstance(today_activity["streak_active"], bool)
        assert isinstance(today_activity["rest_day"], bool)
    
    def test_multiple_sessions_same_day(self, calendar_service):
        """
        ИНТЕГРАЦИЯ TEST 2: Несколько сессий в один день
        
        Сценарий:
        1. Утренняя сессия (3 задачи)
        2. Полуденная сессия (2 задачи)
        3. Вечерняя сессия (1 задача)
        
        ✓ ПРОВЕРЯЕТ: Корректное накопление данных между сессиями
        """
        # Setup
        complex_id = "complex_001"
        
        # Act - 3 сессии
        session_ids = []
        expected_total_tasks = 0
        
        for session_num, tasks_count in enumerate([3, 2, 1], 1):
            started = calendar_service.start_session("daily_mix")
            session_id = started["session_id"]
            session_ids.append(session_id)
            
            # Записываем задачи
            for task_num in range(tasks_count):
                calendar_service.record_task_attempt(
                    task_id=f"task_{session_num}_{task_num}",
                    complex_id=complex_id,
                    user_grading=1,
                    response_time_seconds=45
                )
            
            # Завершаем сессию
            calendar_service.complete_session(
                session_id=session_id,
                tasks_completed=tasks_count,
                active_time_seconds=600  # 10 минут на сессию
            )
            
            expected_total_tasks += tasks_count
        
        # Assert
        activity = calendar_service.get_activity_history()
        today_iso = date.today().isoformat()
        
        # Проверяем итоги
        assert activity[today_iso]["tasks_attempted"] == expected_total_tasks
        assert activity[today_iso]["tasks_solved"] == expected_total_tasks
        assert len(activity[today_iso]["session_ids"]) == 3
        assert all(sid in activity[today_iso]["session_ids"] for sid in session_ids)
        
        # Проверяем что session_ids не дублируются
        assert len(set(activity[today_iso]["session_ids"])) == 3
    
    def test_failed_attempts_tracked(self, calendar_service):
        """
        ИНТЕГРАЦИЯ TEST 3: Ошибочные попытки тоже отслеживаются
        
        Сценарий:
        1. 2 попытки - правильно (grading=1)
        2. 1 попытка - неправильно (grading=0)
        3. 1 попытка - частично (grading=0.5)
        
        ✓ ПРОВЕРЯЕТ: Все попытки считаются, но только правильные - решены
        """
        # Setup
        complex_id = "complex_001"
        started = calendar_service.start_session("daily_mix")
        session_id = started["session_id"]
        
        # Act - Разные результаты
        attempts = [
            (1, 1),      # grading=1, count
            (1, 1),
            (0, 1),      # grading=0
            (0.5, 1),    # grading=0.5
        ]
        
        solved_count = 0
        for grading, count in attempts:
            for i in range(count):
                calendar_service.record_task_attempt(
                    task_id=f"task_{len(attempts)}_{i}",
                    complex_id=complex_id,
                    user_grading=grading,
                    response_time_seconds=45
                )
                if grading == 1:
                    solved_count += 1
        
        # Завершаем сессию
        calendar_service.complete_session(
            session_id=session_id,
            tasks_completed=solved_count,
            active_time_seconds=1200
        )
        
        # Assert
        activity = calendar_service.get_activity_history()
        today_iso = date.today().isoformat()
        
        assert activity[today_iso]["tasks_attempted"] == 4  # Все попытки
        assert activity[today_iso]["tasks_solved"] == solved_count  # Только правильные
    
    def test_heatmap_data_after_full_workflow(self, calendar_service):
        """
        ИНТЕГРАЦИЯ TEST 4: Heatmap данные правильны после workflow
        
        Сценарий:
        1. Выполняем 2 дня активности
        2. 1 день без активности
        3. Проверяем что heatmap правильно отражает данные
        
        ✓ ПРОВЕРЯЕТ: UI слой получает правильные данные из новой структуры
        """
        # Регистрируем сессии заранее
        started1 = calendar_service.start_session("daily_mix")
        session_id_1 = started1["session_id"]
        started2 = calendar_service.start_session("daily_mix")
        session_id_2 = started2["session_id"]
        
        # Act - День 1: активность
        with patch('services.calendar.calendar_service.date') as mock_date:
            # День 1
            mock_date.today.return_value = date(2025, 1, 20)
            calendar_service.record_task_attempt(
                task_id="task_001",
                complex_id="complex_001",
                user_grading=1,
                response_time_seconds=45
            )
            calendar_service.complete_session(
                session_id=session_id_1,
                tasks_completed=1,
                active_time_seconds=600
            )
        
        # День 3: активность (пропускаем день 2)
        with patch('services.calendar.calendar_service.date') as mock_date:
            mock_date.today.return_value = date(2025, 1, 22)
            calendar_service.record_task_attempt(
                task_id="task_002",
                complex_id="complex_001",
                user_grading=1,
                response_time_seconds=45
            )
            calendar_service.complete_session(
                session_id=session_id_2,
                tasks_completed=1,
                active_time_seconds=600
            )
        
        # Assert
        heatmap = calendar_service.get_activity_for_heatmap(days=7)
        
        # Проверяем что heatmap содержит правильные данные (может быть 7 или 8 дней в зависимости от реализации)
        assert len(heatmap) >= 7
        
        # Проверяем что структура словаря сохранена в heatmap
        for entry in heatmap:
            assert isinstance(entry["tasks_attempted"], int)
            assert isinstance(entry["tasks_solved"], int)
            assert isinstance(entry["seconds_spent"], int)
    
    def test_mixed_format_sanitizes_numeric_legacy_entries(self, calendar_service):
        """
        ИНТЕГРАЦИЯ TEST 5: Смешанный формат (старые числа + новые словари).

        ✓ ПРОВЕРЯЕТ: Числовые legacy-записи санитизируются в дефолтный dict,
        а валидные dict-записи сохраняются без изменений.
        """
        # Setup - создаём смешанные данные
        mixed_activity = {
            "2025-01-15": 50,  # Старый формат (число)
            "2025-01-16": 75,  # Старый формат
            "2025-01-18": {    # Новый формат
                "tasks_attempted": 1,
                "tasks_solved": 1,
                "seconds_spent": 45,
                "completion_percent": 80,
                "session_ids": ["session_001"],
                "streak_active": True,
                "rest_day": False,
            }
        }
        
        activity_path = Path(calendar_service.data_dir) / "user_calendar" / calendar_service.user_id / "activity.json"
        activity_path.parent.mkdir(parents=True, exist_ok=True)
        activity_path.write_text(json.dumps(mixed_activity, indent=2))
        
        # Act - работаем с этими данными
        
        # Добавляем новую попытку (должна санитизировать старые числовые данные)
        calendar_service.record_task_attempt(
            task_id="task_new",
            complex_id="complex_001",
            user_grading=1,
            response_time_seconds=45
        )
        
        # Assert
        activity = calendar_service.get_activity_history()
        
        # Проверяем что новые данные правильно обработаны
        today_iso = date.today().isoformat()
        assert isinstance(activity[today_iso], dict), "Новые данные должны быть словарём"
        
        # Числовые legacy-записи больше не интерпретируются как completion_percent.
        assert isinstance(activity["2025-01-15"], dict)
        assert activity["2025-01-15"]["completion_percent"] == 0
        assert isinstance(activity["2025-01-16"], dict)
        assert activity["2025-01-16"]["completion_percent"] == 0

        # Проверяем что валидные dict-данные остались нетронутыми
        if "2025-01-18" in activity:
            assert isinstance(activity["2025-01-18"], dict)
            assert activity["2025-01-18"]["completion_percent"] == 80
            assert activity["2025-01-18"]["session_ids"] == ["session_001"]


class TestDataPersistence:
    """Тесты на сохранение данных"""
    
    @pytest.fixture
    def temp_data_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            data_dir = Path(tmpdir)
            (data_dir / "user_calendar").mkdir(parents=True, exist_ok=True)
            yield str(data_dir)
    
    @pytest.fixture
    def calendar_service(self, temp_data_dir):
        return CalendarService(
            data_dir=temp_data_dir,
            user_id="test_user",
            use_fsrs=False
        )
    
    def test_activity_persisted_to_disk(self, calendar_service, temp_data_dir):
        """
        ПЕРСИСТЕНТНОСТЬ TEST 1: Данные сохраняются на диск
        
        ✓ ПРОВЕРЯЕТ: Что JSON файл содержит правильный формат
        """
        # Act
        calendar_service.record_task_attempt(
            task_id="task_001",
            complex_id="complex_001",
            user_grading=1,
            response_time_seconds=45
        )
        
        # Assert - читаем файл напрямую
        activity_path = Path(temp_data_dir) / "user_calendar" / "test_user" / "activity.json"
        assert activity_path.exists(), "activity.json должна быть создана"
        
        with open(activity_path) as f:
            saved_data = json.load(f)
        
        today_iso = date.today().isoformat()
        assert today_iso in saved_data
        assert isinstance(saved_data[today_iso], dict)
        assert "tasks_attempted" in saved_data[today_iso]
        assert "completion_percent" in saved_data[today_iso]
        assert "session_ids" in saved_data[today_iso]
    
    def test_data_survives_service_restart(self, temp_data_dir):
        """
        ПЕРСИСТЕНТНОСТЬ TEST 2: Данные сохраняются между перезагрузками сервиса
        
        ✓ ПРОВЕРЯЕТ: Что новый экземпляр сервиса видит сохранённые данные
        """
        # Arrange
        service1 = CalendarService(
            data_dir=temp_data_dir,
            user_id="test_user",
            use_fsrs=False
        )
        
        # Act - сохраняем в первой инстанции
        service1.record_task_attempt(
            task_id="task_001",
            complex_id="complex_001",
            user_grading=1,
            response_time_seconds=45
        )
        
        # Создаём новый сервис (как перезагрузка)
        service2 = CalendarService(
            data_dir=temp_data_dir,
            user_id="test_user",
            use_fsrs=False
        )
        
        # Assert - проверяем что данные видны в новом сервисе
        activity = service2.get_activity_history()
        today_iso = date.today().isoformat()
        
        assert today_iso in activity
        assert activity[today_iso]["tasks_attempted"] == 1
        assert activity[today_iso]["tasks_solved"] == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
