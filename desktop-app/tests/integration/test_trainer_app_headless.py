"""
Тесты TrainerApp без UI (headless mode).

Проверяет:
- Инициализацию приложения без UI
- Регистрацию сервисов
- Переключение пользователей
- Управление состоянием приложения
"""

import unittest
import tempfile
import shutil
from pathlib import Path
from unittest.mock import patch, MagicMock

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.user_service import UserService
from services.progress_service import ProgressService
from services.statistics_service import StatisticsService
from logic.profile_controller import ProfileController
from logic.task_controller import TaskController
from services.task_evaluator_service import TaskEvaluatorService


class TestTrainerAppHeadless(unittest.TestCase):
    """Тесты TrainerApp без UI"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
    
    def tearDown(self):
        """Очистка после тестов"""
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def _create_app_components(self, user_id: str = "test_user"):
        """
        Создает компоненты приложения без UI.
        
        Returns:
            dict: Словарь с компонентами приложения
        """
        progress_service = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user_id
        )
        statistics_service = StatisticsService(progress_service=progress_service)
        evaluator_service = TaskEvaluatorService()
        
        profile_controller = ProfileController(
            user_service=self.user_service,
            statistics_service=statistics_service
        )
        task_controller = TaskController(
            evaluator_service=evaluator_service,
            progress_service=progress_service
        )
        
        return {
            "user_service": self.user_service,
            "progress_service": progress_service,
            "statistics_service": statistics_service,
            "evaluator_service": evaluator_service,
            "profile_controller": profile_controller,
            "task_controller": task_controller
        }
    
    def test_app_initialization_without_ui(self):
        """Тест: инициализация без UI"""
        # Создаем компоненты приложения
        app = self._create_app_components()
        
        # Проверяем, что все сервисы инициализированы
        self.assertIsNotNone(app["user_service"])
        self.assertIsNotNone(app["progress_service"])
        self.assertIsNotNone(app["statistics_service"])
        self.assertIsNotNone(app["evaluator_service"])
        self.assertIsNotNone(app["profile_controller"])
        self.assertIsNotNone(app["task_controller"])
        
        # Проверяем, что сервисы работают
        user = app["user_service"].create_user("Test User")
        self.assertIsNotNone(user)
    
    def test_app_service_registration(self):
        """Тест: регистрация сервисов"""
        # Создаем компоненты приложения
        app = self._create_app_components()
        
        # Проверяем, что UserService работает
        user = app["user_service"].create_user("Service Test User")
        self.assertIsNotNone(user)
        
        # Проверяем, что ProgressService работает
        app["progress_service"].save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=True, score=90.0, time_spent=60
        )
        
        progress = app["progress_service"].get_task_progress("module_01", "topic_01", "task_001")
        self.assertIsNotNone(progress)
        
        # Проверяем, что StatisticsService работает
        # progress_service использует user_id="test_user", поэтому запрашиваем статистику для него
        stats = app["statistics_service"].aggregate_statistics("test_user", force_refresh=True)
        self.assertIsNotNone(stats)
        self.assertEqual(stats["total_tasks_attempted"], 1)
        
        # Проверяем, что ProfileController работает
        profile_stats = app["profile_controller"].get_profile_statistics(
            user.user_id,
            force_refresh=True
        )
        self.assertIsNotNone(profile_stats)
        
        # Проверяем, что TaskController работает
        task_data = {
            "meta": {"task_schema_version": "1.2", "name": "Test Task"},
            "content": {"type": "click", "image": "test.jpg", "prompt": "Test"},
            "settings": {"difficulty": 1}
        }
        answer_key = {
            "targets": [{"type": "polygon", "points": [[100, 100], [200, 100], [200, 200], [100, 200]]}]
        }
        
        task = app["task_controller"].load_task(
            "module_01", "topic_01", "task_002",
            task_data, answer_key
        )
        self.assertIsNotNone(task)
    
    def test_app_user_switching(self):
        """Тест: переключение пользователей"""
        # Создаем нескольких пользователей
        user1 = self.user_service.create_user("User 1")
        user2 = self.user_service.create_user("User 2")
        
        # Создаем компоненты для первого пользователя
        app1 = self._create_app_components(user_id=user1.user_id)
        
        # Сохраняем данные для первого пользователя
        app1["progress_service"].save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=True, score=90.0, time_spent=60
        )
        
        # Создаем компоненты для второго пользователя
        app2 = self._create_app_components(user_id=user2.user_id)
        
        # Сохраняем данные для второго пользователя
        app2["progress_service"].save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=2, success=True, score=85.0, time_spent=90
        )
        
        # Проверяем изоляцию данных
        progress1 = app1["progress_service"].get_task_progress("module_01", "topic_01", "task_001")
        progress2 = app2["progress_service"].get_task_progress("module_01", "topic_01", "task_001")
        
        self.assertIsNotNone(progress1)
        self.assertIsNotNone(progress2)
        self.assertEqual(progress1['current_difficulty'], 1)
        self.assertEqual(progress2['current_difficulty'], 2)
    
    def test_app_state_management(self):
        """Тест: управление состоянием приложения"""
        # Создаем компоненты приложения
        app = self._create_app_components()
        
        # Создаем пользователя
        user = app["user_service"].create_user("State Test User")
        
        # Выбираем профиль
        selected_user = app["profile_controller"].select_profile(user.user_id)
        self.assertIsNotNone(selected_user)
        
        # Сохраняем прогресс
        app["progress_service"].save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=True, score=90.0, time_spent=60
        )
        
        # Получаем статистику для user_id="test_user" (прогресс сохраняется под этим ID)
        stats = app["statistics_service"].aggregate_statistics(
            "test_user",
            force_refresh=True
        )
        
        # Проверяем, что состояние сохраняется
        self.assertEqual(stats["total_tasks_attempted"], 1)
        
        # Переключаемся на другого пользователя
        user2 = app["user_service"].create_user("State Test User 2")
        app2 = self._create_app_components(user_id=user2.user_id)
        
        # Проверяем, что состояние изолировано
        stats2 = app2["statistics_service"].aggregate_statistics(
            user2.user_id,
            force_refresh=True
        )
        self.assertEqual(stats2["total_tasks_attempted"], 0)


if __name__ == '__main__':
    unittest.main()

