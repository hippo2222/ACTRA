"""
Тесты логики StatisticsScreen (без GUI).

Проверяет:
- Подготовку данных для отображения
- Подготовку слабых областей для UI
- Подготовку производительности по типам
- Подготовку динамики времени
"""

import unittest
import tempfile
import shutil
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.user_service import UserService
from services.progress_service import ProgressService
from services.statistics_service import StatisticsService
from services.storage_service import StorageService
from logic.module_repository import ModuleRepository
from logic.profile_controller import ProfileController


class TestStatisticsScreenLogic(unittest.TestCase):
    """Тесты логики StatisticsScreen"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
        self.user = self.user_service.create_user("Statistics User")
        
        self.progress_service = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=self.user.user_id
        )
        self.storage_service = StorageService(Path(self.temp_dir) / "modules")
        self.module_repository = ModuleRepository(self.storage_service)
        self.statistics_service = StatisticsService(progress_service=self.progress_service)
        self.statistics_service.set_module_repository(self.module_repository)
        self.controller = ProfileController(self.user_service, self.statistics_service)
    
    def tearDown(self):
        """Очистка после тестов"""
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_statistics_data_preparation(self):
        """Тест: подготовка данных для отображения"""
        # Добавляем данные
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=True, score=90.0, time_spent=60
        )
        
        # Получаем статистику профиля
        stats = self.controller.get_profile_statistics(
            self.user.user_id,
            force_refresh=True
        )
        
        # Проверяем структуру данных для UI
        self.assertIn("user_id", stats)
        self.assertIn("user_name", stats)
        self.assertIn("statistics", stats)
        self.assertIn("weak_areas", stats)
        self.assertIn("performance_by_type", stats)
        self.assertIn("time_dynamics", stats)
        
        # Проверяем структуру statistics
        statistics = stats["statistics"]
        self.assertIn("total_tasks_attempted", statistics)
        self.assertIn("total_tasks_completed", statistics)
        self.assertIn("success_rate", statistics)
        self.assertIn("average_score", statistics)
        self.assertIn("total_time_spent", statistics)
        self.assertIn("by_task_type", statistics)
    
    def test_weak_areas_display(self):
        """Тест: подготовка слабых областей для UI"""
        # Добавляем данные с ошибками
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=False, score=40.0, time_spent=120
        )
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_002",
            difficulty=1, success=False, score=45.0, time_spent=110
        )
        
        # Получаем статистику
        stats = self.controller.get_profile_statistics(
            self.user.user_id,
            force_refresh=True
        )
        
        # Проверяем слабые области
        weak_areas = stats["weak_areas"]
        self.assertIsInstance(weak_areas, list)
        
        if weak_areas:
            for area in weak_areas:
                self.assertIn("module", area)
                self.assertIn("topic", area)
                self.assertIn("success_rate", area)
                self.assertIn("attempts", area)
    
    def test_performance_by_type_display(self):
        """Тест: подготовка производительности по типам"""
        # Добавляем данные
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=True, score=90.0, time_spent=60
        )
        
        # Получаем статистику
        stats = self.controller.get_profile_statistics(
            self.user.user_id,
            force_refresh=True
        )
        
        # Проверяем производительность по типам
        performance = stats["performance_by_type"]
        self.assertIsInstance(performance, dict)
        
        for task_type, data in performance.items():
            self.assertIn("attempts", data)
            self.assertIn("success_rate", data)
            self.assertIn("average_score", data)
    
    def test_time_dynamics_display(self):
        """Тест: подготовка динамики времени"""
        # Добавляем данные
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=True, score=90.0, time_spent=60
        )
        
        # Получаем статистику
        stats = self.controller.get_profile_statistics(
            self.user.user_id,
            force_refresh=True
        )
        
        # Проверяем динамику времени
        time_dynamics = stats["time_dynamics"]
        self.assertIsInstance(time_dynamics, list)
        
        if time_dynamics:
            for entry in time_dynamics:
                self.assertIn("date", entry)
                self.assertIn("attempts", entry)
                self.assertIn("success_rate", entry)
                self.assertIn("average_score", entry)


if __name__ == '__main__':
    unittest.main()

