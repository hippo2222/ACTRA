"""
E2E тесты для Фазы 1: Профили пользователей и расширенная статистика.

Полные сценарии пользователя без GUI (headless mode):
- Создание и выбор профиля
- Выполнение заданий
- Работа с ошибками (mistake_bank)
- Агрегация статистики
- Изоляция данных между пользователями
"""

import unittest
import tempfile
import shutil
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.user_service import UserService, User
from services.progress_service import ProgressService
from services.statistics_service import StatisticsService
from logic.profile_controller import ProfileController
from logic.task_controller import TaskController
from services.task_evaluator_service import TaskEvaluatorService


class TestPhase1E2E(unittest.TestCase):
    """E2E тесты для Фазы 1"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
    
    def tearDown(self):
        """Очистка после тестов"""
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def _create_trainer_app_without_ui(self, user_id: str = "test_user"):
        """
        Создает компоненты приложения без UI для headless тестирования.
        
        Returns:
            dict: Словарь с сервисами и контроллерами
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
    
    def test_full_user_workflow(self):
        """Тест: полный workflow пользователя"""
        # Создаем компоненты приложения
        app = self._create_trainer_app_without_ui()
        
        # 1. Создание пользователя
        user = app["profile_controller"].create_new_profile("E2E Test User")
        self.assertIsNotNone(user)
        self.assertEqual(user.name, "E2E Test User")
        
        # 2. Выбор профиля
        selected_user = app["profile_controller"].select_profile(user.user_id)
        self.assertIsNotNone(selected_user)
        self.assertEqual(selected_user.user_id, user.user_id)
        
        # 3. Создаем ProgressService для выбранного пользователя
        progress_service = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user.user_id
        )
        
        # 4. Выполнение заданий (успешное и неуспешное)
        # Успешное задание
        progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=True, score=90.0, time_spent=60
        )
        
        # Неуспешное задание
        progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_002",
            difficulty=1, success=False, score=40.0, time_spent=120
        )
        
        # 5. Проверка mistake_bank
        mistake_bank = progress_service.get_mistake_bank()
        self.assertEqual(len(mistake_bank), 1)
        self.assertEqual(set(m["task"] for m in mistake_bank), {"task_002"})  # v3.0: только неуспешное задание
        
        # 6. Получение статистики
        statistics_service = StatisticsService(progress_service=progress_service)
        stats = statistics_service.aggregate_statistics(user.user_id, force_refresh=True)
        
        self.assertEqual(stats["total_tasks_attempted"], 2)
        self.assertEqual(stats["total_tasks_completed"], 1)
        self.assertAlmostEqual(stats["success_rate"], 0.5, places=2)
        
        # 7. Создаем новый ProfileController с правильным StatisticsService для user.user_id
        from logic.profile_controller import ProfileController
        profile_controller = ProfileController(
            user_service=app["user_service"],
            statistics_service=statistics_service
        )
        
        # Получение статистики профиля
        profile_stats = profile_controller.get_profile_statistics(
            user.user_id,
            force_refresh=True
        )
        
        self.assertEqual(profile_stats["user_id"], user.user_id)
        self.assertEqual(profile_stats["user_name"], "E2E Test User")
        self.assertEqual(profile_stats["statistics"]["total_tasks_attempted"], 2)
    
    def test_profile_selection_workflow(self):
        """Тест: workflow выбора профиля"""
        # Создаем компоненты приложения
        app = self._create_trainer_app_without_ui()
        
        # 1. Создаем несколько пользователей
        user1 = app["profile_controller"].create_new_profile("User 1")
        user2 = app["profile_controller"].create_new_profile("User 2")
        user3 = app["profile_controller"].create_new_profile("User 3")
        
        # 2. Получаем всех пользователей
        all_users = app["user_service"].get_all_users()
        self.assertEqual(len(all_users), 3)
        
        user_ids = {user.user_id for user in all_users}
        self.assertIn(user1.user_id, user_ids)
        self.assertIn(user2.user_id, user_ids)
        self.assertIn(user3.user_id, user_ids)
        
        # 3. Переключаемся между профилями
        selected_user1 = app["profile_controller"].select_profile(user1.user_id)
        self.assertIsNotNone(selected_user1)
        self.assertEqual(selected_user1.user_id, user1.user_id)
        
        selected_user2 = app["profile_controller"].select_profile(user2.user_id)
        self.assertIsNotNone(selected_user2)
        self.assertEqual(selected_user2.user_id, user2.user_id)
        
        # 4. Проверяем, что переключение работает
        self.assertNotEqual(selected_user1.user_id, selected_user2.user_id)
    
    def test_statistics_aggregation(self):
        """Тест: агрегация статистики"""
        # Создаем пользователя
        user = self.user_service.create_user("Statistics User")
        
        # Создаем ProgressService
        progress_service = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user.user_id
        )
        
        # Добавляем разнообразные попытки
        attempts = [
            ("module_01", "topic_01", "task_001", 1, True, 90.0, 60),
            ("module_01", "topic_01", "task_002", 1, True, 85.0, 45),
            ("module_01", "topic_02", "task_003", 1, False, 40.0, 120),
            ("module_01", "topic_02", "task_004", 2, True, 80.0, 90),
            ("module_01", "topic_02", "task_005", 3, False, 60.0, 150),
        ]
        
        for module_id, topic_id, task_id, difficulty, success, score, time_spent in attempts:
            progress_service.save_detailed_attempt(
                module_id, topic_id, task_id,
                difficulty=difficulty,
                success=success,
                score=score,
                time_spent=time_spent
            )
        
        # Агрегируем статистику
        statistics_service = StatisticsService(progress_service=progress_service)
        stats = statistics_service.aggregate_statistics(user.user_id, force_refresh=True)
        
        # Проверяем общие метрики
        self.assertEqual(stats["total_tasks_attempted"], 5)
        self.assertEqual(stats["total_tasks_completed"], 3)
        self.assertAlmostEqual(stats["success_rate"], 3/5, places=2)
        
        # Проверяем слабые области
        weak_areas = statistics_service.get_weak_areas(user.user_id, threshold=0.70)
        self.assertGreaterEqual(len(weak_areas), 1)  # topic_02 должна быть слабой
        
        # Проверяем производительность по типам
        performance = statistics_service.get_performance_by_type(user.user_id)
        self.assertIsInstance(performance, dict)
        
        # Проверяем динамику времени
        time_dynamics = statistics_service.get_time_dynamics(user.user_id, days=30)
        self.assertIsInstance(time_dynamics, list)
    
    def test_error_review_workflow(self):
        """Тест: workflow работы с ошибками"""
        # Создаем пользователя
        user = self.user_service.create_user("Error Review User")
        
        # Создаем ProgressService
        progress_service = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user.user_id
        )
        
        # 1. Выполняем задания с ошибками
        progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=False, score=40.0, time_spent=120
        )
        progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=False, score=45.0, time_spent=110
        )
        progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_002",
            difficulty=1, success=False, score=50.0, time_spent=100
        )
        
        # 2. Проверяем mistake_bank
        mistake_bank = progress_service.get_mistake_bank()
        self.assertEqual(len(mistake_bank), 2)  # task_001 и task_002
        
        # Проверяем, что ошибки отсортированы по fail_count
        fail_counts = [mistake["fail_count"] for mistake in mistake_bank]
        self.assertEqual(fail_counts, sorted(fail_counts, reverse=True))
        
        # 3. Получаем ошибки для конкретного задания
        mistakes_task_001 = progress_service.get_mistakes_for_task(
            "module_01", "topic_01", "task_001"
        )
        self.assertEqual(len(mistakes_task_001), 1)
        self.assertEqual(mistakes_task_001[0]["task"], "task_001")
        self.assertEqual(mistakes_task_001[0]["fail_count"], 2)
        
        # 4. "Повторное" выполнение задания (симуляция через сохранение попытки)
        progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=True, score=90.0, time_spent=60
        )
        
        # 5. Проверяем, что ошибка удалена из mistake_bank
        mistake_bank_after = progress_service.get_mistake_bank()
        task_001_mistakes = [
            m for m in mistake_bank_after
            if m["task"] == "task_001"
        ]
        self.assertEqual(len(task_001_mistakes), 0)  # Ошибка удалена
        
        # task_002 все еще в mistake_bank
        task_002_mistakes = [
            m for m in mistake_bank_after
            if m["task"] == "task_002"
        ]
        self.assertEqual(len(task_002_mistakes), 1)
    
    def test_multi_user_isolation(self):
        """Тест: изоляция данных между пользователями"""
        # Создаем нескольких пользователей
        user1 = self.user_service.create_user("Isolation User 1")
        user2 = self.user_service.create_user("Isolation User 2")
        user3 = self.user_service.create_user("Isolation User 3")
        
        # Создаем ProgressService для каждого
        progress_service1 = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user1.user_id
        )
        progress_service2 = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user2.user_id
        )
        progress_service3 = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user3.user_id
        )
        
        # Выполняем задания для каждого пользователя
        progress_service1.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=True, score=90.0, time_spent=60
        )
        progress_service2.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=2, success=True, score=85.0, time_spent=90
        )
        progress_service3.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=3, success=False, score=60.0, time_spent=150
        )
        
        # Проверяем изоляцию прогресса
        progress1 = progress_service1.get_task_progress("module_01", "topic_01", "task_001")
        progress2 = progress_service2.get_task_progress("module_01", "topic_01", "task_001")
        progress3 = progress_service3.get_task_progress("module_01", "topic_01", "task_001")
        
        self.assertIsNotNone(progress1)
        self.assertIsNotNone(progress2)
        self.assertIsNotNone(progress3)
        
        # Проверяем, что данные разные
        self.assertEqual(progress1['current_difficulty'], 1)
        self.assertEqual(progress2['current_difficulty'], 2)
        self.assertEqual(progress3['current_difficulty'], 3)
        
        # Проверяем изоляцию статистики
        stats_service1 = StatisticsService(progress_service=progress_service1)
        stats_service2 = StatisticsService(progress_service=progress_service2)
        stats_service3 = StatisticsService(progress_service=progress_service3)
        
        stats1 = stats_service1.aggregate_statistics(user1.user_id, force_refresh=True)
        stats2 = stats_service2.aggregate_statistics(user2.user_id, force_refresh=True)
        stats3 = stats_service3.aggregate_statistics(user3.user_id, force_refresh=True)
        
        # Проверяем, что статистика изолирована
        self.assertEqual(stats1["total_tasks_attempted"], 1)
        self.assertEqual(stats2["total_tasks_attempted"], 1)
        self.assertEqual(stats3["total_tasks_attempted"], 1)
        
        self.assertEqual(stats1["total_tasks_completed"], 1)
        self.assertEqual(stats2["total_tasks_completed"], 1)
        self.assertEqual(stats3["total_tasks_completed"], 0)  # user3 не выполнил задание
        
        # Проверяем изоляцию mistake_bank
        mistake_bank1 = progress_service1.get_mistake_bank()
        mistake_bank2 = progress_service2.get_mistake_bank()
        mistake_bank3 = progress_service3.get_mistake_bank()
        
        self.assertEqual(len(mistake_bank1), 0)  # user1 успешно выполнил
        self.assertEqual(len(mistake_bank2), 0)  # user2 успешно выполнил
        self.assertEqual(len(mistake_bank3), 1)  # user3 не выполнил


if __name__ == '__main__':
    unittest.main()

