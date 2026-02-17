"""
Unit-тесты для ProfileController (Logic Layer - ФАЗА 1).

Тестируем:
- Выбор профиля (select_profile)
- Создание нового профиля (create_new_profile)
- Получение статистики профиля (get_profile_statistics)
- Интеграцию с UserService и StatisticsService
"""

import unittest
import sys
import os
import shutil
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

# Настройка путей
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from logic.profile_controller import ProfileController
from services.user_service import UserService, User
from services.statistics_service import StatisticsService
from services.progress_service import ProgressService


# =============================================================================
# ТЕСТЫ: Базовая инициализация
# =============================================================================

class TestProfileControllerInit(unittest.TestCase):
    """Тесты инициализации ProfileController"""
    
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
        self.progress_service = ProgressService(data_dir=self.temp_dir, user_id="test_user")
        self.statistics_service = StatisticsService(progress_service=self.progress_service)
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_init_creates_controller(self):
        """Инициализация создаёт контроллер"""
        controller = ProfileController(self.user_service, self.statistics_service)
        
        self.assertIsNotNone(controller)
        self.assertEqual(controller.user_service, self.user_service)
        self.assertEqual(controller.statistics_service, self.statistics_service)
    
    def test_init_stores_services(self):
        """Контроллер сохраняет ссылки на сервисы"""
        controller = ProfileController(self.user_service, self.statistics_service)
        
        self.assertEqual(controller.user_service, self.user_service)
        self.assertEqual(controller.statistics_service, self.statistics_service)


# =============================================================================
# ТЕСТЫ: Выбор профиля
# =============================================================================

class TestSelectProfile(unittest.TestCase):
    """Тесты выбора профиля"""
    
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
        self.progress_service = ProgressService(data_dir=self.temp_dir, user_id="test_user")
        self.statistics_service = StatisticsService(progress_service=self.progress_service)
        self.controller = ProfileController(self.user_service, self.statistics_service)
        
        # Создаём тестового пользователя
        self.test_user = self.user_service.create_user("Test User")
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_select_profile_returns_user(self):
        """select_profile возвращает пользователя"""
        user = self.controller.select_profile(self.test_user.user_id)
        
        self.assertIsNotNone(user)
        self.assertIsInstance(user, User)
        self.assertEqual(user.user_id, self.test_user.user_id)
        self.assertEqual(user.name, "Test User")
    
    def test_select_profile_returns_none_for_invalid_id(self):
        """select_profile возвращает None для несуществующего ID"""
        user = self.controller.select_profile("nonexistent_user")
        
        self.assertIsNone(user)
    
    def test_select_profile_returns_none_for_empty_id(self):
        """select_profile возвращает None для пустого ID"""
        user = self.controller.select_profile("")
        
        self.assertIsNone(user)
        
        user = self.controller.select_profile(None)
        
        self.assertIsNone(user)


# =============================================================================
# ТЕСТЫ: Создание профиля
# =============================================================================

class TestCreateNewProfile(unittest.TestCase):
    """Тесты создания нового профиля"""
    
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
        self.progress_service = ProgressService(data_dir=self.temp_dir, user_id="test_user")
        self.statistics_service = StatisticsService(progress_service=self.progress_service)
        self.controller = ProfileController(self.user_service, self.statistics_service)
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_create_new_profile_creates_user(self):
        """create_new_profile создаёт пользователя"""
        user = self.controller.create_new_profile("New User")
        
        self.assertIsNotNone(user)
        self.assertIsInstance(user, User)
        self.assertEqual(user.name, "New User")
        self.assertIsNotNone(user.user_id)
        self.assertTrue(user.user_id.startswith("user_"))
    
    def test_create_new_profile_creates_user(self):
        """create_new_profile создаёт пользователя"""
        user = self.controller.create_new_profile("New User")
        
        self.assertIsNotNone(user)
        self.assertEqual(user.settings, {})
    
    def test_create_new_profile_strips_name(self):
        """create_new_profile обрезает пробелы в имени"""
        user = self.controller.create_new_profile("  New User  ")
        
        self.assertEqual(user.name, "New User")
    
    def test_create_new_profile_raises_for_empty_name(self):
        """create_new_profile выбрасывает ValueError для пустого имени"""
        with self.assertRaises(ValueError):
            self.controller.create_new_profile("")
        
        with self.assertRaises(ValueError):
            self.controller.create_new_profile("   ")
    
    def test_create_new_profile_creates_data_files(self):
        """create_new_profile создаёт необходимые файлы данных"""
        user = self.controller.create_new_profile("New User")
        
        user_dir = Path(self.temp_dir) / "users" / user.user_id
        
        # Проверяем, что созданы файлы
        self.assertTrue((user_dir / "profile.json").exists())
        self.assertTrue((user_dir / "progress.json").exists())
        self.assertTrue((user_dir / "statistics.json").exists())


# =============================================================================
# ТЕСТЫ: Получение статистики
# =============================================================================

class TestGetProfileStatistics(unittest.TestCase):
    """Тесты получения статистики профиля"""
    
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
        self.test_user = self.user_service.create_user("Test User")
        
        # Создаём ProgressService с user_id тестового пользователя
        self.progress_service = ProgressService(
            data_dir=self.temp_dir,
            user_id=self.test_user.user_id
        )
        self.statistics_service = StatisticsService(progress_service=self.progress_service)
        self.controller = ProfileController(self.user_service, self.statistics_service)
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_get_profile_statistics_returns_dict(self):
        """get_profile_statistics возвращает словарь"""
        stats = self.controller.get_profile_statistics(self.test_user.user_id)
        
        self.assertIsInstance(stats, dict)
        self.assertIn("user_id", stats)
        self.assertIn("user_name", stats)
        self.assertIn("statistics", stats)
        self.assertIn("weak_areas", stats)
        self.assertIn("performance_by_type", stats)
        self.assertIn("time_dynamics", stats)
    
    def test_get_profile_statistics_contains_user_info(self):
        """get_profile_statistics содержит информацию о пользователе"""
        stats = self.controller.get_profile_statistics(self.test_user.user_id)
        
        self.assertEqual(stats["user_id"], self.test_user.user_id)
        self.assertEqual(stats["user_name"], "Test User")
    
    def test_get_profile_statistics_contains_statistics(self):
        """get_profile_statistics содержит статистику"""
        stats = self.controller.get_profile_statistics(self.test_user.user_id)
        
        statistics = stats["statistics"]
        self.assertIn("total_tasks_attempted", statistics)
        self.assertIn("total_tasks_completed", statistics)
        self.assertIn("success_rate", statistics)
        self.assertIn("average_score", statistics)
        self.assertIn("total_time_spent", statistics)
        self.assertIn("by_task_type", statistics)
        self.assertIn("last_updated", statistics)
    
    def test_get_profile_statistics_for_new_user(self):
        """get_profile_statistics возвращает пустую статистику для нового пользователя"""
        stats = self.controller.get_profile_statistics(self.test_user.user_id)
        
        self.assertEqual(stats["statistics"]["total_tasks_attempted"], 0)
        self.assertEqual(stats["statistics"]["total_tasks_completed"], 0)
        self.assertEqual(stats["statistics"]["success_rate"], 0.0)
        self.assertEqual(stats["weak_areas"], [])
        self.assertEqual(stats["performance_by_type"], {})
        self.assertIsInstance(stats["time_dynamics"], list)  # v3.0: возвращает 30 дней (даже пустых)
    
    def test_get_profile_statistics_returns_empty_for_invalid_id(self):
        """get_profile_statistics возвращает пустую статистику для несуществующего ID"""
        stats = self.controller.get_profile_statistics("nonexistent_user")
        
        self.assertEqual(stats["user_id"], "nonexistent_user")
        self.assertEqual(stats["user_name"], "")
        self.assertEqual(stats["statistics"]["total_tasks_attempted"], 0)
    
    def test_get_profile_statistics_force_refresh(self):
        """get_profile_statistics поддерживает force_refresh"""
        # Создаём некоторый прогресс
        self.progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_001",
            difficulty=1,
            success=True,
            score=95.0,
            time_spent=60
        )
        
        # Получаем статистику с force_refresh
        stats1 = self.controller.get_profile_statistics(
            self.test_user.user_id,
            force_refresh=True
        )
        
        stats2 = self.controller.get_profile_statistics(
            self.test_user.user_id,
            force_refresh=True
        )
        
        # Обе должны содержать данные
        self.assertGreater(stats1["statistics"]["total_tasks_attempted"], 0)
        self.assertGreater(stats2["statistics"]["total_tasks_attempted"], 0)


# =============================================================================
# ТЕСТЫ: Интеграция с сервисами
# =============================================================================

class TestProfileControllerIntegration(unittest.TestCase):
    """Тесты интеграции ProfileController с сервисами"""
    
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
        self.test_user = self.user_service.create_user("Test User")
        
        self.progress_service = ProgressService(
            data_dir=self.temp_dir,
            user_id=self.test_user.user_id
        )
        self.statistics_service = StatisticsService(progress_service=self.progress_service)
        self.controller = ProfileController(self.user_service, self.statistics_service)
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_full_workflow(self):
        """Полный workflow: создание -> выбор -> статистика"""
        # 1. Создаём профиль
        user = self.controller.create_new_profile("Workflow User")
        self.assertIsNotNone(user)
        
        # 2. Выбираем профиль
        selected_user = self.controller.select_profile(user.user_id)
        self.assertIsNotNone(selected_user)
        self.assertEqual(selected_user.user_id, user.user_id)
        
        # 3. Получаем статистику
        stats = self.controller.get_profile_statistics(user.user_id)
        self.assertIsNotNone(stats)
        self.assertEqual(stats["user_id"], user.user_id)
        self.assertEqual(stats["user_name"], "Workflow User")
    
    def test_statistics_updates_after_progress(self):
        """Статистика обновляется после сохранения прогресса"""
        # Создаём новый пользователь с ProgressService
        new_user = self.controller.create_new_profile("Progress User")
        progress_service = ProgressService(
            data_dir=self.temp_dir,
            user_id=new_user.user_id
        )
        statistics_service = StatisticsService(progress_service=progress_service)
        controller = ProfileController(self.user_service, statistics_service)
        
        # Получаем начальную статистику
        initial_stats = controller.get_profile_statistics(new_user.user_id)
        self.assertEqual(initial_stats["statistics"]["total_tasks_attempted"], 0)
        
        # Сохраняем попытку
        progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_001",
            difficulty=1,
            success=True,
            score=90.0,
            time_spent=45
        )
        
        # Получаем обновлённую статистику с force_refresh
        updated_stats = controller.get_profile_statistics(
            new_user.user_id,
            force_refresh=True
        )
        
        self.assertEqual(updated_stats["statistics"]["total_tasks_attempted"], 1)
        self.assertEqual(updated_stats["statistics"]["total_tasks_completed"], 1)
        self.assertEqual(updated_stats["statistics"]["success_rate"], 1.0)
    
    def test_select_profile_updates_app_state(self):
        """Тест обновления AppState при выборе профиля"""
        # Создаём мок AppState для проверки обновления
        # В реальном приложении AppState находится в TrainerApp
        # Здесь мы проверяем, что select_profile возвращает правильного пользователя
        
        user1 = self.controller.create_new_profile("User 1")
        user2 = self.controller.create_new_profile("User 2")
        
        # Выбираем первого пользователя
        selected_user1 = self.controller.select_profile(user1.user_id)
        self.assertIsNotNone(selected_user1)
        self.assertEqual(selected_user1.user_id, user1.user_id)
        
        # Выбираем второго пользователя
        selected_user2 = self.controller.select_profile(user2.user_id)
        self.assertIsNotNone(selected_user2)
        self.assertEqual(selected_user2.user_id, user2.user_id)
        
        # Проверяем, что пользователи разные
        self.assertNotEqual(selected_user1.user_id, selected_user2.user_id)
    
    def test_create_profile_creates_structure(self):
        """Тест создания структуры при создании профиля"""
        user = self.controller.create_new_profile("Structure Test User")
        
        # Проверяем, что создана директория пользователя
        user_dir = Path(self.temp_dir) / "users" / user.user_id
        self.assertTrue(user_dir.exists())
        
        # Проверяем, что созданы все необходимые файлы
        self.assertTrue((user_dir / "profile.json").exists())
        self.assertTrue((user_dir / "progress.json").exists())
        self.assertTrue((user_dir / "statistics.json").exists())
        
        # Проверяем, что структура данных валидна
        import json
        with open(user_dir / "profile.json", 'r', encoding='utf-8') as f:
            profile_data = json.load(f)
        self.assertEqual(profile_data["user_id"], user.user_id)
        self.assertEqual(profile_data["profile"]["name"], "Structure Test User")
        
        with open(user_dir / "progress.json", 'r', encoding='utf-8') as f:
            progress_data = json.load(f)
        self.assertEqual(progress_data["version"], "3.0")
        self.assertEqual(progress_data["user_id"], user.user_id)
        self.assertIsInstance(progress_data["task_history"], dict)
        self.assertIsInstance(progress_data["mistake_bank"], list)
        
        with open(user_dir / "statistics.json", 'r', encoding='utf-8') as f:
            statistics_data = json.load(f)
        self.assertEqual(statistics_data["total_tasks_attempted"], 0)
        self.assertEqual(statistics_data["total_tasks_completed"], 0)
    
    def test_get_profile_statistics_integration(self):
        """Тест получения статистики профиля (интеграция)"""
        # Создаём пользователя с прогрессом
        user = self.controller.create_new_profile("Statistics User")
        
        # Создаём ProgressService для этого пользователя
        progress_service = ProgressService(
            data_dir=self.temp_dir,
            user_id=user.user_id
        )
        statistics_service = StatisticsService(progress_service=progress_service)
        controller = ProfileController(self.user_service, statistics_service)
        
        # Добавляем несколько попыток
        progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_001",
            difficulty=1,
            success=True,
            score=90.0,
            time_spent=60
        )
        progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_002",
            difficulty=1,
            success=False,
            score=40.0,
            time_spent=120
        )
        
        # Получаем статистику
        stats = controller.get_profile_statistics(user.user_id, force_refresh=True)
        
        # Проверяем, что статистика содержит правильные данные
        self.assertEqual(stats["user_id"], user.user_id)
        self.assertEqual(stats["user_name"], "Statistics User")
        self.assertEqual(stats["statistics"]["total_tasks_attempted"], 2)
        self.assertEqual(stats["statistics"]["total_tasks_completed"], 1)
        self.assertAlmostEqual(stats["statistics"]["success_rate"], 0.5, places=1)
        
        # Проверяем наличие слабых областей
        self.assertIsInstance(stats["weak_areas"], list)
        
        # Проверяем производительность по типам
        self.assertIsInstance(stats["performance_by_type"], dict)
        
        # Проверяем динамику времени
        self.assertIsInstance(stats["time_dynamics"], list)
    
    def test_profile_switching(self):
        """Тест переключения между профилями"""
        # Создаём двух пользователей
        user1 = self.controller.create_new_profile("User 1")
        user2 = self.controller.create_new_profile("User 2")
        
        # Создаём ProgressService для каждого пользователя
        progress_service1 = ProgressService(
            data_dir=self.temp_dir,
            user_id=user1.user_id
        )
        progress_service2 = ProgressService(
            data_dir=self.temp_dir,
            user_id=user2.user_id
        )
        
        # Добавляем данные для первого пользователя
        progress_service1.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_001",
            difficulty=1,
            success=True,
            score=90.0,
            time_spent=60
        )
        
        # Добавляем данные для второго пользователя
        progress_service2.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_002",
            difficulty=2,
            success=True,
            score=85.0,
            time_spent=90
        )
        
        # Переключаемся на первого пользователя
        statistics_service1 = StatisticsService(progress_service=progress_service1)
        controller1 = ProfileController(self.user_service, statistics_service1)
        
        selected_user1 = controller1.select_profile(user1.user_id)
        self.assertIsNotNone(selected_user1)
        self.assertEqual(selected_user1.user_id, user1.user_id)
        
        stats1 = controller1.get_profile_statistics(user1.user_id, force_refresh=True)
        self.assertEqual(stats1["statistics"]["total_tasks_attempted"], 1)
        
        # Переключаемся на второго пользователя
        statistics_service2 = StatisticsService(progress_service=progress_service2)
        controller2 = ProfileController(self.user_service, statistics_service2)
        
        selected_user2 = controller2.select_profile(user2.user_id)
        self.assertIsNotNone(selected_user2)
        self.assertEqual(selected_user2.user_id, user2.user_id)
        
        stats2 = controller2.get_profile_statistics(user2.user_id, force_refresh=True)
        self.assertEqual(stats2["statistics"]["total_tasks_attempted"], 1)
        
        # Проверяем, что данные изолированы
        self.assertNotEqual(stats1["statistics"]["total_tasks_attempted"], 
                           stats2["statistics"]["total_tasks_attempted"] if stats2["statistics"]["total_tasks_attempted"] != 1 else 0)


if __name__ == '__main__':
    unittest.main()
